#!/usr/bin/env python3
"""Walk-forward model that chooses an exit profile per causal candidate.

All 48 exit profiles are known rule templates, not future-selected outcomes.
The model fits 2022 only and predicts expected net return, win probability and
hard-stop probability for each candidate/profile pair.  The highest predicted
utility profile is chosen before the trade opens.  2023 and 2024 select the
utility/threshold; 2025 is report-only and 2026 remains unopened.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


if len(sys.argv) < 3:
    raise SystemExit("usage: python train-zijin-adaptive-exit.py FEATURES.jsonl LABELS.jsonl")

features = pd.read_json(Path(sys.argv[1]), lines=True)
raw_labels = pd.read_json(Path(sys.argv[2]), lines=True)
features["date"] = features["date"].astype(str)
features["time"] = features["time"].astype(str).str.zfill(4)


def parse_profile(key: str) -> tuple[int, float, float]:
    match = re.fullmatch(r"h(\d+)_s(\d+)p(\d+)_t(\d+)p(\d+)", key)
    if not match:
        raise ValueError(f"unexpected outcome key: {key}")
    hold, stop_whole, stop_fraction, target_whole, target_fraction = match.groups()
    return (
        int(hold),
        float(f"{stop_whole}.{stop_fraction}"),
        float(f"{target_whole}.{target_fraction}"),
    )


label_rows: list[dict] = []
for row in raw_labels.to_dict("records"):
    for outcome_key, outcome in row["outcomes"].items():
        hold, stop, target = parse_profile(outcome_key)
        turnover = max(1.0, float(outcome["entryPrice"]) * int(row["quantity"]))
        label_rows.append({
            "date": str(row["date"]),
            "time": str(row["time"]).zfill(4),
            "direction": row["direction"],
            "executionQuantity": int(row["quantity"]),
            "outcomeKey": outcome_key,
            "profileHold": hold,
            "profileStop": stop,
            "profileTarget": target,
            "exitTime": str(outcome["exitTime"]).zfill(4),
            "exitReason": outcome["reason"],
            "net": float(outcome["net"]),
            "netPct": float(outcome["net"]) / turnover * 100.0,
            "win": int(outcome["win"]),
        })

labels = pd.DataFrame(label_rows)
frame = features.merge(labels, on=["date", "time", "direction"], how="inner")
frame = frame[frame["year"] <= 2025].copy()

numeric_candidates = [
    "score", "directionScore", "locationScore", "triggerScore", "locationPassed",
    "triggerPassed", "cycleAligned", "edge", "pairGap", "vwapDeviation",
    "pivotVwapDeviation", "similaritySamples", "blockers", "alignedDivergence",
    "divergenceStrength", "opposingDivergence", "alignedPivotAge",
    "alignedVolumeConfirmed", "alignedVolumeRatio", "alignedPriceExtensionPct",
    "alignedMacdConfirmed", "alignedMacdImprovementPct", "opposingPivotAge",
    "opposingVolumeConfirmed", "opposingVolumeRatio", "opposingPriceExtensionPct",
    "opposingMacdConfirmed", "opposingMacdImprovementPct", "rangeConfirmed",
    "rangeCrossings", "rangeAmplitude", "rangeVwapDrift", "minuteIndex", "return1",
    "return3", "return5", "return10", "return15", "return30", "volumeRatio3",
    "volumeRatio5", "volumeRatio10", "volumeRatio20", "range3", "range5", "range10",
    "range20", "fromSessionHigh", "fromSessionLow", "target_session_return",
    "target_vwap_deviation", "peer_session_return", "peer_dispersion",
    "peer_breadth_positive", "peer_breadth_above_vwap", "peer_return1", "peer_return3",
    "peer_return5", "peer_return10", "peer_return15", "peer_vwap_deviation",
    "copper_session_return", "copper_return3", "copper_return5", "copper_return10",
    "copper_vwap_deviation", "gold_session_return", "gold_return3", "gold_return5",
    "gold_return10", "gold_vwap_deviation", "nonferrous_session_return",
    "nonferrous_return3", "nonferrous_return5", "nonferrous_return10",
    "nonferrous_vwap_deviation", "peer_residual", "copper_residual", "gold_residual",
    "nonferrous_residual", "peer_residual1", "peer_residual3", "peer_residual5",
    "peer_residual10", "peer_residual15", "peer_relative_vwap", "peer_lead3",
    "copper_lead3", "gold_lead3", "nonferrous_lead3", "profileHold", "profileStop",
    "profileTarget",
]
categorical_candidates = ["direction", "cyclePreference", "pivotAssessment"]
numeric = [name for name in numeric_candidates if name in frame.columns]
categorical = [name for name in categorical_candidates if name in frame.columns]
model_features = numeric + categorical

forbidden = ("target15", "mfe", "mae", "barrier", "outcome", "exit", "net", "win", "future")
leaks = [
    name for name in model_features
    if name not in {"profileTarget"} and any(token in name.lower() for token in forbidden)
]
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
research = frame[frame["year"] == 2023].copy()
calibration = frame[frame["year"] == 2024].copy()
validation = frame[frame["year"] == 2025].copy()

fit_x = preprocessor.fit_transform(fit[model_features])
split_x = {
    "research": preprocessor.transform(research[model_features]),
    "calibration": preprocessor.transform(calibration[model_features]),
    "validation": preprocessor.transform(validation[model_features]),
}

net_model = HistGradientBoostingRegressor(
    learning_rate=0.045, max_iter=150, max_leaf_nodes=15,
    min_samples_leaf=60, l2_regularization=2.0, random_state=31,
)
win_model = HistGradientBoostingClassifier(
    learning_rate=0.045, max_iter=135, max_leaf_nodes=15,
    min_samples_leaf=60, l2_regularization=1.5, random_state=37,
)
stop_model = HistGradientBoostingClassifier(
    learning_rate=0.045, max_iter=135, max_leaf_nodes=15,
    min_samples_leaf=60, l2_regularization=2.0, random_state=41,
)
net_model.fit(fit_x, fit["netPct"])
win_model.fit(fit_x, fit["win"])
stop_model.fit(fit_x, (fit["exitReason"] == "hard-stop").astype(int))


def clock_minutes(value: str) -> int:
    text = str(value).zfill(4)
    return int(text[:2]) * 60 + int(text[2:])


def choose_profiles(rows: pd.DataFrame, x: np.ndarray, win_weight: float, stop_penalty: float) -> pd.DataFrame:
    work = rows.copy()
    work["predictedNetPct"] = net_model.predict(x)
    work["predictedWin"] = win_model.predict_proba(x)[:, 1]
    work["predictedStop"] = stop_model.predict_proba(x)[:, 1]
    work["utility"] = (
        work["predictedNetPct"]
        + win_weight * (work["predictedWin"] - 0.5)
        - stop_penalty * work["predictedStop"]
    )
    work.sort_values(
        ["date", "time", "direction", "utility", "profileStop", "profileHold"],
        ascending=[True, True, True, False, True, True],
        inplace=True,
    )
    return work.drop_duplicates(["date", "time", "direction"], keep="first").copy()


def execute(chosen: pd.DataFrame, threshold: float) -> dict:
    work = chosen[[
        "date", "time", "exitTime", "exitReason", "net", "utility", "outcomeKey",
    ]].copy()
    work["clock"] = work["time"].map(clock_minutes)
    work["exitClock"] = work["exitTime"].map(clock_minutes)
    work.sort_values(["date", "clock", "utility"], ascending=[True, True, False], inplace=True)
    selected = []
    for _, day in work.groupby("date", sort=True):
        last_exit = -10_000
        count = 0
        for row in day.itertuples(index=False):
            if row.utility < threshold or row.clock < last_exit:
                continue
            selected.append(row)
            last_exit = int(row.exitClock)
            count += 1
            if count >= 2:
                break
    days = chosen["date"].nunique()
    if not selected:
        return {"cycles": 0, "wins": 0, "winRate": 0, "cyclesPer100Days": 0,
                "net": 0, "averageNet": 0, "stops": 0, "profiles": {}}
    result = pd.DataFrame(selected, columns=work.columns)
    return {
        "cycles": int(len(result)),
        "wins": int((result["net"] > 0).sum()),
        "winRate": round(float((result["net"] > 0).mean() * 100), 2),
        "cyclesPer100Days": round(float(len(result) / max(1, days) * 100), 2),
        "net": round(float(result["net"].sum()), 2),
        "averageNet": round(float(result["net"].mean()), 2),
        "stops": int((result["exitReason"] == "hard-stop").sum()),
        "profiles": {str(key): int(value) for key, value in result["outcomeKey"].value_counts().head(8).items()},
    }


reports = []
utility_specs = [
    (0.00, 0.00),
    (0.03, 0.03),
    (0.05, 0.06),
    (0.08, 0.10),
    (0.12, 0.16),
]
for win_weight, stop_penalty in utility_specs:
    chosen = {
        "research": choose_profiles(research, split_x["research"], win_weight, stop_penalty),
        "calibration": choose_profiles(calibration, split_x["calibration"], win_weight, stop_penalty),
        "validation": choose_profiles(validation, split_x["validation"], win_weight, stop_penalty),
    }
    thresholds = np.unique(np.quantile(chosen["calibration"]["utility"], np.linspace(0.45, 0.97, 24)))
    ranked = []
    for threshold in thresholds:
        r23 = execute(chosen["research"], float(threshold))
        c24 = execute(chosen["calibration"], float(threshold))
        coverage_ok = (
            32 <= r23["cyclesPer100Days"] <= 50
            and 32 <= c24["cyclesPer100Days"] <= 50
        )
        quality_ok = (
            r23["winRate"] >= 50 and c24["winRate"] >= 50
            and r23["net"] > 0 and c24["net"] > 0
        )
        ranked.append((
            0 if coverage_ok and quality_ok else 1,
            0 if coverage_ok else 1,
            abs(r23["cyclesPer100Days"] - 40) + abs(c24["cyclesPer100Days"] - 40),
            -(r23["net"] + c24["net"]),
            float(threshold), r23, c24,
        ))
    ranked.sort(key=lambda item: item[:4])
    best = ranked[0]
    threshold, r23, c24 = best[4], best[5], best[6]
    v25 = execute(chosen["validation"], threshold)
    selected = (
        32 <= r23["cyclesPer100Days"] <= 50 and 32 <= c24["cyclesPer100Days"] <= 50
        and r23["winRate"] >= 50 and c24["winRate"] >= 50
        and r23["net"] > 0 and c24["net"] > 0
    )
    forward_pass = (
        selected and 32 <= v25["cyclesPer100Days"] <= 50
        and v25["winRate"] >= 50 and v25["net"] > 0
    )
    reports.append({
        "winWeight": win_weight,
        "stopPenalty": stop_penalty,
        "threshold": round(float(threshold), 7),
        "selectedWithout2025": selected,
        "forwardPass": forward_pass,
        "research2023": r23,
        "calibration2024": c24,
        "validation2025": v25,
    })


def rank(report: dict) -> tuple:
    r23, c24 = report["research2023"], report["calibration2024"]
    return (
        0 if report["selectedWithout2025"] else 1,
        abs(r23["cyclesPer100Days"] - 40) + abs(c24["cyclesPer100Days"] - 40),
        -(r23["net"] + c24["net"]),
        -min(r23["winRate"], c24["winRate"]),
    )


reports.sort(key=rank)
print(json.dumps({
    "protocol": {
        "causalCandidateFeaturesOnly": True,
        "exitProfileChosenBeforeEntry": True,
        "modelFit": "2022",
        "outOfSampleResearch": "2023",
        "calibration": "2024",
        "forwardReportOnly": "2025",
        "holdout2026Opened": False,
        "candidateExitProfiles": int(frame["outcomeKey"].nunique()),
        "featureCount": len(model_features),
        "forbiddenFeatureMatches": leaks,
        "maximumCyclesPerDay": 2,
    },
    "selectedCount": sum(1 for report in reports if report["selectedWithout2025"]),
    "selectedForwardPassCount": sum(1 for report in reports if report["forwardPass"]),
    "reports": reports,
}, ensure_ascii=False, indent=2))
