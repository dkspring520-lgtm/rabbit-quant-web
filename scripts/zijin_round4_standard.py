#!/usr/bin/env python3
"""Preregistered experiment controls for the Zijin single-stock laboratory.

This module deliberately does not search for a passing configuration. It
validates preregistered trials, writes an append-only ledger, estimates PBO and
Deflated Sharpe, and applies the frozen promotion gates.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import os
import statistics
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist
from typing import Any, Iterable, Sequence


ROOT = Path(__file__).resolve().parent
DEFAULT_PROTOCOL = ROOT / "zijin-round4-protocol.json"
NORMAL = NormalDist()
GENESIS_HASH = "0" * 64


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_protocol(path: Path = DEFAULT_PROTOCOL) -> dict[str, Any]:
    protocol = load_json(path)
    validate_protocol(protocol)
    return protocol


def validate_protocol(protocol: dict[str, Any]) -> None:
    round_number = int(protocol.get("round", 0) or 0)
    if round_number < 4 or protocol.get("status") != "preregistered":
        raise ValueError("research rounds must use a frozen preregistered protocol")
    if protocol.get("affectsV4") or protocol.get("automaticPromotion"):
        raise ValueError("research cannot mutate or automatically promote V4")
    if protocol["dataPolicy"]["selectionEnd"] > "2025-12-31":
        raise ValueError("2026 must remain sealed during feature and parameter selection")
    hypotheses = protocol.get("hypotheses", [])
    expected_count = int(protocol.get("independentHypothesisCount", 4 if round_number == 4 else 0) or 0)
    if expected_count < 1 or len(hypotheses) != expected_count:
        raise ValueError(f"exactly {expected_count} independent hypotheses are required")
    for hypothesis in hypotheses:
        count = len(hypothesis.get("features", []))
        if not 8 <= count <= 12:
            raise ValueError(f"{hypothesis.get('id')} must use 8-12 factors, got {count}")
        grid = hypothesis.get("parameterGrid")
        if not isinstance(grid, dict) or not grid or any(not isinstance(values, list) or not values for values in grid.values()):
            raise ValueError(f"{hypothesis.get('id')} must freeze a non-empty parameter grid")


def normalized_date(value: Any) -> str:
    digits = "".join(character for character in str(value) if character.isdigit())
    if len(digits) != 8:
        raise ValueError(f"invalid YYYYMMDD date: {value}")
    return digits


def validate_selection_range(value: dict[str, Any], protocol: dict[str, Any]) -> None:
    start = normalized_date(value.get("start"))
    end = normalized_date(value.get("end"))
    selection_end = normalized_date(protocol["dataPolicy"]["selectionEnd"])
    if start > end:
        raise ValueError("range start must not be later than range end")
    if end > selection_end:
        raise ValueError("2026 is sealed and cannot be used by a selection trial")


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def trial_config(trial: dict[str, Any]) -> dict[str, Any]:
    return {
        "hypothesisId": trial["hypothesisId"],
        "trainingRange": trial["trainingRange"],
        "validationRange": trial["validationRange"],
        "featureNames": trial["featureNames"],
        "parameters": trial["parameters"],
    }


def prepare_trial(trial: dict[str, Any], protocol: dict[str, Any]) -> dict[str, Any]:
    required = set(protocol["trialLedger"]["requiredFields"])
    generated = {"configHash", "createdAt"}
    missing = sorted(required - set(trial) - generated)
    if missing:
        raise ValueError(f"trial is missing required fields: {', '.join(missing)}")

    hypothesis_map = {item["id"]: item for item in protocol["hypotheses"]}
    hypothesis = hypothesis_map.get(trial.get("hypothesisId"))
    if hypothesis is None:
        raise ValueError("trial hypothesis is not preregistered")
    if trial.get("featureNames") != hypothesis["features"]:
        raise ValueError("trial factors differ from the preregistered hypothesis")
    validate_selection_range(trial["trainingRange"], protocol)
    validate_selection_range(trial["validationRange"], protocol)
    if normalized_date(trial["trainingRange"]["end"]) >= normalized_date(trial["validationRange"]["start"]):
        raise ValueError("validation must occur strictly after training")

    prepared = dict(trial)
    prepared["configHash"] = canonical_hash(trial_config(prepared))
    prepared.setdefault("createdAt", datetime.now(timezone.utc).isoformat())
    return prepared


def read_ledger(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    verify_ledger(rows)
    return rows


def ledger_record_hash(record: dict[str, Any]) -> str:
    payload = {key: value for key, value in record.items() if key != "recordHash"}
    return canonical_hash(payload)


def verify_ledger(rows: Sequence[dict[str, Any]]) -> str:
    """Verify the complete hash chain before any append.

    A changed or deleted historical line breaks the chain.  We intentionally
    refuse to repair it in place: corrections must be new append-only records.
    """
    previous = GENESIS_HASH
    seen_trial_ids: set[str] = set()
    for index, row in enumerate(rows, start=1):
        if row.get("previousRecordHash") != previous:
            raise ValueError(f"ledger hash chain is broken at line {index}")
        actual = ledger_record_hash(row)
        if row.get("recordHash") != actual:
            raise ValueError(f"ledger record hash mismatch at line {index}")
        trial_id = str(row.get("trialId", ""))
        if not trial_id or trial_id in seen_trial_ids:
            raise ValueError(f"duplicate or empty trialId at line {index}")
        seen_trial_ids.add(trial_id)
        previous = actual
    return previous


def append_trial(path: Path, trial: dict[str, Any], protocol: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_trial(trial, protocol)
    existing = read_ledger(path)
    if any(row.get("trialId") == prepared["trialId"] for row in existing):
        raise ValueError(f"duplicate trialId: {prepared['trialId']}")
    prepared["protocolHash"] = canonical_hash(protocol)
    prepared["previousRecordHash"] = existing[-1]["recordHash"] if existing else GENESIS_HASH
    prepared["recordHash"] = ledger_record_hash(prepared)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(prepared, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return prepared


def open_final_blind_once(
    state_path: Path,
    report: dict[str, Any],
    protocol: dict[str, Any],
) -> dict[str, Any]:
    """Create the one-shot 2026 seal only after every frozen gate passed."""
    if state_path.exists():
        raise ValueError("2026 final blind has already been opened once")
    evaluation = evaluate_promotion(report, protocol)
    if not evaluation["passedRollingOutOfSample"]:
        raise ValueError("rolling out-of-sample gates failed; 2026 remains sealed")
    state = {
        "experimentId": protocol["experimentId"],
        "protocolHash": canonical_hash(protocol),
        "rollingReportHash": canonical_hash(report),
        "openedAt": datetime.now(timezone.utc).isoformat(),
        "status": "opened-once",
    }
    state_path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation is the operating-system guard against a second open.
    with state_path.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(state, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return state


def _mean(values: Sequence[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def _population_standard_deviation(values: Sequence[float]) -> float:
    return statistics.pstdev(values) if len(values) > 1 else 0.0


def annualized_sharpe(returns: Sequence[float], periods: int = 252) -> float:
    deviation = _population_standard_deviation(returns)
    return (_mean(returns) / deviation) * math.sqrt(periods) if deviation > 0 else 0.0


def probability_of_backtest_overfitting(
    trial_period_returns: Sequence[Sequence[float]],
    partitions: int = 8,
) -> dict[str, Any]:
    """Estimate PBO with combinatorially symmetric cross-validation.

    Rows are trials and columns are ordered, non-overlapping OOS subperiods.
    """
    matrix = [list(map(float, row)) for row in trial_period_returns]
    if len(matrix) < 2:
        raise ValueError("PBO requires at least two recorded trials")
    period_count = len(matrix[0])
    if any(len(row) != period_count for row in matrix):
        raise ValueError("all PBO trial rows must have the same number of periods")
    if partitions < 4 or partitions % 2 or period_count < partitions:
        raise ValueError("PBO requires an even partition count and enough periods")

    blocks: list[list[int]] = [[] for _ in range(partitions)]
    for index in range(period_count):
        blocks[min(partitions - 1, index * partitions // period_count)].append(index)
    lambdas: list[float] = []
    half = partitions // 2
    all_blocks = set(range(partitions))
    for in_sample_blocks in itertools.combinations(range(partitions), half):
        in_indices = [index for block in in_sample_blocks for index in blocks[block]]
        out_indices = [index for block in sorted(all_blocks - set(in_sample_blocks)) for index in blocks[block]]
        in_scores = [_mean([row[index] for index in in_indices]) for row in matrix]
        winner = max(range(len(matrix)), key=lambda index: in_scores[index])
        out_scores = [_mean([row[index] for index in out_indices]) for row in matrix]
        ordered = sorted(range(len(matrix)), key=lambda index: out_scores[index])
        rank = ordered.index(winner) + 1
        percentile = (rank - 0.5) / len(matrix)
        lambdas.append(math.log(percentile / (1.0 - percentile)))
    return {
        "method": "CSCV",
        "partitions": partitions,
        "combinations": len(lambdas),
        "pbo": sum(value <= 0 for value in lambdas) / len(lambdas),
        "medianLogit": statistics.median(lambdas),
    }


def _skewness(values: Sequence[float]) -> float:
    mean = _mean(values)
    deviation = _population_standard_deviation(values)
    return _mean([((value - mean) / deviation) ** 3 for value in values]) if deviation > 0 else 0.0


def _kurtosis(values: Sequence[float]) -> float:
    mean = _mean(values)
    deviation = _population_standard_deviation(values)
    return _mean([((value - mean) / deviation) ** 4 for value in values]) if deviation > 0 else 3.0


def deflated_sharpe_probability(
    selected_returns: Sequence[float],
    all_trial_sharpes: Sequence[float],
    periods: int = 252,
) -> dict[str, float]:
    if len(selected_returns) < 3 or len(all_trial_sharpes) < 2:
        raise ValueError("Deflated Sharpe requires one return series and at least two recorded trials")
    observed = annualized_sharpe(selected_returns, periods)
    trials = len(all_trial_sharpes)
    sharpe_deviation = _population_standard_deviation(all_trial_sharpes)
    euler_gamma = 0.5772156649015329
    expected_maximum = sharpe_deviation * (
        (1.0 - euler_gamma) * NORMAL.inv_cdf(1.0 - 1.0 / trials)
        + euler_gamma * NORMAL.inv_cdf(1.0 - 1.0 / (trials * math.e))
    )
    skew = _skewness(selected_returns)
    kurtosis = _kurtosis(selected_returns)
    denominator = max(1e-12, 1.0 - skew * observed + ((kurtosis - 1.0) / 4.0) * observed * observed)
    test_statistic = (observed - expected_maximum) * math.sqrt(len(selected_returns) - 1) / math.sqrt(denominator)
    return {
        "observedSharpe": observed,
        "expectedMaximumSharpe": expected_maximum,
        "probability": NORMAL.cdf(test_statistic),
    }


def calculate_multiple_testing_controls(summary: dict[str, Any]) -> dict[str, Any]:
    """Calculate PBO and Deflated Sharpe from raw OOS return series.

    The evaluator intentionally ignores caller-supplied PBO/DSR headline
    values.  Promotion evidence must be reproducible from the complete trial
    matrix so a failed experiment cannot be made to pass by editing a summary.
    """
    trial_period_returns = summary.get("trialPeriodReturns")
    if not isinstance(trial_period_returns, list) or not trial_period_returns:
        raise ValueError("evaluation requires the complete trialPeriodReturns matrix")
    selected_trial_index = summary.get("selectedTrialIndex")
    if not isinstance(selected_trial_index, int) or not 0 <= selected_trial_index < len(trial_period_returns):
        raise ValueError("evaluation requires a valid selectedTrialIndex from the complete trial matrix")

    pbo = probability_of_backtest_overfitting(trial_period_returns)
    periods_per_year = int(summary.get("periodsPerYear", 4))
    all_trial_sharpes = [annualized_sharpe(row, periods_per_year) for row in trial_period_returns]
    selected_returns = trial_period_returns[selected_trial_index]
    deflated = deflated_sharpe_probability(selected_returns, all_trial_sharpes, periods_per_year)
    return {
        "pbo": pbo,
        "deflatedSharpe": deflated,
        "recordedTrials": len(trial_period_returns),
        "selectedTrialIndex": selected_trial_index,
    }


def evaluate_promotion(summary: dict[str, Any], protocol: dict[str, Any]) -> dict[str, Any]:
    gates = protocol["promotionGates"]
    multiple_testing = calculate_multiple_testing_controls(summary)
    quarters = summary.get("outerQuarters", [])
    base_values = [float(item["netPct"]) for item in quarters]
    stress_values = [float(item["stressNetPct"]) for item in quarters]
    positive_ratio = sum(value > 0 for value in base_values) / len(base_values) if base_values else 0.0
    strategy_net = _mean(base_values)
    baseline_map = {item["id"]: float(item["netPct"]) for item in summary.get("baselines", [])}
    required_baselines = [item["id"] for item in protocol["baselines"]]

    checks = {
        "enoughOuterQuarters": len(quarters) >= protocol["validation"]["minimumOuterQuarters"],
        "afterCostPositive": strategy_net > gates["afterCostMeanNetPctGreaterThan"],
        "stressCostNonNegative": _mean(stress_values) >= gates["stressCostMeanNetPctAtLeast"],
        "winRate": float(summary.get("outOfSampleWinRate", 0)) >= gates["minimumOutOfSampleWinRate"],
        "quarterStability": positive_ratio >= gates["minimumPositiveQuarterRatio"],
        "pbo": multiple_testing["pbo"]["pbo"] <= protocol["multipleTesting"]["probabilityOfBacktestOverfitting"]["maximum"],
        "deflatedSharpe": multiple_testing["deflatedSharpe"]["probability"] >= protocol["multipleTesting"]["deflatedSharpe"]["minimumProbability"],
        "allBaselinesPresent": all(item in baseline_map for item in required_baselines),
        "beatsAllBaselines": all(strategy_net > baseline_map.get(item, math.inf) for item in required_baselines),
    }
    passed = all(checks.values())
    return {
        "passedRollingOutOfSample": passed,
        "nextStage": "final-2026-blind" if passed else "research-rejected",
        "checks": checks,
        "metrics": {
            "meanNetPct": strategy_net,
            "meanStressNetPct": _mean(stress_values),
            "positiveQuarterRatio": positive_ratio,
            "pbo": multiple_testing["pbo"]["pbo"],
            "deflatedSharpeProbability": multiple_testing["deflatedSharpe"]["probability"],
            "recordedTrials": multiple_testing["recordedTrials"],
        },
        "multipleTesting": multiple_testing,
        "notice": "门槛未通过时不得读取2026数据，也不得修改本协议后重跑同一盲测。",
    }


def command_record(args: argparse.Namespace) -> None:
    protocol = load_protocol(Path(args.protocol))
    prepared = append_trial(Path(args.ledger), load_json(Path(args.input)), protocol)
    print(json.dumps({"recorded": True, "trialId": prepared["trialId"], "configHash": prepared["configHash"]}, ensure_ascii=False))


def command_evaluate(args: argparse.Namespace) -> None:
    protocol = load_protocol(Path(args.protocol))
    report = evaluate_promotion(load_json(Path(args.input)), protocol)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(output + "\n", encoding="utf-8")
    print(output)


def command_verify_ledger(args: argparse.Namespace) -> None:
    rows = read_ledger(Path(args.ledger))
    print(json.dumps({
        "valid": True,
        "records": len(rows),
        "chainTip": rows[-1]["recordHash"] if rows else GENESIS_HASH,
    }, ensure_ascii=False))


def command_open_blind(args: argparse.Namespace) -> None:
    protocol = load_protocol(Path(args.protocol))
    state = open_final_blind_once(Path(args.state), load_json(Path(args.input)), protocol)
    print(json.dumps(state, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Zijin round-four standard experiment controls")
    parser.add_argument("--protocol", default=str(DEFAULT_PROTOCOL))
    subparsers = parser.add_subparsers(dest="command", required=True)
    record = subparsers.add_parser("record", help="append one preregistered trial to the ledger")
    record.add_argument("--input", required=True)
    record.add_argument("--ledger", required=True)
    record.set_defaults(handler=command_record)
    evaluate = subparsers.add_parser("evaluate", help="apply frozen promotion gates to an OOS summary")
    evaluate.add_argument("--input", required=True)
    evaluate.add_argument("--output")
    evaluate.set_defaults(handler=command_evaluate)
    verify = subparsers.add_parser("verify-ledger", help="verify the immutable trial hash chain")
    verify.add_argument("--ledger", required=True)
    verify.set_defaults(handler=command_verify_ledger)
    blind = subparsers.add_parser("open-final-blind", help="open the sealed 2026 blind exactly once")
    blind.add_argument("--input", required=True, help="passed rolling OOS report")
    blind.add_argument("--state", required=True, help="exclusive one-shot seal file")
    blind.set_defaults(handler=command_open_blind)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
