#!/usr/bin/env python3
"""Causal walk-forward search for score-based position sizing.

The signal count is not changed by sizing: every selected signal opens at
least one board lot and is evaluated with the same next-minute adverse fill,
commission minimum and stamp duty used by the execution-label exporter.
Models fit 2022 only; 2023 is research, 2024 calibration and 2025 is reported
only after a policy has been selected without looking at 2025.
"""

from __future__ import annotations

import json
import math
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
        "usage: python search-zijin-dynamic-sizing.py FEATURES.jsonl EXECUTION_LABELS.jsonl"
    )

feature_path = Path(sys.argv[1])
label_path = Path(sys.argv[2])


def commission(turnover: float) -> float:
    return max(5.0, turnover * 0.00025)


def lot_quantity(quantity: int, fraction: float) -> int:
    return max(100, int(math.floor(quantity * fraction / 100.0) * 100))


def exact_sized_net(row: pd.Series, fraction: float) -> float:
    quantity = lot_quantity(int(row["executionQuantity"]), fraction)
    entry_price = float(row["entryPrice"])
    exit_price = float(row["exitPrice"])
    direction = str(row["direction"])
    entry_turnover = entry_price * quantity
    exit_turnover = exit_price * quantity
    if direction == "正T":
        gross = exit_turnover - entry_turnover
        sell_turnover = exit_turnover
    else:
        gross = entry_turnover - exit_turnover
        sell_turnover = entry_turnover
    fees = (
        commission(entry_turnover)
        + commission(exit_turnover)
        + sell_turnover * 0.0005
    )
    return gross - fees


features = pd.read_json(feature_path, lines=True)
raw_labels = pd.read_json(label_path, lines=True)
features["date"] = features["date"].astype(str)
features["time"] = features["time"].astype(str).str.zfill(4)

label_rows: list[dict] = []
for row in raw_labels.to_dict("records"):
    base = {
        "date": str(row["date"]),
        "time": str(row["time"]).zfill(4),
        "direction": row["direction"],
        "executionQuantity": int(row["quantity"]),
    }
    for outcome_key, outcome in row["outcomes"].items():
        label_rows.append({
            **base,
            "outcomeKey": outcome_key,
            "entryPrice": float(outcome["entryPrice"]),
            "exitPrice": float(outcome["exitPrice"]),
            "exitTime": str(outcome["exitTime"]).zfill(4),
            "exitReason": outcome["reason"],
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


def score_percentiles(reference: np.ndarray, values: np.ndarray) -> np.ndarray:
    ordered = np.sort(np.asarray(reference, dtype=float))
    return np.searchsorted(ordered, values, side="right") / max(1, len(ordered))


def size_fraction(percentile: float, policy: tuple[float, float, float]) -> float:
    low, middle, high = policy
    if percentile < 0.60:
        return low
    if percentile < 0.82:
        return middle
    return high


_selection_cache: dict[tuple[int, int, float], pd.DataFrame] = {}


def execute(
    rows: pd.DataFrame,
    scores: np.ndarray,
    percentiles: np.ndarray,
    threshold: float,
    policy: tuple[float, float, float],
) -> dict:
    cache_key = (id(rows), id(scores), round(float(threshold), 12))
    chosen = _selection_cache.get(cache_key)
    if chosen is None:
        work = rows[[
            "date", "time", "exitTime", "exitReason", "direction", "executionQuantity",
            "entryPrice", "exitPrice", "net",
        ]].copy()
        work["modelScore"] = scores
        work["scorePercentile"] = percentiles
        work["clock"] = work["time"].map(clock_minutes)
        work["exitClock"] = work["exitTime"].map(clock_minutes)
        work.sort_values(["date", "clock", "modelScore"], ascending=[True, True, False], inplace=True)
        selected: list[pd.Series] = []
        for _, day in work.groupby("date", sort=True):
            last_exit = -10_000
            count = 0
            for _, row in day.iterrows():
                if float(row["modelScore"]) < threshold or int(row["clock"]) < last_exit:
                    continue
                selected.append(row.copy())
                count += 1
                last_exit = int(row["exitClock"])
                if count >= 2:
                    break
        chosen = pd.DataFrame(selected)
        _selection_cache[cache_key] = chosen
    days = rows["date"].nunique()
    if chosen.empty:
        return {"cycles": 0, "wins": 0, "winRate": 0, "cyclesPer100Days": 0,
                "net": 0, "averageNet": 0, "stops": 0, "averageQuantity": 0}
    chosen = chosen.copy()
    chosen["sizeFraction"] = chosen["scorePercentile"].map(lambda value: size_fraction(float(value), policy))
    chosen["sizedQuantity"] = [
        lot_quantity(int(quantity), float(fraction))
        for quantity, fraction in zip(chosen["executionQuantity"], chosen["sizeFraction"], strict=True)
    ]
    chosen["sizedNet"] = [
        exact_sized_net(row, float(row["sizeFraction"]))
        for _, row in chosen.iterrows()
    ]
    return {
        "cycles": int(len(chosen)),
        "wins": int((chosen["sizedNet"] > 0).sum()),
        "winRate": round(float((chosen["sizedNet"] > 0).mean() * 100), 2),
        "cyclesPer100Days": round(float(len(chosen) / max(1, days) * 100), 2),
        "net": round(float(chosen["sizedNet"].sum()), 2),
        "averageNet": round(float(chosen["sizedNet"].mean()), 2),
        "stops": int((chosen["exitReason"] == "hard-stop").sum()),
        "averageQuantity": round(float(chosen["sizedQuantity"].mean()), 1),
        "averageSizeFraction": round(float(chosen["sizeFraction"].mean()), 3),
    }


config_rank = (
    frame[frame["year"] <= 2023]
    .groupby("outcomeKey", as_index=False)
    .agg(trainingMeanNet=("net", "mean"), trainingWinRate=("win", "mean"))
    .sort_values(["trainingMeanNet", "trainingWinRate"], ascending=[False, False])
)
outcome_keys = config_rank.head(3)["outcomeKey"].tolist()
policies = [
    (1.00, 1.00, 1.00),
    (0.10, 0.25, 0.50),
    (0.10, 0.25, 1.00),
    (0.10, 0.50, 1.00),
    (0.25, 0.50, 1.00),
]

reports: list[dict] = []
for outcome_key in outcome_keys:
    data = frame[frame["outcomeKey"] == outcome_key].copy()
    fit = data[data["year"] == 2022].copy()
    research = data[data["year"] == 2023].copy()
    calibration = data[data["year"] == 2024].copy()
    validation = data[data["year"] == 2025].copy()
    if min(len(fit), len(research), len(calibration), len(validation)) < 100:
        continue
    preprocessor = make_preprocessor()
    transformed_fit = preprocessor.fit_transform(fit[model_features])
    transformed = {
        "research": preprocessor.transform(research[model_features]),
        "calibration": preprocessor.transform(calibration[model_features]),
        "validation": preprocessor.transform(validation[model_features]),
    }
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
        win_model.fit(transformed_fit, fit["win"])
        stop_model.fit(transformed_fit, (fit["exitReason"] == "hard-stop").astype(int))
        fit_win = win_model.predict_proba(transformed_fit)[:, 1]
        fit_stop = stop_model.predict_proba(transformed_fit)[:, 1]
        for penalty in (0.75, 1.5, 3.0):
            _selection_cache.clear()
            fit_scores = fit_win - penalty * fit_stop
            split_scores: dict[str, np.ndarray] = {}
            split_percentiles: dict[str, np.ndarray] = {}
            for split_name in ("research", "calibration", "validation"):
                split_scores[split_name] = (
                    win_model.predict_proba(transformed[split_name])[:, 1]
                    - penalty * stop_model.predict_proba(transformed[split_name])[:, 1]
                )
                split_percentiles[split_name] = score_percentiles(
                    fit_scores, split_scores[split_name]
                )
            thresholds = np.unique(np.quantile(split_scores["calibration"], np.linspace(0.45, 0.97, 20)))
            for policy in policies:
                candidates = []
                for threshold in thresholds:
                    r23 = execute(research, split_scores["research"], split_percentiles["research"], float(threshold), policy)
                    c24 = execute(calibration, split_scores["calibration"], split_percentiles["calibration"], float(threshold), policy)
                    coverage_ok = (
                        32 <= r23["cyclesPer100Days"] <= 50
                        and 32 <= c24["cyclesPer100Days"] <= 50
                    )
                    quality_ok = (
                        r23["winRate"] >= 50 and c24["winRate"] >= 50
                        and r23["net"] > 0 and c24["net"] > 0
                    )
                    candidates.append((
                        0 if coverage_ok and quality_ok else 1,
                        0 if coverage_ok else 1,
                        abs(r23["cyclesPer100Days"] - 40) + abs(c24["cyclesPer100Days"] - 40),
                        -(r23["net"] + c24["net"]),
                        float(threshold), r23, c24,
                    ))
                candidates.sort(key=lambda item: item[:4])
                best = candidates[0]
                threshold, r23, c24 = best[4], best[5], best[6]
                v25 = execute(validation, split_scores["validation"], split_percentiles["validation"], threshold, policy)
                selected = (
                    32 <= r23["cyclesPer100Days"] <= 50
                    and 32 <= c24["cyclesPer100Days"] <= 50
                    and r23["winRate"] >= 50 and c24["winRate"] >= 50
                    and r23["net"] > 0 and c24["net"] > 0
                )
                forward_pass = (
                    selected and 32 <= v25["cyclesPer100Days"] <= 50
                    and v25["winRate"] >= 50 and v25["net"] > 0
                )
                reports.append({
                    "outcomeKey": outcome_key,
                    "model": f"{family}-win-minus-stop-{penalty:g}",
                    "sizePolicy": list(policy),
                    "threshold": round(float(threshold), 7),
                    "selectedWithout2025": selected,
                    "forwardPass": forward_pass,
                    "research2023": r23,
                    "calibration2024": c24,
                    "validation2025": v25,
                })


def rank(report: dict) -> tuple:
    r23 = report["research2023"]
    c24 = report["calibration2024"]
    return (
        0 if report["selectedWithout2025"] else 1,
        0 if 32 <= r23["cyclesPer100Days"] <= 50 and 32 <= c24["cyclesPer100Days"] <= 50 else 1,
        abs(r23["cyclesPer100Days"] - 40) + abs(c24["cyclesPer100Days"] - 40),
        -(r23["net"] + c24["net"]),
        -min(r23["winRate"], c24["winRate"]),
    )


reports.sort(key=rank)
selected = [report for report in reports if report["selectedWithout2025"]]
print(json.dumps({
    "protocol": {
        "causalFeaturesOnly": True,
        "nextMinuteAdverseExecution": True,
        "exactCommissionMinimumAndStampDuty": True,
        "everySelectedSignalAtLeastOneBoardLot": True,
        "modelFit": "2022",
        "outOfSampleResearch": "2023",
        "calibration": "2024",
        "forwardReportOnly": "2025",
        "holdout2026Opened": False,
        "maximumCyclesPerDay": 2,
        "scorePercentileReference": "2022 only",
        "sizeTierPercentiles": [0.60, 0.82],
        "featureCount": len(model_features),
        "forbiddenFeatureMatches": leaks,
        "outcomeKeys": outcome_keys,
        "reportCount": len(reports),
    },
    "selectedCount": len(selected),
    "selectedForwardPassCount": sum(1 for report in selected if report["forwardPass"]),
    "top": reports[:25],
}, ensure_ascii=False, indent=2))
