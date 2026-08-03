#!/usr/bin/env python3
"""Strict walk-forward meta-label search for Zijin intraday candidates.

For evaluation year Y, the model fits years before Y-1, calibrates its score
threshold on Y-1, then evaluates Y.  2024 is the research selection year and
2025 remains the final untouched forward report.  No within-year random split
or future-derived feature is allowed.
"""

from __future__ import annotations

import json
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
    raise SystemExit("usage: python train-zijin-rolling-meta-model.py FEATURES.jsonl LABELS.jsonl")

features = pd.read_json(Path(sys.argv[1]), lines=True)
raw_labels = pd.read_json(Path(sys.argv[2]), lines=True)
features["date"] = features["date"].astype(str)
features["time"] = features["time"].astype(str).str.zfill(4)

label_rows: list[dict] = []
for record in raw_labels.to_dict("records"):
    base = {
        "date": str(record["date"]), "time": str(record["time"]).zfill(4),
        "direction": record["direction"], "quantity": int(record["quantity"]),
    }
    for outcome_key, outcome in record["outcomes"].items():
        turnover = max(1.0, float(outcome["entryPrice"]) * int(record["quantity"]))
        label_rows.append({
            **base, "outcomeKey": outcome_key,
            "net": float(outcome["net"]), "netPct": float(outcome["net"]) / turnover * 100.0,
            "win": int(outcome["win"]), "exitTime": str(outcome["exitTime"]).zfill(4),
            "stop": int(outcome["reason"] == "hard-stop"),
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


def make_preprocessor() -> ColumnTransformer:
    return ColumnTransformer([
        ("numeric", Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]), numeric),
        ("categorical", Pipeline([
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]), categorical),
    ], sparse_threshold=0)


def clock(value: str) -> int:
    text = str(value).zfill(4)
    return int(text[:2]) * 60 + int(text[2:])


def execute(rows: pd.DataFrame, scores: np.ndarray, threshold: float) -> dict:
    work = rows[["date", "time", "exitTime", "net", "stop", "direction"]].copy()
    work["modelScore"] = scores
    work["clock"] = work["time"].map(clock)
    work["exitClock"] = work["exitTime"].map(clock)
    work.sort_values(["date", "clock", "modelScore"], ascending=[True, True, False], inplace=True)
    chosen: list[pd.Series] = []
    for _, day in work.groupby("date", sort=True):
        last_exit = -10_000
        count = 0
        for _, row in day.iterrows():
            if float(row["modelScore"]) < threshold or int(row["clock"]) < last_exit:
                continue
            chosen.append(row)
            last_exit = int(row["exitClock"])
            count += 1
            if count >= 2:
                break
    days = int(rows["date"].nunique())
    if not chosen:
        return {"cycles": 0, "cyclesPer100Days": 0, "winRate": 0, "net": 0,
                "averageNet": 0, "stops": 0}
    picked = pd.DataFrame(chosen)
    return {
        "cycles": int(len(picked)),
        "cyclesPer100Days": round(len(picked) / max(1, days) * 100.0, 2),
        "winRate": round(float((picked["net"] > 0).mean() * 100.0), 2),
        "net": round(float(picked["net"].sum()), 2),
        "averageNet": round(float(picked["net"].mean()), 2),
        "stops": int(picked["stop"].sum()),
        "positiveDirection": int((picked["direction"] == "正T").sum()),
    }


def choose_threshold(rows: pd.DataFrame, scores: np.ndarray) -> tuple[float, dict]:
    ranked = []
    for threshold in np.unique(np.quantile(scores, np.linspace(0.30, 0.92, 32))):
        result = execute(rows, scores, float(threshold))
        coverage_ok = 32 <= result["cyclesPer100Days"] <= 50
        quality_ok = coverage_ok and result["winRate"] >= 50 and result["net"] > 0
        ranked.append((
            0 if quality_ok else 1, 0 if coverage_ok else 1,
            abs(result["cyclesPer100Days"] - 40), -result["net"],
            -result["winRate"], float(threshold), result,
        ))
    ranked.sort(key=lambda item: item[:5])
    return ranked[0][5], ranked[0][6]


ranking = (
    frame[frame["year"] <= 2023]
    .groupby("outcomeKey", as_index=False)
    .agg(meanNet=("net", "mean"), winRate=("win", "mean"))
    .sort_values(["meanNet", "winRate"], ascending=False)
)
outcome_keys = ranking.head(8)["outcomeKey"].tolist()


def score_split(data: pd.DataFrame, evaluation_year: int, model_kind: str, penalty: float) -> tuple:
    fit = data[data["year"] < evaluation_year - 1].copy()
    calibration = data[data["year"] == evaluation_year - 1].copy()
    evaluation = data[data["year"] == evaluation_year].copy()
    prep = make_preprocessor()
    fit_x = prep.fit_transform(fit[model_features])
    calibration_x = prep.transform(calibration[model_features])
    evaluation_x = prep.transform(evaluation[model_features])
    if model_kind == "expected-net":
        model = HistGradientBoostingRegressor(
            loss="absolute_error", learning_rate=0.045, max_iter=140, max_leaf_nodes=15,
            min_samples_leaf=28, l2_regularization=2.0, random_state=31,
        )
        model.fit(fit_x, fit["netPct"])
        calibration_scores = model.predict(calibration_x)
        evaluation_scores = model.predict(evaluation_x)
    else:
        win_model = HistGradientBoostingClassifier(
            learning_rate=0.045, max_iter=130, max_leaf_nodes=15,
            min_samples_leaf=28, l2_regularization=1.6, random_state=17,
        )
        stop_model = HistGradientBoostingClassifier(
            learning_rate=0.04, max_iter=130, max_leaf_nodes=15,
            min_samples_leaf=28, l2_regularization=2.2, random_state=23,
        )
        win_model.fit(fit_x, fit["win"])
        stop_model.fit(fit_x, fit["stop"])
        calibration_scores = win_model.predict_proba(calibration_x)[:, 1] - penalty * stop_model.predict_proba(calibration_x)[:, 1]
        evaluation_scores = win_model.predict_proba(evaluation_x)[:, 1] - penalty * stop_model.predict_proba(evaluation_x)[:, 1]
    threshold, calibration_result = choose_threshold(calibration, calibration_scores)
    return threshold, calibration_result, execute(evaluation, evaluation_scores, threshold)


reports: list[dict] = []
for outcome_key in outcome_keys:
    data = frame[frame["outcomeKey"] == outcome_key].copy()
    for model_kind, penalty in [("expected-net", 0.0), ("win-stop", 1.5), ("win-stop", 3.0)]:
        threshold24, calibration23, evaluation24 = score_split(data, 2024, model_kind, penalty)
        threshold25, calibration24, evaluation25 = score_split(data, 2025, model_kind, penalty)
        selected_without_2025 = (
            32 <= evaluation24["cyclesPer100Days"] <= 50
            and evaluation24["winRate"] >= 50 and evaluation24["net"] > 0
        )
        forward_pass = (
            selected_without_2025
            and 32 <= evaluation25["cyclesPer100Days"] <= 50
            and evaluation25["winRate"] >= 50 and evaluation25["net"] > 0
        )
        reports.append({
            "outcomeKey": outcome_key,
            "model": model_kind if model_kind == "expected-net" else f"win-minus-{penalty:g}x-stop",
            "threshold2024": round(float(threshold24), 7),
            "threshold2025": round(float(threshold25), 7),
            "selectedWithout2025": selected_without_2025,
            "forwardPass": forward_pass,
            "calibration2023": calibration23,
            "research2024": evaluation24,
            "recalibration2024": calibration24,
            "validation2025": evaluation25,
        })


reports.sort(key=lambda report: (
    0 if report["selectedWithout2025"] else 1,
    abs(report["research2024"]["cyclesPer100Days"] - 40),
    -report["research2024"]["net"], -report["research2024"]["winRate"],
))
selected = [report for report in reports if report["selectedWithout2025"]]
print(json.dumps({
    "protocol": {
        "randomSplit": False, "causalFeaturesOnly": True,
        "modelFor2024": "fit 2022, calibrate 2023",
        "modelFor2025": "fit 2022-2023, calibrate 2024",
        "configurationSelection": "2024 only", "forwardReportOnly": "2025",
        "holdout2026Opened": False, "maximumCyclesPerDay": 2,
        "featureCount": len(model_features), "outcomeKeys": outcome_keys,
        "reportCount": len(reports),
    },
    "selectedCount": len(selected),
    "forwardPassCount": sum(1 for report in selected if report["forwardPass"]),
    "top": reports[:30],
}, ensure_ascii=False, indent=2))
