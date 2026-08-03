#!/usr/bin/env python3
"""Causal search for early-failure exits and profit protection.

The selected signals are frozen by the 2022-only candidate model.  Signal
count is therefore unchanged.  Exit policies may only inspect minute prices
available after the next-minute adverse fill.  2023 and 2024 select a policy;
2025 is opened once for the final forward report.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


if len(sys.argv) < 4:
    raise SystemExit(
        "usage: python search-zijin-profit-protection.py FEATURES.jsonl "
        "EXECUTION_LABELS.jsonl SESSIONS.jsonl"
    )

FEATURES = Path(sys.argv[1])
LABELS = Path(sys.argv[2])
SESSIONS = Path(sys.argv[3])
OUTCOME_KEY = "h120_s0p8_t0p4"
THRESHOLD = 0.4013837
POSITIVE_DIRECTION = "正T"


def commission(turnover: float) -> float:
    return max(5.0, turnover * 0.00025)


def net_result(direction: str, entry: float, raw_exit: float, quantity: int) -> float:
    # Two basis points adverse execution on both sides, matching label export.
    if direction == POSITIVE_DIRECTION:
        exit_price = raw_exit * (1.0 - 0.0002)
        gross = (exit_price - entry) * quantity
        sell_turnover = exit_price * quantity
    else:
        exit_price = raw_exit * (1.0 + 0.0002)
        gross = (entry - exit_price) * quantity
        sell_turnover = entry * quantity
    entry_turnover = entry * quantity
    exit_turnover = exit_price * quantity
    fees = commission(entry_turnover) + commission(exit_turnover) + sell_turnover * 0.0005
    return gross - fees


features = pd.read_json(FEATURES, lines=True)
raw_labels = pd.read_json(LABELS, lines=True)
features["date"] = features["date"].astype(str)
features["time"] = features["time"].astype(str).str.zfill(4)

label_rows: list[dict] = []
for record in raw_labels.to_dict("records"):
    outcome = record["outcomes"].get(OUTCOME_KEY)
    if not outcome:
        continue
    label_rows.append({
        "date": str(record["date"]),
        "time": str(record["time"]).zfill(4),
        "direction": record["direction"],
        "executionQuantity": int(record["quantity"]),
        "entryTime": str(outcome["entryTime"]).zfill(4),
        "entryPrice": float(outcome["entryPrice"]),
        "originalExitTime": str(outcome["exitTime"]).zfill(4),
        "originalExitReason": outcome["reason"],
        "net": float(outcome["net"]),
        "win": int(outcome["win"]),
    })
labels = pd.DataFrame(label_rows)
frame = features.merge(labels, on=["date", "time", "direction"], how="inner")
frame = frame[frame["year"] <= 2025].copy()

numeric_candidates = [
    "score", "directionScore", "locationScore", "triggerScore",
    "locationPassed", "triggerPassed", "cycleAligned", "edge", "pairGap",
    "vwapDeviation", "pivotVwapDeviation", "similaritySamples", "blockers",
    "alignedDivergence", "divergenceStrength", "opposingDivergence",
    "alignedPivotAge", "alignedVolumeConfirmed", "alignedVolumeRatio",
    "alignedPriceExtensionPct", "alignedMacdConfirmed", "alignedMacdImprovementPct",
    "opposingPivotAge", "opposingVolumeConfirmed", "opposingVolumeRatio",
    "opposingPriceExtensionPct", "opposingMacdConfirmed", "opposingMacdImprovementPct",
    "rangeConfirmed", "rangeCrossings", "rangeAmplitude", "rangeVwapDrift",
    "minuteIndex", "return1", "return3", "return5", "return10", "return15",
    "return30", "volumeRatio3", "volumeRatio5", "volumeRatio10", "volumeRatio20",
    "range3", "range5", "range10", "range20", "fromSessionHigh", "fromSessionLow",
    "target_session_return", "target_vwap_deviation", "peer_session_return",
    "peer_dispersion", "peer_breadth_positive", "peer_breadth_above_vwap",
    "peer_return1", "peer_return3", "peer_return5", "peer_return10", "peer_return15",
    "peer_vwap_deviation", "copper_session_return", "copper_return3", "copper_return5",
    "copper_return10", "copper_vwap_deviation", "gold_session_return", "gold_return3",
    "gold_return5", "gold_return10", "gold_vwap_deviation", "nonferrous_session_return",
    "nonferrous_return3", "nonferrous_return5", "nonferrous_return10",
    "nonferrous_vwap_deviation", "peer_residual", "copper_residual", "gold_residual",
    "nonferrous_residual", "peer_residual1", "peer_residual3", "peer_residual5",
    "peer_residual10", "peer_residual15", "peer_relative_vwap", "peer_lead3",
    "copper_lead3", "gold_lead3", "nonferrous_lead3",
]
categorical_candidates = ["direction", "cyclePreference", "pivotAssessment"]
numeric = [name for name in numeric_candidates if name in frame.columns]
categorical = [name for name in categorical_candidates if name in frame.columns]
model_features = numeric + categorical

forbidden = ("target15", "mfe", "mae", "barrier", "outcome", "exit", "net", "win", "future")
leaks = [name for name in model_features if any(token in name.lower() for token in forbidden)]
if leaks:
    raise RuntimeError(f"future/outcome feature leakage detected: {leaks}")

preprocessor = ColumnTransformer([
    ("numeric", Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
    ]), numeric),
    ("categorical", Pipeline([
        ("impute", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ]), categorical),
], sparse_threshold=0)

fit = frame[frame["year"] == 2022].copy()
transformed_fit = preprocessor.fit_transform(fit[model_features])
win_model = HistGradientBoostingClassifier(
    learning_rate=0.055, max_iter=110, max_leaf_nodes=15,
    min_samples_leaf=24, l2_regularization=1.2, random_state=17,
)
stop_model = HistGradientBoostingClassifier(
    learning_rate=0.05, max_iter=110, max_leaf_nodes=15,
    min_samples_leaf=24, l2_regularization=1.8, random_state=23,
)
win_model.fit(transformed_fit, fit["win"])
stop_model.fit(transformed_fit, (fit["originalExitReason"] == "hard-stop").astype(int))


def clock(value: str) -> int:
    text = str(value).zfill(4)
    return int(text[:2]) * 60 + int(text[2:])


def market_minute(value: str) -> int:
    text = str(value).zfill(4)
    hours, minutes = int(text[:2]), int(text[2:])
    if hours < 12:
        return (hours - 9) * 60 + minutes - 30
    return 120 + (hours - 13) * 60 + minutes


def select_signals(rows: pd.DataFrame) -> pd.DataFrame:
    transformed = preprocessor.transform(rows[model_features])
    rows = rows.copy()
    rows["modelScore"] = win_model.predict_proba(transformed)[:, 1] - 3.0 * stop_model.predict_proba(transformed)[:, 1]
    rows["clock"] = rows["time"].map(clock)
    rows["originalExitClock"] = rows["originalExitTime"].map(clock)
    rows.sort_values(["date", "clock", "modelScore"], ascending=[True, True, False], inplace=True)
    selected: list[pd.Series] = []
    for _, day in rows.groupby("date", sort=True):
        last_exit = -10_000
        count = 0
        for _, row in day.iterrows():
            if float(row["modelScore"]) < THRESHOLD or int(row["clock"]) < last_exit:
                continue
            selected.append(row.copy())
            last_exit = int(row["originalExitClock"])
            count += 1
            if count >= 2:
                break
    return pd.DataFrame(selected)


session_map: dict[str, list[dict]] = {}
with SESSIONS.open("r", encoding="utf-8") as handle:
    for line in handle:
        record = json.loads(line)
        date = str(record["date"])
        if date <= "20251231":
            session_map[date] = record["minutes"]


def directional_return(direction: str, entry: float, raw_price: float) -> float:
    if direction == POSITIVE_DIRECTION:
        return (raw_price / entry - 1.0) * 100.0
    return (entry / raw_price - 1.0) * 100.0


def simulate(row: pd.Series, policy: dict) -> tuple[float, str, float, float]:
    minutes = session_map.get(str(row["date"]), [])
    index = next((i for i, bar in enumerate(minutes) if str(bar["time"]).zfill(4) == row["entryTime"]), -1)
    if index < 0:
        return float(row["net"]), "missing-session", 0.0, 0.0
    entry = float(row["entryPrice"])
    quoted_entry = entry / 1.0002 if row["direction"] == POSITIVE_DIRECTION else entry / 0.9998
    entry_minute = market_minute(row["entryTime"])
    maximum = -999.0
    minimum = 999.0
    reason = "max-hold"
    exit_price = float(minutes[index]["price"])
    # The entry consumes the next-minute quote. Earliest causal exit check is
    # the following minute, exactly as in the label exporter.
    for bar in minutes[index + 1:]:
        raw_price = float(bar["price"])
        held = market_minute(str(bar["time"]).zfill(4)) - entry_minute
        result = directional_return(str(row["direction"]), quoted_entry, raw_price)
        maximum = max(maximum, result)
        minimum = min(minimum, result)
        exit_price = raw_price
        if result <= -policy["hardStop"]:
            reason = "hard-stop"
            break
        if result >= policy["target"]:
            reason = "take-profit"
            break
        if held >= policy["stallMinutes"] and maximum < policy["stallMfe"]:
            reason = "early-stall"
            break
        if policy["breakActivation"] > 0 and maximum >= policy["breakActivation"] and result <= policy["profitFloor"]:
            reason = "profit-floor"
            break
        if policy["trailActivation"] > 0 and maximum >= policy["trailActivation"] and result <= maximum - policy["trailRetrace"]:
            reason = "trailing"
            break
        if held >= policy["maxHold"] or str(bar["time"]).zfill(4) >= "1450":
            reason = "max-hold"
            break
    net = net_result(str(row["direction"]), entry, exit_price, int(row["executionQuantity"]))
    return net, reason, maximum, minimum


def evaluate(rows: pd.DataFrame, policy: dict, total_days: int) -> dict:
    results = [simulate(row, policy) for _, row in rows.iterrows()]
    values = np.array([item[0] for item in results], dtype=float)
    reasons = pd.Series([item[1] for item in results])
    return {
        "cycles": int(len(values)),
        "cyclesPer100Days": round(len(values) / max(1, total_days) * 100.0, 2),
        "wins": int((values > 0).sum()),
        "winRate": round(float((values > 0).mean() * 100.0), 2),
        "net": round(float(values.sum()), 2),
        "averageNet": round(float(values.mean()), 2),
        "hardStops": int((reasons == "hard-stop").sum()),
        "earlyStalls": int((reasons == "early-stall").sum()),
        "profitProtected": int(reasons.isin(["profit-floor", "trailing"]).sum()),
        "averageMfe": round(float(np.mean([item[2] for item in results])), 4),
        "averageMae": round(float(np.mean([item[3] for item in results])), 4),
    }


selected = {
    year: select_signals(frame[frame["year"] == year].copy())
    for year in (2023, 2024, 2025)
}
days = {year: int(frame[frame["year"] == year]["date"].nunique()) for year in selected}

protections = [
    (0, 0.0, 0.0, 0.0),
    (0.15, 0.00, 0.0, 0.0),
    (0.20, 0.02, 0.0, 0.0),
    (0.25, 0.04, 0.0, 0.0),
    (0.0, 0.0, 0.20, 0.10),
    (0.0, 0.0, 0.25, 0.12),
    (0.0, 0.0, 0.35, 0.15),
    (0.20, 0.02, 0.30, 0.15),
]

policies: list[dict] = []
for hard_stop in (0.45, 0.60, 0.80):
    for target in (0.30, 0.40, 0.50):
        for max_hold in (30, 60, 120):
            for stall_minutes, stall_mfe in ((3, 0.03), (5, 0.05), (8, 0.08), (12, 0.10), (999, -1.0)):
                for break_activation, profit_floor, trail_activation, trail_retrace in protections:
                    policies.append({
                        "hardStop": hard_stop, "target": target, "maxHold": max_hold,
                        "stallMinutes": stall_minutes, "stallMfe": stall_mfe,
                        "breakActivation": break_activation, "profitFloor": profit_floor,
                        "trailActivation": trail_activation, "trailRetrace": trail_retrace,
                    })

ranked: list[tuple] = []
for policy in policies:
    research = evaluate(selected[2023], policy, days[2023])
    calibration = evaluate(selected[2024], policy, days[2024])
    quality = (
        research["winRate"] >= 50 and calibration["winRate"] >= 50
        and research["net"] > 0 and calibration["net"] > 0
    )
    ranked.append((
        0 if quality else 1,
        -min(research["net"], calibration["net"]),
        -(research["net"] + calibration["net"]),
        -min(research["winRate"], calibration["winRate"]),
        policy, research, calibration,
    ))
ranked.sort(key=lambda item: item[:4])

reports = []
for item in ranked[:20]:
    validation = evaluate(selected[2025], item[4], days[2025])
    selected_without_2025 = item[0] == 0
    forward_pass = selected_without_2025 and validation["winRate"] >= 50 and validation["net"] > 0
    reports.append({
        "policy": item[4],
        "selectedWithout2025": selected_without_2025,
        "forwardPass": forward_pass,
        "research2023": item[5],
        "calibration2024": item[6],
        "validation2025": validation,
    })

output = {
    "method": "2022-only candidate model; frozen count; causal minute exit protection",
    "futureLeakage": False,
    "threshold": THRESHOLD,
    "policiesTested": len(policies),
    "selectedSignalCounts": {str(year): len(rows) for year, rows in selected.items()},
    "selectedOriginalLabels": {
        str(year): {
            "winRate": round(float((rows["net"] > 0).mean() * 100.0), 2),
            "net": round(float(rows["net"].sum()), 2),
        }
        for year, rows in selected.items()
    },
    "baseline": {
        str(year): evaluate(rows, {
            "hardStop": 0.8, "target": 0.4, "maxHold": 120,
            "stallMinutes": 999, "stallMfe": -1.0,
            "breakActivation": 0.0, "profitFloor": 0.0,
            "trailActivation": 0.0, "trailRetrace": 0.0,
        }, days[year])
        for year, rows in selected.items()
    },
    "baselineMismatchSample": [
        {
            "date": str(row["date"]), "time": str(row["time"]),
            "direction": str(row["direction"]),
            "originalExit": str(row["originalExitTime"]),
            "originalNet": round(float(row["net"]), 2),
            "simulated": tuple(round(value, 2) if isinstance(value, float) else value for value in simulate(row, {
                "hardStop": 0.8, "target": 0.4, "maxHold": 120,
                "stallMinutes": 999, "stallMfe": -1.0,
                "breakActivation": 0.0, "profitFloor": 0.0,
                "trailActivation": 0.0, "trailRetrace": 0.0,
            })),
        }
        for _, row in selected[2023].head(8).iterrows()
    ],
    "selectedCount": sum(1 for report in reports if report["selectedWithout2025"]),
    "forwardPassCount": sum(1 for report in reports if report["forwardPass"]),
    "reports": reports,
}
print(json.dumps(output, ensure_ascii=False, indent=2))
