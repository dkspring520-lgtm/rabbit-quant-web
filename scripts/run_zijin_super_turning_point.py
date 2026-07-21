#!/usr/bin/env python3
"""Audit causal 'super turning point' signals with longer intraday holds.

The signal at minute t may only use rows at or before t.  The earliest fill is
the next minute open.  Full-day highs/lows are computed after signal generation
and are diagnostics only; they are never available to the signal function.
Smart-T V4 is not read or modified by this research runner.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import pandas as pd


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CORE_PATH = HERE / "discover-zijin-patterns.py"
PROTOCOL_PATH = HERE / "zijin-super-turning-point-protocol.json"


def import_core():
    spec = importlib.util.spec_from_file_location("zijin_super_point_core", CORE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {CORE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


core = import_core()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def protocol_sha256(protocol: dict[str, Any]) -> str:
    body = json.dumps(protocol, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def load_target(path: Path, maximum_date: str) -> pd.DataFrame:
    con = duckdb.connect()
    frame = con.execute(
        """
        SELECT CAST(trade_date AS VARCHAR) AS tradeDate,
               CAST(trade_time AS VARCHAR) AS tradeTime,
               open, high, low, close, vol AS volume, amount,
               pre_close AS previousClose
        FROM read_parquet(?)
        WHERE regexp_replace(CAST(code AS VARCHAR), '[^0-9]', '', 'g') = '601899'
          AND CAST(trade_date AS VARCHAR) <= ?
        ORDER BY trade_date, trade_time
        """,
        [str(path.resolve()), maximum_date.replace("-", "")],
    ).fetch_df()
    con.close()
    numeric = ["open", "high", "low", "close", "volume", "amount", "previousClose"]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["open", "high", "low", "close"])
    return frame[(frame[["open", "high", "low", "close"]] > 0).all(axis=1)].copy()


def signal_score(row: pd.Series, previous_close: float, trailing_low: float,
                 trailing_high: float, direction: str) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    if direction == "positive":
        checks = [
            (row.vwapBiasPct <= -0.20, 20, "低于VWAP"),
            (row.intradayPosition <= 0.28, 15, "处于已知日内低位"),
            (row.drawdownFromHighPct <= -0.55, 10, "从已知高点明显回撤"),
            (row.return3Pct >= 0.06, 15, "三分钟动量转正"),
            (row.ma5SlopePct > 0, 15, "短均线转强"),
            (row.close > previous_close, 10, "本分钟继续确认"),
            (row.volumeRatio >= 0.70, 5, "量能未失真"),
            (((row.close / trailing_low) - 1) * 100 >= 0.12, 10, "离开已知低点"),
        ]
    else:
        checks = [
            (row.vwapBiasPct >= 0.20, 20, "高于VWAP"),
            (row.intradayPosition >= 0.72, 15, "处于已知日内高位"),
            (row.reboundFromLowPct >= 0.55, 10, "从已知低点明显反弹"),
            (row.return3Pct <= -0.06, 15, "三分钟动量转负"),
            (row.ma5SlopePct < 0, 15, "短均线转弱"),
            (row.close < previous_close, 10, "本分钟继续确认"),
            (row.volumeRatio >= 0.70, 5, "量能未失真"),
            (((trailing_high / row.close) - 1) * 100 >= 0.12, 10, "离开已知高点"),
        ]
    for passed, points, reason in checks:
        if bool(passed):
            score += points
            reasons.append(reason)
    return score, reasons


def build_signals(minutes: pd.DataFrame, protocol: dict[str, Any]) -> pd.DataFrame:
    policy = protocol["signalPolicy"]
    earliest = core.minute_number(policy["earliestMinute"])
    latest = core.minute_number(policy["latestMinute"])
    window = int(policy["trailingExtremeWindowMinutes"])
    minimum_score = int(policy["minimumScore"])
    minimum_range = float(policy["minimumObservedRangePct"])
    cooldown = int(policy["minimumSignalCooldownMinutes"])
    signals: list[dict[str, Any]] = []

    for date, raw in minutes.groupby("tradeDate", sort=True):
        day = core.add_causal_features(raw.sort_values("tradeTime"))
        if len(day) < 180:
            continue
        lows = day["low"].shift(1).rolling(window, min_periods=5).min()
        highs = day["high"].shift(1).rolling(window, min_periods=5).max()
        emitted = {"positive": 0, "reverse": 0}
        last_index = {"positive": -cooldown, "reverse": -cooldown}
        for index in range(5, len(day) - 121):
            row = day.iloc[index]
            minute = int(row.minuteOfDay)
            if minute < earliest or minute > latest or float(row.rangePct) < minimum_range:
                continue
            if not np.isfinite(lows.iloc[index]) or not np.isfinite(highs.iloc[index]):
                continue
            for direction in ("positive", "reverse"):
                if emitted[direction] >= 1 or index - last_index[direction] < cooldown:
                    continue
                score, reasons = signal_score(
                    row, float(day.iloc[index - 1].close),
                    float(lows.iloc[index]), float(highs.iloc[index]), direction,
                )
                if score < minimum_score:
                    continue
                signals.append({
                    "date": str(date), "year": str(date)[:4], "signalIndex": index,
                    "signalTime": str(row.tradeTime), "direction": direction,
                    "score": score, "reasons": reasons,
                    "signalPrice": float(row.close), "vwapBiasPct": float(row.vwapBiasPct),
                    "volumeRatio": float(row.volumeRatio), "rangePct": float(row.rangePct),
                })
                emitted[direction] += 1
                last_index[direction] = index
    return pd.DataFrame(signals)


def evaluate_signals(minutes: pd.DataFrame, signals: pd.DataFrame,
                     protocol: dict[str, Any]) -> pd.DataFrame:
    cost = float(protocol["outcomePolicy"]["roundTripCostPct"])
    horizons = [int(value) for value in protocol["outcomePolicy"]["fixedHoldingMinutes"]]
    outcomes: list[dict[str, Any]] = []
    days = {str(date): day.sort_values("tradeTime").reset_index(drop=True)
            for date, day in minutes.groupby("tradeDate", sort=True)}
    for signal in signals.itertuples(index=False):
        day = days[str(signal.date)]
        entry_index = int(signal.signalIndex) + 1
        entry = float(day.iloc[entry_index].open)
        actual_low = float(day.low.min())
        actual_high = float(day.high.max())
        extreme_distance = (
            ((entry / actual_low) - 1) * 100 if signal.direction == "positive"
            else ((actual_high / entry) - 1) * 100
        )
        for horizon in horizons:
            exit_index = entry_index + horizon
            if exit_index >= len(day):
                continue
            future = day.iloc[entry_index: exit_index + 1]
            exit_price = float(day.iloc[exit_index].close)
            if signal.direction == "positive":
                gross = ((exit_price / entry) - 1) * 100
                mfe = ((float(future.high.max()) / entry) - 1) * 100
                mae = ((float(future.low.min()) / entry) - 1) * 100
            else:
                gross = ((entry / exit_price) - 1) * 100
                mfe = ((entry / float(future.low.min())) - 1) * 100
                mae = ((entry / float(future.high.max())) - 1) * 100
            outcomes.append({
                **signal._asdict(), "entryTime": str(day.iloc[entry_index].tradeTime),
                "entryPrice": entry, "horizonMinutes": horizon, "exitPrice": exit_price,
                "grossPct": gross, "netPct": gross - cost, "won": gross - cost > 0,
                "mfePct": mfe, "maePct": mae,
                "distanceFromActualDayExtremePct": extreme_distance,
                "within030PctOfActualDayExtreme": extreme_distance <= 0.30,
            })
    return pd.DataFrame(outcomes)


def summarize(rows: pd.DataFrame) -> dict[str, Any]:
    if rows.empty:
        return {"signals": 0, "wins": 0, "winRate": None, "averageNetPct": 0.0,
                "medianNetPct": 0.0, "averageMfePct": 0.0, "averageMaePct": 0.0,
                "nearActualExtremeRate": None}
    return {
        "signals": int(len(rows)), "wins": int(rows.won.sum()),
        "winRate": round(float(rows.won.mean()), 4),
        "averageNetPct": round(float(rows.netPct.mean()), 4),
        "medianNetPct": round(float(rows.netPct.median()), 4),
        "averageMfePct": round(float(rows.mfePct.mean()), 4),
        "averageMaePct": round(float(rows.maePct.mean()), 4),
        "nearActualExtremeRate": round(float(rows.within030PctOfActualDayExtreme.mean()), 4),
        "averageExtremeDistancePct": round(float(rows.distanceFromActualDayExtremePct.mean()), 4),
    }


def grouped_report(outcomes: pd.DataFrame, start: str, end: str,
                   horizons: list[int]) -> dict[str, Any]:
    """Build a stable report even when the preregistered policy emits no signals."""
    if outcomes.empty or "date" not in outcomes.columns:
        rows = pd.DataFrame()
    else:
        rows = outcomes[(outcomes["date"] >= start) & (outcomes["date"] <= end)]

    def horizon_summary(source: pd.DataFrame, horizon: int) -> dict[str, Any]:
        if source.empty or "horizonMinutes" not in source.columns:
            return summarize(pd.DataFrame())
        return summarize(source[source["horizonMinutes"] == horizon])

    return {
        "combined": {str(h): horizon_summary(rows, h) for h in horizons},
        "byDirection": {
            direction: {
                str(h): horizon_summary(
                    rows[rows["direction"] == direction]
                    if not rows.empty and "direction" in rows.columns else pd.DataFrame(),
                    h,
                )
                for h in horizons
            }
            for direction in ("positive", "reverse")
        },
    }


def append_ledger(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    previous_hash = "0" * 64
    if path.exists():
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if lines:
            previous_hash = json.loads(lines[-1])["recordHash"]
    body = {**record, "previousHash": previous_hash}
    encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    body["recordHash"] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(body, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit causal Zijin super turning points")
    parser.add_argument("input", type=Path)
    parser.add_argument("--protocol", type=Path, default=PROTOCOL_PATH)
    parser.add_argument("--report", type=Path, default=ROOT / "public/research/zijin-super-turning-point-report.json")
    parser.add_argument("--progress", type=Path, default=ROOT / "public/research/zijin-super-turning-point-progress.json")
    parser.add_argument("--ledger", type=Path, default=ROOT / ".training-state/zijin-super-turning-point-ledger.jsonl")
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text(encoding="utf-8"))
    atomic_json(args.progress, {"status": "running", "progress": 5, "stage": "loading", "message": "读取封存到2025年的紫金分钟数据"})
    minutes = load_target(args.input, protocol["dataPolicy"]["maximumLoadedDate"])
    if minutes.empty or str(minutes.tradeDate.max()) > "20251231":
        raise RuntimeError("sealed 2026 policy violated")
    atomic_json(args.progress, {"status": "running", "progress": 35, "stage": "signals", "message": "逐分钟生成实时可确认超级拐点"})
    signals = build_signals(minutes, protocol)
    atomic_json(args.progress, {"status": "running", "progress": 70, "stage": "outcomes", "message": "比较60、90、120分钟费用后结果", "signals": int(len(signals))})
    outcomes = evaluate_signals(minutes, signals, protocol)
    horizons = [int(value) for value in protocol["outcomePolicy"]["fixedHoldingMinutes"]]
    report = {
        "schemaVersion": 1, "experimentId": protocol["experimentId"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "researchOnly": True, "affectsSmartTV4": False,
        "causalityAudit": {
            "signalUsesFutureBars": False, "fill": "next-minute-open",
            "actualDailyHighLowUsedAsInput": False,
            "actualDailyHighLowUsedForOutcomeDiagnostics": True,
            "loadedMaximumDate": str(minutes.tradeDate.max()),
        },
        "dataAudit": {
            "firstDate": str(minutes.tradeDate.min()), "lastDate": str(minutes.tradeDate.max()),
            "tradingDays": int(minutes.tradeDate.nunique()), "minuteRows": int(len(minutes)),
            "inputSha256": file_sha256(args.input), "protocolSha256": protocol_sha256(protocol),
        },
        "signalCount": int(len(signals)),
        "development2022To2024": grouped_report(outcomes, "20220101", "20241231", horizons),
        "validation2025": grouped_report(outcomes, "20250101", "20251231", horizons),
        "decision": "research-only; do not promote or modify V4",
    }
    atomic_json(args.report, report)
    append_ledger(args.ledger, {
        "experimentId": protocol["experimentId"], "generatedAt": report["generatedAt"],
        "inputSha256": report["dataAudit"]["inputSha256"],
        "protocolSha256": report["dataAudit"]["protocolSha256"],
        "reportSha256": file_sha256(args.report),
    })
    atomic_json(args.progress, {"status": "completed", "progress": 100, "stage": "completed", "message": "因果超级拐点长持有实验完成", "signals": int(len(signals))})
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
