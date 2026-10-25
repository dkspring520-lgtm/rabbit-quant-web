import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from zijin_l2_persistence_receipt import append_with_receipt


class ReceiptTests(unittest.TestCase):
    def test_real_bytes_and_distinct_clocks_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            row = {"exchangeMinute": "20261023-0930", "observedAt": "observed",
                   "fieldSources": {"book": {"exchangeTime": "event", "receivedAt": "received"}}}
            times = iter(["generated", "completed"])
            receipt = append_with_receipt(path, row, clock=lambda: next(times))
            raw = path.read_bytes()
            self.assertEqual(receipt["recordSha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(json.loads(raw), row)
            self.assertEqual(receipt["eventTimes"]["book"], "event")
            self.assertEqual(receipt["receivedTimes"]["book"], "received")
            self.assertEqual(receipt["dataWriteCompletedAt"], "completed")
            self.assertIsNone(receipt["featureCutoffAt"])
            self.assertFalse(receipt["verified"])
            second = append_with_receipt(path, row)
            self.assertEqual(second["byteOffset"], len(raw))
            self.assertEqual(path.with_name(path.name + ".receipts.jsonl").read_text().count("\n"), 2)

    def test_failed_data_sync_cannot_publish_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            def fail(_):
                raise OSError("data sync failed")
            with self.assertRaises(OSError):
                append_with_receipt(path, {}, sync=fail)
            self.assertFalse(path.with_name(path.name + ".receipts.jsonl").exists())

    def test_failed_receipt_sync_is_not_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            calls = []
            def fail_second(fd):
                calls.append(fd)
                if len(calls) == 2:
                    raise OSError("receipt sync failed")
            with self.assertRaises(OSError):
                append_with_receipt(path, {}, sync=fail_second)
            self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
