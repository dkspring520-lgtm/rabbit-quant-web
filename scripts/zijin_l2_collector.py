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
from datetime import datetime, timezone
from pathlib import Path

import nats
import numpy as np

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
        self.url = os.getenv("L2_NATS_URL", "nats://quote5.base32.cn:4222")
        self.user = os.environ["L2_NATS_USER"]
        self.password = os.environ["L2_NATS_PASSWORD"]
        self.state_path = os.getenv("L2_STATE_PATH", "/training-state/zijin-l2-orderflow.json")
        self.forward_path = os.getenv("L2_FORWARD_PATH", "/training-state/zijin-l2-forward.jsonl")
        self.forward_min_samples = int(os.getenv("L2_FORWARD_MIN_SAMPLES", "1200"))
        self.forward_min_days = int(os.getenv("L2_FORWARD_MIN_DAYS", "10"))
        self.stale_seconds = float(os.getenv("L2_STALE_SECONDS", "8"))
        self.big_order = float(os.getenv("L2_BIG_ORDER_NOTIONAL", "200000"))
        # The UI reads the atomically-published state file.  Keep this short enough
        # for an intraday monitor, without attempting per-packet filesystem writes.
        self.publish_interval = float(os.getenv("L2_PUBLISH_INTERVAL_SECONDS", "0.25"))
        self.transactions, self.orders = deque(), deque()
        self.snapshot = self.last_message_at = self.last_exchange_time = None
        self.connected = self.authorization_error = False
        self.parse_errors = self.reconnects = 0
        self.message_counts = {"snapshot": 0, "transaction": 0, "order": 0}
        self.forward_minutes = set()
        self.forward_days = set()
        self.last_forward_minute = None
        self.minute_bars = deque(maxlen=60)
        self.current_minute_bar = None
        self.load_forward_index()

    def load_forward_index(self):
        try:
            with Path(self.forward_path).open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    minute = value.get("exchangeMinute")
                    if isinstance(minute, str):
                        self.forward_minutes.add(minute)
                        self.forward_days.add(minute[:8])
                        self.last_forward_minute = minute
        except FileNotFoundError:
            pass

    def parse(self, payload, dtype):
        if not payload or len(payload) % dtype.itemsize:
            self.parse_errors += 1
            return []
        return np.frombuffer(payload, dtype=dtype)

    async def on_snapshot(self, message):
        for row in self.parse(message.data, SNAPSHOT):
            self.snapshot = row.copy()
            self.last_exchange_time = f"{int(row['date']):08d}-{int(row['time']):09d}"
            minute = exchange_minute(self.last_exchange_time)
            price = float(row["last"]) / 10000
            if minute and price > 0:
                self.update_minute_bar(minute, price)
            self.message_counts["snapshot"] += 1
        self.last_message_at = time.time()

    def update_minute_bar(self, minute, price):
        bar = self.current_minute_bar
        if bar is not None and bar["minute"] == minute:
            bar["high"] = max(bar["high"], price)
            bar["low"] = min(bar["low"], price)
            bar["close"] = price
            return
        if bar is not None:
            self.minute_bars.append(bar)
        self.current_minute_bar = {
            "minute": minute, "open": price, "high": price, "low": price, "close": price,
        }

    def atr_state(self, period=14, minimum_samples=4):
        bars = list(self.minute_bars)
        if self.current_minute_bar is not None:
            bars.append(dict(self.current_minute_bar))
        if not bars:
            return {
                "source": "broker-l2-derived", "period": period, "samples": 0,
                "ready": False, "atr14": None, "atrPct14": None,
            }
        true_ranges = []
        previous_close = None
        active_date = bars[-1]["minute"][:8]
        for bar in bars:
            if bar["minute"][:8] != active_date:
                continue
            high, low = bar["high"], bar["low"]
            true_range = high - low if previous_close is None else max(
                high - low, abs(high - previous_close), abs(low - previous_close)
            )
            true_ranges.append(true_range)
            previous_close = bar["close"]
        sample = true_ranges[-period:]
        ready = len(sample) >= minimum_samples
        atr = sum(sample) / len(sample) if ready else None
        close = bars[-1]["close"]
        return {
            "source": "broker-l2-derived", "period": period, "samples": len(sample),
            "ready": ready, "atr14": None if atr is None else round(atr, 6),
            "atrPct14": None if atr is None or close <= 0 else round(atr / close * 100, 6),
            "currentBar": bars[-1],
        }

    async def on_transaction(self, message):
        received = time.time()
        for row in self.parse(message.data, TRANSACTION):
            side, price, volume = decoded(row["bs_flag"]).upper(), float(row["price"]) / 10000, int(row["volume"])
            notional = int(row["turnover"]) or price * volume
            self.transactions.append((received, side, volume, notional))
            self.message_counts["transaction"] += 1
            self.last_exchange_time = f"{int(row['date']):08d}-{int(row['time']):09d}"
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
        buy = sum(row[3] for row in self.transactions if row[1] == "B")
        sell = sum(row[3] for row in self.transactions if row[1] == "S")
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
        ready = len(self.forward_minutes) >= self.forward_min_samples and len(self.forward_days) >= self.forward_min_days
        return {
            "schemaVersion": 3, "source": "base32-l2-nats", "node": self.url.split("//")[-1],
            "symbol": self.symbol, "updatedAt": utc_now(),
            "lastMessageAt": None if age is None else datetime.fromtimestamp(self.last_message_at, timezone.utc).isoformat().replace("+00:00", "Z"),
            "lastExchangeTime": self.last_exchange_time,
            "status": {"connected": self.connected, "authorized": not self.authorization_error,
                       "stale": age is None or age > self.stale_seconds, "ageSeconds": None if age is None else round(age, 3),
                       "parseErrors": self.parse_errors, "reconnects": self.reconnects},
            "flow": {"activeBuyNotional60s": round(buy, 2), "activeSellNotional60s": round(sell, 2),
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
            "volatility": self.atr_state(),
            "messages": self.message_counts,
            "forward": {
                "path": self.forward_path, "samples": len(self.forward_minutes), "tradingDays": len(self.forward_days),
                "lastExchangeMinute": self.last_forward_minute, "labeled": False, "trainingReady": ready,
                "minimumSamples": self.forward_min_samples, "minimumTradingDays": self.forward_min_days,
                "reason": "ready-for-delayed-labeling" if ready else "collecting-genuine-forward-l2",
            },
        }

    def append_forward_sample(self, state):
        minute = exchange_minute(state.get("lastExchangeTime"))
        status = state.get("status", {})
        messages = state.get("messages", {})
        eligible = (
            self.symbol == "601899" and minute and minute not in self.forward_minutes
            and status.get("connected") and status.get("authorized") and not status.get("stale")
            and messages.get("snapshot", 0) > 0
            and (messages.get("transaction", 0) > 0 or messages.get("order", 0) > 0)
        )
        if not eligible:
            return
        record = {
            "schemaVersion": 2, "symbol": self.symbol, "source": state["source"], "node": state["node"],
            "observedAt": state["updatedAt"], "exchangeMinute": minute,
            "lastPrice": state["book"].get("lastPrice"), "flow": state["flow"], "volatility": state["volatility"], "book": {
                key: state["book"].get(key) for key in (
                    "bid1Volume", "ask1Volume", "nearBidVolume", "nearAskVolume",
                    "nearTouchImbalance", "spreadBps", "microprice", "micropriceEdgeBps"
                )
            },
            "messages": dict(messages), "target": None,
        }
        target = Path(self.forward_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self.forward_minutes.add(minute)
        self.forward_days.add(minute[:8])
        self.last_forward_minute = minute

    async def publish_state(self):
        while True:
            state = self.state()
            self.append_forward_sample(state)
            # Rebuild so the state immediately reflects a newly appended sample.
            atomic_json(self.state_path, self.state())
            await asyncio.sleep(self.publish_interval)

    async def run(self):
        async def error_callback(error):
            if "authorization" in str(error).lower(): self.authorization_error = True
        async def disconnected_callback(): self.connected = False
        async def reconnected_callback():
            self.connected = True
            self.reconnects += 1
        writer = asyncio.create_task(self.publish_state())
        try:
            connection = await nats.connect(servers=[self.url], user=self.user, password=self.password,
                error_cb=error_callback, disconnected_cb=disconnected_callback, reconnected_cb=reconnected_callback,
                reconnect_time_wait=2, max_reconnect_attempts=-1)
            self.connected = True
            await connection.subscribe(f"stk.l2.{self.symbol}", cb=self.on_snapshot)
            await connection.subscribe(f"stk.trans.{self.symbol}", cb=self.on_transaction)
            await connection.subscribe(f"stk.order.{self.symbol}", cb=self.on_order)
            while True: await asyncio.sleep(30)
        finally:
            writer.cancel()

if __name__ == "__main__":
    asyncio.run(Collector().run())
