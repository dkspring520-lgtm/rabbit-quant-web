"""Per-stream L2 ordering and provenance. No network or filesystem access."""
from collections import OrderedDict, deque
from datetime import datetime, timezone


def iso(epoch):
    return None if epoch is None else datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


def event_fields(row):
    """Preserve vendor values; numeric market/function enums stay unverified."""
    names = row.dtype.names if hasattr(row, "dtype") else row.keys()
    def text(name):
        if name not in names: return None
        value = row[name]
        return bytes(value).rstrip(b"\0").decode("ascii", "replace") if isinstance(value, (bytes, bytearray)) else str(value)
    symbol = text("symbol")
    # A-share stock subject conventions, never a guessed vendor numeric market enum.
    exchange = "SH" if symbol and symbol.isdigit() and len(symbol) == 6 and symbol.startswith("6") else (
        "SZ" if symbol and symbol.isdigit() and len(symbol) == 6 and symbol.startswith(("0", "3")) else "UNKNOWN")
    flag = text("bs_flag") or ""
    kind, reason = "unknown", "UNVERIFIED_MARKET_OR_EVENT_TYPE"
    if exchange == "SZ":
        if flag == "C": kind, reason = "cancel", "VENDOR_SZ_CANCEL_FLAG"
        elif (flag in {"B", "S"} and "price" in names and float(row["price"]) > 0
              and "volume" in names and int(row["volume"]) > 0 and "turnover" in names):
            kind, reason = "trade", "VENDOR_SZ_TRANSACTION_BS_FLAG"
    elif exchange == "SH":
        if text("order_kind") != "T":
            reason = "UNKNOWN_SH_ORDER_KIND"
        elif flag == "C":
            # Conservative conflicting-input gate; do not invent an SH cancel enum.
            reason = "CONFLICTING_SH_T_AND_C_FLAG"
        elif ("price" in names and float(row["price"]) > 0 and "volume" in names
              and int(row["volume"]) > 0 and "turnover" in names):
            kind, reason = "trade", "VENDOR_SH_ORDER_KIND_T"
        else:
            reason = "INCOMPLETE_SH_EXECUTION_FIELDS"
    return {"symbol": symbol, "market": int(row["market"]) if "market" in names else None,
        "exchange": exchange, "exchangeBasis": "stock-symbol-prefix" if exchange != "UNKNOWN" else "unavailable",
        "bs_flag": text("bs_flag"), "function_code": text("function_code"), "order_kind": text("order_kind"),
        "buy_id": int(row["buy_id"]) if "buy_id" in names else None,
        "sell_id": int(row["sell_id"]) if "sell_id" in names else None,
        "order_no": int(row["order_no"]) if "order_no" in names else None,
        "eventKind": kind, "classificationBasis": reason,
        "sideBasis": "vendor-buy-sell-id-comparison" if exchange == "SZ" and flag in {"B", "S"} else "unverified"}


class StreamState:
    def __init__(self):
        self.generation = 0
        self.business_date = None
        self.streams = {name: {"exchangeTime": None, "receivedAt": None, "lastReceivedAt": None,
            "receivedCount": 0, "acceptedCount": 0, "duplicateCount": 0, "outOfOrderCount": 0,
            "invalidTimeCount": 0, "missingSequenceCount": 0, "ambiguousTimeCount": 0, "sequence": None, "channel": None,
            "generation": -1} for name in ("snapshot", "transaction", "order")}
        self.sequences = {}
        self.channel_times = {}
        self.seen = OrderedDict()
        self.latest_trade = None
        self.events = deque(maxlen=128)
        self.event_id = 0
        self.transaction_events = deque(maxlen=128)
        self.order_events = deque(maxlen=128)
        self.last_accepted_event = None
        self.classification_counts = {"trade": 0, "cancel": 0, "unknown": 0}

    def reconnect(self):
        # Retain ordering watermarks across transport reconnects. Old values remain
        # inspectable, but are unavailable until a new accepted event arrives.
        self.generation += 1
        self.events.clear()
        self.transaction_events.clear()
        self.order_events.clear()
        self.last_accepted_event = None

    def accept(self, stream, row, received):
        state = self.streams[stream]
        state["receivedCount"] += 1
        state["lastReceivedAt"] = received
        try:
            source = f"{int(row['date']):08d}-{int(row['time']):09d}"
            datetime.strptime(source[:15], "%Y%m%d-%H%M%S")
            if len(source) != 18: raise ValueError("time")
        except (KeyError, TypeError, ValueError):
            state["invalidTimeCount"] += 1
            return False
        names = row.dtype.names if hasattr(row, "dtype") else row.keys()
        sequence = int(row["index"]) if "index" in names and int(row["index"]) > 0 else None
        channel = int(row["channel"]) if "channel" in names else None
        if stream != "snapshot" and sequence is None: state["missingSequenceCount"] += 1
        key = (stream, source[:8], channel)
        if self.business_date and source[:8] < self.business_date:
            state["outOfOrderCount"] += 1
            return False
        # A bounded exact-record fallback does not certify uniqueness for feeds
        # without sequence numbers. Never call these counters unique trades.
        raw = row.tobytes() if hasattr(row, "tobytes") else repr(sorted(row.items())).encode()
        identity = (key, sequence) if sequence is not None else (key, source, raw)
        if identity in self.seen:
            state["duplicateCount"] += 1
            return False
        channel_time = self.channel_times.get(key)
        if sequence is None and source == channel_time:
            # Without a sequence, different records at the same timestamp have
            # no provable revision order. Keep the accepted value until time advances.
            state["ambiguousTimeCount"] += 1
            return False
        if (state["exchangeTime"] and source[:8] < state["exchangeTime"][:8]) or (
            channel_time and source < channel_time) or (
            sequence is not None and sequence <= self.sequences.get(key, -1)):
            state["outOfOrderCount"] += 1
            return False
        self.seen[identity] = None
        if len(self.seen) > 4096: self.seen.popitem(last=False)
        if sequence is not None: self.sequences[key] = sequence
        self.channel_times[key] = source
        # Only today's channel watermarks are needed; prevent unbounded growth.
        self.sequences = {k: v for k, v in self.sequences.items() if k[1] >= source[:8]}
        self.channel_times = {k: v for k, v in self.channel_times.items() if k[1] >= source[:8]}
        new_day = state["exchangeTime"] and source[:8] > state["exchangeTime"][:8]
        advances = not state["exchangeTime"] or source > state["exchangeTime"] or (
            source == state["exchangeTime"] and channel == state["channel"])
        if advances:
            state.update(exchangeTime=source, receivedAt=received, sequence=sequence,
                         channel=channel, generation=self.generation)
        state["acceptedCount"] += 1
        if self.business_date is None or source[:8] > self.business_date:
            self.business_date = source[:8]
            self.events.clear(); self.transaction_events.clear(); self.order_events.clear(); self.latest_trade = None
        if stream == "transaction":
            self.event_id += 1
            if new_day:
                self.events.clear(); self.transaction_events.clear(); self.latest_trade = None
            event = {"source": "transaction", "exchangeTime": source,
                "receivedAt": iso(received), "sequence": sequence, "channel": channel,
                "price": round(float(row["price"]) / 10000, 4) if "price" in names else None,
                "volume": int(row["volume"]) if "volume" in names else None,
                "amount": int(row["turnover"]) if "turnover" in names else None, "volumeUnit": "provider-raw",
                "id": self.event_id, "generation": self.generation, **event_fields(row)}
            trade_advances = event["eventKind"] == "trade" and (self.latest_trade is None or source > self.latest_trade["exchangeTime"] or (
                source == self.latest_trade["exchangeTime"] and channel == self.latest_trade["channel"]))
            event["aggregationDisposition"] = "forward-trade" if trade_advances else (
                "ledger-only-late-trade" if event["eventKind"] == "trade" else "non-trade")
            self.classification_counts[event["eventKind"]] += 1
            self.last_accepted_event = event
            self.transaction_events.append(event.copy())
            if event["eventKind"] == "trade":
                self.events.append(event.copy())
                if trade_advances: self.latest_trade = event.copy()
        elif stream == "order":
            self.order_events.append({**event_fields(row), "source": "order", "eventKind": "unknown",
                "classificationBasis": "UNVERIFIED_ORDER_FUNCTION_CODE", "exchangeTime": source,
                "receivedAt": iso(received), "sequence": sequence, "channel": channel,
                "generation": self.generation, "price": round(float(row["price"]) / 10000, 4),
                "volume": int(row["volume"]), "volumeUnit": "provider-raw"})
        return True

    def latest_trade_public(self, now, stream_available, stale_seconds):
        if self.latest_trade is None: return None
        trade = self.latest_trade
        try:
            receipt = trade.get("receivedAt")
            if not isinstance(receipt, str): raise ValueError("missing trade receipt")
            parsed = datetime.fromisoformat(receipt.replace("Z", "+00:00"))
            if parsed.utcoffset() is None: raise ValueError("missing receipt timezone")
            received = parsed.timestamp()
            age = now - received
        except (KeyError, TypeError, ValueError):
            age = None
        source = trade.get("exchangeTime")
        same_date = isinstance(source, str) and source[:8] == self.business_date
        available = (stream_available and trade.get("eventKind") == "trade"
                     and trade.get("generation") == self.generation and same_date
                     and age is not None and 0 <= age <= stale_seconds)
        return {**trade, "available": bool(available), "receiptAgeSeconds": age,
                "freshnessBasis": "own-collector-receipt-and-generation; not source latency",
                "sourceFreshnessCertified": False}

    def public(self, now, connected, stale_seconds):
        result = {}
        snapshot_time = self.streams["snapshot"]["exchangeTime"]
        for name, state in self.streams.items():
            age = None if state["receivedAt"] is None else max(0, now - state["receivedAt"])
            lag = None
            if snapshot_time and state["exchangeTime"]:
                parse = lambda value: datetime.strptime(value, "%Y%m%d-%H%M%S%f")
                lag = max(0, (parse(snapshot_time) - parse(state["exchangeTime"])).total_seconds())
            available = (connected and state["generation"] == self.generation and age is not None
                         and state["exchangeTime"] is not None and state["exchangeTime"][:8] == self.business_date
                         and age <= stale_seconds and (lag is None or lag <= stale_seconds))
            result[name] = {**state, "source": name, "receivedAt": iso(state["receivedAt"]),
                "lastReceivedAt": iso(state["lastReceivedAt"]), "ageSeconds": None if age is None else round(age, 3),
                "available": available, "stale": not available, "sequenceAvailable": state["sequence"] is not None,
                "freshnessBasis": "accepted-receipt-and-relative-source-lag", "sourceFreshnessCertified": False,
                "sourceLagToSnapshotSeconds": lag,
                "countSemantics": "parsed-records; accepted records are ordered and bounded-deduplicated, not certified unique"}
        return result
