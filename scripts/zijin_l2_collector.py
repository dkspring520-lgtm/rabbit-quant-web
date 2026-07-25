#!/usr/bin/env python3
"""Causal L2 collector for Smart-T V4. Never backfills unavailable order flow."""

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

class Collector:
    def __init__(self):
        self.symbol = os.getenv("L2_SYMBOL", "601899")
        self.url = os.getenv("L2_NATS_URL", "nats://quote5.base32.cn:4222")
        self.user = os.environ["L2_NATS_USER"]
        self.password = os.environ["L2_NATS_PASSWORD"]
        self.state_path = os.getenv("L2_STATE_PATH", "/training-state/zijin-l2-orderflow.json")
        self.stale_seconds = float(os.getenv("L2_STALE_SECONDS", "8"))
        self.big_order = float(os.getenv("L2_BIG_ORDER_NOTIONAL", "200000"))
        self.transactions, self.orders = deque(), deque()
        self.snapshot = self.last_message_at = self.last_exchange_time = None
        self.connected = self.authorization_error = False
        self.parse_errors = self.reconnects = 0
        self.message_counts = {"snapshot": 0, "transaction": 0, "order": 0}

    def parse(self, payload, dtype):
        if not payload or len(payload) % dtype.itemsize:
            self.parse_errors += 1
            return []
        return np.frombuffer(payload, dtype=dtype)

    async def on_snapshot(self, message):
        for row in self.parse(message.data, SNAPSHOT):
            self.snapshot = row.copy()
            self.last_exchange_time = f"{int(row['date']):08d}-{int(row['time']):09d}"
            self.message_counts["snapshot"] += 1
        self.last_message_at = time.time()

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
        bid_volumes, ask_volumes, bid_prices, ask_prices = [], [], [], []
        if self.snapshot is not None:
            bid_volumes, ask_volumes = [int(x) for x in self.snapshot["bid_vol"]], [int(x) for x in self.snapshot["ask_vol"]]
            bid_prices, ask_prices = [round(float(x) / 10000, 4) for x in self.snapshot["bid_price"]], [round(float(x) / 10000, 4) for x in self.snapshot["ask_price"]]
        near_bid, near_ask = sum(bid_volumes[:5]), sum(ask_volumes[:5])
        age = None if self.last_message_at is None else max(0, now - self.last_message_at)
        total, depth_total = buy + sell, near_bid + near_ask
        return {
            "schemaVersion": 1, "source": "base32-l2-nats", "node": self.url.split("//")[-1],
            "symbol": self.symbol, "updatedAt": utc_now(),
            "lastMessageAt": None if age is None else datetime.fromtimestamp(self.last_message_at, timezone.utc).isoformat().replace("+00:00", "Z"),
            "lastExchangeTime": self.last_exchange_time,
            "status": {"connected": self.connected, "authorized": not self.authorization_error,
                       "stale": age is None or age > self.stale_seconds, "ageSeconds": None if age is None else round(age, 3),
                       "parseErrors": self.parse_errors, "reconnects": self.reconnects},
            "flow": {"activeBuyNotional60s": round(buy, 2), "activeSellNotional60s": round(sell, 2),
                     "activeBuyRatio60s": None if total <= 0 else round(buy / total, 6),
                     "netActiveNotional60s": round(buy - sell, 2),
                     "bigOrderNetNotional60s": round(big_buy - big_sell, 2)},
            "book": {"bidPrices": bid_prices, "askPrices": ask_prices, "bidVolumes": bid_volumes, "askVolumes": ask_volumes,
                     "bid1Volume": near_bid, "ask1Volume": near_ask,
                     "nearTouchImbalance": None if depth_total <= 0 else round((near_bid - near_ask) / depth_total, 6)},
            "messages": self.message_counts,
        }

    async def publish_state(self):
        while True:
            atomic_json(self.state_path, self.state())
            await asyncio.sleep(1)

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
