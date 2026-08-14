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
import math
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
DEFAULT_OUTPUT = Path(r"E:\zijin-l2\research-results\zijin-candidate-l2-overlay-v2-8.json")
ENGINE_VERSION = "2.8.0"
CONFIRMATION_WINDOW_SECONDS = 10
V28_DELAYED_CONFIRMATION_SECONDS = 20
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
V27_CALIBRATION_MIN_SAMPLES = 8
V27_PROBABILITY_PRIOR = 0.50
V27_PRIOR_STRENGTH = 4.0
V27_MIN_TARGET_FIRST_PROBABILITY = 0.62
V27_MIN_TARGET_FIRST_LOWER_BOUND = 0.52
V27_MIN_L2_ALIGNED_SECONDS = 3
V27_SHORT_REBOUND_SECONDS = 60
V27_TARGET_FIRST_SECONDS = 15 * 60
V27_SHORT_REBOUND_TARGET_FRACTION = 0.25
V27_EXIT_MAX_TARGET_FIRST_PROBABILITY = 0.40
V27_EXIT_LOW_CONFIDENCE_SECONDS = 6
V28_INTRADAY_START = 9 * 3_600 + 45 * 60
V28_INTRADAY_END = 14 * 3_600 + 15 * 60
V28_INTRADAY_MIN_VWAP_DEVIATION_PCT = -0.35
V28_INTRADAY_MIN_PULLBACK_PCT = -0.70
V28_INTRADAY_MAX_VOLUME_RATIO = 1.00
V28_INTRADAY_MIN_BAR_RECOVERY = 0.50
V28_BULLISH_REGIMES = {
    "bullish", "uptrend", "risk-on", "riskon", "strong", "rising",
    "多头", "上涨", "强势", "风险偏好",
}
EMERGENCY_ATR_FRACTION = 0.15
EMERGENCY_TARGET_MULTIPLE_MIN = 1.50
EMERGENCY_TARGET_MULTIPLE_MAX = 2.50
PROMOTION_THRESHOLDS = {
    "minimumClosedTrades": 100,
    "minimumOutOfSampleClosedTrades": 20,
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


def v28_intraday_pullback_candidates(path: Path,
                                     allowed_dates: set[str]) -> list[dict[str, Any]]:
    """Create at most one positive-T pullback candidate per completed session minute."""
    output: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            day = json.loads(line)
            date = str(day.get("date") or "").replace("-", "")
            if date not in allowed_dates:
                continue
            previous_close = finite_float(day.get("previousClose"))
            minutes = day.get("minutes") if isinstance(day.get("minutes"), list) else []
            cumulative_volume = 0.0
            cumulative_amount = 0.0
            for index, minute in enumerate(minutes):
                volume = finite_float(minute.get("volume")) or 0.0
                amount = finite_float(minute.get("amount")) or 0.0
                cumulative_volume += volume
                cumulative_amount += amount
                if index < 15 or cumulative_volume <= 0 or previous_close is None:
                    continue
                minute_second = parse_clock(minute.get("time"))
                if (minute_second is None or minute_second < V28_INTRADAY_START
                        or minute_second > V28_INTRADAY_END):
                    continue
                close = finite_float(minute.get("close"))
                low = finite_float(minute.get("low"))
                high = finite_float(minute.get("high"))
                if not close or low is None or high is None or close >= previous_close * 0.995:
                    continue
                prior_close = finite_float(minutes[index - 1].get("close"))
                earlier_close = finite_float(minutes[index - 2].get("close"))
                if prior_close is None or earlier_close is None:
                    continue
                bar_recovery = ((close - low) / (high - low) if high > low else 0.50)
                if (bar_recovery < V28_INTRADAY_MIN_BAR_RECOVERY
                        or close <= prior_close or prior_close > earlier_close):
                    continue
                prior_volumes = [
                    finite_float(row.get("volume")) or 0.0
                    for row in minutes[index - 5:index]
                ]
                average_volume = statistics.mean(prior_volumes) if prior_volumes else 0.0
                volume_ratio = volume / average_volume if average_volume > 0 else None
                if volume_ratio is None or volume_ratio > V28_INTRADAY_MAX_VOLUME_RATIO:
                    continue
                vwap = cumulative_amount / cumulative_volume
                rolling_high = max(
                    finite_float(row.get("high")) or 0.0
                    for row in minutes[max(0, index - 14):index + 1]
                )
                if vwap <= 0 or rolling_high <= 0:
                    continue
                vwap_deviation = (close / vwap - 1) * 100
                pullback = (close / rolling_high - 1) * 100
                if (vwap_deviation > V28_INTRADAY_MIN_VWAP_DEVIATION_PCT
                        or pullback > V28_INTRADAY_MIN_PULLBACK_PCT):
                    continue
                decision_second = minute_second + 60
                identity = {
                    "date": date,
                    "second": decision_second,
                    "direction": "positiveT",
                    "source": f"{path.name}:{line_number}:minute:{minute.get('time')}",
                    "factorCombinationId": "v28-intraday-pullback-v1",
                }
                output.append({
                    "candidateId": stable_hash(identity)[:20],
                    **identity,
                    "candidateScore": min(100, round(
                        62 + abs(vwap_deviation) * 8 + abs(pullback) * 5
                        + bar_recovery * 8, 2
                    )),
                    "candidatePrice": close,
                    "factors": {
                        "candidateKind": "intraday-pullback",
                        "asOfMinute": minute.get("time"),
                        "previousClose": previous_close,
                        "vwap": round(vwap, 6),
                        "vwapDeviationPct": round(vwap_deviation, 6),
                        "rollingHigh15": rolling_high,
                        "pullbackFromRollingHighPct": round(pullback, 6),
                        "volumeRatio5": round(volume_ratio, 6),
                        "barRecoveryRatio": round(bar_recovery, 6),
                        "usesCompletedMinuteAndPriorMinutesOnly": True,
                    },
                })
                break
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


def v28_delayed_l2_decision(candidate: dict[str, Any], initial: dict[str, Any],
                            trades: dict[int, Any], quotes: dict[int, Any],
                            delayed_seconds: int = V28_DELAYED_CONFIRMATION_SECONDS
                            ) -> dict[str, Any]:
    """Recheck only neutral candidates in a later causal window."""
    if initial.get("status") != "neutral":
        return {
            **initial,
            "initialStatus": initial.get("status"),
            "initialDecisionSecond": initial.get("decisionSecond"),
            "delayedReview": False,
            "delayedPromotion": False,
        }
    delayed_start = int(initial["decisionSecond"]) + 1
    delayed_candidate = {**candidate, "second": delayed_start}
    delayed = classify_l2(
        delayed_candidate, trades, quotes, window_seconds=delayed_seconds
    )
    combined_evidence = [
        *(initial.get("evidence") or []),
        *(delayed.get("evidence") or []),
    ]
    return {
        **delayed,
        "evidence": combined_evidence,
        "initialStatus": "neutral",
        "initialDecisionSecond": initial["decisionSecond"],
        "delayedReview": True,
        "delayedWindowStartSecond": delayed_start,
        "delayedWindowSeconds": delayed_seconds,
        "delayedPromotion": delayed.get("status") == "confirmed",
        "reason": f"delayed neutral review: {delayed.get('reason')}",
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


V27_FEATURE_SCALES = {
    "activeBuyRatio": 0.25,
    "activeBuyRatioChange": 0.20,
    "depthImbalance": 0.20,
    "micropriceEdgeBps": 5.0,
    "priceResponseBps": 10.0,
    "openingGapPct": 2.0,
    "priorAtrPct": 2.0,
    "candidateScore": 25.0,
}


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def entry_trade_after(trades: dict[int, Any], decision_second: int) -> tuple[int, float] | None:
    seconds = sorted(second for second in trades if SECOND.is_market_second(second))
    index = bisect.bisect_right(seconds, decision_second)
    if index >= len(seconds):
        return None
    second = seconds[index]
    return second, trades[second].first


def v27_entry_features(candidate: dict[str, Any], l2: dict[str, Any],
                       prior_atr: float | None) -> dict[str, float | None]:
    evidence = l2.get("evidence") or []
    first = evidence[0] if evidence else {}
    latest = evidence[-1] if evidence else {}
    factors = candidate.get("factors") if isinstance(candidate.get("factors"), dict) else {}
    first_ratio = finite_float(first.get("activeBuyRatio"))
    latest_ratio = finite_float(latest.get("activeBuyRatio"))
    reference_price = finite_float(candidate.get("candidatePrice") or factors.get("openingPrice"))
    return {
        "activeBuyRatio": latest_ratio,
        "activeBuyRatioChange": (
            latest_ratio - first_ratio
            if latest_ratio is not None and first_ratio is not None else None
        ),
        "depthImbalance": finite_float(latest.get("depthImbalance")),
        "micropriceEdgeBps": finite_float(latest.get("micropriceEdgeBps")),
        "priceResponseBps": finite_float(latest.get("priceResponseBps")),
        "openingGapPct": finite_float(factors.get("openingGapPct")),
        "priorAtrPct": (
            prior_atr / reference_price * 100
            if prior_atr is not None and reference_price and reference_price > 0 else None
        ),
        "candidateScore": finite_float(candidate.get("candidateScore")),
    }


def v27_similarity(left: dict[str, float | None],
                   right: dict[str, float | None]) -> float:
    distances = []
    for key, scale in V27_FEATURE_SCALES.items():
        left_value = left.get(key)
        right_value = right.get(key)
        if left_value is None or right_value is None:
            continue
        distances.append(min(3.0, abs(left_value - right_value) / scale))
    return 1.0 / (1.0 + statistics.mean(distances)) if distances else 0.25


def wilson_lower_bound(successes: int, samples: int, z: float = 1.96) -> float | None:
    if samples <= 0:
        return None
    rate = successes / samples
    denominator = 1 + z * z / samples
    centre = rate + z * z / (2 * samples)
    margin = z * math.sqrt((rate * (1 - rate) + z * z / (4 * samples)) / samples)
    return max(0.0, (centre - margin) / denominator)


def v27_probability_estimate(outcome: str, features: dict[str, float | None],
                             history: list[dict[str, Any]], as_of_date: str) -> dict[str, Any]:
    prior_rows = [
        row for row in history
        if row.get("direction") == "positiveT" and str(row.get("date") or "") < as_of_date
    ]
    weights = [v27_similarity(features, row["features"]) for row in prior_rows]
    weighted_successes = sum(
        weight * float(bool(row["outcomes"].get(outcome)))
        for row, weight in zip(prior_rows, weights)
    )
    effective_samples = sum(weights)
    probability = (
        V27_PROBABILITY_PRIOR * V27_PRIOR_STRENGTH + weighted_successes
    ) / (V27_PRIOR_STRENGTH + effective_samples)
    successes = sum(bool(row["outcomes"].get(outcome)) for row in prior_rows)
    return {
        "probability": probability,
        "lowerBound95": wilson_lower_bound(successes, len(prior_rows)),
        "sampleCount": len(prior_rows),
        "effectiveSampleCount": effective_samples,
        "successes": successes,
        "latestCalibrationDate": max((row["date"] for row in prior_rows), default=None),
        "usesPriorDatesOnly": True,
    }


def v27_l2_aligned_tail(l2: dict[str, Any]) -> int:
    aligned = 0
    previous_second = None
    for evidence in reversed(l2.get("evidence") or []):
        second = evidence.get("second")
        if evidence.get("alignedVotes", 0) < 3:
            break
        if previous_second is not None and second != previous_second - 1:
            break
        aligned += 1
        previous_second = second
    return aligned


def v27_empirical_expected_pnl(features: dict[str, float | None],
                               history: list[dict[str, Any]], as_of_date: str) -> dict[str, Any]:
    prior_rows = [
        row for row in history
        if row.get("direction") == "positiveT" and str(row.get("date") or "") < as_of_date
    ]
    weighted_pnl = 0.0
    effective_samples = 0.0
    for row in prior_rows:
        weight = v27_similarity(features, row["features"])
        weighted_pnl += weight * float(row.get("netPnl") or 0.0)
        effective_samples += weight
    return {
        "netPnl": weighted_pnl / (V27_PRIOR_STRENGTH + effective_samples),
        "sampleCount": len(prior_rows),
        "effectiveSampleCount": effective_samples,
    }


def v27_entry_gate(candidate: dict[str, Any], l2: dict[str, Any],
                   prior_atr: float | None, trades: dict[int, Any],
                   history: list[dict[str, Any]]) -> dict[str, Any]:
    """Online positive-T confidence layer; reverse-T remains exactly on V2.6."""
    base = v26_entry_gate(candidate, l2, prior_atr)
    if candidate["direction"] != "positiveT":
        return {
            **base,
            "model": "v26-reverse-unchanged",
            "calibrationApplied": False,
        }
    features = v27_entry_features(candidate, l2, prior_atr)
    probabilities = {
        "shortRebound60s": v27_probability_estimate(
            "shortRebound60s", features, history, candidate["date"]
        ),
        "targetBeforeStop15m": v27_probability_estimate(
            "targetBeforeStop15m", features, history, candidate["date"]
        ),
        "closureWithin45m": v27_probability_estimate(
            "closureWithin45m", features, history, candidate["date"]
        ),
    }
    entry = entry_trade_after(trades, int(l2.get("decisionSecond") or candidate["second"]))
    expected = None
    if entry is not None:
        _, entry_market = entry
        target_gap = SECOND.target_gap(entry_market)
        stop_gap, _ = adaptive_emergency_stop_gap(
            candidate["direction"], entry_market, target_gap, prior_atr
        )
        target_market = entry_market + target_gap
        stop_market = entry_market - stop_gap
        target_net = SECOND.pnl("positiveT", entry_market, target_market)[0]
        stop_net = SECOND.pnl("positiveT", entry_market, stop_market)[0]
        target_probability = probabilities["targetBeforeStop15m"]["probability"]
        theoretical = target_probability * target_net + (1 - target_probability) * stop_net
        empirical = v27_empirical_expected_pnl(features, history, candidate["date"])
        expected = {
            "targetNetPnl": target_net,
            "emergencyStopNetPnl": stop_net,
            "breakEvenProbability": (-stop_net / (target_net - stop_net)
                                      if target_net > stop_net else None),
            "theoreticalNetPnl": theoretical,
            "empiricalNetPnl": empirical["netPnl"],
            "conservativeNetPnl": min(theoretical, empirical["netPnl"]),
            "decisionNetPnl": empirical["netPnl"],
            "decisionBasis": "prior-date-empirical-after-costs",
            "includesFeesAndSlippage": True,
        }
    target = probabilities["targetBeforeStop15m"]
    aligned_tail = v27_l2_aligned_tail(l2)
    calibration_ready = target["sampleCount"] >= V27_CALIBRATION_MIN_SAMPLES
    if not base["passed"]:
        passed, reason = False, base["reason"]
    elif not calibration_ready:
        passed, reason = True, "v27-confidence-learning-v26-fallback"
    elif target["probability"] < V27_MIN_TARGET_FIRST_PROBABILITY:
        passed, reason = False, "positive-target-first-probability-too-low"
    elif (target["lowerBound95"] is None
          or target["lowerBound95"] < V27_MIN_TARGET_FIRST_LOWER_BOUND):
        passed, reason = False, "positive-confidence-lower-bound-too-low"
    elif aligned_tail < V27_MIN_L2_ALIGNED_SECONDS:
        passed, reason = False, "positive-l2-persistence-too-short"
    elif expected is None or expected["decisionNetPnl"] <= 0:
        passed, reason = False, "positive-expected-value-not-positive"
    else:
        passed, reason = True, "v27-calibrated-positive-entry-confirmed"
    return {
        **base,
        "passed": passed,
        "reason": reason,
        "model": "v27-online-calibrated-positive-entry",
        "calibrationApplied": calibration_ready,
        "confidenceState": "calibrated" if calibration_ready else "learning",
        "features": features,
        "probabilities": probabilities,
        "expectedValue": expected,
        "l2AlignedTailSeconds": aligned_tail,
        "calibrationAsOf": candidate["date"],
    }


def is_bullish_regime(value: Any) -> bool:
    return str(value or "").strip().lower() in V28_BULLISH_REGIMES


def v28_reverse_risk_context(candidate: dict[str, Any]) -> dict[str, Any]:
    """Read entry-time context only and preserve missing inputs as unavailable."""
    factors = candidate.get("factors") if isinstance(candidate.get("factors"), dict) else {}
    groups = {
        "market": ("marketRegime", "marketTrend", "indexRegime", "marketState"),
        "sector": ("sectorRegime", "sectorTrend", "industryRegime", "sectorState"),
        "commodity": ("commodityRegime", "commodityTrend", "metalRegime", "metalTrend"),
        "gold": ("goldRegime", "goldTrend"),
        "copper": ("copperRegime", "copperTrend"),
    }
    context = {}
    for name, keys in groups.items():
        source_key, value = optional_factor(factors, keys)
        context[name] = {
            "status": "available" if source_key else "unavailable",
            "sourceField": source_key,
            "value": value,
            "bullishRisk": is_bullish_regime(value) if source_key else None,
        }
    available = [item for item in context.values() if item["status"] == "available"]
    return {
        "inputs": context,
        "availableInputs": len(available),
        "missingInputsFilledWithZero": False,
        "veto": any(item["bullishRisk"] for item in available),
    }


def calibration_history_before_date(history: list[dict[str, Any]],
                                    candidate_date: str) -> list[dict[str, Any]]:
    """Return completed prior-date observations only."""
    return [
        row for row in history
        if str(row.get("date") or "") < candidate_date
    ]


def v28_entry_gate(candidate: dict[str, Any], l2: dict[str, Any],
                   prior_atr: float | None, trades: dict[int, Any],
                   history: list[dict[str, Any]]) -> dict[str, Any]:
    """V2.8 shadow gate; V2.7 remains the unchanged control cohort."""
    factors = candidate.get("factors") if isinstance(candidate.get("factors"), dict) else {}
    is_intraday = candidate.get("factorCombinationId") == "v28-intraday-pullback-v1"
    # Intraday pullbacks are additional positive-T candidates, not an exemption
    # from the causal probability and after-cost expected-value gate.
    causal_history = calibration_history_before_date(history, candidate["date"])
    base = v27_entry_gate(candidate, l2, prior_atr, trades, causal_history)
    reverse_risk = v28_reverse_risk_context(candidate)
    target_probability = finite_float(
        (((base.get("probabilities") or {}).get("targetBeforeStop15m") or {})
         .get("probability"))
    )
    expected_value = base.get("expectedValue") or {}
    break_even_probability = finite_float(expected_value.get("breakEvenProbability"))
    conservative_net_pnl = finite_float(expected_value.get("conservativeNetPnl"))
    causal_intraday = not is_intraday or factors.get(
        "usesCompletedMinuteAndPriorMinutesOnly"
    ) is True
    if not base["passed"]:
        passed, reason = False, base["reason"]
    elif not causal_intraday:
        passed, reason = False, "intraday-candidate-missing-causal-audit"
    elif l2.get("delayedPromotion") is True:
        passed, reason = False, "delayed-confirmation-observation-only"
    elif is_intraday and base.get("calibrationApplied") is not True:
        passed, reason = False, "intraday-calibration-learning-observation-only"
    elif is_intraday and expected_value.get("includesFeesAndSlippage") is not True:
        passed, reason = False, "intraday-cost-model-not-audited"
    elif is_intraday and (
        target_probability is None
        or break_even_probability is None
        or target_probability < break_even_probability
    ):
        passed, reason = False, "intraday-probability-below-costed-break-even"
    elif is_intraday and (
        conservative_net_pnl is None or conservative_net_pnl <= 0
    ):
        passed, reason = False, "intraday-conservative-net-pnl-not-positive"
    elif candidate["direction"] == "reverseT" and reverse_risk["veto"]:
        passed, reason = False, "reverse-bullish-environment-veto"
    else:
        passed, reason = True, (
            "v28-intraday-pullback-confirmed" if is_intraday
            else "v28-opening-candidate-confirmed"
        )
    return {
        **base,
        "passed": passed,
        "reason": reason,
        "model": "v28-shadow-entry-layer",
        "candidateKind": "intraday-pullback" if is_intraday else "opening-gap",
        "calibrationHistory": {
            "source": "intraday-pullback-only" if is_intraday else "opening-gap",
            "observations": len(causal_history),
            "priorDatesOnly": True,
        },
        "reverseRiskContext": reverse_risk,
        "usesEntryTimeDataOnly": True,
    }


def v27_calibration_observation(candidate: dict[str, Any], decision_second: int,
                                trades: dict[int, Any], prior_atr: float | None,
                                l2: dict[str, Any], simulation: dict[str, Any] | None
                                ) -> dict[str, Any] | None:
    entry = entry_trade_after(trades, decision_second)
    if candidate["direction"] != "positiveT" or entry is None or simulation is None:
        return None
    entry_second, entry_market = entry
    target_gap = SECOND.target_gap(entry_market)
    stop_gap, _ = adaptive_emergency_stop_gap("positiveT", entry_market, target_gap, prior_atr)
    target_price = entry_market + target_gap
    stop_price = entry_market - stop_gap
    short_end = entry_second + V27_SHORT_REBOUND_SECONDS
    target_first_end = entry_second + V27_TARGET_FIRST_SECONDS
    horizon_end = entry_second + HORIZON_SECONDS["positiveT"]
    future_seconds = sorted(
        second for second in trades
        if entry_second < second <= horizon_end and SECOND.is_market_second(second)
    )
    short_rebound = any(
        trades[second].high >= entry_market + max(
            0.01, target_gap * V27_SHORT_REBOUND_TARGET_FRACTION
        )
        for second in future_seconds if second <= short_end
    )
    target_second = next((
        second for second in future_seconds
        if second <= target_first_end and trades[second].high >= target_price
    ), None)
    stop_second = next((
        second for second in future_seconds
        if second <= target_first_end and trades[second].low <= stop_price
    ), None)
    target_before_stop = (
        target_second is not None
        and (stop_second is None or target_second < stop_second)
    )
    closure = any(trades[second].high >= target_price for second in future_seconds)
    return {
        "date": candidate["date"],
        "direction": candidate["direction"],
        "features": v27_entry_features(candidate, l2, prior_atr),
        "outcomes": {
            "shortRebound60s": short_rebound,
            "targetBeforeStop15m": target_before_stop,
            "closureWithin45m": closure,
        },
        "netPnl": simulation["netPnl"],
        "entrySecond": entry_second,
        "usesOutcomeAfterDecisionOnly": True,
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


def v27_dynamic_reassessment(entry_confidence: dict[str, Any] | None,
                             entry_market: float, current_price: float,
                             target_gap: float, stop_gap: float,
                             current_active_buy_ratio: float | None,
                             opposing_votes: int) -> dict[str, Any]:
    probability = finite_float(
        (((entry_confidence or {}).get("probabilities") or {})
         .get("targetBeforeStop15m") or {}).get("probability")
    )
    base_probability = probability if probability is not None else V27_PROBABILITY_PRIOR
    target_bps = target_gap / entry_market * 10_000 if entry_market > 0 else 1.0
    response_bps = (current_price / entry_market - 1) * 10_000 if entry_market > 0 else 0.0
    progress_adjustment = max(-0.25, min(0.25, response_bps / target_bps * 0.25))
    flow_adjustment = (
        max(-0.18, min(0.18, (current_active_buy_ratio - 0.50) * 0.40))
        if current_active_buy_ratio is not None else 0.0
    )
    pressure_adjustment = -0.06 * max(0, opposing_votes - 2)
    reassessed_probability = max(0.01, min(
        0.99,
        base_probability + progress_adjustment + flow_adjustment + pressure_adjustment,
    ))
    target_net = SECOND.pnl("positiveT", entry_market, entry_market + target_gap)[0]
    stop_net = SECOND.pnl("positiveT", entry_market, entry_market - stop_gap)[0]
    expected_net = reassessed_probability * target_net + (1 - reassessed_probability) * stop_net
    return {
        "baseProbability": base_probability,
        "targetBeforeStopProbability": reassessed_probability,
        "expectedNetPnl": expected_net,
        "responseBps": response_bps,
        "activeBuyRatio": current_active_buy_ratio,
        "opposingVotes": opposing_votes,
        "lowConfidence": (
            reassessed_probability <= V27_EXIT_MAX_TARGET_FIRST_PROBABILITY
            and expected_net < 0
            and opposing_votes >= 3
        ),
        "includesFeesAndSlippage": True,
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
                        exit_model: str = "v21",
                        entry_confidence: dict[str, Any] | None = None) -> dict[str, Any] | None:
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
    v27_low_confidence_seconds = 0
    v27_latest_reassessment = None
    v27_minimum_probability = None
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
        if exit_model in {"v22", "v23", "v24", "v26", "v27"}:
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
            if exit_model in {"v24", "v26", "v27"} and direction == "positiveT":
                reassessment = None
                if exit_model == "v27":
                    reassessment = v27_dynamic_reassessment(
                        entry_confidence, entry_market, trade.last, gap, stop_gap,
                        current_ratio, opposing_votes,
                    )
                    v27_latest_reassessment = {"second": second, **reassessment}
                    probability = reassessment["targetBeforeStopProbability"]
                    v27_minimum_probability = (
                        probability if v27_minimum_probability is None
                        else min(v27_minimum_probability, probability)
                    )
                    v27_low_confidence_seconds = (
                        v27_low_confidence_seconds + 1
                        if reassessment["lowConfidence"] and consecutive
                        else (1 if reassessment["lowConfidence"] else 0)
                    )
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
                        v27_low_confidence_seconds = 0
                    elif (second - recovery_watch_second
                          >= V24_RECOVERY_OBSERVATION_SECONDS
                          and adverse_distance >= max(
                              0.01, gap * V24_EXIT_ADVERSE_TARGET_FRACTION
                          )
                          and confirmation["confirmed"]
                          and (exit_model != "v27" or (
                              reassessment is not None
                              and v27_low_confidence_seconds
                              >= V27_EXIT_LOW_CONFIDENCE_SECONDS
                          ))):
                        pending_exit = True
                        exit_decision_second = second
                        exit_confirmation = {
                            **confirmation,
                            "recoveryWatchSecond": recovery_watch_second,
                            "recoveryObservationSeconds": second - recovery_watch_second,
                            "recoveryReleaseSeconds": recovery_release_seconds,
                            "v27LowConfidenceSeconds": v27_low_confidence_seconds,
                            "v27Reassessment": reassessment,
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
        "entryConfidence": entry_confidence if exit_model == "v27" else None,
        "v27LatestReassessment": v27_latest_reassessment,
        "v27MinimumTargetFirstProbability": v27_minimum_probability,
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


def v28_performance_attribution(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_source = {
        "openingGap": [
            row for row in rows
            if row["candidate"].get("factorCombinationId") != "v28-intraday-pullback-v1"
        ],
        "intradayPullback": [
            row for row in rows
            if row["candidate"].get("factorCombinationId") == "v28-intraday-pullback-v1"
        ],
    }
    by_confirmation = {
        "initialConfirmed": [
            row for row in rows
            if row["initialL2Decision"]["status"] == "confirmed"
        ],
        "delayedConfirmed": [
            row for row in rows
            if row["initialL2Decision"]["status"] == "neutral"
            and row["l2Decision"]["status"] == "confirmed"
        ],
        "notConfirmed": [
            row for row in rows if row["l2Decision"]["status"] != "confirmed"
        ],
    }
    return {
        "bySource": {name: metric(group) for name, group in by_source.items()},
        "byConfirmationPath": {
            name: metric(group) for name, group in by_confirmation.items()
        },
    }


def v28_counterfactual_metric(rows: list[dict[str, Any]]) -> dict[str, Any]:
    projected = []
    for row in rows:
        simulation = row.get("counterfactualSimulation")
        projected.append({
            **row,
            "executed": simulation is not None,
            "simulation": simulation,
        })
    return metric(projected)


def v28_expansion_audit(rows: list[dict[str, Any]]) -> dict[str, Any]:
    filtered = [
        row for row in rows
        if not row.get("executed") and row.get("counterfactualSimulation") is not None
    ]
    by_reason: dict[str, list[dict[str, Any]]] = {}
    for row in filtered:
        reason = str((row.get("entryGate") or {}).get("reason") or "unknown")
        by_reason.setdefault(reason, []).append(row)
    groups = {
        "allFiltered": filtered,
        "intradayPullback": [
            row for row in filtered
            if row["candidate"].get("factorCombinationId") == "v28-intraday-pullback-v1"
        ],
        "openingGap": [
            row for row in filtered
            if row["candidate"].get("factorCombinationId") != "v28-intraday-pullback-v1"
        ],
        "delayedConfirmed": [
            row for row in filtered if row["l2Decision"].get("delayedPromotion") is True
        ],
        "initialConfirmed": [
            row for row in filtered
            if row["initialL2Decision"].get("status") == "confirmed"
        ],
    }
    return {
        "researchOnly": True,
        "currentGateUnchanged": True,
        "byGroup": {
            name: v28_counterfactual_metric(group) for name, group in groups.items()
        },
        "byEntryGateReason": {
            reason: v28_counterfactual_metric(group)
            for reason, group in sorted(by_reason.items())
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
        "outOfSampleClosedTrades": (
            test["closedTrades"]
            >= PROMOTION_THRESHOLDS["minimumOutOfSampleClosedTrades"]
        ),
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
    v28_candidates = list(candidates)
    if not args.candidates:
        v28_candidates.extend(v28_intraday_pullback_candidates(
            args.minute_data, allowed_dates
        ))
    atr_by_date = prior_atr_by_date(args.minute_data, allowed_dates)
    candidates_by_date: dict[str, list[dict[str, Any]]] = {}
    for candidate in candidates:
        candidates_by_date.setdefault(candidate["date"], []).append(candidate)
    v28_candidates_by_date: dict[str, list[dict[str, Any]]] = {}
    for candidate in v28_candidates:
        v28_candidates_by_date.setdefault(candidate["date"], []).append(candidate)

    cohort_rows = {name: [] for name in COHORTS}
    risk_managed_rows = {name: [] for name in COHORTS}
    v23_risk_managed_rows = {name: [] for name in COHORTS}
    v24_risk_managed_rows = {name: [] for name in COHORTS}
    v25_risk_managed_rows = {name: [] for name in COHORTS}
    v26_risk_managed_rows = {name: [] for name in COHORTS}
    v27_risk_managed_rows = {name: [] for name in COHORTS}
    v28_risk_managed_rows = {"l2ConfirmAndVeto": []}
    v21_risk_managed_rows = {name: [] for name in COHORTS}
    tight_stop_rows = {name: [] for name in COHORTS}
    ledger: list[dict[str, Any]] = []
    processed_dates: list[str] = []
    source_hash = hashlib.sha256()
    quality = {
        "rawTradeRows": 0,
        "rawQuoteRows": 0,
        "candidateDays": 0,
        "v28CandidateDays": 0,
    }
    v27_calibration_history: list[dict[str, Any]] = []
    v28_intraday_calibration_history: list[dict[str, Any]] = []
    for index, archive in enumerate(archives, start=1):
        date = str(archive["date"])
        source_hash.update(f"{date}:{archive.get('sha256', '')}\n".encode())
        day_candidates = candidates_by_date.get(date, [])
        v28_day_candidates = v28_candidates_by_date.get(date, [])
        if not day_candidates and not v28_day_candidates:
            processed_dates.append(date)
            continue
        trades, quotes, day_quality = SECOND.read_archive(Path(archive["path"]))
        quality["rawTradeRows"] += day_quality["rawTradeRows"]
        quality["rawQuoteRows"] += day_quality["rawQuoteRows"]
        quality["candidateDays"] += bool(day_candidates)
        quality["v28CandidateDays"] += bool(v28_day_candidates)
        day_calibration_observations: list[dict[str, Any]] = []
        day_v28_intraday_calibration_observations: list[dict[str, Any]] = []
        for candidate in day_candidates:
            l2 = classify_l2(candidate, trades, quotes)
            v25_gate = v25_entry_gate(candidate, l2)
            v26_gate = v26_entry_gate(candidate, l2, atr_by_date.get(date))
            v27_gate = v27_entry_gate(
                candidate, l2, atr_by_date.get(date), trades, v27_calibration_history
            )
            v27_reference_simulation = (
                simulate_round_trip(
                    candidate,
                    l2["decisionSecond"],
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                    exit_model="v26",
                )
                if v26_gate["passed"] else None
            )
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
                v27_risk_managed_simulation = (
                    simulate_round_trip(
                        candidate,
                        decision_second,
                        trades,
                        quotes,
                        atr_by_date.get(date),
                        risk_managed=True,
                        exit_model="v27",
                        entry_confidence=v27_gate,
                    )
                    if execute and v27_gate["passed"] else None
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
                v27_risk_managed_rows[cohort].append({
                    **row,
                    "executed": bool(v27_risk_managed_simulation),
                    "simulation": v27_risk_managed_simulation,
                    "entryGate": v27_gate,
                    "counterfactualSimulation": v27_reference_simulation,
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
                    "v27EntryGate": v27_gate,
                    "v27RiskManagedSimulation": v27_risk_managed_simulation,
                    "v27CounterfactualSimulation": v27_reference_simulation,
                    "tightStopSimulation": tight_stop_simulation,
                }
            ledger.append(sample)
            observation = v27_calibration_observation(
                candidate,
                l2["decisionSecond"],
                trades,
                atr_by_date.get(date),
                l2,
                v27_reference_simulation,
            )
            if observation is not None:
                day_calibration_observations.append(observation)
        for candidate in v28_day_candidates:
            is_intraday = (
                candidate.get("factorCombinationId") == "v28-intraday-pullback-v1"
            )
            initial_l2 = classify_l2(candidate, trades, quotes)
            v28_l2 = v28_delayed_l2_decision(
                candidate, initial_l2, trades, quotes
            )
            confirmed = v28_l2["status"] == "confirmed"
            v28_gate = v28_entry_gate(
                candidate,
                v28_l2,
                atr_by_date.get(date),
                trades,
                (v28_intraday_calibration_history
                 if is_intraday else v27_calibration_history),
            )
            v28_counterfactual = (
                simulate_round_trip(
                    candidate,
                    v28_l2["decisionSecond"],
                    trades,
                    quotes,
                    atr_by_date.get(date),
                    risk_managed=True,
                    exit_model="v27",
                    entry_confidence=v28_gate,
                )
                if confirmed else None
            )
            v28_simulation = v28_counterfactual if v28_gate["passed"] else None
            v28_risk_managed_rows["l2ConfirmAndVeto"].append({
                "candidate": candidate,
                "l2Decision": v28_l2,
                "initialL2Decision": initial_l2,
                "cohort": "l2ConfirmAndVeto",
                "executed": bool(v28_simulation),
                "decisionSecond": v28_l2["decisionSecond"],
                "decisionReason": v28_gate["reason"],
                "simulation": v28_simulation,
                "entryGate": v28_gate,
                "counterfactualSimulation": v28_counterfactual,
            })
            if is_intraday:
                observation = v27_calibration_observation(
                    candidate,
                    v28_l2["decisionSecond"],
                    trades,
                    atr_by_date.get(date),
                    v28_l2,
                    v28_counterfactual,
                )
                if observation is not None:
                    day_v28_intraday_calibration_observations.append(observation)
        v27_calibration_history.extend(day_calibration_observations)
        v28_intraday_calibration_history.extend(
            day_v28_intraday_calibration_observations
        )
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
    v27_summaries = {cohort: summarize(rows, dates) for cohort, rows in v27_risk_managed_rows.items()}
    v28_summaries = {cohort: summarize(rows, dates) for cohort, rows in v28_risk_managed_rows.items()}
    v27_promotion = promotion_evaluation(v27_summaries["l2ConfirmAndVeto"])
    evaluated_v28_promotion = promotion_evaluation(v28_summaries["l2ConfirmAndVeto"])
    v28_promotion = {
        **evaluated_v28_promotion,
        "statisticallyEligibleForHumanReview": evaluated_v28_promotion["eligibleForHumanReview"],
        "eligibleForHumanReview": False,
        "automaticPromotion": False,
        "decision": "keep-shadow",
        "reason": "V2.8 is an isolated research cohort and cannot auto-promote",
    }
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
    primary_v27_rows = v27_risk_managed_rows["l2ConfirmAndVeto"]
    v27_audit = {
        "calibration": {
            "observations": len(v27_calibration_history),
            "minimumSamplesBeforeEntry": V27_CALIBRATION_MIN_SAMPLES,
            "sameDayObservationsAvailableToEntry": False,
            "futureObservationsAvailableToEntry": False,
        },
        "all": {
            "lossAttribution": loss_attribution(primary_v27_rows),
            "filteredCounterfactual": filtered_counterfactual(primary_v27_rows),
        },
        "splits": {
            name: {
                "lossAttribution": loss_attribution([
                    row for row in primary_v27_rows if row["candidate"]["date"] in split
                ]),
                "filteredCounterfactual": filtered_counterfactual([
                    row for row in primary_v27_rows if row["candidate"]["date"] in split
                ]),
            }
            for name, split in date_splits.items()
        },
    }
    primary_v28_rows = v28_risk_managed_rows["l2ConfirmAndVeto"]

    def v28_audit_slice(rows: list[dict[str, Any]]) -> dict[str, Any]:
        initial_statuses = {
            status: sum(row["initialL2Decision"]["status"] == status for row in rows)
            for status in ("confirmed", "rejected", "neutral")
        }
        source_counts = {
            "openingGap": sum(
                row["candidate"].get("factorCombinationId") != "v28-intraday-pullback-v1"
                for row in rows
            ),
            "intradayPullback": sum(
                row["candidate"].get("factorCombinationId") == "v28-intraday-pullback-v1"
                for row in rows
            ),
        }
        performance_attribution = v28_performance_attribution(rows)
        return {
            "candidatesBySource": source_counts,
            "performanceAttribution": performance_attribution,
            "expansionCounterfactual": v28_expansion_audit(rows),
            "initialL2Statuses": initial_statuses,
            "delayedNeutralReviews": sum(
                row["l2Decision"].get("delayedReview") is True for row in rows
            ),
            "delayedNeutralPromotions": sum(
                row["l2Decision"].get("delayedPromotion") is True for row in rows
            ),
            "delayedNeutralRejections": sum(
                row["initialL2Decision"]["status"] == "neutral"
                and row["l2Decision"]["status"] == "rejected"
                for row in rows
            ),
            "explicitInitialRejectionsReconsidered": sum(
                row["initialL2Decision"]["status"] == "rejected"
                and row["l2Decision"].get("delayedReview") is True
                for row in rows
            ),
            "reverseEnvironmentVetoes": sum(
                row["entryGate"]["reason"] == "reverse-bullish-environment-veto"
                for row in rows
            ),
            "lossAttribution": loss_attribution(rows),
            "filteredCounterfactual": filtered_counterfactual(rows),
        }

    v27_combined = v27_summaries["l2ConfirmAndVeto"]["all"]["combined"]
    v28_combined = v28_summaries["l2ConfirmAndVeto"]["all"]["combined"]
    v28_audit = {
        "isolation": {
            "researchOnly": True,
            "affectsSmartT": False,
            "affectsShadowV2": False,
            "v27RetainedAsControl": True,
        },
        "dataAvailability": {
            "marketSectorCommodity": (
                "optional entry-time candidate fields; missing values remain unavailable"
            ),
            "missingValuesFilledWithZero": False,
        },
        "calibration": {
            "openingObservations": len(v27_calibration_history),
            "intradayPullbackObservations": len(v28_intraday_calibration_history),
            "intradayHistorySource": "intraday-pullback-only",
            "sameDayObservationsAvailableToEntry": False,
            "futureObservationsAvailableToEntry": False,
            "updatesAfterEntireSession": True,
        },
        "comparisonToV27": {
            "candidateUpgradeRateChange": (
                v28_combined["candidateUpgradeRate"] - v27_combined["candidateUpgradeRate"]
                if v28_combined["candidateUpgradeRate"] is not None
                and v27_combined["candidateUpgradeRate"] is not None else None
            ),
            "closedTradesChange": v28_combined["closedTrades"] - v27_combined["closedTrades"],
            "netPnlChange": v28_combined["netPnl"] - v27_combined["netPnl"],
            "maximumDrawdownChangePct": (
                (v28_combined["maximumDrawdown"] / v27_combined["maximumDrawdown"] - 1) * 100
                if v27_combined["maximumDrawdown"] > 0 else None
            ),
            "targetUpgradeRateRange": [0.20, 0.25],
            "maximumAllowedDrawdownIncreasePct": 20.0,
        },
        "all": v28_audit_slice(primary_v28_rows),
        "splits": {
            name: v28_audit_slice([
                row for row in primary_v28_rows if row["candidate"]["date"] in split
            ])
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
            "riskManagedV27": "V2.6 entry gates plus prior-date calibrated positive-T confidence and sustained low-confidence exit; reverse-T unchanged",
            "riskManagedV28": "isolated V2.7 control extension with delayed neutral confirmation, independently calibrated causal intraday positive-T pullbacks, and reverse-T environment veto",
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
        "v27CalibrationMinimumSamples": V27_CALIBRATION_MIN_SAMPLES,
        "v27ProbabilityPrior": V27_PROBABILITY_PRIOR,
        "v27PriorStrength": V27_PRIOR_STRENGTH,
        "v27MinimumTargetFirstProbability": V27_MIN_TARGET_FIRST_PROBABILITY,
        "v27MinimumTargetFirstLowerBound95": V27_MIN_TARGET_FIRST_LOWER_BOUND,
        "v27MinimumL2AlignedSeconds": V27_MIN_L2_ALIGNED_SECONDS,
        "v27ShortReboundSeconds": V27_SHORT_REBOUND_SECONDS,
        "v27TargetFirstSeconds": V27_TARGET_FIRST_SECONDS,
        "v27ExitMaximumTargetFirstProbability": V27_EXIT_MAX_TARGET_FIRST_PROBABILITY,
        "v27ExitLowConfidenceSeconds": V27_EXIT_LOW_CONFIDENCE_SECONDS,
        "v28DelayedConfirmationSeconds": V28_DELAYED_CONFIRMATION_SECONDS,
        "v28IntradayWindowSeconds": [V28_INTRADAY_START, V28_INTRADAY_END],
        "v28IntradayMinimumVwapDeviationPct": V28_INTRADAY_MIN_VWAP_DEVIATION_PCT,
        "v28IntradayMinimumPullbackPct": V28_INTRADAY_MIN_PULLBACK_PCT,
        "v28IntradayMaximumVolumeRatio": V28_INTRADAY_MAX_VOLUME_RATIO,
        "v28IntradayMinimumBarRecovery": V28_INTRADAY_MIN_BAR_RECOVERY,
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
            "v28CandidateChecksum": stable_hash(v28_candidates),
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
            "v27CalibrationUsesPriorDatesOnly": True,
            "v27CalibrationUpdatesAfterEntireSession": True,
            "v28DelayedReviewAppliesOnlyToInitialNeutral": True,
            "v28DelayedReviewReadsThroughDecisionSecondOnly": True,
            "v28IntradayCandidateUsesCompletedCurrentAndPriorMinutesOnly": True,
            "v28IntradayCalibrationUsesPriorDatesOnly": True,
            "v28IntradayCalibrationUpdatesAfterEntireSession": True,
            "v28IntradayCalibrationIsIndependentFromOpeningSamples": True,
            "v28ReverseVetoUsesEntryTimeOptionalFieldsOnly": True,
        },
        "config": config,
        "quality": {
            **quality,
            "candidateCount": len(candidates),
            "v28CandidateCount": len(v28_candidates),
            "v28IntradayCandidateCount": len(v28_candidates) - len(candidates),
            "ledgerSamples": len(ledger),
        },
        "results": summaries,
        "v22RiskManagedResults": summaries,
        "v23RiskManagedResults": v23_summaries,
        "v24RiskManagedResults": v24_summaries,
        "v25RiskManagedResults": v25_summaries,
        "v25Audit": v25_audit,
        "v26RiskManagedResults": v26_summaries,
        "v26Audit": v26_audit,
        "v27RiskManagedResults": v27_summaries,
        "v27Audit": v27_audit,
        "v28RiskManagedResults": v28_summaries,
        "v28Audit": v28_audit,
        "v21RiskManagedResults": v21_summaries,
        "tightStopCounterexampleResults": tight_stop_summaries,
        "baselineResults": baseline_summaries,
        "v27Promotion": v27_promotion,
        "promotion": v28_promotion,
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
        "v27RiskManagedAll": {cohort: summary["all"] for cohort, summary in v27_summaries.items()},
        "v28RiskManagedAll": {cohort: summary["all"] for cohort, summary in v28_summaries.items()},
        "v21RiskManagedAll": {cohort: summary["all"] for cohort, summary in v21_summaries.items()},
        "tightStopCounterexampleAll": {
            cohort: summary["all"] for cohort, summary in tight_stop_summaries.items()
        },
        "baselineAll": {cohort: summary["all"] for cohort, summary in baseline_summaries.items()},
        "promotion": v28_promotion,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
