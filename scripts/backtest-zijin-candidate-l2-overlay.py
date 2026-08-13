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
DEFAULT_OUTPUT = Path(r"E:\zijin-l2\research-results\zijin-candidate-l2-overlay-v1.json")
ENGINE_VERSION = "1.0.0"
CONFIRMATION_WINDOW_SECONDS = 10
OPENING_GAP_THRESHOLD_PCT = 0.50
HORIZON_SECONDS = {"positiveT": 45 * 60, "reverseT": 50 * 60}
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


def simulate_round_trip(candidate: dict[str, Any], decision_second: int,
                        trades: dict[int, Any]) -> dict[str, Any] | None:
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
    target_second = None
    target_market = None
    for index in range(entry_index + 1, horizon_index + 1):
        second = trade_seconds[index]
        trade = trades[second]
        if direction == "positiveT" and trade.high >= entry_market + gap:
            target_second, target_market = second, entry_market + gap
            break
        if direction == "reverseT" and trade.low <= entry_market - gap:
            target_second, target_market = second, entry_market - gap
            break
    exit_second = target_second if target_second is not None else trade_seconds[horizon_index]
    exit_market = target_market if target_market is not None else trades[exit_second].first
    net_pnl, gross_pnl, fees = SECOND.pnl(direction, entry_market, exit_market)
    return {
        "status": "closed",
        "entrySecond": entry_second,
        "entryMarketPrice": entry_market,
        "exitSecond": exit_second,
        "exitMarketPrice": exit_market,
        "exitReason": "target" if target_second is not None else "time",
        "targetGap": gap,
        "targetReached": target_second is not None,
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
        "netPnl": sum(pnl_values),
        "fees": sum(trade["fees"] for trade in trades),
        "profitFactor": gains / losses if losses > 0 else None,
        "maximumDrawdown": maximum_drawdown(pnl_values),
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
    checks = {
        "closedTrades": full["closedTrades"] >= PROMOTION_THRESHOLDS["minimumClosedTrades"],
        "outOfSampleWinRate": test["winRate"] is not None
            and test["winRate"] >= PROMOTION_THRESHOLDS["minimumOutOfSampleWinRate"],
        "outOfSampleProfitFactor": test["profitFactor"] is not None
            and test["profitFactor"] >= PROMOTION_THRESHOLDS["minimumOutOfSampleProfitFactor"],
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
    candidates_by_date: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        candidates_by_date.setdefault(candidate["date"], []).append(candidate)

    cohort_rows = {name: [] for name in COHORTS}
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
                sample["cohorts"][cohort] = {
                    "executed": row["executed"],
                    "decisionSecond": decision_second,
                    "decisionReason": row["decisionReason"],
                    "simulation": simulation,
                }
            ledger.append(sample)
        processed_dates.append(date)
        if index % 20 == 0 or index == len(archives):
            print(f"processed {index}/{len(archives)} sessions", flush=True)

    dates = sorted(set(processed_dates))
    summaries = {cohort: summarize(rows, dates) for cohort, rows in cohort_rows.items()}
    promotion = promotion_evaluation(summaries["l2ConfirmAndVeto"])
    ledger_path = args.ledger_output or args.output.with_name(args.output.stem + "-samples.jsonl")
    ledger_checksum = write_jsonl(ledger_path, ledger)
    config = {
        "confirmationWindowSeconds": CONFIRMATION_WINDOW_SECONDS,
        "openingGapThresholdPct": OPENING_GAP_THRESHOLD_PCT,
        "horizonSecondsByDirection": HORIZON_SECONDS,
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
        "promotion": promotion,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
