#!/usr/bin/env python3
"""Run Zijin Mining round-three nested walk-forward research.

The outer quarterly folds estimate honest out-of-sample performance.  Every
outer fold contains an additional four-fold chronological walk-forward used
to choose model shape and score coverage.  Minute-t features only use data at
or before t, fills happen at the next minute open, and later prices are labels
only.  The script never loads 2026 and never mutates Smart-T V4.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor


ROUND2_PATH = Path(__file__).with_name("train-zijin-round2-walk-forward.py")
ROUND2_SPEC = importlib.util.spec_from_file_location("zijin_round2_core", ROUND2_PATH)
if ROUND2_SPEC is None or ROUND2_SPEC.loader is None:
    raise RuntimeError(f"无法加载第二轮因果模块：{ROUND2_PATH}")
round2 = importlib.util.module_from_spec(ROUND2_SPEC)
sys.modules[ROUND2_SPEC.name] = round2
ROUND2_SPEC.loader.exec_module(round2)
peer = round2.peer
core = round2.core


OUTER_FOLDS = round2.FOLDS
INNER_FOLDS = [
    ("2023Q1", "20230101", "20230331"),
    ("2023Q2", "20230401", "20230630"),
    ("2023Q3", "20230701", "20230930"),
    ("2023Q4", "20231001", "20231231"),
    ("2024Q1", "20240101", "20240331"),
    ("2024Q2", "20240401", "20240630"),
    ("2024Q3", "20240701", "20240930"),
    ("2024Q4", "20241001", "20241231"),
    ("2025Q1", "20250101", "20250331"),
    ("2025Q2", "20250401", "20250630"),
    ("2025Q3", "20250701", "20250930"),
]
MODEL_CONFIGS = [
    {"maxDepth": depth, "minSamplesLeaf": leaf}
    for depth in (2, 3)
    for leaf in (80, 140)
]
KEEP_RATES = (0.08, 0.12, 0.18, 0.25)
SESSIONS = {
    "opening": (9 * 60 + 33, 10 * 60 + 30),
    "regular": (10 * 60 + 31, 14 * 60 + 30),
}
INNER_FOLD_COUNT = 4
EMBARGO_TRADING_DAYS = 1
MIN_INNER_TRADES = 30
MIN_INNER_POSITIVE_FOLDS = 3
INNER_LOWER_FLOOR_PCT = -0.05
TARGET_WIN_RATE = 0.65
MIN_OOF_TRADES = 80
MIN_POSITIVE_OUTER_FOLDS = 6
BASE_COST_PCT = 0.12
STRESS_COST_PCT = 0.18
STRESS_COST_DELTA_PCT = STRESS_COST_PCT - BASE_COST_PCT
MAX_INNER_OUTER_DECAY_PCT = 0.10


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def update_progress(path: Path, stage: str, progress: int, message: str, **latest: object) -> None:
    write_json(path, {
        "schemaVersion": 1,
        "stock": {"code": "601899", "name": "紫金矿业"},
        "round": 3,
        "status": "completed" if stage == "completed" else "running",
        "stage": stage,
        "progress": progress,
        "message": message,
        "latest": latest,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    })


def public_summary(result: dict[str, object]) -> dict[str, object]:
    """Keep the homepage payload small while the full audit stays downloadable."""
    gates = result["gates"]
    return {
        "schemaVersion": 1,
        "stock": result["stock"],
        "round": result["round"],
        "status": result["status"],
        "affectsV4": result["affectsV4"],
        "dataset": {
            key: result["dataset"][key]
            for key in ("firstDate", "lastDateLoaded", "tradingDays", "loaded2026Rows")
        },
        "overallOutOfSample": {
            key: result["overallOutOfSample"][key]
            for key in ("trades", "wins", "winRate", "averageNetPct", "averageHoldMinutes")
        },
        "stressAverageNetPct": result["stressAverageNetPct"],
        "positiveFoldCount": result["positiveFoldCount"],
        "gates": {"innerEligibleFolds": gates["innerEligibleFolds"]},
        "conclusion": result["conclusion"],
        "evidencePath": "/research/zijin-round3-nested.json",
    }


def session_rows(rows: pd.DataFrame, session: str) -> pd.DataFrame:
    start, end = SESSIONS[session]
    return rows[(rows["minuteOfDay"] >= start) & (rows["minuteOfDay"] <= end)]


def guarded_rows(rows: pd.DataFrame, direction: str, session: str) -> pd.DataFrame:
    """Apply only pre-registered, minute-t direction and peer guards."""
    selected = session_rows(rows[rows["direction"] == direction], session)
    if direction == "positive":
        mask = (
            (selected["vwapBiasPct"] <= -0.08)
            & ((selected["return3Pct"] > 0) | (selected["ma5SlopePct"] > 0))
            & (selected["peerBreadth3"] >= 0.33)
            & (selected["vwapSlope5Pct"] > -0.05)
        )
    else:
        mask = (
            (selected["vwapBiasPct"] >= 0.08)
            & ((selected["return3Pct"] < 0) | (selected["ma5SlopePct"] < 0))
            & (selected["peerBreadth3"] <= 0.67)
            & (selected["vwapSlope5Pct"] < 0.05)
        )
    return selected[mask].copy()


def embargo_split(rows: pd.DataFrame, validation_start: str, validation_end: str) -> tuple[pd.DataFrame, pd.DataFrame, str | None]:
    prior_dates = sorted(rows.loc[rows["date"] < validation_start, "date"].astype(str).unique())
    if len(prior_dates) <= EMBARGO_TRADING_DAYS:
        return rows.iloc[0:0].copy(), rows.iloc[0:0].copy(), None
    embargo_dates = set(prior_dates[-EMBARGO_TRADING_DAYS:])
    training = rows[(rows["date"] < validation_start) & ~rows["date"].isin(embargo_dates)].copy()
    validation = rows[(rows["date"] >= validation_start) & (rows["date"] <= validation_end)].copy()
    return training, validation, prior_dates[-1]


def recent_inner_folds(outer_start: str) -> list[tuple[str, str, str]]:
    eligible = [fold for fold in INNER_FOLDS if fold[2] < outer_start]
    return eligible[-INNER_FOLD_COUNT:]


def bootstrap_lower_bound(rows: pd.DataFrame, iterations: int = 1000, cost_delta: float = 0.0) -> float:
    if rows.empty:
        return 0.0
    blocks = [
        day["netPct"].to_numpy(dtype=float) - cost_delta
        for _, day in rows.groupby("date", sort=True)
    ]
    rng = np.random.default_rng(601899)
    means = np.empty(iterations, dtype=float)
    for index in range(iterations):
        chosen = rng.integers(0, len(blocks), size=len(blocks))
        means[index] = float(np.concatenate([blocks[item] for item in chosen]).mean())
    return round(float(np.quantile(means, 0.025)), 4)


def add_fold_percentiles(rows: pd.DataFrame) -> pd.DataFrame:
    if rows.empty:
        return rows
    result = rows.copy()
    result["scorePercentile"] = result.groupby("innerFold")["predictedNetPct"].rank(
        method="average", pct=True
    )
    return result


def summarize_selection(rows: pd.DataFrame) -> dict[str, object]:
    chosen = core.independent_rows(rows)
    summary = core.summarize(chosen)
    by_fold = {
        str(fold): core.summarize(core.independent_rows(group))
        for fold, group in chosen.groupby("innerFold", sort=True)
    } if not chosen.empty else {}
    positive_folds = sum(item["averageNetPct"] > 0 for item in by_fold.values())
    return {
        **summary,
        "stressAverageNetPct": round(summary["averageNetPct"] - STRESS_COST_DELTA_PCT, 4),
        "bootstrap95LowerPct": bootstrap_lower_bound(chosen),
        "stressBootstrap95LowerPct": bootstrap_lower_bound(chosen, cost_delta=STRESS_COST_DELTA_PCT),
        "positiveInnerFolds": positive_folds,
        "coveredInnerFolds": len(by_fold),
        "byFold": by_fold,
    }


def inner_predictions(rows: pd.DataFrame, config: dict[str, int], folds: list[tuple[str, str, str]]) -> tuple[pd.DataFrame, list[dict[str, object]]]:
    predicted: list[pd.DataFrame] = []
    boundaries: list[dict[str, object]] = []
    for label, start, end in folds:
        training, validation, embargo_date = embargo_split(rows, start, end)
        if len(training) < 200 or validation.empty:
            boundaries.append({
                "id": label,
                "trainingEnd": str(training["date"].max()) if not training.empty else None,
                "embargoDate": embargo_date,
                "validationStart": start,
                "validationEnd": end,
                "passed": False,
            })
            continue
        model = DecisionTreeRegressor(
            max_depth=config["maxDepth"],
            min_samples_leaf=config["minSamplesLeaf"],
            random_state=601899,
        )
        model.fit(training[peer.FEATURES], training["netPct"])
        scored = validation.copy()
        scored["predictedNetPct"] = model.predict(scored[peer.FEATURES])
        scored["innerFold"] = label
        predicted.append(scored)
        training_end = str(training["date"].max())
        boundaries.append({
            "id": label,
            "trainingEnd": training_end,
            "embargoDate": embargo_date,
            "validationStart": start,
            "validationEnd": end,
            "passed": bool(training_end < str(embargo_date) < start),
        })
    combined = pd.concat(predicted, ignore_index=True) if predicted else pd.DataFrame()
    return add_fold_percentiles(combined), boundaries


def select_inner_model(rows: pd.DataFrame, folds: list[tuple[str, str, str]]) -> dict[str, object] | None:
    candidates: list[dict[str, object]] = []
    for config in MODEL_CONFIGS:
        predictions, boundaries = inner_predictions(rows, config, folds)
        if predictions.empty or len(boundaries) != INNER_FOLD_COUNT or not all(item["passed"] for item in boundaries):
            continue
        for keep_rate in KEEP_RATES:
            selected = predictions[predictions["scorePercentile"] >= 1 - keep_rate]
            evidence = summarize_selection(selected)
            checks = {
                "minimumTrades": evidence["trades"] >= MIN_INNER_TRADES,
                "allInnerFolds": evidence["coveredInnerFolds"] == INNER_FOLD_COUNT,
                "positiveInnerFolds": evidence["positiveInnerFolds"] >= MIN_INNER_POSITIVE_FOLDS,
                "positiveAverageNet": evidence["averageNetPct"] > 0,
                "stressAverageNotNegative": evidence["stressAverageNetPct"] >= 0,
                "bootstrapFloor": evidence["bootstrap95LowerPct"] > INNER_LOWER_FLOOR_PCT,
            }
            eligible = all(checks.values())
            candidates.append({
                "config": config,
                "keepRate": keep_rate,
                "eligible": eligible,
                "checks": checks,
                "evidence": evidence,
                "boundaries": boundaries,
            })
    if not candidates:
        return None
    # Always carry the strongest inner-OOF candidate into the untouched outer
    # quarter.  Eligibility remains a deployment gate; it must not erase the
    # outer evidence that tells us whether a weak inner candidate really fails.
    return max(candidates, key=lambda item: (
        item["eligible"],
        item["evidence"]["stressBootstrap95LowerPct"],
        item["evidence"]["stressAverageNetPct"],
        item["evidence"]["averageNetPct"],
        item["evidence"]["trades"],
    ))


def fit_outer_model(training: pd.DataFrame, validation: pd.DataFrame, selected: dict[str, object]) -> pd.DataFrame:
    if validation.empty:
        scored = validation.copy()
        scored["predictedNetPct"] = pd.Series(dtype=float)
        return scored
    config = selected["config"]
    model = DecisionTreeRegressor(
        max_depth=config["maxDepth"],
        min_samples_leaf=config["minSamplesLeaf"],
        random_state=601899,
    )
    model.fit(training[peer.FEATURES], training["netPct"])
    training_scores = model.predict(training[peer.FEATURES])
    threshold = float(np.quantile(training_scores, 1 - float(selected["keepRate"])))
    scored = validation.copy()
    scored["predictedNetPct"] = model.predict(scored[peer.FEATURES])
    return scored[scored["predictedNetPct"] >= threshold].copy()


def run_outer_fold(samples: pd.DataFrame, label: str, start: str, end: str) -> tuple[dict[str, object], pd.DataFrame]:
    folds = recent_inner_folds(start)
    chosen_frames: list[pd.DataFrame] = []
    strategies: list[dict[str, object]] = []
    outer_boundaries: list[bool] = []
    for direction in ("positive", "reverse"):
        for session in SESSIONS:
            universe = guarded_rows(samples, direction, session)
            training, validation, embargo_date = embargo_split(universe, start, end)
            training_end = str(training["date"].max()) if not training.empty else None
            boundary_passed = bool(
                training_end and embargo_date and training_end < str(embargo_date) < start
            )
            outer_boundaries.append(boundary_passed)
            selected = select_inner_model(training, folds) if boundary_passed else None
            public: dict[str, object] = {
                "direction": direction,
                "session": session,
                "trainingCandidates": int(len(training)),
                "validationCandidates": int(len(validation)),
                "trainingEnd": training_end,
                "embargoDate": embargo_date,
                "causalBoundaryPassed": boundary_passed,
                "evaluated": selected is not None,
                "innerEligible": bool(selected and selected["eligible"]),
            }
            if selected is not None:
                picked = fit_outer_model(training, validation, selected)
                if not picked.empty:
                    chosen_frames.append(picked.assign(strategy=f"{direction}:{session}"))
                public.update({
                    "model": selected["config"],
                    "keepRate": selected["keepRate"],
                    "innerChecks": selected["checks"],
                    "innerEvidence": selected["evidence"],
                    "innerBoundaries": selected["boundaries"],
                })
            strategies.append(public)
    chosen = core.independent_rows(pd.concat(chosen_frames, ignore_index=True)) if chosen_frames else pd.DataFrame()
    result = core.summarize(chosen)
    inner_trades = sum(
        int(strategy.get("innerEvidence", {}).get("trades", 0))
        for strategy in strategies if strategy["evaluated"]
    )
    inner_weighted = sum(
        float(strategy.get("innerEvidence", {}).get("averageNetPct", 0))
        * int(strategy.get("innerEvidence", {}).get("trades", 0))
        for strategy in strategies if strategy["evaluated"]
    )
    inner_average = round(inner_weighted / inner_trades, 4) if inner_trades else 0.0
    decay = round(inner_average - result["averageNetPct"], 4) if result["trades"] else None
    return {
        "id": label,
        "validationStart": start,
        "validationEnd": end,
        "innerFoldCount": len(folds),
        "strategies": strategies,
        "evaluatedStrategyCount": sum(strategy["evaluated"] for strategy in strategies),
        "innerEligibleStrategyCount": sum(strategy["innerEligible"] for strategy in strategies),
        "result": result,
        "stressAverageNetPct": round(result["averageNetPct"] - STRESS_COST_DELTA_PCT, 4),
        "innerAverageNetPct": inner_average,
        "innerToOuterDecayPct": decay,
        "positiveNet": result["averageNetPct"] > 0,
        "causalBoundaryPassed": all(outer_boundaries),
    }, chosen


def dry_run_payload(path: Path, cutoff: str) -> dict[str, object]:
    base = round2.dry_run_payload(path, cutoff)
    return {
        **base,
        "round": 3,
        "method": "nested chronological walk-forward with one-trading-day embargo",
        "innerFoldCount": INNER_FOLD_COUNT,
        "modelConfigs": MODEL_CONFIGS,
        "keepRates": list(KEEP_RATES),
        "sessions": SESSIONS,
        "stressCostPct": STRESS_COST_PCT,
        "affectsV4": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="紫金矿业第三轮嵌套走步净期望训练")
    parser.add_argument("input", type=Path)
    parser.add_argument("--cutoff", default="20251231")
    parser.add_argument("--output", type=Path, default=Path("public/research/zijin-round3-nested.json"))
    parser.add_argument("--summary", type=Path, default=Path("public/research/zijin-round3-summary.json"))
    parser.add_argument("--progress", type=Path, default=Path("public/research/zijin-round3-progress.json"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    args.cutoff = round2.normalize_cutoff(args.cutoff)
    started = time.time()
    if args.dry_run:
        print(json.dumps(dry_run_payload(args.input.resolve(), args.cutoff), ensure_ascii=False, indent=2))
        return

    update_progress(args.progress, "loading", 3, "仅读取 2025-12-31 及以前数据；2026 保持封存")
    panel = round2.load_panel(args.input.resolve(), args.cutoff)
    if panel.empty or str(panel["tradeDate"].max()) > "20251231":
        raise SystemExit("数据边界审计失败：读取了 2026 或没有可用数据")
    update_progress(args.progress, "features", 10, "生成当时可见的价量、VWAP、同业与日线背景特征", minuteRows=int(len(panel)))
    samples, coverage = peer.build_samples(panel)
    if samples.empty:
        raise SystemExit("没有生成可研究的因果候选样本")

    folds: list[dict[str, object]] = []
    oof_rows: list[pd.DataFrame] = []
    for index, (label, start, end) in enumerate(OUTER_FOLDS):
        fold, chosen = run_outer_fold(samples, label, start, end)
        folds.append(fold)
        if not chosen.empty:
            oof_rows.append(chosen.assign(outerFold=label))
        update_progress(
            args.progress,
            "nested-walk-forward",
            15 + round((index + 1) / len(OUTER_FOLDS) * 76),
            f"已完成 {label} 内外层走步验证",
            completedFolds=index + 1,
            totalFolds=len(OUTER_FOLDS),
        )

    oof = pd.concat(oof_rows, ignore_index=True) if oof_rows else pd.DataFrame()
    overall = core.summarize(oof)
    positive_folds = sum(fold["positiveNet"] for fold in folds)
    inner_eligible_folds = sum(fold["innerEligibleStrategyCount"] > 0 for fold in folds)
    lower = bootstrap_lower_bound(oof)
    stress_lower = bootstrap_lower_bound(oof, cost_delta=STRESS_COST_DELTA_PCT)
    stress_average = round(overall["averageNetPct"] - STRESS_COST_DELTA_PCT, 4)
    traded_folds = [fold for fold in folds if fold["result"]["trades"]]
    worst_fold_average = min(
        (float(fold["result"]["averageNetPct"]) for fold in traded_folds),
        default=0.0,
    )
    decay_values = [
        float(fold["innerToOuterDecayPct"])
        for fold in traded_folds if fold["innerToOuterDecayPct"] is not None
    ]
    average_decay = round(float(np.mean(decay_values)), 4) if decay_values else 0.0
    gates = {
        "loaded2026Rows": {"target": 0, "actual": int((panel["tradeDate"] >= "20260101").sum()), "passed": not bool((panel["tradeDate"] >= "20260101").any())},
        "causalBoundaries": {"target": 8, "actual": sum(fold["causalBoundaryPassed"] for fold in folds), "passed": all(fold["causalBoundaryPassed"] for fold in folds)},
        "innerEligibleFolds": {"target": 8, "actual": inner_eligible_folds, "passed": inner_eligible_folds == len(folds)},
        "minimumTrades": {"target": MIN_OOF_TRADES, "actual": overall["trades"], "passed": overall["trades"] >= MIN_OOF_TRADES},
        "winRate": {"target": TARGET_WIN_RATE, "actual": overall["winRate"], "passed": (overall["winRate"] or 0) >= TARGET_WIN_RATE},
        "averageNetPct": {"target": "> 0", "actual": overall["averageNetPct"], "passed": overall["averageNetPct"] > 0},
        "bootstrap95LowerPct": {"target": "> 0", "actual": lower, "passed": lower > 0},
        "positiveFolds": {"target": MIN_POSITIVE_OUTER_FOLDS, "actual": positive_folds, "passed": positive_folds >= MIN_POSITIVE_OUTER_FOLDS},
        "stressAverageNetPct": {"target": ">= 0 at 0.18% cost", "actual": stress_average, "passed": stress_average >= 0},
        "stressBootstrap95LowerPct": {"target": "> 0", "actual": stress_lower, "passed": stress_lower > 0},
        "worstFoldAverageNetPct": {"target": ">= -0.10", "actual": round(worst_fold_average, 4), "passed": worst_fold_average >= -0.10},
        "innerToOuterDecayPct": {"target": f"<= {MAX_INNER_OUTER_DECAY_PCT:.2f}", "actual": average_decay, "passed": average_decay <= MAX_INNER_OUTER_DECAY_PCT},
    }
    passed = all(bool(gate["passed"]) for gate in gates.values())
    result = {
        "schemaVersion": 1,
        "stock": {"code": "601899", "marketCode": "601899.SH", "name": "紫金矿业"},
        "round": 3,
        "mode": "research-only",
        "affectsV4": False,
        "status": "passed" if passed else "failed",
        "dataset": {
            "firstDate": str(panel["tradeDate"].min()),
            "lastDateLoaded": str(panel["tradeDate"].max()),
            "minuteRows": int(len(panel)),
            "tradingDays": int(panel["tradeDate"].nunique()),
            "stockCount": int(panel["code"].nunique()),
            "causalCandidates": int(len(samples)),
            "loaded2026Rows": int((panel["tradeDate"] >= "20260101").sum()),
            "allowedCodes": list(round2.ALLOWED_CODES),
            **coverage,
        },
        "methodology": {
            "outerFolds": "8 expanding quarterly out-of-sample folds (2024Q1..2025Q4)",
            "innerFoldsPerOuter": INNER_FOLD_COUNT,
            "embargoTradingDays": EMBARGO_TRADING_DAYS,
            "selectionTarget": "inner OOF netPct and date-block bootstrap lower bound",
            "selectionUsesOuterQuarter": False,
            "selectionUsesWinRate": False,
            "causalFeatures": True,
            "earliestFill": "下一分钟开盘价",
            "sameBarConflict": "同柱止损优先",
            "futureUse": "仅作为收益标签",
            "cutoff": args.cutoff,
            "loaded2026Rows": 0,
            "roundTripCostPct": BASE_COST_PCT,
            "stressCostPct": STRESS_COST_PCT,
            "netProfitZonePct": [core.MIN_NET_TARGET_PCT, core.MAX_NET_TARGET_PCT],
            "modelConfigs": MODEL_CONFIGS,
            "keepRates": list(KEEP_RATES),
            "sessions": SESSIONS,
            "guards": {
                "positive": "低于VWAP + 动量转正 + 同业广度不恶化 + 禁止强VWAP下行",
                "reverse": "高于VWAP + 动量转弱 + 同业广度不继续走强 + 禁止强VWAP上行",
            },
        },
        "folds": folds,
        "overallOutOfSample": overall,
        "bootstrap95LowerPct": lower,
        "stressAverageNetPct": stress_average,
        "stressBootstrap95LowerPct": stress_lower,
        "positiveFoldCount": positive_folds,
        "averageInnerToOuterDecayPct": average_decay,
        "gates": gates,
        "conclusion": {
            "passed": passed,
            "message": "第三轮嵌套验证通过全部门槛，仍只进入紫金专属影子观察。" if passed else "第三轮嵌套验证未通过；保留失败证据，不进入 V4，也不触碰 2026。",
            "nextAction": "人工评审后开启紫金专属影子观察。" if passed else "先审计退出原因与持有时长；若没有新的独立数据，不继续扩大参数网格。",
        },
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    write_json(args.output, result)
    write_json(args.summary, public_summary(result))
    update_progress(
        args.progress,
        "completed",
        100,
        result["conclusion"]["message"],
        passed=passed,
        oofTrades=overall["trades"],
        oofWinRate=overall["winRate"],
        oofAverageNetPct=overall["averageNetPct"],
        bootstrap95LowerPct=lower,
        stressAverageNetPct=stress_average,
        positiveFolds=positive_folds,
        elapsedSeconds=result["elapsedSeconds"],
    )
    print(json.dumps({
        "status": result["status"],
        "dataset": result["dataset"],
        "overallOutOfSample": overall,
        "bootstrap95LowerPct": lower,
        "stressAverageNetPct": stress_average,
        "stressBootstrap95LowerPct": stress_lower,
        "positiveFoldCount": positive_folds,
        "averageInnerToOuterDecayPct": average_decay,
        "gates": gates,
        "elapsedSeconds": result["elapsedSeconds"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
