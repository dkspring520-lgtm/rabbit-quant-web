#!/usr/bin/env python3
"""Research-only second-level replay for Zijin Mining (601899.SH).

The replay reads the original L2 zip archives directly. Trades are aggregated
to one-second buckets, while the latest genuine ten-level quote is carried
forward until the next quote update. Signals never use events after their
timestamp, and execution starts from the first trade in a later second.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import io
import json
import math
import statistics
import subprocess
import zipfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DEFAULT_MANIFEST = Path(r"E:\zijin-l2\601899-factor-minute-ohlc-v1.manifest.json")
DEFAULT_OUTPUT = Path(r"E:\zijin-l2\research-results\zijin-second-level-shadow-v1.json")
ENGINE_VERSION = "1.0.0"
QUANTITY = 1_600
COMMISSION_RATE = 0.00025
STAMP_DUTY_RATE = 0.0005
MIN_COMMISSION = 5.0
SLIPPAGE_RATE = 0.0005  # 5bp per side
HORIZONS_SECONDS = (300, 600, 900, 1_800)
PRICE_SCALE = 10_000.0

MARKET_WINDOWS = ((9 * 3_600 + 30 * 60, 11 * 3_600 + 30 * 60),
                  (13 * 3_600, 15 * 3_600))

VARIANTS = {
    "fast": {"minimumScore": 3, "minimumLocationBps": 3.0, "cooldownSeconds": 60},
    "balanced": {"minimumScore": 4, "minimumLocationBps": 5.0, "cooldownSeconds": 180},
    "strict": {"minimumScore": 5, "minimumLocationBps": 8.0, "cooldownSeconds": 300},
}


@dataclass(slots=True)
class TradeBucket:
    first: float
    last: float
    high: float
    low: float
    buy_volume: int = 0
    sell_volume: int = 0
    count: int = 0


@dataclass(slots=True)
class QuoteBucket:
    price: float | None
    bid_prices: tuple[float, ...]
    ask_prices: tuple[float, ...]
    bid_volumes: tuple[int, ...]
    ask_volumes: tuple[int, ...]


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def parse_second(value: str) -> int | None:
    digits = "".join(character for character in str(value) if character.isdigit()).zfill(9)[-9:]
    if len(digits) != 9:
        return None
    hour, minute, second = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    if hour > 23 or minute > 59 or second > 59:
        return None
    return hour * 3_600 + minute * 60 + second


def scaled_price(value: Any) -> float | None:
    number = finite_number(value)
    if number is None or number <= 0:
        return None
    return number / PRICE_SCALE


def integer_volume(value: Any) -> int:
    number = finite_number(value)
    return max(0, int(number or 0))


def is_market_second(second: int) -> bool:
    return any(start <= second < end for start, end in MARKET_WINDOWS)


def iter_market_seconds() -> Iterable[int]:
    for start, end in MARKET_WINDOWS:
        yield from range(start, end)


def entry_kind(header: list[str]) -> str | None:
    if len(header) >= 60:
        return "quote"
    if len(header) >= 12:
        return "trade"
    return None


def read_archive(path: Path) -> tuple[dict[int, TradeBucket], dict[int, QuoteBucket], dict[str, Any]]:
    trades: dict[int, TradeBucket] = {}
    quotes: dict[int, QuoteBucket] = {}
    quote_update_seconds: list[int] = []
    raw_trade_rows = 0
    raw_quote_rows = 0

    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            with archive.open(info) as binary:
                reader = csv.reader(io.TextIOWrapper(binary, encoding="gbk", errors="replace", newline=""))
                header = next(reader, [])
                kind = entry_kind(header)
                if kind == "trade":
                    for row in reader:
                        if len(row) < 10 or row[0] != "601899.SH":
                            continue
                        second = parse_second(row[3])
                        price = scaled_price(row[8])
                        volume = integer_volume(row[9])
                        side = row[7].strip().upper()
                        if second is None or price is None or volume <= 0 or side not in {"B", "S"}:
                            continue
                        raw_trade_rows += 1
                        bucket = trades.get(second)
                        if bucket is None:
                            bucket = TradeBucket(price, price, price, price)
                            trades[second] = bucket
                        bucket.last = price
                        bucket.high = max(bucket.high, price)
                        bucket.low = min(bucket.low, price)
                        bucket.count += 1
                        if side == "B":
                            bucket.buy_volume += volume
                        else:
                            bucket.sell_volume += volume
                elif kind == "quote":
                    for row in reader:
                        if len(row) < 57 or row[0] != "601899.SH":
                            continue
                        second = parse_second(row[3])
                        if second is None:
                            continue
                        ask_prices = tuple(value for value in (scaled_price(item) for item in row[17:27]) if value)
                        bid_prices = tuple(value for value in (scaled_price(item) for item in row[37:47]) if value)
                        ask_volumes = tuple(integer_volume(item) for item in row[27:37])
                        bid_volumes = tuple(integer_volume(item) for item in row[47:57])
                        if not ask_prices or not bid_prices or not any(ask_volumes) or not any(bid_volumes):
                            continue
                        raw_quote_rows += 1
                        quotes[second] = QuoteBucket(
                            price=scaled_price(row[4]),
                            bid_prices=bid_prices,
                            ask_prices=ask_prices,
                            bid_volumes=bid_volumes,
                            ask_volumes=ask_volumes,
                        )
                        quote_update_seconds.append(second)

    quote_gaps = [right - left for left, right in zip(quote_update_seconds, quote_update_seconds[1:])
                  if 0 < right - left < 3_600]
    return trades, quotes, {
        "rawTradeRows": raw_trade_rows,
        "rawQuoteRows": raw_quote_rows,
        "tradeSeconds": len(trades),
        "quoteSeconds": len(quotes),
        "quoteMedianGapSeconds": statistics.median(quote_gaps) if quote_gaps else None,
    }


def quote_features(quote: QuoteBucket, price: float) -> tuple[float | None, float | None, float | None]:
    bid_depth = sum(quote.bid_volumes[:5])
    ask_depth = sum(quote.ask_volumes[:5])
    total_depth = bid_depth + ask_depth
    depth_imbalance = (bid_depth - ask_depth) / total_depth if total_depth > 0 else None
    bid = quote.bid_prices[0] if quote.bid_prices else None
    ask = quote.ask_prices[0] if quote.ask_prices else None
    if bid is None or ask is None or bid <= 0 or ask <= bid:
        return depth_imbalance, None, None
    top_depth = quote.bid_volumes[0] + quote.ask_volumes[0]
    microprice = ((ask * quote.bid_volumes[0] + bid * quote.ask_volumes[0]) / top_depth
                  if top_depth > 0 else None)
    midpoint = (bid + ask) / 2
    microprice_edge_bps = (microprice / midpoint - 1) * 10_000 if microprice and midpoint > 0 else None
    spread_bps = (ask / bid - 1) * 10_000
    return depth_imbalance, microprice_edge_bps, spread_bps


def signal_candidates(trades: dict[int, TradeBucket], quotes: dict[int, QuoteBucket]) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    output = {name: [] for name in VARIANTS}
    cooldowns = {name: {"positiveT": -10_000, "reverseT": -10_000} for name in VARIANTS}
    flow_window: deque[tuple[int, int, int]] = deque()
    carried_prices: dict[int, float] = {}
    latest_price: float | None = None
    latest_quote: QuoteBucket | None = None
    latest_quote_second: int | None = None
    cumulative_volume = 0
    cumulative_notional = 0.0
    one_second_evaluations = 0
    fresh_book_evaluations = 0

    # Opening auction trades seed VWAP but cannot create a signal.
    for second in sorted(value for value in trades if value < MARKET_WINDOWS[0][0]):
        bucket = trades[second]
        volume = bucket.buy_volume + bucket.sell_volume
        cumulative_volume += volume
        cumulative_notional += bucket.last * volume

    for second in iter_market_seconds():
        bucket = trades.get(second)
        quote = quotes.get(second)
        if quote is not None:
            latest_quote = quote
            latest_quote_second = second
        if bucket is not None:
            latest_price = bucket.last
            volume = bucket.buy_volume + bucket.sell_volume
            cumulative_volume += volume
            cumulative_notional += bucket.last * volume
            flow_window.append((second, bucket.buy_volume, bucket.sell_volume))
        while flow_window and flow_window[0][0] < second - 4:
            flow_window.popleft()
        if latest_price is not None:
            carried_prices[second] = latest_price
        if latest_price is None or latest_quote is None or latest_quote_second is None:
            continue
        if bucket is None and quote is None:
            continue
        one_second_evaluations += 1
        book_age = second - latest_quote_second
        if book_age > 3:
            continue
        fresh_book_evaluations += 1
        if cumulative_volume <= 0:
            continue
        buy_volume = sum(item[1] for item in flow_window)
        sell_volume = sum(item[2] for item in flow_window)
        active_total = buy_volume + sell_volume
        if active_total <= 0:
            continue
        active_buy_ratio = buy_volume / active_total
        active_seconds = [(buy / (buy + sell)) for _, buy, sell in flow_window if buy + sell > 0]
        buy_persistence = len(active_seconds) >= 3 and sum(value >= 0.52 for value in active_seconds) >= 3
        sell_persistence = len(active_seconds) >= 3 and sum(value <= 0.48 for value in active_seconds) >= 3
        depth, microprice_edge, spread = quote_features(latest_quote, latest_price)
        if depth is None or microprice_edge is None or spread is None or spread > 18:
            continue
        prior_price = carried_prices.get(second - 3, latest_price)
        response_bps = (latest_price / prior_price - 1) * 10_000 if prior_price > 0 else 0
        vwap = cumulative_notional / cumulative_volume
        location_bps = (latest_price / vwap - 1) * 10_000

        positive_votes = sum((
            active_buy_ratio >= 0.55,
            buy_persistence,
            depth >= 0.04,
            microprice_edge > 0,
            response_bps >= 0,
        ))
        reverse_votes = sum((
            active_buy_ratio <= 0.45,
            sell_persistence,
            depth <= -0.04,
            microprice_edge < 0,
            response_bps <= 0,
        ))
        for name, config in VARIANTS.items():
            choices = []
            if location_bps <= -config["minimumLocationBps"] and positive_votes >= config["minimumScore"]:
                choices.append(("positiveT", positive_votes))
            if location_bps >= config["minimumLocationBps"] and reverse_votes >= config["minimumScore"]:
                choices.append(("reverseT", reverse_votes))
            for direction, score in choices:
                if second - cooldowns[name][direction] < config["cooldownSeconds"]:
                    continue
                cooldowns[name][direction] = second
                output[name].append({
                    "second": second,
                    "direction": direction,
                    "signalPrice": latest_price,
                    "score": score,
                    "locationBps": location_bps,
                    "activeBuyRatio": active_buy_ratio,
                    "depthImbalance": depth,
                    "micropriceEdgeBps": microprice_edge,
                    "response3sBps": response_bps,
                    "bookAgeSeconds": book_age,
                })
    return output, {
        "engineEvaluations": one_second_evaluations,
        "freshBookEvaluations": fresh_book_evaluations,
        "freshBookCoverage": fresh_book_evaluations / one_second_evaluations if one_second_evaluations else 0,
    }


def execution_price(side: str, market_price: float) -> float:
    multiplier = 1 + SLIPPAGE_RATE if side == "buy" else 1 - SLIPPAGE_RATE
    return market_price * multiplier


def order_fee(side: str, price: float) -> float:
    gross = price * QUANTITY
    commission = max(MIN_COMMISSION, gross * COMMISSION_RATE)
    stamp = gross * STAMP_DUTY_RATE if side == "sell" else 0.0
    return commission + stamp


def pnl(direction: str, entry_market: float, exit_market: float) -> tuple[float, float, float]:
    entry_side, exit_side = ("buy", "sell") if direction == "positiveT" else ("sell", "buy")
    entry = execution_price(entry_side, entry_market)
    exit_price = execution_price(exit_side, exit_market)
    gross = ((exit_price - entry) if direction == "positiveT" else (entry - exit_price)) * QUANTITY
    fees = order_fee(entry_side, entry) + order_fee(exit_side, exit_price)
    return gross - fees, gross, fees


def target_gap(price: float) -> float:
    buy = execution_price("buy", price)
    sell = execution_price("sell", price)
    round_trip_cost = abs(buy - sell) + (order_fee("buy", buy) + order_fee("sell", sell)) / QUANTITY
    return max(0.08, 2 * round_trip_cost)


def enrich_outcomes(signals: list[dict[str, Any]], trades: dict[int, TradeBucket], date: str) -> list[dict[str, Any]]:
    trade_seconds = sorted(second for second in trades if is_market_second(second))
    enriched: list[dict[str, Any]] = []
    for signal in signals:
        entry_index = bisect.bisect_right(trade_seconds, signal["second"])
        if entry_index >= len(trade_seconds):
            continue
        entry_second = trade_seconds[entry_index]
        entry_market = trades[entry_second].first
        result = {**signal, "date": date, "entrySecond": entry_second, "entryMarketPrice": entry_market, "horizons": {}}
        gap = target_gap(entry_market)
        for horizon in HORIZONS_SECONDS:
            horizon_second = signal["second"] + horizon
            exit_index = bisect.bisect_left(trade_seconds, horizon_second)
            if exit_index >= len(trade_seconds):
                continue
            exit_second = trade_seconds[exit_index]
            exit_market = trades[exit_second].first
            fixed_net, fixed_gross, fixed_fees = pnl(signal["direction"], entry_market, exit_market)
            target_second = None
            target_market = None
            for candidate_second in trade_seconds[entry_index + 1:exit_index + 1]:
                candidate = trades[candidate_second]
                if signal["direction"] == "positiveT" and candidate.high >= entry_market + gap:
                    target_second, target_market = candidate_second, entry_market + gap
                    break
                if signal["direction"] == "reverseT" and candidate.low <= entry_market - gap:
                    target_second, target_market = candidate_second, entry_market - gap
                    break
            strategy_exit = target_market if target_market is not None else exit_market
            strategy_net, strategy_gross, strategy_fees = pnl(signal["direction"], entry_market, strategy_exit)
            result["horizons"][str(horizon)] = {
                "exitSecond": exit_second,
                "exitMarketPrice": exit_market,
                "targetGap": gap,
                "targetReached": target_second is not None,
                "targetSecond": target_second,
                "fixedNetPnl": fixed_net,
                "fixedGrossPnl": fixed_gross,
                "fixedFees": fixed_fees,
                "strategyNetPnl": strategy_net,
                "strategyGrossPnl": strategy_gross,
                "strategyFees": strategy_fees,
            }
        if result["horizons"]:
            enriched.append(result)
    return enriched


def maximum_drawdown(values: list[float]) -> float:
    equity = peak = drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return drawdown


def metrics(signals: list[dict[str, Any]], horizon: int, direction: str | None = None) -> dict[str, Any]:
    selected = [signal for signal in signals
                if str(horizon) in signal["horizons"] and (direction is None or signal["direction"] == direction)]
    fixed = [signal["horizons"][str(horizon)]["fixedNetPnl"] for signal in selected]
    strategy = [signal["horizons"][str(horizon)]["strategyNetPnl"] for signal in selected]
    gains = sum(value for value in strategy if value > 0)
    losses = abs(sum(value for value in strategy if value < 0))
    closures = sum(signal["horizons"][str(horizon)]["targetReached"] for signal in selected)
    fees = sum(signal["horizons"][str(horizon)]["strategyFees"] for signal in selected)
    return {
        "signals": len(selected),
        "closureRate": closures / len(selected) if selected else None,
        "fixedExitWinRate": sum(value > 0 for value in fixed) / len(fixed) if fixed else None,
        "strategyWinRate": sum(value > 0 for value in strategy) / len(strategy) if strategy else None,
        "averageNetPnl": statistics.mean(strategy) if strategy else None,
        "netPnl": sum(strategy),
        "fees": fees,
        "profitFactor": gains / losses if losses > 0 else None,
        "maximumDrawdown": maximum_drawdown(strategy),
    }


def split_dates(dates: list[str]) -> dict[str, set[str]]:
    train_end = max(1, int(len(dates) * 0.6))
    validation_end = max(train_end + 1, int(len(dates) * 0.8))
    return {
        "train": set(dates[:train_end]),
        "validation": set(dates[train_end:validation_end]),
        "test": set(dates[validation_end:]),
    }


def summarize(signals: list[dict[str, Any]], dates: list[str]) -> dict[str, Any]:
    splits = split_dates(dates)
    output: dict[str, Any] = {}
    for split_name, split in splits.items():
        subset = [signal for signal in signals if signal["date"] in split]
        output[split_name] = {}
        for horizon in HORIZONS_SECONDS:
            output[split_name][str(horizon)] = {
                "all": metrics(subset, horizon),
                "positiveT": metrics(subset, horizon, "positiveT"),
                "reverseT": metrics(subset, horizon, "reverseT"),
            }
    return output


def git_commit(root: Path) -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    archives = [item for item in manifest["selectedArchives"]
                if (not args.start or item["date"] >= args.start)
                and (not args.end or item["date"] <= args.end)]
    if args.limit > 0:
        archives = archives[:args.limit]
    if not archives:
        raise SystemExit("No matching Zijin L2 archives")

    source_hash = hashlib.sha256()
    all_signals = {name: [] for name in VARIANTS}
    quality_totals = {
        "rawTradeRows": 0,
        "rawQuoteRows": 0,
        "tradeSeconds": 0,
        "quoteSeconds": 0,
        "engineEvaluations": 0,
        "freshBookEvaluations": 0,
    }
    quote_gap_days: list[float] = []
    processed_dates: list[str] = []
    for index, archive in enumerate(archives, start=1):
        date = str(archive["date"])
        path = Path(archive["path"])
        source_hash.update(f"{date}:{archive.get('sha256', '')}\n".encode())
        trades, quotes, archive_quality = read_archive(path)
        candidates, engine_quality = signal_candidates(trades, quotes)
        for name in VARIANTS:
            all_signals[name].extend(enrich_outcomes(candidates[name], trades, date))
        for key in quality_totals:
            quality_totals[key] += archive_quality.get(key, engine_quality.get(key, 0)) or 0
        if archive_quality["quoteMedianGapSeconds"] is not None:
            quote_gap_days.append(archive_quality["quoteMedianGapSeconds"])
        processed_dates.append(date)
        if index % 20 == 0 or index == len(archives):
            print(f"processed {index}/{len(archives)} days", flush=True)

    evaluations = quality_totals["engineEvaluations"]
    report = {
        "mode": "zijin-601899-second-level-shadow-research",
        "researchOnly": True,
        "affectsSmartT": False,
        "affectsShadowV2": False,
        "engineVersion": ENGINE_VERSION,
        "symbol": "601899.SH",
        "dataset": {
            "manifest": str(args.manifest),
            "sourceChecksum": source_hash.hexdigest(),
            "sessions": len(processed_dates),
            "firstDate": processed_dates[0],
            "lastDate": processed_dates[-1],
        },
        "dataResolution": {
            "signalClock": "1 second",
            "tradeTimestamp": "millisecond source aggregated to 1 second",
            "quoteTimestamp": "source snapshots carried forward for at most 3 seconds",
            "medianQuoteUpdateSeconds": statistics.median(quote_gap_days) if quote_gap_days else None,
        },
        "config": {
            "variants": VARIANTS,
            "flowPersistence": "at least 3 aligned active-trade seconds in the trailing 5 seconds",
            "horizonsSeconds": HORIZONS_SECONDS,
            "quantity": QUANTITY,
            "commissionRate": COMMISSION_RATE,
            "minimumCommission": MIN_COMMISSION,
            "stampDutyRate": STAMP_DUTY_RATE,
            "slippagePerSideBps": SLIPPAGE_RATE * 10_000,
            "targetGap": "max(CNY 0.08, 2 * estimated round-trip cost per share)",
        },
        "antiLeakage": {
            "signalInputsThroughCurrentSecondOnly": True,
            "entryUsesFirstTradeInStrictlyLaterSecond": True,
            "fixedExitUsesFirstTradeAtOrAfterHorizon": True,
            "timeOrderedTrainValidationTest": True,
            "variantsArePredefinedNotFittedOnTest": True,
        },
        "quality": {
            **quality_totals,
            "freshBookCoverage": quality_totals["freshBookEvaluations"] / evaluations if evaluations else 0,
        },
        "results": {name: summarize(signals, processed_dates) for name, signals in all_signals.items()},
        "signalCounts": {name: len(signals) for name, signals in all_signals.items()},
        "gitCommit": git_commit(Path(__file__).resolve().parents[1]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "dataset": report["dataset"],
        "dataResolution": report["dataResolution"],
        "signalCounts": report["signalCounts"],
        "test30m": {name: result["test"]["1800"]["all"] for name, result in report["results"].items()},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
