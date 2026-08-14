import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "backtest-zijin-candidate-l2-overlay.py"
SPEC = importlib.util.spec_from_file_location("zijin_candidate_l2_overlay", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def trade(price, buy=700, sell=300):
    return MODULE.SECOND.TradeBucket(price, price, price, price, buy, sell, 1)


def quote(price, positive=True):
    if positive:
        bid_volumes, ask_volumes = (800, 700, 600, 500, 400), (200, 200, 200, 200, 200)
    else:
        bid_volumes, ask_volumes = (200, 200, 200, 200, 200), (800, 700, 600, 500, 400)
    return MODULE.SECOND.QuoteBucket(
        price,
        (price - 0.01, price - 0.02, price - 0.03, price - 0.04, price - 0.05),
        (price + 0.01, price + 0.02, price + 0.03, price + 0.04, price + 0.05),
        bid_volumes,
        ask_volumes,
    )


class CandidateL2OverlayTest(unittest.TestCase):
    def setUp(self):
        self.start = 9 * 3600 + 30 * 60

    def candidate(self, direction="positiveT"):
        return {
            "candidateId": "sample",
            "date": "20250102",
            "second": self.start,
            "direction": direction,
            "source": "test",
            "factorCombinationId": "test-v1",
            "factors": {},
        }

    def test_three_continuous_seconds_confirm_matching_positive_candidate(self):
        trades = {
            self.start + offset: trade(15 + offset * 0.001)
            for offset in range(0, 5)
        }
        quotes = {self.start: quote(15, positive=True)}

        result = MODULE.classify_l2(self.candidate(), trades, quotes, window_seconds=5)

        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["decisionSecond"], self.start + 2)
        self.assertEqual(result["evaluatedSeconds"], 3)

    def test_three_continuous_opposing_seconds_veto_candidate(self):
        trades = {
            self.start + offset: trade(15 - offset * 0.001, buy=200, sell=800)
            for offset in range(0, 5)
        }
        quotes = {self.start: quote(15, positive=False)}

        result = MODULE.classify_l2(self.candidate(), trades, quotes, window_seconds=5)

        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["decisionSecond"], self.start + 2)

    def test_cohorts_keep_baseline_and_neutral_veto_only_separate(self):
        baseline = MODULE.cohort_decision("minuteBaseline", "neutral", self.start, self.start + 10)
        confirm = MODULE.cohort_decision("l2ConfirmOnly", "neutral", self.start, self.start + 10)
        veto = MODULE.cohort_decision("l2VetoOnly", "neutral", self.start, self.start + 10)
        combined = MODULE.cohort_decision("l2ConfirmAndVeto", "neutral", self.start, self.start + 10)

        self.assertTrue(baseline[0])
        self.assertFalse(confirm[0])
        self.assertTrue(veto[0])
        self.assertFalse(combined[0])

    def test_simulation_enters_after_decision_and_records_full_costed_close(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00),
            self.start + 2: MODULE.SECOND.TradeBucket(15.10, 15.10, 15.12, 15.10, 500, 500, 1),
        }

        result = MODULE.simulate_round_trip(self.candidate(), self.start, trades)

        self.assertEqual(result["status"], "closed")
        self.assertEqual(result["entrySecond"], self.start + 1)
        self.assertEqual(result["exitReason"], "target")
        self.assertGreater(result["fees"], 0)
        self.assertGreater(result["netPnl"], 0)

    def test_risk_managed_simulation_hard_stops_adverse_positive_t(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00),
            self.start + 2: MODULE.SECOND.TradeBucket(14.90, 14.90, 14.91, 14.89, 200, 800, 1),
        }

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, prior_atr=0.50,
            risk_managed=True, stop_model="tight"
        )

        self.assertEqual(result["exitReason"], "hardStop")
        self.assertLess(result["netPnl"], 0)
        self.assertLessEqual(result["exitSecond"], self.start + 2)

    def test_l2_invalidation_executes_on_strictly_later_second(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset, price in ((2, 14.98), (3, 14.98), (4, 14.98), (5, 14.98)):
            trades[self.start + offset] = trade(price, buy=100, sell=900)
            quotes[self.start + offset] = quote(price, positive=False)

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50, risk_managed=True
        )

        self.assertEqual(result["exitReason"], "l2PriceInvalidation")
        self.assertEqual(result["exitDecisionSecond"], self.start + 4)
        self.assertEqual(result["exitSecond"], self.start + 5)

    def test_v22_three_opposing_seconds_warn_but_do_not_exit(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 5):
            trades[self.start + offset] = trade(14.98, buy=100, sell=900)
            quotes[self.start + offset] = quote(14.98, positive=False)
        trades[self.start + 5] = MODULE.SECOND.TradeBucket(
            15.00, 15.08, 15.09, 15.00, 900, 100, 1
        )

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v22"
        )

        self.assertEqual(result["exitReason"], "target")
        self.assertIsNotNone(result["warningSecond"])

    def test_v22_exits_only_after_sustained_l2_and_price_deterioration(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00, buy=900, sell=100)}
        quotes = {}
        prices = (14.995, 14.990, 14.985, 14.980, 14.975, 14.970, 14.969)
        for offset, price in enumerate(prices, start=2):
            trades[self.start + offset] = trade(price, buy=50, sell=950)
            quotes[self.start + offset] = quote(price, positive=False)

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v22"
        )

        self.assertEqual(result["exitReason"], "l2PriceInvalidation")
        self.assertGreaterEqual(result["exitDecisionSecond"], self.start + 7)
        self.assertEqual(result["exitSecond"], result["exitDecisionSecond"] + 1)
        self.assertGreaterEqual(result["exitConfirmation"]["confirmations"], 2)

    def test_v23_positive_tail_stop_is_inactive_during_grace_period(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00),
            self.start + 2: MODULE.SECOND.TradeBucket(
                14.85, 14.85, 14.86, 14.84, 100, 900, 1
            ),
            self.start + 17: MODULE.SECOND.TradeBucket(
                15.00, 15.08, 15.09, 15.00, 900, 100, 1
            ),
        }

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, prior_atr=0.50,
            risk_managed=True, exit_model="v23"
        )

        self.assertEqual(result["exitReason"], "target")
        self.assertEqual(result["entrySecond"], self.start + 1)

    def test_v23_positive_tail_stop_activates_after_grace_period(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00),
            self.start + 16: MODULE.SECOND.TradeBucket(
                14.85, 14.85, 14.86, 14.84, 100, 900, 1
            ),
        }

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, prior_atr=0.50,
            risk_managed=True, exit_model="v23"
        )

        self.assertEqual(result["exitReason"], "hardStop")
        self.assertEqual(result["exitSecond"], self.start + 16)
        self.assertEqual(result["stopGap"], 0.12)

    def test_v24_positive_recovery_cancels_pending_exit(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset, price in enumerate(
            (14.995, 14.990, 14.985, 14.980, 14.975, 14.970), start=2
        ):
            trades[self.start + offset] = trade(price, buy=50, sell=950)
            quotes[self.start + offset] = quote(price, positive=False)
        for offset in range(8, 11):
            trades[self.start + offset] = trade(14.995, buy=950, sell=50)
            quotes[self.start + offset] = quote(14.995, positive=True)
        trades[self.start + 11] = MODULE.SECOND.TradeBucket(
            15.00, 15.08, 15.09, 15.00, 900, 100, 1
        )

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v24"
        )

        self.assertEqual(result["exitReason"], "target")

    def test_v24_positive_sustained_deterioration_exits_on_later_trade(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 14):
            price = 15.00 - offset * 0.005
            trades[self.start + offset] = trade(price, buy=50, sell=950)
            quotes[self.start + offset] = quote(price, positive=False)

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v24"
        )

        self.assertEqual(result["exitReason"], "l2PriceInvalidation")
        self.assertGreaterEqual(
            result["exitConfirmation"]["recoveryObservationSeconds"],
            MODULE.V24_RECOVERY_OBSERVATION_SECONDS,
        )
        self.assertEqual(result["exitSecond"], result["exitDecisionSecond"] + 1)

    def test_v24_reverse_t_preserves_v22_exit_behavior(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 10):
            price = 15.00 + offset * 0.005
            trades[self.start + offset] = trade(price, buy=950, sell=50)
            quotes[self.start + offset] = quote(price, positive=True)

        v22 = MODULE.simulate_round_trip(
            self.candidate("reverseT"), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v22"
        )
        v24 = MODULE.simulate_round_trip(
            self.candidate("reverseT"), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v24"
        )

        for key in ("entrySecond", "exitSecond", "exitMarketPrice", "exitReason", "netPnl"):
            self.assertEqual(v24[key], v22[key])

    def test_v25_positive_gate_requires_minimum_active_buy_ratio(self):
        l2 = {
            "status": "confirmed",
            "evidence": [{
                "second": self.start + 3,
                "activeBuyRatio": MODULE.V25_POSITIVE_MIN_ACTIVE_BUY_RATIO - 0.001,
                "priceResponseBps": 10,
            }],
        }

        rejected = MODULE.v25_entry_gate(self.candidate("positiveT"), l2)
        l2["evidence"][0]["activeBuyRatio"] = MODULE.V25_POSITIVE_MIN_ACTIVE_BUY_RATIO
        accepted = MODULE.v25_entry_gate(self.candidate("positiveT"), l2)

        self.assertFalse(rejected["passed"])
        self.assertEqual(rejected["reason"], "positive-buy-flow-too-weak")
        self.assertTrue(accepted["passed"])

    def test_v25_reverse_gate_requires_downward_price_response(self):
        l2 = {
            "status": "confirmed",
            "evidence": [{
                "second": self.start + 3,
                "activeBuyRatio": 0.20,
                "priceResponseBps": MODULE.V25_REVERSE_MAX_PRICE_RESPONSE_BPS + 0.01,
            }],
        }

        rejected = MODULE.v25_entry_gate(self.candidate("reverseT"), l2)
        l2["evidence"][0]["priceResponseBps"] = MODULE.V25_REVERSE_MAX_PRICE_RESPONSE_BPS
        accepted = MODULE.v25_entry_gate(self.candidate("reverseT"), l2)

        self.assertFalse(rejected["passed"])
        self.assertEqual(rejected["reason"], "reverse-price-response-too-weak")
        self.assertTrue(accepted["passed"])

    def test_v25_gate_never_accepts_unconfirmed_l2(self):
        l2 = {
            "status": "neutral",
            "evidence": [{
                "second": self.start + 3,
                "activeBuyRatio": 0.90,
                "priceResponseBps": -20,
            }],
        }

        result = MODULE.v25_entry_gate(self.candidate("positiveT"), l2)

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "requires-confirmed-l2")

    def test_v25_counterfactual_counts_only_otherwise_executable_signals(self):
        trade = {"netPnl": -120.0}
        rows = [
            {
                "entryGate": {"passed": False},
                "counterfactualSimulation": trade,
            },
            {
                "entryGate": {"passed": False},
                "counterfactualSimulation": None,
            },
        ]

        result = MODULE.filtered_counterfactual(rows)

        self.assertEqual(result["filteredSignals"], 1)
        self.assertEqual(result["counterfactualClosedTrades"], 1)
        self.assertEqual(result["counterfactualNetPnl"], -120.0)

    def test_v26_positive_gate_rejects_confirmed_negative_price_response(self):
        l2 = {
            "status": "confirmed",
            "evidence": [{
                "second": self.start + 1,
                "activeBuyRatio": 0.70,
                "priceResponseBps": -0.01,
            }, {
                "second": self.start + 3,
                "activeBuyRatio": 0.70,
                "priceResponseBps": -0.01,
            }],
        }

        result = MODULE.v26_entry_gate(self.candidate("positiveT"), l2, 0.50)

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "positive-price-flow-divergence")

    def test_v26_positive_gate_rejects_buy_flow_collapse(self):
        l2 = {
            "status": "confirmed",
            "evidence": [{
                "second": self.start + 1,
                "activeBuyRatio": 0.60,
                "priceResponseBps": 0,
            }, {
                "second": self.start + 3,
                "activeBuyRatio": 0.39,
                "priceResponseBps": 1,
            }],
        }

        result = MODULE.v26_entry_gate(self.candidate("positiveT"), l2, 0.50)

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "positive-buy-flow-collapse")

    def test_v26_regime_context_does_not_fill_missing_market_data(self):
        result = MODULE.v26_entry_gate(
            self.candidate("positiveT"),
            {
                "status": "confirmed",
                "evidence": [{
                    "second": self.start + 3,
                    "activeBuyRatio": 0.70,
                    "priceResponseBps": 1,
                }],
            },
            0.50,
        )

        self.assertTrue(result["passed"])
        self.assertEqual(result["regimeContext"]["market"]["status"], "unavailable")
        self.assertIsNone(result["regimeContext"]["market"]["value"])
        self.assertEqual(result["regimeContext"]["sector"]["status"], "unavailable")

    def test_v26_positive_gate_honors_available_negative_market_regime(self):
        candidate = self.candidate("positiveT")
        candidate["factors"] = {"marketRegime": "bearish"}
        result = MODULE.v26_entry_gate(
            candidate,
            {
                "status": "confirmed",
                "evidence": [{
                    "second": self.start + 3,
                    "activeBuyRatio": 0.70,
                    "priceResponseBps": 1,
                }],
            },
            0.50,
        )

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "positive-negative-market-regime")

    def test_v26_positive_t_preserves_v24_recovery_exit_behavior(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00, buy=900, sell=100),
            self.start + 2: trade(14.99, buy=900, sell=100),
            self.start + 3: trade(14.99, buy=900, sell=100),
            self.start + 4: trade(14.98, buy=900, sell=100),
            self.start + 5: MODULE.SECOND.TradeBucket(
                15.00, 15.08, 15.09, 15.00, 900, 100, 1
            ),
        }
        quotes = {
            self.start + offset: quote(15.00, positive=True)
            for offset in range(2, 5)
        }

        v24 = MODULE.simulate_round_trip(
            self.candidate("positiveT"), self.start, trades, quotes,
            prior_atr=0.50, risk_managed=True, exit_model="v24",
        )
        v26 = MODULE.simulate_round_trip(
            self.candidate("positiveT"), self.start, trades, quotes,
            prior_atr=0.50, risk_managed=True, exit_model="v26",
        )

        for key in ("entrySecond", "exitSecond", "exitMarketPrice", "exitReason", "netPnl"):
            self.assertEqual(v26[key], v24[key])

    def test_v26_reverse_t_preserves_v22_exit_behavior(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 10):
            price = 15.00 + offset * 0.005
            trades[self.start + offset] = trade(price, buy=950, sell=50)
            quotes[self.start + offset] = quote(price, positive=True)

        v22 = MODULE.simulate_round_trip(
            self.candidate("reverseT"), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v22",
        )
        v26 = MODULE.simulate_round_trip(
            self.candidate("reverseT"), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v26",
        )

        for key in ("entrySecond", "exitSecond", "exitMarketPrice", "exitReason", "netPnl"):
            self.assertEqual(v26[key], v22[key])

    def v27_l2(self):
        return {
            "status": "confirmed",
            "decisionSecond": self.start + 2,
            "evidence": [
                {
                    "second": self.start + offset,
                    "activeBuyRatio": 0.70,
                    "depthImbalance": 0.20,
                    "micropriceEdgeBps": 2.0,
                    "priceResponseBps": 2.0,
                    "alignedVotes": 4,
                }
                for offset in range(3)
            ],
        }

    def v27_history(self, features, net_pnl=80.0, success=True, count=8):
        return [
            {
                "date": f"202412{index + 1:02d}",
                "direction": "positiveT",
                "features": features,
                "outcomes": {
                    "shortRebound60s": success,
                    "targetBeforeStop15m": success,
                    "closureWithin45m": success,
                },
                "netPnl": net_pnl,
            }
            for index in range(count)
        ]

    def test_v27_accepts_high_confidence_positive_t_after_prior_only_calibration(self):
        candidate = self.candidate("positiveT")
        l2 = self.v27_l2()
        features = MODULE.v27_entry_features(candidate, l2, 0.50)
        result = MODULE.v27_entry_gate(
            candidate,
            l2,
            0.50,
            {self.start + 3: trade(15.00)},
            self.v27_history(features),
        )

        self.assertTrue(result["passed"])
        self.assertEqual(result["reason"], "v27-calibrated-positive-entry-confirmed")
        self.assertGreater(result["expectedValue"]["decisionNetPnl"], 0)
        self.assertEqual(
            result["expectedValue"]["decisionBasis"],
            "prior-date-empirical-after-costs",
        )
        self.assertGreaterEqual(
            result["probabilities"]["targetBeforeStop15m"]["lowerBound95"],
            MODULE.V27_MIN_TARGET_FIRST_LOWER_BOUND,
        )

    def test_v27_rejects_positive_t_when_costed_expected_value_is_negative(self):
        candidate = self.candidate("positiveT")
        l2 = self.v27_l2()
        features = MODULE.v27_entry_features(candidate, l2, 0.50)
        result = MODULE.v27_entry_gate(
            candidate,
            l2,
            0.50,
            {self.start + 3: trade(15.00)},
            self.v27_history(features, net_pnl=-20.0),
        )

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "positive-expected-value-not-positive")

    def test_v27_learning_period_keeps_v26_qualified_positive_t_as_shadow(self):
        candidate = self.candidate("positiveT")
        l2 = self.v27_l2()
        features = MODULE.v27_entry_features(candidate, l2, 0.50)
        result = MODULE.v27_entry_gate(
            candidate,
            l2,
            0.50,
            {self.start + 3: trade(15.00)},
            self.v27_history(features, count=3),
        )

        self.assertTrue(result["passed"])
        self.assertFalse(result["calibrationApplied"])
        self.assertEqual(result["confidenceState"], "learning")
        self.assertEqual(result["reason"], "v27-confidence-learning-v26-fallback")

    def test_v27_probability_calibration_never_reads_future_dates(self):
        candidate = self.candidate("positiveT")
        l2 = self.v27_l2()
        features = MODULE.v27_entry_features(candidate, l2, 0.50)
        history = self.v27_history(features, net_pnl=-20.0, success=False)
        history.extend({
            "date": f"202502{index + 1:02d}",
            "direction": "positiveT",
            "features": features,
            "outcomes": {
                "shortRebound60s": True,
                "targetBeforeStop15m": True,
                "closureWithin45m": True,
            },
            "netPnl": 80.0,
        } for index in range(20))

        estimate = MODULE.v27_probability_estimate(
            "targetBeforeStop15m", features, history, candidate["date"]
        )

        self.assertEqual(estimate["sampleCount"], 8)
        self.assertLess(estimate["probability"], 0.5)
        self.assertLess(estimate["latestCalibrationDate"], candidate["date"])
        self.assertTrue(estimate["usesPriorDatesOnly"])

    def test_v27_temporary_deterioration_does_not_force_early_exit(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 10):
            price = 15.00 - offset * 0.005
            trades[self.start + offset] = trade(price, buy=50, sell=950)
            quotes[self.start + offset] = quote(price, positive=False)
        for offset in range(10, 13):
            trades[self.start + offset] = trade(14.995, buy=950, sell=50)
            quotes[self.start + offset] = quote(14.995, positive=True)
        trades[self.start + 13] = MODULE.SECOND.TradeBucket(
            15.00, 15.08, 15.09, 15.00, 900, 100, 1
        )

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v27",
            entry_confidence={"probabilities": {
                "targetBeforeStop15m": {"probability": 0.75}
            }},
        )

        self.assertEqual(result["exitReason"], "target")

    def test_v27_sustained_low_confidence_deterioration_exits(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 16):
            price = 15.00 - offset * 0.005
            trades[self.start + offset] = trade(price, buy=50, sell=950)
            quotes[self.start + offset] = quote(price, positive=False)

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v27",
            entry_confidence={"probabilities": {
                "targetBeforeStop15m": {"probability": 0.75}
            }},
        )

        self.assertEqual(result["exitReason"], "l2PriceInvalidation")
        self.assertGreaterEqual(
            result["exitConfirmation"]["v27LowConfidenceSeconds"],
            MODULE.V27_EXIT_LOW_CONFIDENCE_SECONDS,
        )
        self.assertLess(
            result["exitConfirmation"]["v27Reassessment"]["expectedNetPnl"], 0
        )

    def test_v27_preserves_hard_stop(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00),
            self.start + 2: MODULE.SECOND.TradeBucket(
                14.80, 14.80, 14.81, 14.79, 50, 950, 1
            ),
        }

        result = MODULE.simulate_round_trip(
            self.candidate(), self.start, trades, prior_atr=0.50,
            risk_managed=True, exit_model="v27",
            entry_confidence={"probabilities": {
                "targetBeforeStop15m": {"probability": 0.90}
            }},
        )

        self.assertEqual(result["exitReason"], "hardStop")

    def test_v27_reverse_t_preserves_v22_exit_behavior(self):
        trades = {self.start: trade(15.00), self.start + 1: trade(15.00)}
        quotes = {}
        for offset in range(2, 10):
            price = 15.00 + offset * 0.005
            trades[self.start + offset] = trade(price, buy=950, sell=50)
            quotes[self.start + offset] = quote(price, positive=True)

        v22 = MODULE.simulate_round_trip(
            self.candidate("reverseT"), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v22",
        )
        v27 = MODULE.simulate_round_trip(
            self.candidate("reverseT"), self.start, trades, quotes, prior_atr=0.50,
            risk_managed=True, exit_model="v27",
        )

        for key in ("entrySecond", "exitSecond", "exitMarketPrice", "exitReason", "netPnl"):
            self.assertEqual(v27[key], v22[key])

    def test_v28_delayed_window_promotes_only_initial_neutral_candidate(self):
        initial = {
            "status": "neutral",
            "decisionSecond": self.start + 10,
            "evaluatedSeconds": 0,
            "evidence": [],
            "reason": "initial neutral",
        }
        trades = {
            self.start + offset: trade(15 + max(0, offset - 10) * 0.001)
            for offset in range(11, 16)
        }
        quotes = {self.start + 11: quote(15, positive=True)}

        result = MODULE.v28_delayed_l2_decision(
            self.candidate(), initial, trades, quotes, delayed_seconds=5
        )

        self.assertEqual(result["status"], "confirmed")
        self.assertTrue(result["delayedReview"])
        self.assertTrue(result["delayedPromotion"])
        self.assertGreater(result["decisionSecond"], initial["decisionSecond"])

    def test_v28_explicit_initial_rejection_is_never_reconsidered(self):
        initial = {
            "status": "rejected",
            "decisionSecond": self.start + 2,
            "evaluatedSeconds": 3,
            "evidence": [{"second": self.start + 2}],
            "reason": "explicit veto",
        }
        trades = {
            self.start + offset: trade(15 + offset * 0.001)
            for offset in range(3, 10)
        }
        quotes = {self.start + 3: quote(15, positive=True)}

        result = MODULE.v28_delayed_l2_decision(
            self.candidate(), initial, trades, quotes
        )

        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["decisionSecond"], initial["decisionSecond"])
        self.assertFalse(result["delayedReview"])
        self.assertFalse(result["delayedPromotion"])

    def test_v28_delayed_window_does_not_read_evidence_after_decision(self):
        initial = {
            "status": "neutral",
            "decisionSecond": self.start + 10,
            "evaluatedSeconds": 0,
            "evidence": [],
            "reason": "initial neutral",
        }
        balanced_quote = MODULE.SECOND.QuoteBucket(
            15.00,
            (14.99, 14.98, 14.97, 14.96, 14.95),
            (15.01, 15.02, 15.03, 15.04, 15.05),
            (500, 500, 500, 500, 500),
            (500, 500, 500, 500, 500),
        )
        trades = {
            self.start + offset: trade(15.00, buy=500, sell=500)
            for offset in range(11, 35)
        }
        quotes = {self.start + 11: balanced_quote, self.start + 32: quote(15, True)}

        result = MODULE.v28_delayed_l2_decision(
            self.candidate(), initial, trades, quotes, delayed_seconds=20
        )

        self.assertEqual(result["status"], "neutral")
        self.assertEqual(result["decisionSecond"], self.start + 31)
        self.assertTrue(all(
            item["second"] <= result["decisionSecond"] for item in result["evidence"]
        ))

    def test_v28_intraday_candidate_is_timestamped_after_completed_minute(self):
        minutes = []
        for offset in range(15):
            price = 15.05 - offset * 0.01
            minutes.append({
                "time": f"{9 + (30 + offset) // 60:02d}{(30 + offset) % 60:02d}",
                "open": price + 0.01,
                "high": price + 0.03,
                "low": price - 0.03,
                "close": price,
                "volume": 1_000,
                "amount": price * 1_000,
            })
        minutes.append({
            "time": "0945",
            "open": 14.89,
            "high": 14.94,
            "low": 14.84,
            "close": 14.92,
            "volume": 900,
            "amount": 14.92 * 900,
        })
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "minutes.jsonl"
            path.write_text(json.dumps({
                "date": "20250102",
                "previousClose": 15.10,
                "minutes": minutes,
            }) + "\n", encoding="utf-8")

            candidates = MODULE.v28_intraday_pullback_candidates(path, {"20250102"})

        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate["second"], 9 * 3600 + 46 * 60)
        self.assertEqual(candidate["factorCombinationId"], "v28-intraday-pullback-v1")
        self.assertTrue(candidate["factors"]["usesCompletedMinuteAndPriorMinutesOnly"])

    def test_v28_reverse_t_bullish_environment_vetoes_without_zero_fill(self):
        candidate = self.candidate("reverseT")
        candidate["factors"] = {"marketRegime": "bullish"}
        l2 = {
            "status": "confirmed",
            "decisionSecond": self.start + 2,
            "evidence": [{
                "second": self.start + 2,
                "activeBuyRatio": 0.20,
                "depthImbalance": -0.20,
                "micropriceEdgeBps": -2.0,
                "priceResponseBps": -5.0,
                "alignedVotes": 4,
            }],
        }

        result = MODULE.v28_entry_gate(
            candidate, l2, 0.50, {self.start + 3: trade(15.00)}, []
        )

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "reverse-bullish-environment-veto")
        self.assertEqual(result["reverseRiskContext"]["availableInputs"], 1)
        self.assertFalse(result["reverseRiskContext"]["missingInputsFilledWithZero"])

    def test_v28_intraday_candidate_keeps_v27_probability_gate(self):
        candidate = self.candidate("positiveT")
        candidate["factorCombinationId"] = "v28-intraday-pullback-v1"
        candidate["factors"] = {"usesCompletedMinuteAndPriorMinutesOnly": True}
        l2 = {
            "status": "confirmed",
            "decisionSecond": self.start + 2,
            "evidence": [],
        }
        rejection = {
            "passed": False,
            "reason": "positive-expected-value-not-positive",
            "model": "v27-online-calibrated-positive-entry",
        }

        with mock.patch.object(MODULE, "v27_entry_gate", return_value=rejection) as gate:
            result = MODULE.v28_entry_gate(
                candidate, l2, 0.50, {self.start + 3: trade(15.00)}, []
            )

        gate.assert_called_once()
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "positive-expected-value-not-positive")

    def test_v28_intraday_learning_candidate_remains_observation_only(self):
        candidate = self.candidate("positiveT")
        candidate["factorCombinationId"] = "v28-intraday-pullback-v1"
        candidate["factors"] = {"usesCompletedMinuteAndPriorMinutesOnly": True}
        l2 = {"status": "confirmed", "decisionSecond": self.start + 2, "evidence": []}
        learning = {
            "passed": True,
            "reason": "v27-confidence-learning-v26-fallback",
            "calibrationApplied": False,
        }

        with mock.patch.object(MODULE, "v27_entry_gate", return_value=learning):
            result = MODULE.v28_entry_gate(
                candidate, l2, 0.50, {self.start + 3: trade(15.00)}, []
            )

        self.assertFalse(result["passed"])
        self.assertEqual(
            result["reason"], "intraday-calibration-learning-observation-only"
        )

    def test_v28_delayed_confirmation_remains_observation_only(self):
        candidate = self.candidate("reverseT")
        l2 = {
            "status": "confirmed",
            "decisionSecond": self.start + 12,
            "evidence": [],
            "delayedPromotion": True,
        }
        accepted = {"passed": True, "reason": "accepted"}

        with mock.patch.object(MODULE, "v27_entry_gate", return_value=accepted):
            result = MODULE.v28_entry_gate(
                candidate, l2, 0.50, {self.start + 13: trade(15.00)}, []
            )

        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "delayed-confirmation-observation-only")

    def test_v28_intraday_rejects_probability_below_costed_break_even(self):
        candidate = self.candidate("positiveT")
        candidate["factorCombinationId"] = "v28-intraday-pullback-v1"
        candidate["factors"] = {"usesCompletedMinuteAndPriorMinutesOnly": True}
        l2 = {"status": "confirmed", "decisionSecond": self.start + 2, "evidence": []}
        costed_rejection = {
            "passed": True,
            "reason": "v27-calibrated-positive-entry-confirmed",
            "calibrationApplied": True,
            "probabilities": {"targetBeforeStop15m": {"probability": 0.58}},
            "expectedValue": {
                "breakEvenProbability": 0.60,
                "conservativeNetPnl": 5.0,
                "includesFeesAndSlippage": True,
            },
        }

        with mock.patch.object(MODULE, "v27_entry_gate", return_value=costed_rejection):
            result = MODULE.v28_entry_gate(
                candidate, l2, 0.50, {self.start + 3: trade(15.00)}, []
            )

        self.assertFalse(result["passed"])
        self.assertEqual(
            result["reason"], "intraday-probability-below-costed-break-even"
        )

    def test_v28_intraday_accepts_calibrated_positive_after_cost_candidate(self):
        candidate = self.candidate("positiveT")
        candidate["factorCombinationId"] = "v28-intraday-pullback-v1"
        candidate["factors"] = {"usesCompletedMinuteAndPriorMinutesOnly": True}
        l2 = {"status": "confirmed", "decisionSecond": self.start + 2, "evidence": []}
        accepted = {
            "passed": True,
            "reason": "v27-calibrated-positive-entry-confirmed",
            "calibrationApplied": True,
            "probabilities": {"targetBeforeStop15m": {"probability": 0.66}},
            "expectedValue": {
                "breakEvenProbability": 0.60,
                "conservativeNetPnl": 5.0,
                "includesFeesAndSlippage": True,
            },
        }

        with mock.patch.object(MODULE, "v27_entry_gate", return_value=accepted):
            result = MODULE.v28_entry_gate(
                candidate, l2, 0.50, {self.start + 3: trade(15.00)}, []
            )

        self.assertTrue(result["passed"])
        self.assertEqual(result["reason"], "v28-intraday-pullback-confirmed")

    def test_v28_intraday_calibration_passes_prior_dates_only(self):
        candidate = self.candidate("positiveT")
        candidate["date"] = "20250103"
        candidate["factorCombinationId"] = "v28-intraday-pullback-v1"
        candidate["factors"] = {"usesCompletedMinuteAndPriorMinutesOnly": True}
        l2 = {"status": "confirmed", "decisionSecond": self.start + 2, "evidence": []}
        history = [
            {"date": "20250102", "netPnl": 1},
            {"date": "20250103", "netPnl": 2},
            {"date": "20250104", "netPnl": 3},
        ]
        accepted = {"passed": True, "reason": "accepted"}

        with mock.patch.object(MODULE, "v27_entry_gate", return_value=accepted) as gate:
            result = MODULE.v28_entry_gate(
                candidate, l2, 0.50, {self.start + 3: trade(15.00)}, history
            )

        passed_history = gate.call_args.args[4]
        self.assertEqual([row["date"] for row in passed_history], ["20250102"])
        self.assertEqual(result["calibrationHistory"]["observations"], 1)
        self.assertTrue(result["calibrationHistory"]["priorDatesOnly"])

    def test_v28_intraday_same_day_observation_waits_for_session_completion(self):
        history = []
        day_observations = [{"date": "20250103", "netPnl": 1}]

        self.assertEqual(
            MODULE.calibration_history_before_date(history, "20250103"), []
        )
        history.extend(day_observations)

        self.assertEqual(
            MODULE.calibration_history_before_date(history, "20250103"), []
        )
        self.assertEqual(
            MODULE.calibration_history_before_date(history, "20250104"),
            day_observations,
        )

    def test_post_exit_audit_detects_target_recovery(self):
        trades = {
            self.start + 5: trade(14.95),
            self.start + 6: MODULE.SECOND.TradeBucket(15.00, 15.08, 15.09, 15.00, 500, 500, 1),
        }

        audit = MODULE.post_exit_audit(
            "positiveT", 15.00, 0.08, self.start + 4, self.start + 10, trades
        )

        self.assertTrue(audit["targetRecoveredAfterExit"])
        self.assertEqual(audit["targetRecoveredSecond"], self.start + 6)
        self.assertEqual(audit["secondsUntilTargetRecovery"], 2)

    def test_adaptive_stop_is_wider_than_tight_cost_budget_stop(self):
        tight, _ = MODULE.loss_budget_stop_gap("positiveT", 15.00, 0.08, 0.50)
        adaptive, context = MODULE.adaptive_emergency_stop_gap("positiveT", 15.00, 0.08, 0.50)

        self.assertGreater(adaptive, tight)
        self.assertGreater(context["estimatedLossToTargetProfit"], 1)

    def test_baseline_keeps_time_exit_without_stop(self):
        trades = {
            self.start: trade(15.00),
            self.start + 1: trade(15.00),
            self.start + 2: trade(14.80, buy=100, sell=900),
        }

        result = MODULE.simulate_round_trip(self.candidate(), self.start, trades)

        self.assertEqual(result["exitReason"], "time")
        self.assertEqual(result["exitModel"], "time-exit-baseline")

    def test_metrics_evaluate_positive_and_reverse_t_independently(self):
        rows = [
            {
                "candidate": self.candidate("positiveT"),
                "l2Decision": {"status": "confirmed"},
                "executed": True,
                "simulation": {"status": "closed", "targetReached": True, "netPnl": 10, "fees": 2},
            },
            {
                "candidate": self.candidate("reverseT"),
                "l2Decision": {"status": "rejected"},
                "executed": False,
                "simulation": None,
            },
        ]

        positive = MODULE.metric(rows, "positiveT")
        reverse = MODULE.metric(rows, "reverseT")

        self.assertEqual(positive["closedTrades"], 1)
        self.assertEqual(positive["winRate"], 1)
        self.assertEqual(reverse["closedTrades"], 0)
        self.assertEqual(reverse["rejected"], 1)

    def test_v28_performance_attribution_separates_source_and_confirmation_path(self):
        def closed_row(source, initial_status, final_status, pnl):
            candidate = self.candidate("positiveT")
            candidate["factorCombinationId"] = source
            return {
                "candidate": candidate,
                "initialL2Decision": {"status": initial_status},
                "l2Decision": {"status": final_status},
                "executed": final_status == "confirmed",
                "simulation": ({
                    "status": "closed",
                    "targetReached": pnl > 0,
                    "netPnl": pnl,
                    "fees": 2,
                } if final_status == "confirmed" else None),
            }

        rows = [
            closed_row("opening-gap-v1", "confirmed", "confirmed", 10),
            closed_row("v28-intraday-pullback-v1", "neutral", "confirmed", -5),
            closed_row("opening-gap-v1", "rejected", "rejected", 0),
        ]

        result = MODULE.v28_performance_attribution(rows)

        self.assertEqual(result["bySource"]["openingGap"]["candidates"], 2)
        self.assertEqual(result["bySource"]["openingGap"]["netPnl"], 10)
        self.assertEqual(result["bySource"]["intradayPullback"]["closedTrades"], 1)
        self.assertEqual(result["byConfirmationPath"]["initialConfirmed"]["netPnl"], 10)
        self.assertEqual(result["byConfirmationPath"]["delayedConfirmed"]["netPnl"], -5)
        self.assertEqual(result["byConfirmationPath"]["notConfirmed"]["closedTrades"], 0)

    def test_v28_expansion_audit_groups_filtered_counterfactuals(self):
        def filtered_row(source, initial_status, delayed, reason, pnl):
            candidate = self.candidate("positiveT")
            candidate["factorCombinationId"] = source
            simulation = {
                "status": "closed",
                "targetReached": pnl > 0,
                "netPnl": pnl,
                "fees": 2,
                "exitReason": "target" if pnl > 0 else "hardStop",
                "postExitAudit": None,
            }
            return {
                "candidate": candidate,
                "initialL2Decision": {"status": initial_status},
                "l2Decision": {
                    "status": "confirmed",
                    "delayedPromotion": delayed,
                },
                "executed": False,
                "simulation": None,
                "counterfactualSimulation": simulation,
                "entryGate": {"reason": reason},
            }

        rows = [
            filtered_row(
                "v28-intraday-pullback-v1", "confirmed", False,
                "intraday-calibration-learning-observation-only", 10,
            ),
            filtered_row(
                "opening-gap-v1", "neutral", True,
                "delayed-confirmation-observation-only", -5,
            ),
        ]

        result = MODULE.v28_expansion_audit(rows)

        self.assertTrue(result["researchOnly"])
        self.assertTrue(result["currentGateUnchanged"])
        self.assertEqual(result["byGroup"]["allFiltered"]["closedTrades"], 2)
        self.assertEqual(result["byGroup"]["intradayPullback"]["netPnl"], 10)
        self.assertEqual(result["byGroup"]["delayedConfirmed"]["netPnl"], -5)
        self.assertEqual(
            result["byEntryGateReason"]
            ["intraday-calibration-learning-observation-only"]["winRate"],
            1.0,
        )

    def test_v28_expansion_audit_never_changes_current_gate(self):
        result = MODULE.v28_expansion_audit([])

        self.assertTrue(result["researchOnly"])
        self.assertTrue(result["currentGateUnchanged"])
        self.assertEqual(result["byGroup"]["allFiltered"]["executed"], 0)

    def v29_l2(self, evidence, status="confirmed", decision_offset=2):
        return {
            "status": status,
            "decisionSecond": self.start + decision_offset,
            "delayedPromotion": False,
            "evidence": evidence,
        }

    def v29_evidence(self, offset=2, active_buy=0.20, depth=0.80,
                     microprice_edge=-0.10):
        return {
            "second": self.start + offset,
            "activeBuyRatio": active_buy,
            "depthImbalance": depth,
            "micropriceEdgeBps": microprice_edge,
            "priceResponseBps": 0.0,
        }

    def test_v29_low_gap_reverse_tail_rule_and_boundary_are_frozen(self):
        candidate = self.candidate("reverseT")
        candidate["factors"] = {"openingGapPct": 1.49}
        matched = MODULE.v29_reverse_tail_risk(
            candidate, self.v29_l2([self.v29_evidence(depth=-0.39)])
        )

        candidate["factors"] = {"openingGapPct": 1.50}
        gap_boundary = MODULE.v29_reverse_tail_risk(
            candidate, self.v29_l2([self.v29_evidence(depth=-0.39)])
        )
        candidate["factors"] = {"openingGapPct": 1.49}
        depth_boundary = MODULE.v29_reverse_tail_risk(
            candidate, self.v29_l2([self.v29_evidence(depth=-0.40)])
        )

        self.assertTrue(matched["veto"])
        self.assertEqual(matched["triggeredRules"], ["lowGapWeakSellBook"])
        self.assertFalse(gap_boundary["veto"])
        self.assertFalse(depth_boundary["veto"])

    def test_v29_mid_gap_reverse_tail_rule_and_boundaries_are_frozen(self):
        candidate = self.candidate("reverseT")
        candidate["factors"] = {"openingGapPct": 2.50}
        matched = MODULE.v29_reverse_tail_risk(
            candidate,
            self.v29_l2([self.v29_evidence(active_buy=0.25, depth=-0.80,
                                                   microprice_edge=0.0)]),
        )
        candidate["factors"] = {"openingGapPct": 3.0}
        gap_boundary = MODULE.v29_reverse_tail_risk(
            candidate,
            self.v29_l2([self.v29_evidence(active_buy=0.25, depth=-0.80,
                                                   microprice_edge=0.0)]),
        )
        candidate["factors"] = {"openingGapPct": 2.50}
        flow_boundary = MODULE.v29_reverse_tail_risk(
            candidate,
            self.v29_l2([self.v29_evidence(active_buy=0.251, depth=-0.80,
                                                   microprice_edge=0.0)]),
        )

        self.assertTrue(matched["veto"])
        self.assertEqual(matched["triggeredRules"], ["midGapBuyFlowRisk"])
        self.assertFalse(gap_boundary["veto"])
        self.assertFalse(flow_boundary["veto"])

    def test_v29_ignores_evidence_after_decision_second(self):
        candidate = self.candidate("reverseT")
        candidate["factors"] = {"openingGapPct": 1.0}
        l2 = self.v29_l2([
            self.v29_evidence(offset=2, depth=-0.80),
            self.v29_evidence(offset=3, depth=0.90),
        ])

        result = MODULE.v29_reverse_tail_risk(candidate, l2)

        self.assertFalse(result["veto"])
        self.assertEqual(result["entryTimeL2"]["evidenceSecond"], self.start + 2)

    def test_v29_missing_l2_fields_remain_unavailable_and_cannot_select(self):
        reverse = self.candidate("reverseT")
        reverse["factors"] = {"openingGapPct": 1.0}
        l2 = self.v29_l2([{"second": self.start + 2}])
        reverse_result = MODULE.v29_reverse_tail_risk(reverse, l2)
        positive_result = MODULE.v29_positive_expansion_gate(
            self.candidate("positiveT"), l2,
            {"passed": False, "reason": "positive-buy-flow-too-weak"},
        )

        self.assertFalse(reverse_result["veto"])
        self.assertIsNone(reverse_result["entryTimeL2"]["depthImbalance"])
        self.assertFalse(positive_result["passed"])
        self.assertFalse(reverse_result["missingValuesFilledWithZero"])

    def test_v29_positive_expansion_is_narrow_research_only_observation(self):
        candidate = self.candidate("positiveT")
        v28_gate = {"passed": False, "reason": "positive-buy-flow-too-weak"}
        selected = MODULE.v29_positive_expansion_gate(
            candidate,
            self.v29_l2([self.v29_evidence(depth=0.75)]),
            v28_gate,
        )
        below_depth = MODULE.v29_positive_expansion_gate(
            candidate,
            self.v29_l2([self.v29_evidence(depth=0.749)]),
            v28_gate,
        )
        wrong_reason = MODULE.v29_positive_expansion_gate(
            candidate,
            self.v29_l2([self.v29_evidence(depth=0.90)]),
            {"passed": False, "reason": "positive-regime-risk-veto"},
        )

        self.assertTrue(selected["passed"])
        self.assertTrue(selected["researchOnly"])
        self.assertFalse(selected["affectsV28"])
        self.assertEqual(selected["exitModel"], "v23")
        self.assertFalse(below_depth["passed"])
        self.assertFalse(wrong_reason["passed"])

    def test_v29_entry_gate_does_not_mutate_v28_control(self):
        candidate = self.candidate("reverseT")
        candidate["factors"] = {"openingGapPct": 1.0}
        v28_gate = {"passed": True, "reason": "v28-opening-candidate-confirmed"}
        original = dict(v28_gate)

        result = MODULE.v29_entry_gate(
            candidate, self.v29_l2([self.v29_evidence(depth=0.0)]), v28_gate
        )

        self.assertEqual(v28_gate, original)
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "v29-reverse-tail-risk-veto")
        self.assertTrue(result["v28ControlPassed"])
        self.assertFalse(result["affectsV28"])

    def test_v29_promotion_remains_shadow_when_all_thresholds_pass(self):
        passing = {
            "closedTrades": 100,
            "winRate": 0.60,
            "netPnl": 100,
            "profitFactor": 2,
        }
        summary = {"all": {"combined": passing}, "splits": {"test": {"combined": passing}}}

        result = MODULE.v29_promotion_evaluation(summary)

        self.assertTrue(result["statisticallyEligibleForHumanReview"])
        self.assertFalse(result["eligibleForHumanReview"])
        self.assertFalse(result["automaticPromotion"])
        self.assertEqual(result["decision"], "keep-shadow")

    def test_promotion_never_enables_automatic_upgrade(self):
        passing = {
            "candidates": 100,
            "confirmed": 100,
            "rejected": 0,
            "neutral": 0,
            "executed": 100,
            "candidateUpgradeRate": 1,
            "closedTrades": 100,
            "completionRate": 1,
            "targetHitRate": 1,
            "winRate": 0.6,
            "averageNetPnl": 1,
            "netPnl": 100,
            "fees": 10,
            "profitFactor": 2,
            "maximumDrawdown": 1,
        }
        summary = {"all": {"combined": passing}, "splits": {"test": {"combined": passing}}}

        result = MODULE.promotion_evaluation(summary)

        self.assertTrue(result["eligibleForHumanReview"])
        self.assertFalse(result["automaticPromotion"])

    def test_promotion_treats_profitable_no_loss_test_as_unbounded_profit_factor(self):
        passing = {
            "closedTrades": 100,
            "winRate": 1,
            "netPnl": 100,
            "profitFactor": None,
        }
        summary = {"all": {"combined": passing}, "splits": {"test": {"combined": passing}}}

        result = MODULE.promotion_evaluation(summary)

        self.assertTrue(result["checks"]["outOfSampleProfitFactor"])
        self.assertTrue(result["eligibleForHumanReview"])
        self.assertFalse(result["automaticPromotion"])

    def test_promotion_requires_minimum_out_of_sample_trade_count(self):
        full = {
            "closedTrades": 100,
            "winRate": 0.60,
            "netPnl": 100,
            "profitFactor": 2,
        }
        test = {
            "closedTrades": 19,
            "winRate": 0.60,
            "netPnl": 20,
            "profitFactor": 2,
        }
        summary = {"all": {"combined": full}, "splits": {"test": {"combined": test}}}

        result = MODULE.promotion_evaluation(summary)

        self.assertFalse(result["checks"]["outOfSampleClosedTrades"])
        self.assertFalse(result["eligibleForHumanReview"])


if __name__ == "__main__":
    unittest.main()
