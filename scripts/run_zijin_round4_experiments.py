#!/usr/bin/env python3
"""Execute the four preregistered Zijin hypotheses on sealed causal data.

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


def progress(path: Path, stage: str, percent: int, message: str, **latest: Any) -> None:
    write_json(path, {
        "schemaVersion": 1,
        "experimentId": "zijin-round4-standard-quant",
        "status": "completed" if stage == "completed" else "running",
        "stage": stage,
        "progress": max(0, min(100, int(percent))),
        "message": message,
        "latest": latest,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })


def source_commit() -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
        capture_output=True, check=False,
    )
    return completed.stdout.strip() or "uncommitted"


def parameter_configs(hypothesis: dict[str, Any]) -> list[dict[str, float]]:
    grid = hypothesis["parameterGrid"]
    keys = list(grid)
    return [dict(zip(keys, values, strict=True)) for values in itertools.product(*(grid[key] for key in keys))]


def load_samples(input_path: Path, cache_dir: Path, protocol_hash: str) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    samples_path = cache_dir / "causal-samples-through-2025.parquet"
    panel_path = cache_dir / "target-minutes-through-2025.parquet"
    metadata_path = cache_dir / "cache-audit.json"
    fingerprint = {
        "input": str(input_path.resolve()),
        "size": input_path.stat().st_size,
        "mtimeNs": input_path.stat().st_mtime_ns,
        "protocolHash": protocol_hash,
        "selectionEnd": "20251231",
    }
    if samples_path.exists() and panel_path.exists() and metadata_path.exists():
        audit = json.loads(metadata_path.read_text(encoding="utf-8"))
        if audit.get("fingerprint") == fingerprint:
            return pd.read_parquet(samples_path), pd.read_parquet(panel_path), audit

    panel = round2.load_panel(input_path.resolve(), "20251231")
    if panel.empty or str(panel["tradeDate"].max()) > "20251231":
        raise RuntimeError("data isolation failed: the research loader reached 2026")
    samples, coverage = peer.build_samples(panel)
    if samples.empty:
        raise RuntimeError("no causal samples were generated")
    target = panel[panel["code"] == peer.TARGET_CODE].copy()
    samples.to_parquet(samples_path, index=False)
    target.to_parquet(panel_path, index=False)
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
    else:
        raise ValueError(f"unknown hypothesis: {hypothesis_id}")
    return rows[mask].copy()


def independent(rows: pd.DataFrame) -> pd.DataFrame:
    return core.independent_rows(rows, max_per_day=2) if not rows.empty else rows.copy()


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
        sessions.append({
            "date": str(date),
            "previousClose": float(ordered["previousClose"].iloc[0]),
            "minutes": [
                {
                    "time": "".join(character for character in str(row.tradeTime) if character.isdigit())[:4].zfill(4),
                    "price": float(row.close),
                    "volume": float(row.volume),
                }
                for row in ordered.itertuples()
            ],
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
    return {
        **summary,
        "name": hypothesis["name"],
        "features": hypothesis["features"],
        "candidateConfigurations": configs,
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
    ledger_path = args.ledger or args.runtime / "zijin-round4-trials.jsonl"
    started = time.time()
    run_id = datetime.now(timezone.utc).strftime("r4-%Y%m%dT%H%M%S") + f"-{time.time_ns() % 1_000_000:06d}"
    commit = source_commit()
    progress(args.progress, "loading", 2, "仅加载 2025-12-31 及以前数据；2026 保持封存", runId=run_id)
    samples, target, audit = load_samples(args.input, args.runtime / "cache", protocol_hash)
    progress(args.progress, "baselines", 18, "计算不交易、简单 VWAP 和当前 V4 三个基准", causalCandidates=len(samples))
    baselines = build_baselines(samples, target, args.runtime)

    reports = []
    for index, hypothesis in enumerate(protocol["hypotheses"]):
        progress(
            args.progress, "rolling-oos", 22 + index * 18,
            f"正在运行独立假设：{hypothesis['name']}",
            completedHypotheses=index, totalHypotheses=4, hypothesisId=hypothesis["id"],
        )
        reports.append(run_hypothesis(hypothesis, samples, baselines, protocol, ledger_path, run_id, commit))

    qualified = [item for item in reports if item["evaluation"]["passedRollingOutOfSample"]]
    ledger_rows = standard.read_ledger(ledger_path)
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
        "hypotheses": reports,
        "qualifiedHypothesisIds": [item["hypothesisId"] for item in qualified],
        "finalBlind": {
            "sealed": not bool(qualified),
            "allowed": bool(qualified),
            "oneShotCommandRequired": True,
            "opened": False,
        },
        "ledger": {
            "path": str(ledger_path),
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
    main()
