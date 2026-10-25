"""Single-writer append receipts. Local durability is not exchange finality."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def append_with_receipt(path, record, *, clock=utc_now, sync=os.fsync):
    """Publish a sidecar only after data fsync; never certify historical rows.

    A crash between appends leaves an unreceipted row, which remains unverified.
    This requires the collector's existing single-writer ownership of the file.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    generated_at = clock()
    payload = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    with target.open("ab") as handle:
        start = handle.tell()
        handle.write(payload)
        handle.flush()
        sync(handle.fileno())
    completed_at = clock()
    sources = record.get("fieldSources") or {}
    receipt = {
        "schemaVersion": 1, "contract": "local-append-receipt-v1",
        "exchangeMinute": record.get("exchangeMinute"),
        "recordSha256": hashlib.sha256(payload).hexdigest(),
        "byteOffset": start, "byteLength": len(payload),
        "receiptGeneratedAt": generated_at,
        "observedAt": record.get("observedAt"),
        "eventTimes": {key: value.get("exchangeTime") for key, value in sources.items() if isinstance(value, dict)},
        "receivedTimes": {key: value.get("receivedAt") for key, value in sources.items() if isinstance(value, dict)},
        "featureCutoffAt": (record.get("timeContract") or {}).get("featureCutoffAt"),
        "dataWriteCompletedAt": completed_at,
        "minuteFinality": "unverified", "verified": False,
    }
    sidecar = target.with_name(target.name + ".receipts.jsonl")
    with sidecar.open("ab") as handle:
        handle.write((json.dumps(receipt, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        handle.flush()
        sync(handle.fileno())
    return receipt
