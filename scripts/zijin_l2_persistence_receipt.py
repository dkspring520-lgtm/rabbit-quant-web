"""Single-writer append receipts. Local durability is not exchange finality."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def complete_lines(path, sync=os.fsync, *, start=0):
    """Preserve a torn tail before repairing the active append file, never archives."""
    path = Path(path)
    if path.exists():
        with path.open('rb') as handle:
            handle.seek(start)
            raw = handle.read()
    else:raw = b""
    if raw and not raw.endswith(b"\n"):
        boundary = raw.rfind(b"\n") + 1
        tail = raw[boundary:]
        backup = path.with_name(path.name + ".torn-" + hashlib.sha256(tail).hexdigest())
        with backup.open("wb") as handle:
            handle.write(tail)
            handle.flush()
            sync(handle.fileno())
        with path.open("r+b") as handle:
            handle.truncate(start + boundary)
            handle.flush()
            sync(handle.fileno())
        raw = raw[:boundary]
    rows, offset = [], start
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
    """One-shot compatibility API; the collector retains one ReceiptWriter."""
    from zijin_l2_receipt_writer import ReceiptWriter
    with ReceiptWriter(path, clock=clock, sync=sync) as writer:
        return writer.append(record)
