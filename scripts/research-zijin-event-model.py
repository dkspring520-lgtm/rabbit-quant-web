#!/usr/bin/env python3
"""Causal Zijin intraday event-model research.

Protocol:
- candidate features use only the current and earlier one-minute observations;
- fills occur at the next minute with explicit slippage and A-share costs;
- 2023/2024 predictions are walk-forward out-of-sample calibration evidence;
- the threshold is frozen before the final 2025 validation is evaluated;
- 2026 is never read by this script.

This is a research audit.  It does not change the production Smart-T profile.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier


FEATURE_NAMES = [
    "minute_norm",
    "gap_pct",
    "return_1m",
    "return_3m",
    "return_5m",
    "return_10m",
    "return_20m",
    "vwap_deviation_pct",
    "vwap_slope_3m",
    "vwap_slope_10m",
    "range_position_10m",
    "range_position_20m",
    "range_position_30m",
    "volume_ratio_1m",
    "volume_ratio_3m",
    "volatility_5m",
    "volatility_10m",
    "volatility_20m",
    "up_fraction_10m",
    "direction",
    "family_reversion",
]


def pct(a: float, b: float) -> float:
    return (b - a) / a * 100.0 if a > 0 else 0.0


def safe_std(values: list[float]) -> float:
    return float(np.std(values)) if values else 0.0


def order_cost(side: str, price: float, quantity: int) -> float:
    turnover = price * quantity
    return max(5.0, turnover * 0.00025) + (turnover * 0.0005 if side == "SELL" else 0.0)


def cycle_result(direction: int, entry_raw: float, exit_raw: float, quantity: int) -> dict:
    # direction +1: buy first, -1: sell first.
    entry = entry_raw * (1.0002 if direction > 0 else 0.9998)
    exit_price = exit_raw * (0.9998 if direction > 0 else 1.0002)
    if direction > 0:
        gross = (exit_price - entry) * quantity
        fees = order_cost("BUY", entry, quantity) + order_cost("SELL", exit_price, quantity)
    else:
        gross = (entry - exit_price) * quantity
        fees = order_cost("SELL", entry, quantity) + order_cost("BUY", exit_price, quantity)
    return {"gross": gross, "fees": fees, "net": gross - fees, "entry": entry, "exit": exit_price}


def load_sessions(path: Path) -> list[dict]:
    sessions = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            session = json.loads(line)
            year = int(str(session["date"])[:4])
            if year <= 2025:
                sessions.append(session)
    return sessions


def rolling_vwap(prices: list[float], volumes: list[float]) -> list[float]:
    amount = 0.0
    shares = 0.0
    result = []
    for price, volume in zip(prices, volumes):
        amount += price * max(0.0, volume)
        shares += max(0.0, volume)
        result.append(amount / shares if shares > 0 else price)
    return result


def window_position(prices: list[float], index: int, lookback: int) -> float:
    values = prices[max(0, index - lookback + 1): index + 1]
    low = min(values)
    high = max(values)
    return (prices[index] - low) / (high - low) if high > low else 0.5


def volume_ratio(volumes: list[float], index: int, width: int) -> float:
    history = volumes[max(0, index - 20):index]
    baseline = float(np.mean(history)) if history else 0.0
    current = float(np.mean(volumes[max(0, index - width + 1): index + 1]))
    return current / baseline if baseline > 0 else 1.0


def feature_row(prices: list[float], volumes: list[float], vwaps: list[float], index: int,
                previous_close: float, direction: int, family_reversion: int) -> list[float]:
    returns = [pct(prices[cursor - 1], prices[cursor]) for cursor in range(max(1, index - 20), index + 1)]

    def move(width: int) -> float:
        return pct(prices[max(0, index - width)], prices[index])

    def vwap_move(width: int) -> float:
        return pct(vwaps[max(0, index - width)], vwaps[index])

    up_count = sum(1 for cursor in range(max(1, index - 9), index + 1) if prices[cursor] > prices[cursor - 1])
    observed = min(10, index)
    return [
        index / 241.0,
        pct(previous_close, prices[0]),
        move(1),
        move(3),
        move(5),
        move(10),
        move(20),
        pct(vwaps[index], prices[index]),
        vwap_move(3),
        vwap_move(10),
        window_position(prices, index, 10),
        window_position(prices, index, 20),
        window_position(prices, index, 30),
        min(10.0, volume_ratio(volumes, index, 1)),
        min(10.0, volume_ratio(volumes, index, 3)),
        safe_std(returns[-5:]),
        safe_std(returns[-10:]),
        safe_std(returns[-20:]),
        up_count / max(1, observed),
        float(direction),
        float(family_reversion),
    ]


def session_candidates(session: dict, horizon: int = 15) -> list[dict]:
    minutes = session.get("minutes") or []
    prices = [float(point.get("price") or 0) for point in minutes]
    volumes = [float(point.get("volume") or 0) for point in minutes]
    if len(prices) < 50 or min(prices) <= 0:
        return []
    vwaps = rolling_vwap(prices, volumes)
    previous_close = float(session.get("previousClose") or prices[0])
    reference = previous_close or prices[0]
    quantity = max(300, math.floor((90_000 / reference) / 100) * 100)
    rows = []
    for index in range(20, len(prices) - horizon - 1):
        time = str(minutes[index].get("time") or "").replace(":", "").zfill(4)
        if time < "0935" or time > "1440" or "1131" <= time < "1300":
            continue
        deviation = pct(vwaps[index], prices[index])
        mom1 = pct(prices[index - 1], prices[index])
        mom3 = pct(prices[index - 3], prices[index])
        vwap_slope = pct(vwaps[index - 10], vwaps[index])
        pos20 = window_position(prices, index, 20)
        events: list[tuple[int, int, str]] = []

        # Mean reversion requires a visible turn after a meaningful deviation.
        if deviation <= -0.15 and mom1 > 0 and pos20 <= 0.45:
            events.append((1, 1, "REVERSION_BUY"))
        if deviation >= 0.15 and mom1 < 0 and pos20 >= 0.55:
            events.append((-1, 1, "REVERSION_SELL"))

        # Trend continuation requires a prior pullback/bounce and renewed one-minute direction.
        if deviation >= 0.05 and vwap_slope > 0.01 and mom3 < 0 and mom1 > 0 and pos20 >= 0.45:
            events.append((1, 0, "CONTINUATION_BUY"))
        if deviation <= -0.05 and vwap_slope < -0.01 and mom3 > 0 and mom1 < 0 and pos20 <= 0.55:
            events.append((-1, 0, "CONTINUATION_SELL"))

        for direction, family_reversion, family in events:
            entry_index = index + 1
            exit_index = min(len(prices) - 1, entry_index + horizon)
            result = cycle_result(direction, prices[entry_index], prices[exit_index], quantity)
            rows.append({
                "date": str(session["date"]),
                "year": int(str(session["date"])[:4]),
                "signal_index": index,
                "signal_time": time,
                "entry_index": entry_index,
                "exit_index": exit_index,
                "direction": direction,
                "family": family,
                "features": feature_row(prices, volumes, vwaps, index, previous_close, direction, family_reversion),
                "label": int(result["net"] > 0),
                **result,
            })
    return rows


def model() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        learning_rate=0.05,
        max_iter=180,
        max_leaf_nodes=15,
        min_samples_leaf=80,
        l2_regularization=8.0,
        random_state=20260801,
    )


def fit_predict(train_rows: list[dict], predict_rows: list[dict]) -> np.ndarray:
    estimator = model()
    estimator.fit(
        np.asarray([row["features"] for row in train_rows], dtype=float),
        np.asarray([row["label"] for row in train_rows], dtype=int),
    )
    return estimator.predict_proba(np.asarray([row["features"] for row in predict_rows], dtype=float))[:, 1]


def simulate(rows: list[dict], probabilities: np.ndarray, threshold: float,
             max_cycles: int = 1, cooldown: int = 20) -> dict:
    grouped: dict[str, list[tuple[dict, float]]] = defaultdict(list)
    for row, probability in zip(rows, probabilities):
        grouped[row["date"]].append((row, float(probability)))
    selected = []
    for date in sorted(grouped):
        last_exit = -10_000
        day_count = 0
        for row, probability in sorted(grouped[date], key=lambda item: item[0]["signal_index"]):
            if probability < threshold or day_count >= max_cycles:
                continue
            if row["signal_index"] < last_exit + cooldown:
                continue
            selected.append({**row, "probability": probability})
            day_count += 1
            last_exit = row["exit_index"]
    nets = [row["net"] for row in selected]
    wins = sum(1 for value in nets if value > 0)
    return {
        "trades": len(selected),
        "wins": wins,
        "win_rate": round(wins / len(selected) * 100, 2) if selected else 0.0,
        "net": round(sum(nets), 2),
        "average_net": round(float(np.mean(nets)), 2) if nets else 0.0,
        "profit_factor": round(sum(value for value in nets if value > 0) / abs(sum(value for value in nets if value < 0)), 3)
        if any(value < 0 for value in nets) else None,
        "rows": selected,
    }


def compact(metrics: dict, session_count: int) -> dict:
    return {
        key: value for key, value in metrics.items() if key != "rows"
    } | {"cycles_per_100_days": round(metrics["trades"] / max(1, session_count) * 100, 2)}


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python research-zijin-event-model.py SESSIONS.jsonl")
    sessions = load_sessions(Path(sys.argv[1]))
    session_counts = defaultdict(int)
    all_rows = []
    for session in sessions:
        year = int(str(session["date"])[:4])
        session_counts[year] += 1
        all_rows.extend(session_candidates(session))

    rows_by_year = {year: [row for row in all_rows if row["year"] == year] for year in range(2022, 2026)}
    oof_rows = []
    oof_probabilities = []
    for validation_year in (2023, 2024):
        train = [row for row in all_rows if 2022 <= row["year"] < validation_year]
        validation = rows_by_year[validation_year]
        probabilities = fit_predict(train, validation)
        oof_rows.extend(validation)
        oof_probabilities.extend(probabilities.tolist())
    oof_probabilities_array = np.asarray(oof_probabilities, dtype=float)
    calibration_days = session_counts[2023] + session_counts[2024]

    frontier = []
    for threshold in np.linspace(0.35, 0.70, 141):
        metrics = simulate(oof_rows, oof_probabilities_array, float(threshold))
        summary = compact(metrics, calibration_days)
        summary["threshold"] = round(float(threshold), 4)
        frontier.append(summary)

    eligible = [row for row in frontier if 32 <= row["cycles_per_100_days"] <= 48]
    if eligible:
        chosen = max(eligible, key=lambda row: (row["net"] >= 0, row["win_rate"], row["net"], -abs(row["cycles_per_100_days"] - 40)))
    else:
        chosen = min(frontier, key=lambda row: abs(row["cycles_per_100_days"] - 40))
    threshold = float(chosen["threshold"])

    final_train = [row for row in all_rows if 2022 <= row["year"] <= 2024]
    validation_rows = rows_by_year[2025]
    validation_probabilities = fit_predict(final_train, validation_rows)
    validation = simulate(validation_rows, validation_probabilities, threshold)

    by_family = {}
    for family in ("REVERSION_BUY", "REVERSION_SELL", "CONTINUATION_BUY", "CONTINUATION_SELL"):
        selected = [row for row in validation["rows"] if row["family"] == family]
        wins = sum(1 for row in selected if row["net"] > 0)
        by_family[family] = {
            "trades": len(selected),
            "win_rate": round(wins / len(selected) * 100, 2) if selected else 0,
            "net": round(sum(row["net"] for row in selected), 2),
        }

    print(json.dumps({
        "protocol": {
            "future_function": False,
            "features": FEATURE_NAMES,
            "execution": "next minute, fixed 15-minute exit",
            "costs": "0.02% per-side slippage, 0.025% commission/minimum 5, 0.05% sell stamp duty",
            "calibration": "walk-forward OOS 2023 and 2024",
            "validation": "2025 frozen until threshold selected",
            "holdout_2026_opened": False,
        },
        "session_counts": dict(session_counts),
        "candidate_counts": {str(year): len(rows) for year, rows in rows_by_year.items()},
        "selected_threshold": threshold,
        "calibration_oos": chosen,
        "validation_2025": compact(validation, session_counts[2025]),
        "validation_by_family": by_family,
        "frontier_near_target": sorted(frontier, key=lambda row: abs(row["cycles_per_100_days"] - 40))[:10],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
