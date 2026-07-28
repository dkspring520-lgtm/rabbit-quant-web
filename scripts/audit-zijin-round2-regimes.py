#!/usr/bin/env python3
"""Audit Zijin Mining intraday regimes without consuming the sealed 2026 set.

The regime assigned to minute t only uses rows at or before t.  A simulated
fill happens at the next minute open.  Later prices are labels only.  This
script is a research gate: it does not mutate Smart-T V4 and it deliberately
stops before opening the 2026 blind set.
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


ROUND_TRIP_COST_PCT = 0.12
MIN_NET_TARGET_PCT = 0.64
MAX_NET_TARGET_PCT = 1.00
TRAILING_RETRACE_PCT = 0.18
STOP_GROSS_PCT = 0.45
MAX_HOLD_MINUTES = 60
MAX_TRADES_PER_DAY = 2
MIN_COOLDOWN_MINUTES = 8

REGIME_LABELS = {
    "opening_repair": "开盘缺口修复",
    "vwap_reversion": "VWAP 偏离回归",
    "trend_pullback": "趋势回踩确认",
    "range_rotation": "震荡区间轮动",
    "impulse_exhaustion": "急涨急跌衰竭",
    "unclassified": "暂未归类",
}


@dataclass(frozen=True)
class Outcome:
    net_pct: float
    won: bool
    target_touched: bool
    hold_minutes: int


def pct(value: float, base: float) -> float:
    return ((value / base) - 1) * 100 if base > 0 else 0.0


def load_minutes(path: Path) -> pd.DataFrame:
    con = duckdb.connect()
    frame = con.execute(
        """
        SELECT CAST(trade_date AS VARCHAR) AS tradeDate,
               CAST(trade_time AS VARCHAR) AS tradeTime,
               open, high, low, close, vol AS volume, amount,
               pre_close AS previousClose
        FROM read_parquet(?)
        WHERE REPLACE(REPLACE(CAST(code AS VARCHAR), '.SH', ''), '.SZ', '') = '601899'
          AND CAST(trade_date AS VARCHAR) <= '20251231'
        ORDER BY trade_date, trade_time
        """,
        [str(path)],
    ).fetch_df()
    con.close()
    numeric = ["open", "high", "low", "close", "volume", "amount", "previousClose"]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    return frame.dropna(subset=["open", "high", "low", "close"]).copy()


def minute_number(value: str) -> int:
    digits = "".join(character for character in str(value) if character.isdigit()).zfill(6)
    return int(digits[:2]) * 60 + int(digits[2:4])


def add_causal_features(raw: pd.DataFrame) -> pd.DataFrame:
    day = raw.reset_index(drop=True).copy()
    close = day["close"]
    volume = day["volume"].clip(lower=0)
    amount = day["amount"].clip(lower=0)
    previous_close = float(day.iloc[0]["previousClose"] or day.iloc[0]["open"])
    day_open = float(day.iloc[0]["open"])
    cumulative_volume = volume.cumsum().replace(0, np.nan)
    vwap = (amount.cumsum() / cumulative_volume).fillna(close.expanding().mean())
    mean20 = close.rolling(20, min_periods=5).mean()
    std20 = close.rolling(20, min_periods=5).std(ddof=0).replace(0, np.nan)
    average_volume = volume.shift(1).rolling(20, min_periods=3).mean().replace(0, np.nan)
    running_high = day["high"].cummax()
    running_low = day["low"].cummin()
    spread = (running_high - running_low).replace(0, np.nan)

    day["minuteOfDay"] = day["tradeTime"].map(minute_number)
    day["gapPct"] = pct(day_open, previous_close)
    day["openDeviationPct"] = (close / day_open - 1) * 100
    day["vwapBiasPct"] = (close / vwap - 1) * 100
    day["vwapSlope5Pct"] = (vwap / vwap.shift(5) - 1).fillna(0) * 100
    day["return3Pct"] = (close / close.shift(3) - 1).fillna(0) * 100
    day["volumeRatio"] = (volume / average_volume).replace([np.inf, -np.inf], np.nan).fillna(1)
    day["priceZscore"] = ((close - mean20) / std20).fillna(0).clip(-6, 6)
    day["intradayPosition"] = ((close - running_low) / spread).fillna(0.5).clip(0, 1)
    day["rangePct"] = ((running_high - running_low) / previous_close * 100).fillna(0)
    return day.replace([np.inf, -np.inf], np.nan).fillna(0)


def classify_regime(row: pd.Series, direction: str) -> str:
    minute = int(row["minuteOfDay"])
    gap = float(row["gapPct"])
    open_deviation = float(row["openDeviationPct"])
    bias = float(row["vwapBiasPct"])
    slope = float(row["vwapSlope5Pct"])
    return3 = float(row["return3Pct"])
    volume_ratio = float(row["volumeRatio"])
    position = float(row["intradayPosition"])
    range_pct = float(row["rangePct"])

    repairing_gap = (
        direction == "positive" and gap <= -0.30 and open_deviation >= 0
    ) or (
        direction == "reverse" and gap >= 0.30 and open_deviation <= 0
    )
    if minute <= 10 * 60 + 15 and repairing_gap:
        return "opening_repair"
    if abs(bias) >= 0.28 and abs(slope) <= 0.08:
        return "vwap_reversion"
    trend_pullback = (
        direction == "positive" and slope >= 0.025 and bias <= 0.05 and return3 > 0
    ) or (
        direction == "reverse" and slope <= -0.025 and bias >= -0.05 and return3 < 0
    )
    if trend_pullback:
        return "trend_pullback"
    if abs(slope) <= 0.035 and range_pct >= 0.80 and (
        (direction == "positive" and position <= 0.35)
        or (direction == "reverse" and position >= 0.65)
    ):
        return "range_rotation"
    if abs(return3) >= 0.32 and volume_ratio >= 1.45:
        return "impulse_exhaustion"
    return "unclassified"


def evaluate_outcome(day: pd.DataFrame, signal_index: int, direction: str) -> Outcome | None:
    entry_index = signal_index + 1
    if entry_index >= len(day):
        return None
    entry = float(day.iloc[entry_index]["open"])
    target_gross = MIN_NET_TARGET_PCT + ROUND_TRIP_COST_PCT
    cap_gross = MAX_NET_TARGET_PCT + ROUND_TRIP_COST_PCT
    peak = -math.inf
    target_touched = False
    end_index = min(len(day) - 1, entry_index + MAX_HOLD_MINUTES)
    gross = 0.0
    exit_index = end_index
    for index in range(entry_index, end_index + 1):
        row = day.iloc[index]
        if direction == "positive":
            adverse = pct(float(row["low"]), entry)
            favorable = pct(float(row["high"]), entry)
            close_return = pct(float(row["close"]), entry)
        else:
            adverse = -pct(float(row["high"]), entry)
            favorable = -pct(float(row["low"]), entry)
            close_return = -pct(float(row["close"]), entry)
        if adverse <= -STOP_GROSS_PCT:
            gross = -STOP_GROSS_PCT
            exit_index = index
            break
        peak = max(peak, favorable)
        target_touched = target_touched or peak >= target_gross
        if peak >= cap_gross:
            gross = cap_gross
            exit_index = index
            break
        if target_touched and close_return <= peak - TRAILING_RETRACE_PCT:
            gross = close_return
            exit_index = index
            break
        gross = close_return
    net = gross - ROUND_TRIP_COST_PCT
    return Outcome(net, net > 0, target_touched, max(1, exit_index - entry_index + 1))


def anchor_candidate(current: pd.Series, previous: pd.Series, direction: str) -> bool:
    if direction == "positive":
        turn = current["return3Pct"] > 0 >= previous["return3Pct"]
        location = current["vwapBiasPct"] <= -0.10 or current["intradayPosition"] <= 0.35
    else:
        turn = current["return3Pct"] < 0 <= previous["return3Pct"]
        location = current["vwapBiasPct"] >= 0.10 or current["intradayPosition"] >= 0.65
    return bool(turn and location)


def build_samples(minutes: pd.DataFrame) -> pd.DataFrame:
    samples: list[dict[str, object]] = []
    for date, raw_day in minutes.groupby("tradeDate", sort=True):
        year = str(date)[:4]
        if year not in {"2022", "2023", "2024", "2025"}:
            continue
        day = add_causal_features(raw_day)
        last = {"positive": -MIN_COOLDOWN_MINUTES, "reverse": -MIN_COOLDOWN_MINUTES}
        for index in range(5, len(day) - 1):
            minute = int(day.iloc[index]["minuteOfDay"])
            if minute < 9 * 60 + 33 or minute >= 14 * 60 + 30:
                continue
            for direction in ("positive", "reverse"):
                if index - last[direction] < MIN_COOLDOWN_MINUTES:
                    continue
                if not anchor_candidate(day.iloc[index], day.iloc[index - 1], direction):
                    continue
                outcome = evaluate_outcome(day, index, direction)
                if outcome is None:
                    continue
                last[direction] = index
                samples.append({
                    "date": str(date),
                    "year": year,
                    "minute": minute,
                    "direction": direction,
                    "regime": classify_regime(day.iloc[index], direction),
                    "netPct": outcome.net_pct,
                    "won": outcome.won,
                    "targetTouched": outcome.target_touched,
                    "holdMinutes": outcome.hold_minutes,
                })
    return pd.DataFrame(samples)


def independent_rows(rows: pd.DataFrame) -> pd.DataFrame:
    if rows.empty:
        return rows
    kept: list[int] = []
    for _, day in rows.sort_values(["date", "minute"]).groupby("date", sort=True):
        kept.extend(day.head(MAX_TRADES_PER_DAY).index.tolist())
    return rows.loc[kept].sort_values(["date", "minute"])


def summarize(rows: pd.DataFrame) -> dict[str, object]:
    chosen = independent_rows(rows)
    if chosen.empty:
        return {"trades": 0, "wins": 0, "winRate": None, "averageNetPct": 0,
                "totalNetPct": 0, "targetRate": None, "averageHoldMinutes": 0}
    return {
        "trades": int(len(chosen)),
        "wins": int(chosen["won"].sum()),
        "winRate": round(float(chosen["won"].mean()), 4),
        "averageNetPct": round(float(chosen["netPct"].mean()), 4),
        "totalNetPct": round(float(chosen["netPct"].sum()), 4),
        "targetRate": round(float(chosen["targetTouched"].mean()), 4),
        "averageHoldMinutes": round(float(chosen["holdMinutes"].mean()), 2),
    }


def evaluate_regimes(samples: pd.DataFrame) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for regime, label in REGIME_LABELS.items():
        rows = samples[samples["regime"] == regime]
        training = summarize(rows[rows["year"].isin(["2022", "2023", "2024"])])
        validation = summarize(rows[rows["year"] == "2025"])
        training_ok = (
            training["trades"] >= 80
            and (training["winRate"] or 0) >= 0.55
            and training["averageNetPct"] > 0
        )
        validation_ok = (
            training_ok
            and validation["trades"] >= 30
            and (validation["winRate"] or 0) >= 0.65
            and validation["averageNetPct"] > 0
        )
        blockers: list[str] = []
        if training["trades"] < 80:
            blockers.append("训练独立交易不足 80 笔")
        if (training["winRate"] or 0) < 0.55:
            blockers.append("训练胜率低于 55%")
        if training["averageNetPct"] <= 0:
            blockers.append("训练扣费后净期望不为正")
        if validation["trades"] < 30:
            blockers.append("2025 验证交易不足 30 笔")
        if (validation["winRate"] or 0) < 0.65:
            blockers.append("2025 验证胜率低于 65%")
        if validation["averageNetPct"] <= 0:
            blockers.append("2025 验证扣费后净期望不为正")
        results.append({
            "id": regime,
            "label": label,
            "training": training,
            "validation": validation,
            "passedTrainingGate": training_ok,
            "passedValidationGate": validation_ok,
            "blockers": blockers,
        })
    results.sort(key=lambda item: (
        item["passedValidationGate"],
        item["validation"]["averageNetPct"],
        item["validation"]["winRate"] or 0,
        item["validation"]["trades"],
    ), reverse=True)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="紫金矿业第二轮行情分型因果审计")
    parser.add_argument("input", type=Path)
    parser.add_argument(
        "--external-readiness",
        type=Path,
        default=Path("public/research/zijin-external-factor-readiness.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/research/zijin-round2-regime-audit.json"),
    )
    args = parser.parse_args()
    started = time.time()
    minutes = load_minutes(args.input.resolve())
    samples = build_samples(minutes)
    regimes = evaluate_regimes(samples)
    readiness = json.loads(args.external_readiness.read_text(encoding="utf-8"))
    ready = int(readiness["coverage"]["externalSourcesReady"])
    required = int(readiness["coverage"]["externalSourcesRequired"])
    passed = [item for item in regimes if item["passedValidationGate"]]
    output = {
        "schemaVersion": 1,
        "stage": 4,
        "stock": {"code": "601899", "name": "紫金矿业"},
        "mode": "research-only",
        "affectsV4": False,
        "status": "ready-for-external-training" if passed and ready == required else "blocked",
        "dataset": {
            "firstDate": str(minutes["tradeDate"].min()),
            "lastDateUsed": str(minutes["tradeDate"].max()),
            "blindSet": "2026 封存，未用于本轮分型与排序",
            "minuteRowsLoaded": int(len(minutes)),
            "causalCandidates": int(len(samples)),
        },
        "methodology": {
            "training": "2022-2024",
            "validation": "2025",
            "blindTest": "2026 sealed",
            "selectionUsesBlindTest": False,
            "earliestFill": "下一分钟开盘价",
            "futureUse": "仅作为收益标签",
            "roundTripCostPct": ROUND_TRIP_COST_PCT,
            "netProfitZonePct": [MIN_NET_TARGET_PCT, MAX_NET_TARGET_PCT],
            "targetValidationWinRate": 0.65,
        },
        "externalReadiness": {
            "ready": ready,
            "required": required,
            "trainingReady": ready == required,
        },
        "regimes": regimes,
        "qualifiedRegimes": len(passed),
        "conclusion": {
            "message": (
                "内部分型与全部外部因子均已通过，可启动新一轮外部因子训练。"
                if passed and ready == required
                else "内部行情已分型，但没有场景同时通过训练和 2025 样本外门槛；外部因子未齐前不重复消耗 2026 盲测。"
            ),
            "nextAction": "补齐金价、铜价、指数、港股紫金与事件时钟，按分型分别训练；不修改 Smart-T V4。",
        },
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": output["status"],
        "dataset": output["dataset"],
        "qualifiedRegimes": output["qualifiedRegimes"],
        "topRegimes": regimes[:3],
        "elapsedSeconds": output["elapsedSeconds"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
