#!/usr/bin/env python3
"""Walk-forward Zijin triple-barrier event research.

Signals and features are causal. Entries fill on the next minute. Each event is
labelled by the first subsequently observed profit target, stop, or timeout.
2025 remains untouched until both the barrier policy and probability threshold
have been selected from 2023/2024 walk-forward predictions.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier


def pct(base: float, value: float) -> float:
    return (value - base) / base * 100.0 if base > 0 else 0.0


def order_cost(side: str, price: float, quantity: int) -> float:
    turnover = price * quantity
    return max(5.0, turnover * 0.00025) + (turnover * 0.0005 if side == "SELL" else 0.0)


def trade_net(direction: int, entry_raw: float, exit_raw: float, quantity: int) -> float:
    entry = entry_raw * (1.0002 if direction > 0 else 0.9998)
    exit_price = exit_raw * (0.9998 if direction > 0 else 1.0002)
    if direction > 0:
        gross = (exit_price - entry) * quantity
        fees = order_cost("BUY", entry, quantity) + order_cost("SELL", exit_price, quantity)
    else:
        gross = (entry - exit_price) * quantity
        fees = order_cost("SELL", entry, quantity) + order_cost("BUY", exit_price, quantity)
    return gross - fees


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


def rolling_vwap(prices: list[float], volumes: list[float]) -> list[float]:
    amount = 0.0
    shares = 0.0
    result = []
    for price, volume in zip(prices, volumes):
        amount += price * max(0.0, volume)
        shares += max(0.0, volume)
        result.append(amount / shares if shares > 0 else price)
    return result


def position(prices: list[float], index: int, width: int) -> float:
    values = prices[max(0, index - width + 1):index + 1]
    low, high = min(values), max(values)
    return (prices[index] - low) / (high - low) if high > low else 0.5


def features(prices: list[float], volumes: list[float], vwaps: list[float], index: int,
             previous_close: float, direction: int, family: int) -> list[float]:
    def move(width: int) -> float:
        return pct(prices[max(0, index - width)], prices[index])

    def vwap_move(width: int) -> float:
        return pct(vwaps[max(0, index - width)], vwaps[index])

    history = volumes[max(0, index - 20):index]
    volume_mean = float(np.mean(history)) if history else volumes[index]
    returns = [pct(prices[cursor - 1], prices[cursor]) for cursor in range(max(1, index - 20), index + 1)]
    return [
        index / 241.0,
        pct(previous_close, prices[0]),
        move(1), move(2), move(3), move(5), move(10), move(20),
        pct(vwaps[index], prices[index]), vwap_move(3), vwap_move(10),
        position(prices, index, 10), position(prices, index, 20), position(prices, index, 40),
        min(10.0, volumes[index] / volume_mean if volume_mean > 0 else 1.0),
        min(10.0, float(np.mean(volumes[max(0, index - 2):index + 1])) / volume_mean if volume_mean > 0 else 1.0),
        float(np.std(returns[-5:])), float(np.std(returns[-10:])), float(np.std(returns[-20:])),
        sum(value > 0 for value in returns[-10:]) / max(1, len(returns[-10:])),
        float(direction), float(family),
    ]


def event_rows(session: dict, policy: dict) -> list[dict]:
    points = session.get("minutes") or []
    prices = [float(point.get("price") or 0) for point in points]
    volumes = [float(point.get("volume") or 0) for point in points]
    if len(prices) < 80 or min(prices) <= 0:
        return []
    vwaps = rolling_vwap(prices, volumes)
    previous_close = float(session.get("previousClose") or prices[0])
    quantity = max(300, math.floor((90_000 / previous_close) / 100) * 100)
    rows = []
    for index in range(20, len(prices) - policy["horizon"] - 2):
        time = str(points[index].get("time") or "").replace(":", "").zfill(4)
        if time < "0938" or time > "1430" or "1131" <= time < "1300":
            continue
        deviation = pct(vwaps[index], prices[index])
        mom1 = pct(prices[index - 1], prices[index])
        mom3 = pct(prices[index - 3], prices[index])
        prior3 = pct(prices[index - 6], prices[index - 3])
        vwap_slope = pct(vwaps[index - 10], vwaps[index])
        pos20 = position(prices, index, 20)
        candidates = []
        if deviation <= -0.10 and prior3 < 0 and mom1 > 0 and pos20 <= 0.45:
            candidates.append((1, 1, "REVERSION_BUY"))
        if deviation >= 0.10 and prior3 > 0 and mom1 < 0 and pos20 >= 0.55:
            candidates.append((-1, 1, "REVERSION_SELL"))
        if deviation >= 0.03 and vwap_slope > 0.01 and mom3 < 0 and mom1 > 0:
            candidates.append((1, 0, "CONTINUATION_BUY"))
        if deviation <= -0.03 and vwap_slope < -0.01 and mom3 > 0 and mom1 < 0:
            candidates.append((-1, 0, "CONTINUATION_SELL"))
        for direction, family, name in candidates:
            entry_index = index + 1
            entry = prices[entry_index]
            exit_index = entry_index + policy["horizon"]
            outcome = "TIMEOUT"
            for cursor in range(entry_index + 1, exit_index + 1):
                favorable = pct(entry, prices[cursor]) * direction
                if favorable >= policy["target"]:
                    exit_index, outcome = cursor, "TARGET"
                    break
                if favorable <= -policy["stop"]:
                    exit_index, outcome = cursor, "STOP"
                    break
            net = trade_net(direction, entry, prices[exit_index], quantity)
            rows.append({
                "date": str(session["date"]), "year": int(str(session["date"])[:4]),
                "signal_index": index, "entry_index": entry_index, "exit_index": exit_index,
                "direction": direction, "family": name, "features": features(
                    prices, volumes, vwaps, index, previous_close, direction, family,
                ),
                "label": int(net > 0), "net": net, "outcome": outcome,
            })
    return rows


def estimator() -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        learning_rate=0.045, max_iter=180, max_leaf_nodes=12,
        min_samples_leaf=100, l2_regularization=12.0, random_state=20260801,
    )


def probabilities(train: list[dict], test: list[dict]) -> np.ndarray:
    model = estimator()
    model.fit(np.asarray([row["features"] for row in train]), np.asarray([row["label"] for row in train]))
    return model.predict_proba(np.asarray([row["features"] for row in test]))[:, 1]


def simulate(rows: list[dict], probs: np.ndarray, threshold: float) -> dict:
    by_date: dict[str, list[tuple[dict, float]]] = defaultdict(list)
    for row, probability in zip(rows, probs):
        by_date[row["date"]].append((row, float(probability)))
    selected = []
    for date in sorted(by_date):
        day = sorted(by_date[date], key=lambda item: item[0]["signal_index"])
        last_exit = -1000
        for row, probability in day:
            if probability < threshold or row["signal_index"] <= last_exit + 5:
                continue
            selected.append({**row, "probability": probability})
            last_exit = row["exit_index"]
            break
    wins = sum(row["net"] > 0 for row in selected)
    positive = sum(row["net"] for row in selected if row["net"] > 0)
    negative = abs(sum(row["net"] for row in selected if row["net"] <= 0))
    return {
        "trades": len(selected), "wins": wins,
        "win_rate": wins / max(1, len(selected)) * 100,
        "net": sum(row["net"] for row in selected),
        "profit_factor": positive / negative if negative else None,
        "rows": selected,
    }


def compact(metrics: dict, days: int) -> dict:
    return {
        "trades": metrics["trades"], "wins": metrics["wins"],
        "win_rate": round(metrics["win_rate"], 2), "net": round(metrics["net"], 2),
        "average_net": round(metrics["net"] / max(1, metrics["trades"]), 2),
        "profit_factor": round(metrics["profit_factor"], 3) if metrics["profit_factor"] is not None else None,
        "cycles_per_100_days": round(metrics["trades"] / max(1, days) * 100, 2),
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: research-zijin-triple-barrier.py SESSIONS.jsonl")
    sessions = load_sessions(Path(sys.argv[1]))
    counts = defaultdict(int)
    for session in sessions:
        counts[int(str(session["date"])[:4])] += 1
    policies = [
        {"target": 0.30, "stop": 0.18, "horizon": 15},
        {"target": 0.35, "stop": 0.22, "horizon": 20},
        {"target": 0.40, "stop": 0.22, "horizon": 20},
        {"target": 0.45, "stop": 0.25, "horizon": 30},
    ]
    policy_results = []
    for policy in policies:
        rows = [row for session in sessions for row in event_rows(session, policy)]
        by_year = {year: [row for row in rows if row["year"] == year] for year in range(2022, 2026)}
        oof_rows, oof_probs = [], []
        for year in (2023, 2024):
            train = [row for row in rows if 2022 <= row["year"] < year]
            test = by_year[year]
            oof_rows.extend(test)
            oof_probs.extend(probabilities(train, test).tolist())
        days = counts[2023] + counts[2024]
        frontier = []
        for threshold in np.linspace(0.35, 0.75, 161):
            metrics = simulate(oof_rows, np.asarray(oof_probs), float(threshold))
            frontier.append({"threshold": float(threshold), **compact(metrics, days)})
        eligible = [row for row in frontier if 32 <= row["cycles_per_100_days"] <= 48]
        chosen = max(eligible or frontier, key=lambda row: (
            row["net"] > 0, row["profit_factor"] or 0,
            -abs(row["cycles_per_100_days"] - 40), row["win_rate"],
        ))
        policy_results.append({"policy": policy, "chosen_oof": chosen, "rows": rows, "by_year": by_year})
    chosen_policy = max(policy_results, key=lambda item: (
        item["chosen_oof"]["net"] > 0, item["chosen_oof"]["profit_factor"] or 0,
        -abs(item["chosen_oof"]["cycles_per_100_days"] - 40), item["chosen_oof"]["win_rate"],
    ))
    threshold = chosen_policy["chosen_oof"]["threshold"]
    rows = chosen_policy["rows"]
    validation = chosen_policy["by_year"][2025]
    validation_probs = probabilities([row for row in rows if row["year"] <= 2024], validation)
    validation_metrics = simulate(validation, validation_probs, threshold)
    family = {}
    for name in sorted(set(row["family"] for row in validation_metrics["rows"])):
        selected = [row for row in validation_metrics["rows"] if row["family"] == name]
        family[name] = {
            "trades": len(selected), "wins": sum(row["net"] > 0 for row in selected),
            "net": round(sum(row["net"] for row in selected), 2),
        }
    print(json.dumps({
        "protocol": {
            "future_function": False, "entry": "next minute", "exit": "first target/stop/timeout",
            "costs_included": True, "policy_and_threshold_selection": "2023/2024 walk-forward OOS",
            "frozen_validation": "2025",
        },
        "selected_policy": chosen_policy["policy"],
        "selection_oof": chosen_policy["chosen_oof"],
        "validation_2025": compact(validation_metrics, counts[2025]),
        "validation_by_family": family,
        "policy_frontier": [{"policy": item["policy"], "oof": item["chosen_oof"]} for item in policy_results],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
