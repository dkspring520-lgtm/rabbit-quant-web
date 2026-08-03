#!/usr/bin/env python3
"""Walk-forward tail-risk filter for realistic candidate executions.

Features are frozen at the candidate timestamp.  Labels execute at the next
minute with costs/slippage and always terminate by target, stop, expiry or
14:50.  2022-2023 trains; 2024 selects configuration/threshold; 2025 is read
only for the final forward report.
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
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


if len(sys.argv) < 3:
    raise SystemExit(
        "usage: python train-zijin-candidate-tail-filter.py FEATURES.jsonl EXECUTION_LABELS.jsonl"
    )

feature_path = Path(sys.argv[1])
label_path = Path(sys.argv[2])
features_frame = pd.read_json(feature_path, lines=True)
labels_raw = pd.read_json(label_path, lines=True)
features_frame["date"] = features_frame["date"].astype(str)
features_frame["time"] = features_frame["time"].astype(str).str.zfill(4)

label_rows: list[dict] = []
for row in labels_raw.to_dict("records"):
    base = {"date": str(row["date"]), "time": str(row["time"]), "direction": row["direction"]}
    for outcome_key, outcome in row["outcomes"].items():
        label_rows.append({
            **base,
            "outcomeKey": outcome_key,
            "net": float(outcome["net"]),
            "win": int(outcome["win"]),
            "exitTime": str(outcome["exitTime"]),
            "exitReason": outcome["reason"],
        })
labels = pd.DataFrame(label_rows)
labels["date"] = labels["date"].astype(str)
labels["time"] = labels["time"].astype(str).str.zfill(4)

frame = features_frame.merge(labels, on=["date", "time", "direction"], how="inner")
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


def clock_minutes(value: str) -> int:
    text = str(value).zfill(4)
    return int(text[:2]) * 60 + int(text[2:])


def execute(rows: pd.DataFrame, scores: np.ndarray, threshold: float) -> dict:
    work = pd.DataFrame({
        "date": rows["date"].to_numpy(),
        "time": rows["time"].to_numpy(),
        "exitTime": rows["exitTime"].to_numpy(),
        "net": rows["net"].to_numpy(),
        "exitReason": rows["exitReason"].to_numpy(),
        "modelScore": scores,
    })
    work["clock"] = work["time"].map(clock_minutes)
    work["exitClock"] = work["exitTime"].map(clock_minutes)
    work.sort_values(["date", "clock", "modelScore"], ascending=[True, True, False], inplace=True)
    selected = []
    for _, day in work.groupby("date", sort=True):
        last_exit = -10_000
        count = 0
        for row in day.itertuples(index=False):
            if row.modelScore < threshold or row.clock < last_exit:
                continue
            selected.append(row)
            count += 1
            last_exit = int(row.exitClock)
            if count >= 2:
                break
    days = rows["date"].nunique()
    if not selected:
        return {
            "cycles": 0, "wins": 0, "winRate": 0, "cyclesPer100Days": 0,
            "net": 0, "averageNet": 0, "stops": 0,
        }
    chosen = pd.DataFrame(selected, columns=work.columns)
    return {
        "cycles": int(len(chosen)),
        "wins": int((chosen["net"] > 0).sum()),
        "winRate": round(float((chosen["net"] > 0).mean() * 100), 2),
        "cyclesPer100Days": round(float(len(chosen) / max(1, days) * 100), 2),
        "net": round(float(chosen["net"].sum()), 2),
        "averageNet": round(float(chosen["net"].mean()), 2),
        "stops": int((chosen["exitReason"] == "hard-stop").sum()),
        "averageScore": round(float(chosen["modelScore"].mean()), 5),
    }


def threshold_search(
    research_rows: pd.DataFrame,
    research_scores: np.ndarray,
    calibration_rows: pd.DataFrame,
    calibration_scores: np.ndarray,
) -> tuple[float, dict, dict]:
    thresholds = np.unique(np.quantile(calibration_scores, np.linspace(0.45, 0.97, 20)))
    ranked = []
    for threshold in thresholds:
        research_result = execute(research_rows, research_scores, float(threshold))
        calibration_result = execute(calibration_rows, calibration_scores, float(threshold))
        coverage_ok = (
            32 <= research_result["cyclesPer100Days"] <= 50
            and 32 <= calibration_result["cyclesPer100Days"] <= 50
        )
        quality_ok = (
            research_result["winRate"] >= 50
            and calibration_result["winRate"] >= 50
            and research_result["net"] > 0
            and calibration_result["net"] > 0
        )
        coverage_distance = (
            abs(research_result["cyclesPer100Days"] - 40)
            + abs(calibration_result["cyclesPer100Days"] - 40)
        )
        ranked.append((
            0 if quality_ok and coverage_ok else 1,
            0 if coverage_ok else 1,
            coverage_distance,
            -(research_result["net"] + calibration_result["net"]),
            -min(research_result["winRate"], calibration_result["winRate"]),
            float(threshold),
            research_result,
            calibration_result,
        ))
    ranked.sort(key=lambda item: item[:5])
    best = ranked[0]
    return best[5], best[6], best[7]


training_config_rank = (
    frame[frame["year"] <= 2023]
    .groupby("outcomeKey", as_index=False)
    .agg(trainingMeanNet=("net", "mean"), trainingWinRate=("win", "mean"))
    .sort_values(["trainingMeanNet", "trainingWinRate"], ascending=[False, False])
)
considered_outcome_keys = training_config_rank.head(3)["outcomeKey"].tolist()

reports: list[dict] = []
for outcome_key in considered_outcome_keys:
    outcome_frame = frame[frame["outcomeKey"] == outcome_key].copy()
    fit = outcome_frame[outcome_frame["year"] == 2022].copy()
    research = outcome_frame[outcome_frame["year"] == 2023].copy()
    calibration = outcome_frame[outcome_frame["year"] == 2024].copy()
    validation = outcome_frame[outcome_frame["year"] == 2025].copy()
    if min(len(fit), len(research), len(calibration), len(validation)) < 100:
        continue
    estimators = {}
    for model_name, (estimator, kind) in estimators.items():
        pipeline = Pipeline([("features", make_preprocessor()), ("model", estimator)])
        target = fit["win"] if kind == "classifier" else fit["net"]
        pipeline.fit(fit[model_features], target)
        if kind == "classifier":
            research_scores = pipeline.predict_proba(research[model_features])[:, 1]
            calibration_scores = pipeline.predict_proba(calibration[model_features])[:, 1]
            validation_scores = pipeline.predict_proba(validation[model_features])[:, 1]
        else:
            research_scores = pipeline.predict(research[model_features])
            calibration_scores = pipeline.predict(calibration[model_features])
            validation_scores = pipeline.predict(validation[model_features])
        threshold, research_result, calibration_result = threshold_search(
            research, research_scores, calibration, calibration_scores
        )
        validation_result = execute(validation, validation_scores, threshold)
        selected = (
            32 <= research_result["cyclesPer100Days"] <= 50
            and 32 <= calibration_result["cyclesPer100Days"] <= 50
            and research_result["winRate"] >= 50
            and calibration_result["winRate"] >= 50
            and research_result["net"] > 0
            and calibration_result["net"] > 0
        )
        forward_pass = (
            32 <= validation_result["cyclesPer100Days"] <= 50
            and validation_result["winRate"] >= 50
            and validation_result["net"] > 0
        )
        reports.append({
            "outcomeKey": outcome_key,
            "model": model_name,
            "threshold": round(float(threshold), 7),
            "selectedWithout2025": selected,
            "forwardPass": forward_pass,
            "research2023": research_result,
            "calibration2024": calibration_result,
            "validation2025": validation_result,
        })

    preprocessor = make_preprocessor()
    transformed = {
        "fit": preprocessor.fit_transform(fit[model_features]),
    }
    for split_name, split_rows in (("research", research), ("calibration", calibration), ("validation", validation)):
        transformed[split_name] = preprocessor.transform(split_rows[model_features])

    model_pairs = {
        "logistic": (
            LogisticRegression(C=0.25, max_iter=2500, class_weight="balanced", random_state=17),
            LogisticRegression(C=0.18, max_iter=2500, class_weight="balanced", random_state=23),
        ),
        "hist-gradient": (
            HistGradientBoostingClassifier(
                learning_rate=0.055, max_iter=110, max_leaf_nodes=15,
                min_samples_leaf=24, l2_regularization=1.2, random_state=17,
            ),
            HistGradientBoostingClassifier(
                learning_rate=0.05, max_iter=110, max_leaf_nodes=15,
                min_samples_leaf=24, l2_regularization=1.8, random_state=23,
            ),
        ),
    }
    for family, (win_model, stop_model) in model_pairs.items():
        win_model.fit(transformed["fit"], fit["win"])
        stop_model.fit(transformed["fit"], (fit["exitReason"] == "hard-stop").astype(int))
        split_scores = {}
        for split_name in ("research", "calibration", "validation"):
            split_scores[split_name] = (
                win_model.predict_proba(transformed[split_name])[:, 1],
                stop_model.predict_proba(transformed[split_name])[:, 1],
            )
        for penalty in (0.75, 1.5, 3.0):
            research_scores = split_scores["research"][0] - penalty * split_scores["research"][1]
            calibration_scores = split_scores["calibration"][0] - penalty * split_scores["calibration"][1]
            validation_scores = split_scores["validation"][0] - penalty * split_scores["validation"][1]
            threshold, research_result, calibration_result = threshold_search(
                research, research_scores, calibration, calibration_scores
            )
            validation_result = execute(validation, validation_scores, threshold)
            selected = (
                32 <= research_result["cyclesPer100Days"] <= 50
                and 32 <= calibration_result["cyclesPer100Days"] <= 50
                and research_result["winRate"] >= 50
                and calibration_result["winRate"] >= 50
                and research_result["net"] > 0
                and calibration_result["net"] > 0
            )
            forward_pass = (
                32 <= validation_result["cyclesPer100Days"] <= 50
                and validation_result["winRate"] >= 50
                and validation_result["net"] > 0
            )
            reports.append({
                "outcomeKey": outcome_key,
                "model": f"{family}-win-minus-stop-{penalty:g}",
                "threshold": round(float(threshold), 7),
                "selectedWithout2025": selected,
                "forwardPass": forward_pass,
                "research2023": research_result,
                "calibration2024": calibration_result,
                "validation2025": validation_result,
            })


def rank(report: dict) -> tuple:
    research = report["research2023"]
    calibration = report["calibration2024"]
    return (
        0 if report["selectedWithout2025"] else 1,
        abs(research["cyclesPer100Days"] - 40) + abs(calibration["cyclesPer100Days"] - 40),
        -(research["net"] + calibration["net"]),
        -min(research["winRate"], calibration["winRate"]),
    )


reports.sort(key=rank)
selected = [report for report in reports if report["selectedWithout2025"]]
print(json.dumps({
    "protocol": {
        "causalFeaturesOnly": True,
        "nextMinuteExecution": True,
        "allOpenedLabelsTerminate": True,
        "costsAndAdverseSlippageIncluded": True,
        "modelFit": "2022",
        "outOfSampleResearch": "2023",
        "configurationAndThresholdSelection": "2024",
        "forwardValidation": "2025",
        "holdout2026Opened": False,
        "maximumCyclesPerDay": 2,
        "featureCount": len(model_features),
        "forbiddenFeatureMatches": leaks,
        "candidateExitConfigurations": int(frame["outcomeKey"].nunique()),
        "configurationsConsideredAfterTrainingRank": considered_outcome_keys,
        "searchedReports": len(reports),
    },
    "selectedCount": len(selected),
    "selectedForwardPassCount": sum(1 for report in selected if report["forwardPass"]),
    "topBySelection": reports[:20],
}, ensure_ascii=False, indent=2))
