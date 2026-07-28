#!/usr/bin/env python3
"""Discover causal Zijin patterns conditioned on a same-minute peer basket.

All features at minute t use only observations at or before t. Entries use the
next minute open. Future bars are used only to label outcomes. Model selection
uses 2022-2024 for fitting and 2025 for validation; 2026 is opened once as the
final blind audit. Results remain research-only and never modify Smart-T V4.
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


CORE_PATH = Path(__file__).with_name("discover-zijin-patterns.py")
CORE_SPEC = importlib.util.spec_from_file_location("zijin_pattern_core", CORE_PATH)
if CORE_SPEC is None or CORE_SPEC.loader is None:
    raise RuntimeError(f"无法加载基础研究模块：{CORE_PATH}")
core = importlib.util.module_from_spec(CORE_SPEC)
sys.modules[CORE_SPEC.name] = core
CORE_SPEC.loader.exec_module(core)


TARGET_CODE = "601899"
PEER_GROUPS = {
    "603993": "copper",
    "600362": "copper",
    "000630": "copper",
    "600547": "gold",
    "600489": "gold",
    "601600": "nonferrous",
}
PEER_NAMES = {
    "601899": "紫金矿业",
    "603993": "洛阳钼业",
    "600362": "江西铜业",
    "000630": "铜陵有色",
    "600547": "山东黄金",
    "600489": "中金黄金",
    "601600": "中国铝业",
}

PEER_FEATURES = [
    "peerReturn3Pct",
    "peerReturn5Pct",
    "peerVwapBiasPct",
    "peerOpenDeviationPct",
    "peerVolumeRatio",
    "peerBreadth3",
    "peerBreadthVwap",
    "goldReturn3Pct",
    "goldReturn5Pct",
    "copperReturn3Pct",
    "copperReturn5Pct",
    "zijinAlpha3Pct",
    "zijinAlpha5Pct",
    "zijinAlphaVwapPct",
    "zijinAlphaOpenPct",
    "peerCoverage",
]
DAILY_CONTEXT_FEATURES = [
    "priorDayReturnPct",
    "priorDayRangePct",
    "priorDayClosePosition",
    "rolling5ReturnPct",
    "rolling20ReturnPct",
    "rolling5RangePct",
    "rolling20RangePct",
    "priorDayVolumeRatio5",
    "priorPeerReturnPct",
    "priorGoldReturnPct",
    "priorCopperReturnPct",
    "priorZijinPeerAlphaPct",
]
FEATURES = [*core.FEATURES, *PEER_FEATURES, *DAILY_CONTEXT_FEATURES]
FEATURE_LABELS = {
    **core.FEATURE_LABELS,
    "peerReturn3Pct": "同业3分钟动量",
    "peerReturn5Pct": "同业5分钟动量",
    "peerVwapBiasPct": "同业距VWAP",
    "peerOpenDeviationPct": "同业较开盘",
    "peerVolumeRatio": "同业量比",
    "peerBreadth3": "同业3分钟上涨广度",
    "peerBreadthVwap": "同业站上VWAP广度",
    "goldReturn3Pct": "黄金组3分钟动量",
    "goldReturn5Pct": "黄金组5分钟动量",
    "copperReturn3Pct": "铜组3分钟动量",
    "copperReturn5Pct": "铜组5分钟动量",
    "zijinAlpha3Pct": "紫金3分钟超额",
    "zijinAlpha5Pct": "紫金5分钟超额",
    "zijinAlphaVwapPct": "紫金VWAP相对偏离",
    "zijinAlphaOpenPct": "紫金开盘后超额",
    "peerCoverage": "同业覆盖率",
    "priorDayReturnPct": "紫金昨日涨跌",
    "priorDayRangePct": "紫金昨日振幅",
    "priorDayClosePosition": "紫金昨日收盘位置",
    "rolling5ReturnPct": "紫金前5日趋势",
    "rolling20ReturnPct": "紫金前20日趋势",
    "rolling5RangePct": "紫金前5日平均振幅",
    "rolling20RangePct": "紫金前20日平均振幅",
    "priorDayVolumeRatio5": "紫金昨日量能/前5日",
    "priorPeerReturnPct": "同业昨日涨跌",
    "priorGoldReturnPct": "黄金组昨日涨跌",
    "priorCopperReturnPct": "铜组昨日涨跌",
    "priorZijinPeerAlphaPct": "紫金昨日同业超额",
}
MODEL_CONFIGS = [
    {"maxDepth": depth, "minSamplesLeaf": leaf}
    for depth in (3, 4, 5, 6)
    for leaf in (40, 60, 80, 100, 120)
]


def load_panel(path: Path) -> pd.DataFrame:
    con = duckdb.connect()
    frame = con.execute(
        """
        SELECT CAST(trade_date AS VARCHAR) AS tradeDate,
               CAST(trade_time AS VARCHAR) AS tradeTime,
               regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') AS code,
               open, high, low, close, vol AS volume, amount,
               pre_close AS previousClose
        FROM read_parquet(?)
        ORDER BY trade_date, trade_time, code
        """,
        [str(path)],
    ).fetch_df()
    con.close()
    numeric = ["open", "high", "low", "close", "volume", "amount", "previousClose"]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"])
    frame = frame[(frame[["open", "high", "low", "close"]] > 0).all(axis=1)].copy()
    return frame


def causal_stock_features(raw: pd.DataFrame) -> pd.DataFrame:
    features = core.add_causal_features(raw.sort_values("tradeTime"))
    return features.set_index("tradeTime")


def group_mean(aligned: dict[str, pd.DataFrame], codes: list[str], column: str) -> pd.Series:
    series = [aligned[code][column] for code in codes if code in aligned]
    if not series:
        return pd.Series(dtype=float)
    return pd.concat(series, axis=1).mean(axis=1, skipna=True)


def build_daily_context(panel: pd.DataFrame) -> dict[str, dict[str, float]]:
    """Build context for day D exclusively from complete days before D."""
    daily = (
        panel.sort_values(["code", "tradeDate", "tradeTime"])
        .groupby(["code", "tradeDate"], sort=True)
        .agg(
            dayOpen=("open", "first"),
            dayHigh=("high", "max"),
            dayLow=("low", "min"),
            dayClose=("close", "last"),
            dayVolume=("volume", "sum"),
            previousClose=("previousClose", "first"),
        )
        .reset_index()
    )
    daily["dayReturnPct"] = (daily["dayClose"] / daily["previousClose"] - 1) * 100
    daily["dayRangePct"] = (daily["dayHigh"] - daily["dayLow"]) / daily["previousClose"] * 100
    spread = (daily["dayHigh"] - daily["dayLow"]).replace(0, np.nan)
    daily["dayClosePosition"] = ((daily["dayClose"] - daily["dayLow"]) / spread).fillna(0.5)

    by_code: dict[str, pd.DataFrame] = {}
    for code, stock in daily.groupby("code", sort=False):
        item = stock.sort_values("tradeDate").copy()
        item["priorDayReturnPct"] = item["dayReturnPct"].shift(1)
        item["priorDayRangePct"] = item["dayRangePct"].shift(1)
        item["priorDayClosePosition"] = item["dayClosePosition"].shift(1)
        item["rolling5ReturnPct"] = (item["dayClose"].shift(1) / item["dayClose"].shift(6) - 1) * 100
        item["rolling20ReturnPct"] = (item["dayClose"].shift(1) / item["dayClose"].shift(21) - 1) * 100
        item["rolling5RangePct"] = item["dayRangePct"].shift(1).rolling(5, min_periods=3).mean()
        item["rolling20RangePct"] = item["dayRangePct"].shift(1).rolling(20, min_periods=10).mean()
        prior_volume = item["dayVolume"].shift(1)
        rolling_volume = item["dayVolume"].shift(2).rolling(5, min_periods=3).mean()
        item["priorDayVolumeRatio5"] = (prior_volume / rolling_volume).replace([np.inf, -np.inf], np.nan)
        by_code[str(code)] = item.set_index("tradeDate")

    target = by_code[TARGET_CODE]
    peer_codes = [code for code in PEER_GROUPS if code in by_code]
    gold_codes = [code for code in peer_codes if PEER_GROUPS[code] == "gold"]
    copper_codes = [code for code in peer_codes if PEER_GROUPS[code] == "copper"]

    def prior_group_return(date: str, codes: list[str]) -> float:
        values = [
            by_code[code].at[date, "priorDayReturnPct"]
            for code in codes
            if date in by_code[code].index
        ]
        values = [float(value) for value in values if pd.notna(value)]
        return float(np.mean(values)) if values else 0.0

    result: dict[str, dict[str, float]] = {}
    for date, row in target.iterrows():
        context = {
            feature: float(row[feature]) if pd.notna(row[feature]) else 0.0
            for feature in DAILY_CONTEXT_FEATURES[:8]
        }
        context["priorPeerReturnPct"] = prior_group_return(str(date), peer_codes)
        context["priorGoldReturnPct"] = prior_group_return(str(date), gold_codes)
        context["priorCopperReturnPct"] = prior_group_return(str(date), copper_codes)
        context["priorZijinPeerAlphaPct"] = (
            context["priorDayReturnPct"] - context["priorPeerReturnPct"]
        )
        result[str(date)] = context
    return result


def build_causal_day(
    raw_day: pd.DataFrame,
    context: dict[str, float] | None = None,
) -> pd.DataFrame | None:
    stocks = {
        str(code): causal_stock_features(stock.copy())
        for code, stock in raw_day.groupby("code", sort=False)
    }
    if TARGET_CODE not in stocks:
        return None
    target = stocks[TARGET_CODE].copy()
    target_index = target.index
    aligned = {
        code: stock.reindex(target_index)
        for code, stock in stocks.items()
        if code != TARGET_CODE and code in PEER_GROUPS
    }
    if not aligned:
        return None

    peer_codes = sorted(aligned)
    gold_codes = [code for code in peer_codes if PEER_GROUPS[code] == "gold"]
    copper_codes = [code for code in peer_codes if PEER_GROUPS[code] == "copper"]
    target["peerReturn3Pct"] = group_mean(aligned, peer_codes, "return3Pct")
    target["peerReturn5Pct"] = group_mean(aligned, peer_codes, "return5Pct")
    target["peerVwapBiasPct"] = group_mean(aligned, peer_codes, "vwapBiasPct")
    target["peerOpenDeviationPct"] = group_mean(aligned, peer_codes, "openDeviationPct")
    target["peerVolumeRatio"] = group_mean(aligned, peer_codes, "volumeRatio")
    target["goldReturn3Pct"] = group_mean(aligned, gold_codes, "return3Pct")
    target["goldReturn5Pct"] = group_mean(aligned, gold_codes, "return5Pct")
    target["copperReturn3Pct"] = group_mean(aligned, copper_codes, "return3Pct")
    target["copperReturn5Pct"] = group_mean(aligned, copper_codes, "return5Pct")

    return3_panel = pd.concat([aligned[code]["return3Pct"] for code in peer_codes], axis=1)
    vwap_panel = pd.concat([aligned[code]["vwapBiasPct"] for code in peer_codes], axis=1)
    close_panel = pd.concat([aligned[code]["close"] for code in peer_codes], axis=1)
    target["peerBreadth3"] = (return3_panel > 0).sum(axis=1) / return3_panel.notna().sum(axis=1).clip(lower=1)
    target["peerBreadthVwap"] = (vwap_panel > 0).sum(axis=1) / vwap_panel.notna().sum(axis=1).clip(lower=1)
    target["peerCoverage"] = close_panel.notna().sum(axis=1) / len(peer_codes)
    target["zijinAlpha3Pct"] = target["return3Pct"] - target["peerReturn3Pct"]
    target["zijinAlpha5Pct"] = target["return5Pct"] - target["peerReturn5Pct"]
    target["zijinAlphaVwapPct"] = target["vwapBiasPct"] - target["peerVwapBiasPct"]
    target["zijinAlphaOpenPct"] = target["openDeviationPct"] - target["peerOpenDeviationPct"]
    target[PEER_FEATURES] = target[PEER_FEATURES].replace([np.inf, -np.inf], np.nan)
    target[PEER_FEATURES] = target[PEER_FEATURES].fillna(0)
    for feature in DAILY_CONTEXT_FEATURES:
        target[feature] = float((context or {}).get(feature, 0.0))
    return target.reset_index()


def build_samples(panel: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, object]]:
    samples: list[dict[str, object]] = []
    complete_days = 0
    coverage_values: list[float] = []
    daily_context = build_daily_context(panel)
    for date, raw_day in panel.groupby("tradeDate", sort=True):
        day = build_causal_day(raw_day, daily_context.get(str(date)))
        if day is None or len(day) < 120:
            continue
        complete_days += 1
        coverage_values.extend(day["peerCoverage"].tolist())
        year = str(date)[:4]
        matrix = day[FEATURES].to_numpy(dtype=float)
        minute_values = day["minuteOfDay"].to_numpy(dtype=int)
        arrays = core.DayArrays(
            open=day["open"].to_numpy(dtype=float),
            high=day["high"].to_numpy(dtype=float),
            low=day["low"].to_numpy(dtype=float),
            close=day["close"].to_numpy(dtype=float),
        )
        feature_index = {name: position for position, name in enumerate(FEATURES)}
        last_candidate = {"positive": -core.MIN_CANDIDATE_COOLDOWN,
                          "reverse": -core.MIN_CANDIDATE_COOLDOWN}
        for index in range(3, len(day) - 1):
            minute = int(minute_values[index])
            if minute < 9 * 60 + 33 or minute >= 14 * 60 + 30:
                continue
            current = matrix[index]
            previous = matrix[index - 1]
            positive_turn = (
                current[feature_index["return3Pct"]] > 0 >= previous[feature_index["return3Pct"]]
                or current[feature_index["ma5SlopePct"]] > 0 >= previous[feature_index["ma5SlopePct"]]
            )
            positive_location = (
                current[feature_index["vwapBiasPct"]] <= -0.10
                or current[feature_index["intradayPosition"]] <= 0.35
                or current[feature_index["drawdownFromHighPct"]] <= -0.60
            )
            reverse_turn = (
                current[feature_index["return3Pct"]] < 0 <= previous[feature_index["return3Pct"]]
                or current[feature_index["ma5SlopePct"]] < 0 <= previous[feature_index["ma5SlopePct"]]
            )
            reverse_location = (
                current[feature_index["vwapBiasPct"]] >= 0.10
                or current[feature_index["intradayPosition"]] >= 0.65
                or current[feature_index["reboundFromLowPct"]] >= 0.60
            )
            anchors = {
                "positive": positive_turn and positive_location,
                "reverse": reverse_turn and reverse_location,
            }
            base = {name: float(value) for name, value in zip(FEATURES, current, strict=True)}
            for direction in ("positive", "reverse"):
                if not anchors[direction] or index - last_candidate[direction] < core.MIN_CANDIDATE_COOLDOWN:
                    continue
                outcome = core.evaluate_outcome(arrays, index, direction)
                if outcome is None:
                    continue
                last_candidate[direction] = index
                samples.append({
                    "date": str(date), "year": year, "rowIndex": index,
                    "direction": direction, **base,
                    "netPct": outcome.net_pct, "won": outcome.won,
                    "targetTouched": outcome.target_touched,
                    "exitIndex": outcome.exit_offset,
                    "holdMinutes": outcome.hold_minutes,
                    "exitReason": outcome.exit_reason,
                })
    coverage = np.asarray(coverage_values, dtype=float)
    audit = {
        "completeTargetDays": complete_days,
        "meanPeerCoverage": round(float(coverage.mean()), 4) if len(coverage) else 0,
        "minimumPeerCoverage": round(float(coverage.min()), 4) if len(coverage) else 0,
    }
    return pd.DataFrame(samples), audit


def leaf_conditions(model: DecisionTreeClassifier) -> dict[int, list[tuple[str, str, float]]]:
    tree = model.tree_
    result: dict[int, list[tuple[str, str, float]]] = {}

    def walk(node: int, path: list[tuple[str, str, float]]) -> None:
        if tree.children_left[node] == tree.children_right[node]:
            result[node] = path
            return
        feature = FEATURES[tree.feature[node]]
        threshold = float(tree.threshold[node])
        walk(tree.children_left[node], [*path, (feature, "<=", threshold)])
        walk(tree.children_right[node], [*path, (feature, ">", threshold)])

    walk(0, [])
    return result


def readable_condition(feature: str, operator: str, threshold: float) -> str:
    if feature == "minuteOfDay":
        minute = max(0, round(threshold))
        value = f"{minute // 60:02d}:{minute % 60:02d}"
    elif feature in {"intradayPosition", "volumeRatio", "pullbackVolumeRatio",
                     "priceZscore", "peerVolumeRatio", "peerBreadth3",
                     "peerBreadthVwap", "peerCoverage", "priorDayClosePosition",
                     "priorDayVolumeRatio5"}:
        value = f"{threshold:.2f}"
    else:
        value = f"{threshold:+.2f}%"
    return f"{FEATURE_LABELS[feature]} {operator} {value}"


def yearly_training_stability(rows: pd.DataFrame) -> dict[str, dict[str, object]]:
    return {
        year: core.summarize(core.independent_rows(rows[rows["year"] == year]))
        for year in ("2022", "2023", "2024")
    }


def train_config(samples: pd.DataFrame, direction: str, config: dict[str, int]) -> dict[str, object]:
    subset = samples[samples["direction"] == direction].copy()
    training = subset[subset["year"].isin(["2022", "2023", "2024"])]
    model = DecisionTreeClassifier(
        max_depth=config["maxDepth"],
        min_samples_leaf=config["minSamplesLeaf"],
        class_weight="balanced",
        random_state=601899,
    )
    model.fit(training[FEATURES], training["won"].astype(int))
    subset["leaf"] = model.apply(subset[FEATURES])
    paths = leaf_conditions(model)
    rules: list[dict[str, object]] = []
    accepted: set[int] = set()
    for leaf, conditions in paths.items():
        train_rows = subset[(subset["leaf"] == leaf) & subset["year"].isin(["2022", "2023", "2024"])]
        validation_rows = subset[(subset["leaf"] == leaf) & (subset["year"] == "2025")]
        blind_rows = subset[(subset["leaf"] == leaf) & (subset["year"] == "2026")]
        train_summary = core.summarize(core.independent_rows(train_rows))
        validation_summary = core.summarize(core.independent_rows(validation_rows))
        blind_summary = core.summarize(core.independent_rows(blind_rows))
        by_year = yearly_training_stability(train_rows)
        stable_training_years = all(
            summary["trades"] >= 12
            and (summary["winRate"] or 0) >= 0.50
            and summary["averageNetPct"] > -0.03
            for summary in by_year.values()
        )
        training_ok = (
            train_summary["trades"] >= 60
            and (train_summary["winRate"] or 0) >= 0.57
            and train_summary["averageNetPct"] > 0
            and stable_training_years
        )
        validation_ok = (
            training_ok
            and validation_summary["trades"] >= 15
            and (validation_summary["winRate"] or 0) >= 0.65
            and validation_summary["averageNetPct"] > 0
        )
        if validation_ok:
            accepted.add(int(leaf))
        rules.append({
            "leaf": int(leaf),
            "conditions": [readable_condition(*condition) for condition in conditions],
            "training": train_summary,
            "trainingByYear": by_year,
            "validation": validation_summary,
            "blindTest": blind_summary,
            "passedTrainingGate": training_ok,
            "passedValidationGate": validation_ok,
        })
    rules.sort(key=lambda rule: (
        rule["passedValidationGate"], rule["validation"]["averageNetPct"],
        rule["validation"]["winRate"] or 0, rule["training"]["trades"]
    ), reverse=True)
    return {"model": model, "subset": subset, "accepted": accepted, "rules": rules}


def sequence_audit(result: dict[str, object], years: set[str]) -> dict[str, object]:
    accepted = result["accepted"]
    if not accepted:
        return core.summarize(pd.DataFrame())
    subset = result["subset"]
    rows = subset[subset["year"].isin(years) & subset["leaf"].isin(accepted)]
    return core.summarize(core.independent_rows(rows))


def config_public(config: dict[str, int], result: dict[str, object]) -> dict[str, object]:
    return {
        **config,
        "acceptedLeafCount": len(result["accepted"]),
        "training": sequence_audit(result, {"2022", "2023", "2024"}),
        "validation": sequence_audit(result, {"2025"}),
        "blindTest": sequence_audit(result, {"2026"}),
        "topRules": result["rules"][:8],
    }


def choose_without_blind(configs: list[dict[str, object]]) -> dict[str, object] | None:
    eligible = [config for config in configs if config["acceptedLeafCount"] > 0]
    if not eligible:
        return None
    return max(eligible, key=lambda config: (
        config["validation"]["averageNetPct"],
        config["validation"]["winRate"] or 0,
        config["validation"]["trades"],
    ))


def main() -> None:
    parser = argparse.ArgumentParser(description="紫金矿业同业联动因果规律扫描")
    parser.add_argument("input", type=Path)
    parser.add_argument(
        "--output", type=Path,
        default=Path("public/research/zijin-peer-pattern-discovery.json"),
    )
    args = parser.parse_args()
    started = time.time()
    panel = load_panel(args.input.resolve())
    samples, coverage_audit = build_samples(panel)
    if samples.empty:
        raise SystemExit("没有生成可研究的因果候选样本")

    all_configs: dict[str, list[dict[str, object]]] = {"positive": [], "reverse": []}
    for direction in ("positive", "reverse"):
        for config in MODEL_CONFIGS:
            trained = train_config(samples, direction, config)
            all_configs[direction].append(config_public(config, trained))
        all_configs[direction].sort(key=lambda item: (
            item["acceptedLeafCount"] > 0,
            item["validation"]["averageNetPct"],
            item["validation"]["winRate"] or 0,
        ), reverse=True)

    selected = {
        direction: choose_without_blind(all_configs[direction])
        for direction in ("positive", "reverse")
    }
    validated = {direction: config for direction, config in selected.items() if config}
    blind_pass = {
        direction: bool(
            config
            and config["blindTest"]["trades"] >= 8
            and (config["blindTest"]["winRate"] or 0) >= 0.60
            and config["blindTest"]["averageNetPct"] > 0
        )
        for direction, config in selected.items()
    }
    stable_count = sum(blind_pass.values())
    result = {
        "schemaVersion": 1,
        "stock": {"code": TARGET_CODE, "marketCode": "601899.SH", "name": "紫金矿业"},
        "mode": "research-only",
        "affectsV4": False,
        "dataset": {
            "firstDate": str(panel["tradeDate"].min()),
            "lastDate": str(panel["tradeDate"].max()),
            "minuteRows": int(len(panel)),
            "stockCount": int(panel["code"].nunique()),
            "tradingDays": int(panel["tradeDate"].nunique()),
            "labeledScenarios": int(len(samples)),
            **coverage_audit,
            "securities": [
                {"code": code, "name": PEER_NAMES[code], "group": PEER_GROUPS.get(code, "target")}
                for code in [TARGET_CODE, *PEER_GROUPS]
            ],
        },
        "methodology": {
            "training": "2022-2024",
            "validation": "2025",
            "blindTest": "2026-01-05..2026-04-17",
            "causalFeatures": True,
            "earliestFill": "下一分钟开盘价",
            "futureUse": "仅作为结果标签",
            "selectionUsesBlindTest": False,
            "modelConfigCountPerDirection": len(MODEL_CONFIGS),
            "features": FEATURES,
            "peerFeatures": PEER_FEATURES,
            "dailyContextFeatures": DAILY_CONTEXT_FEATURES,
            "roundTripCostPct": core.ROUND_TRIP_COST_PCT,
            "netProfitZonePct": [core.MIN_NET_TARGET_PCT, core.MAX_NET_TARGET_PCT],
            "maxHoldMinutes": core.MAX_HOLD_MINUTES,
            "maxTradesPerDay": core.MAX_TRADES_PER_DAY,
        },
        "baseline": {
            direction: {
                "training": core.summarize(core.independent_rows(samples[(samples["direction"] == direction) & samples["year"].isin(["2022", "2023", "2024"])])),
                "validation": core.summarize(core.independent_rows(samples[(samples["direction"] == direction) & (samples["year"] == "2025")])),
                "blindTest": core.summarize(core.independent_rows(samples[(samples["direction"] == direction) & (samples["year"] == "2026")])),
            }
            for direction in ("positive", "reverse")
        },
        "selectedWithoutBlind": selected,
        "blindAuditPassed": blind_pass,
        "stableRuleCount": stable_count,
        "searchSummary": {
            direction: all_configs[direction][:5]
            for direction in ("positive", "reverse")
        },
        "conclusion": {
            "status": "stable-peer-pattern-found" if stable_count else (
                "validation-only-pattern" if validated else "no-stable-peer-pattern"
            ),
            "message": (
                "同业相对强弱规则通过2025验证和2026盲测，仍需模拟观察后人工评审。"
                if stable_count
                else "同业与前序日结构因子已完成严格样本外扫描；未通过盲测的规则不会为了达到65%而启用。"
            ),
            "winRateTarget": 0.65,
            "nextRequiredFactors": ["国际金价与铜价", "沪深300与上证指数", "港股紫金矿业", "公告与突发事件时钟"],
            "deployment": "研究结果不自动进入Smart-T V4",
        },
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "dataset": result["dataset"],
        "selectedWithoutBlind": result["selectedWithoutBlind"],
        "blindAuditPassed": blind_pass,
        "conclusion": result["conclusion"],
        "elapsedSeconds": result["elapsedSeconds"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
