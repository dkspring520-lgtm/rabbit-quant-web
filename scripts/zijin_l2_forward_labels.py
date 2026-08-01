#!/usr/bin/env python3
"""Delayed, append-only outcome labels for Zijin L2 forward observations.

Feature observations are written by ``zijin_l2_collector.py`` at minute t.
This module may only write a separate label after the required future trading
minutes already exist.  It is intentionally a research ledger: it never
creates an order, modifies Smart-T V4, or overwrites the original observation.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


EXPERIMENT_ID = "zijin-opening-l2-forward-shadow-v2"
COST_MODEL_ID = "a-share-account-cost-v1"
HORIZONS = (5, 15, 30)
OPENING_PHASES = {"auction-probe", "auction-locked", "open-discovery", "open-confirmation", "open-persistence"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    records.append(value)
    except FileNotFoundError:
        pass
    return records


def atomic_json(path: str | Path, payload: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        temporary = handle.name
    os.replace(temporary, target)


def observation_id(record: dict[str, Any]) -> str | None:
    minute = record.get("exchangeMinute")
    symbol = record.get("symbol")
    if isinstance(minute, str) and isinstance(symbol, str):
        schema = 3 if int(record.get("schemaVersion") or 2) >= 3 else 2
        return f"{symbol}:{minute}:l2-v{schema}"
    return None


def economic_threshold(
    price: float,
    *,
    fixed_cost_pct: float | None = None,
    quantity: int = 1600,
    commission_pct_per_side: float = 0.025,
    stamp_tax_pct: float = 0.05,
    slippage_pct_per_side: float = 0.02,
    minimum_commission_yuan: float = 5.0,
    minimum_net_pct: float = 0.12,
    minimum_net_yuan: float = 30.0,
    minimum_gross_spread_yuan: float = 0.10,
) -> dict[str, Any]:
    """Return the gross move required to cover executable A-share costs.

    ``fixed_cost_pct`` remains available only to reproduce the historical v1
    ledger.  The production research path uses account-sized costs plus an
    explicit minimum net edge; those concepts must not be collapsed into one
    unexplained constant.
    """
    if fixed_cost_pct is not None:
        threshold = max(0.0, float(fixed_cost_pct))
        return {
            "id": "legacy-fixed-threshold",
            "mode": "fixed",
            "requiredGrossMovePct": round(threshold, 6),
            "roundTripCostPct": round(threshold, 6),
            "minimumNetEdgePct": 0.0,
            "minimumGrossSpreadPct": 0.0,
        }

    safe_price = max(0.01, float(price))
    safe_quantity = max(100, int(quantity // 100) * 100)
    one_side_notional = safe_price * safe_quantity
    commission_yuan = max(
        max(0.0, minimum_commission_yuan),
        one_side_notional * max(0.0, commission_pct_per_side) / 100,
    )
    commission_round_trip_pct = commission_yuan * 2 / one_side_notional * 100
    round_trip_cost_pct = (
        commission_round_trip_pct
        + max(0.0, stamp_tax_pct)
        + max(0.0, slippage_pct_per_side) * 2
    )
    net_edge_pct = max(
        max(0.0, minimum_net_pct),
        max(0.0, minimum_net_yuan) / one_side_notional * 100,
    )
    gross_spread_pct = max(0.0, minimum_gross_spread_yuan) / safe_price * 100
    required = max(round_trip_cost_pct + net_edge_pct, gross_spread_pct)
    return {
        "id": COST_MODEL_ID,
        "mode": "account-dynamic",
        "quantity": safe_quantity,
        "oneSideNotionalYuan": round(one_side_notional, 2),
        "commissionPctPerSide": round(max(0.0, commission_pct_per_side), 6),
        "minimumCommissionYuan": round(max(0.0, minimum_commission_yuan), 2),
        "stampTaxPct": round(max(0.0, stamp_tax_pct), 6),
        "slippagePctPerSide": round(max(0.0, slippage_pct_per_side), 6),
        "roundTripCostPct": round(round_trip_cost_pct, 6),
        "minimumNetEdgePct": round(net_edge_pct, 6),
        "minimumGrossSpreadPct": round(gross_spread_pct, 6),
        "requiredGrossMovePct": round(required, 6),
    }


def is_continuous_minute(minute: str) -> bool:
    if not isinstance(minute, str) or len(minute) != 13 or minute[8] != "-":
        return False
    clock = minute[-4:]
    return "0930" <= clock <= "1129" or "1300" <= clock <= "1459"


def next_continuous_minute(minute: str) -> str | None:
    """Return the next *tradable* A-share minute, preserving the lunch break."""
    if not is_continuous_minute(minute):
        return None
    date, clock = minute.split("-", 1)
    if clock == "1129":
        return f"{date}-1300"
    if clock == "1459":
        return None
    value = datetime.strptime(f"{date}{clock}", "%Y%m%d%H%M") + timedelta(minutes=1)
    return value.strftime("%Y%m%d-%H%M")


def _valid_price(record: dict[str, Any]) -> float | None:
    value = record.get("lastPrice")
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def _future_chain(by_minute: dict[str, dict[str, Any]], anchor_minute: str, horizon: int) -> list[dict[str, Any]] | None:
    future: list[dict[str, Any]] = []
    cursor = anchor_minute
    for _ in range(horizon):
        cursor = next_continuous_minute(cursor)
        if cursor is None or cursor not in by_minute:
            return None
        row = by_minute[cursor]
        if _valid_price(row) is None:
            return None
        future.append(row)
    return future


def _outcome(anchor_price: float, future: list[dict[str, Any]], cost_pct: float) -> dict[str, Any]:
    returns = [(float(row["lastPrice"]) / anchor_price - 1) * 100 for row in future]
    mfe = max(returns)
    mae = min(returns)
    return {
        "mfePct": round(mfe, 6),
        "maePct": round(mae, 6),
        "terminalPct": round(returns[-1], 6),
        "upCostReach": mfe >= cost_pct,
        "downCostReach": -mae >= cost_pct,
        "rangeCostReach": mfe - mae >= cost_pct,
        "observedMinutes": len(future),
    }


def build_labels(
    records: list[dict[str, Any]],
    existing_ids: set[str],
    cost_pct: float | None = None,
    labeled_at: str | None = None,
    *,
    quantity: int = 1600,
    commission_pct_per_side: float = 0.025,
    stamp_tax_pct: float = 0.05,
    slippage_pct_per_side: float = 0.02,
    minimum_commission_yuan: float = 5.0,
    minimum_net_pct: float = 0.12,
    minimum_net_yuan: float = 30.0,
    minimum_gross_spread_yuan: float = 0.10,
) -> list[dict[str, Any]]:
    """Create only matured same-day labels for records not already labelled."""
    by_day: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for record in records:
        minute = record.get("exchangeMinute")
        if record.get("symbol") != "601899" or not isinstance(minute, str) or len(minute) != 13:
            continue
        if _valid_price(record) is not None:
            by_day[minute[:8]][minute] = record

    labels: list[dict[str, Any]] = []
    for record in records:
        identifier = observation_id(record)
        minute = record.get("exchangeMinute")
        phase = record.get("marketPhase")
        if not identifier or record.get("symbol") != "601899" or not isinstance(minute, str):
            continue
        day_rows = by_day.get(minute[:8], {})
        anchor_mode = "observation-price"
        anchor_minute = minute
        anchor_price = _valid_price(record)
        # Auction snapshots are useful for opening-emotion research, but their
        # virtual price must never be treated as an executable price.  Anchor
        # their result to the first observed continuous-auction price instead.
        if phase in {"auction-probe", "auction-locked"}:
            anchor_mode = "opening-price"
            anchor_minute = f"{minute[:8]}-0930"
            anchor_record = day_rows.get(anchor_minute)
            anchor_price = _valid_price(anchor_record) if anchor_record else None
        if not is_continuous_minute(anchor_minute) or anchor_price is None:
            continue
        cost_model = economic_threshold(
            anchor_price,
            fixed_cost_pct=cost_pct,
            quantity=quantity,
            commission_pct_per_side=commission_pct_per_side,
            stamp_tax_pct=stamp_tax_pct,
            slippage_pct_per_side=slippage_pct_per_side,
            minimum_commission_yuan=minimum_commission_yuan,
            minimum_net_pct=minimum_net_pct,
            minimum_net_yuan=minimum_net_yuan,
            minimum_gross_spread_yuan=minimum_gross_spread_yuan,
        )
        required_move_pct = float(cost_model["requiredGrossMovePct"])
        for horizon in HORIZONS:
            label_id = f"{identifier}:{horizon}m"
            if label_id in existing_ids:
                continue
            future = _future_chain(day_rows, anchor_minute, horizon)
            if future is None:
                continue
            labels.append({
                "schemaVersion": 2,
                "experimentId": EXPERIMENT_ID,
                "labelId": label_id,
                "observationId": identifier,
                "symbol": "601899",
                "featureObservedAt": record.get("observedAt"),
                "featureExchangeMinute": minute,
                "marketPhase": phase,
                "horizonMinutes": horizon,
                "labeledAt": labeled_at or utc_now(),
                "anchor": {"mode": anchor_mode, "exchangeMinute": anchor_minute, "price": round(anchor_price, 4)},
                "costThresholdPct": required_move_pct,
                "costModel": cost_model,
                "outcomes": {str(horizon): _outcome(anchor_price, future, required_move_pct)},
                "causality": {
                    "featureFrozenBeforeOutcome": True,
                    "sameTradingDayOnly": True,
                    "requiresConsecutiveTradingMinutes": True,
                    "formalV4Changed": False,
                },
            })
    return labels


def summarize(records: list[dict[str, Any]], labels: list[dict[str, Any]], minimum_labels: int, minimum_days: int, minimum_opening_labels: int) -> dict[str, Any]:
    labels = [item for item in labels if item.get("experimentId") == EXPERIMENT_ID]
    label_ids = {item.get("observationId") for item in labels}
    observations = [item for item in records if observation_id(item)]
    opening_labels = [item for item in labels if item.get("marketPhase") in OPENING_PHASES]
    labeled_observations = {item.get("observationId") for item in labels if item.get("observationId")}
    opening_observations = {item.get("observationId") for item in opening_labels if item.get("observationId")}
    days = {str(item.get("featureExchangeMinute", ""))[:8] for item in labels if item.get("featureExchangeMinute")}

    def bucket(items: list[dict[str, Any]]) -> dict[str, Any]:
        horizons: dict[str, Any] = {}
        for horizon in HORIZONS:
            values = [item["outcomes"][str(horizon)] for item in items if str(horizon) in item.get("outcomes", {})]
            if not values:
                horizons[str(horizon)] = {"samples": 0, "mfePctAvg": None, "maePctAvg": None, "upCostReachRate": None, "downCostReachRate": None}
                continue
            total = len(values)
            horizons[str(horizon)] = {
                "samples": total,
                "mfePctAvg": round(sum(value["mfePct"] for value in values) / total, 6),
                "maePctAvg": round(sum(value["maePct"] for value in values) / total, 6),
                "upCostReachRate": round(sum(bool(value["upCostReach"]) for value in values) / total, 6),
                "downCostReachRate": round(sum(bool(value["downCostReach"]) for value in values) / total, 6),
            }
        return {
            "labels": len({item.get("observationId") for item in items if item.get("observationId")}),
            "horizonLabels": len(items),
            "horizons": horizons,
        }

    by_phase: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in labels:
        by_phase[str(item.get("marketPhase") or "unknown")].append(item)
    ready = len(labeled_observations) >= minimum_labels and len(days) >= minimum_days and len(opening_observations) >= minimum_opening_labels
    return {
        "schemaVersion": 1,
        "experimentId": EXPERIMENT_ID,
        "updatedAt": utc_now(),
        "status": "minimum-forward-evidence-collected" if ready else "collecting-forward-evidence",
        "safety": {
            "shadowOnly": True,
            "formalV4Changed": False,
            "automaticPromotion": False,
            "futureOutcomesAreWrittenSeparately": True,
        },
        "scope": "601899 L2/price forward study; no claim is made about unavailable external or cancellation factors.",
        "coverage": {
            "featureObservations": len(observations),
            "labeledObservations": len(labeled_observations),
            "horizonLabels": len(labels),
            "pendingObservations": max(0, len(observations) - len(label_ids)),
            "tradingDays": len(days),
            "openingLabels": len(opening_observations),
            "minimumLabels": minimum_labels,
            "minimumTradingDays": minimum_days,
            "minimumOpeningLabels": minimum_opening_labels,
        },
        "outcomes": {"all": bucket(labels), "opening": bucket(opening_labels), "byPhase": {phase: bucket(items) for phase, items in sorted(by_phase.items())}},
        "decision": "Research diagnostics only. Manual review is required after the stated forward-data gates; Smart-T V4 remains unchanged.",
    }


def refresh_labels_and_state(
    forward_path: str,
    label_path: str,
    state_path: str,
    cost_pct: float | None = None,
    minimum_labels: int = 1200,
    minimum_days: int = 10,
    minimum_opening_labels: int = 200,
    **cost_options: Any,
) -> dict[str, Any]:
    records = read_jsonl(forward_path)
    labels = read_jsonl(label_path)
    existing_ids = {
        item.get("labelId")
        for item in labels
        if item.get("experimentId") == EXPERIMENT_ID and item.get("labelId")
    }
    additions = build_labels(records, existing_ids, cost_pct, **cost_options)
    if additions:
        target = Path(label_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8", newline="\n") as handle:
            for item in additions:
                handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        labels.extend(additions)
    state = summarize(records, labels, minimum_labels, minimum_days, minimum_opening_labels)
    current_labels = [item for item in labels if item.get("experimentId") == EXPERIMENT_ID]
    state["labelLedger"] = {
        "path": str(label_path),
        "newLabels": len(additions),
        "totalLabels": len({item.get('observationId') for item in current_labels if item.get('observationId')}),
        "horizonLabels": len(current_labels),
        "allVersionLabels": len(labels),
    }
    atomic_json(state_path, state)
    return state


def main() -> None:
    parser = argparse.ArgumentParser(description="Create delayed causal labels for Zijin L2 forward samples")
    parser.add_argument("--input", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--cost-pct", type=float, default=None, help="legacy fixed threshold; omit for dynamic account costs")
    parser.add_argument("--quantity", type=int, default=1600)
    parser.add_argument("--commission-pct-per-side", type=float, default=0.025)
    parser.add_argument("--stamp-tax-pct", type=float, default=0.05)
    parser.add_argument("--slippage-pct-per-side", type=float, default=0.02)
    parser.add_argument("--minimum-commission-yuan", type=float, default=5.0)
    parser.add_argument("--minimum-net-pct", type=float, default=0.12)
    parser.add_argument("--minimum-net-yuan", type=float, default=30.0)
    parser.add_argument("--minimum-gross-spread-yuan", type=float, default=0.10)
    parser.add_argument("--minimum-labels", type=int, default=1200)
    parser.add_argument("--minimum-days", type=int, default=10)
    parser.add_argument("--minimum-opening-labels", type=int, default=200)
    args = parser.parse_args()
    state = refresh_labels_and_state(
        args.input,
        args.labels,
        args.state,
        args.cost_pct,
        args.minimum_labels,
        args.minimum_days,
        args.minimum_opening_labels,
        quantity=args.quantity,
        commission_pct_per_side=args.commission_pct_per_side,
        stamp_tax_pct=args.stamp_tax_pct,
        slippage_pct_per_side=args.slippage_pct_per_side,
        minimum_commission_yuan=args.minimum_commission_yuan,
        minimum_net_pct=args.minimum_net_pct,
        minimum_net_yuan=args.minimum_net_yuan,
        minimum_gross_spread_yuan=args.minimum_gross_spread_yuan,
    )
    print(json.dumps({"status": state["status"], "coverage": state["coverage"], "labelLedger": state["labelLedger"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
