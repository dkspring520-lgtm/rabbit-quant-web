#!/usr/bin/env python3
"""Read-only post-mortem for Zijin round-nine opening-gap repair.

This script reconstructs the already-recorded quarterly out-of-sample trades
from the immutable round-nine report.  It does not select parameters, does not
open 2026, and cannot promote or modify Smart-T V4.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RUNNER_PATH = HERE / "run_zijin_round4_experiments.py"
HYPOTHESIS_ID = "opening-gap-repair-confirmed"


def import_file(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = None


def load_runner():
    global runner
    if runner is None:
        runner = import_file("zijin_round9_postmortem_runner", RUNNER_PATH)
    return runner


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def safe_mean(values: pd.Series) -> float | None:
    numeric = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    return round(float(numeric.mean()), 4) if not numeric.empty else None


def safe_median(values: pd.Series) -> float | None:
    numeric = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    return round(float(numeric.median()), 4) if not numeric.empty else None


def summarize_partition(rows: pd.DataFrame) -> dict[str, Any]:
    if rows.empty:
        return {
            "trades": 0,
            "wins": 0,
            "winRate": None,
            "averageNetPct": None,
            "targetTouchRate": None,
            "averageHoldMinutes": None,
            "medianMfePct": None,
            "medianMaePct": None,
            "exitReasons": {},
        }
    return {
        "trades": int(len(rows)),
        "wins": int(rows["won"].sum()),
        "winRate": round(float(rows["won"].mean()), 4),
        "averageNetPct": safe_mean(rows["netPct"]),
        "targetTouchRate": round(float(rows["targetTouched"].mean()), 4),
        "averageHoldMinutes": safe_mean(rows["holdMinutes"]),
        "medianMfePct": safe_median(rows["mfePct"]),
        "medianMaePct": safe_median(rows["maePct"]),
        "exitReasons": {
            str(reason): int(count)
            for reason, count in rows["exitReason"].value_counts().sort_index().items()
        },
    }


def signal_bucket(minute: int) -> str:
    if minute <= 9 * 60 + 44:
        return "09:33-09:44"
    if minute <= 9 * 60 + 59:
        return "09:45-09:59"
    return "10:00-10:30"


def path_metrics(row: pd.Series, day: pd.DataFrame) -> dict[str, Any]:
    ordered = day.sort_values("tradeTime").reset_index(drop=True)
    signal_index = int(row["rowIndex"])
    entry_index = signal_index + 1
    exit_index = min(int(row["exitIndex"]), len(ordered) - 1)
    if entry_index >= len(ordered) or exit_index < entry_index:
        raise RuntimeError(f"invalid trade path for {row['date']} at row {signal_index}")
    entry_price = float(ordered.iloc[entry_index]["open"])
    window = ordered.iloc[entry_index:exit_index + 1]
    if entry_price <= 0 or window.empty:
        raise RuntimeError(f"empty trade path for {row['date']} at row {signal_index}")
    high = float(pd.to_numeric(window["high"], errors="coerce").max())
    low = float(pd.to_numeric(window["low"], errors="coerce").min())
    if row["direction"] == "positive":
        mfe = (high / entry_price - 1) * 100
        mae = (low / entry_price - 1) * 100
    else:
        mfe = ((entry_price - low) / entry_price) * 100
        mae = -((high / entry_price - 1) * 100)
    return {
        "signalTime": str(ordered.iloc[signal_index]["tradeTime"]),
        "entryTime": str(ordered.iloc[entry_index]["tradeTime"]),
        "exitTime": str(ordered.iloc[exit_index]["tradeTime"]),
        "entryPrice": round(entry_price, 4),
        "mfePct": round(float(mfe), 4),
        "maePct": round(float(mae), 4),
    }


def reconstruct(report: dict[str, Any], samples: pd.DataFrame, target: pd.DataFrame) -> pd.DataFrame:
    research_runner = load_runner()
    hypothesis = next(
        (item for item in report.get("hypotheses", []) if item.get("hypothesisId") == HYPOTHESIS_ID),
        None,
    )
    if not hypothesis:
        raise RuntimeError("round-nine opening-gap hypothesis not found")
    target_days = {
        str(date): day.copy()
        for date, day in target.groupby("tradeDate", sort=True)
        if str(date) <= "20251231"
    }
    partitions: list[pd.DataFrame] = []
    for quarter in hypothesis["outerQuarters"]:
        universe = research_runner.hypothesis_rows(samples, HYPOTHESIS_ID, quarter["parameters"])
        validation = universe[
            (universe["date"] >= quarter["validationStart"])
            & (universe["date"] <= quarter["validationEnd"])
        ]
        selected = research_runner.independent(validation).copy()
        expected = (int(quarter["trades"]), int(quarter["wins"]))
        actual = (int(len(selected)), int(selected["won"].sum()) if not selected.empty else 0)
        if actual != expected:
            raise RuntimeError(f"reconstruction mismatch for {quarter['id']}: expected {expected}, got {actual}")
        if selected.empty:
            continue
        selected["quarter"] = quarter["id"]
        paths = [path_metrics(row, target_days[str(row["date"])]) for _, row in selected.iterrows()]
        path_frame = pd.DataFrame(paths, index=selected.index)
        selected = pd.concat([selected, path_frame], axis=1)
        selected["timeBucket"] = selected["minuteOfDay"].astype(int).map(signal_bucket)
        partitions.append(selected)
    return pd.concat(partitions, ignore_index=True) if partitions else samples.iloc[0:0].copy()


def grouped(rows: pd.DataFrame, column: str, values: list[str] | None = None) -> list[dict[str, Any]]:
    keys = values or [str(value) for value in rows[column].dropna().unique()]
    return [
        {"id": key, **summarize_partition(rows[rows[column].astype(str) == key])}
        for key in keys
    ]


def build_report(source_report: dict[str, Any], rows: pd.DataFrame, audit: dict[str, Any]) -> dict[str, Any]:
    research_runner = load_runner()
    target_gross = float(research_runner.core.MIN_NET_TARGET_PCT + research_runner.core.ROUND_TRIP_COST_PCT)
    source_hypothesis = next(
        item for item in source_report["hypotheses"] if item["hypothesisId"] == HYPOTHESIS_ID
    )
    missed_target = rows[~rows["targetTouched"]]
    near_target = missed_target[(missed_target["mfePct"] >= target_gross - 0.20)]
    weak_path = missed_target[(missed_target["mfePct"] < target_gross - 0.20)]
    conclusion = {
        "dominantFailure": (
            "Most signals did not develop enough favorable excursion to cover the 0.64% net target and costs."
            if len(weak_path) >= len(near_target)
            else "Many signals approached the target without touching it; exit and take-profit paths need separate study."
        ),
        "directionSeparationRequired": True,
        "sameOosMayBeReusedForPromotion": False,
        "round10MustRecordAdditionalTrials": True,
        "final2026StillSealed": True,
    }
    return {
        "schemaVersion": 1,
        "experimentId": "zijin-round9-opening-gap-postmortem",
        "mode": "read-only-postmortem",
        "sourceExperimentId": source_report.get("experimentId"),
        "sourceRunId": source_report.get("runId"),
        "selectionUse": "prohibited",
        "promotionUse": "prohibited",
        "v4Modified": False,
        "dataIsolation": {
            "selectionEnd": "2025-12-31",
            "latestLoadedDate": str(rows["date"].max()) if not rows.empty else None,
            "loaded2026Rows": int(audit.get("loaded2026Rows", 0)),
            "futureMinuteFeaturesUsed": False,
            "futureBarsUsedOnlyForOutcomeLabels": True,
            "entryRule": "signal minute t, next-minute open",
        },
        "profitProtocol": {
            "minimumNetTargetPct": research_runner.core.MIN_NET_TARGET_PCT,
            "maximumNetTargetPct": research_runner.core.MAX_NET_TARGET_PCT,
            "roundTripCostPct": research_runner.core.ROUND_TRIP_COST_PCT,
            "grossTargetThresholdPct": round(target_gross, 4),
            "maximumHoldMinutes": research_runner.core.MAX_HOLD_MINUTES,
        },
        "overall": {
            **summarize_partition(rows),
            "quarterEqualWeightAverageNetPct": round(
                float(source_hypothesis["evaluation"]["metrics"]["meanNetPct"]), 4
            ),
            "aggregationNote": "Trade-equal weighting is the actual average across 136 trades; quarter-equal weighting is only a rolling-stability gate and cannot replace per-trade return.",
        },
        "byDirection": grouped(rows, "direction", ["positive", "reverse"]),
        "bySignalTime": grouped(rows, "timeBucket", ["09:33-09:44", "09:45-09:59", "10:00-10:30"]),
        "byQuarter": grouped(rows, "quarter"),
        "failurePath": {
            "missedTargetTrades": int(len(missed_target)),
            "nearTargetWithin020Pct": int(len(near_target)),
            "insufficientFavorableExcursion": int(len(weak_path)),
            "stoppedTrades": int((rows["exitReason"] == "stop").sum()),
            "timeExpiredTrades": int((rows["exitReason"] == "time").sum()),
        },
        "conclusion": conclusion,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose round-nine Zijin opening-gap OOS trades")
    parser.add_argument("input", type=Path, help="7-stock minute peer-panel parquet")
    parser.add_argument("--round9-report", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".round9-postmortem-runtime")
    parser.add_argument("--output", type=Path, default=ROOT / "public/research/zijin-round9-opening-postmortem.json")
    args = parser.parse_args()
    research_runner = load_runner()
    source_report = json.loads(args.round9_report.read_text(encoding="utf-8"))
    samples, target, audit = research_runner.load_samples(args.input, args.runtime / "cache")
    if str(samples["date"].max()) > "20251231" or int(audit.get("loaded2026Rows", 0)) != 0:
        raise RuntimeError("data isolation failed: post-mortem reached 2026")
    rows = reconstruct(source_report, samples, target)
    report = build_report(source_report, rows, audit)
    write_json(args.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
