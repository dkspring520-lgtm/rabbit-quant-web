"""Synthetic data only. Mock crypto tests are NOT cryptographic validation."""
import hashlib
import importlib.util
import json
from pathlib import Path
import os
import sqlite3
import tarfile
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("backup_snapshot", Path(__file__).parents[1] / "scripts/backup_snapshot.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class SyntheticAdapter:
    scheme = "SYNTHETIC_TEST_ONLY_NOT_ENCRYPTION"

    def encrypt(self, archive, sink):
        # Explicit test double, never available through production CLI.
        sink(b"TEST-ONLY\n" + archive.read_bytes())

    def verify(self, cipher, expected):
        return hashlib.sha256(cipher.read_bytes()[10:]).hexdigest() == expected


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.src = self.base / "source"
        self.out = self.base / "output"
        self.src.mkdir()
        self.out.mkdir()
        self.raw = self.src / "raw.jsonl"
        self.raw.write_bytes(b'{"n":1}\n{"n":2}\n')
        self.state = self.src / "state.json"
        self.state.write_text('{"generation":1}')
        self.db = self.base / "snapshot.sqlite"
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("create table sample (value text)")
            db.execute("insert into sample values ('synthetic')")
            db.commit()
        self.policy = {"version": 1, "roots": [{"path": str(self.src), "alias": "state", "rules": [
            {"pattern": "raw.jsonl", "protocol": "append_jsonl"},
            {"pattern": "state.json", "protocol": "atomic_json"}]}]}
        self.policy["database"] = {"contract_id": "synthetic-sample-v1", "required_tables": {"sample": {"value": "TEXT"}}}

    def build(self, **kw):
        return b.build(self.policy, self.out, self.db, limit=256 * b.CHUNK, reserve=0, **kw)

    def manifest(self, run):
        return json.loads((run / "staging/snapshot.json").read_text())

    def failed_without_publication(self):
        self.assertTrue(list(self.out.glob("candidate-*/failed.json")))
        self.assertFalse(list(self.out.glob("published-*/complete.json")))

    def test_archive_manifest_and_isolated_sqlite_restore(self):
        run = self.build()
        m = self.manifest(run)
        self.assertEqual(m["consistency"], "per-stream-cutoffs-not-system-transaction")
        with tarfile.open(run / "archive.tar.gz", "r:gz") as tf:
            for record in m["files"]:
                data = tf.extractfile(record["member"]).read()
                self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"])
                self.assertEqual(len(data), record["bytes"])
            restored = self.base / "restored.sqlite"
            restored.write_bytes(tf.extractfile("database.sqlite").read())
        with closing(sqlite3.connect(restored)) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertEqual(db.execute("select value from sample").fetchone(), ("synthetic",))
        self.assertFalse(list(self.out.glob("published-*")))
        self.assertFalse(json.loads((run / "local-verified.json").read_text())["pull_ready"])

    def test_archive_without_python311_file_digest(self):
        # Execute the real archive verification with the 3.11 API unavailable.
        with patch.object(hashlib, "file_digest", None, create=True):
            run = self.build()
            self.assertTrue((run / "local-verified.json").is_file())

    def test_stream_digest_multiple_chunks(self):
        import io
        data = b"synthetic" * (b.CHUNK // 3)
        self.assertGreater(len(data), b.CHUNK)
        self.assertEqual(b.stream_digest(io.BytesIO(data)), hashlib.sha256(data).hexdigest())

    def test_concurrent_append_has_fixed_cutoff(self):
        initial = self.raw.read_bytes()
        def mutate(event, path):
            if event == "opened" and path == self.raw:
                with path.open("ab") as f:
                    f.write(b'{"n":3}\n')
        with patch.object(b, "checkpoint", mutate):
            run = self.build()
        record = self.manifest(run)["files"][0]
        self.assertEqual((run / "staging" / record["member"]).read_bytes(), initial)
        self.assertEqual(record["complete_lines"], 2)

    def test_partial_tail_omitted_and_reported(self):
        with self.raw.open("ab") as f:
            f.write(b'{"n":')
        record = self.manifest(self.build())["files"][0]
        self.assertEqual(record["complete_lines"], 2)
        self.assertEqual(record["omitted_tail_bytes"], 5)

    def test_corrupt_complete_jsonl_fails(self):
        self.raw.write_bytes(b'{bad}\n')
        with self.assertRaises(ValueError):
            self.build()
        self.failed_without_publication()

    def test_truncation_during_copy_fails(self):
        def mutate(event, path):
            if event == "opened" and path == self.raw:
                path.write_bytes(b'')
        with patch.object(b, "checkpoint", mutate), self.assertRaises(b.BackupError):
            self.build()
        self.failed_without_publication()

    def test_prefix_mutation_fails(self):
        def mutate(event, path):
            if event == "copied" and path == self.raw:
                path.write_bytes(b'{"n":9}\n{"n":2}\n')
        with patch.object(b, "checkpoint", mutate), self.assertRaises(b.BackupError):
            self.build()
        self.failed_without_publication()

    @unittest.skipIf(os.name == "nt", "POSIX rename over open descriptor requires Linux acceptance")
    def test_atomic_replacement_reads_one_complete_version(self):
        def mutate(event, path):
            if event == "opened" and path == self.state:
                temp = self.src / "state.tmp"
                temp.write_text('{"generation":2}')
                os.replace(temp, path)
        with patch.object(b, "checkpoint", mutate):
            run = self.build()
        rec = self.manifest(run)["files"][1]
        self.assertEqual(json.loads((run / "staging" / rec["member"]).read_text()), {"generation": 1})

    def test_unknown_protocol_fails(self):
        (self.src / "unknown.bin").write_bytes(b'x')
        with self.assertRaisesRegex(b.BackupError, "UNKNOWN_OR_AMBIGUOUS"):
            self.build()
        self.failed_without_publication()

    def test_required_source_missing_fails(self):
        self.policy["roots"][0]["rules"].append({"pattern": "missing.json", "protocol": "atomic_json"})
        with self.assertRaisesRegex(b.BackupError, "REQUIRED_SOURCE_MISSING"):
            self.build()
        self.failed_without_publication()

    def test_invalid_atomic_json_fails(self):
        self.state.write_text('{bad}')
        with self.assertRaises(ValueError):
            self.build()
        self.failed_without_publication()

    def test_stable_file_mutation_fails(self):
        self.policy["roots"][0]["rules"][1]["protocol"] = "stable_file"
        def mutate(event, path):
            if event == "copied" and path == self.state:
                path.write_text('{"generation":12345}')
        with patch.object(b, "checkpoint", mutate), self.assertRaises(b.BackupError):
            self.build()
        self.failed_without_publication()

    def test_atomic_replacement_before_open_reads_new_version(self):
        temp = self.src / "next.tmp"
        temp.write_text('{"generation":2}')
        os.replace(temp, self.state)
        run = self.build()
        rec = self.manifest(run)["files"][1]
        self.assertEqual(json.loads((run / "staging" / rec["member"]).read_text()), {"generation": 2})

    def test_success_preserves_old_backups(self):
        old = self.out / "old-backup.gpg"
        old.write_bytes(b'keep')
        self.build()
        self.assertEqual(old.read_bytes(), b'keep')

    def test_inventory_new_file_fails(self):
        def mutate(event, path):
            if event == "copied" and path == self.raw:
                (self.src / "new.json").write_text('{}')
        with patch.object(b, "checkpoint", mutate), self.assertRaises(b.BackupError):
            self.build()
        self.failed_without_publication()

    def test_disk_budget_preflight_fails_preserving_old(self):
        old = self.out / "old-backup.gpg"
        old.write_bytes(b'keep')
        with self.assertRaisesRegex(b.BackupError, "PREFLIGHT_SPACE"):
            b.build(self.policy, self.out, self.db, limit=1, reserve=0)
        self.failed_without_publication()
        self.assertEqual(old.read_bytes(), b'keep')

    def test_runtime_space_loss_fails(self):
        original = b.Budget.check
        def check(budget, amount=0):
            if budget.used:
                raise b.BackupError("FREE_SPACE_RESERVE")
            return original(budget, amount)
        with patch.object(b.Budget, "check", check), self.assertRaises(b.BackupError):
            self.build()
        self.failed_without_publication()

    def test_tar_exit_one_not_ignored(self):
        original = b.subprocess.Popen
        def failing(*args, **kwargs):
            proc = original(*args, **kwargs)
            wait = proc.wait
            def failed_wait(*a, **k):
                wait(*a, **k)
                return 1
            proc.wait = failed_wait
            return proc
        with patch.object(b.subprocess, "Popen", failing), self.assertRaisesRegex(b.BackupError, "TAR_FAILED"):
            self.build()
        self.failed_without_publication()

    def test_corrupted_archive_rejected(self):
        run = self.build()
        archive = run / "archive.tar.gz"
        data = archive.read_bytes()
        archive.write_bytes(data[:-12])
        with self.assertRaises((EOFError, OSError, b.BackupError)):
            b.verify_archive(archive, {})

    def test_unverified_encryption_never_publishes(self):
        adapter = SyntheticAdapter()
        adapter.verify = lambda *_: False
        with self.assertRaisesRegex(b.BackupError, "ENCRYPTION_VERIFICATION"):
            self.build(encryptor=adapter)
        self.failed_without_publication()

    def test_mock_adapter_publication_manifest_hash_and_isolation(self):
        published = self.build(encryptor=SyntheticAdapter())
        m = json.loads((published / "complete.json").read_text())
        self.assertTrue(m["pull_ready"])
        self.assertEqual(m["sha256"], b.digest(published / m["file"]))
        self.assertEqual(m["bytes"], (published / m["file"]).stat().st_size)
        self.assertEqual({p.name for p in published.iterdir()}, {"archive.enc", "complete.json"})

    def test_interrupted_completion_marker_not_visible(self):
        def interrupt(event, _):
            if event == "before_complete":
                raise b.BackupError("SYNTHETIC_INTERRUPT")
        with patch.object(b, "checkpoint", interrupt), self.assertRaises(b.BackupError):
            self.build(encryptor=SyntheticAdapter())
        self.failed_without_publication()
        self.assertTrue(list(self.out.glob("published-*/complete.pending.json")))

    def test_sqlite_corruption_fails(self):
        self.db.write_bytes(b'not a database')
        with self.assertRaises(b.BackupError):
            self.build()
        self.failed_without_publication()

    def test_zero_byte_sqlite_fails_without_local_verified(self):
        self.db.write_bytes(b'')
        with self.assertRaisesRegex(b.BackupError, "SQLITE_HEADER_OR_LENGTH"):
            self.build()
        self.failed_without_publication()
        self.assertFalse(list(self.out.glob("candidate-*/local-verified.json")))

    def test_sqlite_truncated_page_rejected(self):
        self.db.write_bytes(self.db.read_bytes()[:-1])
        with self.assertRaisesRegex(b.BackupError, "SQLITE_HEADER_OR_LENGTH"):
            self.build()
        self.failed_without_publication()

    def test_sqlite_valid_but_wrong_business_schema_rejected(self):
        self.policy["database"]["required_tables"] = {"users": {"id": "TEXT"}}
        with self.assertRaisesRegex(b.BackupError, "SQLITE_REQUIRED_TABLE"):
            self.build()
        self.failed_without_publication()

    def test_sqlite_wrong_column_contract_rejected(self):
        for columns in ({"missing": "TEXT"}, {"value": "INTEGER"}):
            with self.subTest(columns=columns):
                self.policy["database"]["required_tables"] = {"sample": columns}
                with self.assertRaisesRegex(b.BackupError, "SQLITE_REQUIRED_COLUMN"):
                    self.build()
        self.failed_without_publication()

    def test_sqlite_contract_must_be_explicit(self):
        del self.policy["database"]
        with self.assertRaisesRegex(b.BackupError, "DATABASE_CONTRACT_REQUIRED"):
            self.build()
        self.failed_without_publication()

    def test_reserved_database_recovery_target_rejected(self):
        root = self.base / "control"
        root.mkdir()
        (root / "rabbit-control.sqlite").write_bytes(b'synthetic')
        self.policy["roots"].append({"path": str(root), "alias": "control", "rules": [
            {"pattern": "rabbit-control.sqlite", "protocol": "stable_file"}]})
        with self.assertRaisesRegex(b.BackupError, "DUPLICATE_RECOVERY_TARGET"):
            self.build()
        self.failed_without_publication()

    def test_duplicate_restore_alias_casefold_rejected(self):
        other = self.base / "other"
        other.mkdir()
        (other / "state.json").write_text('{}')
        self.policy["roots"].append({"path": str(other), "alias": "STATE", "rules": [
            {"pattern": "state.json", "protocol": "atomic_json"}]})
        with self.assertRaisesRegex(b.BackupError, "DUPLICATE_ALIAS"):
            self.build()
        self.failed_without_publication()

    def test_nonfinite_jsonl_rejected(self):
        for token in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(token=token):
                self.raw.write_text('{"value":' + token + '}\n')
                with self.assertRaisesRegex(b.BackupError, "NONFINITE_JSON_NUMBER"):
                    self.build()
        self.failed_without_publication()

    def test_nonfinite_atomic_json_rejected(self):
        for token in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(token=token):
                self.state.write_text('{"value":' + token + '}')
                with self.assertRaisesRegex(b.BackupError, "NONFINITE_JSON_NUMBER"):
                    self.build()
        self.failed_without_publication()

    def test_failure_record_does_not_leak_exception(self):
        with patch.object(b, "snapshot", side_effect=ValueError("SYNTHETIC_SECRET")), self.assertRaises(ValueError):
            self.build()
        text = next(self.out.glob("candidate-*/failed.json")).read_text()
        self.assertNotIn("SYNTHETIC_SECRET", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
