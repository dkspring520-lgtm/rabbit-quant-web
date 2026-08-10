import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from zijin_closure_v2_reverse_shadow import (  # noqa: E402
    ZijinClosureV2ReverseShadow,
    is_continuous_minute,
    next_continuous_minute,
)


def minute_record(minute, price, *, imbalance=-0.2, active_buy_ratio=0.4, symbol="601899"):
    return {
        "symbol": symbol,
        "exchangeMinute": minute,
        "lastPrice": price,
        "minuteHigh": price,
        "cumulativeVwap": 10.0,
        "flow": {
            "activeBuyRatio60s": active_buy_ratio,
            "bigBuyNotional60s": 100,
            "bigSellNotional60s": 300,
        },
        "book": {
            "nearTouchImbalance": imbalance,
            "micropriceEdgeBps": -1,
            "bidPrices": [round(price - 0.01 - index * 0.01, 2) for index in range(10)],
            "askPrices": [round(price + index * 0.01, 2) for index in range(10)],
            "bidVolumes": [10_000] * 10,
            "askVolumes": [10_000] * 10,
        },
    }


class ReverseShadowTest(unittest.TestCase):
    def make_observer(self, directory):
        observer = ZijinClosureV2ReverseShadow(
            event_path=Path(directory) / "events.jsonl",
            state_path=Path(directory) / "state.json",
        )
        observer.set_regime_context("20260810", {
            "zijin": -0.02,
            "sector": -0.03,
            "market": -0.01,
        }, source="unit-test")
        return observer

    @staticmethod
    def feed_candidate(observer, *, imbalance=-0.2):
        rows = [
            ("20260810-0957", 10.15),
            ("20260810-0958", 10.14),
            ("20260810-0959", 10.13),
            ("20260810-1000", 10.12),
            ("20260810-1001", 10.10),
        ]
        return [
            observer.observe(minute_record(minute, price, imbalance=imbalance))
            for minute, price in rows
        ]

    def test_candidate_is_shadow_only_and_does_not_use_future_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            events = self.feed_candidate(observer)
            candidate = events[-1]
            self.assertEqual(candidate["event"], "candidate")
            self.assertTrue(candidate["shadowOnly"])
            self.assertFalse(candidate["affectsProduction"])
            self.assertFalse(candidate["sendsAlerts"])
            self.assertFalse(candidate["automaticPromotion"])
            self.assertEqual(observer.counts["resolved"], 0)
            status = observer.public_status()["multiFactor"]
            self.assertTrue(status["passed"])
            self.assertEqual(status["passedCount"], status["totalCount"])
            self.assertEqual(status["exchangeMinute"], "20260810-1001")

    def test_failed_gate_does_not_create_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            events = self.feed_candidate(observer, imbalance=0.2)
            self.assertTrue(all(event is None for event in events))
            self.assertEqual(observer.counts["candidates"], 0)

    def test_next_minute_entry_and_fifty_minute_exit_use_depth_and_costs(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            self.feed_candidate(observer)
            entry = observer.observe(minute_record("20260810-1002", 10.09))
            self.assertEqual(entry["event"], "entry")
            minute = "20260810-1002"
            resolved = None
            for step in range(50):
                minute = next_continuous_minute(minute)
                resolved = observer.observe(minute_record(minute, 10.01 if step == 49 else 10.08))
            self.assertEqual(resolved["event"], "resolved")
            self.assertGreater(resolved["actual"]["net"], 0)
            self.assertLess(resolved["stress5BpsPerSide"]["net"], resolved["actual"]["net"])
            self.assertEqual(observer.counts["resolved"], 1)
            self.assertEqual(observer.counts["wins"], 1)

            ledger = [json.loads(line) for line in (Path(directory) / "events.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual([event["event"] for event in ledger], ["candidate", "entry", "resolved"])

    def test_symbol_scope_and_daily_signal_cap_are_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            self.assertIsNone(observer.observe(minute_record("20260810-0956", 10.15, symbol="601012")))
            self.feed_candidate(observer)
            observer.observe(minute_record("20260810-1002", 10.09))
            self.assertEqual(observer.counts["candidates"], 1)
            observer.observe(minute_record("20260810-1003", 10.08))
            self.assertEqual(observer.counts["candidates"], 1)
            self.assertEqual(observer.public_status()["multiFactor"]["exchangeMinute"], "20260810-1003")

    def test_invalid_minute_is_rejected(self):
        self.assertFalse(is_continuous_minute("invalid-1459"))
        self.assertFalse(is_continuous_minute("20260230-1459"))
        self.assertTrue(is_continuous_minute("20260810-1459"))


if __name__ == "__main__":
    unittest.main()
