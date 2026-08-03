#!/usr/bin/env python3
"""Walk-forward candidate-quality baseline for Zijin intraday T signals.

The model sees only fields exported at the candidate timestamp.  2022-2023
trains the model, 2024 calibrates a probability threshold near 40 formal
15-minute cycles per 100 days, and 2025 is reported once as forward validation.
2026 remains unopened.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


if len(sys.argv) < 2:
    raise SystemExit("usage: python train-zijin-candidate-quality.py CANDIDATES.jsonl")

path = Path(sys.argv[1])
frame = pd.read_json(path, lines=True)
frame = frame[frame["year"] <= 2025].copy()
label_column = "barrierProfitable" if "barrierProfitable" in frame.columns else "profitable"
return_column = "barrierNetPct" if "barrierNetPct" in frame.columns else "netReturnPct"

numeric = [
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
    "return30", "volumeRatio3", "volumeRatio5", "volumeRatio10",
    "volumeRatio20", "range3", "range5", "range10", "range20",
    "fromSessionHigh", "fromSessionLow",
    "target_session_return", "target_vwap_deviation",
    "peer_session_return", "peer_dispersion", "peer_breadth_positive",
    "peer_breadth_above_vwap", "peer_return1", "peer_return3",
    "peer_return5", "peer_return10", "peer_return15", "peer_vwap_deviation",
    "copper_session_return", "copper_return3", "copper_return5",
    "copper_return10", "copper_vwap_deviation",
    "gold_session_return", "gold_return3", "gold_return5",
    "gold_return10", "gold_vwap_deviation",
    "nonferrous_session_return", "nonferrous_return3", "nonferrous_return5",
    "nonferrous_return10", "nonferrous_vwap_deviation",
    "peer_residual", "copper_residual", "gold_residual", "nonferrous_residual",
    "peer_residual1", "peer_residual3", "peer_residual5", "peer_residual10",
    "peer_residual15", "peer_relative_vwap", "peer_lead3", "copper_lead3",
    "gold_lead3", "nonferrous_lead3",
]
categorical = ["direction", "cyclePreference", "pivotAssessment"]
numeric = [name for name in numeric if name in frame.columns]
categorical = [name for name in categorical if name in frame.columns]
features = numeric + categorical

forbidden_fragments = (
    "target15", "mfe", "mae", "exit", "holding", "profitable",
    "barrier", "netreturn", "netyuan", "future",
)
leaked_features = [
    name for name in features
    if any(fragment in name.lower() for fragment in forbidden_fragments)
]
if leaked_features:
    raise RuntimeError(f"future/outcome feature leakage detected: {leaked_features}")

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

models = {
    "logistic": LogisticRegression(C=0.35, max_iter=3000, class_weight="balanced", random_state=7),
    "hist-gradient": HistGradientBoostingClassifier(
        learning_rate=0.045,
        max_iter=160,
        max_leaf_nodes=9,
        min_samples_leaf=35,
        l2_regularization=1.5,
        random_state=7,
    ),
    "random-forest": RandomForestClassifier(
        n_estimators=300,
        max_depth=5,
        min_samples_leaf=24,
        max_features=0.55,
        class_weight="balanced_subsample",
        n_jobs=-1,
        random_state=7,
    ),
}

train = frame[frame["year"] <= 2023].copy()
calibration = frame[frame["year"] == 2024].copy()
validation = frame[frame["year"] == 2025].copy()


def clock_minutes(value: str) -> int:
    text = str(value).zfill(4)
    return int(text[:2]) * 60 + int(text[2:])


def execute(rows: pd.DataFrame, probabilities: np.ndarray, threshold: float) -> dict:
    work = rows.copy()
    work["probability"] = probabilities
    work["clock"] = work["time"].map(clock_minutes)
    work.sort_values(["date", "clock", "probability"], ascending=[True, True, False], inplace=True)
    selected = []
    for _, day in work.groupby("date", sort=True):
        last_exit = -10_000
        count = 0
        for _, row in day.iterrows():
            if row["probability"] < threshold or row["clock"] < last_exit:
                continue
            selected.append(row)
            count += 1
            last_exit = int(row["clock"]) + 15
            if count >= 2:
                break
    if not selected:
        return {
            "cycles": 0, "wins": 0, "winRate": 0, "cyclesPer100Days": 0,
            "netYuan": 0, "averageNetYuan": 0,
        }
    chosen = pd.DataFrame(selected)
    execution_price = chosen["barrierEntryPrice"] if "barrierEntryPrice" in chosen else chosen["price"]
    net_yuan = chosen[return_column] / 100 * execution_price * chosen["quantity"]
    days = rows["date"].nunique()
    wins = int((net_yuan > 0).sum())
    return {
        "cycles": int(len(chosen)),
        "wins": wins,
        "winRate": round(wins / len(chosen) * 100, 2),
        "cyclesPer100Days": round(len(chosen) / max(1, days) * 100, 2),
        "netYuan": round(float(net_yuan.sum()), 2),
        "averageNetYuan": round(float(net_yuan.mean()), 2),
        "averageProbability": round(float(chosen["probability"].mean()), 4),
    }


def calibrate_threshold(rows: pd.DataFrame, probabilities: np.ndarray) -> tuple[float, dict]:
    candidates = np.unique(np.quantile(probabilities, np.linspace(0.45, 0.98, 220)))
    scored = []
    for threshold in candidates:
        result = execute(rows, probabilities, float(threshold))
        coverage_distance = abs(result["cyclesPer100Days"] - 40)
        result_quality = result["winRate"] >= 50 and result["netYuan"] > 0
        scored.append((
            0 if result_quality else 1,
            coverage_distance,
            -result["netYuan"],
            -result["winRate"],
            float(threshold),
            result,
        ))
    scored.sort(key=lambda item: item[:4])
    best = scored[0]
    return best[4], best[5]


reports = []
for name, estimator in models.items():
    pipeline = Pipeline([("features", preprocessor), ("model", estimator)])
    pipeline.fit(train[features], train[label_column])
    calibration_probability = pipeline.predict_proba(calibration[features])[:, 1]
    threshold, calibration_result = calibrate_threshold(calibration, calibration_probability)
    validation_probability = pipeline.predict_proba(validation[features])[:, 1]
    validation_result = execute(validation, validation_probability, threshold)
    reports.append({
        "model": name,
        "threshold": round(threshold, 6),
        "calibration2024": calibration_result,
        "validation2025": validation_result,
    })


def calibration_rank(report: dict) -> tuple:
    result = report["calibration2024"]
    quality = result["winRate"] >= 50 and result["netYuan"] > 0
    return (
        0 if quality else 1,
        abs(result["cyclesPer100Days"] - 40),
        -result["netYuan"],
        -result["winRate"],
    )


reports.sort(key=calibration_rank)
selected = reports[0]
print(json.dumps({
    "protocol": {
        "causalFeaturesOnly": True,
        "fixedExitMinutes": None,
        "exitPolicy": "first 0.35% target / 0.18% stop / 20-minute timeout",
        "costsIncluded": True,
        "training": "2022-2023",
        "thresholdCalibration": "2024",
        "forwardValidation": "2025",
        "holdout2026Opened": False,
        "maximumCyclesPerDay": 2,
        "featureAudit": {
            "featureCount": len(features),
            "forbiddenFeatureMatches": leaked_features,
            "peerContextIncluded": "peer_residual3" in features,
            "futureRowsUsed": 0,
        },
    },
    "sampleCounts": {
        "training": int(len(train)),
        "calibration": int(len(calibration)),
        "validation": int(len(validation)),
    },
    "selectedByCalibrationOnly": selected["model"],
    "selectedReport": selected,
    "allModelReports": reports,
}, ensure_ascii=False, indent=2))
