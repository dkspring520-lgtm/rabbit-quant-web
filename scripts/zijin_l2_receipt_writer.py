"""Process-owned incremental forward ledger. No market-finality assertion."""
import hashlib
import json
import os
import threading
import tempfile
from pathlib import Path
from zijin_l2_persistence_receipt import complete_lines, validate_receipt, clock_ordered, utc_now


class ReceiptWriter:
    def __init__(self, path, *, clock=utc_now, sync=os.fsync):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.sidecar = self.path.with_name(self.path.name + '.receipts.jsonl')
        self.clock, self.sync = clock, sync
        self.mutex = threading.Lock()
        self.lock = self.path.with_name(self.path.name + '.writer.lock').open('a+b')
        try:
            if self.lock.seek(0, 2) == 0:
                self.lock.write(b'0'); self.lock.flush()
            self.lock.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.rows, self.receipts = {}, {}
            self.data_end = self.receipt_end = 0
            self.last_receipt_time = None
            self.receipt_error = None
            self._load_data()
            try:self._load_receipts()
            except (OSError, ValueError) as exc:self.receipt_error = type(exc).__name__
            self.expected = self._signatures()
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.lock is not None:
            self.lock.close()
            self.lock = None

    def __enter__(self):return self
    def __exit__(self, *args):self.close()

    def preserve_pending(self, records):
        """Immutable shutdown intent, independent of an in-flight ledger append."""
        if not records:return
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=self.path.parent,
                prefix=self.path.name+'.pending-', suffix='.tmp', delete=False) as handle:
            json.dump({'schemaVersion':1, 'records':records}, handle, ensure_ascii=False)
            handle.flush(); self.sync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, temporary.with_suffix('.json'))
        if os.name != 'nt':
            fd = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:self.sync(fd)
            finally:os.close(fd)

    def recover_pending(self):
        pending = {}
        for path in sorted(self.path.parent.glob(self.path.name+'.pending-*.json')):
            payload = json.loads(path.read_text(encoding='utf-8'))
            if payload.get('schemaVersion') != 1 or not isinstance(payload.get('records'), list):
                raise ValueError('Invalid shutdown recovery schema')
            for row in payload['records']:
                key = row.get('exchangeMinute')
                if not isinstance(key, str) or row.get('persistenceContract') != 'local-append-receipt-v1':
                    raise ValueError('Invalid shutdown recovery record')
                prior = self.rows.get(key)
                if (prior and prior[2] != row) or (key in pending and pending[key] != row):
                    raise ValueError('Conflicting shutdown recovery record')
                if key not in self.receipts:pending[key] = row
        return pending

    def _signatures(self):
        def signature(path):
            try:
                s = path.stat()
                return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
            except FileNotFoundError:return None
        return (signature(self.path), signature(self.sidecar))

    def _load_data(self):
        for offset, raw, row in complete_lines(self.path, self.sync, start=self.data_end):
            key = row.get('exchangeMinute')
            if key in self.rows:raise ValueError('Duplicate forward minute')
            self.rows[key] = (offset, raw, row)
            self.data_end = offset + len(raw)

    def _load_receipts(self):
        for offset, raw, receipt in complete_lines(self.sidecar, self.sync, start=self.receipt_end):
            row = validate_receipt(self.path, receipt)
            key = row.get('exchangeMinute')
            if key in self.receipts:raise ValueError('Duplicate receipt minute')
            self.receipts[key] = receipt
            self.receipt_end = offset + len(raw)
            stamp = receipt.get('dataWriteCompletedAt')
            if self.last_receipt_time is None or not clock_ordered(stamp, self.last_receipt_time):
                self.last_receipt_time = stamp

    def append(self, record):
        with self.mutex:
            return self._append(record)

    def _append(self, record):
        if self.lock is None:raise RuntimeError('Receipt writer is closed')
        if self._signatures() != self.expected:
            raise ValueError('Forward ledger changed outside owning writer; restart validation required')
        try:
            # Only a suffix left by our own failed append is read on retry.
            self._load_data()
            key = record.get('exchangeMinute')
            prior = self.rows.get(key)
            if prior and prior[2] != record:raise ValueError('Conflicting forward minute')
            generated = self.clock()
            raw = prior[1] if prior else (json.dumps(record, ensure_ascii=False, separators=(',', ':'))+'\n').encode('utf-8')
            offset = prior[0] if prior else self.data_end
            with self.path.open('ab') as handle:
                if not prior:handle.write(raw)
                handle.flush(); self.sync(handle.fileno())
            if not prior:
                self.rows[key] = (offset, raw, json.loads(raw))
                self.data_end = offset + len(raw)
            # Receipt corruption must not prevent the raw append above.
            if self.receipt_error:
                raise ValueError('Receipt validation failed; restart validation required')
            try:self._load_receipts()
            except ValueError as exc:
                self.receipt_error = type(exc).__name__
                raise
            if key in self.receipts:
                with self.sidecar.open('ab') as handle:
                    handle.flush(); self.sync(handle.fileno())
                return self.receipts[key]
            completed = self.clock()
            sources = record.get('fieldSources') or {}
            contract = record.get('timeContract') or {}
            receipt = {
                'schemaVersion':1, 'contract':'local-append-receipt-v1',
                'exchangeMinute':key, 'recordSha256':hashlib.sha256(raw).hexdigest(),
                'byteOffset':offset, 'byteLength':len(raw),
                'receiptGeneratedAt':generated, 'recordGeneratedAt':contract.get('generatedAt'),
                'observedAt':record.get('observedAt'),
                'eventTimes':{k:v.get('exchangeTime') for k,v in sources.items() if isinstance(v,dict)},
                'receivedTimes':{k:v.get('receivedAt') for k,v in sources.items() if isinstance(v,dict)},
                'featureCutoffAt':contract.get('featureCutoffAt'), 'dataWriteCompletedAt':completed,
                'clockOrdered':clock_ordered(record.get('observedAt'), generated, completed) and clock_ordered(self.last_receipt_time, generated, completed),
                'minuteFinality':'unverified', 'verified':False,
            }
            encoded = (json.dumps(receipt,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8')
            with self.sidecar.open('ab') as handle:
                handle.write(encoded); handle.flush(); self.sync(handle.fileno())
            self.receipts[key] = receipt
            self.receipt_end += len(encoded)
            self.last_receipt_time = completed if self.last_receipt_time is None or clock_ordered(self.last_receipt_time,completed) else self.last_receipt_time
            return receipt
        finally:
            self.expected = self._signatures()
