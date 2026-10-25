"""Fail-closed, per-stream backup sets. No credentials, remote calls or retention.

CLI deliberately has no encryption adapter: it can only produce local candidates.
An audited adapter must encrypt AND verify before the library publishes complete.json.
"""
import argparse
import fnmatch
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import subprocess
import tarfile
from datetime import datetime, timezone
import uuid
import math
import unicodedata
from contextlib import closing

CHUNK = 1024 * 1024
MAX_LINE = 16 * CHUNK
PROTOCOLS = {"append_jsonl", "atomic_json", "stable_file"}
DATABASE_SOURCE = "control/rabbit-control.sqlite"


class BackupError(Exception):
    pass


def reject_constant(_):
    raise BackupError("NONFINITE_JSON_NUMBER")


def finite_float(value):
    result = float(value)
    if not math.isfinite(result):
        reject_constant(value)
    return result


def strict_json_loads(value):
    return json.loads(value, parse_constant=reject_constant, parse_float=finite_float)


def recovery_key(value):
    # Conservative across case-insensitive restore targets and Unicode spellings.
    return unicodedata.normalize("NFC", value).casefold()


def database_contract(policy):
    contract = policy.get("database")
    if not isinstance(contract, dict) or not isinstance(contract.get("contract_id"), str) or not contract["contract_id"].strip():
        raise BackupError("DATABASE_CONTRACT_REQUIRED")
    tables = contract.get("required_tables")
    if not isinstance(tables, dict) or not tables:
        raise BackupError("DATABASE_SCHEMA_REQUIRED")
    for table, columns in tables.items():
        if not isinstance(table, str) or not table or table.lower().startswith("sqlite_") or not isinstance(columns, dict) or not columns:
            raise BackupError("INVALID_DATABASE_SCHEMA")
        if any(not isinstance(k, str) or not k or not isinstance(v, str) or not v.strip() for k, v in columns.items()):
            raise BackupError("INVALID_DATABASE_SCHEMA")
    return contract


def verify_database(path, policy):
    contract = database_contract(policy)
    size = path.stat().st_size
    with open(path, "rb") as f:
        header = f.read(100)
    if size < 512 or len(header) != 100 or header[:16] != b"SQLite format 3\x00":
        raise BackupError("SQLITE_HEADER_OR_LENGTH")
    page_size = int.from_bytes(header[16:18], "big")
    page_size = 65536 if page_size == 1 else page_size
    if page_size < 512 or page_size > 65536 or page_size & (page_size - 1) or size % page_size:
        raise BackupError("SQLITE_HEADER_OR_LENGTH")
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupError("SQLITE_INTEGRITY")
        if db.execute("PRAGMA page_count").fetchone()[0] * page_size != size:
            raise BackupError("SQLITE_LENGTH_MISMATCH")
        for table, columns in contract["required_tables"].items():
            if db.execute("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?", (table,)).fetchone() is None:
                raise BackupError("SQLITE_REQUIRED_TABLE")
            actual = dict(db.execute("SELECT name, type FROM pragma_table_info(?)", (table,)))
            if any(name not in actual or actual[name].strip().upper() != kind.strip().upper()
                   for name, kind in columns.items()):
                raise BackupError("SQLITE_REQUIRED_COLUMN")
    return contract["contract_id"]


def now():
    return datetime.now(timezone.utc).isoformat()


def stream_digest(stream):
    # hashlib.file_digest was introduced in Python 3.11; VPS uses 3.10.12.
    result = hashlib.sha256()
    while data := stream.read(CHUNK):
        result.update(data)
    return result.hexdigest()


def digest(path):
    with open(path, "rb") as f:
        return stream_digest(f)


def checkpoint(event, path):
    """No-op; deterministic concurrent writer injection point for synthetic tests."""


def write_json(path, value):
    # Exclusive creation; no overwrite of prior evidence or completion records.
    with open(path, "x", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=True, indent=2, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())


def publish_json(directory, value):
    # A partially written JSON must never acquire the completion filename.
    temporary = directory / "complete.pending.json"
    write_json(temporary, value)
    checkpoint("before_complete", directory)
    os.rename(temporary, directory / "complete.json")


def sync_dir(path):
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def inventory(policy):
    if policy.get("version") != 1 or not policy.get("roots"):
        raise BackupError("POLICY_REQUIRED")
    database_contract(policy)
    entries, seen = [], set()
    targets = {recovery_key(DATABASE_SOURCE)}
    for root_spec in policy["roots"]:
        root = Path(root_spec["path"])
        if not root.is_absolute() or root.is_symlink() or not root.is_dir():
            raise BackupError("INVALID_ROOT")
        if root.resolve() != root.absolute():
            raise BackupError("LINKED_ROOT")
        alias = root_spec["alias"]
        if not alias or not alias.isascii() or not alias.replace("-", "").isalnum():
            raise BackupError("INVALID_ALIAS")
        if recovery_key(alias) in seen:
            raise BackupError("DUPLICATE_ALIAS")
        seen.add(recovery_key(alias))
        matched = set()
        def walk_error(_):
            raise BackupError("INVENTORY_UNREADABLE")
        for parent, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
            for name in dirs + files:
                p = Path(parent) / name
                if p.is_symlink():
                    raise BackupError("SYMLINK_NOT_ALLOWED")
            for name in files:
                p = Path(parent) / name
                if not stat.S_ISREG(p.stat().st_mode):
                    raise BackupError("SPECIAL_FILE")
                rel = p.relative_to(root).as_posix()
                rules = [r for r in root_spec.get("rules", [])
                         if fnmatch.fnmatchcase(rel, r["pattern"])]
                if len(rules) != 1:
                    raise BackupError("UNKNOWN_OR_AMBIGUOUS_PROTOCOL")
                rule = rules[0]
                matched.add(rule["pattern"])
                if rule["protocol"] == "exclude":
                    if not rule.get("reason"):
                        raise BackupError("EXCLUSION_REASON_REQUIRED")
                    continue
                if rule["protocol"] not in PROTOCOLS:
                    raise BackupError("UNKNOWN_PROTOCOL")
                source = alias + "/" + rel
                key = recovery_key(source)
                if key in targets:
                    raise BackupError("DUPLICATE_RECOVERY_TARGET")
                targets.add(key)
                entries.append({"path": p, "source": source,
                                "protocol": rule["protocol"], "size": p.stat().st_size})
                if len(entries) > 100000:
                    raise BackupError("INVENTORY_LIMIT")
        for rule in root_spec.get("rules", []):
            if rule["protocol"] != "exclude" and rule.get("required", True) and rule["pattern"] not in matched:
                raise BackupError("REQUIRED_SOURCE_MISSING")
    if not entries:
        raise BackupError("EMPTY_INVENTORY")
    return sorted(entries, key=lambda e: e["source"])


class Budget:
    def __init__(self, output, limit, reserve):
        self.output, self.limit, self.reserve, self.used = Path(output), limit, reserve, 0

    def check(self, amount=0):
        if self.used + amount > self.limit:
            raise BackupError("WRITE_BUDGET_EXCEEDED")
        if shutil.disk_usage(self.output).free - amount < self.reserve:
            raise BackupError("FREE_SPACE_RESERVE")

    def write(self, f, data):
        self.check(len(data))
        f.write(data)
        self.used += len(data)


def preflight(policy, output, db_bytes, limit, reserve):
    if limit <= 0 or reserve < 0 or db_bytes < 0:
        raise BackupError("INVALID_BUDGET")
    output = Path(output)
    if not output.is_dir() or output.is_symlink() or output.resolve() != output.absolute():
        raise BackupError("OUTPUT_DIRECTORY_REQUIRED")
    entries = inventory(policy)
    for r in policy["roots"]:
        root = Path(r["path"]).resolve()
        if output.resolve().is_relative_to(root) or root.is_relative_to(output.resolve()):
            raise BackupError("SOURCE_OUTPUT_OVERLAP")
    # Staging + archive + ciphertext + verification allowance. Conservative,
    # includes unique DB snapshot/copy overhead; not a guarantee against other writers.
    estimate = 4 * (sum(e["size"] for e in entries) + db_bytes) + 64 * CHUNK
    if estimate > limit or shutil.disk_usage(output).free < estimate + reserve:
        raise BackupError("PREFLIGHT_SPACE")
    if hasattr(os, "statvfs"):
        fs = os.statvfs(output)
        if fs.f_files and fs.f_favail < 3 * len(entries) + 32:
            raise BackupError("PREFLIGHT_INODES")
    return entries


def snapshot(entry, destination, budget):
    source, protocol = entry["path"], entry["protocol"]
    started = now()
    if source.is_symlink():
        raise BackupError("SYMLINK_NOT_ALLOWED")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(source, flags)
    with os.fdopen(fd, "rb") as src, open(destination, "xb") as dst:
        initial = os.fstat(src.fileno())
        if not stat.S_ISREG(initial.st_mode):
            raise BackupError("SPECIAL_FILE")
        checkpoint("opened", source)
        remaining, copied, lines = initial.st_size, 0, 0
        h = hashlib.sha256()
        while remaining:
            if protocol == "append_jsonl":
                data = src.readline(min(remaining, MAX_LINE + 1))
                if len(data) > MAX_LINE:
                    raise BackupError("JSONL_LINE_LIMIT")
            else:
                data = src.read(min(remaining, CHUNK))
            if not data:
                raise BackupError("SOURCE_TRUNCATED")
            remaining -= len(data)
            if protocol == "append_jsonl":
                if not data.endswith(b"\n"):
                    # Only the incomplete tail at the fixed initial boundary is omitted.
                    if remaining:
                        raise BackupError("JSONL_LINE_LIMIT")
                    break
                strict_json_loads(data)
                lines += 1
            budget.write(dst, data)
            copied += len(data)
            h.update(data)
        dst.flush()
        os.fsync(dst.fileno())
        checkpoint("copied", source)
        after = os.fstat(src.fileno())
        if protocol == "append_jsonl":
            current = source.stat()
            if (current.st_dev, current.st_ino) != (initial.st_dev, initial.st_ino):
                raise BackupError("APPEND_SOURCE_ROTATED")
            if after.st_size < initial.st_size:
                raise BackupError("SOURCE_TRUNCATED")
        elif (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns):
            # Atomic rename may change link metadata on POSIX; mtime/size and
            # re-read digest below are the content checks for atomic JSON.
            if protocol != "atomic_json" or (after.st_size, after.st_mtime_ns) != (
                    initial.st_size, initial.st_mtime_ns):
                raise BackupError("SOURCE_CHANGED")
        if protocol == "stable_file":
            current = source.stat()
            if (current.st_dev, current.st_ino) != (initial.st_dev, initial.st_ino):
                raise BackupError("STABLE_SOURCE_REPLACED")
        src.seek(0)
        verified, left = hashlib.sha256(), copied
        while left:
            data = src.read(min(left, CHUNK))
            if not data:
                raise BackupError("SOURCE_TRUNCATED")
            verified.update(data)
            left -= len(data)
        if verified.digest() != h.digest():
            raise BackupError("SOURCE_PREFIX_CHANGED")
    if protocol == "atomic_json":
        with open(destination, "rb") as f:
            strict_json_loads(f.read())
    return {"source": entry["source"], "protocol": protocol, "bytes": copied,
            "initial_bytes": initial.st_size, "sha256": h.hexdigest(),
            "complete_lines": lines if protocol == "append_jsonl" else None,
            "omitted_tail_bytes": initial.st_size - copied,
            "read_started_utc": started, "read_finished_utc": now()}


def create_archive(staging, target, names, budget):
    # Stream tar output through the budget; any nonzero exit (including 1) fails.
    proc = subprocess.Popen(["tar", "-czf", "-", "-C", str(staging), "--", *names],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        with open(target, "xb") as out:
            while data := proc.stdout.read(CHUNK):
                budget.write(out, data)
            out.flush()
            os.fsync(out.fileno())
        if proc.wait() != 0:
            raise BackupError("TAR_FAILED")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stdout.close()


def verify_archive(archive, expected):
    with gzip.open(archive, "rb") as stream:
        while stream.read(CHUNK):
            pass
    found = set()
    with tarfile.open(archive, "r:gz") as tf:
        for member in tf:
            if not member.isfile() or member.name not in expected or member.name in found:
                raise BackupError("ARCHIVE_MEMBERS")
            with tf.extractfile(member) as f:
                value = stream_digest(f)
            if value != expected[member.name]:
                raise BackupError("ARCHIVE_HASH")
            found.add(member.name)
    if found != set(expected):
        raise BackupError("ARCHIVE_MISSING_MEMBER")


def build(policy, output, database, *, limit, reserve, encryptor=None):
    """encryptor.encrypt(archive, sink), verify(ciphertext, plaintext_sha256), scheme.

    Trusted, separately audited adapter only. verify must decrypt/authenticate and
    compare the full plaintext digest. No adapter is shipped or configured here.
    """
    output, database = Path(output).absolute(), Path(database).absolute()
    run = output / ("candidate-" + uuid.uuid4().hex)
    run.mkdir(mode=0o700)
    stage = "preflight"
    try:
        entries = preflight(policy, output, database.stat().st_size, limit, reserve)
        budget = Budget(run, limit, reserve)
        stage = "snapshot"
        staging = run / "staging"
        staging.mkdir(mode=0o700)
        records = []
        for i, entry in enumerate(entries):
            name = f"file-{i:06d}"
            record = snapshot(entry, staging / name, budget)
            record["member"] = name
            records.append(record)
        db_entry = {"path": database, "source": DATABASE_SOURCE, "protocol": "stable_file"}
        db_record = snapshot(db_entry, staging / "database.sqlite", budget)
        db_record["member"] = "database.sqlite"
        db_record["schema_contract"] = verify_database(staging / "database.sqlite", policy)
        records.append(db_record)
        if len({recovery_key(r["source"]) for r in records}) != len(records):
            raise BackupError("DUPLICATE_RECOVERY_TARGET")
        # Inventory drift cannot silently omit newly created required files.
        final = inventory(policy)
        if [(e["source"], e["protocol"]) for e in entries] != [(e["source"], e["protocol"]) for e in final]:
            raise BackupError("INVENTORY_CHANGED")
        manifest = {"version": 1, "consistency": "per-stream-cutoffs-not-system-transaction",
                    "created_utc": now(), "files": records, "policy_sha256": hashlib.sha256(
                        json.dumps(policy, sort_keys=True, allow_nan=False).encode()).hexdigest()}
        write_json(staging / "snapshot.json", manifest)
        expected = {r["member"]: r["sha256"] for r in records}
        expected["snapshot.json"] = digest(staging / "snapshot.json")
        stage = "archive"
        archive = run / "archive.tar.gz"
        create_archive(staging, archive, list(expected), budget)
        verify_archive(archive, expected)
        archive_hash = digest(archive)
        write_json(run / "local-verified.json", {"sha256": archive_hash, "pull_ready": False})
        if encryptor is None:
            return run
        stage = "encryption"
        cipher = run / "archive.enc"
        with open(cipher, "xb") as f:
            encryptor.encrypt(archive, lambda data: budget.write(f, data))
            f.flush()
            os.fsync(f.fileno())
        if not cipher.stat().st_size or encryptor.verify(cipher, archive_hash) is not True:
            raise BackupError("ENCRYPTION_VERIFICATION")
        # Publish only a separate ciphertext directory: never expose staging/plaintext.
        stage = "publication"
        published = output / ("published-" + uuid.uuid4().hex)
        published.mkdir(mode=0o700)
        os.rename(cipher, published / "archive.enc")
        sync_dir(published)
        publish_json(published, {"version": 1, "pull_ready": True,
                   "file": "archive.enc", "bytes": (published / "archive.enc").stat().st_size,
                   "sha256": digest(published / "archive.enc"), "scheme": encryptor.scheme,
                   "consistency": manifest["consistency"], "created_utc": now()})
        sync_dir(published)
        sync_dir(output)
        return published
    except Exception as exc:
        # Never serialize exception text, source content, credentials or unknown paths.
        code = str(exc) if isinstance(exc, BackupError) else type(exc).__name__
        write_json(run / "failed.json", {"stage": stage, "code": code, "time": now(), "pull_ready": False})
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--database")
    parser.add_argument("--database-bytes", type=int, default=0)
    parser.add_argument("--limit", type=int, required=True)
    parser.add_argument("--reserve", type=int, default=4 * 1024**3)
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    try:
        with open(args.policy, encoding="utf-8") as f:
            policy = strict_json_loads(f.read())
        if args.limit <= 0 or args.reserve < 0:
            raise BackupError("INVALID_BUDGET")
        if args.preflight:
            preflight(policy, Path(args.output).absolute(), args.database_bytes, args.limit, args.reserve)
            print("PREFLIGHT_OK")
        else:
            if not args.database:
                raise BackupError("DATABASE_REQUIRED")
            build(policy, args.output, args.database, limit=args.limit, reserve=args.reserve)
            print("LOCAL_VERIFIED_NOT_PULL_READY")
    except Exception as exc:
        print(str(exc) if isinstance(exc, BackupError) else type(exc).__name__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
