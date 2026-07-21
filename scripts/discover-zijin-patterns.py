#!/usr/bin/env python3
"""Discover interpretable, causal intraday patterns for Zijin Mining.

Features at minute t use only bars up to t. Outcomes from t+1 onward are labels
only. Rules are learned on 2022-2024, gated on 2025, and audited once on 2026.
This research artifact is isolated from Smart-T V4 and never places orders.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier


ROUND_TRIP_COST_PCT = 0.12
MIN_NET_TARGET_PCT = 0.64
MAX_NET_TARGET_PCT = 1.00
TRAILING_RETRACE_PCT = 0.18
STOP_GROSS_PCT = 0.45
MAX_HOLD_MINUTES = 60
MAX_TRADES_PER_DAY = 2
MIN_CANDIDATE_COOLDOWN = 5

FEATURES = [
    "minuteOfDay",
    "gapPct",
    "openDeviationPct",
    "vwapBiasPct",
    "vwapSlope5Pct",
    "return3Pct",
    "return5Pct",
    "ma5SlopePct",
    "ma10SlopePct",
    "volumeRatio",
    "pullbackVolumeRatio",
    "priceZscore",
    "atrPct",
    "intradayPosition",
    "rangePct",
    "drawdownFromHighPct",
    "reboundFromLowPct",
]

FEATURE_LABELS = {
    "minuteOfDay": "时刻",
    "gapPct": "开盘缺口",
    "openDeviationPct": "相对开盘价",
    "vwapBiasPct": "距VWAP",
    "vwapSlope5Pct": "VWAP五分钟斜率",
    "return3Pct": "三分钟动量",
    "return5Pct": "五分钟动量",
    "ma5SlopePct": "MA5斜率",
    "ma10SlopePct": "MA10斜率",
    "volumeRatio": "量比",
    "pullbackVolumeRatio": "回调量/上涨量",
    "priceZscore": "价格Z分数",
    "atrPct": "短ATR",
    "intradayPosition": "日内位置",
    "rangePct": "已出现振幅",
    "drawdownFromHighPct": "距已出现高点",
    "reboundFromLowPct": "距已出现低点",
}


@dataclass(frozen=True)
class Outcome:
    net_pct: float
    won: bool
    target_touched: bool
    exit_offset: int
    hold_minutes: int
    exit_reason: str


@dataclass(frozen=True)
class DayArrays:
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray


def pct(value: float, base: float) -> float:
    return ((value - base) / base) * 100 if base > 0 else 0.0


def load_minutes(path: Path) -> pd.DataFrame:
    con = duckdb.connect()
    frame = con.execute(
        """
        SELECT
          CAST(trade_date AS VARCHAR) AS tradeDate,
          CAST(trade_time AS VARCHAR) AS tradeTime,
          open, high, low, close, vol AS volume, amount, pre_close AS previousClose
        FROM read_parquet(?)
        ORDER BY trade_date, trade_time
        """,
        [str(path)],
    ).fetch_df()
    con.close()
    numeric = ["open", "high", "low", "close", "volume", "amount", "previousClose"]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"])
    frame = frame[(frame[["open", "high", "low", "close"]] > 0).all(axis=1)].copy()
    return frame


def minute_number(value: str) -> int:
    text = str(value).strip()
    if ":" in text:
        parts = text.split(":")
        if len(parts) >= 2:
            return int(parts[0]) * 60 + int(parts[1])
    digits = "".join(character for character in text if character.isdigit())
    if len(digits) <= 4:
        digits = digits.zfill(4)
        return int(digits[:2]) * 60 + int(digits[2:4])
    digits = digits.zfill(6)
    return int(digits[:2]) * 60 + int(digits[2:4])


def add_causal_features(day: pd.DataFrame) -> pd.DataFrame:
    out = day.reset_index(drop=True).copy()
    close = out["close"]
    high = out["high"]
    low = out["low"]
    volume = out["volume"].clip(lower=0)
    amount = out["amount"].clip(lower=0)
    previous_close = float(out.iloc[0]["previousClose"] or out.iloc[0]["open"])
    day_open = float(out.iloc[0]["open"])

    cumulative_volume = volume.cumsum().replace(0, np.nan)
    vwap = (amount.cumsum() / cumulative_volume).fillna(close.expanding().mean())
    ma5 = close.rolling(5, min_periods=3).mean()
    ma10 = close.rolling(10, min_periods=5).mean()
    mean20 = close.rolling(20, min_periods=5).mean()
    std20 = close.rolling(20, min_periods=5).std(ddof=0).replace(0, np.nan)
    true_range = pd.concat(
        [high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1
    ).max(axis=1)
    up_volume = volume.where(close.diff() > 0, 0).rolling(5, min_periods=2).sum()
    down_volume = volume.where(close.diff() < 0, 0).rolling(5, min_periods=2).sum()
    rolling_volume = volume.shift(1).rolling(20, min_periods=3).mean().replace(0, np.nan)
    running_high = high.cummax()
    running_low = low.cummin()

    out["rowIndex"] = np.arange(len(out))
    out["minuteOfDay"] = out["tradeTime"].map(minute_number)
    out["gapPct"] = pct(day_open, previous_close)
    out["openDeviationPct"] = (close / day_open - 1) * 100
    out["vwapBiasPct"] = (close / vwap - 1) * 100
    out["vwapSlope5Pct"] = (vwap / vwap.shift(5) - 1).fillna(0) * 100
    out["return3Pct"] = (close / close.shift(3) - 1).fillna(0) * 100
    out["return5Pct"] = (close / close.shift(5) - 1).fillna(0) * 100
    out["ma5SlopePct"] = (ma5 / ma5.shift(3) - 1).fillna(0) * 100
    out["ma10SlopePct"] = (ma10 / ma10.shift(5) - 1).fillna(0) * 100
    out["volumeRatio"] = (volume / rolling_volume).replace([np.inf, -np.inf], np.nan).fillna(1)
    out["pullbackVolumeRatio"] = (
        down_volume / up_volume.replace(0, np.nan)
    ).replace([np.inf, -np.inf], np.nan).fillna(1).clip(0, 8)
    out["priceZscore"] = ((close - mean20) / std20).fillna(0).clip(-6, 6)
    out["atrPct"] = (true_range.rolling(14, min_periods=4).mean() / close * 100).fillna(0)
    spread = (running_high - running_low).replace(0, np.nan)
    out["intradayPosition"] = ((close - running_low) / spread).fillna(0.5).clip(0, 1)
    out["rangePct"] = ((running_high - running_low) / previous_close * 100).fillna(0)
    out["drawdownFromHighPct"] = ((close / running_high) - 1).fillna(0) * 100
    out["reboundFromLowPct"] = ((close / running_low) - 1).fillna(0) * 100
    out[FEATURES] = out[FEATURES].replace([np.inf, -np.inf], np.nan).fillna(0)
    return out


def evaluate_outcome(day: DayArrays, signal_index: int, direction: str) -> Outcome | None:
    entry_index = signal_index + 1
    if entry_index >= len(day.open):
        return None
    entry = float(day.open[entry_index])
    target_gross = MIN_NET_TARGET_PCT + ROUND_TRIP_COST_PCT
    cap_gross = MAX_NET_TARGET_PCT + ROUND_TRIP_COST_PCT
    peak_gross = -math.inf
    target_touched = False
    trailing = False
    end_index = min(len(day.open) - 1, entry_index + MAX_HOLD_MINUTES)
    exit_index = end_index
    exit_reason = "time"
    gross_return = 0.0

    for index in range(entry_index, end_index + 1):
        if direction == "positive":
            adverse = pct(float(day.low[index]), entry)
            favorable = pct(float(day.high[index]), entry)
            close_return = pct(float(day.close[index]), entry)
        else:
            adverse = -pct(float(day.high[index]), entry)
            favorable = -pct(float(day.low[index]), entry)
            close_return = -pct(float(day.close[index]), entry)
        if adverse <= -STOP_GROSS_PCT:
            gross_return = -STOP_GROSS_PCT
            exit_index = index
            exit_reason = "stop"
            break
        peak_gross = max(peak_gross, favorable)
        if peak_gross >= target_gross:
            target_touched = True
            trailing = True
        if peak_gross >= cap_gross:
            gross_return = cap_gross
            exit_index = index
            exit_reason = "max-target"
            break
        if trailing and close_return <= peak_gross - TRAILING_RETRACE_PCT:
            gross_return = close_return
            exit_index = index
            exit_reason = "trailing"
            break
        if index == end_index:
            gross_return = close_return

    net_return = gross_return - ROUND_TRIP_COST_PCT
    return Outcome(
        net_pct=net_return,
        won=net_return > 0,
        target_touched=target_touched,
        exit_offset=exit_index,
        hold_minutes=max(1, exit_index - entry_index + 1),
        exit_reason=exit_reason,
    )


def build_samples(minutes: pd.DataFrame) -> pd.DataFrame:
    samples: list[dict[str, object]] = []
    for date, raw_day in minutes.groupby("tradeDate", sort=True):
        day = add_causal_features(raw_day)
        year = str(date)[:4]
        feature_matrix = day[FEATURES].to_numpy(dtype=float)
        minute_values = day["minuteOfDay"].to_numpy(dtype=int)
        arrays = DayArrays(
            open=day["open"].to_numpy(dtype=float),
            high=day["high"].to_numpy(dtype=float),
            low=day["low"].to_numpy(dtype=float),
            close=day["close"].to_numpy(dtype=float),
        )
        last_candidate = {
            "positive": -MIN_CANDIDATE_COOLDOWN,
            "reverse": -MIN_CANDIDATE_COOLDOWN,
        }
        feature_index = {name: position for position, name in enumerate(FEATURES)}
        for index in range(3, len(day) - 1):
            minute = int(minute_values[index])
            if minute < 9 * 60 + 33 or minute >= 14 * 60 + 30:
                continue
            current = feature_matrix[index]
            previous = feature_matrix[index - 1]
            positive_turn = (
                (current[feature_index["return3Pct"]] > 0 >= previous[feature_index["return3Pct"]])
                or (current[feature_index["ma5SlopePct"]] > 0 >= previous[feature_index["ma5SlopePct"]])
            )
            positive_location = (
                current[feature_index["vwapBiasPct"]] <= -0.10
                or current[feature_index["intradayPosition"]] <= 0.35
                or current[feature_index["drawdownFromHighPct"]] <= -0.60
            )
            reverse_turn = (
                (current[feature_index["return3Pct"]] < 0 <= previous[feature_index["return3Pct"]])
                or (current[feature_index["ma5SlopePct"]] < 0 <= previous[feature_index["ma5SlopePct"]])
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
            base = {
                name: float(value)
                for name, value in zip(FEATURES, feature_matrix[index], strict=True)
            }
            for direction in ("positive", "reverse"):
                if not anchors[direction] or index - last_candidate[direction] < MIN_CANDIDATE_COOLDOWN:
                    continue
                outcome = evaluate_outcome(arrays, index, direction)
                if outcome is None:
                    continue
                last_candidate[direction] = index
                samples.append(
                    {
                        "date": str(date),
                        "year": year,
                        "rowIndex": index,
                        "direction": direction,
                        **base,
                        "netPct": outcome.net_pct,
                        "won": outcome.won,
                        "targetTouched": outcome.target_touched,
                        "exitIndex": outcome.exit_offset,
                        "holdMinutes": outcome.hold_minutes,
                        "exitReason": outcome.exit_reason,
                    }
                )
    return pd.DataFrame(samples)


def summarize(rows: pd.DataFrame) -> dict[str, object]:
    if rows.empty:
        return {"trades": 0, "wins": 0, "winRate": None, "averageNetPct": 0.0,
                "totalNetPct": 0.0, "targetRate": None, "averageHoldMinutes": 0.0}
    return {
        "trades": int(len(rows)),
        "wins": int(rows["won"].sum()),
        "winRate": round(float(rows["won"].mean()), 4),
        "averageNetPct": round(float(rows["netPct"].mean()), 4),
        "totalNetPct": round(float(rows["netPct"].sum()), 4),
        "targetRate": round(float(rows["targetTouched"].mean()), 4),
        "averageHoldMinutes": round(float(rows["holdMinutes"].mean()), 2),
    }


def independent_rows(rows: pd.DataFrame, max_per_day: int = MAX_TRADES_PER_DAY) -> pd.DataFrame:
    """Keep only independently executable, non-overlapping events per day."""
    if rows.empty:
        return rows
    selected: list[pd.Series] = []
    ordered = rows.sort_values(["date", "rowIndex"])
    for _, day in ordered.groupby("date", sort=True):
        last_exit = -1
        count = 0
        for _, row in day.iterrows():
            index = int(row["rowIndex"])
            if index <= last_exit or count >= max_per_day:
                continue
            selected.append(row)
            last_exit = int(row["exitIndex"])
            count += 1
    return pd.DataFrame(selected)


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
    elif feature in {"intradayPosition", "volumeRatio", "pullbackVolumeRatio", "priceZscore"}:
        value = f"{threshold:.2f}"
    else:
        value = f"{threshold:+.2f}%"
    return f"{FEATURE_LABELS[feature]} {operator} {value}"


def mine_direction(samples: pd.DataFrame, direction: str) -> tuple[DecisionTreeClassifier, list[dict[str, object]]]:
    subset = samples[samples["direction"] == direction].copy()
    training = subset[subset["year"].isin(["2022", "2023", "2024"])]
    model = DecisionTreeClassifier(
        max_depth=6,
        min_samples_leaf=80,
        class_weight="balanced",
        random_state=601899,
    )
    model.fit(training[FEATURES], training["won"].astype(int))
    subset["leaf"] = model.apply(subset[FEATURES])
    paths = leaf_conditions(model)
    rules: list[dict[str, object]] = []
    for leaf, conditions in paths.items():
        train_rows = subset[(subset["leaf"] == leaf) & subset["year"].isin(["2022", "2023", "2024"])]
        validation_rows = subset[(subset["leaf"] == leaf) & (subset["year"] == "2025")]
        blind_rows = subset[(subset["leaf"] == leaf) & (subset["year"] == "2026")]
        raw_scenarios = {
            "training": int(len(train_rows)),
            "validation": int(len(validation_rows)),
            "blindTest": int(len(blind_rows)),
        }
        train_summary = summarize(independent_rows(train_rows))
        validation_summary = summarize(independent_rows(validation_rows))
        blind_summary = summarize(independent_rows(blind_rows))
        training_ok = (
            train_summary["trades"] >= 60
            and (train_summary["winRate"] or 0) >= 0.55
            and train_summary["averageNetPct"] > 0
        )
        validation_ok = (
            training_ok
            and validation_summary["trades"] >= 15
            and (validation_summary["winRate"] or 0) >= 0.60
            and validation_summary["averageNetPct"] > 0
        )
        rules.append(
            {
                "leaf": int(leaf),
                "direction": direction,
                "conditions": [readable_condition(*condition) for condition in conditions],
                "rawScenarioCount": raw_scenarios,
                "training": train_summary,
                "validation": validation_summary,
                "blindTest": blind_summary,
                "passedTrainingGate": training_ok,
                "passedValidationGate": validation_ok,
            }
        )
    rules.sort(
        key=lambda rule: (
            rule["passedValidationGate"],
            rule["validation"]["averageNetPct"],
            rule["validation"]["winRate"] or 0,
            rule["training"]["trades"],
        ),
        reverse=True,
    )
    return model, rules


def sequence_backtest(
    samples: pd.DataFrame,
    models: dict[str, DecisionTreeClassifier],
    accepted_leaves: dict[str, set[int]],
    years: set[str],
) -> dict[str, object]:
    candidates: list[pd.DataFrame] = []
    for direction, model in models.items():
        allowed = accepted_leaves[direction]
        if not allowed:
            continue
        rows = samples[(samples["direction"] == direction) & samples["year"].isin(years)].copy()
        rows["leaf"] = model.apply(rows[FEATURES])
        rows["probability"] = model.predict_proba(rows[FEATURES])[:, 1]
        candidates.append(rows[rows["leaf"].isin(allowed)])
    if not candidates:
        return summarize(pd.DataFrame())
    pool = pd.concat(candidates).sort_values(["date", "rowIndex", "probability"], ascending=[True, True, False])
    selected: list[pd.Series] = []
    for _, day in pool.groupby("date", sort=True):
        last_exit = -1
        count = 0
        for _, row in day.iterrows():
            index = int(row["rowIndex"])
            if index <= last_exit or count >= MAX_TRADES_PER_DAY:
                continue
            selected.append(row)
            last_exit = int(row["exitIndex"])
            count += 1
    return summarize(pd.DataFrame(selected))


def main() -> None:
    parser = argparse.ArgumentParser(description="紫金矿业因果分时规律发现")
    parser.add_argument("input", type=Path)
    parser.add_argument(
        "--output", type=Path, default=Path("public/research/zijin-pattern-discovery.json")
    )
    args = parser.parse_args()
    started = time.time()
    minutes = load_minutes(args.input.resolve())
    samples = build_samples(minutes)
    models: dict[str, DecisionTreeClassifier] = {}
    rules_by_direction: dict[str, list[dict[str, object]]] = {}
    for direction in ("positive", "reverse"):
        model, rules = mine_direction(samples, direction)
        models[direction] = model
        rules_by_direction[direction] = rules

    accepted = {
        direction: {
            int(rule["leaf"])
            for rule in rules
            if rule["passedValidationGate"]
        }
        for direction, rules in rules_by_direction.items()
    }
    candidate_baseline = {
        direction: {
            "training": summarize(
                independent_rows(
                    samples[
                        (samples["direction"] == direction)
                        & samples["year"].isin(["2022", "2023", "2024"])
                    ]
                )
            ),
            "validation": summarize(
                independent_rows(
                    samples[(samples["direction"] == direction) & (samples["year"] == "2025")]
                )
            ),
            "blindTest": summarize(
                independent_rows(
                    samples[(samples["direction"] == direction) & (samples["year"] == "2026")]
                )
            ),
        }
        for direction in ("positive", "reverse")
    }
    total_accepted = sum(len(leaves) for leaves in accepted.values())
    result = {
        "schemaVersion": 1,
        "stock": {"code": "601899", "marketCode": "601899.SH", "name": "紫金矿业"},
        "mode": "research-only",
        "affectsV4": False,
        "dataset": {
            "firstDate": str(minutes["tradeDate"].min()),
            "lastDate": str(minutes["tradeDate"].max()),
            "minuteRows": int(len(minutes)),
            "tradingDays": int(minutes["tradeDate"].nunique()),
            "labeledScenarios": int(len(samples)),
        },
        "methodology": {
            "training": "2022-2024",
            "validation": "2025",
            "blindTest": "2026-01-05..2026-04-17",
            "causalFeatures": True,
            "earliestFill": "下一分钟开盘价",
            "futureUse": "仅作为结果标签",
            "features": FEATURES,
            "roundTripCostPct": ROUND_TRIP_COST_PCT,
            "netProfitZonePct": [MIN_NET_TARGET_PCT, MAX_NET_TARGET_PCT],
            "maxHoldMinutes": MAX_HOLD_MINUTES,
            "maxTradesPerDay": MAX_TRADES_PER_DAY,
            "candidateCooldownMinutes": MIN_CANDIDATE_COOLDOWN,
            "candidateAnchor": "相对高低位或VWAP偏离后，三分钟动量/MA5斜率发生实时转向",
        },
        "discoveredRules": rules_by_direction,
        "acceptedRuleCount": {direction: len(leaves) for direction, leaves in accepted.items()},
        "candidateBaseline": candidate_baseline,
        "sequenceAudit": {
            "training": sequence_backtest(samples, models, accepted, {"2022", "2023", "2024"}),
            "validation": sequence_backtest(samples, models, accepted, {"2025"}),
            "blindTest": sequence_backtest(samples, models, accepted, {"2026"}),
        },
        "conclusion": {
            "status": "validated-patterns-found" if total_accepted else "no-stable-price-volume-rule",
            "message": (
                "已找到通过2025样本外验证的紫金专属价量规律，仍需人工评审。"
                if total_accepted
                else "纯个股价量条件没有发现跨年份稳定规律；所有候选均被样本外门槛否决。"
            ),
            "winRateTarget": 0.65,
            "nextRequiredFactors": [
                "国际金价与铜价",
                "有色金属板块强度",
                "沪深300与上证指数",
                "港股紫金矿业联动",
                "公告与突发事件时钟",
            ],
            "deployment": "研究结果不自动进入Smart-T V4",
        },
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
