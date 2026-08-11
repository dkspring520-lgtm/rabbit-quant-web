#!/usr/bin/env python3
"""Causal L2 collector for Smart-T V4 and Zijin forward research.

The live state is used only as a confirmation/veto.  One immutable feature
snapshot is also recorded per exchange minute for 601899.  Targets are not
created here: they may only be attached after the future minute has arrived.
"""

import asyncio
import json
import os
import tempfile
import time
from collections import deque
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import nats
import numpy as np
from zijin_l2_forward_labels import refresh_labels_and_state
from zijin_closure_v2_reverse_shadow import ZijinClosureV2ReverseShadow
from zijin_l2_second_state import (
    ForwardMinuteBuffer,
    SecondLevelSignalMachine,
    book_persistence,
    freeze_microstructure_features,
    flow_window,
    weighted_book,
)

SNAPSHOT = np.dtype([
    ("symbol", "S32"), ("market", "u1"), ("date", "<i4"), ("time", "<i4"),
    ("pre_close", "<u4"), ("open", "<u4"), ("high", "<u4"), ("low", "<u4"), ("last", "<u4"),
    ("volume", "<i8"), ("turnover", "<i8"), ("num_trades", "<i8"),
    ("ask_price", "<u4", 10), ("ask_vol", "<i8", 10),
    ("bid_price", "<u4", 10), ("bid_vol", "<i8", 10),
    ("ask_num_orders", "<i4", 10), ("bid_num_orders", "<i4", 10),
    ("total_ask_vol", "<i8"), ("total_bid_vol", "<i8"),
    ("avg_ask_price", "<u4"), ("avg_bid_price", "<u4"),
    ("limit_up", "<u4"), ("limit_down", "<u4"), ("iopv", "<u4"), ("pre_close_iopv", "<u4"),
    ("trading_phase", "S8"), ("is_after_hours", "<i4"),
], align=False)

TRANSACTION = np.dtype([
    ("symbol", "S32"), ("market", "u1"), ("date", "<i4"), ("time", "<i4"), ("index", "<i8"),
    ("price", "<u4"), ("volume", "<i8"), ("turnover", "<i8"),
    ("buy_id", "<i8"), ("sell_id", "<i8"), ("bs_flag", "S1"),
    ("order_kind", "S1"), ("function_code", "S1"), ("channel", "<i4"),
], align=False)

ORDER = np.dtype([
    ("symbol", "S32"), ("market", "u1"), ("date", "<i4"), ("time", "<i4"), ("index", "<i8"),
    ("order_no", "<i8"), ("price", "<u4"), ("volume", "<i8"),
    ("bs_flag", "S1"), ("order_kind", "S1"), ("function_code", "S1"), ("channel", "<i4"),
], align=False)

def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def atomic_json(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        temporary = handle.name
    os.replace(temporary, target)

def decoded(value):
    return bytes(value).rstrip(b"\0").decode("ascii", "ignore")

def exchange_minute(value):
    if not value or "-" not in value:
        return None
    date, clock = value.split("-", 1)
    return f"{date}-{clock[:4]}" if len(date) == 8 and len(clock) >= 4 else None

def is_a_share_cash_session(minute):
    """Accept only regular A-share auction and continuous-trading minutes.

    The vendor can replay packets during weekends and after hours.  They are
    useful for connection diagnostics, but must never become forward-training
    observations.
    """
    if not isinstance(minute, str):
        return False
    try:
        observed = datetime.strptime(minute, "%Y%m%d-%H%M")
    except ValueError:
        return False
    if observed.weekday() >= 5:
        return False
    clock = observed.strftime("%H%M")
    return (
        "0915" <= clock <= "0925"
        or "0930" <= clock <= "1129"
        or "1300" <= clock <= "1459"
    )

def is_live_a_share_session():
    observed = datetime.now(ZoneInfo("Asia/Shanghai"))
    if observed.weekday() >= 5:
        return False
    clock = observed.strftime("%H%M")
    return (
        "0915" <= clock <= "0925"
        or "0930" <= clock <= "1129"
        or "1300" <= clock <= "1459"
    )

def market_phase(minute):
    """Classify causal Zijin observations for the early-morning study."""
    if not is_a_share_cash_session(minute):
        return None
    clock = minute[-4:]
    if clock < "0920":
        return "auction-probe"
    if clock <= "0925":
        return "auction-locked"
    if clock <= "0934":
        return "open-discovery"
    if clock <= "0944":
        return "open-confirmation"
    if clock <= "1000":
        return "open-persistence"
    return "continuous"

def trailing_big_sweep_streak(transactions, side, threshold):
    """Count the latest same-side large prints, ignoring small-print noise."""
    streak = 0
    for row in reversed(transactions):
        if row[3] < threshold:
            continue
        if row[1] != side:
            break
        streak += 1
    return streak

class Collector:
    def __init__(self):
        self.symbol = os.getenv("L2_SYMBOL", "601899")
        primary_url = os.getenv("L2_NATS_URL", "nats://quote6.base32.cn:4222")
        configured_urls = os.getenv(
            "L2_NATS_URLS",
            ",".join((
                primary_url,
                "nats://quote2.base32.cn:4222",
                "nats://quote1.base32.cn:4222",
                "nats://quote5.base32.cn:4222",
            )),
        )
        self.urls = list(dict.fromkeys(
            url.strip() for url in configured_urls.split(",") if url.strip()
        ))
        if not self.urls:
            self.urls = [primary_url]
        self.url = self.urls[0]
        self.user = os.environ["L2_NATS_USER"]
        self.password = os.environ["L2_NATS_PASSWORD"]
        self.state_path = os.getenv("L2_STATE_PATH", "/training-state/zijin-l2-orderflow.json")
        self.forward_path = os.getenv("L2_FORWARD_PATH", "/training-state/zijin-l2-forward.jsonl")
        self.second_event_path = os.getenv("L2_SECOND_EVENT_PATH", "/training-state/zijin-l2-second-events.jsonl")
        self.forward_label_path = os.getenv("L2_FORWARD_LABEL_PATH", "/training-state/zijin-l2-forward-labels.jsonl")
        self.forward_research_state_path = os.getenv("L2_FORWARD_RESEARCH_STATE_PATH", "/training-state/zijin-opening-l2-shadow.json")
        self.reverse_shadow_event_path = os.getenv("L2_REVERSE_SHADOW_EVENT_PATH", "/training-state/zijin-closure-v2-reverse-shadow.jsonl")
        self.reverse_shadow_state_path = os.getenv("L2_REVERSE_SHADOW_STATE_PATH", "/training-state/zijin-closure-v2-reverse-shadow-state.json")
        self.forward_min_samples = int(os.getenv("L2_FORWARD_MIN_SAMPLES", "1200"))
        self.forward_min_days = int(os.getenv("L2_FORWARD_MIN_DAYS", "10"))
        self.forward_min_opening_labels = int(os.getenv("L2_FORWARD_MIN_OPENING_LABELS", "200"))
        fixed_cost_pct = os.getenv("L2_FORWARD_COST_PCT", "").strip()
        self.forward_cost_pct = float(fixed_cost_pct) if fixed_cost_pct else None
        self.forward_cost_options = {
            "quantity": int(os.getenv("L2_FORWARD_QUANTITY", "1600")),
            "commission_pct_per_side": float(os.getenv("L2_FORWARD_COMMISSION_PCT_PER_SIDE", "0.025")),
            "stamp_tax_pct": float(os.getenv("L2_FORWARD_STAMP_TAX_PCT", "0.05")),
            "slippage_pct_per_side": float(os.getenv("L2_FORWARD_SLIPPAGE_PCT_PER_SIDE", "0.02")),
            "minimum_commission_yuan": float(os.getenv("L2_FORWARD_MIN_COMMISSION_YUAN", "5")),
            "minimum_net_pct": float(os.getenv("L2_FORWARD_MIN_NET_PCT", "0.12")),
            "minimum_net_yuan": float(os.getenv("L2_FORWARD_MIN_NET_YUAN", "30")),
            "minimum_gross_spread_yuan": float(os.getenv("L2_FORWARD_MIN_GROSS_SPREAD_YUAN", "0.10")),
        }
        self.stale_seconds = float(os.getenv("L2_STALE_SECONDS", "8"))
        self.subscribe_timeout = float(os.getenv("L2_SUBSCRIBE_TIMEOUT_SECONDS", "5"))
        self.big_order = float(os.getenv("L2_BIG_ORDER_NOTIONAL", "200000"))
        # The UI reads the atomically-published state file.  Keep this short enough
        # for an intraday monitor, without attempting per-packet filesystem writes.
        self.publish_interval = float(os.getenv("L2_PUBLISH_INTERVAL_SECONDS", "0.25"))
        self.transactions, self.orders = deque(), deque()
        self.book_samples = deque()
        self.second_signal_machine = SecondLevelSignalMachine()
        self.last_second_sequence = -1
        self.snapshot = self.last_message_at = self.last_exchange_time = None
        self.connected = self.authorization_error = False
        self.parse_errors = self.reconnects = 0
        self.failovers = 0
        self.failover_reason = None
        self.message_counts = {"snapshot": 0, "transaction": 0, "order": 0}
        self.forward_minutes = set()
        self.forward_days = set()
        self.last_forward_minute = None
        # Keep a full A-share day so a page reload can rebuild the Zijin chart
        # from broker L2 instead of falling back to a public minute close.
        self.minute_bars = deque(maxlen=260)
        self.current_minute_bar = None
        # Minute-level active-flow ledger for the dedicated "主力追踪" chart.
        # It records large prints rather than trying to identify an account.
        self.minute_flows = {}
        self.restored_minute_rows = {}
        self.forward_label_count = 0
        self.forward_research_status = "collecting-forward-evidence"
        self.forward_minute_buffer = ForwardMinuteBuffer()
        self.reverse_shadow = ZijinClosureV2ReverseShadow(
            event_path=self.reverse_shadow_event_path,
            state_path=self.reverse_shadow_state_path,
            config_path=os.getenv("L2_REVERSE_SHADOW_CONFIG_PATH") or None,
        )
        self.load_intraday_flow_state()
        self.load_intraday_flow_forward_fallback()
        self.load_forward_index()
        self.refresh_forward_research()

    def load_intraday_flow_state(self):
        """Resume today's published minute flow after a collector restart."""
        try:
            payload = json.loads(Path(self.state_path).read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return
        rows = payload.get("recentMinutes", [])
        if not isinstance(rows, list):
            return
        dates = [
            str(row.get("exchangeMinute", ""))[:8]
            for row in rows if isinstance(row, dict) and len(str(row.get("exchangeMinute", ""))) >= 8
        ]
        active_date = max(dates, default="")
        for row in rows:
            if not isinstance(row, dict):
                continue
            minute = str(row.get("exchangeMinute", ""))
            if not active_date or not minute.startswith(active_date) or not is_a_share_cash_session(minute):
                continue
            self.minute_flows[minute] = {
                "activeBuyNotional": float(row.get("activeBuyNotional", 0) or 0),
                "activeSellNotional": float(row.get("activeSellNotional", 0) or 0),
                "activeBuyVolume": int(row.get("activeBuyVolume", 0) or 0),
                "activeSellVolume": int(row.get("activeSellVolume", 0) or 0),
                "bigBuyNotional": float(row.get("bigBuyNotional", 0) or 0),
                "bigSellNotional": float(row.get("bigSellNotional", 0) or 0),
                "bigBuyVolume": int(row.get("bigBuyVolume", 0) or 0),
                "bigSellVolume": int(row.get("bigSellVolume", 0) or 0),
                "bigBuyCount": int(row.get("bigBuyCount", 0) or 0),
                "bigSellCount": int(row.get("bigSellCount", 0) or 0),
            }
            self.restored_minute_rows[minute] = {
                "time": minute[-4:],
                "exchangeMinute": minute,
                "price": float(row.get("price", 0) or 0),
                "open": float(row.get("open", row.get("price", 0)) or 0),
                "high": float(row.get("high", row.get("price", 0)) or 0),
                "low": float(row.get("low", row.get("price", 0)) or 0),
                "volume": int(row.get("volume", 0) or 0),
                "amount": float(row.get("amount", 0) or 0),
                "averagePrice": row.get("averagePrice"),
            }

    def load_intraday_flow_forward_fallback(self):
        """Backfill restart gaps from the immutable one-sample-per-minute ledger.

        The primary state contains exact minute aggregates. The forward ledger
        stores a causal trailing-60-second snapshot, so it is used only when an
        exact minute disappeared during a restart and never replaces an exact
        row that was restored successfully.
        """
        records = {}
        try:
            with Path(self.forward_path).open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    minute = value.get("exchangeMinute")
                    if isinstance(minute, str) and is_a_share_cash_session(minute):
                        records[minute] = value
        except (FileNotFoundError, OSError):
            return
        if not records:
            return
        active_date = (
            max(self.minute_flows)[:8]
            if self.minute_flows
            else max(records)[:8]
        )
        for minute, record in records.items():
            if not minute.startswith(active_date) or minute in self.minute_flows:
                continue
            flow = record.get("flow", {})
            if not isinstance(flow, dict):
                continue
            active_buy = float(flow.get("activeBuyNotional60s", 0) or 0)
            active_sell = float(flow.get("activeSellNotional60s", 0) or 0)
            big_buy = float(flow.get("bigBuyNotional60s", 0) or 0)
            big_sell = float(flow.get("bigSellNotional60s", 0) or 0)
            self.minute_flows[minute] = {
                "activeBuyNotional": active_buy,
                "activeSellNotional": active_sell,
                "activeBuyVolume": 0,
                "activeSellVolume": 0,
                "bigBuyNotional": big_buy,
                "bigSellNotional": big_sell,
                "bigBuyVolume": 0,
                "bigSellVolume": 0,
                "bigBuyCount": 0,
                "bigSellCount": 0,
            }
            price = float(record.get("lastPrice", 0) or 0)
            self.restored_minute_rows[minute] = {
                "time": minute[-4:],
                "exchangeMinute": minute,
                "price": price,
                "open": price,
                "high": price,
                "low": price,
                "volume": 0,
                "amount": 0,
                "averagePrice": None,
                "flowRecovery": "causal-rolling-60s",
            }

    def load_forward_index(self):
        try:
            with Path(self.forward_path).open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    minute = value.get("exchangeMinute")
                    if isinstance(minute, str) and is_a_share_cash_session(minute):
                        self.forward_minutes.add(minute)
                        self.forward_days.add(minute[:8])
                        self.last_forward_minute = minute
        except FileNotFoundError:
            pass

    def refresh_forward_research(self):
        """Write delayed outcomes separately; this is never part of V4 execution."""
        try:
            study = refresh_labels_and_state(
                self.forward_path, self.forward_label_path, self.forward_research_state_path,
                self.forward_cost_pct, self.forward_min_samples, self.forward_min_days,
                self.forward_min_opening_labels, **self.forward_cost_options,
            )
            self.forward_label_count = study.get("coverage", {}).get("labeledObservations", 0)
            self.forward_research_status = study.get("status", "collecting-forward-evidence")
        except Exception:
            # A research-ledger failure must never interrupt live L2 monitoring.
            self.forward_research_status = "labeling-retry-pending"

    def parse(self, payload, dtype):
        if not payload or len(payload) % dtype.itemsize:
            self.parse_errors += 1
            return []
        return np.frombuffer(payload, dtype=dtype)

    async def on_snapshot(self, message):
        received = time.time()
        for row in self.parse(message.data, SNAPSHOT):
            self.snapshot = row.copy()
            self.last_exchange_time = f"{int(row['date']):08d}-{int(row['time']):09d}"
            minute = exchange_minute(self.last_exchange_time)
            price = float(row["last"]) / 10000
            if minute and price > 0:
                self.update_minute_bar(
                    minute, price, int(row["volume"]), int(row["turnover"]),
                    price_source="snapshot",
                )
            book = weighted_book(row)
            self.book_samples.append({
                "receivedAt": received,
                "obi": book.get("obi"),
                "micropriceEdgeBps": book.get("micropriceEdgeBps"),
                "price": price,
            })
            self.message_counts["snapshot"] += 1
        self.last_message_at = received

    @staticmethod
    def cumulative_average_price(cumulative_turnover, cumulative_volume, last_price):
        """Normalize vendor amount/volume units against the observed L2 price."""
        try:
            cumulative_turnover = float(cumulative_turnover)
            cumulative_volume = float(cumulative_volume)
            last_price = float(last_price)
        except (TypeError, ValueError):
            return None
        if not all(np.isfinite(value) for value in (cumulative_turnover, cumulative_volume, last_price)):
            return None
        if cumulative_volume <= 0 or cumulative_turnover <= 0 or last_price <= 0:
            return None
        raw = cumulative_turnover / cumulative_volume
        candidates = (raw, raw / 100, raw / 10000, raw * 100)
        average = min(candidates, key=lambda value: abs(value - last_price))
        return average if abs(average - last_price) / last_price <= 0.1 else None

    def update_minute_bar(
        self,
        minute,
        price,
        cumulative_volume=None,
        cumulative_turnover=None,
        *,
        price_source="snapshot",
        trade_volume=0,
        trade_turnover=0,
    ):
        """Merge snapshot counters with transaction-derived minute OHLC.

        Snapshots remain the authoritative source for cumulative volume and
        turnover. Once a real transaction is observed in a minute, snapshot
        prices can no longer change that minute's OHLC.
        """
        bar = self.current_minute_bar
        if bar is not None and bar["minute"] == minute:
            if price_source == "transaction":
                if bar.get("priceSource") != "tick-trades":
                    bar["open"] = bar["high"] = bar["low"] = bar["close"] = price
                    bar["priceSource"] = "tick-trades"
                    bar["observedTradeVolume"] = 0
                    bar["observedTradeTurnover"] = 0
                    bar["tradeCount"] = 0
                else:
                    bar["high"] = max(bar["high"], price)
                    bar["low"] = min(bar["low"], price)
                    bar["close"] = price
                bar["observedTradeVolume"] += max(0, int(trade_volume or 0))
                bar["observedTradeTurnover"] += max(0, float(trade_turnover or 0))
                bar["tradeCount"] += 1
            elif bar.get("priceSource") != "tick-trades":
                bar["high"] = max(bar["high"], price)
                bar["low"] = min(bar["low"], price)
                bar["close"] = price

            if cumulative_volume is not None and cumulative_turnover is not None:
                if not bar.get("hasCumulativeBaseline"):
                    bar["startVolume"] = max(
                        0,
                        int(cumulative_volume) - int(bar.get("observedTradeVolume", 0) or 0),
                    )
                    bar["startTurnover"] = max(
                        0.0,
                        float(cumulative_turnover) - float(bar.get("observedTradeTurnover", 0) or 0),
                    )
                    bar["hasCumulativeBaseline"] = True
                bar["endVolume"] = int(cumulative_volume)
                bar["endTurnover"] = float(cumulative_turnover)
                bar["volume"] = max(0, bar["endVolume"] - bar["startVolume"])
                bar["turnover"] = max(0, bar["endTurnover"] - bar["startTurnover"])
                bar["averagePrice"] = self.cumulative_average_price(
                    cumulative_turnover, cumulative_volume, price
                )
            elif bar.get("endVolume") is None:
                bar["volume"] = bar.get("observedTradeVolume", 0)
                bar["turnover"] = bar.get("observedTradeTurnover", 0)
            return
        if bar is not None:
            self.minute_bars.append(bar)
        same_day = bar is not None and bar["minute"][:8] == minute[:8]
        # A collector can restart in the middle of a session. Snapshot volume
        # and turnover are session-cumulative, so treating the first snapshot
        # as a zero-based minute creates one giant fake volume bar. Bootstrap
        # the first minute from the current counters; later snapshots add only
        # the genuinely observed increment.
        has_cumulative = cumulative_volume is not None and cumulative_turnover is not None
        first_observed_minute = bar is None
        prior_end_volume = bar.get("endVolume") if same_day else 0
        prior_end_turnover = bar.get("endTurnover") if same_day else 0
        start_volume = (
            int(cumulative_volume)
            if first_observed_minute and has_cumulative else int(prior_end_volume or 0)
        )
        start_turnover = (
            float(cumulative_turnover)
            if first_observed_minute and has_cumulative else float(prior_end_turnover or 0)
        )
        end_volume = int(cumulative_volume) if has_cumulative else None
        end_turnover = float(cumulative_turnover) if has_cumulative else None
        average = (
            self.cumulative_average_price(cumulative_turnover, cumulative_volume, price)
            if has_cumulative else None
        )
        observed_trade_volume = max(0, int(trade_volume or 0)) if price_source == "transaction" else 0
        observed_trade_turnover = max(0, float(trade_turnover or 0)) if price_source == "transaction" else 0
        self.current_minute_bar = {
            "minute": minute, "open": price, "high": price, "low": price, "close": price,
            "priceSource": "tick-trades" if price_source == "transaction" else "snapshot-fallback",
            "tradeCount": 1 if price_source == "transaction" else 0,
            "observedTradeVolume": observed_trade_volume,
            "observedTradeTurnover": observed_trade_turnover,
            "hasCumulativeBaseline": has_cumulative,
            "startVolume": start_volume, "endVolume": end_volume,
            "startTurnover": start_turnover, "endTurnover": end_turnover,
            "volume": max(0, end_volume - start_volume) if end_volume is not None else observed_trade_volume,
            "turnover": max(0, end_turnover - start_turnover) if end_turnover is not None else observed_trade_turnover,
            "averagePrice": average,
        }

    def atr_state(self, period=14, minimum_samples=4):
        bars = list(self.minute_bars)
        if self.current_minute_bar is not None:
            bars.append(dict(self.current_minute_bar))
        active_date = bars[-1]["minute"][:8] if bars else ""
        tick_bars = [
            bar for bar in bars
            if bar["minute"][:8] == active_date and bar.get("priceSource") == "tick-trades"
        ]
        if not tick_bars:
            return {
                "source": "broker-l2-tick-trades", "period": period, "samples": 0,
                "ready": False, "atr14": None, "atrPct14": None,
            }
        true_ranges = []
        previous_close = None
        for bar in tick_bars:
            high, low = bar["high"], bar["low"]
            true_range = high - low if previous_close is None else max(
                high - low, abs(high - previous_close), abs(low - previous_close)
            )
            true_ranges.append(true_range)
            previous_close = bar["close"]
        sample = true_ranges[-period:]
        ready = len(sample) >= minimum_samples
        atr = sum(sample) / len(sample) if ready else None
        close = tick_bars[-1]["close"]
        return {
            "source": "broker-l2-tick-trades", "period": period, "samples": len(sample),
            "ready": ready, "atr14": None if atr is None else round(atr, 6),
            "atrPct14": None if atr is None or close <= 0 else round(atr / close * 100, 6),
            "currentBar": tick_bars[-1],
        }

    def update_minute_flow(self, minute, side, volume, notional):
        if not is_a_share_cash_session(minute) or side not in {"B", "S"}:
            return
        # A new trading date starts a fresh all-day ledger.
        if self.minute_flows and minute[:8] != max(self.minute_flows)[:8]:
            self.minute_flows.clear()
            self.restored_minute_rows.clear()
        flow = self.minute_flows.setdefault(minute, {
            "activeBuyNotional": 0.0, "activeSellNotional": 0.0,
            "activeBuyVolume": 0, "activeSellVolume": 0,
            "bigBuyNotional": 0.0, "bigSellNotional": 0.0,
            "bigBuyVolume": 0, "bigSellVolume": 0,
            "bigBuyCount": 0, "bigSellCount": 0,
        })
        prefix = "Buy" if side == "B" else "Sell"
        flow[f"active{prefix}Notional"] += notional
        flow[f"active{prefix}Volume"] += volume
        if notional >= self.big_order:
            flow[f"big{prefix}Notional"] += notional
            flow[f"big{prefix}Volume"] += volume
            flow[f"big{prefix}Count"] += 1
        # Defensive cap if a vendor sends packets for more than one day.
        if len(self.minute_flows) > 260:
            for stale_minute in sorted(self.minute_flows)[:-260]:
                self.minute_flows.pop(stale_minute, None)

    def minute_flow_payload(self, minute):
        flow = self.minute_flows.get(minute, {})
        active_buy = float(flow.get("activeBuyNotional", 0) or 0)
        active_sell = float(flow.get("activeSellNotional", 0) or 0)
        big_buy = float(flow.get("bigBuyNotional", 0) or 0)
        big_sell = float(flow.get("bigSellNotional", 0) or 0)
        active_total = active_buy + active_sell
        return {
            "activeBuyNotional": round(active_buy, 2),
            "activeSellNotional": round(active_sell, 2),
            "activeBuyVolume": int(flow.get("activeBuyVolume", 0) or 0),
            "activeSellVolume": int(flow.get("activeSellVolume", 0) or 0),
            "activeBuyRatio": None if active_total <= 0 else round(active_buy / active_total, 6),
            "netActiveNotional": round(active_buy - active_sell, 2),
            "bigBuyNotional": round(big_buy, 2),
            "bigSellNotional": round(big_sell, 2),
            "bigOrderNetNotional": round(big_buy - big_sell, 2),
            "bigBuyVolume": int(flow.get("bigBuyVolume", 0) or 0),
            "bigSellVolume": int(flow.get("bigSellVolume", 0) or 0),
            "bigBuyCount": int(flow.get("bigBuyCount", 0) or 0),
            "bigSellCount": int(flow.get("bigSellCount", 0) or 0),
        }

    def recent_minute_payload(self):
        active_date = (self.last_exchange_time or "")[:8]
        rows = {
            minute: dict(row)
            for minute, row in self.restored_minute_rows.items()
            if not active_date or minute[:8] == active_date
        }
        live_bars = [
            *self.minute_bars,
            *([self.current_minute_bar] if self.current_minute_bar else []),
        ]
        for bar in live_bars:
            minute = bar["minute"]
            if active_date and minute[:8] != active_date:
                continue
            restored = rows.get(minute)
            rows[minute] = {
                "time": minute[-4:],
                "exchangeMinute": minute,
                "price": bar["close"],
                "open": restored["open"] if restored else bar["open"],
                "high": max(restored["high"], bar["high"]) if restored else bar["high"],
                "low": min(restored["low"], bar["low"]) if restored else bar["low"],
                "volume": (restored["volume"] if restored else 0) + bar.get("volume", 0),
                "amount": (restored["amount"] if restored else 0) + bar.get("turnover", 0),
                "averagePrice": bar.get("averagePrice") or (
                    restored.get("averagePrice") if restored else None
                ),
            }
        return [
            {**rows[minute], **self.minute_flow_payload(minute)}
            for minute in sorted(rows)[-260:]
        ]

    async def on_transaction(self, message):
        received = time.time()
        for row in self.parse(message.data, TRANSACTION):
            side, price, volume = decoded(row["bs_flag"]).upper(), float(row["price"]) / 10000, int(row["volume"])
            notional = int(row["turnover"]) or price * volume
            self.transactions.append((received, side, volume, notional, price))
            self.message_counts["transaction"] += 1
            self.last_exchange_time = f"{int(row['date']):08d}-{int(row['time']):09d}"
            minute = exchange_minute(self.last_exchange_time)
            if minute:
                self.update_minute_flow(minute, side, volume, notional)
                if price > 0:
                    self.update_minute_bar(
                        minute,
                        price,
                        price_source="transaction",
                        trade_volume=volume,
                        trade_turnover=notional,
                    )
        self.last_message_at = received

    async def on_order(self, message):
        received = time.time()
        for row in self.parse(message.data, ORDER):
            self.orders.append((received, decoded(row["bs_flag"]).upper(), decoded(row["order_kind"]).upper(),
                                int(row["volume"]), float(row["price"]) / 10000))
            self.message_counts["order"] += 1
            self.last_exchange_time = f"{int(row['date']):08d}-{int(row['time']):09d}"
        self.last_message_at = received

    def state(self):
        now = time.time()
        while self.transactions and now - self.transactions[0][0] > 60: self.transactions.popleft()
        while self.orders and now - self.orders[0][0] > 60: self.orders.popleft()
        while self.book_samples and now - self.book_samples[0]["receivedAt"] > 60: self.book_samples.popleft()
        buy = sum(row[3] for row in self.transactions if row[1] == "B")
        sell = sum(row[3] for row in self.transactions if row[1] == "S")
        buy_volume = sum(row[2] for row in self.transactions if row[1] == "B")
        sell_volume = sum(row[2] for row in self.transactions if row[1] == "S")
        big_buy = sum(row[3] for row in self.transactions if row[1] == "B" and row[3] >= self.big_order)
        big_sell = sum(row[3] for row in self.transactions if row[1] == "S" and row[3] >= self.big_order)
        buy_sweep_streak = trailing_big_sweep_streak(self.transactions, "B", self.big_order)
        sell_sweep_streak = trailing_big_sweep_streak(self.transactions, "S", self.big_order)
        bid_volumes, ask_volumes, bid_prices, ask_prices = [], [], [], []
        if self.snapshot is not None:
            bid_volumes, ask_volumes = [int(x) for x in self.snapshot["bid_vol"]], [int(x) for x in self.snapshot["ask_vol"]]
            bid_prices, ask_prices = [round(float(x) / 10000, 4) for x in self.snapshot["bid_price"]], [round(float(x) / 10000, 4) for x in self.snapshot["ask_price"]]
        near_bid, near_ask = sum(bid_volumes[:5]), sum(ask_volumes[:5])
        age = None if self.last_message_at is None else max(0, now - self.last_message_at)
        total, depth_total = buy + sell, near_bid + near_ask
        best_bid = bid_prices[0] if bid_prices else 0
        best_ask = ask_prices[0] if ask_prices else 0
        bid1_volume = bid_volumes[0] if bid_volumes else 0
        ask1_volume = ask_volumes[0] if ask_volumes else 0
        mid = (best_bid + best_ask) / 2 if best_bid > 0 and best_ask > 0 else 0
        microprice = (
            (best_ask * bid1_volume + best_bid * ask1_volume) / (bid1_volume + ask1_volume)
            if mid > 0 and bid1_volume + ask1_volume > 0 else 0
        )
        last_price = round(float(self.snapshot["last"]) / 10000, 4) if self.snapshot is not None else None
        session = None if self.snapshot is None else {
            "previousClose": round(float(self.snapshot["pre_close"]) / 10000, 4),
            "open": round(float(self.snapshot["open"]) / 10000, 4),
            "high": round(float(self.snapshot["high"]) / 10000, 4),
            "low": round(float(self.snapshot["low"]) / 10000, 4),
            "volume": int(self.snapshot["volume"]),
            "amount": int(self.snapshot["turnover"]),
            "trades": int(self.snapshot["num_trades"]),
        }
        cumulative_vwap = None if session is None or last_price is None else self.cumulative_average_price(
            session["amount"], session["volume"], last_price
        )
        atr = self.atr_state()
        windows = {
            f"{seconds}s": flow_window(self.transactions, now, seconds)
            for seconds in (1, 3, 10, 30, 60)
        }
        fast_book = weighted_book(self.snapshot)
        book3 = book_persistence(self.book_samples, now, 3)
        exchange_clock = (
            self.last_exchange_time.split("-", 1)[1][:6]
            if self.last_exchange_time and "-" in self.last_exchange_time else ""
        )
        # 14:57-15:00 is the Shanghai closing call auction.  It is archived
        # for research, but never fed into an ordinary intraday trigger.
        market_open = (
            "093000" <= exchange_clock <= "112959"
            or "130000" <= exchange_clock <= "145659"
        )
        market_mode = (
            "continuous"
            if market_open else
            "closing-auction"
            if "145700" <= exchange_clock <= "150000" else
            "closed"
        )
        second_state = self.second_signal_machine.evaluate(
            now=now,
            market_open=market_open,
            stale=age is None or age > self.stale_seconds,
            price=last_price,
            vwap=cumulative_vwap,
            high=None if session is None else session["high"],
            low=None if session is None else session["low"],
            atr_pct=atr.get("atrPct14"),
            windows=windows,
            book=fast_book,
            book3=book3,
            exchange_minute_key=exchange_clock[:4],
        )
        second_state["marketMode"] = market_mode
        ready = len(self.forward_minutes) >= self.forward_min_samples and len(self.forward_days) >= self.forward_min_days
        shadow_status = self.reverse_shadow.public_status()
        return {
            "schemaVersion": 5, "source": "base32-l2-nats", "node": self.url.split("//")[-1],
            "symbol": self.symbol, "updatedAt": utc_now(),
            "lastMessageAt": None if age is None else datetime.fromtimestamp(self.last_message_at, timezone.utc).isoformat().replace("+00:00", "Z"),
            "lastExchangeTime": self.last_exchange_time,
            "status": {"connected": self.connected, "authorized": not self.authorization_error,
                       "stale": age is None or age > self.stale_seconds, "ageSeconds": None if age is None else round(age, 3),
                       "parseErrors": self.parse_errors, "reconnects": self.reconnects,
                       "failovers": self.failovers, "failoverReason": self.failover_reason,
                       "nodePoolSize": len(self.urls)},
            "flow": {"activeBuyNotional60s": round(buy, 2), "activeSellNotional60s": round(sell, 2),
                     "activeBuyVolume60s": buy_volume, "activeSellVolume60s": sell_volume,
                     "tradeVolume60s": buy_volume + sell_volume,
                     "activeBuyRatio60s": None if total <= 0 else round(buy / total, 6),
                     "netActiveNotional60s": round(buy - sell, 2),
                     "bigBuyNotional60s": round(big_buy, 2),
                     "bigSellNotional60s": round(big_sell, 2),
                     "bigOrderNetNotional60s": round(big_buy - big_sell, 2),
                     "buySweepStreak60s": buy_sweep_streak,
                     "sellSweepStreak60s": sell_sweep_streak,
                     "transactionCount60s": len(self.transactions), "orderCount60s": len(self.orders)},
            "book": {"bidPrices": bid_prices, "askPrices": ask_prices, "bidVolumes": bid_volumes, "askVolumes": ask_volumes,
                     "lastPrice": last_price, "bid1Volume": bid1_volume, "ask1Volume": ask1_volume,
                     "nearBidVolume": near_bid, "nearAskVolume": near_ask,
                     "nearTouchImbalance": None if depth_total <= 0 else round((near_bid - near_ask) / depth_total, 6),
                     "spreadBps": None if mid <= 0 else round((best_ask - best_bid) / mid * 10000, 4),
                     "microprice": None if microprice <= 0 else round(microprice, 4),
                     "micropriceEdgeBps": None if mid <= 0 else round((microprice - mid) / mid * 10000, 4)},
            "session": session,
            "volatility": atr,
            "secondState": second_state,
            "recentMinutes": self.recent_minute_payload(),
            "messages": self.message_counts,
            "forward": {
                "path": self.forward_path, "samples": len(self.forward_minutes), "tradingDays": len(self.forward_days),
                "lastExchangeMinute": self.last_forward_minute, "labeled": self.forward_label_count > 0,
                "labeledSamples": self.forward_label_count, "researchStatus": self.forward_research_status, "trainingReady": ready,
                "minimumSamples": self.forward_min_samples, "minimumTradingDays": self.forward_min_days,
                "reason": "ready-for-delayed-labeling" if ready else "collecting-genuine-forward-l2",
                "reverseTShadow": shadow_status,
                "multiFactorTShadow": shadow_status,
            },
        }

    def write_forward_record(self, record):
        minute = record.get("exchangeMinute")
        if not minute or minute in self.forward_minutes:
            return
        target = Path(self.forward_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self.forward_minutes.add(minute)
        self.forward_days.add(minute[:8])
        self.last_forward_minute = minute
        try:
            self.reverse_shadow.observe(record)
        except Exception:
            # Shadow research must never interrupt the production L2 collector.
            pass
        self.refresh_forward_research()

    def append_forward_sample(self, state):
        minute = exchange_minute(state.get("lastExchangeTime"))
        phase = market_phase(minute)
        status = state.get("status", {})
        messages = state.get("messages", {})
        eligible = (
            self.symbol == "601899" and minute and phase and minute not in self.forward_minutes
            and status.get("connected") and status.get("authorized") and not status.get("stale")
            and messages.get("snapshot", 0) > 0
            and (messages.get("transaction", 0) > 0 or messages.get("order", 0) > 0)
        )
        if not eligible:
            return
        record = {
            "schemaVersion": 3, "symbol": self.symbol, "source": state["source"], "node": state["node"],
            "observedAt": state["updatedAt"], "exchangeMinute": minute, "marketPhase": phase,
            "lastPrice": state["book"].get("lastPrice"),
            "previousClose": (state.get("session") or {}).get("previousClose"),
            "sessionOpen": (state.get("session") or {}).get("open"),
            "minuteHigh": (state.get("volatility") or {}).get("currentBar", {}).get("high"),
            "minuteLow": (state.get("volatility") or {}).get("currentBar", {}).get("low"),
            "cumulativeVwap": self.cumulative_average_price(
                (state.get("session") or {}).get("amount", 0),
                (state.get("session") or {}).get("volume", 0),
                state["book"].get("lastPrice"),
            ),
            "flow": state["flow"], "volatility": state["volatility"], "book": {
                key: state["book"].get(key) for key in (
                    "bid1Volume", "ask1Volume", "nearBidVolume", "nearAskVolume",
                    "nearTouchImbalance", "spreadBps", "microprice", "micropriceEdgeBps",
                    "bidPrices", "askPrices", "bidVolumes", "askVolumes"
                )
            },
            "messages": dict(messages), "target": None,
            "secondState": state.get("secondState"),
            "microstructure": freeze_microstructure_features(
                state.get("secondState"), state.get("flow"), state.get("book"), messages
            ),
        }
        completed = self.forward_minute_buffer.push(record)
        if completed is not None:
            self.write_forward_record(completed)

    def append_second_event(self, state):
        signal = state.get("secondState") or {}
        sequence = signal.get("sequence")
        if sequence is None or sequence == self.last_second_sequence:
            return
        self.last_second_sequence = sequence
        if signal.get("state") == "normal":
            return
        minute = exchange_minute(state.get("lastExchangeTime"))
        record = {
            "schemaVersion": 2,
            "observationId": f"{self.symbol}:{state.get('lastExchangeTime')}:seq-{sequence}",
            "symbol": self.symbol,
            "source": state.get("source"),
            "node": state.get("node"),
            "observedAt": state.get("updatedAt"),
            "lastExchangeTime": state.get("lastExchangeTime"),
            "exchangeMinute": minute,
            "marketPhase": market_phase(minute),
            "lastPrice": (state.get("book") or {}).get("lastPrice"),
            "status": state.get("status"),
            "secondState": signal,
            "microstructure": freeze_microstructure_features(
                signal, state.get("flow"), state.get("book"), state.get("messages")
            ),
            "target": None,
        }
        target = Path(self.second_event_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    async def publish_state(self):
        while True:
            state = self.state()
            self.append_second_event(state)
            self.append_forward_sample(state)
            # Publish the exact evaluated state. Re-evaluating here could advance
            # a state twice in one 250ms cycle and create artificial confirmations.
            atomic_json(self.state_path, state)
            await asyncio.sleep(self.publish_interval)

    async def refresh_reverse_shadow_regime(self):
        while True:
            await asyncio.to_thread(self.reverse_shadow.refresh_market_context)
            await asyncio.sleep(900)

    async def refresh_reverse_shadow_peers(self):
        while True:
            if is_live_a_share_session():
                await asyncio.to_thread(self.reverse_shadow.refresh_peer_context)
                await asyncio.sleep(self.reverse_shadow.peer_refresh_seconds())
            else:
                await asyncio.sleep(60)

    async def run(self):
        async def error_callback(error):
            if "authorization" in str(error).lower(): self.authorization_error = True
        async def disconnected_callback(): self.connected = False
        writer = asyncio.create_task(self.publish_state())
        reverse_shadow_regime = asyncio.create_task(self.refresh_reverse_shadow_regime())
        reverse_shadow_peers = asyncio.create_task(self.refresh_reverse_shadow_peers())
        node_index = 0
        try:
            while True:
                if writer.done():
                    await writer
                self.url = self.urls[node_index]
                connection = None
                connected_at = time.time()
                try:
                    connection = await asyncio.wait_for(
                        nats.connect(
                            servers=[self.url],
                            user=self.user,
                            password=self.password,
                            error_cb=error_callback,
                            disconnected_cb=disconnected_callback,
                            reconnect_time_wait=1,
                            max_reconnect_attempts=0,
                            connect_timeout=3,
                        ),
                        timeout=5,
                    )
                    self.authorization_error = False
                    self.failover_reason = None
                    connected_at = time.time()
                    # A TCP connection can succeed while the first subscription
                    # is still waiting on a broken NATS socket. Bound every
                    # readiness step so the supervisor can rotate/restart the
                    # collector instead of freezing its heartbeat forever.
                    for subject, callback in (
                        (f"stk.l2.{self.symbol}", self.on_snapshot),
                        (f"stk.trans.{self.symbol}", self.on_transaction),
                        (f"stk.order.{self.symbol}", self.on_order),
                    ):
                        await asyncio.wait_for(
                            connection.subscribe(subject, cb=callback),
                            timeout=self.subscribe_timeout,
                        )
                    await asyncio.wait_for(connection.flush(), timeout=self.subscribe_timeout)
                    self.connected = True
                    while not connection.is_closed:
                        await asyncio.sleep(0.5)
                        if writer.done():
                            await writer
                        if not self.connected:
                            self.failover_reason = "connection-lost"
                            break
                        if not is_live_a_share_session():
                            continue
                        age = None if self.last_message_at is None else time.time() - self.last_message_at
                        if time.time() - connected_at >= self.stale_seconds and (
                            age is None or age > self.stale_seconds
                        ):
                            self.failover_reason = "stale-feed"
                            break
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    if "authorization" in str(error).lower():
                        self.authorization_error = True
                        self.failover_reason = "authorization"
                    else:
                        self.failover_reason = "connection-error"
                finally:
                    self.connected = False
                    if connection is not None and not connection.is_closed:
                        try:
                            await asyncio.wait_for(connection.close(), timeout=2)
                        except asyncio.TimeoutError as error:
                            # A stale NATS socket can hang close forever. Exit so
                            # Docker releases the socket and restarts a clean feed.
                            self.failover_reason = "close-timeout"
                            raise RuntimeError("NATS close timed out; restart collector") from error
                self.failovers += 1
                self.reconnects += 1
                node_index = (node_index + 1) % len(self.urls)
                await asyncio.sleep(0.35 if is_live_a_share_session() else 2)
        finally:
            writer.cancel()
            reverse_shadow_regime.cancel()
            reverse_shadow_peers.cancel()
            with suppress(asyncio.CancelledError):
                await writer
            with suppress(asyncio.CancelledError):
                await reverse_shadow_regime
            with suppress(asyncio.CancelledError):
                await reverse_shadow_peers

if __name__ == "__main__":
    asyncio.run(Collector().run())
