import importlib.util
import sys
import unittest
from pathlib import Path


def load_core():
    path = Path(__file__).resolve().parents[1] / "scripts" / "discover-zijin-patterns.py"
    spec = importlib.util.spec_from_file_location("zijin_time_test_core", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class MinuteNumberTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.core = load_core()

    def test_colon_time_uses_real_minutes_after_midnight(self):
        self.assertEqual(self.core.minute_number("09:35"), 9 * 60 + 35)
        self.assertEqual(self.core.minute_number("13:00"), 13 * 60)

    def test_compact_vendor_times_remain_supported(self):
        self.assertEqual(self.core.minute_number("0935"), 9 * 60 + 35)
        self.assertEqual(self.core.minute_number("093500"), 9 * 60 + 35)


if __name__ == "__main__":
    unittest.main()
