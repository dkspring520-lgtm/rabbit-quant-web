#!/usr/bin/env python3
"""Research-only capacity study for a causal Zijin regime-quality factor.

Configurations are selected only on 2024 after fitting on data available through
2023.  The frozen configuration is then evaluated once on 2025 and once on the
available 2026 segment.  This does not mutate any live Smart-T, factor registry,
or shadow state.
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


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
V5_PATH = HERE / "evaluate_zijin_v5_hierarchical.py"
PROTOCOL_PATH = HERE / "zijin-v6-regime-quality-protocol.json"
TARGET_CODE = "601899"


def import_file(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


v5 = import_file("zijin_v6_v5", V5_PATH)


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


def regime_score(rows: pd.DataFrame, direction: str) -> pd.Series:
    """Six observable confirmations; all values are known at minute t."""
    sign = 1 if direction == "positive" else -1

    def aligned(column: str) -> pd.Series:
        values = pd.to_numeric(rows[column], errors="coerce").fillna(0)
        return (values * sign >= 0).astype(int)

    return (
        aligned("rolling5ReturnPct")
        + aligned("rolling20ReturnPct")
        + aligned("peerBreadth3")
        + aligned("peerBreadthVwap")
        + aligned("zijinAlpha5Pct")
        + (pd.to_numeric(rows["volumeRatio"], errors="coerce").fillna(0) >= 1.0).astype(int)
    ).astype(int)


def with_direction_score(rows: pd.DataFrame, weights: dict[str, float]) -> pd.DataFrame:
    result = rows.copy()
    result["directionScore"] = v5.direction_score(result, weights)
    result["regimeScore"] = 0
    for direction in ("positive", "reverse"):
        mask = result["direction"] == direction
        result.loc[mask, "regimeScore"] = regime_score(result.loc[mask], direction)
    return result


def period_days(rows: pd.DataFrame, start: str, end: str) -> int:
    dates = rows.loc[(rows["date"] >= start) & (rows["date"] <= end), "date"].drop_duplicates()
    return int(len(dates))


def enrich_metrics(rows: pd.DataFrame, all_rows: pd.DataFrame, start: str, end: str, stress_delta: float) -> dict[str, float | int | None]:
    metrics = v5.summarize(rows, stress_delta)
    days = period_days(all_rows, start, end)
    trades = int(metrics["trades"])
    metrics["tradingDays"] = days
    metrics["tradesPer100TradingDays"] = round(trades / days * 100, 2) if days else None
    return metrics


def candidate_rows(
    all_rows: pd.DataFrame,
    peer_rows: pd.DataFrame,
    start: str,
    end: str,
    history_end: str,
    config: dict[str, float | int],
    protocol: dict[str, Any],
) -> pd.DataFrame:
    features = list(v5.core.FEATURES)
    selected_by_direction: list[pd.DataFrame] = []
    start_minute, end_minute = [v5.minute_number(value) for value in protocol["execution"]["session"]]
    direction_policy = protocol["hierarchy"]["direction"]
    opening_policy = protocol["openingDirection"]
    for direction in ("positive", "reverse"):
        peer_training = peer_rows[(peer_rows["date"] <= history_end) & (peer_rows["direction"] == direction)]
        calibration = all_rows[(all_rows["date"] <= history_end) & (all_rows["direction"] == direction)]
        evaluation = all_rows[
            (all_rows["date"] >= start)
            & (all_rows["date"] <= end)
            & (all_rows["direction"] == direction)
        ].copy()
        if len(peer_training) < 500 or calibration.empty or evaluation.empty:
            continue
        model = v5.model_for(peer_training, features)
        cutoff = float(np.quantile(model.predict_proba(calibration[features])[:, 1], float(config["probabilityQuantile"])))
        evaluation["probability"] = model.predict_proba(evaluation[features])[:, 1]
        # V5's independent scheduler orders simultaneous candidates by this
        # stable score column.  Keep the raw probability alongside the public
        # quality score so scheduling stays causal and reproducible.
        evaluation["score"] = evaluation["probability"]
        evaluation["cutoff"] = cutoff
        evaluation["qualityScore"] = np.clip(
            (evaluation["probability"] - cutoff) / max(1.0 - cutoff, 1e-9) * 70
            + evaluation["regimeScore"] / 6.0 * 30,
            0,
            100,
        )
        if direction == "positive":
            direction_permission = evaluation["directionScore"] >= float(direction_policy["positivePermissionAtOrAbove"])
        else:
            direction_permission = evaluation["directionScore"] <= float(direction_policy["reversePermissionAtOrBelow"])
        opening_permission = v5.opening_direction_permission(evaluation, direction, opening_policy)
        chosen = evaluation[
            direction_permission
            & opening_permission
            & (evaluation["probability"] >= cutoff)
            & (evaluation["regimeScore"] >= int(config["minimumRegimeScore"]))
            & (evaluation["peerCoverage"] >= 0.8)
            & (evaluation["volumeRatio"] >= 0.70)
            & (evaluation["minuteOfDay"] >= start_minute)
            & (evaluation["minuteOfDay"] <= end_minute)
        ].copy()
        selected_by_direction.append(chosen)
    pool = pd.concat(selected_by_direction, ignore_index=True) if selected_by_direction else all_rows.iloc[0:0].copy()
    return v5.independent(pool, int(protocol["execution"]["maximumSignalsPerDay"]))


def passes_capacity(metrics: dict[str, float | int | None], gate: dict[str, float]) -> bool:
    return bool(
        metrics["tradesPer100TradingDays"] is not None
        and metrics["tradesPer100TradingDays"] >= gate["minimumTradesPer100TradingDays"]
        and metrics["winRate"] is not None
        and metrics["winRate"] >= gate["minimumAfterCostWinRate"]
        and metrics["averageNetPct"] is not None
        and metrics["averageNetPct"] > gate["minimumAfterCostAverageNetPct"]
        and metrics["stressAverageNetPct"] is not None
        and metrics["stressAverageNetPct"] > gate["minimumStressAverageNetPct"]
        and metrics["payoffRatio"] is not None
        and metrics["payoffRatio"] >= gate["minimumPayoffRatio"]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="V6 causal regime-quality capacity research for Zijin Mining")
    parser.add_argument("input", type=Path, help="seven-stock minute parquet panel")
    parser.add_argument("--protocol", type=Path, default=PROTOCOL_PATH)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".v6-regime-quality-runtime")
    parser.add_argument("--report", type=Path, default=ROOT / "public/research/zijin-v6-regime-quality-report.json")
    args = parser.parse_args()

    protocol = json.loads(args.protocol.read_text(encoding="utf-8"))
    inherited_policy = json.loads(v5.PROTOCOL_PATH.read_text(encoding="utf-8"))
    effective_protocol = {
        **protocol,
        "hierarchy": inherited_policy["hierarchy"],
        "openingDirection": inherited_policy["openingDirection"],
    }
    panel = v5.peer.load_panel(args.input.resolve())
    args.runtime.mkdir(parents=True, exist_ok=True)
    target_cache = args.runtime / "target-causal-samples-through-2026.pkl"
    target_audit_cache = args.runtime / "target-cache-audit.json"
    if target_cache.exists() and target_audit_cache.exists():
        target_samples = pd.read_pickle(target_cache)
        target_audit = json.loads(target_audit_cache.read_text(encoding="utf-8"))
    else:
        target_samples, target_audit = v5.peer.build_samples(panel)
        target_samples.to_pickle(target_cache)
        atomic_json(target_audit_cache, target_audit)
    peer_codes = [str(code) for code in inherited_policy["dataPolicy"]["peerTrainingCodes"]]
    peer_samples = v5.prepare_peer_samples(panel, peer_codes, args.runtime / "peer-core-samples-through-2026.pkl")
    required = list(v5.core.FEATURES) + [
        "rolling20ReturnPct", "rolling5ReturnPct", "peerBreadth3", "peerBreadthVwap",
        "zijinAlpha5Pct", "peerCoverage", "volumeRatio", "netPct", "won", "exitIndex",
    ]
    target_samples = target_samples.dropna(subset=required).copy()
    peer_samples = peer_samples.dropna(subset=list(v5.core.FEATURES) + ["won"]).copy()
    target_samples = with_direction_score(target_samples, effective_protocol["hierarchy"]["direction"]["weights"])

    selection_start, selection_end, selection_history_end = "20240101", "20241231", "20231231"
    stress_delta = float(protocol["execution"]["stressRoundTripCostPct"]) - float(protocol["execution"]["baseRoundTripCostPct"])
    configuration_reports: list[dict[str, Any]] = []
    for quantile in protocol["candidateGrid"]["probabilityQuantiles"]:
        for minimum_regime in protocol["candidateGrid"]["minimumRegimeScores"]:
            config = {"probabilityQuantile": float(quantile), "minimumRegimeScore": int(minimum_regime)}
            rows = candidate_rows(target_samples, peer_samples, selection_start, selection_end, selection_history_end, config, effective_protocol)
            metrics = enrich_metrics(rows, target_samples, selection_start, selection_end, stress_delta)
            configuration_reports.append({"config": config, "selection2024": metrics, "passesCapacityGate": passes_capacity(metrics, protocol["capacityGate"])})

    configuration_reports.sort(key=lambda item: (
        not item["passesCapacityGate"],
        -(item["selection2024"]["averageNetPct"] or -999),
        -(item["selection2024"]["tradesPer100TradingDays"] or 0),
    ))
    qualified = [item for item in configuration_reports if item["passesCapacityGate"]]
    selected = qualified[0] if qualified else None
    forward: dict[str, Any] | None = None
    if selected:
        config = selected["config"]
        validation_rows = candidate_rows(target_samples, peer_samples, "20250101", "20251231", "20241231", config, effective_protocol)
        final_rows = candidate_rows(target_samples, peer_samples, "20260101", str(target_samples["date"].max()), "20251231", config, effective_protocol)
        forward = {
            "frozenConfig": config,
            "validation2025": enrich_metrics(validation_rows, target_samples, "20250101", "20251231", stress_delta),
            "finalAudit2026": enrich_metrics(final_rows, target_samples, "20260101", str(target_samples["date"].max()), stress_delta),
        }

    report = {
        "schemaVersion": 1,
        "experimentId": protocol["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "research-rejected-capacity-gate" if not selected else "research-only-forward-audited",
        "affectsSmartTV4": False,
        "affectsFactorRegistry": False,
        "affectsShadowPool": False,
        "causalityAudit": {
            "decision": protocol["causality"]["decision"],
            "entry": protocol["causality"]["entry"],
            "usesHistoricalL2": False,
            "usesHistoricalAuctionBook": False,
            "futureBarsUsedOnlyForOutcomeLabels": True,
        },
        "dataset": {
            **target_audit,
            "inputSha256": sha256(args.input),
            "protocolSha256": sha256(args.protocol),
            "targetSamples": int(len(target_samples)),
            "peerSamples": int(len(peer_samples)),
            "peerTrainingCodes": peer_codes,
            "availableTargetThrough": str(target_samples["date"].max()),
        },
        "qualityScore": {
            "formula": "70% peer-model probability above the causal calibration cutoff + 30% six observable regime confirmations",
            "regimeConfirmations": ["rolling5ReturnPct", "rolling20ReturnPct", "peerBreadth3", "peerBreadthVwap", "zijinAlpha5Pct", "volumeRatio>=1"],
        },
        "selectionPolicy": protocol["dataSplit"],
        "capacityGate": protocol["capacityGate"],
        "configurationSelection2024": configuration_reports,
        "selectedConfiguration": selected,
        "forwardAudit": forward,
        "decision": (
            "No configuration met the pre-registered 2024 capacity gate; no 2025/2026 audit or live integration is permitted."
            if not selected else
            "Forward results are research-only. Manual review and prospective shadow evidence remain mandatory; Smart-T V4 is unchanged."
        ),
    }
    atomic_json(args.report, report)
    print(json.dumps({
        "status": report["status"],
        "qualifiedConfigurations": len(qualified),
        "selectedConfiguration": selected,
        "forwardAudit": forward,
        "report": str(args.report),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
