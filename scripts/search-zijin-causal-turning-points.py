#!/usr/bin/env python3
"""Search causal Zijin intraday turning-point rules without opening 2025.

The rule is selected with 2022-2023 research plus 2024 calibration. 2025 is
evaluated only after the parameter set has been frozen. Every entry is filled
on the next minute and every exit uses the first subsequently observed target,
stop, or timeout. Commission, stamp duty and two-sided slippage are included.
"""

from __future__ import annotations

import itertools
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


def pct(base: float, value: float) -> float:
    return (value - base) / base * 100.0 if base > 0 else 0.0


def order_cost(side: str, price: float, quantity: int) -> float:
    turnover = price * quantity
    return max(5.0, turnover * 0.00025) + (turnover * 0.0005 if side == "SELL" else 0.0)


def load_sessions(path: Path) -> list[dict]:
    sessions = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            session = json.loads(line)
            if int(str(session["date"])[:4]) <= 2025:
                sessions.append(session)
    return sessions


def enrich(session: dict) -> dict | None:
    points = session.get("minutes") or []
    if len(points) < 100:
        return None
    prices = [float(point.get("price") or 0) for point in points]
    volumes = [float(point.get("volume") or 0) for point in points]
    if min(prices) <= 0:
        return None
    amount = 0.0
    shares = 0.0
    vwaps = []
    for price, volume in zip(prices, volumes):
        amount += price * max(0.0, volume)
        shares += max(0.0, volume)
        vwaps.append(amount / shares if shares > 0 else price)
    return {
        "date": str(session["date"]),
        "year": int(str(session["date"])[:4]),
        "prices": prices,
        "volumes": volumes,
        "vwaps": vwaps,
        "times": [str(point.get("time") or "").replace(":", "").zfill(4) for point in points],
        "previous_close": float(session.get("previousClose") or prices[0]),
    }


def fill_result(direction: int, entry_raw: float, exit_raw: float, quantity: int) -> float:
    entry = entry_raw * (1.0002 if direction > 0 else 0.9998)
    exit_price = exit_raw * (0.9998 if direction > 0 else 1.0002)
    if direction > 0:
        gross = (exit_price - entry) * quantity
        fees = order_cost("BUY", entry, quantity) + order_cost("SELL", exit_price, quantity)
    else:
        gross = (entry - exit_price) * quantity
        fees = order_cost("SELL", entry, quantity) + order_cost("BUY", exit_price, quantity)
    return gross - fees


def first_candidate(day: dict, direction: int, params: dict) -> int | None:
    prices = day["prices"]
    volumes = day["volumes"]
    vwaps = day["vwaps"]
    times = day["times"]
    for index in range(20, len(prices) - 2):
        time = times[index]
        if time < params["start"] or time > "1430" or "1131" <= time < "1300":
            continue
        recent = prices[index - 19:index + 1]
        low = min(recent)
        high = max(recent)
        position = (prices[index] - low) / (high - low) if high > low else 0.5
        deviation = pct(vwaps[index], prices[index])
        momentum_1 = pct(prices[index - 1], prices[index])
        momentum_3 = pct(prices[index - 3], prices[index])
        previous_momentum_3 = pct(prices[index - 6], prices[index - 3])
        vwap_slope_10 = pct(vwaps[index - 10], vwaps[index])
        baseline_volume = sum(volumes[index - 20:index]) / 20
        volume_ratio = volumes[index] / baseline_volume if baseline_volume > 0 else 1.0
        if volume_ratio > params["max_volume_ratio"]:
            continue
        if direction > 0:
            passed = (
                deviation <= -params["deviation"]
                and position <= params["position"]
                and previous_momentum_3 < 0
                and momentum_1 >= params["reversal"]
                and momentum_3 > -params["max_momentum_3"]
                and vwap_slope_10 >= -params["max_vwap_slope"]
            )
        else:
            passed = (
                deviation >= params["deviation"]
                and position >= 1.0 - params["position"]
                and previous_momentum_3 > 0
                and momentum_1 <= -params["reversal"]
                and momentum_3 < params["max_momentum_3"]
                and vwap_slope_10 <= params["max_vwap_slope"]
            )
        if passed:
            return index
    return None


def simulate_day(day: dict, direction: int, params: dict) -> float | None:
    signal_index = first_candidate(day, direction, params)
    if signal_index is None:
        return None
    prices = day["prices"]
    entry_index = signal_index + 1
    entry_raw = prices[entry_index]
    quantity = max(300, math.floor((90_000 / day["previous_close"]) / 100) * 100)
    exit_index = min(len(prices) - 1, entry_index + params["timeout"])
    for index in range(entry_index + 1, exit_index + 1):
        move = pct(entry_raw, prices[index]) * direction
        if move >= params["target"] or move <= -params["stop"]:
            exit_index = index
            break
    return fill_result(direction, entry_raw, prices[exit_index], quantity)


def empty() -> dict:
    return {"days": 0, "trades": 0, "wins": 0, "net": 0.0, "gross_win": 0.0, "gross_loss": 0.0}


def evaluate(days: list[dict], direction: int, params: dict) -> dict:
    bucket = empty()
    for day in days:
        bucket["days"] += 1
        net = simulate_day(day, direction, params)
        if net is None:
            continue
        bucket["trades"] += 1
        bucket["wins"] += net > 0
        bucket["net"] += net
        if net > 0:
            bucket["gross_win"] += net
        else:
            bucket["gross_loss"] += net
    return finalize(bucket)


def finalize(bucket: dict) -> dict:
    trades = bucket["trades"]
    losses = abs(bucket["gross_loss"])
    return {
        "days": bucket["days"],
        "trades": trades,
        "cycles_per_100_days": round(trades / max(1, bucket["days"]) * 100, 2),
        "win_rate": round(bucket["wins"] / max(1, trades) * 100, 2),
        "net": round(bucket["net"], 2),
        "average_net": round(bucket["net"] / max(1, trades), 2),
        "profit_factor": round(bucket["gross_win"] / losses, 3) if losses else None,
    }


def parameter_grid() -> list[dict]:
    keys = [
        "deviation", "position", "reversal", "max_momentum_3", "max_vwap_slope",
        "max_volume_ratio", "target", "stop", "timeout", "start",
    ]
    values = itertools.product(
        (0.12, 0.18, 0.25, 0.32),
        (0.25, 0.35),
        (0.0, 0.03),
        (0.30,),
        (0.10, 0.20),
        (3.0,),
        (0.22, 0.30, 0.40),
        (0.18, 0.26, 0.36),
        (12, 20),
        ("0938", "1015"),
    )
    return [dict(zip(keys, row)) for row in values]


def select_rule(days_by_year: dict[int, list[dict]], direction: int) -> tuple[dict, list[dict]]:
    rows = []
    research_days = days_by_year[2022] + days_by_year[2023]
    calibration_days = days_by_year[2024]
    for params in parameter_grid():
        research = evaluate(research_days, direction, params)
        if not (20 <= research["cycles_per_100_days"] <= 70):
            continue
        calibration = evaluate(calibration_days, direction, params)
        rows.append({"params": params, "research_2022_2023": research, "calibration_2024": calibration})
    eligible = [row for row in rows if (
        row["research_2022_2023"]["net"] > 0
        and row["calibration_2024"]["net"] > 0
        and row["research_2022_2023"]["win_rate"] >= 50
        and row["calibration_2024"]["win_rate"] >= 50
    )]
    pool = eligible or rows
    selected = max(pool, key=lambda row: (
        row["calibration_2024"]["net"] > 0,
        row["calibration_2024"]["profit_factor"] or 0,
        -abs(row["calibration_2024"]["cycles_per_100_days"] - 40),
        row["research_2022_2023"]["net"],
    ))
    return selected, rows


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: search-zijin-causal-turning-points.py SESSIONS.jsonl")
    enriched = [day for session in load_sessions(Path(sys.argv[1])) if (day := enrich(session))]
    days_by_year: dict[int, list[dict]] = defaultdict(list)
    for day in enriched:
        days_by_year[day["year"]].append(day)

    output = {
        "protocol": {
            "future_function": False,
            "entry": "next minute after a fully observed turning-point candidate",
            "exit": "first observed target/stop, otherwise causal timeout",
            "costs": "0.025% commission/minimum 5, 0.05% sell stamp duty, 0.02% two-sided slippage",
            "selection": "2022-2023 research plus 2024 calibration",
            "frozen_validation": "2025",
        },
        "session_counts": {str(year): len(days) for year, days in sorted(days_by_year.items())},
        "directions": {},
    }
    for direction, name in ((1, "BUY_FIRST"), (-1, "SELL_FIRST")):
        selected, rows = select_rule(days_by_year, direction)
        validation = evaluate(days_by_year[2025], direction, selected["params"])
        output["directions"][name] = {
            "selected_without_2025": selected,
            "validation_2025": validation,
            "searched_rules": len(rows),
        }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
