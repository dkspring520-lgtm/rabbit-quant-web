#!/usr/bin/env python3
"""L2 process health, with strict feed freshness only while SSE is trading.

Calendar: SSE 2025-45, 2026 closure notice (2025-12-22).
https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
Session: SSE Trading Rules 2026, section 2.4.2. No network calls or credentials.
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
CLOSURES_2026 = (
    ("0101", "0103"), ("0215", "0223"), ("0404", "0406"),
    ("0501", "0505"), ("0619", "0621"), ("0925", "0927"), ("1001", "1007"),
)


def market_phase(now):
    local = now.astimezone(SHANGHAI)
    if local.year != 2026:
        return "calendar-unknown"
    day = local.strftime("%m%d")
    if local.weekday() >= 5 or any(start <= day <= end for start, end in CLOSURES_2026):
        return "closed-day"
    clock = local.strftime("%H%M%S")
    if "091500" <= clock < "092500":
        return "opening-auction"
    if "092500" <= clock < "093000":
        return "opening-pause"
    if "093000" <= clock < "113000":
        return "morning"
    if "113000" <= clock < "130000":
        return "lunch"
    if "130000" <= clock < "145700":
        return "afternoon"
    if "145700" <= clock < "150000":
        return "closing-auction"
    return "closed-hours"


def timestamp_age(value, now):
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.utcoffset() is None:
            return None
        age = (now - stamp).total_seconds()
        return age if math.isfinite(age) else None
    except (ValueError, TypeError, OverflowError):
        return None


def evaluate_health(payload, now=None):
    now = now or datetime.now(timezone.utc)
    if now.utcoffset() is None:
        raise ValueError("health-check time must include a timezone")
    phase = market_phase(now)
    required = phase in {"opening-auction", "morning", "afternoon", "closing-auction"}
    result = {"healthy": False, "phase": phase, "feedFreshnessRequired": required}
    def fail(reason):
        return dict(result, reason=reason)
    if phase == "calendar-unknown":
        return fail("calendar-year-not-configured")
    if not isinstance(payload, dict):
        return fail("invalid-state")
    heartbeat = timestamp_age(payload.get("updatedAt"), now)
    result["heartbeatAgeSeconds"] = heartbeat
    if heartbeat is None or not 0 <= heartbeat < 15:
        return fail("heartbeat-not-fresh")
    status = payload.get("status")
    if not isinstance(status, dict) or status.get("connected") is not True:
        return fail("not-connected")
    if status.get("authorized") is not True:
        return fail("not-authorized")
    if required:
        stored_age = status.get("ageSeconds")
        if status.get("stale") is not False or isinstance(stored_age, bool) or not isinstance(stored_age, (int, float)) or not math.isfinite(stored_age) or not 0 <= stored_age <= 15:
            return fail("feed-not-fresh")
        receipt_age = timestamp_age(payload.get("lastMessageAt"), now)
        result["receiptAgeSeconds"] = receipt_age
        if receipt_age is None or not 0 <= receipt_age <= 15:
            return fail("receipt-not-fresh")
        try:
            exchange = datetime.strptime(payload["lastExchangeTime"], "%Y%m%d-%H%M%S%f").replace(tzinfo=SHANGHAI)
            exchange_age = (now - exchange).total_seconds()
        except (KeyError, TypeError, ValueError, OverflowError):
            return fail("invalid-exchange-time")
        # At 13:00 a just-received replay from the morning is not fresh data.
        session_start = {"opening-auction": "091500", "morning": "093000", "afternoon": "130000", "closing-auction": "145700"}[phase]
        if (exchange.date() != now.astimezone(SHANGHAI).date()
                or not 0 <= exchange_age <= 15
                or exchange.strftime("%H%M%S") < session_start):
            return fail("exchange-not-fresh")
    return dict(result, healthy=True, reason="live-feed-fresh" if required else "heartbeat-and-connection-only")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", default="/training-state/zijin-l2-orderflow.json")
    args = parser.parse_args()
    try:
        result = evaluate_health(json.loads(Path(args.state).read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError, OverflowError):
        result = {"healthy": False, "reason": "state-unreadable-or-invalid"}
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["healthy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
