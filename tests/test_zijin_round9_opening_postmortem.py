import importlib.util
import sys
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "scripts" / "analyze_zijin_round9_opening.py"
SPEC = importlib.util.spec_from_file_location("zijin_round9_opening_postmortem_tested", PATH)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class OpeningPostmortemTest(unittest.TestCase):
    def test_partition_summary_keeps_costed_results_and_path_metrics(self):
        rows = pd.DataFrame([
            {"won": True, "netPct": 0.72, "targetTouched": True, "holdMinutes": 8, "mfePct": 0.91, "maePct": -0.12, "exitReason": "trailing"},
            {"won": False, "netPct": -0.52, "targetTouched": False, "holdMinutes": 15, "mfePct": 0.20, "maePct": -0.61, "exitReason": "stop"},
        ])
        summary = MODULE.summarize_partition(rows)
        self.assertEqual(summary["trades"], 2)
        self.assertEqual(summary["winRate"], 0.5)
        self.assertEqual(summary["averageNetPct"], 0.1)
        self.assertEqual(summary["medianMfePct"], 0.555)
        self.assertEqual(summary["exitReasons"], {"stop": 1, "trailing": 1})

    def test_signal_buckets_are_fixed_before_analysis(self):
        self.assertEqual(MODULE.signal_bucket(9 * 60 + 33), "09:33-09:44")
        self.assertEqual(MODULE.signal_bucket(9 * 60 + 50), "09:45-09:59")
        self.assertEqual(MODULE.signal_bucket(10 * 60 + 30), "10:00-10:30")


if __name__ == "__main__":
    unittest.main()
