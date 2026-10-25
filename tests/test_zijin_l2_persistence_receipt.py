import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from zijin_l2_persistence_receipt import append_with_receipt, validate_receipt, read_valid_receipts


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
            self.assertEqual(second["byteOffset"], 0)
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(path.with_name(path.name + ".receipts.jsonl").read_text().count("\n"), 1)

    def test_torn_tail_preserved_and_recovered(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            path.write_bytes(b'{"unfinished":')
            receipt = append_with_receipt(path, {"exchangeMinute": "one"})
            self.assertEqual(validate_receipt(path, receipt)["exchangeMinute"], "one")
            backups = list(path.parent.glob("*.torn-*"))
            self.assertEqual(backups[0].read_bytes(), b'{"unfinished":')

    def test_broken_receipt_does_not_suppress_next_raw_minute(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'forward.jsonl'
            append_with_receipt(path, {'exchangeMinute': 'one'})
            sidecar = path.with_name(path.name + '.receipts.jsonl')
            with sidecar.open('ab') as handle:
                handle.write(b'broken\n')
            with self.assertRaises(ValueError):
                append_with_receipt(path, {'exchangeMinute': 'two'})
            self.assertEqual([json.loads(line)['exchangeMinute'] for line in path.read_text().splitlines()], ['one','two'])

    def test_torn_receipt_retry_and_clock_regression_across_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'forward.jsonl'
            row = {'exchangeMinute': 'one'}
            first = append_with_receipt(path, row, clock=lambda: '2026-10-23T02:00:00Z')
            sidecar = path.with_name(path.name+'.receipts.jsonl')
            with sidecar.open('ab') as handle:handle.write(b'{"partial":')
            retry = append_with_receipt(path, row)
            self.assertEqual(retry, first)
            self.assertEqual(len(path.read_text().splitlines()), 1)
            self.assertEqual(len(read_valid_receipts(path)), 1)
            second = append_with_receipt(path, {'exchangeMinute':'two'}, clock=lambda:'2026-10-23T01:00:00Z')
            self.assertFalse(second['clockOrdered'])
            self.assertFalse(second['verified'])

    def test_clock_regression_and_consumer_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            times = iter(["2026-10-23T02:00:00Z", "2026-10-23T01:00:00Z"])
            receipt = append_with_receipt(path, {"exchangeMinute": "one"}, clock=lambda: next(times))
            self.assertFalse(receipt["clockOrdered"])
            self.assertFalse(receipt["verified"])
            for field, value in [("schemaVersion", 99), ("byteOffset", 1), ("byteLength", 9999), ("recordSha256", "bad")]:
                with self.assertRaises(ValueError):
                    validate_receipt(path, {**receipt, field: value})
            with self.assertRaises(ValueError):
                append_with_receipt(path, {"exchangeMinute": "one", "different": True})

    def test_failed_data_sync_cannot_publish_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            def fail(_):
                raise OSError("data sync failed")
            with self.assertRaises(OSError):
                append_with_receipt(path, {}, sync=fail)
            self.assertFalse(path.with_name(path.name + ".receipts.jsonl").exists())

    def test_actual_label_consumer_validates_receipt_without_promoting_finality(self):
        from unittest.mock import patch
        from zijin_l2_forward_labels import refresh_labels_and_state
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "forward.jsonl"
            row = {"exchangeMinute": "20261023-0930", "persistenceContract": "local-append-receipt-v1",
                   "quality": {"verified": True, "minuteFinality": "verified"}}
            append_with_receipt(path, row)
            original = path.read_bytes()
            seen = []
            def capture(records, *args, **kwargs):
                seen.extend(records)
                return []
            with patch('zijin_l2_forward_labels.build_labels', side_effect=capture):
                refresh_labels_and_state(str(path), str(Path(directory)/'labels'), str(Path(directory)/'state'))
            self.assertFalse(seen[0]['quality']['verified'])
            self.assertIsNotNone(seen[0]['localPersistenceReceipt'])
            self.assertEqual(path.read_bytes(), original)
            sidecar = path.with_name(path.name + '.receipts.jsonl')
            receipt = json.loads(sidecar.read_text())
            receipt['recordSha256'] = 'invalid'
            sidecar.write_text(json.dumps(receipt)+'\n')
            with self.assertRaises(ValueError):
                refresh_labels_and_state(str(path), str(Path(directory)/'labels'), str(Path(directory)/'state'))

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
            before = path.read_bytes()
            append_with_receipt(path, {})
            self.assertEqual(before, path.read_bytes())
            self.assertEqual(len(read_valid_receipts(path)), 1)


if __name__ == "__main__":
    unittest.main()
