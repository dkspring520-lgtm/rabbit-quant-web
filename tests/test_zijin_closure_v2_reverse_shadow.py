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
    parse_tencent_exchange_minute,
)


PEER_SYMBOLS = (
    "sh600547",
    "sh600489",
    "sh600988",
    "sh603993",
    "sh600362",
    "sz000630",
    "sh512400",
    "hk02899",
)


def minute_record(
    minute,
    price,
    *,
    direction="reverse-t",
    active_buy_ratio=None,
    symbol="601899",
    previous_close=10.0,
    session_open=None,
):
    positive = direction == "positive-t"
    ratio = active_buy_ratio if active_buy_ratio is not None else (0.56 if positive else 0.44)
    open_price = session_open if session_open is not None else (9.9 if positive else 10.1)
    return {
        "schemaVersion": 3,
        "symbol": symbol,
        "exchangeMinute": minute,
        "lastPrice": price,
        "previousClose": previous_close,
        "sessionOpen": open_price,
        "minuteHigh": price,
        "cumulativeVwap": 10.0,
        "flow": {
            "activeBuyRatio60s": ratio,
            "activeBuyNotional60s": ratio * 1_000_000,
            "activeSellNotional60s": (1 - ratio) * 1_000_000,
            "bigBuyNotional60s": 300 if positive else 100,
            "bigSellNotional60s": 100 if positive else 300,
        },
        "volatility": {"atr14": 0.1},
        "book": {
            "nearTouchImbalance": 0.2 if positive else -0.2,
            "spreadBps": 10,
            "micropriceEdgeBps": 1 if positive else -1,
            "bidPrices": [round(price - 0.01 - index * 0.01, 2) for index in range(10)],
            "askPrices": [round(price + index * 0.01, 2) for index in range(10)],
            "bidVolumes": [10_000] * 10,
            "askVolumes": [10_000] * 10,
        },
    }


class ZijinMultiFactorShadowTest(unittest.TestCase):
    def make_observer(self, directory):
        observer = ZijinClosureV2ReverseShadow(
            event_path=Path(directory) / "events.jsonl",
            state_path=Path(directory) / "state.json",
        )
        observer.set_regime_context("20260810", {
            "zijin": 0.0,
            "sector": 0.0,
            "market": 0.0,
        }, source="unit-test")
        return observer

    @staticmethod
    def add_peer_resonance(observer, direction, minutes=("0937", "0938", "0939")):
        positive = direction == "positive-t"
        zijin = -60 if positive else 60
        peers = 20 if positive else -20
        for clock in minutes:
            observer.set_peer_snapshot(
                f"20260810-{clock}",
                {"sh601899": zijin, **{symbol: peers for symbol in PEER_SYMBOLS}},
                source="unit-test",
            )

    @staticmethod
    def feed_candidate(observer, direction, *, peers=True):
        positive = direction == "positive-t"
        prices = [9.90, 9.91, 9.92, 9.93, 9.94] if positive else [10.10, 10.09, 10.08, 10.07, 10.06]
        ratios = [0.50, 0.53, 0.54, 0.55, 0.56] if positive else [0.50, 0.47, 0.46, 0.45, 0.44]
        if peers:
            ZijinMultiFactorShadowTest.add_peer_resonance(observer, direction)
        events = []
        for clock, price, ratio in zip(("0935", "0936", "0937", "0938", "0939"), prices, ratios):
            events.append(observer.observe(minute_record(
                f"20260810-{clock}",
                price,
                direction=direction,
                active_buy_ratio=ratio,
            )))
        return events

    def test_positive_t_uses_all_four_factors_and_closes_profitably(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            candidate = self.feed_candidate(observer, "positive-t")[-1]
            self.assertEqual(candidate["event"], "candidate")
            self.assertEqual(candidate["direction"], "positive-t")
            self.assertEqual(candidate["factorScore"]["score"], 100)
            self.assertTrue(candidate["shadowOnly"])
            self.assertFalse(candidate["affectsProduction"])

            entry = observer.observe(minute_record("20260810-0940", 9.95, direction="positive-t"))
            self.assertEqual(entry["event"], "entry")
            resolved = observer.observe(minute_record("20260810-0941", 10.03, direction="positive-t"))
            self.assertEqual(resolved["event"], "resolved")
            self.assertEqual(resolved["direction"], "positive-t")
            self.assertGreater(resolved["actual"]["net"], 0)

    def test_reverse_t_uses_all_four_factors_and_closes_profitably(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            candidate = self.feed_candidate(observer, "reverse-t")[-1]
            self.assertEqual(candidate["event"], "candidate")
            self.assertEqual(candidate["direction"], "reverse-t")
            self.assertEqual(candidate["factorScore"]["score"], 100)

            entry = observer.observe(minute_record("20260810-0940", 10.05, direction="reverse-t"))
            self.assertEqual(entry["event"], "entry")
            resolved = observer.observe(minute_record("20260810-0941", 9.96, direction="reverse-t"))
            self.assertEqual(resolved["event"], "resolved")
            self.assertEqual(resolved["direction"], "reverse-t")
            self.assertGreater(resolved["actual"]["net"], 0)

    def test_opening_structure_requires_three_contiguous_aligned_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            observer.set_peer_snapshot("20260810-0937", {"sh601899": -60})
            for clock, price in (("0935", 9.90), ("0936", 9.91), ("0937", 9.92)):
                observer.observe(minute_record(f"20260810-{clock}", price, direction="positive-t"))
            self.assertIsNone(observer.public_status()["multiFactor"])
            observer.observe(minute_record("20260810-0938", 9.93, direction="positive-t"))
            observer.observe(minute_record("20260810-0939", 9.94, direction="positive-t"))
            opening = observer.public_status()["multiFactor"]["features"]["openingStructure"]["positive-t"]
            self.assertTrue(opening["passed"])
            self.assertGreaterEqual(opening["maximumAlignedMinutes"], 3)

    def test_l2_response_requires_directional_ofi_and_price_response(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            self.feed_candidate(observer, "positive-t", peers=False)
            status = observer.public_status()["multiFactor"]
            response = status["features"]["l2PriceResponse"]["positive-t"]
            self.assertTrue(response["passed"])
            self.assertGreaterEqual(response["meanOfi"], 0.05)
            self.assertGreaterEqual(response["priceResponse3MinBps"], 0)
            self.assertGreaterEqual(response["consecutiveAlignedMinutes"], 3)

    def test_learning_days_require_consecutive_valid_l2_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            for clock in ("0935", "0936", "0937", "0938", "0939"):
                record = minute_record(f"20260810-{clock}", 10.0)
                record["book"] = {}
                observer.observe(record)
            self.assertEqual(observer.public_status()["manualReview"]["tradingDays"], 0)

            for clock in ("0935", "0936", "0937", "0938", "0939"):
                observer.observe(minute_record(f"20260811-{clock}", 10.0))
            self.assertEqual(observer.public_status()["manualReview"]["tradingDays"], 1)

    def test_peer_resonance_uses_only_current_or_prior_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            self.add_peer_resonance(observer, "positive-t", minutes=("0940", "0941", "0942"))
            self.feed_candidate(observer, "positive-t", peers=False)
            peer = observer.public_status()["multiFactor"]["features"]["peerResonance"]["positive-t"]
            self.assertFalse(peer["passed"])
            self.assertFalse(peer["available"])

    def test_missing_peer_data_adds_no_score_but_cannot_bypass_hard_gates(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            candidate = self.feed_candidate(observer, "positive-t", peers=False)[-1]
            self.assertEqual(candidate["event"], "candidate")
            self.assertEqual(candidate["factorScore"]["components"]["peerResonance"], 0)
            self.assertEqual(candidate["factorScore"]["score"], 85)
            evaluation = observer.public_status()["multiFactor"]["directions"]["positive-t"]
            self.assertTrue(evaluation["gates"]["costCoverage"])
            self.assertTrue(evaluation["gates"]["vwapLocation"])

    def test_symbol_scope_and_daily_direction_cap_are_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            self.assertIsNone(observer.observe(minute_record(
                "20260810-0934", 9.90, direction="positive-t", symbol="601012"
            )))
            self.feed_candidate(observer, "positive-t")
            observer.observe(minute_record("20260810-0940", 9.95, direction="positive-t"))
            self.assertEqual(observer.counts["candidates"], 1)
            observer.observe(minute_record("20260810-0941", 9.96, direction="positive-t"))
            self.assertEqual(observer.counts["candidates"], 1)

    def test_events_and_review_status_remain_shadow_only(self):
        with tempfile.TemporaryDirectory() as directory:
            observer = self.make_observer(directory)
            self.feed_candidate(observer, "reverse-t")
            observer.observe(minute_record("20260810-0940", 10.05, direction="reverse-t"))
            observer.observe(minute_record("20260810-0941", 9.96, direction="reverse-t"))
            ledger = [
                json.loads(line)
                for line in (Path(directory) / "events.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertTrue(all(event["shadowOnly"] for event in ledger))
            self.assertTrue(all(not event["affectsProduction"] for event in ledger))
            review = observer.public_status()["manualReview"]
            self.assertFalse(review["automaticPromotion"])
            self.assertFalse(review["readyForManualReview"])

    def test_legacy_reverse_shadow_state_is_archived_without_polluting_v2_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text(json.dumps({
                "strategyId": "closure-v2-shadow-zijin-reverse-t",
                "lastMinute": "20260807-1459",
                "counts": {"resolved": 16, "wins": 12},
            }), encoding="utf-8")
            observer = ZijinClosureV2ReverseShadow(
                event_path=Path(directory) / "events.jsonl",
                state_path=state_path,
            )
            self.assertEqual(observer.counts["resolved"], 0)
            observer.set_regime_context("20260810", {"zijin": 0, "sector": 0, "market": 0})
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["legacyReverseShadow"]["counts"]["resolved"], 16)
            self.assertTrue(persisted["legacyReverseShadow"]["excludedFromV2PromotionMetrics"])

    def test_invalid_minute_is_rejected(self):
        self.assertFalse(is_continuous_minute("invalid-1459"))
        self.assertFalse(is_continuous_minute("20260230-1459"))
        self.assertTrue(is_continuous_minute("20260810-1459"))
        self.assertEqual(next_continuous_minute("20260810-1129"), "20260810-1300")

    def test_tencent_quote_minutes_support_a_share_and_hk_formats(self):
        self.assertEqual(parse_tencent_exchange_minute("20260811094932"), "20260811-0949")
        self.assertEqual(parse_tencent_exchange_minute("2026/08/11 09:49:49"), "20260811-0949")
        self.assertIsNone(parse_tencent_exchange_minute("invalid"))

    def test_stale_peer_quotes_are_excluded_from_current_resonance(self):
        returns = ZijinClosureV2ReverseShadow._fresh_peer_returns({
            "sh601899": {"exchangeMinute": "20260811-0950", "returnBps": -30},
            "sh512400": {"exchangeMinute": "20260811-0949", "returnBps": 10},
            "hk02899": {"exchangeMinute": "20260811-0935", "returnBps": 50},
            "future": {"exchangeMinute": "20260811-0951", "returnBps": 80},
        }, "20260811-0950", 1)
        self.assertEqual(returns, {"sh601899": -30.0, "sh512400": 10.0})


if __name__ == "__main__":
    unittest.main()
