import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from zijin_l2_second_state import (  # noqa: E402
    SecondLevelSignalMachine,
    flow_window,
)


def windows(rows, now):
    return {f"{seconds}s": flow_window(rows, now, seconds) for seconds in (1, 3, 10, 30, 60)}


BOOK = {
    "available": True,
    "obi": .28,
    "microprice": 31.03,
    "micropriceEdgeBps": .42,
    "spreadBps": 3.2,
}
BOOK3 = {
    "seconds": 3,
    "samples": 8,
    "obiMean": .22,
    "obiPositiveRatio": 1.0,
    "micropriceEdgeMeanBps": .31,
}


class SecondLevelStateMachineTest(unittest.TestCase):
    def test_buy_state_advances_watch_ready_trigger_without_future_rows(self):
        now = 100.0
        rows = [
            (92.0, "S", 20_000, 650_000, 31.00),
            (94.0, "S", 18_000, 600_000, 31.00),
            (99.4, "B", 14_000, 480_000, 31.01),
            (99.8, "B", 16_000, 560_000, 31.02),
            # This packet has not arrived at `now` and must be ignored.
            (105.0, "S", 99_000, 9_000_000, 30.50),
        ]
        machine = SecondLevelSignalMachine()
        common = dict(
            market_open=True,
            stale=False,
            vwap=31.25,
            high=31.50,
            low=30.98,
            atr_pct=.45,
            book=BOOK,
            book3=BOOK3,
        )
        watch = machine.evaluate(now=now, price=31.02, windows=windows(rows, now), exchange_minute_key="1016", **common)
        self.assertEqual(watch["state"], "watch")
        self.assertEqual(watch["direction"], "buy")
        self.assertLess(watch["windows"]["10s"]["sellNotional"], 2_000_000)

        ready = machine.evaluate(now=100.3, price=31.02, windows=windows(rows, 100.3), exchange_minute_key="1016", **common)
        self.assertEqual(ready["state"], "ready")
        self.assertFalse(ready["formalSignal"])

        unclosed = machine.evaluate(now=101.1, price=31.04, windows=windows(rows, 101.1), exchange_minute_key="1016", **common)
        self.assertEqual(unclosed["state"], "ready")
        self.assertFalse(unclosed["formalSignal"])

        triggered = machine.evaluate(now=101.2, price=31.04, windows=windows(rows, 101.2), exchange_minute_key="1017", **common)
        self.assertEqual(triggered["state"], "trigger")
        self.assertTrue(triggered["formalSignal"])
        self.assertFalse(triggered["autoOrderAuthorized"])
        self.assertIn("账户可卖量", triggered["plan"]["suggestedSize"])
        self.assertGreater(triggered["timeline"]["confirmationDelaySeconds"], 0)

    def test_closing_auction_cannot_create_intraday_trigger(self):
        rows = [(200.0, "B", 100_000, 5_000_000, 33.00)]
        result = SecondLevelSignalMachine().evaluate(
            now=200.0,
            market_open=False,
            stale=False,
            price=33.00,
            vwap=32.50,
            high=33.00,
            low=32.00,
            atr_pct=.5,
            windows=windows(rows, 200.0),
            book=BOOK,
            book3=BOOK3,
        )
        self.assertEqual(result["state"], "normal")
        self.assertFalse(result["formalSignal"])

    def test_closing_auction_expires_armed_candidate_instead_of_erasing_it(self):
        machine = SecondLevelSignalMachine(
            state="ready",
            direction="sell",
            state_started_at=10,
            watch_at=5,
            ready_at=10,
            expires_at=305,
            ready_exchange_minute="1456",
        )
        result = machine.evaluate(
            now=30,
            market_open=False,
            stale=False,
            price=33.00,
            vwap=32.50,
            high=33.00,
            low=32.00,
            atr_pct=.5,
            windows=windows([], 30),
            book=BOOK,
            book3=BOOK3,
            exchange_minute_key="1457",
        )
        self.assertEqual(result["state"], "expired")
        self.assertEqual(result["direction"], "sell")
        self.assertFalse(result["formalSignal"])
        self.assertIn("连续竞价结束", result["timeline"]["lastReason"])

    def test_stale_l2_resets_to_normal(self):
        machine = SecondLevelSignalMachine(state="ready", direction="buy", state_started_at=10)
        result = machine.evaluate(
            now=30,
            market_open=True,
            stale=True,
            price=31.00,
            vwap=31.30,
            high=31.50,
            low=30.90,
            atr_pct=.5,
            windows=windows([], 30),
            book=BOOK,
            book3=BOOK3,
        )
        self.assertEqual(result["state"], "invalid")
        self.assertEqual(result["direction"], "buy")
        self.assertEqual(result["timeline"]["lastReason"], "L2数据延迟或断流")

    def test_failed_candidate_is_retained_before_archival(self):
        machine = SecondLevelSignalMachine(
            state="ready",
            direction="buy",
            state_started_at=10,
            watch_at=5,
            ready_at=10,
            expires_at=305,
            ready_exchange_minute="1016",
        )
        result = machine.evaluate(
            now=30,
            market_open=True,
            stale=False,
            price=31.30,
            vwap=31.30,
            high=31.50,
            low=30.90,
            atr_pct=.5,
            windows=windows([], 30),
            book=BOOK,
            book3=BOOK3,
            exchange_minute_key="1017",
        )
        self.assertEqual(result["state"], "invalid")
        self.assertFalse(result["formalSignal"])
        self.assertTrue(result["timeline"]["lastReason"])


if __name__ == "__main__":
    unittest.main()
