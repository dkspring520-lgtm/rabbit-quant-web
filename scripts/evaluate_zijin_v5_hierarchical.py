#!/usr/bin/env python3
"""Preregistered V5 peer-transfer research for Zijin Mining.

This runner deliberately separates what can be audited from what cannot:
historical one-minute bars train and test only price/volume/VWAP/peer features;
L2 order flow and auction-book ideas remain forward-only.  A decision at minute
t uses no later bar and is filled at t+1 open.  It is research-only and does
not read, mutate, or promote Smart-T V4.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROTOCOL_PATH = HERE / "zijin-v5-hierarchical-protocol.json"
ROUND4_PATH = HERE / "run_zijin_round4_experiments.py"
PEER_PATH = HERE / "discover-zijin-peer-patterns.py"
CORE_PATH = HERE / "discover-zijin-patterns.py"
TARGET_CODE = "601899"
FOLDS = [
    ("2024Q1", "20240101", "20240331", False),
    ("2024Q2", "20240401", "20240630", False),
    ("2024Q3", "20240701", "20240930", False),
    ("2024Q4", "20241001", "20241231", False),
    ("2025Q1", "20250101", "20250331", False),
    ("2025Q2", "20250401", "20250630", False),
    ("2025Q3", "20250701", "20250930", True),
    ("2025Q4", "20251001", "20251231", True),
]


def import_file(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


round4 = import_file("zijin_v5_round4", ROUND4_PATH)
peer = import_file("zijin_v5_peer", PEER_PATH)
core = import_file("zijin_v5_core", CORE_PATH)


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def minute_number(value: str) -> int:
    return core.minute_number(value)


def prepare_peer_samples(panel: pd.DataFrame, codes: list[str], cache: Path) -> pd.DataFrame:
    """Build transferable causal samples for peers only, with a stable cache."""
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        loaded = pd.read_pickle(cache)
        if set(loaded.get("code", pd.Series(dtype=str)).astype(str).unique()) == set(codes):
            return loaded
    chunks: list[pd.DataFrame] = []
    for code in codes:
        minutes = panel[panel["code"].astype(str) == str(code)].copy()
        if minutes.empty:
            continue
        samples = core.build_samples(minutes)
        if samples.empty:
            continue
        samples["code"] = str(code)
        chunks.append(samples)
    result = pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
    result.to_pickle(cache)
    return result


def direction_score(rows: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """Observable proxy for the registered hierarchy; no end-of-day feature."""
    def sign(column: str) -> pd.Series:
        return np.sign(pd.to_numeric(rows[column], errors="coerce").fillna(0))

    score = (
        sign("rolling20ReturnPct") * float(weights["prior20DayTrend"])
        + sign("rolling5ReturnPct") * float(weights["prior5DayTrend"])
        + sign("ma10SlopePct") * float(weights["intradayMa10Slope"])
        + sign("return5Pct") * float(weights["intradayReturn5"])
    )
    return score.astype(float)


def independent(rows: pd.DataFrame, maximum_per_day: int) -> pd.DataFrame:
    kept: list[pd.Series] = []
    for _, day in rows.sort_values(["date", "rowIndex", "score"], ascending=[True, True, False]).groupby("date", sort=True):
        last_exit = -1
        count = 0
        for _, row in day.iterrows():
            if count >= maximum_per_day or int(row["rowIndex"]) <= last_exit:
                continue
            kept.append(row)
            last_exit = int(row["exitIndex"])
            count += 1
    return pd.DataFrame(kept) if kept else rows.iloc[0:0].copy()


def model_for(training: pd.DataFrame, features: list[str]) -> HistGradientBoostingClassifier:
    model = HistGradientBoostingClassifier(
        max_iter=120, learning_rate=0.04, max_depth=2,
        min_samples_leaf=100, l2_regularization=4.0, random_state=601899,
    )
    model.fit(training[features], training["won"].astype(int))
    return model


def horizon_metrics(rows: pd.DataFrame, target: pd.DataFrame, horizons: list[int]) -> dict[str, dict[str, float | int | None]]:
    if rows.empty:
        return {str(h): {"signals": 0, "meanMfePct": None, "meanMaePct": None, "spreadTouchRate": None} for h in horizons}
    days = {str(date): day.sort_values("tradeTime").reset_index(drop=True) for date, day in target.groupby("tradeDate", sort=True)}
    values: dict[int, list[tuple[float, float, bool]]] = {h: [] for h in horizons}
    gross_target = core.MIN_NET_TARGET_PCT + core.ROUND_TRIP_COST_PCT
    for row in rows.itertuples(index=False):
        day = days.get(str(row.date))
        if day is None:
            continue
        entry_index = int(row.rowIndex) + 1
        if entry_index >= len(day):
            continue
        entry = float(day.iloc[entry_index].open)
        if entry <= 0:
            continue
        for horizon in horizons:
            end = min(entry_index + horizon, len(day) - 1)
            future = day.iloc[entry_index:end + 1]
            if row.direction == "positive":
                mfe = (float(future.high.max()) / entry - 1) * 100
                mae = (float(future.low.min()) / entry - 1) * 100
            else:
                mfe = (entry / float(future.low.min()) - 1) * 100
                mae = (entry / float(future.high.max()) - 1) * 100
            values[horizon].append((mfe, mae, mfe >= gross_target))
    return {
        str(h): {
            "signals": len(items),
            "meanMfePct": round(float(np.mean([item[0] for item in items])), 4) if items else None,
            "meanMaePct": round(float(np.mean([item[1] for item in items])), 4) if items else None,
            "spreadTouchRate": round(float(np.mean([item[2] for item in items])), 4) if items else None,
        }
        for h, items in values.items()
    }


def summarize(rows: pd.DataFrame, stress_delta: float) -> dict[str, float | int | None]:
    if rows.empty:
        return {"trades": 0, "wins": 0, "winRate": None, "averageNetPct": None, "stressAverageNetPct": None, "payoffRatio": None}
    wins = rows[rows["netPct"] > 0]["netPct"]
    losses = rows[rows["netPct"] <= 0]["netPct"]
    payoff = None if losses.empty else float(wins.mean() / abs(losses.mean())) if not wins.empty and float(losses.mean()) != 0 else 0.0
    return {
        "trades": int(len(rows)), "wins": int((rows["netPct"] > 0).sum()),
        "winRate": round(float((rows["netPct"] > 0).mean()), 4),
        "averageNetPct": round(float(rows["netPct"].mean()), 4),
        "stressAverageNetPct": round(float((rows["netPct"] - stress_delta).mean()), 4),
        "payoffRatio": round(payoff, 4) if payoff is not None else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="V5 causal peer-transfer research for Zijin Mining")
    parser.add_argument("input", type=Path, help="7-stock minute parquet panel")
    parser.add_argument("--protocol", type=Path, default=PROTOCOL_PATH)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".v5-hierarchical-runtime")
    parser.add_argument("--report", type=Path, default=ROOT / "public/research/zijin-v5-hierarchical-report.json")
    args = parser.parse_args()

    protocol = json.loads(args.protocol.read_text(encoding="utf-8"))
    maximum = str(protocol["dataPolicy"]["maximumLoadedDate"])
    # Existing loader provides the target's causal peer and daily-context features.
    target_samples, target_minutes, target_audit = round4.load_samples(args.input, args.runtime / "target-cache")
    if str(target_samples["date"].max()) > maximum or int(target_audit.get("loaded2026Rows", 0)) != 0:
        raise RuntimeError("sealed-date violation: target sample cache reached 2026")
    panel = round4.round2.load_panel(args.input.resolve(), maximum)
    if panel.empty or str(panel["tradeDate"].max()) > maximum:
        raise RuntimeError("sealed-date violation: peer panel reached 2026")

    peer_codes = [str(code) for code in protocol["dataPolicy"]["peerTrainingCodes"]]
    peer_samples = prepare_peer_samples(panel, peer_codes, args.runtime / "peer-core-samples.pkl")
    if peer_samples.empty:
        raise RuntimeError("no peer training samples")
    features = list(core.FEATURES)
    required_target = features + ["rolling20ReturnPct", "rolling5ReturnPct", "ma10SlopePct", "return5Pct", "peerCoverage", "volumeRatio"]
    target_samples = target_samples.dropna(subset=required_target + ["netPct", "won", "exitIndex"]).copy()
    peer_samples = peer_samples.dropna(subset=features + ["won"]).copy()
    target_samples["directionScore"] = direction_score(target_samples, protocol["hierarchy"]["direction"]["weights"])

    selected_folds: list[pd.DataFrame] = []
    fold_reports: list[dict[str, Any]] = []
    fixed_quantile = float(protocol["model"]["probabilityQuantile"])
    max_daily = int(protocol["execution"]["maximumSignalsPerDay"])
    min_peer_rows = int(protocol["model"]["minimumPeerTrainingRows"])
    direction_policy = protocol["hierarchy"]["direction"]
    start_minute, end_minute = [minute_number(value) for value in protocol["execution"]["session"]]

    for fold_id, start, end, final_holdout in FOLDS:
        train_end = str((target_samples[target_samples["date"] < start]["date"]).max())
        # A full last day is embargoed from both peer fitting and Zijin calibration.
        embargo = str((target_samples[target_samples["date"] < start]["date"]).max())
        peer_train = peer_samples[peer_samples["date"] < embargo]
        calibration = target_samples[target_samples["date"] < embargo]
        validation = target_samples[(target_samples["date"] >= start) & (target_samples["date"] <= end)].copy()
        fold_selected: list[pd.DataFrame] = []
        per_direction: dict[str, Any] = {}
        for direction in ("positive", "reverse"):
            train_dir = peer_train[peer_train["direction"] == direction]
            calibration_dir = calibration[calibration["direction"] == direction]
            valid_dir = validation[validation["direction"] == direction].copy()
            if len(train_dir) < min_peer_rows or calibration_dir.empty or valid_dir.empty:
                per_direction[direction] = {"status": "insufficient-history", "peerRows": int(len(train_dir)), "targetCalibrationRows": int(len(calibration_dir))}
                continue
            model = model_for(train_dir, features)
            cutoff = float(np.quantile(model.predict_proba(calibration_dir[features])[:, 1], fixed_quantile))
            valid_dir["score"] = model.predict_proba(valid_dir[features])[:, 1]
            if direction == "positive":
                permission = valid_dir["directionScore"] >= float(direction_policy["positivePermissionAtOrAbove"])
            else:
                permission = valid_dir["directionScore"] <= float(direction_policy["reversePermissionAtOrBelow"])
            chosen = valid_dir[
                permission
                & (valid_dir["score"] >= cutoff)
                & (valid_dir["peerCoverage"] >= 0.8)
                & (valid_dir["volumeRatio"] >= 0.70)
                & (valid_dir["minuteOfDay"] >= start_minute)
                & (valid_dir["minuteOfDay"] <= end_minute)
            ].copy()
            fold_selected.append(chosen)
            per_direction[direction] = {"status": "scored", "peerRows": int(len(train_dir)), "targetCalibrationRows": int(len(calibration_dir)), "cutoff": round(cutoff, 6), "candidates": int(len(chosen))}
        selected = independent(pd.concat(fold_selected, ignore_index=True) if fold_selected else validation.iloc[0:0], max_daily)
        selected["fold"] = fold_id
        selected["finalHoldout"] = final_holdout
        selected_folds.append(selected)
        fold_reports.append({"id": fold_id, "start": start, "end": end, "finalHoldout": final_holdout, "trainingThrough": train_end, "directions": per_direction, "metrics": summarize(selected, 0.06)})

    all_selected = pd.concat(selected_folds, ignore_index=True) if selected_folds else target_samples.iloc[0:0]
    final_rows = all_selected[all_selected["finalHoldout"] == True] if not all_selected.empty else all_selected
    diagnostic_rows = all_selected[all_selected["finalHoldout"] == False] if not all_selected.empty else all_selected
    horizons = [int(value) for value in protocol["outputs"]["labelHorizonsMinutes"]]
    report = {
        "schemaVersion": 1,
        "experimentId": protocol["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "research-only-no-auto-promotion",
        "affectsSmartTV4": False,
        "causalityAudit": {
            "maximumLoadedDate": maximum,
            "loaded2026Rows": int(target_audit.get("loaded2026Rows", 0)),
            "featureDecisionTime": "minute t close or earlier",
            "fill": "minute t+1 open",
            "futureMinuteFeaturesUsed": False,
            "futureBarsUsedOnlyForLabels": True,
            "usesHistoricalL2": False,
            "usesHistoricalAuctionBook": False,
        },
        "dataset": {**target_audit, "peerTrainingRows": int(len(peer_samples)), "peerTrainingCodes": peer_codes, "inputSha256": sha256(args.input), "protocolSha256": sha256(args.protocol)},
        "model": {"type": protocol["model"]["type"], "featureCount": len(features), "features": features, "fixedProbabilityQuantile": fixed_quantile, "peerTraining": "six peer stocks only", "zijinCalibration": "fixed score quantile only"},
        "executionLimitations": {"baseRoundTripCostPct": 0.12, "stressRoundTripCostPct": 0.18, "brokerSpecificCommission": "not available in bar data", "stampDutyAndSlippage": "included only in aggregate cost assumption", "unfilledOrderSimulation": "not available without historical order book"},
        "folds": fold_reports,
        "diagnosticWalkForward": {"metrics": summarize(diagnostic_rows, 0.06), "futureLabels": horizon_metrics(diagnostic_rows, target_minutes, horizons)},
        "sealedFinalHoldout2025H2": {"metrics": summarize(final_rows, 0.06), "futureLabels": horizon_metrics(final_rows, target_minutes, horizons), "note": "固定规则下的最后六个月；因 2022-2025 已有历史研究暴露，仍不得作为自动上线依据。"},
        "decision": "Only a prospective L2/opening-emotion shadow study with enough new samples may be considered for manual review; V4 remains unchanged.",
    }
    atomic_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
