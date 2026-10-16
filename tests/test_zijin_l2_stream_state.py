import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from collections import deque

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from zijin_l2_stream_state import StreamState


def record(clock=93041000, index=1, channel=1, price=297300):
    return dict(symbol="000001", market=0, bs_flag="B", date=20261015, time=clock, index=index, channel=channel,
                price=price, volume=100, turnover=2973)


class StreamTests(unittest.TestCase):
    def test_cross_stream_times_are_independent(self):
        state = StreamState()
        self.assertTrue(state.accept("snapshot", record(), 1))
        self.assertTrue(state.accept("transaction", record(93000040), 2))
        self.assertTrue(state.accept("order", record(93000560), 3))
        self.assertEqual(state.streams["snapshot"]["exchangeTime"], "20261015-093041000")
        self.assertEqual(state.latest_trade["exchangeTime"], "20261015-093000040")
        public = state.public(3, True, 8)
        self.assertAlmostEqual(public["transaction"]["sourceLagToSnapshotSeconds"], 40.96)
        self.assertFalse(public["transaction"]["available"])
        self.assertTrue(public["snapshot"]["available"])

    def test_old_and_duplicate_records_cannot_rewind_latest_or_count_twice(self):
        state = StreamState()
        self.assertTrue(state.accept("transaction", record(index=10), 1))
        self.assertFalse(state.accept("transaction", record(index=10), 2))
        self.assertFalse(state.accept("transaction", record(93040000, 11), 3))
        self.assertFalse(state.accept("transaction", record(93042000, 9), 4))
        self.assertEqual(state.latest_trade["sequence"], 10)
        self.assertEqual(state.streams["transaction"]["receivedCount"], 4)
        self.assertEqual(state.streams["transaction"]["acceptedCount"], 1)
        self.assertEqual(state.streams["transaction"]["outOfOrderCount"], 2)

    def test_channels_are_not_one_global_sequence(self):
        state = StreamState()
        self.assertTrue(state.accept("transaction", record(index=100, channel=1), 1))
        self.assertTrue(state.accept("transaction", record(index=1, channel=2), 2))

    def test_missing_sequence_is_explicit_and_exact_duplicates_are_bounded(self):
        state = StreamState()
        row = record(); del row["index"]; del row["channel"]
        self.assertTrue(state.accept("transaction", row, 1))
        self.assertFalse(state.accept("transaction", row, 2))
        public = state.public(2, True, 8)["transaction"]
        self.assertFalse(public["sequenceAvailable"])
        self.assertEqual(public["missingSequenceCount"], 2)
        self.assertIsNone(state.latest_trade["sequence"])
        conflicting = {**row, "price": 297400}
        self.assertFalse(state.accept("transaction", conflicting, 3))
        self.assertEqual(state.streams["transaction"]["ambiguousTimeCount"], 1)
        self.assertEqual(state.latest_trade["price"], 29.73)

    def test_reconnect_requires_new_accepted_records_and_retains_watermarks(self):
        state = StreamState(); row = record()
        state.accept("transaction", row, 1)
        state.reconnect()
        self.assertFalse(state.public(2, True, 8)["transaction"]["available"])
        self.assertFalse(state.accept("transaction", row, 2))
        self.assertEqual(len(state.events), 0)
        self.assertTrue(state.accept("transaction", record(93042000, 2), 3))
        self.assertTrue(state.public(3, True, 8)["transaction"]["available"])
        self.assertFalse(state.public(3, False, 8)["transaction"]["available"])
        self.assertFalse(state.public(12, True, 8)["transaction"]["available"])

    def test_new_day_sequence_reset_and_bounded_events(self):
        state = StreamState()
        for index in range(1, 141): state.accept("transaction", record(93041000 + index, index), index)
        self.assertEqual(len(state.events), 128)
        row = record(index=1); row["date"] = 20261016
        self.assertTrue(state.accept("transaction", row, 142))
        self.assertEqual(state.event_id, 141)

    def test_invalid_source_time_does_not_replace_last(self):
        state = StreamState(); state.accept("transaction", record(), 1)
        self.assertFalse(state.accept("transaction", record(99610000, 2), 2))
        self.assertEqual(state.latest_trade["sequence"], 1)


class CollectorCallbackTests(unittest.TestCase):
    def test_stale_interval_does_not_release_an_existing_cooldown(self):
        import zijin_l2_collector as module
        machine = module.SecondLevelSignalMachine(state="cooldown", cooldown_until=10000)
        args = dict(market_open=True, price=30, vwap=30, high=31, low=29, atr_pct=.5,
            windows={f"{s}s": module.flow_window([], 9000, s) for s in (1, 3, 10, 30, 60)},
            book={}, book3={})
        self.assertEqual(machine.evaluate(now=9000, stale=True, **args)["state"], "invalid")
        self.assertEqual(machine.evaluate(now=9001, stale=False, **args)["state"], "cooldown")
        self.assertEqual(machine.cooldown_until, 10000)

    def test_real_published_state_is_json_serializable_and_marks_missing_streams(self):
        import zijin_l2_collector as module
        with patch.dict(module.os.environ, {"L2_NATS_USER": "", "L2_NATS_PASSWORD": ""}, clear=True), \
             patch.object(module.Collector, "load_intraday_flow_state"), \
             patch.object(module.Collector, "load_intraday_flow_forward_fallback"), \
             patch.object(module.Collector, "load_forward_index"), \
             patch.object(module.Collector, "refresh_forward_research"), \
             patch.object(module, "ZijinClosureV2ReverseShadow", return_value=SimpleNamespace(public_status=lambda: {})):
            collector = module.Collector()
        collector.connected = True
        state = json.loads(json.dumps(collector.state()))
        self.assertEqual(state["schemaVersion"], 6)
        self.assertEqual(state["lastExchangeTimeSource"], "snapshot")
        self.assertIsNone(state["latestTrade"])
        self.assertTrue(state["status"]["stale"])
        self.assertFalse(state["streams"]["snapshot"]["available"])
        self.assertEqual(state["tradeEventsMeta"]["limit"], 128)

    def test_real_callbacks_keep_snapshot_price_and_clock_when_backlog_arrives(self):
        import numpy as np
        import zijin_l2_collector as module
        collector = module.Collector.__new__(module.Collector)
        collector.stream_state = StreamState()
        collector.message_counts = dict(snapshot=0, transaction=0, order=0)
        collector.transactions, collector.orders, collector.book_samples = deque(), deque(), deque()
        collector.snapshot = collector.last_message_at = collector.last_exchange_time = None
        collector.update_minute_bar = lambda *a, **k: None
        collector.update_minute_flow = lambda *a, **k: None
        rows = {kind: np.zeros(1, dtype=dtype) for kind, dtype in
                [("snapshot", module.SNAPSHOT), ("transaction", module.TRANSACTION), ("order", module.ORDER)]}
        for kind, array in rows.items():
            array["date"] = 20261015; array["time"] = 93041000 if kind == "snapshot" else 93000040
        rows["snapshot"]["last"] = 297300
        rows["snapshot"]["volume"] = 7159911
        rows["transaction"]["price"] = 297200; rows["transaction"]["volume"] = 100
        rows["transaction"]["symbol"] = b"000001"; rows["transaction"]["bs_flag"] = b"B"
        rows["transaction"]["index"] = 1; rows["order"]["index"] = 1
        collector.parse = lambda data, dtype: rows[data]
        async def run():
            for kind in rows: await getattr(collector, "on_" + kind)(SimpleNamespace(data=kind))
            await collector.on_transaction(SimpleNamespace(data="transaction"))
            rows["snapshot"]["time"] = 93000000
            rows["snapshot"]["last"] = 290000
            await collector.on_snapshot(SimpleNamespace(data="snapshot"))
        asyncio.run(run())
        self.assertEqual(collector.last_exchange_time, "20261015-093041000")
        self.assertEqual(int(collector.snapshot["last"]), 297300)
        self.assertEqual(int(collector.snapshot["volume"]), 7159911)
        self.assertEqual(len(collector.transactions), 1)
        self.assertEqual(collector.message_counts["transaction"], 2)
        self.assertEqual(collector.stream_state.latest_trade["price"], 29.72)
        collector.current_minute_bar = {"volume": 100}
        collector.second_signal_machine = module.SecondLevelSignalMachine(state="cooldown", cooldown_until=10000, sequence=7)
        with patch.object(module.time, "time", return_value=9000):
            collector.begin_connection_epoch()
        self.assertEqual(collector.second_signal_machine.cooldown_until, 10000)
        self.assertEqual(collector.second_signal_machine.sequence, 8)
        self.assertEqual(len(collector.transactions), 0)
        self.assertEqual(len(collector.book_samples), 0)
        self.assertIsNone(collector.current_minute_bar)
        self.assertFalse(collector.stream_state.public(0, True, 8)["snapshot"]["available"])


if __name__ == "__main__": unittest.main()
