import importlib.util
import sys
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
