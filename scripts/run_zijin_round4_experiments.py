#!/usr/bin/env python3
"""Execute preregistered Zijin hypotheses on sealed causal data.

The runner loads no rows after 2025-12-31, evaluates four hypotheses
independently, performs anchored quarterly walk-forward selection, records
every fold/config evaluation in a SHA-256 append-only ledger, and emits PBO,
Deflated Sharpe and three-baseline comparisons.  It never opens 2026.
"""

from __future__ import annotations

import argparse
import importlib.util
import itertools
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROTOCOL_PATH = HERE / "zijin-round4-protocol.json"
STANDARD_PATH = HERE / "zijin_round4_standard.py"
ROUND2_PATH = HERE / "train-zijin-round2-walk-forward.py"
FOLDS = [
    ("2024Q1", "20240101", "20240331"),
    ("2024Q2", "20240401", "20240630"),
    ("2024Q3", "20240701", "20240930"),
    ("2024Q4", "20241001", "20241231"),
    ("2025Q1", "20250101", "20250331"),
    ("2025Q2", "20250401", "20250630"),
    ("2025Q3", "20250701", "20250930"),
    ("2025Q4", "20251001", "20251231"),
]
STRESS_DELTA_PCT = 0.06
MIN_TRAIN_TRADES = 20
EXPERIMENT_ID = "zijin-round4-standard-quant"


def import_file(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


standard = import_file("zijin_round4_standard", STANDARD_PATH)
round2 = import_file("zijin_round4_round2", ROUND2_PATH)
peer = round2.peer
core = round2.core


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def audit_path(path: Path) -> str:
    """Return a stable report path for both source-tree and mounted files."""
    resolved = path.resolve()
    try:
        return resolved.relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return resolved.as_posix()


def progress(path: Path, stage: str, percent: int, message: str, **latest: Any) -> None:
    write_json(path, {
        "schemaVersion": 1,
        "experimentId": EXPERIMENT_ID,
        "status": "failed" if stage == "failed" else ("completed" if stage == "completed" else "running"),
        "stage": stage,
        "progress": max(0, min(100, int(percent))),
        "message": message,
        "latest": latest,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })


def source_commit() -> str:
    configured = os.environ.get("ZIJIN_SOURCE_COMMIT", "").strip()
    if configured:
        return configured
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
            capture_output=True, check=False,
        )
    except FileNotFoundError:
        # The production trainer intentionally uses python:slim and does not
        # install Git. Protocol/data hashes still provide the immutable audit
        # identity; the image label can be injected with ZIJIN_SOURCE_COMMIT.
        return "container-image"
    return completed.stdout.strip() or "uncommitted"


def parameter_configs(hypothesis: dict[str, Any]) -> list[dict[str, float]]:
    grid = hypothesis["parameterGrid"]
    keys = list(grid)
    return [dict(zip(keys, values, strict=True)) for values in itertools.product(*(grid[key] for key in keys))]


def load_samples(
    input_path: Path,
    cache_dir: Path,
    progress_path: Path | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    # The source may be Parquet, but the research host must not require an
    # optional pandas Parquet writer just to persist our derived cache.
    samples_path = cache_dir / "causal-samples-through-2025.pkl"
    panel_path = cache_dir / "target-minutes-through-2025.pkl"
    metadata_path = cache_dir / "cache-audit.json"
    fingerprint = {
        "input": str(input_path.resolve()),
        "size": input_path.stat().st_size,
        "mtimeNs": input_path.stat().st_mtime_ns,
        "selectionEnd": "20251231",
        "sampleBuilderVersion": 1,
    }
    if samples_path.exists() and panel_path.exists() and metadata_path.exists():
        audit = json.loads(metadata_path.read_text(encoding="utf-8"))
        cached_fingerprint = audit.get("fingerprint") if isinstance(audit.get("fingerprint"), dict) else {}
        cache_matches = all(cached_fingerprint.get(key) == value for key, value in fingerprint.items() if key != "sampleBuilderVersion")
        cache_matches = cache_matches and int(cached_fingerprint.get("sampleBuilderVersion", 1)) == fingerprint["sampleBuilderVersion"]
        if cache_matches:
            if progress_path:
                progress(progress_path, "loading-cache", 16, "已核验因果样本缓存，准备计算三组对照", causalCandidates=audit.get("causalCandidates", 0))
            return pd.read_pickle(samples_path), pd.read_pickle(panel_path), audit

    if progress_path:
        progress(progress_path, "loading-source", 4, "正在读取截至 2025-12-31 的历史分钟库；2026 保持封存")
    panel = round2.load_panel(input_path.resolve(), "20251231")
    if panel.empty or str(panel["tradeDate"].max()) > "20251231":
        raise RuntimeError("data isolation failed: the research loader reached 2026")
    if progress_path:
        progress(progress_path, "building-samples", 10, "历史分钟库已读取，正在生成只使用当时及此前数据的因果样本", minuteRows=int(len(panel)))
    samples, coverage = peer.build_samples(panel)
    if samples.empty:
        raise RuntimeError("no causal samples were generated")
    target = panel[panel["code"] == peer.TARGET_CODE].copy()
    samples.to_pickle(samples_path)
    target.to_pickle(panel_path)
    audit = {
        "fingerprint": fingerprint,
        "firstDate": str(panel["tradeDate"].min()),
        "lastDate": str(panel["tradeDate"].max()),
        "minuteRows": int(len(panel)),
        "tradingDays": int(panel["tradeDate"].nunique()),
        "causalCandidates": int(len(samples)),
        "stockCount": int(panel["code"].nunique()),
        "loaded2026Rows": int((panel["tradeDate"] >= "20260101").sum()),
        **coverage,
    }
    write_json(metadata_path, audit)
    if progress_path:
        progress(progress_path, "caching-samples", 16, "因果样本已生成并保存，准备计算三组对照", causalCandidates=int(len(samples)))
    return samples, target, audit


def hypothesis_rows(rows: pd.DataFrame, hypothesis_id: str, parameters: dict[str, float]) -> pd.DataFrame:
    if rows.empty:
        return rows.copy()
    if hypothesis_id == "opening-repair":
        gap = float(parameters["gapAbsPct"])
        repair = float(parameters["repairPct"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["minuteOfDay"] <= 10 * 60 + 30)
            & (rows["volumeRatio"] >= volume)
            & (
                ((rows["direction"] == "positive") & (rows["gapPct"] <= -gap) & (rows["openDeviationPct"] >= repair))
                | ((rows["direction"] == "reverse") & (rows["gapPct"] >= gap) & (rows["openDeviationPct"] <= -repair))
            )
        )
    elif hypothesis_id == "vwap-mean-reversion":
        bias = float(parameters["vwapBiasAbsPct"])
        zscore = float(parameters["zscoreAbs"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["minuteOfDay"] >= 9 * 60 + 35)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["volumeRatio"] >= volume)
            & (
                ((rows["direction"] == "positive") & (rows["vwapBiasPct"] <= -bias) & (rows["priceZscore"] <= -zscore))
                | ((rows["direction"] == "reverse") & (rows["vwapBiasPct"] >= bias) & (rows["priceZscore"] >= zscore))
            )
        )
    elif hypothesis_id == "peak-exhaustion":
        bias = float(parameters["vwapBiasPct"])
        position = float(parameters["minimumIntradayPosition"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["direction"] == "reverse")
            & (rows["minuteOfDay"] >= 9 * 60 + 35)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["vwapBiasPct"] >= bias)
            & (rows["intradayPosition"] >= position)
            & (rows["volumeRatio"] >= volume)
            & (rows["return3Pct"] < 0)
        )
    elif hypothesis_id == "sector-divergence":
        alpha = float(parameters["alphaAbsPct"])
        breadth = float(parameters["peerBreadthBoundary"])
        coverage = float(parameters["minimumPeerCoverage"])
        mask = (
            (rows["minuteOfDay"] >= 9 * 60 + 35)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["peerCoverage"] >= coverage)
            & (
                ((rows["direction"] == "positive") & (rows["zijinAlpha3Pct"] <= -alpha) & (rows["peerBreadth3"] >= breadth))
                | ((rows["direction"] == "reverse") & (rows["zijinAlpha3Pct"] >= alpha) & (rows["peerBreadth3"] <= 1 - breadth))
            )
        )
    elif hypothesis_id == "range-vwap-confirmation":
        maximum_vwap_slope = float(parameters["maximumAbsoluteVwapSlopePct"])
        bias = float(parameters["vwapBiasAbsPct"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["minuteOfDay"] >= 9 * 60 + 35)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["vwapSlope5Pct"].abs() <= maximum_vwap_slope)
            & (rows["ma10SlopePct"].abs() <= 0.06)
            & (rows["volumeRatio"] >= volume)
            & (
                ((rows["direction"] == "positive") & (rows["vwapBiasPct"] <= -bias) & (rows["priceZscore"] < 0))
                | ((rows["direction"] == "reverse") & (rows["vwapBiasPct"] >= bias) & (rows["priceZscore"] > 0))
            )
        )
    elif hypothesis_id == "trend-pullback-continuation":
        minimum_vwap_slope = float(parameters["minimumAbsoluteVwapSlopePct"])
        minimum_ma10_slope = float(parameters["minimumAbsoluteMa10SlopePct"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["minuteOfDay"] >= 9 * 60 + 35)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["volumeRatio"] >= volume)
            & (
                (
                    (rows["direction"] == "positive")
                    & (rows["vwapSlope5Pct"] >= minimum_vwap_slope)
                    & (rows["ma10SlopePct"] >= minimum_ma10_slope)
                    & (rows["vwapBiasPct"] <= 0)
                    & (rows["return3Pct"] > 0)
                    & (rows["peerBreadth3"] >= 0.5)
                )
                | (
                    (rows["direction"] == "reverse")
                    & (rows["vwapSlope5Pct"] <= -minimum_vwap_slope)
                    & (rows["ma10SlopePct"] <= -minimum_ma10_slope)
                    & (rows["vwapBiasPct"] >= 0)
                    & (rows["return3Pct"] < 0)
                    & (rows["peerBreadth3"] <= 0.5)
                )
            )
        )
    elif hypothesis_id == "drop-exhaustion-confirmation":
        bias = float(parameters["vwapBiasAbsPct"])
        zscore = float(parameters["priceZscoreAbs"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["direction"] == "positive")
            & (rows["minuteOfDay"] >= 9 * 60 + 33)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["vwapBiasPct"] <= -bias)
            & (rows["priceZscore"] <= -zscore)
            & (rows["intradayPosition"] <= 0.35)
            & (rows["volumeRatio"] >= volume)
            & (rows["return3Pct"] > 0)
        )
    elif hypothesis_id == "spike-exhaustion-confirmation":
        bias = float(parameters["vwapBiasAbsPct"])
        zscore = float(parameters["priceZscoreAbs"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["direction"] == "reverse")
            & (rows["minuteOfDay"] >= 9 * 60 + 33)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["vwapBiasPct"] >= bias)
            & (rows["priceZscore"] >= zscore)
            & (rows["intradayPosition"] >= 0.65)
            & (rows["volumeRatio"] >= volume)
            & (rows["return3Pct"] < 0)
        )
    elif hypothesis_id == "vwap-downside-reclaim-quality":
        bias = float(parameters["vwapBiasAbsPct"])
        maximum_negative_slope = float(parameters["maximumNegativeVwapSlopePct"])
        minimum_breadth = float(parameters["minimumPeerBreadth"])
        mask = (
            (rows["direction"] == "positive")
            & (rows["minuteOfDay"] >= 9 * 60 + 33)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["vwapBiasPct"] <= -bias)
            & (rows["vwapSlope5Pct"] >= -maximum_negative_slope)
            & (rows["ma5SlopePct"] > 0)
            & (rows["return3Pct"] > 0)
            & (rows["volumeRatio"] >= 0.7)
            & (rows["intradayPosition"] <= 0.45)
            & (rows["peerCoverage"] >= 0.8)
            & (rows["peerBreadth3"] >= minimum_breadth)
        )
    elif hypothesis_id == "vwap-upside-rejection-quality":
        bias = float(parameters["vwapBiasAbsPct"])
        maximum_positive_slope = float(parameters["maximumPositiveVwapSlopePct"])
        maximum_breadth = float(parameters["maximumPeerBreadth"])
        mask = (
            (rows["direction"] == "reverse")
            & (rows["minuteOfDay"] >= 9 * 60 + 33)
            & (rows["minuteOfDay"] <= 14 * 60 + 30)
            & (rows["vwapBiasPct"] >= bias)
            & (rows["vwapSlope5Pct"] <= maximum_positive_slope)
            & (rows["ma5SlopePct"] < 0)
            & (rows["return3Pct"] < 0)
            & (rows["volumeRatio"] >= 0.7)
            & (rows["intradayPosition"] >= 0.55)
            & (rows["peerCoverage"] >= 0.8)
            & (rows["peerBreadth3"] <= maximum_breadth)
        )
    elif hypothesis_id in {
        "morning-observable-range-vwap-reversion",
        "afternoon-observable-range-vwap-reversion",
    }:
        morning = hypothesis_id.startswith("morning-")
        start_minute = 9 * 60 + 33 if morning else 13 * 60
        end_minute = 10 * 60 + 30 if morning else 14 * 60 + 30
        maximum_vwap_slope = float(parameters["maximumAbsoluteVwapSlopePct"])
        bias = float(parameters["vwapBiasAbsPct"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["minuteOfDay"] >= start_minute)
            & (rows["minuteOfDay"] <= end_minute)
            & (rows["vwapSlope5Pct"].abs() <= maximum_vwap_slope)
            & (rows["ma10SlopePct"].abs() <= 0.06)
            & (rows["volumeRatio"] >= volume)
            & (
                (
                    (rows["direction"] == "positive")
                    & (rows["vwapBiasPct"] <= -bias)
                    & (rows["priceZscore"] < 0)
                    & (rows["ma5SlopePct"] > 0)
                    & (rows["return3Pct"] > 0)
                )
                | (
                    (rows["direction"] == "reverse")
                    & (rows["vwapBiasPct"] >= bias)
                    & (rows["priceZscore"] > 0)
                    & (rows["ma5SlopePct"] < 0)
                    & (rows["return3Pct"] < 0)
                )
            )
        )
    elif hypothesis_id in {
        "morning-observable-trend-pullback",
        "afternoon-observable-trend-pullback",
    }:
        morning = hypothesis_id.startswith("morning-")
        start_minute = 9 * 60 + 33 if morning else 13 * 60
        end_minute = 10 * 60 + 30 if morning else 14 * 60 + 30
        minimum_vwap_slope = float(parameters["minimumAbsoluteVwapSlopePct"])
        maximum_distance = float(parameters["maximumVwapDistancePct"])
        volume = float(parameters["minimumVolumeRatio"])
        mask = (
            (rows["minuteOfDay"] >= start_minute)
            & (rows["minuteOfDay"] <= end_minute)
            & (rows["volumeRatio"] >= volume)
            & (rows["peerCoverage"] >= 0.8)
            & (rows["vwapBiasPct"].abs() <= maximum_distance)
            & (
                (
                    (rows["direction"] == "positive")
                    & (rows["vwapSlope5Pct"] >= minimum_vwap_slope)
                    & (rows["ma10SlopePct"] >= 0.01)
                    & (rows["ma5SlopePct"] > 0)
                    & (rows["return3Pct"] > 0)
                    & (rows["peerBreadth3"] >= 0.5)
                )
                | (
                    (rows["direction"] == "reverse")
                    & (rows["vwapSlope5Pct"] <= -minimum_vwap_slope)
                    & (rows["ma10SlopePct"] <= -0.01)
                    & (rows["ma5SlopePct"] < 0)
                    & (rows["return3Pct"] < 0)
                    & (rows["peerBreadth3"] <= 0.5)
                )
            )
        )
    else:
        raise ValueError(f"unknown hypothesis: {hypothesis_id}")
    return rows[mask].copy()


def independent(rows: pd.DataFrame) -> pd.DataFrame:
    return core.independent_rows(rows, max_per_day=2) if not rows.empty else rows.copy()


def diagnostic_reference_parameters(hypothesis: dict[str, Any]) -> dict[str, float]:
    """Choose the widest preregistered configuration for read-only diagnostics.

    These values only explain where already-created causal candidates disappear.
    They are never passed to model selection or promotion.
    """
    grid = hypothesis["parameterGrid"]
    hypothesis_id = str(hypothesis["id"])
    if "range-vwap-reversion" in hypothesis_id:
        return {
            "maximumAbsoluteVwapSlopePct": float(max(grid["maximumAbsoluteVwapSlopePct"])),
            "vwapBiasAbsPct": float(min(grid["vwapBiasAbsPct"])),
            "minimumVolumeRatio": float(min(grid["minimumVolumeRatio"])),
        }
    return {
        "minimumAbsoluteVwapSlopePct": float(min(grid["minimumAbsoluteVwapSlopePct"])),
        "maximumVwapDistancePct": float(max(grid["maximumVwapDistancePct"])),
        "minimumVolumeRatio": float(min(grid["minimumVolumeRatio"])),
    }


def sample_formation_diagnostic(
    samples: pd.DataFrame,
    hypotheses: list[dict[str, Any]],
) -> dict[str, Any]:
    """Explain sample attrition without changing the frozen experiment."""
    population = samples[(samples["date"] >= "20240101") & (samples["date"] <= "20251231")].copy()
    reports: list[dict[str, Any]] = []
    for hypothesis in hypotheses:
        hypothesis_id = str(hypothesis["id"])
        morning = hypothesis_id.startswith("morning-")
        start_minute = 9 * 60 + 33 if morning else 13 * 60
        end_minute = 10 * 60 + 30 if morning else 14 * 60 + 30
        parameters = diagnostic_reference_parameters(hypothesis)
        rows = population
        stages: list[dict[str, Any]] = [{"id": "causal-anchor", "count": int(len(rows))}]

        rows = rows[(rows["minuteOfDay"] >= start_minute) & (rows["minuteOfDay"] <= end_minute)]
        stages.append({"id": "session", "count": int(len(rows))})

        if "range-vwap-reversion" in hypothesis_id:
            maximum_slope = parameters["maximumAbsoluteVwapSlopePct"]
            rows = rows[(rows["vwapSlope5Pct"].abs() <= maximum_slope) & (rows["ma10SlopePct"].abs() <= 0.06)]
            stages.append({"id": "observable-regime", "count": int(len(rows))})
            bias = parameters["vwapBiasAbsPct"]
            rows = rows[
                ((rows["direction"] == "positive") & (rows["vwapBiasPct"] <= -bias) & (rows["priceZscore"] < 0))
                | ((rows["direction"] == "reverse") & (rows["vwapBiasPct"] >= bias) & (rows["priceZscore"] > 0))
            ]
            stages.append({"id": "vwap-location", "count": int(len(rows))})
            rows = rows[
                ((rows["direction"] == "positive") & (rows["ma5SlopePct"] > 0) & (rows["return3Pct"] > 0))
                | ((rows["direction"] == "reverse") & (rows["ma5SlopePct"] < 0) & (rows["return3Pct"] < 0))
            ]
            stages.append({"id": "turn-confirmation", "count": int(len(rows))})
        else:
            rows = rows[rows["peerCoverage"] >= 0.8]
            stages.append({"id": "peer-coverage", "count": int(len(rows))})
            minimum_slope = parameters["minimumAbsoluteVwapSlopePct"]
            rows = rows[
                ((rows["direction"] == "positive") & (rows["vwapSlope5Pct"] >= minimum_slope) & (rows["ma10SlopePct"] >= 0.01))
                | ((rows["direction"] == "reverse") & (rows["vwapSlope5Pct"] <= -minimum_slope) & (rows["ma10SlopePct"] <= -0.01))
            ]
            stages.append({"id": "observable-trend", "count": int(len(rows))})
            maximum_distance = parameters["maximumVwapDistancePct"]
            rows = rows[rows["vwapBiasPct"].abs() <= maximum_distance]
            stages.append({"id": "vwap-distance", "count": int(len(rows))})
            rows = rows[
                (
                    (rows["direction"] == "positive")
                    & (rows["ma5SlopePct"] > 0)
                    & (rows["return3Pct"] > 0)
                    & (rows["peerBreadth3"] >= 0.5)
                )
                | (
                    (rows["direction"] == "reverse")
                    & (rows["ma5SlopePct"] < 0)
                    & (rows["return3Pct"] < 0)
                    & (rows["peerBreadth3"] <= 0.5)
                )
            ]
            stages.append({"id": "continuation-confirmation", "count": int(len(rows))})

        rows = rows[rows["volumeRatio"] >= parameters["minimumVolumeRatio"]]
        stages.append({"id": "volume", "count": int(len(rows))})
        selected = independent(rows)
        stages.append({"id": "independent-limit", "count": int(len(selected))})
        drops = [
            {
                "stage": stages[index]["id"],
                "removed": stages[index - 1]["count"] - stages[index]["count"],
            }
            for index in range(1, len(stages))
        ]
        bottleneck = max(drops, key=lambda item: item["removed"], default={"stage": "none", "removed": 0})
        target_touched = int(selected["targetTouched"].sum()) if not selected.empty else 0
        reports.append({
            "hypothesisId": hypothesis_id,
            "name": hypothesis["name"],
            "session": hypothesis["session"],
            "diagnosticOnly": True,
            "referenceParameters": parameters,
            "stages": stages,
            "primaryBottleneck": bottleneck,
            "targetTouched": target_touched,
            "targetTouchRate": round(target_touched / len(selected), 4) if len(selected) else None,
            "medianHoldMinutes": round(float(selected["holdMinutes"].median()), 1) if len(selected) else None,
            "exitReasons": {
                str(reason): int(count)
                for reason, count in selected["exitReason"].value_counts().sort_index().items()
            },
        })
    return {
        "schemaVersion": 1,
        "diagnosticOnly": True,
        "canSelectParameters": False,
        "population": {"start": "2024-01-01", "end": "2025-12-31", "causalAnchors": int(len(population))},
        "outcomeLabel": {
            "entry": "next-minute-open",
            "netTargetPct": [core.MIN_NET_TARGET_PCT, core.MAX_NET_TARGET_PCT],
            "roundTripCostPct": core.ROUND_TRIP_COST_PCT,
            "maximumHoldMinutes": core.MAX_HOLD_MINUTES,
            "futureBarsUsedForSelection": False,
        },
        "hypotheses": reports,
    }


def metrics(rows: pd.DataFrame) -> dict[str, Any]:
    selected = independent(rows)
    summary = core.summarize(selected)
    return {
        **summary,
        "stressAverageNetPct": round(float(summary["averageNetPct"]) - STRESS_DELTA_PCT, 4) if summary["trades"] else 0.0,
        "dates": int(selected["date"].nunique()) if not selected.empty else 0,
    }


def training_rows(rows: pd.DataFrame, validation_start: str) -> tuple[pd.DataFrame, str]:
    prior_dates = sorted(rows.loc[rows["date"] < validation_start, "date"].astype(str).unique())
    if len(prior_dates) < 2:
        return rows.iloc[0:0].copy(), ""
    embargo_date = prior_dates[-1]
    return rows[(rows["date"] < embargo_date)].copy(), embargo_date


def simple_vwap_metrics(samples: pd.DataFrame, start: str, end: str) -> dict[str, Any]:
    rows = samples[(samples["date"] >= start) & (samples["date"] <= end)]
    mask = (
        ((rows["direction"] == "positive") & (rows["vwapBiasPct"] <= -0.30) & (rows["return3Pct"] > 0))
        | ((rows["direction"] == "reverse") & (rows["vwapBiasPct"] >= 0.30) & (rows["return3Pct"] < 0))
    )
    return metrics(rows[mask])


def v4_baseline(target: pd.DataFrame, runtime_dir: Path) -> dict[str, dict[str, Any]]:
    sessions = []
    for date, day in target.groupby("tradeDate", sort=True):
        if not "20240101" <= str(date) <= "20251231":
            continue
        ordered = day.sort_values("tradeTime")
        valid_prices = pd.to_numeric(ordered["close"], errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
        if valid_prices.empty:
            continue
        previous_values = pd.to_numeric(ordered["previousClose"], errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
        previous_close = float(previous_values.iloc[0]) if not previous_values.empty else float(valid_prices.iloc[0])
        minutes = []
        for row in ordered.itertuples():
            price = float(row.close)
            if not np.isfinite(price):
                continue
            volume = float(row.volume)
            minutes.append({
                "time": "".join(character for character in str(row.tradeTime) if character.isdigit())[:4].zfill(4),
                "price": price,
                "volume": volume if np.isfinite(volume) else 0.0,
            })
        sessions.append({
            "date": str(date),
            "previousClose": previous_close,
            "minutes": minutes,
        })
    input_path = runtime_dir / "v4-baseline-input.json"
    output_path = runtime_dir / "v4-baseline-output.json"
    write_json(input_path, sessions)
    completed = subprocess.run(
        ["node", str(HERE / "round4-v4-baseline.mjs"), str(input_path), str(output_path)],
        cwd=ROOT, text=True, capture_output=True, check=False,
    )
    if completed.returncode:
        raise RuntimeError(f"Smart-T V4 baseline failed: {completed.stderr.strip()}")
    rows = json.loads(output_path.read_text(encoding="utf-8"))
    result: dict[str, dict[str, Any]] = {}
    for label, start, end in FOLDS:
        values = [value for row in rows if start <= row["date"] <= end for value in row["cycleNetPcts"]]
        result[label] = {
            "trades": len(values),
            "winRate": sum(value > 0 for value in values) / len(values) if values else None,
            "averageNetPct": float(np.mean(values)) if values else 0.0,
        }
    return result


def choose_training_config(samples: pd.DataFrame, hypothesis_id: str, configs: list[dict[str, float]], start: str) -> int:
    candidates: list[tuple[bool, float, float, int, int]] = []
    for index, config in enumerate(configs):
        universe = hypothesis_rows(samples, hypothesis_id, config)
        training, _ = training_rows(universe, start)
        result = metrics(training)
        candidates.append((
            int(result["trades"]) >= MIN_TRAIN_TRADES,
            float(result["averageNetPct"]),
            float(result["winRate"] or 0),
            int(result["trades"]),
            -index,
        ))
    return max(range(len(configs)), key=lambda index: candidates[index])


def run_hypothesis(
    hypothesis: dict[str, Any], samples: pd.DataFrame, baselines: dict[str, dict[str, Any]],
    protocol: dict[str, Any], ledger_path: Path, run_id: str, commit: str,
) -> dict[str, Any]:
    configs = parameter_configs(hypothesis)
    matrix = [[0.0 for _ in FOLDS] for _ in configs]
    rolling_returns: list[float] = []
    rolling_quarters: list[dict[str, Any]] = []
    total_wins = 0
    total_trades = 0

    for fold_index, (label, start, end) in enumerate(FOLDS):
        selected_index = choose_training_config(samples, hypothesis["id"], configs, start)
        selected_result: dict[str, Any] | None = None
        for config_index, config in enumerate(configs):
            universe = hypothesis_rows(samples, hypothesis["id"], config)
            training, embargo_date = training_rows(universe, start)
            validation = universe[(universe["date"] >= start) & (universe["date"] <= end)]
            training_result = metrics(training)
            validation_result = metrics(validation)
            matrix[config_index][fold_index] = float(validation_result["averageNetPct"])
            if config_index == selected_index:
                selected_result = validation_result
            trial = {
                "trialId": f"{run_id}:{hypothesis['id']}:{label}:c{config_index + 1}",
                "hypothesisId": hypothesis["id"],
                "sourceCommit": commit,
                "runId": run_id,
                "trainingRange": {"start": "20220101", "end": str(training["date"].max()) if not training.empty else "20231231"},
                "validationRange": {"start": start, "end": end},
                "featureNames": hypothesis["features"],
                "parameters": config,
                "baseCostMetrics": validation_result,
                "stressCostMetrics": {**validation_result, "averageNetPct": validation_result["stressAverageNetPct"]},
                "baselineMetrics": baselines[label],
                "selectionDecision": {
                    "selectedByPriorData": config_index == selected_index,
                    "trainingMetrics": training_result,
                    "embargoDate": embargo_date,
                },
            }
            standard.append_trial(ledger_path, trial, protocol)
        selected_result = selected_result or metrics(samples.iloc[0:0])
        rolling_returns.append(float(selected_result["averageNetPct"]))
        total_wins += int(selected_result["wins"])
        total_trades += int(selected_result["trades"])
        rolling_quarters.append({
            "id": label,
            "validationStart": start,
            "validationEnd": end,
            "selectedConfigIndex": selected_index,
            "parameters": configs[selected_index],
            "trades": selected_result["trades"],
            "wins": selected_result["wins"],
            "winRate": selected_result["winRate"],
            "netPct": selected_result["averageNetPct"],
            "stressNetPct": selected_result["stressAverageNetPct"],
        })

    trial_matrix = [*matrix, rolling_returns]
    baseline_summary = [
        {"id": baseline_id, "netPct": float(np.mean([baselines[label][baseline_id]["netPct"] for label, _, _ in FOLDS]))}
        for baseline_id in ("no-trade", "simple-vwap", "smart-t-v4")
    ]
    summary = {
        "hypothesisId": hypothesis["id"],
        "periodsPerYear": 4,
        "outerQuarters": rolling_quarters,
        "outOfSampleWinRate": total_wins / total_trades if total_trades else 0.0,
        "baselines": baseline_summary,
        "trialPeriodReturns": trial_matrix,
        "selectedTrialIndex": len(trial_matrix) - 1,
    }
    evaluation = standard.evaluate_promotion(summary, protocol)
    feasibility_gate = protocol.get("feasibilityGate", {})
    covered_outer_quarters = sum(1 for item in rolling_quarters if int(item["trades"]) > 0)
    minimum_trades = int(feasibility_gate.get("minimumOutOfSampleTrades", 0))
    minimum_quarters = int(feasibility_gate.get("minimumCoveredOuterQuarters", 0))
    feasibility = {
        "passed": total_trades >= minimum_trades and covered_outer_quarters >= minimum_quarters,
        "outOfSampleTrades": total_trades,
        "minimumOutOfSampleTrades": minimum_trades,
        "coveredOuterQuarters": covered_outer_quarters,
        "minimumCoveredOuterQuarters": minimum_quarters,
        "doesNotGrantPromotion": bool(feasibility_gate.get("doesNotGrantPromotion", True)),
    }
    return {
        **summary,
        "name": hypothesis["name"],
        "features": hypothesis["features"],
        "candidateConfigurations": configs,
        "feasibility": feasibility,
        "evaluation": evaluation,
    }


def build_baselines(samples: pd.DataFrame, target: pd.DataFrame, runtime_dir: Path) -> dict[str, dict[str, Any]]:
    v4 = v4_baseline(target, runtime_dir)
    result: dict[str, dict[str, Any]] = {}
    for label, start, end in FOLDS:
        simple = simple_vwap_metrics(samples, start, end)
        result[label] = {
            "no-trade": {"netPct": 0.0, "trades": 0, "winRate": None},
            "simple-vwap": {"netPct": simple["averageNetPct"], "trades": simple["trades"], "winRate": simple["winRate"]},
            "smart-t-v4": {"netPct": v4[label]["averageNetPct"], "trades": v4[label]["trades"], "winRate": v4[label]["winRate"]},
        }
    return result


def main() -> None:
    global EXPERIMENT_ID
    parser = argparse.ArgumentParser(description="Run four independent Zijin round-four experiments")
    parser.add_argument("input", type=Path, help="7-stock minute peer-panel parquet")
    parser.add_argument("--protocol", type=Path, default=PROTOCOL_PATH)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".round4-runtime")
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--report", type=Path, default=ROOT / "public/research/zijin-round4-report.json")
    parser.add_argument("--progress", type=Path, default=ROOT / "public/research/zijin-round4-progress.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    protocol = standard.load_protocol(args.protocol)
    EXPERIMENT_ID = str(protocol["experimentId"])
    protocol_hash = standard.canonical_hash(protocol)
    configs = {item["id"]: len(parameter_configs(item)) for item in protocol["hypotheses"]}
    if args.dry_run:
        print(json.dumps({
            "valid": True,
            "protocolHash": protocol_hash,
            "hypotheses": configs,
            "outerFolds": len(FOLDS),
            "plannedLedgerRecords": sum(configs.values()) * len(FOLDS),
            "reads2026": False,
        }, ensure_ascii=False, indent=2))
        return

    args.runtime.mkdir(parents=True, exist_ok=True)
    ledger_path = args.ledger or args.runtime / f"zijin-round{protocol['round']}-trials.jsonl"
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime(f"r{protocol['round']}-%Y%m%dT%H%M%S") + f"-{time.time_ns() % 1_000_000:06d}"
    commit = source_commit()
    progress(args.progress, "loading", 2, "仅加载 2025-12-31 及以前数据；2026 保持封存", runId=run_id)
    samples, target, audit = load_samples(args.input, args.runtime / "cache", args.progress)
    progress(args.progress, "baselines", 18, "计算不交易、简单 VWAP 和当前 V4 三个基准", causalCandidates=len(samples))
    baselines = build_baselines(samples, target, args.runtime)
    formation_diagnostic = sample_formation_diagnostic(samples, protocol["hypotheses"])
    progress(args.progress, "baselines", 22, "三组对照已完成，开始逐个运行预登记假设", causalCandidates=len(samples))

    reports = []
    hypothesis_total = len(protocol["hypotheses"])
    for index, hypothesis in enumerate(protocol["hypotheses"]):
        start_percent = 22 + int(index * 60 / max(1, hypothesis_total))
        progress(
            args.progress, "rolling-oos", start_percent,
            f"正在运行独立假设：{hypothesis['name']}",
            completedHypotheses=index, totalHypotheses=hypothesis_total, hypothesisId=hypothesis["id"],
        )
        reports.append(run_hypothesis(hypothesis, samples, baselines, protocol, ledger_path, run_id, commit))
        progress(
            args.progress, "rolling-oos", 22 + int((index + 1) * 60 / max(1, hypothesis_total)),
            f"独立假设已完成：{hypothesis['name']}",
            completedHypotheses=index + 1, totalHypotheses=hypothesis_total, hypothesisId=hypothesis["id"],
        )

    progress(args.progress, "risk-audit", 90, "正在核查费用、跨季度稳定性、PBO 与 Deflated Sharpe", completedHypotheses=hypothesis_total, totalHypotheses=hypothesis_total)
    qualified = [item for item in reports if item["evaluation"]["passedRollingOutOfSample"]]
    ledger_rows = standard.read_ledger(ledger_path)
    progress(args.progress, "ledger-audit", 96, "风险门槛已核查，正在验证不可覆盖试验账本", qualifiedHypotheses=len(qualified), ledgerRecords=len(ledger_rows))
    result = {
        "schemaVersion": 1,
        "experimentId": protocol["experimentId"],
        "runId": run_id,
        "sourceCommit": commit,
        "protocolHash": protocol_hash,
        "status": "qualified-for-final-blind" if qualified else "research-rejected",
        "affectsV4": False,
        "reads2026": False,
        "dataset": audit,
        "methodology": {
            "hypothesesIndependent": True,
            "selection": "anchored quarterly walk-forward; each quarter selects only from earlier dates",
            "decisionData": "minute t and earlier only",
            "fill": "minute t+1 open",
            "baseRoundTripCostPct": 0.12,
            "stressRoundTripCostPct": 0.18,
            "outerFolds": [label for label, _, _ in FOLDS],
        },
        "baselinesByQuarter": baselines,
        "sampleFormationDiagnostic": formation_diagnostic,
        "hypotheses": reports,
        "qualifiedHypothesisIds": [item["hypothesisId"] for item in qualified],
        "finalBlind": {
            "sealed": not bool(qualified),
            "allowed": bool(qualified),
            "oneShotCommandRequired": True,
            "opened": False,
        },
        "ledger": {
            "path": audit_path(ledger_path),
            "records": len(ledger_rows),
            "runRecords": sum(row.get("runId") == run_id for row in ledger_rows),
            "chainTip": ledger_rows[-1]["recordHash"] if ledger_rows else standard.GENESIS_HASH,
            "verified": True,
        },
        "elapsedSeconds": round(time.time() - started, 2),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    write_json(args.report, result)
    progress(
        args.progress, "completed", 100,
        "滚动样本外全部完成；合格模型可申请一次 2026 最终盲测" if qualified else "滚动样本外未通过；2026 继续封存，禁止调参硬过",
        qualifiedHypotheses=len(qualified), ledgerRecords=result["ledger"]["runRecords"], runId=run_id,
    )
    print(json.dumps({
        "runId": run_id,
        "status": result["status"],
        "qualifiedHypothesisIds": result["qualifiedHypothesisIds"],
        "ledgerRecords": result["ledger"]["runRecords"],
        "report": str(args.report),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        failure_path = ROOT / "public/research/zijin-round4-progress.json"
        if "--progress" in sys.argv:
            position = sys.argv.index("--progress")
            if position + 1 < len(sys.argv):
                failure_path = Path(sys.argv[position + 1])
        progress(
            failure_path,
            "failed",
            0,
            f"实验已停止：{error}",
            errorType=type(error).__name__,
        )
        raise
