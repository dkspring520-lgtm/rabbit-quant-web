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
LEGACY_STRATEGY_ID = "closure-v2-shadow-zijin-reverse-t"
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


def parse_tencent_exchange_minute(value: Any) -> str | None:
    timestamp = str(value or "").strip()
    for pattern in ("%Y%m%d%H%M%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(timestamp, pattern).strftime("%Y%m%d-%H%M")
        except ValueError:
            continue
    return None


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


def trading_minute_index(minute: str) -> int | None:
    if not is_continuous_minute(minute):
        return None
    clock = minute[-4:]
    hour = int(clock[:2])
    value = int(clock[2:])
    if hour == 9:
        return value - 30
    if hour == 10:
        return 30 + value
    if hour == 11:
        return 90 + value
    if hour == 13:
        return 120 + value
    if hour == 14:
        return 180 + value
    return None


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
        self.peer_snapshots: dict[str, dict[str, Any]] = {}
        self.legacy_state: dict[str, Any] | None = None
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
        if payload.get("strategyId") == LEGACY_STRATEGY_ID:
            self.legacy_state = {
                "strategyId": LEGACY_STRATEGY_ID,
                "lastMinute": payload.get("lastMinute"),
                "counts": payload.get("counts") or {},
                "migratedAt": utc_now(),
                "excludedFromV2PromotionMetrics": True,
            }
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
        restored_peers = payload.get("peerSnapshots") or {}
        if isinstance(restored_peers, dict):
            self.peer_snapshots = {
                str(minute): snapshot
                for minute, snapshot in restored_peers.items()
                if isinstance(snapshot, dict)
            }
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
            "peerSnapshots": dict(sorted(self.peer_snapshots.items())[-260:]),
            "legacyReverseShadow": self.legacy_state,
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
                "peerSnapshotMinute": max(self.peer_snapshots, default=None),
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

    def peer_refresh_seconds(self) -> float:
        return max(10.0, float(self.config["peerResonance"]["refreshSeconds"]))

    @staticmethod
    def _fetch_peer_quotes(symbols: list[str], timeout: float = 8) -> dict[str, dict[str, Any]]:
        query = urllib.parse.quote(",".join(symbols), safe=",")
        request = urllib.request.Request(
            f"https://qt.gtimg.cn/q={query}",
            headers={"User-Agent": "rabbit-quant-shadow/1.0"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("gb18030", "replace")
        quotes: dict[str, dict[str, Any]] = {}
        for line in text.splitlines():
            if '="' not in line:
                continue
            prefix, raw = line.split('="', 1)
            symbol = prefix.rsplit("v_", 1)[-1]
            fields = raw.rstrip('";').split("~")
            if len(fields) <= 30:
                continue
            price = finite_number(fields[3])
            previous_close = finite_number(fields[4])
            minute = parse_tencent_exchange_minute(fields[30])
            if not price or not previous_close or minute is None:
                continue
            quotes[symbol] = {
                "exchangeMinute": minute,
                "price": price,
                "previousClose": previous_close,
                "returnBps": (price / previous_close - 1) * 10_000,
            }
        return quotes

    @staticmethod
    def _fresh_peer_returns(
        quotes: dict[str, dict[str, Any]],
        reference_minute: str,
        maximum_age_minutes: int,
    ) -> dict[str, float]:
        reference_index = trading_minute_index(reference_minute)
        if reference_index is None:
            return {}
        returns = {}
        for symbol, quote in quotes.items():
            quote_minute = str(quote.get("exchangeMinute") or "")
            quote_index = trading_minute_index(quote_minute)
            value = finite_number(quote.get("returnBps"))
            age = reference_index - quote_index if quote_index is not None else None
            if (
                quote_minute[:8] == reference_minute[:8]
                and age is not None
                and 0 <= age <= maximum_age_minutes
                and value is not None
            ):
                returns[symbol] = value
        return returns

    def set_peer_snapshot(
        self,
        minute: str,
        returns_bps: dict[str, Any],
        source: str = "provided",
    ) -> dict[str, Any] | None:
        if not is_continuous_minute(minute):
            return None
        normalized = {
            symbol: value
            for symbol, raw in returns_bps.items()
            if (value := finite_number(raw)) is not None
        }
        if not normalized:
            return None
        snapshot = {
            "exchangeMinute": minute,
            "returnsBps": normalized,
            "source": source,
            "observedAt": utc_now(),
        }
        with self.lock:
            self.peer_snapshots[minute] = snapshot
            self.peer_snapshots = dict(sorted(self.peer_snapshots.items())[-260:])
            self._save()
        return dict(snapshot)

    def refresh_peer_context(self) -> dict[str, Any] | None:
        peer = self.config["peerResonance"]
        symbols = {
            str(peer["zijin"]),
            *[str(symbol) for symbol in peer.get("benchmarks", [])],
        }
        for members in (peer.get("groups") or {}).values():
            symbols.update(str(symbol) for symbol in members)
        try:
            quotes = self._fetch_peer_quotes(sorted(symbols))
            zijin_quote = quotes.get(str(peer["zijin"]))
            if not zijin_quote:
                return None
            minute = str(zijin_quote["exchangeMinute"])
            returns_bps = self._fresh_peer_returns(
                quotes,
                minute,
                int(peer["maximumAgeMinutes"]),
            )
            if str(peer["zijin"]) not in returns_bps:
                return None
            return self.set_peer_snapshot(
                minute,
                returns_bps,
                source="tencent-realtime-quotes",
            )
        except Exception:
            return None

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

    def _opening_structure_features(self, direction: str) -> dict[str, Any]:
        config = self.config["openingStructure"]
        aligned_run = 0
        maximum_run = 0
        last_aligned_minute: str | None = None
        latest_gap_bps = None
        latest_move_bps = None
        for record in self.minutes:
            minute = str(record.get("exchangeMinute") or "")
            clock = minute[-4:]
            if clock < "0935" or clock > str(config["end"]).replace(":", ""):
                continue
            previous_close = finite_number(record.get("previousClose"))
            session_open = finite_number(record.get("sessionOpen"))
            price = finite_number(record.get("lastPrice"))
            if not previous_close or not session_open or price is None:
                aligned_run = 0
                last_aligned_minute = None
                continue
            gap_bps = (session_open / previous_close - 1) * 10_000
            move_bps = (price / session_open - 1) * 10_000
            latest_gap_bps = gap_bps
            latest_move_bps = move_bps
            aligned = (
                gap_bps <= float(config["positiveTGapMaxBps"])
                and move_bps >= float(config["positiveTRecoveryMinBps"])
                if direction == "positive-t"
                else gap_bps >= float(config["reverseTGapMinBps"])
                and move_bps <= -float(config["reverseTWeakeningMinBps"])
            )
            if aligned:
                aligned_run = (
                    aligned_run + 1
                    if last_aligned_minute and next_continuous_minute(last_aligned_minute) == minute
                    else 1
                )
                last_aligned_minute = minute
                maximum_run = max(maximum_run, aligned_run)
            else:
                aligned_run = 0
                last_aligned_minute = None
        minimum = int(config["minimumAlignedMinutes"])
        return {
            "passed": maximum_run >= minimum,
            "gapBps": latest_gap_bps,
            "moveFromOpenBps": latest_move_bps,
            "maximumAlignedMinutes": maximum_run,
            "minimumAlignedMinutes": minimum,
        }

    def _l2_price_response_features(
        self,
        direction: str,
        window: list[dict[str, Any]],
    ) -> dict[str, Any]:
        config = self.config["l2PriceResponse"]
        minimum = int(config["minimumAlignedMinutes"])
        ofi_values = [self._ofi(record) for record in window[-minimum:]]
        mean_ofi = (
            sum(value for value in ofi_values if value is not None) / len(ofi_values)
            if len(ofi_values) == minimum and all(value is not None for value in ofi_values)
            else None
        )
        response_base = finite_number(window[-minimum - 1].get("lastPrice")) if len(window) > minimum else None
        current_price = finite_number(window[-1].get("lastPrice"))
        response_bps = (
            (current_price / response_base - 1) * 10_000
            if current_price is not None and response_base and response_base > 0 else None
        )
        aligned_minutes = 0
        for index in range(len(window) - 1, 0, -1):
            record = window[index]
            previous = window[index - 1]
            minute = str(record.get("exchangeMinute") or "")
            previous_minute = str(previous.get("exchangeMinute") or "")
            if next_continuous_minute(previous_minute) != minute:
                break
            ofi = self._ofi(record)
            price = finite_number(record.get("lastPrice"))
            previous_price = finite_number(previous.get("lastPrice"))
            if ofi is None or price is None or not previous_price:
                break
            price_change_bps = (price / previous_price - 1) * 10_000
            aligned = (
                ofi >= float(config["positiveTMeanOfiMin"])
                and price_change_bps >= 0
                if direction == "positive-t"
                else ofi <= float(config["reverseTMeanOfiMax"])
                and price_change_bps <= 0
            )
            if not aligned:
                break
            aligned_minutes += 1
        passed = (
            aligned_minutes >= minimum
            and mean_ofi is not None
            and response_bps is not None
            and (
                mean_ofi >= float(config["positiveTMeanOfiMin"])
                and response_bps >= float(config["positiveTPriceResponse3MinBpsMin"])
                if direction == "positive-t"
                else mean_ofi <= float(config["reverseTMeanOfiMax"])
                and response_bps <= float(config["reverseTPriceResponse3MinBpsMax"])
            )
        )
        return {
            "passed": passed,
            "meanOfi": mean_ofi,
            "priceResponse3MinBps": response_bps,
            "consecutiveAlignedMinutes": aligned_minutes,
            "minimumAlignedMinutes": minimum,
        }

    def _peer_snapshot_metrics(self, snapshot: dict[str, Any], direction: str) -> dict[str, Any]:
        config = self.config["peerResonance"]
        returns = snapshot.get("returnsBps") or {}
        zijin_return = finite_number(returns.get(str(config["zijin"])))
        peer_symbols = {
            str(symbol)
            for members in (config.get("groups") or {}).values()
            for symbol in members
        }
        available_peers = [symbol for symbol in peer_symbols if finite_number(returns.get(symbol)) is not None]
        coverage = len(available_peers) / len(peer_symbols) if peer_symbols else 0.0
        groups = {}
        aligned_groups = 0
        for name, members in (config.get("groups") or {}).items():
            normalized_members = [str(symbol) for symbol in members]
            values = [
                value for symbol in normalized_members
                if (value := finite_number(returns.get(symbol))) is not None
            ]
            group_coverage = len(values) / len(normalized_members) if normalized_members else 0.0
            breadth = sum(value > 0 for value in values) / len(values) if values else None
            average = sum(values) / len(values) if values else None
            aligned = False
            if zijin_return is not None and breadth is not None and average is not None:
                aligned = (
                    breadth >= float(config["positiveTMinimumBreadth"])
                    and average - zijin_return >= float(config["positiveTMinimumLagBps"])
                    if direction == "positive-t"
                    else breadth <= float(config["reverseTMaximumBreadth"])
                    and zijin_return - average >= float(config["reverseTMinimumOutperformanceBps"])
                )
                aligned = aligned and group_coverage >= float(config["minimumCoverage"])
            if aligned:
                aligned_groups += 1
            groups[name] = {
                "coverage": group_coverage,
                "breadth": breadth,
                "averageReturnBps": average,
                "aligned": aligned,
            }
        passed = (
            zijin_return is not None
            and coverage >= float(config["minimumCoverage"])
            and aligned_groups >= int(config["minimumAlignedGroups"])
        )
        return {
            "passed": passed,
            "coverage": coverage,
            "alignedGroups": aligned_groups,
            "minimumAlignedGroups": int(config["minimumAlignedGroups"]),
            "zijinReturnBps": zijin_return,
            "groups": groups,
        }

    def _peer_resonance_features(self, minute: str, direction: str) -> dict[str, Any]:
        config = self.config["peerResonance"]
        current_index = trading_minute_index(minute)
        eligible = [
            snapshot for snapshot_minute, snapshot in sorted(self.peer_snapshots.items())
            if snapshot_minute[:8] == minute[:8] and snapshot_minute <= minute
        ]
        if not eligible or current_index is None:
            return {
                "passed": False,
                "available": False,
                "consecutiveAlignedMinutes": 0,
            }
        latest = eligible[-1]
        reference_minute = str(latest.get("exchangeMinute") or "")
        latest_index = trading_minute_index(reference_minute)
        age = None if latest_index is None else current_index - latest_index
        if age is None or age < 0 or age > int(config["maximumAgeMinutes"]):
            return {
                "passed": False,
                "available": False,
                "snapshotMinute": reference_minute,
                "ageMinutes": age,
                "consecutiveAlignedMinutes": 0,
            }
        consecutive = 0
        last_minute = None
        latest_metrics = None
        for snapshot in reversed(eligible):
            snapshot_minute = str(snapshot.get("exchangeMinute") or "")
            if last_minute is not None and next_continuous_minute(snapshot_minute) != last_minute:
                break
            metrics = self._peer_snapshot_metrics(snapshot, direction)
            if not metrics["passed"]:
                break
            consecutive += 1
            last_minute = snapshot_minute
            if latest_metrics is None:
                latest_metrics = metrics
        minimum = int(config["minimumConsecutiveMinutes"])
        metrics = latest_metrics or self._peer_snapshot_metrics(latest, direction)
        return {
            **metrics,
            "passed": consecutive >= minimum,
            "available": True,
            "snapshotMinute": reference_minute,
            "ageMinutes": age,
            "consecutiveAlignedMinutes": consecutive,
            "minimumConsecutiveMinutes": minimum,
        }

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
        current_minute = str(current.get("exchangeMinute") or "")
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
            "openingStructure": {
                direction: self._opening_structure_features(direction)
                for direction in self.config["directions"]
            },
            "l2PriceResponse": {
                direction: self._l2_price_response_features(direction, window)
                for direction in self.config["directions"]
            },
            "peerResonance": {
                direction: self._peer_resonance_features(current_minute, direction)
                for direction in self.config["directions"]
            },
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

    def _factor_score(
        self,
        direction: str,
        features: dict[str, Any],
        cost_evaluation: dict[str, Any],
    ) -> dict[str, Any]:
        config = self.config["factorScore"]
        opening = features["openingStructure"][direction]
        l2_response = features["l2PriceResponse"][direction]
        peer = features["peerResonance"][direction]
        components = {
            "openingStructure": float(config["openingStructureWeight"]) if opening["passed"] else 0.0,
            "l2PriceResponse": float(config["l2PriceResponseWeight"]) if l2_response["passed"] else 0.0,
            "costAtr": float(config["costAtrWeight"]) if cost_evaluation["passed"] else 0.0,
            "peerResonance": (
                float(config["peerResonanceWeight"])
                if peer["passed"] else float(config["missingPeerDataScore"])
            ),
        }
        score = sum(components.values())
        minimum = float(config["minimumUpgradeScore"])
        return {
            "passed": score >= minimum,
            "score": score,
            "minimumUpgradeScore": minimum,
            "components": components,
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
            "factorScore": self.pending.get("factorScore"),
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
            self.last_minute = minute

            event = self._advance_pending(record)
            self.minutes.append(record)
            self.minutes = self.minutes[-260:]
            features = self._features()
            if features is None:
                self._save()
                return event
            if features["consecutiveValidL2Minutes"] >= int(
                self.config["l2Quality"]["minimumConsecutiveValidMinutes"]
            ):
                self.observed_dates.add(date)

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
                factor_score = self._factor_score(direction, features, cost_evaluation)
                all_gates = {
                    "timeWindow": in_window,
                    **factor_gates,
                    "costCoverage": bool(cost_evaluation["passed"]),
                    "factorScore": bool(factor_score["passed"]),
                }
                evaluations[direction] = {
                    "passed": all(all_gates.values()),
                    "passedCount": sum(all_gates.values()),
                    "totalCount": len(all_gates),
                    "gates": all_gates,
                    "costEvaluation": rounded(cost_evaluation),
                    "factorScore": rounded(factor_score),
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
                        "factorScore": rounded(factor_score),
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
                    "factorScore": evaluation["factorScore"],
                }
                return self._emit("candidate", minute, {
                    "direction": direction,
                    "quantity": int(self.config["quantity"]),
                    "features": rounded_features,
                    "regime": regime,
                    "costEvaluation": evaluation["costEvaluation"],
                    "factorScore": evaluation["factorScore"],
                })
            return event or observation_event
