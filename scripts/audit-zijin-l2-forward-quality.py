#!/usr/bin/env python3
"""Audit genuine Zijin L2 forward evidence without fitting or deploying a model.

This report intentionally separates *data readiness* from apparent short-run
performance.  Five trading days can reveal schema or direction bugs, but it
cannot justify a formal strategy or a 40-cycles-per-100-days claim.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    try:
        return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    except FileNotFoundError:
        return []


def observation_id(row: dict[str, Any]) -> str | None:
    symbol = row.get("symbol")
    minute = row.get("exchangeMinute")
    if not isinstance(symbol, str) or not isinstance(minute, str):
        return None
    schema = 3 if int(row.get("schemaVersion") or 2) >= 3 else 2
    return f"{symbol}:{minute}:l2-v{schema}"


def microstructure_available(row: dict[str, Any]) -> bool:
    block = row.get("microstructure") or {}
    if block.get("featureSchemaId") == "zijin-l2-microstructure-v1":
        return True
    state = row.get("secondState") or {}
    windows = state.get("windows") or {}
    persistence = ((state.get("book") or {}).get("persistence3s") or {})
    return all(key in windows for key in ("1s", "3s", "10s", "30s", "60s")) and bool(persistence)


def directional_net(row: dict[str, Any], label: dict[str, Any]) -> float | None:
    state = row.get("secondState") or {}
    direction = state.get("direction")
    horizon = str(label.get("horizonMinutes"))
    outcome = (label.get("outcomes") or {}).get(horizon) or {}
    terminal = outcome.get("terminalPct")
    cost = label.get("costThresholdPct")
    if direction not in {"buy", "sell"} or terminal is None or cost is None:
        return None
    sign = 1 if direction == "buy" else -1
    return sign * float(terminal) - float(cost)


def summarize(observations: list[dict[str, Any]], labels: list[dict[str, Any]], minimum_days: int) -> dict[str, Any]:
    by_id = {identifier: row for row in observations if (identifier := observation_id(row))}
    feature_days = sorted({row["exchangeMinute"][:8] for row in observations if microstructure_available(row)})
    joined: dict[int, list[tuple[dict[str, Any], dict[str, Any], float | None]]] = defaultdict(list)
    for label in labels:
        row = by_id.get(label.get("observationId"))
        if row is None:
            continue
        horizon = int(label.get("horizonMinutes") or 0)
        joined[horizon].append((row, label, directional_net(row, label)))

    horizons: dict[str, Any] = {}
    for horizon in sorted(joined):
        rows = joined[horizon]
        directional = [item for item in rows if item[2] is not None]
        states: dict[str, list[float]] = defaultdict(list)
        for row, _label, net in directional:
            states[str((row.get("secondState") or {}).get("state") or "unknown")].append(float(net))

        def stats(values: list[float]) -> dict[str, Any]:
            return {
                "samples": len(values),
                "winRatePct": None if not values else round(sum(value >= 0 for value in values) / len(values) * 100, 4),
                "averageNetPct": None if not values else round(sum(values) / len(values), 6),
            }

        horizons[str(horizon)] = {
            "maturedLabels": len(rows),
            "directionalRows": stats([float(item[2]) for item in directional]),
            "byState": {state: stats(values) for state, values in sorted(states.items())},
        }

    # A TRIGGER lasts only a few seconds, but the minute ledger can still see
    # duplicates after a restart. Deduplicate by trading day and state sequence.
    formal_keys = {
        (
            row.get("exchangeMinute", "")[:8],
            (row.get("secondState") or {}).get("sequence"),
            (row.get("secondState") or {}).get("direction"),
        )
        for row in observations
        if (row.get("secondState") or {}).get("formalSignal")
    }
    required_cycles = max(1, round(minimum_days * .4))
    readiness = {
        "status": "ready-for-rolling-forward-validation" if len(feature_days) >= minimum_days and len(formal_keys) >= required_cycles else "insufficient-genuine-forward-evidence",
        "microstructureTradingDays": len(feature_days),
        "minimumTradingDays": minimum_days,
        "formalSignalsObserved": len(formal_keys),
        "minimumFormalSignalsAtTargetFrequency": required_cycles,
        "targetFrequency": "approximately 40 formal cycles per 100 trading days",
        "canEstimateWinRate": len(feature_days) >= minimum_days and len(formal_keys) >= required_cycles,
    }
    return {
        "schemaVersion": 1,
        "scope": "601899 genuine forward L2; causal observations joined to delayed executable-cost labels",
        "observations": len(observations),
        "featureSchemas": dict(Counter(str(row.get("schemaVersion") or "unknown") for row in observations)),
        "dateRange": [feature_days[0], feature_days[-1]] if feature_days else None,
        "readiness": readiness,
        "horizons": horizons,
        "safety": {
            "futureFeaturesUsed": False,
            "formalStrategyChanged": False,
            "shortSamplePerformanceIsDeployable": False,
            "cancellationOrReplenishmentInvented": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observations", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--minimum-days", type=int, default=20)
    parser.add_argument("--output")
    args = parser.parse_args()
    report = summarize(read_jsonl(args.observations), read_jsonl(args.labels), args.minimum_days)
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()
