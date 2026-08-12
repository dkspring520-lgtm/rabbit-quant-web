#!/usr/bin/env python3
"""Build a causal research-only minute dataset from 601899 L2 ZIP archives.

The transaction file is the source of minute OHLCV/amount.  Quote snapshots
are only used for the latest available order-book state at or before the
minute cutoff.  Missing source fields remain JSON null; source archives are
never modified.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import tempfile
import zipfile
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Iterable


DATE_RE = re.compile(r"(?<!\d)(20\d{6})(?!\d)")
REGULAR_MINUTE_RE = re.compile(r"^(?:09(?:3\d|4\d|5\d)|10(?:[0-5]\d)|11(?:[0-2]\d)|13(?:[0-5]\d)|14(?:[0-4]\d|5[0-6]))$")
PRICE_SCALE = 10_000.0
MAX_QUOTE_STALENESS = 5
SCHEMA_VERSION = 1


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def number(value: Any) -> float | None:
    parsed = finite(value)
    return parsed if parsed is not None else None


def digits(value: Any) -> str:
    return re.sub(r"[^0-9]", "", str(value or ""))


def normalize_time(value: Any) -> tuple[str, int] | None:
    raw = digits(value).zfill(9)
    if len(raw) < 6:
        return None
    hour, minute, second, millis = int(raw[:2]), int(raw[2:4]), int(raw[4:6]), int(raw[6:9])
    if hour > 23 or minute > 59 or second > 59:
        return None
    minute_key = f"{hour:02d}{minute:02d}"
    return minute_key, ((hour * 60 + minute) * 60_000 + second * 1_000 + millis)


def minute_ordinal(minute: str) -> int | None:
    if not REGULAR_MINUTE_RE.match(minute):
        return None
    hour, value = int(minute[:2]), int(minute[2:])
    total = hour * 60 + value
    if 570 <= total <= 690:
        return total - 570
    if 780 <= total <= 900:
        return 120 + total - 780
    return None


def date_from_path(path: Path) -> str | None:
    matches = DATE_RE.findall(str(path))
    return matches[-1] if matches else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def member_encoding(raw: bytes) -> str:
    return "utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "gb18030"


def decode_header(raw: bytes, encoding: str) -> list[str]:
    text = raw.decode(encoding, errors="replace")
    return next(csv.reader(io.StringIO(text)), [])


def member_kind(header: Iterable[str]) -> str | None:
    names = {str(item).strip().lstrip("\\ufeff") for item in header}
    if {"成交编号", "BS标志", "成交价格", "成交数量"}.issubset(names):
        return "trades"
    if "申卖价1" in names and "申买价1" in names:
        return "quotes"
    if {"委托编号", "委托类型", "委托代码"}.issubset(names):
        return "orders"
    return None


def columns(header: list[str]) -> dict[str, int | None]:
    lookup = {str(name).strip().lstrip("\\ufeff"): index for index, name in enumerate(header)}
    def find(*names: str) -> int | None:
        return next((lookup[name] for name in names if name in lookup), None)
    return {
        "symbol": find("万得代码", "证券代码"),
        "date": find("自然日", "交易日期"),
        "time": find("时间", "成交时间", "委托时间"),
        "price": find("成交价格", "成交价", "最新价"),
        "volume": find("成交数量", "成交量", "委托数量", "数量"),
        "amount": find("成交额", "成交金额"),
        "side": find("BS标志", "买卖方向", "成交方向", "委托代码"),
        "cum_volume": find("当日累计成交量", "累计成交量"),
        "cum_amount": find("当日成交额", "累计成交额"),
        "pre_close": find("前收盘价", "前收盘", "昨收"),
        "open": find("开盘价"),
        "high": find("最高价"),
        "low": find("最低价"),
        "bid_price": [find(f"申买价{i}") for i in range(1, 11)],
        "ask_price": [find(f"申卖价{i}") for i in range(1, 11)],
        "bid_volume": [find(f"申买量{i}") for i in range(1, 11)],
        "ask_volume": [find(f"申卖量{i}") for i in range(1, 11)],
    }


def cell(row: list[str], index: int | None) -> str | None:
    return row[index].strip() if index is not None and index < len(row) else None


def scaled_price(value: Any) -> float | None:
    raw = finite(value)
    if raw is None or raw <= 0:
        return None
    return round(raw / PRICE_SCALE, 6)


def archive_members(path: Path) -> dict[str, dict[str, str]]:
    with zipfile.ZipFile(path) as archive:
        result: dict[str, dict[str, str]] = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            with archive.open(info) as handle:
                raw_header = handle.readline()
            encoding = member_encoding(raw_header)
            header = decode_header(raw_header, encoding)
            kind = member_kind(header)
            if kind and kind not in result:
                result[kind] = {"name": info.filename, "encoding": encoding}
        return result


def parse_archive(path: Path, include_rows: bool = True) -> dict[str, Any]:
    members = archive_members(path)
    expected_date = date_from_path(path)
    stats = {
        "path": str(path), "members": members, "tradeRows": 0, "tradeMinutes": 0,
        "validTradeRows": 0, "dateMismatches": 0, "symbolMismatches": 0,
    }
    if not members.get("trades"):
        return stats
    trades: dict[str, dict[str, Any]] = {}
    valid_trade_minutes: set[str] = set()
    quotes: list[dict[str, Any]] = []
    orders: dict[str, dict[str, Any]] = {}
    with zipfile.ZipFile(path) as archive:
        if members.get("trades"):
            with archive.open(members["trades"]["name"]) as raw:
                reader = csv.reader(io.TextIOWrapper(raw, encoding=members["trades"]["encoding"], errors="replace", newline=""))
                header = next(reader, [])
                mapping = columns(header)
                for row in reader:
                    if not row:
                        continue
                    stats["tradeRows"] += 1
                    row_date = digits(cell(row, mapping["date"]))[:8]
                    row_symbol = digits(cell(row, mapping["symbol"]))[-6:]
                    if expected_date and row_date != expected_date:
                        stats["dateMismatches"] += 1
                        continue
                    if row_symbol and row_symbol != "601899":
                        stats["symbolMismatches"] += 1
                        continue
                    time_data = normalize_time(cell(row, mapping["time"]))
                    price = scaled_price(cell(row, mapping["price"]))
                    quantity = finite(cell(row, mapping["volume"]))
                    if not time_data or price is None or quantity is None or quantity <= 0:
                        continue
                    minute, tick_ms = time_data
                    if minute_ordinal(minute) is None:
                        continue
                    stats["validTradeRows"] += 1
                    valid_trade_minutes.add(minute)
                    if not include_rows:
                        continue
                    bucket = trades.setdefault(minute, {
                        "firstMs": tick_ms, "lastMs": tick_ms, "open": price,
                        "high": price, "low": price, "close": price, "volume": 0.0,
                        "amount": 0.0, "buyVolume": 0.0, "sellVolume": 0.0,
                        "buyNotional": 0.0, "sellNotional": 0.0,
                        "tradeCount": 0, "classifiedTradeCount": 0,
                    })
                    if tick_ms < bucket["firstMs"]:
                        bucket["firstMs"], bucket["open"] = tick_ms, price
                    if tick_ms >= bucket["lastMs"]:
                        bucket["lastMs"], bucket["close"] = tick_ms, price
                    bucket["high"] = max(bucket["high"], price)
                    bucket["low"] = min(bucket["low"], price)
                    bucket["volume"] += quantity
                    bucket["amount"] += price * quantity
                    bucket["tradeCount"] += 1
                    side = (cell(row, mapping["side"]) or "").upper()
                    if side == "B":
                        bucket["classifiedTradeCount"] += 1
                        bucket["buyVolume"] += quantity
                        bucket["buyNotional"] += price * quantity
                    elif side == "S":
                        bucket["classifiedTradeCount"] += 1
                        bucket["sellVolume"] += quantity
                        bucket["sellNotional"] += price * quantity
        if members.get("quotes") and include_rows:
            with archive.open(members["quotes"]["name"]) as raw:
                reader = csv.reader(io.TextIOWrapper(raw, encoding=members["quotes"]["encoding"], errors="replace", newline=""))
                header = next(reader, [])
                mapping = columns(header)
                for row in reader:
                    if not row:
                        continue
                    if expected_date and digits(cell(row, mapping["date"]))[:8] != expected_date:
                        continue
                    row_symbol = digits(cell(row, mapping["symbol"]))[-6:]
                    if row_symbol and row_symbol != "601899":
                        continue
                    time_data = normalize_time(cell(row, mapping["time"]))
                    if not time_data or minute_ordinal(time_data[0]) is None:
                        continue
                    minute, tick_ms = time_data
                    quote = {"minute": minute, "tickMs": tick_ms}
                    for key in ("price", "cum_volume", "cum_amount", "pre_close", "open", "high", "low"):
                        raw_value = cell(row, mapping[key])
                        quote[key] = scaled_price(raw_value) if key in {"price", "pre_close", "open", "high", "low"} else finite(raw_value)
                    for side in ("bid_price", "ask_price", "bid_volume", "ask_volume"):
                        values = []
                        for index in mapping[side]:
                            raw_value = cell(row, index)
                            values.append(scaled_price(raw_value) if "price" in side else finite(raw_value))
                        quote[side] = values
                    quotes.append(quote)
        if members.get("orders") and include_rows:
            with archive.open(members["orders"]["name"]) as raw:
                reader = csv.reader(io.TextIOWrapper(raw, encoding=members["orders"]["encoding"], errors="replace", newline=""))
                header = next(reader, [])
                mapping = columns(header)
                for row in reader:
                    if not row:
                        continue
                    if expected_date and digits(cell(row, mapping["date"]))[:8] != expected_date:
                        continue
                    row_symbol = digits(cell(row, mapping["symbol"]))[-6:]
                    if row_symbol and row_symbol != "601899":
                        continue
                    time_data = normalize_time(cell(row, mapping["time"]))
                    quantity = finite(cell(row, mapping["volume"]))
                    if not time_data or quantity is None or quantity <= 0 or minute_ordinal(time_data[0]) is None:
                        continue
                    minute = time_data[0]
                    bucket = orders.setdefault(minute, {"buyVolume": 0.0, "sellVolume": 0.0, "count": 0, "classifiedCount": 0})
                    bucket["count"] += 1
                    side = (cell(row, mapping["side"]) or "").upper()
                    if side == "B":
                        bucket["classifiedCount"] += 1
                        bucket["buyVolume"] += quantity
                    elif side == "S":
                        bucket["classifiedCount"] += 1
                        bucket["sellVolume"] += quantity
    stats["tradeMinutes"] = len(valid_trade_minutes)
    stats["data"] = {"trades": trades, "quotes": quotes, "orders": orders}
    return stats


def align_quote(quotes: list[dict[str, Any]], minute: str) -> tuple[dict[str, Any] | None, int | None]:
    target = minute_ordinal(minute)
    if target is None:
        return None, None
    eligible = [quote for quote in quotes if minute_ordinal(quote["minute"]) is not None and minute_ordinal(quote["minute"]) <= target]
    if not eligible:
        return None, None
    selected = max(eligible, key=lambda quote: quote["tickMs"])
    age = target - minute_ordinal(selected["minute"])
    return (selected, age) if age <= MAX_QUOTE_STALENESS else (None, age)


def align_quotes_causally(quotes: list[dict[str, Any]], minutes: Iterable[str]) -> dict[str, tuple[dict[str, Any] | None, int | None]]:
    """Align sorted quotes once while retaining the latest snapshot through each minute cutoff."""
    ordered = sorted(quotes, key=lambda quote: quote["tickMs"])
    aligned: dict[str, tuple[dict[str, Any] | None, int | None]] = {}
    cursor = 0
    latest: dict[str, Any] | None = None
    for minute in sorted(minutes):
        target = minute_ordinal(minute)
        if target is None:
            aligned[minute] = (None, None)
            continue
        while cursor < len(ordered):
            quote_ordinal = minute_ordinal(ordered[cursor]["minute"])
            if quote_ordinal is None:
                cursor += 1
                continue
            if quote_ordinal > target:
                break
            latest = ordered[cursor]
            cursor += 1
        if latest is None:
            aligned[minute] = (None, None)
            continue
        age = target - minute_ordinal(latest["minute"])
        aligned[minute] = (latest, age) if age <= MAX_QUOTE_STALENESS else (None, age)
    return aligned


def depth_fields(quote: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for side in ("bid", "ask"):
        prices = quote.get(f"{side}_price")
        volumes = quote.get(f"{side}_volume")
        if prices and any(value is not None for value in prices):
            result[f"{side}Prices"] = prices
        if volumes and any(value is not None for value in volumes):
            result[f"{side}Volumes"] = volumes
    bids = [value for value in (result.get("bidVolumes") or [])[:5] if value is not None]
    asks = [value for value in (result.get("askVolumes") or [])[:5] if value is not None]
    if bids and asks:
        bid_total, ask_total = sum(bids), sum(asks)
        total = bid_total + ask_total
        result.update({"bid1Volume": bids[0], "ask1Volume": asks[0], "nearTouchImbalance": (bid_total - ask_total) / total if total else None})
    bid1 = (result.get("bidPrices") or [None])[0]
    ask1 = (result.get("askPrices") or [None])[0]
    if bid1 and ask1:
        mid = (bid1 + ask1) / 2
        result["spreadBps"] = (ask1 - bid1) / mid * 10_000 if mid else None
        bvol, avol = result.get("bid1Volume") or 0, result.get("ask1Volume") or 0
        if bvol + avol:
            micro = (ask1 * bvol + bid1 * avol) / (bvol + avol)
            result["microprice"] = micro
            result["micropriceEdgeBps"] = (micro - mid) / mid * 10_000 if mid else None
    return result


def build_session(date: str, parsed: dict[str, Any]) -> dict[str, Any] | None:
    data = parsed.get("data") or {}
    trades = data.get("trades") or {}
    if not trades:
        return None
    quotes = sorted(data.get("quotes") or [], key=lambda quote: quote["tickMs"])
    orders = data.get("orders") or {}
    minutes: list[dict[str, Any]] = []
    previous_close = next((quote.get("pre_close") for quote in quotes if quote.get("pre_close") is not None), None)
    aligned_quotes = align_quotes_causally(quotes, trades)
    for minute in sorted(trades):
        bucket = trades[minute]
        quote, quote_age = aligned_quotes[minute]
        order = orders.get(minute)
        classified_trades = bucket["classifiedTradeCount"] > 0
        classified_orders = bool(order and order["classifiedCount"] > 0)
        row: dict[str, Any] = {
            "time": minute,
            "exchangeMinute": f"{date}-{minute}",
            "open": bucket["open"], "high": bucket["high"], "low": bucket["low"], "close": bucket["close"], "price": bucket["close"],
            "volume": int(bucket["volume"]), "amount": round(bucket["amount"], 2),
            "averagePrice": round(bucket["amount"] / bucket["volume"], 6) if bucket["volume"] else None,
            "tradeCount": bucket["tradeCount"],
            "activeBuyVolume": int(bucket["buyVolume"]) if classified_trades else None,
            "activeSellVolume": int(bucket["sellVolume"]) if classified_trades else None,
            "activeBuyNotional": round(bucket["buyNotional"], 2) if classified_trades else None,
            "activeSellNotional": round(bucket["sellNotional"], 2) if classified_trades else None,
            "netActiveNotional": round(bucket["buyNotional"] - bucket["sellNotional"], 2) if classified_trades else None,
            "activeBuyRatio": round(bucket["buyNotional"] / bucket["amount"], 6) if classified_trades and bucket["amount"] else None,
            "l2Available": True,
            "orderBuyVolume": int(order["buyVolume"]) if classified_orders else None,
            "orderSellVolume": int(order["sellVolume"]) if classified_orders else None,
            "orderCount": int(order["count"]) if order else None,
            "quoteAgeMinutes": quote_age,
            "quotePrice": None, "cumulativeVolume": None, "cumulativeAmount": None,
            "bidPrices": None, "bidVolumes": None, "askPrices": None, "askVolumes": None,
            "bid1Volume": None, "ask1Volume": None, "nearTouchImbalance": None,
            "spreadBps": None, "microprice": None, "micropriceEdgeBps": None,
        }
        if previous_close is not None:
            row["previousClose"] = previous_close
        if quote:
            previous_close = quote.get("pre_close") or previous_close
            row["previousClose"] = previous_close
            row["quotePrice"] = quote.get("price")
            row["cumulativeVolume"] = quote.get("cum_volume")
            row["cumulativeAmount"] = quote.get("cum_amount")
            row.update(depth_fields(quote))
        minutes.append(row)
    if minutes and previous_close is not None:
        for row in minutes:
            row.setdefault("previousClose", previous_close)
    return {"schemaVersion": 3, "symbol": "601899", "market": "SH", "date": date, "previousClose": previous_close, "source": "601899-l2-tick-rebuild", "causal": True, "researchOnly": True, "priceScale": PRICE_SCALE, "l2AvailableMinutes": len(minutes), "minutes": minutes}


def discover_archives(root: Path) -> dict[str, list[Path]]:
    grouped: dict[str, list[Path]] = defaultdict(list)
    for path in sorted(root.rglob("*.zip")):
        date = date_from_path(path)
        if date:
            grouped[date].append(path)
    return grouped


def choose_archives(grouped: dict[str, list[Path]], start_date: str | None = None, end_date: str | None = None) -> tuple[dict[str, Path], list[dict[str, Any]]]:
    selected: dict[str, Path] = {}
    decisions: list[dict[str, Any]] = []
    for date, paths in sorted(grouped.items()):
        if start_date and date < start_date or end_date and date > end_date:
            continue
        parsed = [(path, parse_archive(path, include_rows=False)) for path in paths] if len(paths) > 1 else []
        path = max(parsed, key=lambda item: (item[1].get("validTradeRows", 0), item[1].get("tradeMinutes", 0), str(item[0])))[0] if parsed else paths[0]
        selected[date] = path
        decisions.append({"date": date, "selected": str(path), "candidates": [{"path": str(candidate), "validTradeRows": info.get("validTradeRows", 0), "tradeMinutes": info.get("tradeMinutes", 0)} for candidate, info in parsed] or [{"path": str(path), "validTradeRows": None, "tradeMinutes": None}], "rejected": [str(candidate) for candidate, _ in parsed if candidate != path]})
    return selected, decisions


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def process_selected_archive(item: tuple[str, Path]) -> tuple[str, dict[str, Any], dict[str, Any] | None, str]:
    date, path = item
    parsed = parse_archive(path, include_rows=True)
    session = build_session(date, parsed)
    parsed.pop("data", None)
    return date, parsed, session, sha256_file(path)


def build_dataset(root: Path, output: Path, manifest_path: Path | None = None, start_date: str | None = None, end_date: str | None = None, workers: int = 1) -> dict[str, Any]:
    grouped = discover_archives(root)
    selected, decisions = choose_archives(grouped, start_date, end_date)
    dates = sorted(selected)
    sessions: list[dict[str, Any]] = []
    selected_checksums: list[dict[str, str]] = []
    missing_dates: list[str] = []
    stats = {
        "ticks": 0, "validTicks": 0, "minutes": 0, "ohlcInvalid": 0,
        "dateMismatches": 0, "symbolMismatches": 0,
        "quoteMissing": 0, "quoteStale": 0, "orderMissing": 0,
        "quoteVolumePairs": 0, "quoteVolumeMismatches": 0,
        "quoteAmountPairs": 0, "quoteAmountMismatches": 0,
    }
    selected_items = [(date, selected[date]) for date in dates]
    if workers > 1 and len(selected_items) > 1:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            processed = list(executor.map(process_selected_archive, selected_items))
    else:
        processed = [process_selected_archive(item) for item in selected_items]
    for date, parsed, session, archive_checksum in processed:
        path = selected[date]
        stats["ticks"] += parsed.get("tradeRows", 0)
        stats["validTicks"] += parsed.get("validTradeRows", 0)
        stats["dateMismatches"] += parsed.get("dateMismatches", 0)
        stats["symbolMismatches"] += parsed.get("symbolMismatches", 0)
        if not session:
            missing_dates.append(date)
            continue
        stats["minutes"] += len(session["minutes"])
        previous_cumulative_volume = None
        previous_cumulative_amount = None
        for row in session["minutes"]:
            if not (row["low"] <= min(row["open"], row["close"]) <= max(row["open"], row["close"]) <= row["high"]):
                stats["ohlcInvalid"] += 1
            if row.get("quoteAgeMinutes") is None:
                stats["quoteMissing"] += 1
            elif row["quoteAgeMinutes"] > 0:
                stats["quoteStale"] += 1
            if row.get("orderCount") is None:
                stats["orderMissing"] += 1
            cumulative_volume = finite(row.get("cumulativeVolume"))
            if cumulative_volume is not None and previous_cumulative_volume is not None:
                stats["quoteVolumePairs"] += 1
                delta = cumulative_volume - previous_cumulative_volume
                if abs(delta - row["volume"]) > max(1, row["volume"] * 0.001):
                    stats["quoteVolumeMismatches"] += 1
            cumulative_amount = finite(row.get("cumulativeAmount"))
            if cumulative_amount is not None and previous_cumulative_amount is not None:
                stats["quoteAmountPairs"] += 1
                delta = cumulative_amount - previous_cumulative_amount
                if abs(delta - row["amount"]) > max(0.01, row["amount"] * 0.001):
                    stats["quoteAmountMismatches"] += 1
            previous_cumulative_volume = cumulative_volume if cumulative_volume is not None else previous_cumulative_volume
            previous_cumulative_amount = cumulative_amount if cumulative_amount is not None else previous_cumulative_amount
        sessions.append(session)
        selected_checksums.append({"date": date, "path": str(path), "sha256": archive_checksum})
    dataset_text = "".join(json.dumps(session, ensure_ascii=False, separators=(",", ":")) + "\n" for session in sessions)
    write_atomic(output, dataset_text)
    dataset_checksum = hashlib.sha256(dataset_text.encode("utf-8")).hexdigest()
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "datasetId": "zijin-601899-minute-ohlc-l2-v1",
        "datasetChecksum": dataset_checksum,
        "symbol": "601899.SH",
        "sourceRoot": str(root),
        "sourceDateRange": {"first": dates[0] if dates else None, "last": dates[-1] if dates else None},
        "selectedArchives": selected_checksums,
        "duplicateResolution": decisions,
        "missingDates": missing_dates,
        "sessions": len(sessions),
        "stats": stats,
        "alignment": {"sessionPolicy": "continuous-auction only: 09:30-11:29 and 13:00-14:56", "quoteRule": "latest quote at or before minute cutoff", "maximumQuoteStalenessMinutes": MAX_QUOTE_STALENESS, "futureQuoteRowsUsed": 0, "missingFields": "null-not-zero-filled"},
        "ohlc": {"source": "逐笔成交.csv", "priceScale": PRICE_SCALE, "open": "first valid tick", "high": "max valid tick", "low": "min valid tick", "close": "last valid tick", "amount": "sum normalized price * quantity"},
        "researchOnly": True,
        "affectsShadowV2": False,
        "affectsSmartT": False,
        "canPromoteAutomatically": False,
    }
    if manifest_path:
        write_atomic(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--workers", type=int, default=min(8, os.cpu_count() or 1))
    args = parser.parse_args()
    if not args.input_root.exists():
        parser.error(f"input root does not exist: {args.input_root}")
    if args.workers < 1:
        parser.error("workers must be at least 1")
    print(json.dumps(build_dataset(args.input_root, args.output, args.manifest, args.start_date, args.end_date, args.workers), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
