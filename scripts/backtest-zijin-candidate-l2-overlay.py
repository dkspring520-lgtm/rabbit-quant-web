#!/usr/bin/env python3
"""Research-only minute-candidate and second-level L2 overlay for 601899.SH.

This experiment deliberately separates responsibilities:

* the minute layer creates a candidate;
* the second-level L2 layer may confirm, veto, or remain neutral;
* accepted candidates become fully costed simulated round trips;
* every candidate is written to an immutable-style JSONL research ledger.

It never writes production state and never promotes a strategy automatically.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import importlib.util
import json
import statistics
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
SECOND_LEVEL_ENGINE = ROOT / "scripts" / "backtest-zijin-second-level.py"
DEFAULT_MANIFEST = Path(r"E:\zijin-l2\601899-factor-minute-ohlc-v1.manifest.json")
DEFAULT_MINUTE_DATA = Path(r"E:\zijin-l2\601899-factor-minute-ohlc-v1.jsonl")
DEFAULT_OUTPUT = Path(r"E:\zijin-l2\research-results\zijin-candidate-l2-overlay-v2-6.json")
ENGINE_VERSION = "2.6.0"
CONFIRMATION_WINDOW_SECONDS = 10
OPENING_GAP_THRESHOLD_PCT = 0.50
HORIZON_SECONDS = {"positiveT": 45 * 60, "reverseT": 50 * 60}
ATR_PERIOD = 14
ATR_STOP_FRACTION = 0.10
STOP_LOSS_MULTIPLE = {"positiveT": 1.25, "reverseT": 1.10}
EXIT_OPPOSING_SECONDS = 3
EXIT_ADVERSE_TARGET_FRACTION = 0.20
V22_WARNING_OPPOSING_SECONDS = 3
V22_CONFIRM_OPPOSING_SECONDS = {"positiveT": 6, "reverseT": 6}
V22_ADVERSE_TARGET_FRACTION = {"positiveT": 0.30, "reverseT": 0.30}
V22_FLOW_WINDOW_SECONDS = 3
V22_MIN_OFI_DETERIORATION = 0.10
V22_MIN_ADVERSE_RESPONSE_BPS = 0.50
V22_MIN_ADVERSE_ACCELERATION_BPS = 0.25
V23_POSITIVE_GRACE_SECONDS = 15
V23_POSITIVE_TARGET_MULTIPLE = 1.50
V24_RECOVERY_OBSERVATION_SECONDS = 5
V24_EXIT_ADVERSE_TARGET_FRACTION = 0.30
V24_RELEASE_CONSECUTIVE_SECONDS = 3
V24_RECOVERED_ADVERSE_TARGET_FRACTION = 0.10
V25_POSITIVE_MIN_ACTIVE_BUY_RATIO = 0.25
V25_REVERSE_MAX_PRICE_RESPONSE_BPS = -3.0
V26_POSITIVE_MIN_PRICE_RESPONSE_BPS = 0.0
V26_POSITIVE_FLOW_COLLAPSE_DROP = 0.15
V26_POSITIVE_FLOW_COLLAPSE_MAX_RATIO = 0.40
V26_NEGATIVE_REGIMES = {
    "bearish", "downtrend", "risk-off", "riskoff", "weak", "declining",
    "空头", "下跌", "弱势", "风险规避",
}
EMERGENCY_ATR_FRACTION = 0.15
EMERGENCY_TARGET_MULTIPLE_MIN = 1.50
EMERGENCY_TARGET_MULTIPLE_MAX = 2.50
PROMOTION_THRESHOLDS = {
    "minimumClosedTrades": 100,
    "minimumOutOfSampleWinRate": 0.52,
    "minimumOutOfSampleProfitFactor": 1.20,
    "minimumOutOfSampleNetPnl": 0.0,
}

COHORTS = {
    "minuteBaseline": "execute every minute candidate without using L2",
    "l2ConfirmOnly": "execute only candidates confirmed by second-level L2",
    "l2VetoOnly": "execute confirmed or neutral candidates; veto rejected candidates",
    "l2ConfirmAndVeto": "execute only confirmed candidates and honor every veto",
}


def load_second_level_engine(path: Path = SECOND_LEVEL_ENGINE):
    spec = importlib.util.spec_from_file_location("zijin_second_level_research", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load second-level engine: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SECOND = load_second_level_engine()


def stable_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_clock(value: Any) -> int | None:
    if isinstance(value, (int, float)) and 0 <= int(value) < 24 * 3_600:
        return int(value)
    digits = "".join(character for character in str(value or "") if character.isdigit())
    if len(digits) >= 6:
        digits = digits[-6:]
    elif len(digits) >= 4:
        digits = digits[-4:] + "00"
    else:
        return None
    hour, minute, second = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    if hour > 23 or minute > 59 or second > 59:
        return None
    return hour * 3_600 + minute * 60 + second


def normalize_direction(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    if text in {"positivet", "positive", "buy", "正t", "正ｔ"}:
        return "positiveT"
    if text in {"reverset", "reverse", "sell", "反t", "反ｔ"}:
        return "reverseT"
    return None


def normalize_candidate(row: dict[str, Any], source: str) -> dict[str, Any] | None:
    date = str(row.get("date") or row.get("tradingDate") or "").replace("-", "")
    second = parse_clock(row.get("second", row.get("time", row.get("minute"))))
    direction = normalize_direction(row.get("direction", row.get("side")))
    if len(date) != 8 or not date.isdigit() or second is None or direction is None:
        return None
    factors = row.get("factors") if isinstance(row.get("factors"), dict) else {}
    identity = {
        "date": date,
        "second": second,
        "direction": direction,
        "source": source,
        "factorCombinationId": row.get("factorCombinationId") or "external-minute-candidate-v1",
    }
    return {
        "candidateId": row.get("candidateId") or stable_hash(identity)[:20],
        **identity,
        "candidateScore": row.get("score", row.get("candidateScore")),
        "candidatePrice": row.get("price", row.get("candidatePrice")),
        "factors": factors,
    }


def load_external_candidates(path: Path) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        candidate = normalize_candidate(row, f"{path.name}:{line_number}")
        if candidate is None:
            raise ValueError(f"Invalid candidate at {path}:{line_number}")
        candidates.append(candidate)
    return candidates


def opening_candidates(path: Path, allowed_dates: set[str]) -> list[dict[str, Any]]:
    """Create deterministic opening candidates without reading future minute fields."""
    output: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            day = json.loads(line)
            date = str(day.get("date") or "").replace("-", "")
            if date not in allowed_dates:
                continue
            previous_close = float(day.get("previousClose") or 0)
            minutes = day.get("minutes") if isinstance(day.get("minutes"), list) else []
            first = next((minute for minute in minutes if str(minute.get("time")) in {"0930", "09:30"}), None)
            opening_price = float((first or {}).get("open") or 0)
            if previous_close <= 0 or opening_price <= 0:
                continue
            gap_pct = (opening_price / previous_close - 1) * 100
            direction = "reverseT" if gap_pct >= OPENING_GAP_THRESHOLD_PCT else (
                "positiveT" if gap_pct <= -OPENING_GAP_THRESHOLD_PCT else None
            )
            if direction is None:
                continue
            identity = {
                "date": date,
                "second": 9 * 3_600 + 30 * 60,
                "direction": direction,
                "source": f"{path.name}:{line_number}",
                "factorCombinationId": "opening-gap-direction-v1",
            }
            output.append({
                "candidateId": stable_hash(identity)[:20],
                **identity,
                "candidateScore": min(100, round(60 + abs(gap_pct) * 10, 2)),
                "candidatePrice": opening_price,
                "factors": {
                    "openingGapPct": round(gap_pct, 6),
                    "previousClose": previous_close,
                    "openingPrice": opening_price,
                    "directionConstraint": direction,
                    "usesOpeningMinuteFutureFields": False,
                },
            })
    return output


def prior_atr_by_date(path: Path, allowed_dates: set[str]) -> dict[str, float | None]:
    """Calculate ATR14 from completed sessions only; the current day is never included."""
    output: dict[str, float | None] = {}
    true_ranges: deque[float] = deque(maxlen=ATR_PERIOD)
    with path.open("r", encoding="utf-8-sig") as source:
        for line in source:
            if not line.strip():
                continue
            day = json.loads(line)
            date = str(day.get("date") or "").replace("-", "")
            if date in allowed_dates:
                output[date] = statistics.mean(true_ranges) if true_ranges else None
            minutes = day.get("minutes") if isinstance(day.get("minutes"), list) else []
            highs = [float(minute.get("high") or 0) for minute in minutes if float(minute.get("high") or 0) > 0]
            lows = [float(minute.get("low") or 0) for minute in minutes if float(minute.get("low") or 0) > 0]
            previous_close = float(day.get("previousClose") or 0)
            if not highs or not lows or previous_close <= 0:
                continue
            day_high, day_low = max(highs), min(lows)
            true_ranges.append(max(
                day_high - day_low,
                abs(day_high - previous_close),
                abs(day_low - previous_close),
            ))
    return output


def price_at_or_before(trades: dict[int, Any], second: int) -> float | None:
    available = [value for value in trades if value <= second]
    return trades[max(available)].last if available else None


def classify_l2(candidate: dict[str, Any], trades: dict[int, Any], quotes: dict[int, Any],
                window_seconds: int = CONFIRMATION_WINDOW_SECONDS) -> dict[str, Any]:
    """Classify with events through each evaluated second only; future outcomes are unread."""
    start = int(candidate["second"])
    end = start + window_seconds
    direction = candidate["direction"]
    starting_price = price_at_or_before(trades, start)
    latest_price = starting_price
    latest_quote = None
    latest_quote_second = None
    flow: deque[tuple[int, int, int]] = deque()
    aligned_seconds = 0
    opposing_seconds = 0
    evaluated_seconds = 0
    evidence: list[dict[str, Any]] = []

    for second in range(start, end + 1):
        trade = trades.get(second)
        quote = quotes.get(second)
        if quote is not None:
            latest_quote = quote
            latest_quote_second = second
        if trade is not None:
            latest_price = trade.last
            flow.append((second, trade.buy_volume, trade.sell_volume))
        while flow and flow[0][0] < second - 4:
            flow.popleft()
        if latest_price is None or latest_quote is None or latest_quote_second is None:
            continue
        book_age = second - latest_quote_second
        if book_age > 3 or not flow:
            continue
        buy_volume = sum(item[1] for item in flow)
        sell_volume = sum(item[2] for item in flow)
        active_total = buy_volume + sell_volume
        if active_total <= 0:
            continue
        active_buy_ratio = buy_volume / active_total
        depth, microprice_edge, spread = SECOND.quote_features(latest_quote, latest_price)
        if depth is None or microprice_edge is None or spread is None or spread > 18:
            continue
        response_bps = ((latest_price / starting_price - 1) * 10_000
                        if starting_price and starting_price > 0 else 0.0)
        positive_votes = sum((
            active_buy_ratio >= 0.55,
            depth >= 0.04,
            microprice_edge > 0,
            response_bps >= 0,
        ))
        reverse_votes = sum((
            active_buy_ratio <= 0.45,
            depth <= -0.04,
            microprice_edge < 0,
            response_bps <= 0,
        ))
        aligned_votes = positive_votes if direction == "positiveT" else reverse_votes
        opposing_votes = reverse_votes if direction == "positiveT" else positive_votes
        aligned_seconds = aligned_seconds + 1 if aligned_votes >= 3 else 0
        opposing_seconds = opposing_seconds + 1 if opposing_votes >= 3 else 0
        evaluated_seconds += 1
        snapshot = {
            "second": second,
            "activeBuyRatio": round(active_buy_ratio, 6),
            "depthImbalance": round(depth, 6),
            "micropriceEdgeBps": round(microprice_edge, 6),
            "priceResponseBps": round(response_bps, 6),
            "bookAgeSeconds": book_age,
            "alignedVotes": aligned_votes,
            "opposingVotes": opposing_votes,
        }
        evidence.append(snapshot)
        if aligned_seconds >= 3:
            return {
                "status": "confirmed",
                "decisionSecond": second,
                "evaluatedSeconds": evaluated_seconds,
                "evidence": evidence,
                "reason": "three consecutive seconds aligned with candidate direction",
            }
        if opposing_seconds >= 3:
            return {
                "status": "rejected",
                "decisionSecond": second,
                "evaluatedSeconds": evaluated_seconds,
                "evidence": evidence,
                "reason": "three consecutive seconds opposed candidate direction",
            }
    return {
        "status": "neutral",
        "decisionSecond": end,
        "evaluatedSeconds": evaluated_seconds,
        "evidence": evidence,
        "reason": "confirmation window ended without continuous directional evidence",
    }


def cohort_decision(cohort: str, l2_status: str, candidate_second: int,
                    l2_decision_second: int) -> tuple[bool, int, str]:
    if cohort == "minuteBaseline":
        return True, candidate_second, "minute candidate baseline"
    if cohort == "l2ConfirmOnly":
        return l2_status == "confirmed", l2_decision_second, f"L2 {l2_status}"
    if cohort == "l2VetoOnly":
        return l2_status != "rejected", l2_decision_second, f"L2 {l2_status}"
    if cohort == "l2ConfirmAndVeto":
        return l2_status == "confirmed", l2_decision_second, f"L2 {l2_status}"
    raise KeyError(cohort)


def v25_entry_gate(candidate: dict[str, Any], l2: dict[str, Any]) -> dict[str, Any]:
    """Apply direction-specific quality gates frozen on train plus validation data."""
    evidence = l2.get("evidence") or []
    latest = evidence[-1] if evidence else {}
    direction = candidate["direction"]
    active_buy_ratio = latest.get("activeBuyRatio")
    price_response_bps = latest.get("priceResponseBps")
    if l2.get("status") != "confirmed" or not evidence:
        passed, reason = False, "requires-confirmed-l2"
    elif direction == "positiveT":
        passed = (active_buy_ratio is not None
                  and active_buy_ratio >= V25_POSITIVE_MIN_ACTIVE_BUY_RATIO)
        reason = "positive-buy-flow-confirmed" if passed else "positive-buy-flow-too-weak"
    else:
        passed = (price_response_bps is not None
                  and price_response_bps <= V25_REVERSE_MAX_PRICE_RESPONSE_BPS)
        reason = "reverse-price-response-confirmed" if passed else "reverse-price-response-too-weak"
    return {
        "passed": passed,
        "reason": reason,
        "direction": direction,
        "evidenceSecond": latest.get("second"),
        "activeBuyRatio": active_buy_ratio,
        "priceResponseBps": price_response_bps,
    }


def optional_factor(factors: dict[str, Any], keys: tuple[str, ...]) -> tuple[str | None, Any]:
    for key in keys:
        if key in factors and factors[key] is not None:
            return key, factors[key]
    return None, None


def v26_regime_context(candidate: dict[str, Any], prior_atr: float | None) -> dict[str, Any]:
    """Expose available entry-time regimes without inventing missing market data."""
    factors = candidate.get("factors") if isinstance(candidate.get("factors"), dict) else {}
    market_key, market_value = optional_factor(factors, (
        "marketRegime", "marketTrend", "indexRegime", "marketState",
    ))
    sector_key, sector_value = optional_factor(factors, (
        "sectorRegime", "sectorTrend", "industryRegime", "sectorState",
    ))
    reference_price = float(
        candidate.get("candidatePrice") or factors.get("openingPrice") or 0
    )
    return {
        "openingGapPct": factors.get("openingGapPct"),
        "atr": {
            "status": "available" if prior_atr is not None else "unavailable",
            "priorAtr14": prior_atr,
            "priorAtrPct": (
                prior_atr / reference_price * 100
                if prior_atr is not None and reference_price > 0 else None
            ),
            "usesCompletedSessionsOnly": True,
        },
        "market": {
            "status": "available" if market_key else "unavailable",
            "sourceField": market_key,
            "value": market_value,
        },
        "sector": {
            "status": "available" if sector_key else "unavailable",
            "sourceField": sector_key,
            "value": sector_value,
        },
    }


def is_negative_regime(value: Any) -> bool:
    return str(value or "").strip().lower() in V26_NEGATIVE_REGIMES


def v26_entry_gate(candidate: dict[str, Any], l2: dict[str, Any],
                   prior_atr: float | None) -> dict[str, Any]:
    """V2.5 gate plus positive-T price/flow consistency frozen before replay."""
    base = v25_entry_gate(candidate, l2)
    evidence = l2.get("evidence") or []
    first = evidence[0] if evidence else {}
    latest = evidence[-1] if evidence else {}
    first_ratio = first.get("activeBuyRatio")
    latest_ratio = latest.get("activeBuyRatio")
    response_bps = latest.get("priceResponseBps")
    flow_drop = (
        first_ratio - latest_ratio
        if first_ratio is not None and latest_ratio is not None else None
    )
    flow_collapse = (
        candidate["direction"] == "positiveT"
        and flow_drop is not None
        and flow_drop >= V26_POSITIVE_FLOW_COLLAPSE_DROP
        and latest_ratio < V26_POSITIVE_FLOW_COLLAPSE_MAX_RATIO
    )
    price_flow_divergence = (
        candidate["direction"] == "positiveT"
        and response_bps is not None
        and response_bps < V26_POSITIVE_MIN_PRICE_RESPONSE_BPS
    )
    regime_context = v26_regime_context(candidate, prior_atr)
    negative_regime = (
        candidate["direction"] == "positiveT"
        and any(
            item["status"] == "available" and is_negative_regime(item["value"])
            for item in (regime_context["market"], regime_context["sector"])
        )
    )
    if not base["passed"]:
        passed, reason = False, base["reason"]
    elif negative_regime:
        passed, reason = False, "positive-negative-market-regime"
    elif price_flow_divergence:
        passed, reason = False, "positive-price-flow-divergence"
    elif flow_collapse:
        passed, reason = False, "positive-buy-flow-collapse"
    else:
        passed, reason = True, "v26-directional-entry-confirmed"
    return {
        **base,
        "passed": passed,
        "reason": reason,
        "firstActiveBuyRatio": first_ratio,
        "activeBuyRatioChange": (-flow_drop if flow_drop is not None else None),
        "positiveBuyFlowCollapse": flow_collapse,
        "positivePriceFlowDivergence": price_flow_divergence,
        "negativeRegime": negative_regime,
        "regimeContext": regime_context,
    }


def loss_budget_stop_gap(direction: str, entry_market: float, target_gap: float,
                         prior_atr: float | None) -> tuple[float, dict[str, float | None]]:
    """Freeze an ATR stop at entry, capped by a predeclared net loss/profit ratio."""
    target_market = entry_market + target_gap if direction == "positiveT" else entry_market - target_gap
    target_net = max(0.0, SECOND.pnl(direction, entry_market, target_market)[0])
    loss_budget = target_net * STOP_LOSS_MULTIPLE[direction]
    atr_gap = prior_atr * ATR_STOP_FRACTION if prior_atr and prior_atr > 0 else target_gap
    upper_bound = max(0.01, min(atr_gap, target_gap * STOP_LOSS_MULTIPLE[direction]))
    allowed_gap = 0.0
    tick = 0.01
    steps = max(1, int(upper_bound / tick + 1e-9))
    for step in range(1, steps + 1):
        gap = round(step * tick, 2)
        stop_market = entry_market - gap if direction == "positiveT" else entry_market + gap
        stop_net = SECOND.pnl(direction, entry_market, stop_market)[0]
        if -stop_net <= loss_budget:
            allowed_gap = gap
        else:
            break
    stop_gap = allowed_gap or tick
    return stop_gap, {
        "priorAtr14": prior_atr,
        "atrStopGap": atr_gap,
        "targetNetPnl": target_net,
        "maximumPlannedNetLoss": loss_budget,
        "maximumLossToTargetProfit": STOP_LOSS_MULTIPLE[direction],
    }


def adaptive_emergency_stop_gap(direction: str, entry_market: float, target_gap: float,
                                prior_atr: float | None) -> tuple[float, dict[str, float | None]]:
    """Use L2 invalidation for normal exits and reserve this wider stop for tail risk."""
    atr_gap = prior_atr * EMERGENCY_ATR_FRACTION if prior_atr and prior_atr > 0 else 0.0
    lower_bound = target_gap * EMERGENCY_TARGET_MULTIPLE_MIN
    upper_bound = target_gap * EMERGENCY_TARGET_MULTIPLE_MAX
    stop_gap = round(min(max(lower_bound, atr_gap), upper_bound) + 1e-9, 2)
    stop_gap = max(0.01, stop_gap)
    stop_market = entry_market - stop_gap if direction == "positiveT" else entry_market + stop_gap
    target_market = entry_market + target_gap if direction == "positiveT" else entry_market - target_gap
    target_net = SECOND.pnl(direction, entry_market, target_market)[0]
    stop_net = SECOND.pnl(direction, entry_market, stop_market)[0]
    return stop_gap, {
        "priorAtr14": prior_atr,
        "atrStopGap": atr_gap,
        "targetNetPnl": target_net,
        "estimatedStopNetPnl": stop_net,
        "estimatedLossToTargetProfit": (-stop_net / target_net) if target_net > 0 else None,
        "emergencyTargetMultipleMin": EMERGENCY_TARGET_MULTIPLE_MIN,
        "emergencyTargetMultipleMax": EMERGENCY_TARGET_MULTIPLE_MAX,
    }


def v23_positive_tail_stop_gap(target_gap: float) -> float:
    """Freeze the research-only positive-T tail cap before replay starts."""
    return max(0.01, round(target_gap * V23_POSITIVE_TARGET_MULTIPLE + 1e-9, 2))


def exit_pressure(candidate: dict[str, Any], entry_market: float, current_price: float,
                  trade_flow: deque[tuple[int, int, int]], quote: Any) -> tuple[int, float]:
    buy_volume = sum(item[1] for item in trade_flow)
    sell_volume = sum(item[2] for item in trade_flow)
    active_total = buy_volume + sell_volume
    if active_total <= 0:
        return 0, 0.0
    active_buy_ratio = buy_volume / active_total
    depth, microprice_edge, spread = SECOND.quote_features(quote, current_price)
    if depth is None or microprice_edge is None or spread is None or spread > 18:
        return 0, 0.0
    response_bps = (current_price / entry_market - 1) * 10_000
    positive_votes = sum((
        active_buy_ratio >= 0.55,
        depth >= 0.04,
        microprice_edge > 0,
        response_bps >= 0,
    ))
    reverse_votes = sum((
        active_buy_ratio <= 0.45,
        depth <= -0.04,
        microprice_edge < 0,
        response_bps <= 0,
    ))
    opposing_votes = reverse_votes if candidate["direction"] == "positiveT" else positive_votes
    adverse_distance = (entry_market - current_price if candidate["direction"] == "positiveT"
                        else current_price - entry_market)
    return opposing_votes, max(0.0, adverse_distance)


def active_buy_ratio(trade_flow: deque[tuple[int, int, int]]) -> float | None:
    buy_volume = sum(item[1] for item in trade_flow)
    sell_volume = sum(item[2] for item in trade_flow)
    active_total = buy_volume + sell_volume
    return buy_volume / active_total if active_total > 0 else None


def v22_exit_confirmation(direction: str, entry_market: float, current_price: float,
                          previous_price: float | None,
                          current_active_buy_ratio: float | None,
                          prior_active_buy_ratio: float | None,
                          opposing_votes: int) -> dict[str, Any]:
    response_bps = ((current_price / entry_market - 1) * 10_000
                    if entry_market > 0 else 0.0)
    acceleration_bps = ((current_price / previous_price - 1) * 10_000
                        if previous_price and previous_price > 0 else 0.0)
    if direction == "positiveT":
        adverse_response = response_bps <= -V22_MIN_ADVERSE_RESPONSE_BPS
        adverse_acceleration = acceleration_bps <= -V22_MIN_ADVERSE_ACCELERATION_BPS
        ofi_deterioration = (current_active_buy_ratio is not None
                             and prior_active_buy_ratio is not None
                             and prior_active_buy_ratio - current_active_buy_ratio
                             >= V22_MIN_OFI_DETERIORATION)
    else:
        adverse_response = response_bps >= V22_MIN_ADVERSE_RESPONSE_BPS
        adverse_acceleration = acceleration_bps >= V22_MIN_ADVERSE_ACCELERATION_BPS
        ofi_deterioration = (current_active_buy_ratio is not None
                             and prior_active_buy_ratio is not None
                             and current_active_buy_ratio - prior_active_buy_ratio
                             >= V22_MIN_OFI_DETERIORATION)
    confirmations = sum((adverse_response, adverse_acceleration, ofi_deterioration))
    return {
        "confirmed": opposing_votes >= 3 and confirmations >= 2,
        "confirmations": confirmations,
        "adverseResponse": adverse_response,
        "adverseAcceleration": adverse_acceleration,
        "ofiDeterioration": ofi_deterioration,
        "responseBps": response_bps,
        "accelerationBps": acceleration_bps,
        "activeBuyRatio": current_active_buy_ratio,
        "priorActiveBuyRatio": prior_active_buy_ratio,
    }


def post_exit_audit(direction: str, entry_market: float, target_gap: float,
                    exit_second: int, horizon_second: int,
                    trades: dict[int, Any]) -> dict[str, Any] | None:
    future_seconds = sorted(second for second in trades
                            if exit_second < second <= horizon_second
                            and SECOND.is_market_second(second))
    if not future_seconds:
        return None
    target_price = entry_market + target_gap if direction == "positiveT" else entry_market - target_gap
    target_after_exit_second = next((
        second for second in future_seconds
        if (trades[second].high >= target_price if direction == "positiveT"
            else trades[second].low <= target_price)
    ), None)
    if direction == "positiveT":
        maximum_favorable = max(trades[second].high - entry_market for second in future_seconds)
        maximum_adverse = max(entry_market - trades[second].low for second in future_seconds)
    else:
        maximum_favorable = max(entry_market - trades[second].low for second in future_seconds)
        maximum_adverse = max(trades[second].high - entry_market for second in future_seconds)
    return {
        "targetRecoveredAfterExit": target_after_exit_second is not None,
        "targetRecoveredSecond": target_after_exit_second,
        "secondsUntilTargetRecovery": (target_after_exit_second - exit_second
                                       if target_after_exit_second is not None else None),
        "maximumFavorableExcursion": max(0.0, maximum_favorable),
        "maximumAdverseExcursion": max(0.0, maximum_adverse),
    }


def simulate_round_trip(candidate: dict[str, Any], decision_second: int,
                        trades: dict[int, Any], quotes: dict[int, Any] | None = None,
                        prior_atr: float | None = None,
                        risk_managed: bool = False,
                        stop_model: str = "adaptive",
                        exit_model: str = "v21") -> dict[str, Any] | None:
    trade_seconds = sorted(second for second in trades if SECOND.is_market_second(second))
    entry_index = bisect.bisect_right(trade_seconds, decision_second)
    if entry_index >= len(trade_seconds):
        return None
    entry_second = trade_seconds[entry_index]
    entry_market = trades[entry_second].first
    direction = candidate["direction"]
    horizon = HORIZON_SECONDS[direction]
    horizon_index = bisect.bisect_left(trade_seconds, decision_second + horizon)
    if horizon_index >= len(trade_seconds):
        horizon_index = len(trade_seconds) - 1
    gap = SECOND.target_gap(entry_market)
    stop_gap, stop_context = (
        loss_budget_stop_gap(direction, entry_market, gap, prior_atr)
        if stop_model == "tight"
        else adaptive_emergency_stop_gap(direction, entry_market, gap, prior_atr)
    )
    if risk_managed and exit_model == "v23" and direction == "positiveT":
        stop_gap = v23_positive_tail_stop_gap(gap)
        stop_context = {
            **stop_context,
            "positiveTailGraceSeconds": V23_POSITIVE_GRACE_SECONDS,
            "positiveTailTargetMultiple": V23_POSITIVE_TARGET_MULTIPLE,
        }
    target_second = None
    exit_second = None
    exit_market = None
    exit_reason = None
    exit_decision_second = None
    latest_quote = None
    latest_quote_second = None
    trade_flow: deque[tuple[int, int, int]] = deque()
    opposing_seconds = 0
    last_pressure_second = None
    pending_exit = False
    warning_second = None
    exit_confirmation = None
    active_buy_history: deque[tuple[int, float]] = deque()
    price_history: dict[int, float] = {}
    recovery_watch_second = None
    recovery_release_seconds = 0
    for index in range(entry_index + 1, horizon_index + 1):
        second = trade_seconds[index]
        trade = trades[second]
        if pending_exit:
            exit_second, exit_market, exit_reason = second, trade.first, "l2PriceInvalidation"
            break
        target_touched = (trade.high >= entry_market + gap if direction == "positiveT"
                          else trade.low <= entry_market - gap)
        stop_is_active = not (
            exit_model == "v23"
            and direction == "positiveT"
            and second - entry_second < V23_POSITIVE_GRACE_SECONDS
        )
        stop_touched = risk_managed and stop_is_active and (
            trade.low <= entry_market - stop_gap if direction == "positiveT"
            else trade.high >= entry_market + stop_gap
        )
        if stop_touched:
            stop_market = entry_market - stop_gap if direction == "positiveT" else entry_market + stop_gap
            exit_second = second
            exit_market = min(stop_market, trade.first) if direction == "positiveT" else max(stop_market, trade.first)
            exit_reason = "hardStop"
            break
        if target_touched:
            target_second = second
            exit_second = second
            exit_market = entry_market + gap if direction == "positiveT" else entry_market - gap
            exit_reason = "target"
            break
        if not risk_managed or not quotes:
            continue
        quote = quotes.get(second)
        if quote is not None:
            latest_quote = quote
            latest_quote_second = second
        trade_flow.append((second, trade.buy_volume, trade.sell_volume))
        while trade_flow and trade_flow[0][0] < second - 4:
            trade_flow.popleft()
        price_history[second] = trade.last
        if latest_quote is None or latest_quote_second is None or second - latest_quote_second > 3:
            opposing_seconds = 0
            continue
        opposing_votes, adverse_distance = exit_pressure(
            candidate, entry_market, trade.last, trade_flow, latest_quote
        )
        consecutive = last_pressure_second is None or second == last_pressure_second + 1
        opposing_seconds = opposing_seconds + 1 if opposing_votes >= 3 and consecutive else (
            1 if opposing_votes >= 3 else 0
        )
        last_pressure_second = second
        if exit_model in {"v22", "v23", "v24", "v26"}:
            current_ratio = active_buy_ratio(trade_flow)
            if current_ratio is not None:
                active_buy_history.append((second, current_ratio))
            while active_buy_history and active_buy_history[0][0] < second - V22_FLOW_WINDOW_SECONDS:
                active_buy_history.popleft()
            prior_ratio = active_buy_history[0][1] if len(active_buy_history) >= 2 else None
            previous_price = price_history.get(second - 1)
            confirmation = v22_exit_confirmation(
                direction, entry_market, trade.last, previous_price,
                current_ratio, prior_ratio, opposing_votes,
            )
            if opposing_seconds >= V22_WARNING_OPPOSING_SECONDS and warning_second is None:
                warning_second = second
            if opposing_votes < 3:
                warning_second = None
            exit_is_confirmed = (
                opposing_seconds >= V22_CONFIRM_OPPOSING_SECONDS[direction]
                and adverse_distance >= max(
                    0.01, gap * V22_ADVERSE_TARGET_FRACTION[direction]
                )
                and confirmation["confirmed"]
            )
            if exit_model in {"v24", "v26"} and direction == "positiveT":
                if recovery_watch_second is None:
                    if exit_is_confirmed:
                        recovery_watch_second = second
                        recovery_release_seconds = 0
                else:
                    recovered_price = (
                        adverse_distance
                        <= gap * V24_RECOVERED_ADVERSE_TARGET_FRACTION
                    )
                    recovery_release_seconds = (
                        recovery_release_seconds + 1
                        if opposing_votes < 3 and consecutive
                        else (1 if opposing_votes < 3 else 0)
                    )
                    if (recovered_price
                            or recovery_release_seconds >= V24_RELEASE_CONSECUTIVE_SECONDS):
                        recovery_watch_second = None
                        recovery_release_seconds = 0
                        opposing_seconds = 0
                    elif (second - recovery_watch_second
                          >= V24_RECOVERY_OBSERVATION_SECONDS
                          and adverse_distance >= max(
                              0.01, gap * V24_EXIT_ADVERSE_TARGET_FRACTION
                          )
                          and confirmation["confirmed"]):
                        pending_exit = True
                        exit_decision_second = second
                        exit_confirmation = {
                            **confirmation,
                            "recoveryWatchSecond": recovery_watch_second,
                            "recoveryObservationSeconds": second - recovery_watch_second,
                            "recoveryReleaseSeconds": recovery_release_seconds,
                        }
            elif exit_is_confirmed:
                pending_exit = True
                exit_decision_second = second
                exit_confirmation = confirmation
        elif (opposing_seconds >= EXIT_OPPOSING_SECONDS
              and adverse_distance >= max(0.01, gap * EXIT_ADVERSE_TARGET_FRACTION)):
            pending_exit = True
            exit_decision_second = second
    if exit_second is None:
        exit_second = trade_seconds[horizon_index]
        exit_market = trades[exit_second].first
        exit_reason = "time"
    net_pnl, gross_pnl, fees = SECOND.pnl(direction, entry_market, exit_market)
    exit_audit = (post_exit_audit(
        direction, entry_market, gap, exit_second, trade_seconds[horizon_index], trades
    ) if exit_reason in {"l2PriceInvalidation", "hardStop"} else None)
    return {
        "status": "closed",
        "entrySecond": entry_second,
        "entryMarketPrice": entry_market,
        "exitSecond": exit_second,
        "exitMarketPrice": exit_market,
        "exitReason": exit_reason,
        "exitDecisionSecond": exit_decision_second,
        "warningSecond": warning_second,
        "recoveryWatchSecond": recovery_watch_second,
        "exitConfirmation": exit_confirmation,
        "postExitAudit": exit_audit,
        "targetGap": gap,
        "targetReached": target_second is not None,
        "stopGap": stop_gap if risk_managed else None,
        "stopContext": stop_context if risk_managed else None,
        "exitModel": (f"risk-managed-{exit_model}-{stop_model}" if risk_managed
                      else "time-exit-baseline"),
        "horizonSeconds": horizon,
        "quantity": SECOND.QUANTITY,
        "slippagePerSideBps": SECOND.SLIPPAGE_RATE * 10_000,
        "grossPnl": gross_pnl,
        "fees": fees,
        "netPnl": net_pnl,
        "win": net_pnl > 0,
    }


def maximum_drawdown(values: Iterable[float]) -> float:
    equity = 0.0
    peak = 0.0
    drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def metric(rows: list[dict[str, Any]], direction: str | None = None) -> dict[str, Any]:
    selected = [row for row in rows if direction is None or row["candidate"]["direction"] == direction]
    trades = [row["simulation"] for row in selected if row.get("executed") and row.get("simulation")]
    pnl_values = [trade["netPnl"] for trade in trades]
    gains = sum(value for value in pnl_values if value > 0)
    losses = abs(sum(value for value in pnl_values if value < 0))
    winners = [value for value in pnl_values if value > 0]
    losers = [value for value in pnl_values if value <= 0]
    exit_reasons = {
        reason: sum(trade.get("exitReason") == reason for trade in trades)
        for reason in ("target", "hardStop", "l2PriceInvalidation", "time")
        if any(trade.get("exitReason") == reason for trade in trades)
    }
    audited_exits = [trade["postExitAudit"] for trade in trades
                     if trade.get("postExitAudit") is not None]
    recovered_exits = [audit for audit in audited_exits if audit["targetRecoveredAfterExit"]]
    return {
        "candidates": len(selected),
        "confirmed": sum(row["l2Decision"]["status"] == "confirmed" for row in selected),
        "rejected": sum(row["l2Decision"]["status"] == "rejected" for row in selected),
        "neutral": sum(row["l2Decision"]["status"] == "neutral" for row in selected),
        "executed": len(trades),
        "candidateUpgradeRate": len(trades) / len(selected) if selected else None,
        "closedTrades": len(trades),
        "completionRate": sum(trade["status"] == "closed" for trade in trades) / len(trades) if trades else None,
        "targetHitRate": sum(trade["targetReached"] for trade in trades) / len(trades) if trades else None,
        "winRate": sum(value > 0 for value in pnl_values) / len(pnl_values) if pnl_values else None,
        "averageNetPnl": statistics.mean(pnl_values) if pnl_values else None,
        "averageWinner": statistics.mean(winners) if winners else None,
        "averageLoser": statistics.mean(losers) if losers else None,
        "netPnl": sum(pnl_values),
        "fees": sum(trade["fees"] for trade in trades),
        "profitFactor": gains / losses if losses > 0 else None,
        "maximumDrawdown": maximum_drawdown(pnl_values),
        "exitReasons": exit_reasons,
        "postExitAudit": {
            "auditedEarlyExits": len(audited_exits),
            "targetRecoveredAfterExit": len(recovered_exits),
            "targetRecoveryRate": (len(recovered_exits) / len(audited_exits)
                                   if audited_exits else None),
            "averageSecondsUntilRecovery": (statistics.mean(
                audit["secondsUntilTargetRecovery"] for audit in recovered_exits
            ) if recovered_exits else None),
            "averagePostExitFavorableExcursion": (statistics.mean(
                audit["maximumFavorableExcursion"] for audit in audited_exits
            ) if audited_exits else None),
            "averagePostExitAdverseExcursion": (statistics.mean(
                audit["maximumAdverseExcursion"] for audit in audited_exits
            ) if audited_exits else None),
        },
    }


def loss_attribution(rows: list[dict[str, Any]]) -> dict[str, Any]:
    trades = [row["simulation"] for row in rows if row.get("executed") and row.get("simulation")]
    losses = [trade for trade in trades if trade["netPnl"] <= 0]
    gross_loss = abs(sum(trade["netPnl"] for trade in losses))

    def grouped(field: str) -> dict[str, Any]:
        values = {}
        for row in rows:
            trade = row.get("simulation")
            if not row.get("executed") or not trade or trade["netPnl"] > 0:
                continue
            key = row["candidate"]["direction"] if field == "direction" else trade["exitReason"]
            group = values.setdefault(key, {"losses": 0, "netPnl": 0.0, "worstLoss": None})
            group["losses"] += 1
            group["netPnl"] += trade["netPnl"]
            group["worstLoss"] = (trade["netPnl"] if group["worstLoss"] is None
                                  else min(group["worstLoss"], trade["netPnl"]))
        return values

    tail_losses = [trade for trade in losses if trade["netPnl"] <= -200]
    return {
        "losses": len(losses),
        "grossLoss": gross_loss,
        "worstLoss": min((trade["netPnl"] for trade in losses), default=None),
        "tailLossThreshold": -200,
        "tailLosses": len(tail_losses),
        "tailLossShare": (abs(sum(trade["netPnl"] for trade in tail_losses)) / gross_loss
                          if gross_loss else None),
        "byDirection": grouped("direction"),
        "byExitReason": grouped("exitReason"),
    }


def filtered_counterfactual(rows: list[dict[str, Any]]) -> dict[str, Any]:
    filtered = [
        row for row in rows
        if row.get("counterfactualSimulation")
        and row.get("entryGate")
        and not row["entryGate"]["passed"]
    ]
    trades = [row["counterfactualSimulation"] for row in filtered]
    return {
        "filteredSignals": len(filtered),
        "counterfactualClosedTrades": len(trades),
        "counterfactualWins": sum(trade["netPnl"] > 0 for trade in trades),
        "counterfactualNetPnl": sum(trade["netPnl"] for trade in trades),
        "counterfactualGrossLossAvoided": abs(sum(
            trade["netPnl"] for trade in trades if trade["netPnl"] <= 0
        )),
    }


def split_dates(dates: list[str]) -> dict[str, set[str]]:
    train_end = max(1, int(len(dates) * 0.6))
    validation_end = max(train_end + 1, int(len(dates) * 0.8)) if len(dates) > 2 else len(dates)
    return {
        "train": set(dates[:train_end]),
        "validation": set(dates[train_end:validation_end]),
        "test": set(dates[validation_end:]),
    }


def summarize(rows: list[dict[str, Any]], dates: list[str]) -> dict[str, Any]:
    output = {
        "all": {
            "combined": metric(rows),
            "positiveT": metric(rows, "positiveT"),
            "reverseT": metric(rows, "reverseT"),
        },
        "splits": {},
    }
    for split_name, split in split_dates(dates).items():
        selected = [row for row in rows if row["candidate"]["date"] in split]
        output["splits"][split_name] = {
            "combined": metric(selected),
            "positiveT": metric(selected, "positiveT"),
            "reverseT": metric(selected, "reverseT"),
        }
    return output


def promotion_evaluation(summary: dict[str, Any]) -> dict[str, Any]:
    full = summary["all"]["combined"]
    test = summary["splits"]["test"]["combined"]
    out_of_sample_profit_factor_passed = (
        test["profitFactor"] is not None
        and test["profitFactor"] >= PROMOTION_THRESHOLDS["minimumOutOfSampleProfitFactor"]
    ) or (
        test["closedTrades"] > 0
        and test["profitFactor"] is None
        and test["netPnl"] > 0
    )
    checks = {
        "closedTrades": full["closedTrades"] >= PROMOTION_THRESHOLDS["minimumClosedTrades"],
        "outOfSampleWinRate": test["winRate"] is not None
            and test["winRate"] >= PROMOTION_THRESHOLDS["minimumOutOfSampleWinRate"],
        "outOfSampleProfitFactor": out_of_sample_profit_factor_passed,
        "outOfSampleNetPnl": test["netPnl"] > PROMOTION_THRESHOLDS["minimumOutOfSampleNetPnl"],
    }
    return {
        "thresholds": PROMOTION_THRESHOLDS,
        "checks": checks,
        "eligibleForHumanReview": all(checks.values()),
        "automaticPromotion": False,
        "decision": "eligible-for-human-review" if all(checks.values()) else "keep-shadow",
    }


def git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> str:
    hasher = hashlib.sha256()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as target:
        for row in rows:
            encoded = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            target.write(encoded + "\n")
            hasher.update((encoded + "\n").encode("utf-8"))
    return hasher.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--minute-data", type=Path, default=DEFAULT_MINUTE_DATA)
    parser.add_argument("--candidates", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--ledger-output", type=Path)
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    archives = [item for item in manifest["selectedArchives"]
                if (not args.start or item["date"] >= args.start.replace("-", ""))
                and (not args.end or item["date"] <= args.end.replace("-", ""))]
    if args.limit > 0:
        archives = archives[:args.limit]
    if not archives:
        raise SystemExit("No matching Zijin L2 archives")
    allowed_dates = {str(item["date"]) for item in archives}
    candidates = (load_external_candidates(args.candidates) if args.candidates
                  else opening_candidates(args.minute_data, allowed_dates))
    candidates = [candidate for candidate in candidates if candidate["date"] in allowed_dates]
    atr_by_date = prior_atr_by_date(args.minute_data, allowed_dates)
    candidates_by_date: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        candidates_by_date.setdefault(candidate["date"], []).append(candidate)

    cohort_rows = {name: [] for name in COHORTS}
    risk_managed_rows = {name: [] for name in COHORTS}
    v23_risk_managed_rows = {name: [] for name in COHORTS}
    v24_risk_managed_rows = {name: [] for name in COHORTS}
    v25_risk_managed_rows = {name: [] for name in COHORTS}
    v26_risk_managed_rows = {name: [] for name in COHORTS}
    v21_risk_managed_rows = {name: [] for name in COHORTS}
    tight_stop_rows = {name: [] for name in COHORTS}
    ledger: list[dict[str, Any]] = []
    processed_dates: list[str] = []
    source_hash = hashlib.sha256()
    quality = {"rawTradeRows": 0, "rawQuoteRows": 0, "candidateDays": 0}
    for index, archive in enumerate(archives, start=1):
        date = str(archive["date"])
        source_hash.update(f"{date}:{archive.get('sha256', '')}\n".encode())
        day_candidates = candidates_by_date.get(date, [])
        if not day_candidates:
            processed_dates.append(date)
            continue
        trades, quotes, day_quality = SECOND.read_archive(Path(archive["path"]))
        quality["rawTradeRows"] += day_quality["rawTradeRows"]
        quality["rawQuoteRows"] += day_quality["rawQuoteRows"]
        quality["candidateDays"] += 1
        for candidate in day_candidates:
            l2 = classify_l2(candidate, trades, quotes)
            v25_gate = v25_entry_gate(candidate, l2)
            v26_gate = v26_entry_gate(candidate, l2, atr_by_date.get(date))
            sample = {
                "schemaVersion": 1,
                "researchOnly": True,
                "symbol": "601899.SH",
                "engineVersion": ENGINE_VERSION,
                "candidate": candidate,
                "l2Decision": l2,
                "cohorts": {},
            }
            for cohort in COHORTS:
                execute, decision_second, reason = cohort_decision(
                    cohort, l2["status"], candidate["second"], l2["decisionSecond"]
                )
                simulation = simulate_round_trip(candidate, decision_second, trades) if execute else None
                v21_risk_managed_simulation = simulate_round_trip(
                    candidate,
                    decision_second,
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                ) if execute else None
                risk_managed_simulation = simulate_round_trip(
                    candidate,
                    decision_second,
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                    exit_model="v22",
                ) if execute else None
                v23_risk_managed_simulation = simulate_round_trip(
                    candidate,
                    decision_second,
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                    exit_model="v23",
                ) if execute else None
                v24_risk_managed_simulation = simulate_round_trip(
                    candidate,
                    decision_second,
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                    exit_model="v24",
                ) if execute else None
                v25_risk_managed_simulation = (
                    simulate_round_trip(
                        candidate,
                        decision_second,
                        trades,
                        quotes,
                        atr_by_date.get(date),
                        risk_managed=True,
                        exit_model="v24",
                    )
                    if execute and v25_gate["passed"] else None
                )
                v26_counterfactual_simulation = (
                    simulate_round_trip(
                        candidate,
                        decision_second,
                        trades,
                        quotes,
                        atr_by_date.get(date),
                        risk_managed=True,
                        exit_model="v26",
                    )
                    if execute and v25_gate["passed"] else None
                )
                v26_risk_managed_simulation = (
                    v26_counterfactual_simulation if v26_gate["passed"] else None
                )
                tight_stop_simulation = simulate_round_trip(
                    candidate,
                    decision_second,
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                    stop_model="tight",
                ) if execute else None
                row = {
                    "candidate": candidate,
                    "l2Decision": l2,
                    "cohort": cohort,
                    "executed": bool(simulation),
                    "decisionSecond": decision_second,
                    "decisionReason": reason if simulation or not execute else "no later trade available",
                    "simulation": simulation,
                }
                cohort_rows[cohort].append(row)
                v21_risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(v21_risk_managed_simulation),
                    "simulation": v21_risk_managed_simulation,
                })
                risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(risk_managed_simulation),
                    "simulation": risk_managed_simulation,
                })
                v23_risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(v23_risk_managed_simulation),
                    "simulation": v23_risk_managed_simulation,
                })
                v24_risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(v24_risk_managed_simulation),
                    "simulation": v24_risk_managed_simulation,
                })
                v25_risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(v25_risk_managed_simulation),
                    "simulation": v25_risk_managed_simulation,
                    "entryGate": v25_gate,
                    "counterfactualSimulation": v24_risk_managed_simulation,
                })
                v26_risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(v26_risk_managed_simulation),
                    "simulation": v26_risk_managed_simulation,
                    "entryGate": v26_gate,
                    "counterfactualSimulation": v26_counterfactual_simulation,
                })
                tight_stop_rows[cohort].append({
                    **row,
                    "executed": bool(tight_stop_simulation),
                    "simulation": tight_stop_simulation,
                })
                sample["cohorts"][cohort] = {
                    "executed": row["executed"],
                    "decisionSecond": decision_second,
                    "decisionReason": row["decisionReason"],
                    "simulation": simulation,
                    "v21RiskManagedSimulation": v21_risk_managed_simulation,
                    "riskManagedSimulation": risk_managed_simulation,
                    "v23RiskManagedSimulation": v23_risk_managed_simulation,
                    "v24RiskManagedSimulation": v24_risk_managed_simulation,
                    "v25EntryGate": v25_gate,
                    "v25RiskManagedSimulation": v25_risk_managed_simulation,
                    "v26EntryGate": v26_gate,
                    "v26RiskManagedSimulation": v26_risk_managed_simulation,
                    "v26CounterfactualSimulation": v26_counterfactual_simulation,
                    "tightStopSimulation": tight_stop_simulation,
                }
            ledger.append(sample)
        processed_dates.append(date)
        if index % 20 == 0 or index == len(archives):
            print(f"processed {index}/{len(archives)} sessions", flush=True)

    dates = sorted(set(processed_dates))
    baseline_summaries = {cohort: summarize(rows, dates) for cohort, rows in cohort_rows.items()}
    tight_stop_summaries = {cohort: summarize(rows, dates) for cohort, rows in tight_stop_rows.items()}
    v21_summaries = {cohort: summarize(rows, dates) for cohort, rows in v21_risk_managed_rows.items()}
    summaries = {cohort: summarize(rows, dates) for cohort, rows in risk_managed_rows.items()}
    v23_summaries = {cohort: summarize(rows, dates) for cohort, rows in v23_risk_managed_rows.items()}
    v24_summaries = {cohort: summarize(rows, dates) for cohort, rows in v24_risk_managed_rows.items()}
    v25_summaries = {cohort: summarize(rows, dates) for cohort, rows in v25_risk_managed_rows.items()}
    v26_summaries = {cohort: summarize(rows, dates) for cohort, rows in v26_risk_managed_rows.items()}
    promotion = promotion_evaluation(v26_summaries["l2ConfirmAndVeto"])
    primary_v25_rows = v25_risk_managed_rows["l2ConfirmAndVeto"]
    date_splits = split_dates(dates)
    v25_audit = {
        "all": {
            "lossAttribution": loss_attribution(primary_v25_rows),
            "filteredCounterfactual": filtered_counterfactual(primary_v25_rows),
        },
        "splits": {
            name: {
                "lossAttribution": loss_attribution([
                    row for row in primary_v25_rows if row["candidate"]["date"] in split
                ]),
                "filteredCounterfactual": filtered_counterfactual([
                    row for row in primary_v25_rows if row["candidate"]["date"] in split
                ]),
            }
            for name, split in date_splits.items()
        },
    }
    primary_v26_rows = v26_risk_managed_rows["l2ConfirmAndVeto"]
    v26_audit = {
        "dataAvailability": {
            "marketRegime": "optional-candidate-field; unavailable in the current opening dataset",
            "sectorRegime": "optional-candidate-field; unavailable in the current opening dataset",
            "atr14": "available from completed sessions only",
            "l2": "available from event time through decision time only",
        },
        "all": {
            "lossAttribution": loss_attribution(primary_v26_rows),
            "filteredCounterfactual": filtered_counterfactual(primary_v26_rows),
        },
        "splits": {
            name: {
                "lossAttribution": loss_attribution([
                    row for row in primary_v26_rows if row["candidate"]["date"] in split
                ]),
                "filteredCounterfactual": filtered_counterfactual([
                    row for row in primary_v26_rows if row["candidate"]["date"] in split
                ]),
            }
            for name, split in date_splits.items()
        },
    }
    ledger_path = args.ledger_output or args.output.with_name(args.output.stem + "-samples.jsonl")
    ledger_checksum = write_jsonl(ledger_path, ledger)
    config = {
        "confirmationWindowSeconds": CONFIRMATION_WINDOW_SECONDS,
        "openingGapThresholdPct": OPENING_GAP_THRESHOLD_PCT,
        "horizonSecondsByDirection": HORIZON_SECONDS,
        "exitModels": {
            "timeExitBaseline": "target or direction-specific fixed horizon; no stop loss",
            "tightStopCounterexample": "target or net loss budget capped stop; retained as a failed-control cohort",
            "riskManagedV21": "target, three-second L2/price invalidation, entry-frozen ATR emergency stop, or horizon",
            "riskManagedV22": "three-second warning; sustained direction-specific L2, OFI and adverse-price confirmation before exit",
            "riskManagedV23": "positive-T delayed tail-loss cap; reverse-T delegates to V2.2",
            "riskManagedV24": "positive-T V2.2 confirmation enters a recovery watch before sustained deterioration exits; reverse-T delegates to V2.2",
            "riskManagedV25": "V2.4 exits plus direction-specific entry-quality gates frozen on train and validation data",
            "riskManagedV26": "V2.5 exits plus positive-T regime and price-flow entry vetoes; no broad early-exit override",
        },
        "atrPeriod": ATR_PERIOD,
        "atrStopFraction": ATR_STOP_FRACTION,
        "maximumLossToTargetProfitByDirection": STOP_LOSS_MULTIPLE,
        "exitOpposingSeconds": EXIT_OPPOSING_SECONDS,
        "exitAdverseTargetFraction": EXIT_ADVERSE_TARGET_FRACTION,
        "v22WarningOpposingSeconds": V22_WARNING_OPPOSING_SECONDS,
        "v22ConfirmOpposingSecondsByDirection": V22_CONFIRM_OPPOSING_SECONDS,
        "v22AdverseTargetFractionByDirection": V22_ADVERSE_TARGET_FRACTION,
        "v22FlowWindowSeconds": V22_FLOW_WINDOW_SECONDS,
        "v22MinimumOfiDeterioration": V22_MIN_OFI_DETERIORATION,
        "v22MinimumAdverseResponseBps": V22_MIN_ADVERSE_RESPONSE_BPS,
        "v22MinimumAdverseAccelerationBps": V22_MIN_ADVERSE_ACCELERATION_BPS,
        "v23PositiveGraceSeconds": V23_POSITIVE_GRACE_SECONDS,
        "v23PositiveTargetMultiple": V23_POSITIVE_TARGET_MULTIPLE,
        "v24RecoveryObservationSeconds": V24_RECOVERY_OBSERVATION_SECONDS,
        "v24ExitAdverseTargetFraction": V24_EXIT_ADVERSE_TARGET_FRACTION,
        "v24ReleaseConsecutiveSeconds": V24_RELEASE_CONSECUTIVE_SECONDS,
        "v24RecoveredAdverseTargetFraction": V24_RECOVERED_ADVERSE_TARGET_FRACTION,
        "v25PositiveMinimumActiveBuyRatio": V25_POSITIVE_MIN_ACTIVE_BUY_RATIO,
        "v25ReverseMaximumPriceResponseBps": V25_REVERSE_MAX_PRICE_RESPONSE_BPS,
        "v26PositiveMinimumPriceResponseBps": V26_POSITIVE_MIN_PRICE_RESPONSE_BPS,
        "v26PositiveFlowCollapseDrop": V26_POSITIVE_FLOW_COLLAPSE_DROP,
        "v26PositiveFlowCollapseMaximumRatio": V26_POSITIVE_FLOW_COLLAPSE_MAX_RATIO,
        "emergencyAtrFraction": EMERGENCY_ATR_FRACTION,
        "emergencyTargetMultipleMin": EMERGENCY_TARGET_MULTIPLE_MIN,
        "emergencyTargetMultipleMax": EMERGENCY_TARGET_MULTIPLE_MAX,
        "cohorts": COHORTS,
        "promotionThresholds": PROMOTION_THRESHOLDS,
        "quantity": SECOND.QUANTITY,
        "commissionRate": SECOND.COMMISSION_RATE,
        "minimumCommission": SECOND.MIN_COMMISSION,
        "stampDutyRate": SECOND.STAMP_DUTY_RATE,
        "slippagePerSideBps": SECOND.SLIPPAGE_RATE * 10_000,
    }
    report = {
        "mode": "zijin-minute-candidate-second-level-l2-overlay",
        "researchOnly": True,
        "affectsSmartT": False,
        "affectsShadowV2": False,
        "automaticDeployment": False,
        "engineVersion": ENGINE_VERSION,
        "symbol": "601899.SH",
        "candidateSource": str(args.candidates or args.minute_data),
        "dataset": {
            "manifest": str(args.manifest),
            "datasetId": manifest.get("datasetId"),
            "manifestChecksum": manifest.get("datasetChecksum"),
            "selectedSourceChecksum": source_hash.hexdigest(),
            "sessions": len(dates),
            "firstDate": dates[0] if dates else None,
            "lastDate": dates[-1] if dates else None,
        },
        "reproducibility": {
            "configHash": stable_hash(config),
            "candidateChecksum": stable_hash(candidates),
            "ledger": str(ledger_path),
            "ledgerChecksum": ledger_checksum,
            "gitCommit": git_commit(),
        },
        "antiLeakage": {
            "minuteCandidateDoesNotUseL2": True,
            "openingFallbackReadsOnlyOpeningPriceAndPreviousClose": True,
            "l2ReadsCandidateSecondThroughDecisionSecondOnly": True,
            "entryUsesFirstTradeStrictlyAfterDecision": True,
            "chronologicalTrainValidationTest": True,
        },
        "config": config,
        "quality": {**quality, "candidateCount": len(candidates), "ledgerSamples": len(ledger)},
        "results": summaries,
        "v22RiskManagedResults": summaries,
        "v23RiskManagedResults": v23_summaries,
        "v24RiskManagedResults": v24_summaries,
        "v25RiskManagedResults": v25_summaries,
        "v25Audit": v25_audit,
        "v26RiskManagedResults": v26_summaries,
        "v26Audit": v26_audit,
        "v21RiskManagedResults": v21_summaries,
        "tightStopCounterexampleResults": tight_stop_summaries,
        "baselineResults": baseline_summaries,
        "promotion": promotion,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "ledger": str(ledger_path),
        "dataset": report["dataset"],
        "quality": report["quality"],
        "all": {cohort: summary["all"] for cohort, summary in summaries.items()},
        "v23RiskManagedAll": {cohort: summary["all"] for cohort, summary in v23_summaries.items()},
        "v24RiskManagedAll": {cohort: summary["all"] for cohort, summary in v24_summaries.items()},
        "v25RiskManagedAll": {cohort: summary["all"] for cohort, summary in v25_summaries.items()},
        "v26RiskManagedAll": {cohort: summary["all"] for cohort, summary in v26_summaries.items()},
        "v21RiskManagedAll": {cohort: summary["all"] for cohort, summary in v21_summaries.items()},
        "tightStopCounterexampleAll": {
            cohort: summary["all"] for cohort, summary in tight_stop_summaries.items()
        },
        "baselineAll": {cohort: summary["all"] for cohort, summary in baseline_summaries.items()},
        "promotion": promotion,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
