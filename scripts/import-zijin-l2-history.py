#!/usr/bin/env python3
"""Import historical A-share L2 Parquet/CSV files into causal minute archives.

The importer is intentionally research-only. It writes one JSON replay archive
per trading day and never changes the live strategy state. DuckDB performs the
aggregation inside the source files, so multi-gigabyte daily Parquet files do
not need to be loaded into Python memory.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import duckdb


SYMBOL_DIGITS = re.compile(r"[^0-9]")

ALIASES = {
    "symbol": ("万得代码", "证券代码", "股票代码", "代码", "symbol", "code"),
    "date": ("自然日", "交易日期", "交易日", "trade_date", "date"),
    "time": ("时间", "成交时间", "委托时间", "trade_time", "time"),
    "price": ("成交价", "成交价格", "最新价", "last_price", "price", "close"),
    "volume": ("成交量", "成交数量", "数量", "volume", "vol"),
    "amount": ("成交额", "成交金额", "amount", "turnover"),
    "cum_volume": ("当日累计成交量", "累计成交量", "cum_volume"),
    "cum_amount": ("当日成交额", "累计成交额", "cum_amount"),
    "pre_close": ("前收盘", "昨收", "pre_close", "previous_close"),
    "open": ("开盘价", "open"),
    "high": ("最高价", "high"),
    "low": ("最低价", "low"),
    "side": ("BS标志", "买卖方向", "成交方向", "委托方向", "bs_flag", "side"),
    "bid_price": tuple(f"申买价{i}" for i in range(1, 11)) + tuple(f"买{i}价" for i in range(1, 11)),
    "ask_price": tuple(f"申卖价{i}" for i in range(1, 11)) + tuple(f"卖{i}价" for i in range(1, 11)),
    "bid_volume": tuple(f"申买量{i}" for i in range(1, 11)) + tuple(f"买{i}量" for i in range(1, 11)),
    "ask_volume": tuple(f"申卖量{i}" for i in range(1, 11)) + tuple(f"卖{i}量" for i in range(1, 11)),
}


def sql_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "''")


def sql_identifier(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def source_sql(path: Path) -> str:
    escaped = sql_path(path)
    if path.suffix.lower() in {".parquet", ".pq"}:
        return f"read_parquet('{escaped}')"
    return f"read_csv_auto('{escaped}', header=true, union_by_name=true, sample_size=-1)"


def choose_column(columns: Iterable[str], candidates: Iterable[str]) -> str | None:
    by_exact = {str(column): str(column) for column in columns}
    by_lower = {str(column).casefold(): str(column) for column in columns}
    for candidate in candidates:
        if candidate in by_exact:
            return by_exact[candidate]
        if candidate.casefold() in by_lower:
            return by_lower[candidate.casefold()]
    return None


def column_map(connection: duckdb.DuckDBPyConnection, source: str) -> dict[str, str | None]:
    columns = [str(row[0]) for row in connection.execute(f"DESCRIBE SELECT * FROM {source}").fetchall()]
    selected: dict[str, str | None] = {}
    selected["symbol"] = choose_column(columns, ALIASES["symbol"])
    selected["date"] = choose_column(columns, ALIASES["date"])
    selected["time"] = choose_column(columns, ALIASES["time"])
    for key in ("price", "volume", "amount", "cum_volume", "cum_amount", "pre_close", "open", "high", "low", "side"):
        selected[key] = choose_column(columns, ALIASES[key])
    for key in ("bid_price", "ask_price", "bid_volume", "ask_volume"):
        for index, candidates in enumerate(ALIASES[key], start=1):
            if index > 10:
                break
            selected[f"{key}{index}"] = choose_column(columns, (candidates,))
    missing = [key for key in ("date", "time") if not selected[key]]
    if missing:
        raise ValueError(f"{source} is missing required columns: {', '.join(missing)}")
    return selected


def raw_expr(column: str | None) -> str:
    return "NULL" if not column else f"TRY_CAST({sql_identifier(column)} AS DOUBLE)"


def text_expr(column: str | None) -> str:
    return "NULL" if not column else f"CAST({sql_identifier(column)} AS VARCHAR)"


def date_expr(column: str | None) -> str:
    return f"left(regexp_replace(CAST({sql_identifier(column)} AS VARCHAR), '[^0-9]', '', 'g'), 8)" if column else "NULL"


def time_expr(column: str | None) -> str:
    if not column:
        return "NULL"
    digits = f"regexp_replace(CAST({sql_identifier(column)} AS VARCHAR), '[^0-9]', '', 'g')"
    return f"left(lpad({digits}, 9, '0'), 4)"


def symbol_filter(column: str | None, target: str) -> str:
    if not column:
        return "TRUE"
    digits = f"regexp_replace(CAST({sql_identifier(column)} AS VARCHAR), '[^0-9]', '', 'g')"
    return f"right({digits}, 6) = '{target}'"


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def normalized_price(value: Any, scale: float) -> float | None:
    number = finite(value)
    if number is None or number <= 0:
        return None
    return round(number / scale, 6)


def run_query(connection: duckdb.DuckDBPyConnection, query: str) -> Iterable[tuple[Any, ...]]:
    cursor = connection.execute(query)
    while True:
        rows = cursor.fetchmany(100_000)
        if not rows:
            break
        yield from rows


def minute_bucket() -> dict[str, Any]:
    return {
        "quote": None,
        "trade_price": None,
        "trade_buy_volume": 0,
        "trade_sell_volume": 0,
        "trade_buy_notional": 0.0,
        "trade_sell_notional": 0.0,
        "order_buy_volume": 0,
        "order_sell_volume": 0,
        "order_count": 0,
        "l2Available": False,
    }


def latest_value(target: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        target[key] = value


def quote_query(source: str, columns: dict[str, str | None], target: str, scale: float) -> str:
    date = date_expr(columns["date"])
    minute = time_expr(columns["time"])
    order_time = text_expr(columns["time"])
    fields = [date, minute, order_time]
    names = ["date", "minute", "raw_time"]
    for key in ("price", "volume", "amount", "cum_volume", "cum_amount", "pre_close", "open", "high", "low"):
        fields.append(raw_expr(columns[key]))
        names.append(key)
    for key in ("bid_price", "ask_price", "bid_volume", "ask_volume"):
        for index in range(1, 11):
            fields.append(raw_expr(columns.get(f"{key}{index}")))
            names.append(f"{key}{index}")
    select = ", ".join(f"arg_max({field}, raw_time) AS {name}" for field, name in zip(fields, names))
    return f"""
        SELECT {select}
        FROM {source}
        WHERE {symbol_filter(columns['symbol'], target)}
          AND {date} IS NOT NULL
          AND {minute} IS NOT NULL
        GROUP BY {date}, {minute}
        ORDER BY {date}, {minute}
    """


def trade_query(source: str, columns: dict[str, str | None], target: str, scale: float) -> str:
    date = date_expr(columns["date"])
    minute = time_expr(columns["time"])
    side = f"upper(trim({text_expr(columns['side'])}))" if columns["side"] else "''"
    price = raw_expr(columns["price"])
    volume = raw_expr(columns["volume"])
    notional = f"(({price}) / {scale}) * ({volume})"
    return f"""
        SELECT {date} AS date, {minute} AS minute,
          SUM(CASE WHEN {side} IN ('B', 'BUY', '买') THEN COALESCE({volume}, 0) ELSE 0 END) AS buy_volume,
          SUM(CASE WHEN {side} IN ('S', 'SELL', '卖') THEN COALESCE({volume}, 0) ELSE 0 END) AS sell_volume,
          SUM(CASE WHEN {side} IN ('B', 'BUY', '买') THEN COALESCE({notional}, 0) ELSE 0 END) AS buy_notional,
          SUM(CASE WHEN {side} IN ('S', 'SELL', '卖') THEN COALESCE({notional}, 0) ELSE 0 END) AS sell_notional,
          arg_max({price} / {scale}, {text_expr(columns['time'])}) AS last_price
        FROM {source}
        WHERE {symbol_filter(columns['symbol'], target)}
          AND {date} IS NOT NULL
          AND {minute} IS NOT NULL
        GROUP BY {date}, {minute}
        ORDER BY {date}, {minute}
    """


def order_query(source: str, columns: dict[str, str | None], target: str) -> str:
    date = date_expr(columns["date"])
    minute = time_expr(columns["time"])
    side = f"upper(trim({text_expr(columns['side'])}))" if columns["side"] else "''"
    volume = raw_expr(columns["volume"])
    return f"""
        SELECT {date} AS date, {minute} AS minute,
          SUM(CASE WHEN {side} IN ('B', 'BUY', '买') THEN COALESCE({volume}, 0) ELSE 0 END) AS buy_volume,
          SUM(CASE WHEN {side} IN ('S', 'SELL', '卖') THEN COALESCE({volume}, 0) ELSE 0 END) AS sell_volume,
          COUNT(*) AS order_count
        FROM {source}
        WHERE {symbol_filter(columns['symbol'], target)}
          AND {date} IS NOT NULL
          AND {minute} IS NOT NULL
        GROUP BY {date}, {minute}
        ORDER BY {date}, {minute}
    """


def apply_quote_row(bucket: dict[str, Any], row: tuple[Any, ...], scale: float) -> None:
    date, minute, raw_time, *values = row
    quote = {"date": str(date), "minute": str(minute), "raw_time": str(raw_time), "values": values}
    bucket["quote"] = quote
    price, volume, amount, cum_volume, cum_amount, pre_close, opening, high, low = values[:9]
    valid = normalized_price(price, scale) or any(normalized_price(values[index], scale) for index in range(9, len(values)))
    bucket["l2Available"] = bucket["l2Available"] or bool(valid)


def calculate_depth(quote: dict[str, Any], scale: float) -> dict[str, Any]:
    values = quote["values"]
    result: dict[str, Any] = {}
    offset = 9
    for side in ("bid", "ask"):
        prices = [normalized_price(values[offset + index], scale) for index in range(10)]
        offset += 10
        volumes = [int(finite(values[offset + index]) or 0) for index in range(10)]
        offset += 10
        if any(value is not None for value in prices):
            result[f"{side}Prices"] = prices
        if any(value > 0 for value in volumes):
            result[f"{side}Volumes"] = volumes
    bids = result.get("bidVolumes") or []
    asks = result.get("askVolumes") or []
    if bids and asks:
        bid_near = sum(bids[:5])
        ask_near = sum(asks[:5])
        depth = bid_near + ask_near
        result["bid1Volume"] = bids[0]
        result["ask1Volume"] = asks[0]
        result["nearTouchImbalance"] = round((bid_near - ask_near) / depth, 6) if depth else None
    bid_price = (result.get("bidPrices") or [None])[0]
    ask_price = (result.get("askPrices") or [None])[0]
    if bid_price and ask_price and bid_price > 0 and ask_price > 0:
        mid = (bid_price + ask_price) / 2
        result["spreadBps"] = round((ask_price - bid_price) / mid * 10_000, 4)
        bid_volume = result.get("bid1Volume") or 0
        ask_volume = result.get("ask1Volume") or 0
        if bid_volume + ask_volume:
            microprice = (ask_price * bid_volume + bid_price * ask_volume) / (bid_volume + ask_volume)
            result["microprice"] = round(microprice, 6)
            result["micropriceEdgeBps"] = round((microprice - mid) / mid * 10_000, 4)
    return result


def build_archives(quotes: Path, trades: Path | None, orders: Path | None, output_dir: Path,
                   symbol: str, price_scale: float, big_order: float) -> dict[str, Any]:
    target = re.sub(r"[^0-9]", "", symbol)[-6:]
    if len(target) != 6:
        raise ValueError("symbol must contain a six-digit A-share code")
    output_dir.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect()
    buckets: dict[tuple[str, str], dict[str, Any]] = defaultdict(minute_bucket)

    quote_source = source_sql(quotes)
    quote_columns = column_map(connection, quote_source)
    quote_rows = 0
    quote_sql = quote_query(quote_source, quote_columns, target, price_scale)
    for row in run_query(connection, quote_sql):
        date, minute, raw_time, *values = row
        if not date or not minute:
            continue
        bucket = buckets[(str(date), str(minute))]
        apply_quote_row(bucket, row, price_scale)
        quote_rows += 1

    trade_rows = 0
    if trades:
        trade_source = source_sql(trades)
        trade_columns = column_map(connection, trade_source)
        for date, minute, buy_volume, sell_volume, buy_notional, sell_notional, last_price in run_query(
            connection, trade_query(trade_source, trade_columns, target, price_scale)
        ):
            if not date or not minute:
                continue
            bucket = buckets[(str(date), str(minute))]
            bucket["trade_buy_volume"] += int(finite(buy_volume) or 0)
            bucket["trade_sell_volume"] += int(finite(sell_volume) or 0)
            bucket["trade_buy_notional"] += finite(buy_notional) or 0
            bucket["trade_sell_notional"] += finite(sell_notional) or 0
            bucket["trade_price"] = finite(last_price)
            bucket["l2Available"] = True
            trade_rows += 1

    order_rows = 0
    if orders:
        order_source = source_sql(orders)
        order_columns = column_map(connection, order_source)
        for date, minute, buy_volume, sell_volume, count in run_query(
            connection, order_query(order_source, order_columns, target)
        ):
            if not date or not minute:
                continue
            bucket = buckets[(str(date), str(minute))]
            bucket["order_buy_volume"] += int(finite(buy_volume) or 0)
            bucket["order_sell_volume"] += int(finite(sell_volume) or 0)
            bucket["order_count"] += int(finite(count) or 0)
            bucket["l2Available"] = True
            order_rows += 1

    connection.close()
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (date, minute), bucket in sorted(buckets.items()):
        quote = bucket["quote"]
        values = quote["values"] if quote else []
        price = normalized_price(values[0], price_scale) if quote else None
        if price is None:
            price = bucket["trade_price"]
        if price is None or price <= 0:
            continue
        previous_close = normalized_price(values[5], price_scale) if quote else None
        opening = normalized_price(values[6], price_scale) if quote else None
        high = normalized_price(values[7], price_scale) if quote else None
        low = normalized_price(values[8], price_scale) if quote else None
        flow_total = bucket["trade_buy_notional"] + bucket["trade_sell_notional"]
        row: dict[str, Any] = {
            "time": minute,
            "exchangeMinute": f"{date}-{minute}",
            "price": price,
            "open": opening or price,
            "high": high or price,
            "low": low or price,
            "previousClose": previous_close,
            "volume": bucket["trade_buy_volume"] + bucket["trade_sell_volume"],
            "amount": round(flow_total, 2),
            "averagePrice": round(flow_total / row_volume, 6) if (row_volume := row_volume_value(bucket)) else None,
            "activeBuyVolume": bucket["trade_buy_volume"],
            "activeSellVolume": bucket["trade_sell_volume"],
            "activeBuyNotional": round(bucket["trade_buy_notional"], 2),
            "activeSellNotional": round(bucket["trade_sell_notional"], 2),
            "activeBuyRatio": round(bucket["trade_buy_notional"] / flow_total, 6) if flow_total else None,
            "netActiveNotional": round(bucket["trade_buy_notional"] - bucket["trade_sell_notional"], 2),
            "bigBuyNotional": 0.0,
            "bigSellNotional": 0.0,
            "bigOrderNetNotional": 0.0,
            "orderBuyVolume": bucket["order_buy_volume"],
            "orderSellVolume": bucket["order_sell_volume"],
            "orderCount": bucket["order_count"],
            "l2Available": bool(bucket["l2Available"]),
        }
        if quote:
            quote_volume = finite(values[1])
            quote_amount = finite(values[2])
            cumulative_volume = finite(values[3])
            cumulative_amount = finite(values[4])
            row["quoteVolume"] = quote_volume
            row["quoteAmount"] = quote_amount
            row["cumulativeVolume"] = cumulative_volume
            row["cumulativeAmount"] = cumulative_amount
            row.update(calculate_depth(quote, price_scale))
        row["bigBuyNotional"] = round(row["activeBuyNotional"] if row["activeBuyNotional"] >= big_order else 0, 2)
        row["bigSellNotional"] = round(row["activeSellNotional"] if row["activeSellNotional"] >= big_order else 0, 2)
        row["bigOrderNetNotional"] = round(row["bigBuyNotional"] - row["bigSellNotional"], 2)
        by_date[date].append(row)

    for date, minutes in by_date.items():
        payload = {
            "schemaVersion": 2,
            "symbol": target,
            "market": "SH" if target == "601899" else None,
            "date": date,
            "source": "historical-l2-import",
            "causal": True,
            "researchOnly": True,
            "priceScale": price_scale,
            "l2AvailableMinutes": sum(bool(row.get("l2Available")) for row in minutes),
            "minutes": minutes,
        }
        (output_dir / f"{date}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {
        "symbol": target,
        "quoteRows": quote_rows,
        "tradeMinuteRows": trade_rows,
        "orderMinuteRows": order_rows,
        "tradingDays": len(by_date),
        "outputDir": str(output_dir),
        "dates": sorted(by_date),
    }


def row_volume_value(bucket: dict[str, Any]) -> int:
    return int(bucket["trade_buy_volume"] + bucket["trade_sell_volume"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quotes", required=True, type=Path)
    parser.add_argument("--trades", type=Path)
    parser.add_argument("--orders", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--symbol", default="601899.SH")
    parser.add_argument("--price-scale", type=float, default=1.0, help="raw price divisor; use 1000/10000 for unnormalised vendor exports")
    parser.add_argument("--big-order-yuan", type=float, default=200_000)
    args = parser.parse_args()
    if args.price_scale <= 0:
        parser.error("--price-scale must be positive")
    for path in (args.quotes, args.trades, args.orders):
        if path is not None and not path.exists():
            parser.error(f"input file does not exist: {path}")
    print(json.dumps(build_archives(args.quotes, args.trades, args.orders, args.output_dir, args.symbol, args.price_scale, args.big_order_yuan), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
