"""Single-writer append receipts. Local durability is not exchange finality."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def complete_lines(path, sync=os.fsync):
    """Preserve a torn tail before repairing the active append file, never archives."""
    path = Path(path)
    raw = path.read_bytes() if path.exists() else b""
    if raw and not raw.endswith(b"\n"):
        boundary = raw.rfind(b"\n") + 1
        tail = raw[boundary:]
        backup = path.with_name(path.name + ".torn-" + hashlib.sha256(tail).hexdigest())
        with backup.open("wb") as handle:
            handle.write(tail)
            handle.flush()
            sync(handle.fileno())
        with path.open("r+b") as handle:
            handle.truncate(boundary)
            handle.flush()
            sync(handle.fileno())
        raw = raw[:boundary]
    rows, offset = [], 0
    for line in raw.splitlines(keepends=True):
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError("Non-object append record")
        rows.append((offset, line, value))
        offset += len(line)
    return rows


def validate_receipt(path, receipt):
    """Validate local bytes only; return no market-finality assertion."""
    if not isinstance(receipt, dict) or receipt.get("schemaVersion") != 1 or receipt.get("contract") != "local-append-receipt-v1":
        raise ValueError("Unsupported receipt schema")
    start, size = receipt.get("byteOffset"), receipt.get("byteLength")
    if type(start) is not int or type(size) is not int or start < 0 or size <= 0:
        raise ValueError("Invalid receipt byte range")
    with Path(path).open("rb") as handle:
        if start:
            handle.seek(start - 1)
            if handle.read(1) != b"\n":
                raise ValueError("Receipt offset is not a row boundary")
        handle.seek(start)
        raw = handle.read(size)
    if len(raw) != size or not raw.endswith(b"\n") or raw.count(b"\n") != 1:
        raise ValueError("Incomplete receipt range")
    if hashlib.sha256(raw).hexdigest() != receipt.get("recordSha256"):
        raise ValueError("Receipt hash mismatch")
    row = json.loads(raw)
    if not isinstance(row, dict) or row.get("exchangeMinute") != receipt.get("exchangeMinute"):
        raise ValueError("Receipt minute mismatch")
    return row


def clock_ordered(*values):
    try:
        dates = [datetime.fromisoformat(value.replace("Z", "+00:00")) for value in values if value is not None]
        return bool(dates) and all(d.tzinfo is not None for d in dates) and all(a <= b for a, b in zip(dates, dates[1:]))
    except (ValueError, TypeError, AttributeError):
        return False


def read_valid_receipts(path):
    target = Path(path)
    sidecar = target.with_name(target.name + ".receipts.jsonl")
    if not sidecar.exists():
        return {}
    result = {}
    with sidecar.open("rb") as handle:
        for line in handle:
            if not line.endswith(b"\n"):
                raise ValueError("Incomplete receipt tail")
            receipt = json.loads(line)
            validate_receipt(target, receipt)
            if receipt["exchangeMinute"] in result:
                raise ValueError("Duplicate receipt minute")
            result[receipt["exchangeMinute"]] = receipt
    return result


def append_with_receipt(path, record, *, clock=utc_now, sync=os.fsync):
    """Publish a sidecar only after data fsync; never certify historical rows.

    A crash between appends leaves an unreceipted row, which remains unverified.
    This requires the collector's existing single-writer ownership of the file.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    rows = complete_lines(target, sync)
    sidecar = target.with_name(target.name + ".receipts.jsonl")
    generated_at = clock()
    payload = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    matches = [(offset, raw, row) for offset, raw, row in rows if row.get("exchangeMinute") == record.get("exchangeMinute")]
    if len(matches) > 1:
        raise ValueError("Duplicate forward minute")
    previous = matches[0] if matches else None
    if previous and previous[2] != record:
        raise ValueError("Conflicting forward minute")
    start = previous[0] if previous else (target.stat().st_size if target.exists() else 0)
    if previous:
        payload = previous[1]
    with target.open("ab") as handle:
        if not previous:
            handle.write(payload)
        handle.flush()
        sync(handle.fileno())
    # Broken research receipts must not suppress the next raw minute append.
    receipts = complete_lines(sidecar, sync)
    for _, _, saved in receipts:
        validate_receipt(target, saved)
        if saved.get("byteOffset") == start:
            # A prior receipt fsync may have failed despite visible bytes. Sync
            # again before acknowledging an idempotent retry, including restart.
            with sidecar.open("ab") as handle:
                handle.flush()
                sync(handle.fileno())
            return saved
    completed_at = clock()
    sources = record.get("fieldSources") or {}
    receipt = {
        "schemaVersion": 1, "contract": "local-append-receipt-v1",
        "exchangeMinute": record.get("exchangeMinute"),
        "recordSha256": hashlib.sha256(payload).hexdigest(),
        "byteOffset": start, "byteLength": len(payload),
        "receiptGeneratedAt": generated_at,
        "recordGeneratedAt": (record.get("timeContract") or {}).get("generatedAt"),
        "observedAt": record.get("observedAt"),
        "eventTimes": {key: value.get("exchangeTime") for key, value in sources.items() if isinstance(value, dict)},
        "receivedTimes": {key: value.get("receivedAt") for key, value in sources.items() if isinstance(value, dict)},
        "featureCutoffAt": (record.get("timeContract") or {}).get("featureCutoffAt"),
        "dataWriteCompletedAt": completed_at,
        "clockOrdered": (clock_ordered(record.get("observedAt"), generated_at, completed_at)
                         and all(clock_ordered(saved.get("dataWriteCompletedAt"), generated_at, completed_at)
                                 for _, _, saved in receipts)),
        "minuteFinality": "unverified", "verified": False,
    }
    with sidecar.open("ab") as handle:
        handle.write((json.dumps(receipt, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        handle.flush()
        sync(handle.fileno())
    return receipt
