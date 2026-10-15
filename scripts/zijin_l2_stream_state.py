"""Per-stream L2 ordering and provenance. No network or filesystem access."""
from collections import OrderedDict, deque
from datetime import datetime, timezone


def iso(epoch):
    return None if epoch is None else datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


class StreamState:
    def __init__(self):
        self.generation = 0
        self.streams = {name: {"exchangeTime": None, "receivedAt": None, "lastReceivedAt": None,
            "receivedCount": 0, "acceptedCount": 0, "duplicateCount": 0, "outOfOrderCount": 0,
            "invalidTimeCount": 0, "missingSequenceCount": 0, "ambiguousTimeCount": 0, "sequence": None, "channel": None,
            "generation": -1} for name in ("snapshot", "transaction", "order")}
        self.sequences = {}
        self.seen = OrderedDict()
        self.latest_trade = None
        self.events = deque(maxlen=128)
        self.event_id = 0

    def reconnect(self):
        # Retain ordering watermarks across transport reconnects. Old values remain
        # inspectable, but are unavailable until a new accepted event arrives.
        self.generation += 1
        self.events.clear()

    def accept(self, stream, row, received):
        state = self.streams[stream]
        state["receivedCount"] += 1
        state["lastReceivedAt"] = received
        source = f"{int(row['date']):08d}-{int(row['time']):09d}"
        try:
            datetime.strptime(source[:15], "%Y%m%d-%H%M%S")
            if len(source) != 18: raise ValueError("time")
        except ValueError:
            state["invalidTimeCount"] += 1
            return False
        names = row.dtype.names if hasattr(row, "dtype") else row.keys()
        sequence = int(row["index"]) if "index" in names and int(row["index"]) > 0 else None
        channel = int(row["channel"]) if "channel" in names else None
        if stream != "snapshot" and sequence is None: state["missingSequenceCount"] += 1
        key = (stream, source[:8], channel)
        # A bounded exact-record fallback does not certify uniqueness for feeds
        # without sequence numbers. Never call these counters unique trades.
        raw = row.tobytes() if hasattr(row, "tobytes") else repr(sorted(row.items())).encode()
        identity = (key, sequence) if sequence is not None else (key, source, raw)
        if identity in self.seen:
            state["duplicateCount"] += 1
            return False
        if sequence is None and source == state["exchangeTime"]:
            # Without a sequence, different records at the same timestamp have
            # no provable revision order. Keep the accepted value until time advances.
            state["ambiguousTimeCount"] += 1
            return False
        if (state["exchangeTime"] and source < state["exchangeTime"]) or (
            sequence is not None and sequence <= self.sequences.get(key, -1)):
            state["outOfOrderCount"] += 1
            return False
        self.seen[identity] = None
        if len(self.seen) > 4096: self.seen.popitem(last=False)
        if sequence is not None: self.sequences[key] = sequence
        # Only today's channel watermarks are needed; prevent unbounded growth.
        self.sequences = {k: v for k, v in self.sequences.items() if k[1] >= source[:8]}
        state.update(exchangeTime=source, receivedAt=received, sequence=sequence,
                     channel=channel, generation=self.generation)
        state["acceptedCount"] += 1
        if stream == "transaction":
            self.event_id += 1
            self.latest_trade = {"source": "transaction", "exchangeTime": source,
                "receivedAt": iso(received), "sequence": sequence, "channel": channel,
                "price": round(float(row["price"]) / 10000, 4), "volume": int(row["volume"]),
                "amount": int(row["turnover"]), "volumeUnit": "provider-raw",
                "id": self.event_id, "generation": self.generation}
            self.events.append(self.latest_trade.copy())
        return True

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
                         and age <= stale_seconds and (lag is None or lag <= stale_seconds))
            result[name] = {**state, "source": name, "receivedAt": iso(state["receivedAt"]),
                "lastReceivedAt": iso(state["lastReceivedAt"]), "ageSeconds": None if age is None else round(age, 3),
                "available": available, "stale": not available, "sequenceAvailable": state["sequence"] is not None,
                "freshnessBasis": "accepted-receipt-and-relative-source-lag", "sourceFreshnessCertified": False,
                "sourceLagToSnapshotSeconds": lag,
                "countSemantics": "parsed-records; accepted records are ordered and bounded-deduplicated, not certified unique"}
        return result
