#!/usr/bin/env python3
"""Forward-only multi-factor T shadow observer for Zijin Mining (601899).

The observer consumes completed L2 minute records. It writes a dedicated
research ledger and never emits an order, member alert, or production signal.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


STRATEGY_ID = "closure-v2-shadow-zijin-multifactor-t"
REGIME_SYMBOLS = {
    "zijin": "sh601899",
    "sector": "sh512400",
    "market": "sh000001",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json(path: str | Path, payload: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        temporary = handle.name
    os.replace(temporary, target)


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def next_continuous_minute(minute: str) -> str | None:
    if not isinstance(minute, str) or len(minute) != 13 or minute[8] != "-":
        return None
    date, clock = minute.split("-", 1)
    if not ("0930" <= clock <= "1129" or "1300" <= clock <= "1459"):
        return None
    if clock == "1129":
        return f"{date}-1300"
    if clock == "1459":
        return None
    value = datetime.strptime(f"{date}{clock}", "%Y%m%d%H%M") + timedelta(minutes=1)
    return value.strftime("%Y%m%d-%H%M")


def is_continuous_minute(minute: str) -> bool:
    if not isinstance(minute, str) or len(minute) != 13 or minute[8] != "-":
        return False
    try:
        datetime.strptime(minute, "%Y%m%d-%H%M")
    except ValueError:
        return False
    return next_continuous_minute(minute) is not None or minute[-4:] == "1459"


def consume_book(record: dict[str, Any], side: str, quantity: int, impact_bps: float = 0) -> dict[str, float] | None:
    book = record.get("book") or {}
    bid_prices = [finite_number(value) for value in book.get("bidPrices", [])]
    ask_prices = [finite_number(value) for value in book.get("askPrices", [])]
    bid_volumes = [finite_number(value) for value in book.get("bidVolumes", [])]
    ask_volumes = [finite_number(value) for value in book.get("askVolumes", [])]
    best_bid = bid_prices[0] if bid_prices else None
    best_ask = ask_prices[0] if ask_prices else None
    if not best_bid or not best_ask or best_bid >= best_ask:
        return None

    prices = bid_prices if side == "sell" else ask_prices
    volumes = bid_volumes if side == "sell" else ask_volumes
    remaining = quantity
    notional = 0.0
    levels = 0
    for price, volume in zip(prices, volumes):
        if not price or not volume or volume <= 0:
            continue
        filled = min(remaining, int(volume))
        notional += filled * price
        remaining -= filled
        levels += 1
        if remaining <= 0:
            break
    if remaining > 0:
        return None

    raw_price = notional / quantity
    multiplier = 1 - impact_bps / 10_000 if side == "sell" else 1 + impact_bps / 10_000
    execution_price = raw_price * multiplier
    best_price = best_bid if side == "sell" else best_ask
    depth_walk_bps = (
        max(0.0, (best_price - raw_price) / best_price * 10_000)
        if side == "sell"
        else max(0.0, (raw_price - best_price) / best_price * 10_000)
    )
    return {
        "executionPrice": round(execution_price, 6),
        "rawPrice": round(raw_price, 6),
        "levels": levels,
        "depthWalkBps": round(depth_walk_bps, 6),
    }


def execute_t(
    entry_record: dict[str, Any],
    exit_record: dict[str, Any],
    config: dict[str, Any],
    direction: str,
    impact_bps: float = 0,
    include_transfer_fee: bool = False,
) -> dict[str, Any] | None:
    quantity = int(config["quantity"])
    if direction not in {"positive-t", "reverse-t"}:
        raise ValueError(f"unsupported shadow direction: {direction}")
    entry_side = "buy" if direction == "positive-t" else "sell"
    exit_side = "sell" if direction == "positive-t" else "buy"
    entry = consume_book(entry_record, entry_side, quantity, impact_bps)
    exit_fill = consume_book(exit_record, exit_side, quantity, impact_bps)
    if entry is None or exit_fill is None:
        return None

    costs = config["costs"]
    buy_fill = entry if direction == "positive-t" else exit_fill
    sell_fill = exit_fill if direction == "positive-t" else entry
    sell_turnover = sell_fill["executionPrice"] * quantity
    buy_turnover = buy_fill["executionPrice"] * quantity
    commission = lambda turnover: max(float(costs["minimumCommission"]), turnover * float(costs["commissionRate"]))
    commissions = commission(sell_turnover) + commission(buy_turnover)
    stamp_tax = sell_turnover * float(costs["stampTaxRateOnSell"])
    transfer_fees = (
        (sell_turnover + buy_turnover) * float(costs["transferFeeRateReportedSeparately"])
        if include_transfer_fee else 0.0
    )
    net = sell_turnover - buy_turnover - commissions - stamp_tax - transfer_fees
    return {
        "direction": direction,
        "entryPrice": entry["executionPrice"],
        "exitPrice": exit_fill["executionPrice"],
        "entryRawPrice": entry["rawPrice"],
        "exitRawPrice": exit_fill["rawPrice"],
        "entryLevels": entry["levels"],
        "exitLevels": exit_fill["levels"],
        "entryDepthWalkBps": entry["depthWalkBps"],
        "exitDepthWalkBps": exit_fill["depthWalkBps"],
        "gross": round(sell_turnover - buy_turnover, 6),
        "commissions": round(commissions, 6),
        "stampTax": round(stamp_tax, 6),
        "transferFees": round(transfer_fees, 6),
        "net": round(net, 6),
        "netBps": round(net / sell_turnover * 10_000, 6) if sell_turnover > 0 else 0,
    }


def execute_reverse_t(
    entry_record: dict[str, Any],
    exit_record: dict[str, Any],
    config: dict[str, Any],
    impact_bps: float = 0,
    include_transfer_fee: bool = False,
) -> dict[str, Any] | None:
    return execute_t(entry_record, exit_record, config, "reverse-t", impact_bps, include_transfer_fee)


class ZijinClosureV2ReverseShadow:
    def __init__(
        self,
        *,
        event_path: str | Path,
        state_path: str | Path,
        config_path: str | Path | None = None,
    ) -> None:
        source = Path(config_path) if config_path else Path(__file__).with_name("closure-v2-shadow-forward-config-20260809.json")
        self.config = json.loads(source.read_text(encoding="utf-8"))
        if (
            self.config.get("strategyId") != STRATEGY_ID
            or self.config.get("symbol") != "601899"
            or self.config.get("mode") != "shadow-only"
            or self.config.get("affectsProduction") is not False
            or self.config.get("sendsAlerts") is not False
            or self.config.get("forwardGate", {}).get("automaticPromotion") is not False
        ):
            raise ValueError("unsafe or incompatible Zijin multi-factor shadow configuration")
        self.event_path = Path(event_path)
        self.state_path = Path(state_path)
        self.lock = threading.RLock()
        self.minutes: list[dict[str, Any]] = []
        self.current_date = ""
        self.last_minute = ""
        self.observed_dates: set[str] = set()
        self.observed_candidate_keys: set[str] = set()
        self.signaled_keys: set[str] = set()
        self.pending: dict[str, Any] | None = None
        self.regime_context: dict[str, Any] | None = None
        self.latest_evaluation: dict[str, Any] | None = None
        self.latest_event: dict[str, Any] | None = None
        self.counts = {
            "candidateWaves": 0,
            "promotedCandidates": 0,
            "candidates": 0,
            "entries": 0,
            "resolved": 0,
            "wins": 0,
            "stress5Wins": 0,
            "winningNet": 0.0,
            "losingNet": 0.0,
            "rejected": 0,
        }
        self._load_state()

    def _load_state(self) -> None:
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return
        if payload.get("strategyId") != STRATEGY_ID:
            return
        self.current_date = str(payload.get("currentDate") or "")
        self.last_minute = str(payload.get("lastMinute") or "")
        self.observed_dates = set(payload.get("observedDates") or [])
        self.observed_candidate_keys = set(payload.get("observedCandidateKeys") or [])
        self.signaled_keys = set(payload.get("signaledKeys") or [])
        self.pending = payload.get("pending") if isinstance(payload.get("pending"), dict) else None
        self.regime_context = payload.get("regime") if isinstance(payload.get("regime"), dict) else None
        self.latest_evaluation = payload.get("latestEvaluation") if isinstance(payload.get("latestEvaluation"), dict) else None
        self.latest_event = payload.get("latestEvent") if isinstance(payload.get("latestEvent"), dict) else None
        restored_counts = payload.get("counts") or {}
        for key in self.counts:
            value = restored_counts.get(key, self.counts[key])
            self.counts[key] = float(value or 0) if key in {"winningNet", "losingNet"} else int(value or 0)

    def _review_evaluation(self) -> dict[str, Any]:
        gate = self.config["forwardGate"]
        resolved = int(self.counts["resolved"])
        candidate_waves = int(self.counts["candidateWaves"])
        promoted = int(self.counts["promotedCandidates"])
        winning_net = float(self.counts["winningNet"])
        losing_net = float(self.counts["losingNet"])
        promotion_rate = promoted / candidate_waves if candidate_waves else None
        after_cost_win_rate = int(self.counts["wins"]) / resolved if resolved else None
        stress_win_rate = int(self.counts["stress5Wins"]) / resolved if resolved else None
        profit_factor = (
            winning_net / abs(losing_net)
            if losing_net < 0
            else (999999.0 if winning_net > 0 else None)
        )
        promotion_bounds = gate["acceptableCandidatePromotionRate"]
        gates = {
            "tradingDays": len(self.observed_dates) >= int(gate["preferredTradingDaysForPromotionReview"]),
            "resolvedCycles": resolved >= int(gate["minimumResolvedCycles"]),
            "candidatePromotionRate": promotion_rate is not None
            and float(promotion_bounds[0]) <= promotion_rate <= float(promotion_bounds[1]),
            "afterCostWinRate": after_cost_win_rate is not None
            and after_cost_win_rate >= float(gate["minimumAfterCostWinRate"]),
            "stress5BpsWinRate": stress_win_rate is not None
            and stress_win_rate >= float(gate["minimumStress5BpsWinRate"]),
            "profitFactor": profit_factor is not None
            and profit_factor >= float(gate["minimumProfitFactor"]),
        }
        return {
            "tradingDays": len(self.observed_dates),
            "resolvedCycles": resolved,
            "candidatePromotionRate": promotion_rate,
            "afterCostWinRate": after_cost_win_rate,
            "stress5BpsWinRate": stress_win_rate,
            "profitFactor": profit_factor,
            "gates": gates,
            "readyForManualReview": all(gates.values()),
            "automaticPromotion": False,
            "affectsProduction": False,
        }

    def _state_payload(self) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "strategyId": STRATEGY_ID,
            "mode": "shadow-only",
            "shadowOnly": True,
            "affectsProduction": False,
            "sendsAlerts": False,
            "automaticPromotion": False,
            "symbol": "601899",
            "updatedAt": utc_now(),
            "currentDate": self.current_date,
            "lastMinute": self.last_minute,
            "displayName": self.config.get("displayName"),
            "observedDates": sorted(self.observed_dates)[-500:],
            "observedCandidateKeys": sorted(self.observed_candidate_keys)[-1000:],
            "signaledKeys": sorted(self.signaled_keys)[-1000:],
            "pending": self.pending,
            "regime": self.regime_context,
            "latestEvaluation": self.latest_evaluation,
            "counts": dict(self.counts),
            "manualReview": self._review_evaluation(),
            "latestEvent": self.latest_event,
            "forwardGate": self.config["forwardGate"],
        }

    def public_status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "strategyId": STRATEGY_ID,
                "displayName": self.config.get("displayName"),
                "mode": "shadow-only",
                "affectsProduction": False,
                "sendsAlerts": False,
                "automaticPromotion": False,
                "regimeReady": bool(self.regime_context and self.regime_context.get("ready")),
                "counts": dict(self.counts),
                "pending": None if self.pending is None else self.pending.get("stage"),
                "multiFactor": self.latest_evaluation,
                "manualReview": self._review_evaluation(),
            }

    def _save(self) -> None:
        atomic_json(self.state_path, self._state_payload())

    def _emit(self, kind: str, minute: str, payload: dict[str, Any]) -> dict[str, Any]:
        event = {
            "schemaVersion": 1,
            "strategyId": STRATEGY_ID,
            "mode": "shadow-only",
            "shadowOnly": True,
            "affectsProduction": False,
            "sendsAlerts": False,
            "automaticPromotion": False,
            "eventId": f"{STRATEGY_ID}:{minute}:{payload.get('direction', 'common')}:{kind}",
            "event": kind,
            "symbol": "601899",
            "exchangeMinute": minute,
            "recordedAt": utc_now(),
            **payload,
        }
        self.event_path.parent.mkdir(parents=True, exist_ok=True)
        with self.event_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self.latest_event = event
        self._save()
        return event

    def _regime_allows(self, returns: dict[str, Any], direction: str) -> bool:
        regime = self.config["directions"][direction]["regime"]
        checks = (
            ("zijin", "zijinReturnMin", "zijinReturnMax"),
            ("sector", "sectorReturnMin", "sectorReturnMax"),
            ("market", "marketReturnMin", "marketReturnMax"),
        )
        for key, minimum, maximum in checks:
            value = finite_number(returns.get(key))
            if value is None or value < float(regime[minimum]) or value > float(regime[maximum]):
                return False
        return True

    def set_regime_context(self, date: str, returns: dict[str, Any], source: str = "provided") -> dict[str, Any]:
        normalized_date = str(date).replace("-", "")[:8]
        with self.lock:
            ready = all(finite_number(returns.get(key)) is not None for key in REGIME_SYMBOLS)
            allowed_directions = [
                direction for direction in self.config["directions"]
                if ready and self._regime_allows(returns, direction)
            ]
            self.regime_context = {
                "date": normalized_date,
                "ready": ready,
                "allowed": bool(allowed_directions),
                "allowedDirections": allowed_directions,
                "returns": {key: finite_number(returns.get(key)) for key in REGIME_SYMBOLS},
                "lookbackSessions": int(self.config["regime"]["lookbackSessions"]),
                "source": source,
                "observedAt": utc_now(),
            }
            self._save()
            return dict(self.regime_context)

    @staticmethod
    def _fetch_prior_closes(symbol: str, date: str, timeout: float = 8) -> list[float]:
        end = datetime.strptime(date, "%Y%m%d")
        start = end - timedelta(days=120)
        parameter = f"{symbol},day,{start:%Y-%m-%d},{end:%Y-%m-%d},100,qfq"
        url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?" + urllib.parse.urlencode({"param": parameter})
        request = urllib.request.Request(url, headers={"User-Agent": "rabbit-quant-shadow/1.0"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        bucket = (payload.get("data") or {}).get(symbol) or {}
        rows = bucket.get("qfqday") or bucket.get("day") or []
        return [
            float(row[2]) for row in rows
            if isinstance(row, list) and len(row) >= 3 and str(row[0]).replace("-", "") < date
        ]

    def refresh_market_context(self, date: str | None = None) -> dict[str, Any]:
        target_date = str(date or datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")).replace("-", "")[:8]
        with self.lock:
            if self.regime_context and self.regime_context.get("date") == target_date and self.regime_context.get("ready"):
                return dict(self.regime_context)
        lookback = int(self.config["regime"]["lookbackSessions"])
        try:
            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = {
                    key: executor.submit(self._fetch_prior_closes, symbol, target_date)
                    for key, symbol in REGIME_SYMBOLS.items()
                }
                series = {key: future.result() for key, future in futures.items()}
            returns = {}
            for key, closes in series.items():
                if len(closes) < lookback + 1 or closes[-lookback - 1] <= 0:
                    raise ValueError(f"insufficient prior sessions for {key}")
                returns[key] = closes[-1] / closes[-lookback - 1] - 1
            return self.set_regime_context(target_date, returns, source="tencent-qfq-prior-sessions")
        except Exception as error:
            with self.lock:
                self.regime_context = {
                    "date": target_date,
                    "ready": False,
                    "allowed": False,
                    "allowedDirections": [],
                    "returns": {key: None for key in REGIME_SYMBOLS},
                    "lookbackSessions": lookback,
                    "source": "unavailable",
                    "error": type(error).__name__,
                    "observedAt": utc_now(),
                }
                self._save()
                return dict(self.regime_context)

    @staticmethod
    def _compact_record(record: dict[str, Any]) -> dict[str, Any]:
        book = record.get("book") or {}
        return {
            "exchangeMinute": record.get("exchangeMinute"),
            "lastPrice": record.get("lastPrice"),
            "book": {
                key: list(book.get(key) or [])
                for key in ("bidPrices", "askPrices", "bidVolumes", "askVolumes")
            },
        }

    @staticmethod
    def _ofi(record: dict[str, Any]) -> float | None:
        flow = record.get("flow") or {}
        active_buy = finite_number(flow.get("activeBuyNotional60s"))
        active_sell = finite_number(flow.get("activeSellNotional60s"))
        total = (active_buy or 0) + (active_sell or 0)
        if total > 0:
            return ((active_buy or 0) - (active_sell or 0)) / total
        ratio = finite_number(flow.get("activeBuyRatio60s"))
        return ratio * 2 - 1 if ratio is not None else None

    def _l2_record_valid(self, record: dict[str, Any]) -> bool:
        quality = self.config["l2Quality"]
        book = record.get("book") or {}
        bid_prices = [finite_number(value) for value in book.get("bidPrices", [])]
        ask_prices = [finite_number(value) for value in book.get("askPrices", [])]
        bid_volumes = [finite_number(value) for value in book.get("bidVolumes", [])]
        ask_volumes = [finite_number(value) for value in book.get("askVolumes", [])]
        best_bid = bid_prices[0] if bid_prices else None
        best_ask = ask_prices[0] if ask_prices else None
        spread_bps = finite_number(book.get("spreadBps"))
        if spread_bps is None and best_bid and best_ask and best_ask > best_bid:
            spread_bps = (best_ask - best_bid) / ((best_ask + best_bid) / 2) * 10_000
        depth_notional = sum(
            (price or 0) * (volume or 0)
            for price, volume in list(zip(bid_prices, bid_volumes))[:5]
            + list(zip(ask_prices, ask_volumes))[:5]
        )
        return (
            self._ofi(record) is not None
            and finite_number(book.get("nearTouchImbalance")) is not None
            and spread_bps is not None
            and spread_bps <= float(quality["maximumSpreadBps"])
            and depth_notional >= float(quality["minimumVisibleDepthNotional"])
            and best_bid is not None
            and best_ask is not None
            and best_bid < best_ask
        )

    def _features(self) -> dict[str, Any] | None:
        window_size = int(self.config["l2Quality"]["windowMinutes"])
        if len(self.minutes) < window_size:
            return None
        window = self.minutes[-window_size:]
        current = window[-1]
        price = finite_number(current.get("lastPrice"))
        vwap = finite_number(current.get("cumulativeVwap"))
        momentum_base = finite_number(window[-4].get("lastPrice"))
        recent_prices = [finite_number(item.get("lastPrice")) for item in window]
        valid_prices = [value for value in recent_prices if value is not None]
        if price is None or not valid_prices:
            return None
        recent_high = max(valid_prices)
        recent_low = min(valid_prices)
        flow = current.get("flow") or {}
        big_buy = finite_number(flow.get("bigBuyNotional60s"))
        big_sell = finite_number(flow.get("bigSellNotional60s"))
        big_total = (big_buy or 0) + (big_sell or 0)
        ofi_series = [self._ofi(item) for item in window]
        valid_suffix = 0
        for item in reversed(window):
            if not self._l2_record_valid(item):
                break
            valid_suffix += 1
        volatility = current.get("volatility") or {}
        return {
            "price": price,
            "atr14": finite_number(volatility.get("atr14")),
            "activeBuyRatios": [
                finite_number((item.get("flow") or {}).get("activeBuyRatio60s"))
                for item in window[-3:]
            ],
            "ofiSeries": ofi_series,
            "ofiVelocity3MinBps": (
                (ofi_series[-1] - ofi_series[-4]) * 10_000
                if ofi_series[-1] is not None and ofi_series[-4] is not None else None
            ),
            "consecutiveValidL2Minutes": valid_suffix,
            "largeOrderNetRatio": (
                ((big_buy or 0) - (big_sell or 0)) / big_total if big_total > 0 else None
            ),
            "nearTouchImbalance": finite_number((current.get("book") or {}).get("nearTouchImbalance")),
            "vwapExtensionBps": (price / vwap - 1) * 10_000 if vwap and vwap > 0 else None,
            "momentum3Bps": (price / momentum_base - 1) * 10_000 if momentum_base and momentum_base > 0 else None,
            "pullback5Bps": (recent_high - price) / recent_high * 10_000 if recent_high > 0 else None,
            "rebound5Bps": (price - recent_low) / recent_low * 10_000 if recent_low > 0 else None,
            "micropriceEdgeBps": finite_number((current.get("book") or {}).get("micropriceEdgeBps")),
        }

    def _cost_evaluation(self, record: dict[str, Any], direction: str, features: dict[str, Any]) -> dict[str, Any]:
        exit_config = self.config["directions"][direction]["exit"]
        price = finite_number(features.get("price"))
        atr = finite_number(features.get("atr14"))
        same_book = execute_t(record, record, self.config, direction, 0, True)
        expected_move = (
            max(atr * float(exit_config["targetAtrMultiple"]), price * float(exit_config["minimumTargetBps"]) / 10_000)
            if atr is not None and atr > 0 and price is not None and price > 0 else None
        )
        expected_gross = expected_move * int(self.config["quantity"]) if expected_move is not None else None
        estimated_cost = abs(float(same_book["net"])) if same_book is not None else None
        coverage = (
            expected_gross / estimated_cost
            if expected_gross is not None and estimated_cost is not None and estimated_cost > 0 else None
        )
        minimum = float(self.config["execution"]["minimumCostCoverageMultiple"])
        return {
            "passed": coverage is not None and coverage >= minimum,
            "atr14": atr,
            "expectedMove": expected_move,
            "expectedGross": expected_gross,
            "estimatedRoundTripCost": estimated_cost,
            "costCoverageMultiple": coverage,
            "minimumCostCoverageMultiple": minimum,
        }

    def _factor_gates(self, direction: str, features: dict[str, Any], regime_passes: bool) -> dict[str, bool]:
        signal = self.config["directions"][direction]["signal"]
        ratios = features["activeBuyRatios"]
        common = {
            "marketRegime": regime_passes,
            "l2Quality": features["consecutiveValidL2Minutes"]
            >= int(self.config["l2Quality"]["minimumConsecutiveValidMinutes"]),
        }
        if direction == "positive-t":
            return {
                **common,
                "activeBuyPressure": len(ratios) == 3
                and all(value is not None and value >= float(signal["activeBuyRatioMin"]) for value in ratios),
                "largeOrderFlow": features["largeOrderNetRatio"] is not None
                and features["largeOrderNetRatio"] >= float(signal["largeOrderNetRatioMin"]),
                "nearTouchBook": features["nearTouchImbalance"] is not None
                and features["nearTouchImbalance"] >= float(signal["nearTouchImbalanceMin"]),
                "vwapLocation": features["vwapExtensionBps"] is not None
                and features["vwapExtensionBps"] <= float(signal["vwapExtensionMaxBps"]),
                "momentum3": features["momentum3Bps"] is not None
                and features["momentum3Bps"] >= float(signal["momentum3MinBps"]),
                "priceTurn5": features["rebound5Bps"] is not None
                and features["rebound5Bps"] >= float(signal["rebound5MinBps"]),
                "micropriceEdge": features["micropriceEdgeBps"] is not None
                and features["micropriceEdgeBps"] >= float(signal["micropriceEdgeMinBps"]),
                "ofiVelocity": features["ofiVelocity3MinBps"] is not None
                and features["ofiVelocity3MinBps"] >= float(signal["ofiVelocity3MinBpsMin"]),
            }
        return {
            **common,
            "activeBuyPressure": len(ratios) == 3
            and all(value is not None and value <= float(signal["activeBuyRatioMax"]) for value in ratios),
            "largeOrderFlow": features["largeOrderNetRatio"] is not None
            and features["largeOrderNetRatio"] <= float(signal["largeOrderNetRatioMax"]),
            "nearTouchBook": features["nearTouchImbalance"] is not None
            and features["nearTouchImbalance"] <= float(signal["nearTouchImbalanceMax"]),
            "vwapLocation": features["vwapExtensionBps"] is not None
            and features["vwapExtensionBps"] >= float(signal["vwapExtensionMinBps"]),
            "momentum3": features["momentum3Bps"] is not None
            and features["momentum3Bps"] <= float(signal["momentum3MaxBps"]),
            "priceTurn5": features["pullback5Bps"] is not None
            and features["pullback5Bps"] >= float(signal["pullback5MinBps"]),
            "micropriceEdge": features["micropriceEdgeBps"] is not None
            and features["micropriceEdgeBps"] <= float(signal["micropriceEdgeMaxBps"]),
            "ofiVelocity": features["ofiVelocity3MinBps"] is not None
            and features["ofiVelocity3MinBps"] <= float(signal["ofiVelocity3MinBpsMax"]),
        }

    def _reject_pending(self, minute: str, reason: str) -> dict[str, Any]:
        self.counts["rejected"] += 1
        self.pending = None
        return self._emit("rejected", minute, {"reason": reason})

    def _advance_pending(self, record: dict[str, Any]) -> dict[str, Any] | None:
        if self.pending is None:
            return None
        minute = str(record["exchangeMinute"])
        expected = next_continuous_minute(str(self.pending["lastMinute"]))
        if minute != expected:
            return self._reject_pending(minute, "non-contiguous-minute")
        if self.pending["stage"] == "candidate":
            direction = str(self.pending["direction"])
            entry_side = "buy" if direction == "positive-t" else "sell"
            entry_fill = consume_book(record, entry_side, int(self.config["quantity"]))
            if entry_fill is None:
                return self._reject_pending(minute, "entry-book-unavailable")
            exit_config = self.config["directions"][direction]["exit"]
            atr = float(self.pending["costEvaluation"]["atr14"])
            entry_price = float(entry_fill["executionPrice"])
            target_move = max(
                atr * float(exit_config["targetAtrMultiple"]),
                entry_price * float(exit_config["minimumTargetBps"]) / 10_000,
            )
            stop_move = atr * float(exit_config["stopAtrMultiple"])
            self.pending.update({
                "stage": "entered",
                "entryMinute": minute,
                "entryRecord": self._compact_record(record),
                "entryPrice": entry_price,
                "targetPrice": entry_price + target_move if direction == "positive-t" else entry_price - target_move,
                "stopPrice": entry_price - stop_move if direction == "positive-t" else entry_price + stop_move,
                "remainingHoldMinutes": int(exit_config["maxHoldTradingMinutes"]),
                "lastMinute": minute,
            })
            self.counts["entries"] += 1
            return self._emit("entry", minute, {
                "signalMinute": self.pending["signalMinute"],
                "direction": direction,
                "quantity": int(self.config["quantity"]),
                "entryPrice": entry_price,
                "targetPrice": self.pending["targetPrice"],
                "stopPrice": self.pending["stopPrice"],
            })

        self.pending["lastMinute"] = minute
        self.pending["remainingHoldMinutes"] -= 1
        direction = str(self.pending["direction"])
        price = finite_number(record.get("lastPrice"))
        reached_target = price is not None and (
            price >= float(self.pending["targetPrice"])
            if direction == "positive-t" else price <= float(self.pending["targetPrice"])
        )
        reached_stop = price is not None and (
            price <= float(self.pending["stopPrice"])
            if direction == "positive-t" else price >= float(self.pending["stopPrice"])
        )
        exit_reason = "target" if reached_target else "stop" if reached_stop else (
            "time" if self.pending["remainingHoldMinutes"] <= 0 else None
        )
        if exit_reason is None:
            self._save()
            return None

        entry_record = self.pending["entryRecord"]
        actual = execute_t(entry_record, record, self.config, direction)
        stress2 = execute_t(entry_record, record, self.config, direction, 2)
        stress5 = execute_t(entry_record, record, self.config, direction, 5)
        transfer = execute_t(entry_record, record, self.config, direction, 0, True)
        if not all((actual, stress2, stress5, transfer)):
            return self._reject_pending(minute, "exit-book-unavailable")
        payload = {
            "signalMinute": self.pending["signalMinute"],
            "entryMinute": self.pending["entryMinute"],
            "exitMinute": minute,
            "direction": direction,
            "exitReason": exit_reason,
            "quantity": int(self.config["quantity"]),
            "features": self.pending["features"],
            "regime": self.pending["regime"],
            "actual": actual,
            "stress2BpsPerSide": stress2,
            "stress5BpsPerSide": stress5,
            "withTransferFee": transfer,
        }
        self.pending = None
        self.counts["resolved"] += 1
        if actual["net"] > 0:
            self.counts["wins"] += 1
            self.counts["winningNet"] += float(actual["net"])
        elif actual["net"] < 0:
            self.counts["losingNet"] += float(actual["net"])
        if stress5["net"] > 0:
            self.counts["stress5Wins"] += 1
        return self._emit("resolved", minute, payload)

    def observe(self, record: dict[str, Any]) -> dict[str, Any] | None:
        minute = str(record.get("exchangeMinute") or "")
        if record.get("symbol") != "601899" or not is_continuous_minute(minute):
            return None
        date = minute[:8]
        with self.lock:
            if minute == self.last_minute:
                return None
            if self.current_date and self.current_date != date:
                if self.pending is not None:
                    self._reject_pending(minute, "trading-date-ended")
                self.minutes.clear()
            self.current_date = date
            self.observed_dates.add(date)
            self.last_minute = minute

            event = self._advance_pending(record)
            self.minutes.append(record)
            self.minutes = self.minutes[-260:]
            features = self._features()
            if features is None:
                self._save()
                return event

            def rounded(value: Any) -> Any:
                if isinstance(value, list):
                    return [rounded(item) for item in value]
                if isinstance(value, dict):
                    return {key: rounded(item) for key, item in value.items()}
                return round(value, 6) if isinstance(value, float) else value

            rounded_features = rounded(features)
            regime = self.regime_context or {}
            evaluations = {}
            observation_event = None
            clock = minute[-4:]
            for direction, direction_config in self.config["directions"].items():
                signal = direction_config["signal"]
                in_window = (
                    str(signal["start"]).replace(":", "")
                    <= clock
                    <= str(signal["end"]).replace(":", "")
                )
                regime_passes = (
                    regime.get("date") == date
                    and bool(regime.get("ready"))
                    and direction in (regime.get("allowedDirections") or [])
                )
                factor_gates = self._factor_gates(direction, features, regime_passes)
                cost_evaluation = self._cost_evaluation(record, direction, features)
                all_gates = {"timeWindow": in_window, **factor_gates, "costCoverage": bool(cost_evaluation["passed"])}
                evaluations[direction] = {
                    "passed": all(all_gates.values()),
                    "passedCount": sum(all_gates.values()),
                    "totalCount": len(all_gates),
                    "gates": all_gates,
                    "costEvaluation": rounded(cost_evaluation),
                }
                candidate_key = f"{date}:{direction}"
                base_gate_names = ("timeWindow", "marketRegime", "l2Quality", "vwapLocation", "momentum3", "priceTurn5")
                base_passes = all(all_gates[name] for name in base_gate_names)
                if base_passes and candidate_key not in self.observed_candidate_keys:
                    self.observed_candidate_keys.add(candidate_key)
                    self.counts["candidateWaves"] += 1
                    observation_event = self._emit("observation", minute, {
                        "direction": direction,
                        "quantity": int(self.config["quantity"]),
                        "features": rounded_features,
                        "gates": all_gates,
                    })

            self.latest_evaluation = {
                "exchangeMinute": minute,
                "passed": any(value["passed"] for value in evaluations.values()),
                "directions": evaluations,
                "features": rounded_features,
            }
            self._save()
            if event is not None or self.pending is not None:
                return event or observation_event

            for direction, evaluation in evaluations.items():
                candidate_key = f"{date}:{direction}"
                if candidate_key in self.signaled_keys or not evaluation["passed"]:
                    continue
                self.signaled_keys.add(candidate_key)
                self.counts["promotedCandidates"] += 1
                self.counts["candidates"] += 1
                self.pending = {
                    "stage": "candidate",
                    "direction": direction,
                    "signalMinute": minute,
                    "lastMinute": minute,
                    "features": rounded_features,
                    "regime": regime,
                    "costEvaluation": evaluation["costEvaluation"],
                }
                return self._emit("candidate", minute, {
                    "direction": direction,
                    "quantity": int(self.config["quantity"]),
                    "features": rounded_features,
                    "regime": regime,
                    "costEvaluation": evaluation["costEvaluation"],
                })
            return event or observation_event
