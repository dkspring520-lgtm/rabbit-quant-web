#!/usr/bin/env python3
"""Run Zijin Mining round-two walk-forward research without opening 2026.

Every fold fits only on dates before its validation quarter. Signals use
features available at minute t, fill at the next minute open, and use later
prices only as outcome labels. The result is research-only and never mutates
Smart-T V4.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier


PEER_PATH = Path(__file__).with_name("discover-zijin-peer-patterns.py")
PEER_SPEC = importlib.util.spec_from_file_location("zijin_peer_core", PEER_PATH)
if PEER_SPEC is None or PEER_SPEC.loader is None:
    raise RuntimeError(f"无法加载同业研究模块：{PEER_PATH}")
peer = importlib.util.module_from_spec(PEER_SPEC)
sys.modules[PEER_SPEC.name] = peer
PEER_SPEC.loader.exec_module(peer)
core = peer.core


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
MODEL_CONFIGS = [
    {"maxDepth": depth, "minSamplesLeaf": leaf}
    for depth in (3, 4)
    for leaf in (60, 100, 140, 180)
]
ALLOWED_CODES = (peer.TARGET_CODE, *peer.PEER_GROUPS.keys())
TARGET_WIN_RATE = 0.65
MIN_OOF_TRADES = 80
MIN_POSITIVE_FOLDS = 6
TRAIN_LEAF_MIN_TRADES = 40
TRAIN_LEAF_MIN_WIN_RATE = 0.55


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def update_progress(path: Path, stage: str, progress: int, message: str, **latest: object) -> None:
    write_json(path, {
        "schemaVersion": 1,
        "stock": {"code": "601899", "name": "紫金矿业"},
        "round": 2,
        "status": "completed" if stage == "completed" else "running",
        "stage": stage,
        "progress": progress,
        "message": message,
        "latest": latest,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    })


def normalize_cutoff(value: str) -> str:
    normalized = "".join(character for character in str(value) if character.isdigit())
    if len(normalized) != 8:
        raise ValueError("截止日必须是 YYYYMMDD 或 YYYY-MM-DD")
    if normalized > "20251231":
        raise ValueError("第二轮截止日不得晚于 2025-12-31；2026 必须隔离")
    return normalized


def load_panel(path: Path, cutoff: str) -> pd.DataFrame:
    cutoff = normalize_cutoff(cutoff)
    placeholders = ", ".join("?" for _ in ALLOWED_CODES)
    con = duckdb.connect()
    frame = con.execute(
        f"""
        WITH normalized AS (
          SELECT regexp_replace(CAST(trade_date AS VARCHAR), '[^0-9]', '', 'g') AS tradeDate,
                 CAST(trade_time AS VARCHAR) AS tradeTime,
                 regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') AS code,
                 open, high, low, close, vol AS volume, amount,
                 pre_close AS previousClose
          FROM read_parquet(?)
        )
        SELECT tradeDate,
               tradeTime,
               code,
               open, high, low, close, volume, amount, previousClose
        FROM normalized
        WHERE tradeDate <= ? AND length(tradeDate) = 8
          AND code IN ({placeholders})
        ORDER BY tradeDate, tradeTime, code
        """,
        [str(path), cutoff, *ALLOWED_CODES],
    ).fetch_df()
    con.close()
    numeric = ["open", "high", "low", "close", "volume", "amount", "previousClose"]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"])
    return frame[(frame[["open", "high", "low", "close"]] > 0).all(axis=1)].copy()


def select_leafs(training: pd.DataFrame, model: DecisionTreeClassifier) -> tuple[set[int], dict[str, object]]:
    rows = training.copy()
    rows["leaf"] = model.apply(rows[peer.FEATURES])
    accepted: set[int] = set()
    for leaf, leaf_rows in rows.groupby("leaf"):
        summary = core.summarize(core.independent_rows(leaf_rows))
        if (
            summary["trades"] >= TRAIN_LEAF_MIN_TRADES
            and (summary["winRate"] or 0) >= TRAIN_LEAF_MIN_WIN_RATE
            and summary["averageNetPct"] > 0
        ):
            accepted.add(int(leaf))
    chosen = rows[rows["leaf"].isin(accepted)]
    return accepted, core.summarize(core.independent_rows(chosen))


def fit_direction(training: pd.DataFrame, direction: str) -> dict[str, object] | None:
    rows = training[training["direction"] == direction].copy()
    if len(rows) < 200 or rows["won"].nunique() < 2:
        return None
    candidates: list[dict[str, object]] = []
    for config in MODEL_CONFIGS:
        model = DecisionTreeClassifier(
            max_depth=config["maxDepth"],
            min_samples_leaf=config["minSamplesLeaf"],
            class_weight="balanced",
            random_state=601899,
        )
        model.fit(rows[peer.FEATURES], rows["won"].astype(int))
        accepted, summary = select_leafs(rows, model)
        if not accepted:
            continue
        candidates.append({"config": config, "model": model, "accepted": accepted, "summary": summary})
    if not candidates:
        return None
    return max(candidates, key=lambda item: (
        item["summary"]["averageNetPct"],
        item["summary"]["winRate"] or 0,
        item["summary"]["trades"],
    ))


def run_fold(samples: pd.DataFrame, label: str, start: str, end: str) -> tuple[dict[str, object], pd.DataFrame]:
    training = samples[samples["date"] < start]
    validation = samples[(samples["date"] >= start) & (samples["date"] <= end)]
    selected_frames: list[pd.DataFrame] = []
    public_models: dict[str, object] = {}
    for direction in ("positive", "reverse"):
        selected = fit_direction(training, direction)
        if selected is None:
            public_models[direction] = None
            continue
        rows = validation[validation["direction"] == direction].copy()
        rows["leaf"] = selected["model"].apply(rows[peer.FEATURES])
        rows = rows[rows["leaf"].isin(selected["accepted"])]
        selected_frames.append(rows)
        public_models[direction] = {
            **selected["config"],
            "acceptedLeafCount": len(selected["accepted"]),
            "training": selected["summary"],
        }
    chosen = core.independent_rows(pd.concat(selected_frames, ignore_index=True)) if selected_frames else pd.DataFrame()
    summary = core.summarize(chosen)
    return {
        "id": label,
        "trainingEnd": str(training["date"].max()) if not training.empty else None,
        "validationStart": start,
        "validationEnd": end,
        "trainingCandidates": int(len(training)),
        "validationCandidates": int(len(validation)),
        "selectedModels": public_models,
        "result": summary,
        "positiveNet": summary["averageNetPct"] > 0,
        "causalBoundaryPassed": bool(
            not training.empty
            and not validation.empty
            and str(training["date"].max()) < start
        ),
    }, chosen


def bootstrap_lower_bound(rows: pd.DataFrame, iterations: int = 1000) -> float:
    if rows.empty:
        return 0.0
    blocks = [day["netPct"].to_numpy(dtype=float) for _, day in rows.groupby("date", sort=True)]
    rng = np.random.default_rng(601899)
    means = np.empty(iterations, dtype=float)
    for index in range(iterations):
        chosen = rng.integers(0, len(blocks), size=len(blocks))
        sample = np.concatenate([blocks[item] for item in chosen])
        means[index] = float(sample.mean())
    return round(float(np.quantile(means, 0.025)), 4)


def dry_run_payload(path: Path, cutoff: str) -> dict[str, object]:
    cutoff = normalize_cutoff(cutoff)
    placeholders = ", ".join("?" for _ in ALLOWED_CODES)
    con = duckdb.connect()
    audit = con.execute(
        f"""
        WITH normalized AS (
          SELECT regexp_replace(CAST(trade_date AS VARCHAR), '[^0-9]', '', 'g') AS tradeDate,
                 regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') AS code
          FROM read_parquet(?)
        )
        SELECT MIN(tradeDate), MAX(tradeDate), COUNT(*),
               COUNT(DISTINCT tradeDate), COUNT(DISTINCT code),
               SUM(CASE WHEN tradeDate >= '20260101' THEN 1 ELSE 0 END)
        FROM normalized
        WHERE tradeDate <= ? AND length(tradeDate) = 8
          AND code IN ({placeholders})
        """, [str(path), cutoff, *ALLOWED_CODES]
    ).fetchone()
    con.close()
    return {
        "mode": "dry-run",
        "cutoff": cutoff,
        "firstDate": str(audit[0]),
        "lastDateLoaded": str(audit[1]),
        "minuteRows": int(audit[2]),
        "tradingDays": int(audit[3]),
        "stockCount": int(audit[4]),
        "loaded2026Rows": int(audit[5] or 0),
        "allowedCodes": list(ALLOWED_CODES),
        "folds": [{"id": label, "validationStart": start, "validationEnd": end} for label, start, end in FOLDS],
        "modelConfigs": MODEL_CONFIGS,
        "sealed": "2026 完全不加载、不选参、不验证",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="紫金矿业第二轮季度滚动样本外训练")
    parser.add_argument("input", type=Path)
    parser.add_argument("--cutoff", default="20251231")
    parser.add_argument("--output", type=Path, default=Path("public/research/zijin-round2-walk-forward.json"))
    parser.add_argument("--progress", type=Path, default=Path("public/research/zijin-round2-progress.json"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    args.cutoff = normalize_cutoff(args.cutoff)
    started = time.time()
    if args.dry_run:
        print(json.dumps(dry_run_payload(args.input.resolve(), args.cutoff), ensure_ascii=False, indent=2))
        return

    update_progress(args.progress, "loading", 3, "只读取 2025-12-31 及以前数据，2026 完全隔离")
    panel = load_panel(args.input.resolve(), args.cutoff)
    if panel.empty or str(panel["tradeDate"].max()) > "20251231":
        raise SystemExit("数据边界审计失败：读取了 2026 或没有可用数据")
    update_progress(args.progress, "features", 12, "正在生成当时可见的价量、VWAP 与同业特征", minuteRows=int(len(panel)))
    samples, coverage = peer.build_samples(panel)
    if samples.empty:
        raise SystemExit("没有生成可研究的因果候选样本")

    folds: list[dict[str, object]] = []
    oof_rows: list[pd.DataFrame] = []
    for index, (label, start, end) in enumerate(FOLDS):
        fold, chosen = run_fold(samples, label, start, end)
        folds.append(fold)
        if not chosen.empty:
            oof_rows.append(chosen.assign(fold=label))
        update_progress(
            args.progress, "walk-forward", 18 + round((index + 1) / len(FOLDS) * 72),
            f"已完成 {label} 滚动样本外验证", completedFolds=index + 1, totalFolds=len(FOLDS),
        )

    oof = pd.concat(oof_rows, ignore_index=True) if oof_rows else pd.DataFrame()
    overall = core.summarize(oof)
    positive_folds = sum(bool(fold["positiveNet"]) for fold in folds)
    covered_folds = sum(int(fold["validationCandidates"]) > 0 for fold in folds)
    lower_bound = bootstrap_lower_bound(oof)
    gates = {
        "minimumTrades": {"target": MIN_OOF_TRADES, "actual": overall["trades"], "passed": overall["trades"] >= MIN_OOF_TRADES},
        "winRate": {"target": TARGET_WIN_RATE, "actual": overall["winRate"], "passed": (overall["winRate"] or 0) >= TARGET_WIN_RATE},
        "averageNetPct": {"target": "> 0", "actual": overall["averageNetPct"], "passed": overall["averageNetPct"] > 0},
        "positiveFolds": {"target": MIN_POSITIVE_FOLDS, "actual": positive_folds, "passed": positive_folds >= MIN_POSITIVE_FOLDS},
        "bootstrap95LowerPct": {"target": "> 0", "actual": lower_bound, "passed": lower_bound > 0},
        "causalBoundaries": {"target": len(FOLDS), "actual": sum(bool(fold["causalBoundaryPassed"]) for fold in folds), "passed": all(bool(fold["causalBoundaryPassed"]) for fold in folds)},
        "foldCoverage": {"target": len(FOLDS), "actual": covered_folds, "passed": covered_folds == len(FOLDS)},
    }
    passed = all(bool(gate["passed"]) for gate in gates.values())
    result = {
        "schemaVersion": 1,
        "stock": {"code": "601899", "marketCode": "601899.SH", "name": "紫金矿业"},
        "round": 2,
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
            "allowedCodes": list(ALLOWED_CODES),
            **coverage,
        },
        "methodology": {
            "folds": "8 expanding quarterly out-of-sample folds (2024Q1..2025Q4)",
            "cutoff": args.cutoff,
            "blindTest": "2026 not loaded; prior audit set remains sealed from round two",
            "selectionUsesValidationQuarter": False,
            "causalFeatures": True,
            "earliestFill": "下一分钟开盘价",
            "sameBarConflict": "同柱止损优先",
            "futureUse": "仅作为收益标签",
            "roundTripCostPct": core.ROUND_TRIP_COST_PCT,
            "costModelNote": "百分比近似成本；未按账户逐笔计算最低 5 元佣金",
            "netProfitZonePct": [core.MIN_NET_TARGET_PCT, core.MAX_NET_TARGET_PCT],
            "maxTradesPerDay": core.MAX_TRADES_PER_DAY,
            "modelConfigs": MODEL_CONFIGS,
        },
        "folds": folds,
        "overallOutOfSample": overall,
        "bootstrap95LowerPct": lower_bound,
        "positiveFoldCount": positive_folds,
        "gates": gates,
        "conclusion": {
            "passed": passed,
            "message": "跨季度证据通过全部门槛，仍需人工评审和影子观察。" if passed else "第二轮滚动验证未通过；保留失败证据，不进入 V4，也不降低 65% 门槛。",
            "nextAction": "通过人工评审后仅进入紫金专属影子观察。" if passed else "检查失败季度与因子稳定性；有新增数据后开启第三轮，不重复使用 2026 调参。",
        },
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    write_json(args.output, result)
    update_progress(
        args.progress, "completed", 100, result["conclusion"]["message"],
        passed=passed, oofTrades=overall["trades"], oofWinRate=overall["winRate"],
        oofAverageNetPct=overall["averageNetPct"], positiveFolds=positive_folds,
        bootstrap95LowerPct=lower_bound, elapsedSeconds=result["elapsedSeconds"],
    )
    print(json.dumps({
        "status": result["status"], "dataset": result["dataset"],
        "overallOutOfSample": overall, "positiveFoldCount": positive_folds,
        "bootstrap95LowerPct": lower_bound, "gates": gates,
        "elapsedSeconds": result["elapsedSeconds"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
