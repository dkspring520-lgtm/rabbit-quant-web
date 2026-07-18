#!/usr/bin/env python3
"""Causally train and audit the isolated Zijin Mining factor research model.

This script is deliberately separate from Smart-T V4. Thresholds are selected
only with 2022-2024 data, then frozen for 2025 validation and 2026 blind audit.
Every signal uses information available at that minute; the next minute's open
is the earliest permitted simulated fill.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

try:
    import duckdb
except ImportError as exc:  # pragma: no cover
    raise SystemExit("缺少 duckdb：请先运行 python -m pip install duckdb") from exc


ROUND_TRIP_COST_PCT = 0.12
MIN_NET_TARGET_PCT = 0.64
MAX_NET_TARGET_PCT = 1.00
TRAILING_RETRACE_PCT = 0.18
STOP_GROSS_PCT = 0.45
MAX_HOLD_MINUTES = 20
MIN_FEATURE_POINTS = 20
MAX_TRADES_PER_DAY = 2
QUICK_GRID = {
    "vwapBiasPct": (0.20, 0.30, 0.40, 0.50, 0.60),
    "turn3Pct": (0.03, 0.06, 0.09, 0.12),
    "volumeRatio": (0.80, 0.95, 1.10, 1.25),
}


def inclusive_range(start: float, stop: float, step: float) -> tuple[float, ...]:
    count = round((stop - start) / step)
    return tuple(round(start + index * step, 4) for index in range(count + 1))


FULL_GRID = {
    # 23 × 18 × 31 = 12,834 causal parameter combinations.
    "vwapBiasPct": inclusive_range(0.10, 1.20, 0.05),
    "turn3Pct": tuple(sorted(set(inclusive_range(0.00, 0.30, 0.02) + QUICK_GRID["turn3Pct"]))),
    "volumeRatio": inclusive_range(0.50, 2.00, 0.05),
}
SEARCH_GRIDS = {"quick": QUICK_GRID, "full": FULL_GRID}


def atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def progress_payload(
    run_id: str,
    status: str,
    stage: str,
    progress: int,
    processed: int = 0,
    total: int = 0,
    message: str = "",
    latest: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "stock": {"code": "601899", "name": "紫金矿业"},
        "runId": run_id,
        "status": status,
        "stage": stage,
        "progress": max(0, min(100, progress)),
        "processedCandidates": processed,
        "totalCandidates": total,
        "message": message,
        "latest": latest or {},
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


@dataclass(frozen=True)
class Bar:
    date: str
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float
    previous_close: float


@dataclass(frozen=True)
class Feature:
    index: int
    date: str
    time: str
    vwap_bias_pct: float
    momentum3_pct: float
    volume_ratio: float
    range_pct: float


def pct(value: float, base: float) -> float:
    return ((value - base) / base) * 100 if base > 0 else 0.0


def load_sessions(path: Path) -> dict[str, list[Bar]]:
    con = duckdb.connect()
    rows = con.execute(
        """
        SELECT trade_date, trade_time, open, high, low, close, vol, amount, pre_close
        FROM read_parquet(?)
        ORDER BY trade_date, trade_time
        """,
        [str(path)],
    ).fetchall()
    con.close()
    sessions: dict[str, list[Bar]] = defaultdict(list)
    for row in rows:
        values = [float(value or 0) for value in row[2:]]
        if min(values[0:4]) <= 0:
            continue
        sessions[str(row[0])].append(
            Bar(
                date=str(row[0]),
                time=str(row[1]),
                open=values[0],
                high=values[1],
                low=values[2],
                close=values[3],
                volume=max(0.0, values[4]),
                amount=max(0.0, values[5]),
                previous_close=max(0.0, values[6]),
            )
        )
    return dict(sessions)


def build_features(bars: list[Bar]) -> list[Feature]:
    features: list[Feature] = []
    cumulative_volume = 0.0
    cumulative_amount = 0.0
    running_high = -math.inf
    running_low = math.inf
    volumes: list[float] = []
    for index, bar in enumerate(bars):
        cumulative_volume += bar.volume
        cumulative_amount += bar.amount
        running_high = max(running_high, bar.high)
        running_low = min(running_low, bar.low)
        volumes.append(bar.volume)
        if index < MIN_FEATURE_POINTS - 1:
            continue
        vwap = cumulative_amount / cumulative_volume if cumulative_volume > 0 else bar.close
        recent = volumes[max(0, index - 2): index + 1]
        baseline = volumes[max(0, index - 22): max(0, index - 2)]
        volume_ratio = (
            (sum(recent) / len(recent)) / (sum(baseline) / len(baseline))
            if recent and baseline and sum(baseline) > 0
            else 0.0
        )
        previous_close = bar.previous_close or bars[0].previous_close or bars[0].open
        features.append(
            Feature(
                index=index,
                date=bar.date,
                time=bar.time,
                vwap_bias_pct=pct(bar.close, vwap),
                momentum3_pct=pct(bar.close, bars[index - 3].close),
                volume_ratio=volume_ratio,
                range_pct=((running_high - running_low) / previous_close) * 100 if previous_close > 0 else 0.0,
            )
        )
    return features


def signal_direction(feature: Feature, config: dict[str, float]) -> str | None:
    enough_range = feature.range_pct >= max(0.55, config["vwapBiasPct"] * 1.8)
    enough_volume = feature.volume_ratio >= config["volumeRatio"]
    if not enough_range or not enough_volume:
        return None
    if (
        feature.vwap_bias_pct <= -config["vwapBiasPct"]
        and feature.momentum3_pct >= config["turn3Pct"]
    ):
        return "positive"
    if (
        feature.vwap_bias_pct >= config["vwapBiasPct"]
        and feature.momentum3_pct <= -config["turn3Pct"]
    ):
        return "reverse"
    return None


def simulate_trade(bars: list[Bar], signal_index: int, direction: str) -> dict[str, object] | None:
    entry_index = signal_index + 1
    if entry_index >= len(bars):
        return None
    entry = bars[entry_index].open
    if entry <= 0:
        return None

    target_gross = MIN_NET_TARGET_PCT + ROUND_TRIP_COST_PCT
    cap_gross = MAX_NET_TARGET_PCT + ROUND_TRIP_COST_PCT
    peak_gross = -math.inf
    trailing = False
    exit_index = min(len(bars) - 1, entry_index + MAX_HOLD_MINUTES)
    exit_reason = "time"
    gross_return = 0.0

    for index in range(entry_index, exit_index + 1):
        bar = bars[index]
        if direction == "positive":
            adverse = pct(bar.low, entry)
            favorable = pct(bar.high, entry)
            close_return = pct(bar.close, entry)
        else:
            adverse = -pct(bar.high, entry)
            favorable = -pct(bar.low, entry)
            close_return = -pct(bar.close, entry)

        # The path inside one one-minute candle is unknown. If stop and target
        # are both touched, the conservative rule assumes the stop happened first.
        if adverse <= -STOP_GROSS_PCT:
            gross_return = -STOP_GROSS_PCT
            exit_index = index
            exit_reason = "stop"
            break
        peak_gross = max(peak_gross, favorable)
        if peak_gross >= cap_gross:
            gross_return = cap_gross
            exit_index = index
            exit_reason = "max-target"
            break
        if peak_gross >= target_gross:
            trailing = True
        if trailing and close_return <= peak_gross - TRAILING_RETRACE_PCT:
            gross_return = close_return
            exit_index = index
            exit_reason = "trailing"
            break
        if index == exit_index:
            gross_return = close_return

    net_return = gross_return - ROUND_TRIP_COST_PCT
    return {
        "date": bars[signal_index].date,
        "signalTime": bars[signal_index].time,
        "entryTime": bars[entry_index].time,
        "exitTime": bars[exit_index].time,
        "direction": direction,
        "netPct": net_return,
        "won": net_return > 0,
        "holdMinutes": max(1, exit_index - entry_index + 1),
        "exitReason": exit_reason,
    }


def collect_trades(
    sessions: dict[str, list[Bar]],
    feature_map: dict[str, list[Feature]],
    config: dict[str, float],
    years: set[str],
) -> list[dict[str, object]]:
    trades: list[dict[str, object]] = []
    for date, bars in sessions.items():
        if date[:4] not in years:
            continue
        last_exit_index = -1
        daily_count = 0
        for feature in feature_map[date]:
            if feature.index <= last_exit_index or daily_count >= MAX_TRADES_PER_DAY:
                continue
            if feature.time >= "14:30:00":
                continue
            direction = signal_direction(feature, config)
            if not direction:
                continue
            trade = simulate_trade(bars, feature.index, direction)
            if not trade:
                continue
            trades.append(trade)
            last_exit_index = feature.index + int(trade["holdMinutes"])
            daily_count += 1
    return trades


def summarize(trades: list[dict[str, object]]) -> dict[str, object]:
    if not trades:
        return {
            "trades": 0,
            "wins": 0,
            "losses": 0,
            "winRate": None,
            "averageNetPct": 0.0,
            "totalNetPct": 0.0,
            "maxDrawdownPct": 0.0,
            "positiveTrades": 0,
            "reverseTrades": 0,
            "averageHoldMinutes": 0.0,
        }
    net_values = [float(trade["netPct"]) for trade in trades]
    wins = sum(1 for value in net_values if value > 0)
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for value in net_values:
        equity += value
        peak = max(peak, equity)
        max_drawdown = max(max_drawdown, peak - equity)
    return {
        "trades": len(trades),
        "wins": wins,
        "losses": len(trades) - wins,
        "winRate": round(wins / len(trades), 4),
        "averageNetPct": round(sum(net_values) / len(net_values), 4),
        "totalNetPct": round(sum(net_values), 4),
        "maxDrawdownPct": round(max_drawdown, 4),
        "positiveTrades": sum(1 for trade in trades if trade["direction"] == "positive"),
        "reverseTrades": sum(1 for trade in trades if trade["direction"] == "reverse"),
        "averageHoldMinutes": round(sum(int(trade["holdMinutes"]) for trade in trades) / len(trades), 2),
    }


def selection_score(summary: dict[str, object], annual: list[dict[str, object]]) -> float:
    if int(summary["trades"]) < 90:
        return -math.inf
    if any(int(item["trades"]) < 20 for item in annual):
        return -math.inf
    weakest_win_rate = min(float(item["winRate"] or 0) for item in annual)
    weakest_average = min(float(item["averageNetPct"]) for item in annual)
    return (
        float(summary["averageNetPct"]) * 2.2
        + float(summary["winRate"] or 0) * 0.8
        + weakest_win_rate * 0.45
        + weakest_average * 0.8
        - float(summary["maxDrawdownPct"]) / max(1, int(summary["trades"])) * 0.35
    )


def passes_training_gate(summary: dict[str, object], annual: list[dict[str, object]]) -> bool:
    """Only a positive, cross-year-stable training candidate may see 2025 data."""
    return (
        int(summary["trades"]) >= 90
        and float(summary["averageNetPct"]) > 0
        and float(summary["winRate"] or 0) >= 0.55
        and all(
            int(item["trades"]) >= 20
            and float(item["averageNetPct"]) > 0
            and float(item["winRate"] or 0) >= 0.50
            for item in annual
        )
    )


def passes_validation_gate(summary: dict[str, object]) -> bool:
    """Keep 2026 blind data sealed unless the untouched 2025 sample passes."""
    return (
        int(summary["trades"]) >= 30
        and float(summary["averageNetPct"]) > 0
        and float(summary["winRate"] or 0) >= 0.55
    )


def annual_summaries(
    trades: list[dict[str, object]], years: set[str]
) -> list[dict[str, object]]:
    """Reuse the causal training pass instead of simulating each year again."""
    return [
        {
            "year": year,
            **summarize([trade for trade in trades if str(trade["date"]).startswith(year)]),
        }
        for year in sorted(years)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="紫金矿业独立因子研究：训练/验证/盲测")
    parser.add_argument("input", type=Path, help="紫金矿业 1 分钟 Parquet")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/research/zijin-factor-evidence.json"),
        help="仅包含研究证据的公开 JSON，不含原始行情",
    )
    parser.add_argument(
        "--progress",
        type=Path,
        default=Path("public/research/zijin-training-progress.json"),
        help="训练过程状态 JSON；网站只读取真实进度，不推算动画进度",
    )
    parser.add_argument(
        "--search-profile",
        choices=sorted(SEARCH_GRIDS),
        default="quick",
        help="quick=80 组回归检查；full=12,834 组全量阈值搜索",
    )
    args = parser.parse_args()

    started = time.time()
    run_id = time.strftime("zijin-%Y%m%d-%H%M%S")
    progress_path = args.progress.resolve()
    atomic_write_json(progress_path, progress_payload(
        run_id, "running", "loading", 2,
        message="正在读取紫金矿业历史一分钟数据",
    ))
    sessions = load_sessions(args.input.resolve())
    atomic_write_json(progress_path, progress_payload(
        run_id, "running", "features", 8,
        message=f"已载入 {len(sessions)} 个完整交易日，正在构建因果特征",
        latest={"tradingDays": len(sessions)},
    ))
    feature_map = {date: build_features(bars) for date, bars in sessions.items()}
    train_years = {"2022", "2023", "2024"}
    validation_years = {"2025"}
    blind_years = {"2026"}

    grid = SEARCH_GRIDS[args.search_profile]
    leaderboard: list[tuple[float, dict[str, float], dict[str, object]]] = []
    qualified_leaderboard: list[tuple[float, dict[str, float], dict[str, object]]] = []
    combinations = list(itertools.product(
        grid["vwapBiasPct"], grid["turn3Pct"], grid["volumeRatio"]
    ))
    progress_interval = max(1, len(combinations) // 200)
    for candidate_index, (bias, turn, volume) in enumerate(combinations, start=1):
        config = {"vwapBiasPct": bias, "turn3Pct": turn, "volumeRatio": volume}
        train_trades = collect_trades(sessions, feature_map, config, train_years)
        train_summary = summarize(train_trades)
        annual = annual_summaries(train_trades, train_years)
        score = selection_score(train_summary, annual)
        if math.isfinite(score):
            candidate = (score, config, {**train_summary, "annual": annual})
            leaderboard.append(candidate)
            if passes_training_gate(train_summary, annual):
                qualified_leaderboard.append(candidate)
        if (
            candidate_index == 1
            or candidate_index % progress_interval == 0
            or candidate_index == len(combinations)
        ):
            best_summary = max(leaderboard, key=lambda item: item[0])[2] if leaderboard else train_summary
            elapsed = max(0.001, time.time() - started)
            estimated_remaining = round(
                max(0.0, elapsed / candidate_index * (len(combinations) - candidate_index)), 1
            )
            atomic_write_json(progress_path, progress_payload(
                run_id, "running", "training", 10 + round(candidate_index / len(combinations) * 66),
                processed=candidate_index,
                total=len(combinations),
                message=f"训练兔正在评估参数组合 {candidate_index}/{len(combinations)}",
                latest={
                    "trainingTrades": int(best_summary["trades"]),
                    "trainingWinRate": best_summary["winRate"],
                    "trainingAverageNetPct": best_summary["averageNetPct"],
                    "searchProfile": args.search_profile,
                    "estimatedRemainingSeconds": estimated_remaining,
                },
            ))

    if not leaderboard:
        raise SystemExit("训练集未找到满足最低样本量的候选")
    leaderboard.sort(key=lambda item: item[0], reverse=True)
    qualified_leaderboard.sort(key=lambda item: item[0], reverse=True)
    score, selected, training = (
        qualified_leaderboard[0] if qualified_leaderboard else leaderboard[0]
    )
    passed_training_gate = passes_training_gate(training, training["annual"])
    validation_ran = False
    blind_ran = False
    validation = summarize([])
    blind = summarize([])
    passed_validation_gate = False

    if passed_training_gate:
        atomic_write_json(progress_path, progress_payload(
            run_id, "running", "validation", 82,
            processed=len(combinations), total=len(combinations),
            message="挑战兔正在使用未参与选参的 2025 年样本验证",
            latest={
                "trainingTrades": int(training["trades"]),
                "trainingWinRate": training["winRate"],
                "trainingAverageNetPct": training["averageNetPct"],
                "qualifiedCandidates": len(qualified_leaderboard),
                "validationRan": False,
                "blindRan": False,
            },
        ))
        validation = summarize(collect_trades(sessions, feature_map, selected, validation_years))
        validation_ran = True
        passed_validation_gate = passes_validation_gate(validation)

        if passed_validation_gate:
            atomic_write_json(progress_path, progress_payload(
                run_id, "running", "blind-test", 92,
                processed=len(combinations), total=len(combinations),
                message="风控兔正在读取从未参与训练与选参的 2026 年盲测样本",
                latest={
                    "trainingWinRate": training["winRate"],
                    "trainingAverageNetPct": training["averageNetPct"],
                    "validationTrades": int(validation["trades"]),
                    "validationWinRate": validation["winRate"],
                    "validationAverageNetPct": validation["averageNetPct"],
                    "qualifiedCandidates": len(qualified_leaderboard),
                    "validationRan": True,
                    "blindRan": False,
                },
            ))
            blind = summarize(collect_trades(sessions, feature_map, selected, blind_years))
            blind_ran = True

    dates = sorted(sessions)
    evidence = {
        "schemaVersion": 1,
        "stock": {"code": "601899", "marketCode": "601899.SH", "name": "紫金矿业"},
        "mode": "research-only",
        "affectsV4": False,
        "dataset": {
            "firstDate": dates[0],
            "lastDate": dates[-1],
            "tradingDays": len(dates),
            "minuteRows": sum(len(bars) for bars in sessions.values()),
            "completeDays": sum(1 for bars in sessions.values() if len(bars) == 241),
            "missingAfter": "2026-04-17",
        },
        "methodology": {
            "training": "2022-2024",
            "validation": "2025",
            "blindTest": "2026-01-05..2026-04-17",
            "causal": True,
            "earliestFill": "下一分钟开盘价",
            "sameBarConflict": "止损优先（保守）",
            "roundTripCostPct": ROUND_TRIP_COST_PCT,
            "netProfitZonePct": [MIN_NET_TARGET_PCT, MAX_NET_TARGET_PCT],
            "trailingRetracePct": TRAILING_RETRACE_PCT,
            "stopGrossPct": STOP_GROSS_PCT,
            "maxHoldMinutes": MAX_HOLD_MINUTES,
            "maxTradesPerDay": MAX_TRADES_PER_DAY,
            "searchProfile": args.search_profile,
            "candidateCount": len(combinations),
            "searchGrid": {key: list(values) for key, values in grid.items()},
        },
        "selectedModel": {
            "selectedOn": "training-only",
            "candidateRole": "qualified" if passed_training_gate else "audit-only",
            "qualifiedCandidates": len(qualified_leaderboard),
            "vwapBiasPct": selected["vwapBiasPct"],
            "turn3Pct": selected["turn3Pct"],
            "volumeRatio": selected["volumeRatio"],
            "trainingScore": round(score, 6),
            "passedTrainingGate": passed_training_gate,
            "passedValidationGate": passed_validation_gate,
            "status": (
                "已完成2026盲测，等待人工评审"
                if blind_ran
                else "2025验证未通过，2026保持封存"
                if validation_ran
                else "训练门槛未通过，2025与2026保持封存"
            ),
        },
        "results": {
            "training": training,
            "validation": validation,
            "blindTest": blind,
        },
        "fourRabbits": {
            "trainingRabbit": "仅使用 2022-2024 网格寻找候选阈值",
            "challengeRabbit": "仅在训练门槛通过后，使用未参与选参的 2025 样本外验证",
            "formalRabbit": "通过训练与验证门槛后仍需人工评审；当前未进入正式 V4",
            "riskRabbit": "仅在2025验证通过后开启2026盲测；费用、止损、回撤与同K冲突保守处理",
        },
        "topTrainingCandidates": [
            {
                "vwapBiasPct": config["vwapBiasPct"],
                "turn3Pct": config["turn3Pct"],
                "volumeRatio": config["volumeRatio"],
                "score": round(candidate_score, 6),
                "trades": int(candidate_summary["trades"]),
                "winRate": candidate_summary["winRate"],
                "averageNetPct": candidate_summary["averageNetPct"],
            }
            for candidate_score, config, candidate_summary in leaderboard[:5]
        ],
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    atomic_write_json(args.output, evidence)
    atomic_write_json(progress_path, progress_payload(
        run_id, "completed", "completed", 100,
        processed=len(combinations), total=len(combinations),
        message=(
            "训练、样本外验证与最终盲测已按门禁完成"
            if blind_ran
            else "训练已完成；2025验证未通过，2026盲测保持封存"
            if validation_ran
            else "训练已完成；无合格候选，2025与2026样本保持封存"
        ),
        latest={
            "trainingTrades": int(training["trades"]),
            "trainingWinRate": training["winRate"],
            "trainingAverageNetPct": training["averageNetPct"],
            "validationTrades": int(validation["trades"]),
            "validationWinRate": validation["winRate"],
            "validationAverageNetPct": validation["averageNetPct"],
            "blindTrades": int(blind["trades"]),
            "blindWinRate": blind["winRate"],
            "blindAverageNetPct": blind["averageNetPct"],
            "passedTrainingGate": passed_training_gate,
            "passedValidationGate": passed_validation_gate,
            "qualifiedCandidates": len(qualified_leaderboard),
            "validationRan": validation_ran,
            "blindRan": blind_ran,
            "nextAction": (
                "等待人工评审"
                if blind_ran
                else "补充真实外部因子后开启新一轮训练；不重复消耗封存样本"
            ),
            "elapsedSeconds": evidence["elapsedSeconds"],
        },
    ))
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
