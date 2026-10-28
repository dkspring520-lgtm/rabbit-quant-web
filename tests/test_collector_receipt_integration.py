from contextlib import nullcontext
import ast
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from zijin_l2_persistence_receipt import read_valid_receipts
from zijin_l2_receipt_writer import ReceiptWriter

source = ROOT / 'scripts/zijin_l2_collector.py'
tree = ast.parse(source.read_text(encoding='utf-8'))
names = {'write_forward_record', 'load_forward_index', 'append_forward_sample'}
methods = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name in names]
scope = dict(Path=Path, ReceiptWriter=ReceiptWriter, is_a_share_cash_session=lambda value: True,
             exchange_minute=lambda value: None, market_phase=lambda value: None)
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ClassDef(name='Collector',bases=[],keywords=[],body=methods,decorator_list=[])],type_ignores=[])),str(source),'exec'),scope)

class CollectorIntegration(unittest.TestCase):
    def fixture(self, path):
        obj=scope['Collector']()
        obj.forward_path=str(path)
        obj.forward_minutes=set();obj.forward_days=set();obj.symbol='601899'
        obj.forward_receipt_pending={}
        obj.forward_writer=ReceiptWriter(path)
        self.addCleanup(lambda: obj.forward_writer.close() if obj.forward_writer else None)
        obj.reverse_shadow=SimpleNamespace(observe=lambda row: None)
        obj.forward_research_requested=SimpleNamespace(set=lambda: None)
        return obj

    def test_receipt_failure_restarts_without_duplicate_raw_rows(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            path=Path(folder)/'forward.jsonl'
            obj=self.fixture(path)
            calls=[]
            def fail_receipt(fd):
                calls.append(fd)
                if len(calls)==2: raise OSError('receipt failed')
            obj.forward_writer.sync=fail_receipt
            try:
                with self.assertRaises(OSError):obj.write_forward_record({'exchangeMinute':'20261023-0930'})
                self.assertFalse(obj.forward_minutes)
            finally:obj.forward_writer.close()
            # Simulate receipt lost at crash, with raw row still durable.
            path.with_name(path.name+'.receipts.jsonl').write_bytes(b'')
            restored=self.fixture(path);restored.load_forward_index()
            self.assertEqual(len(restored.forward_receipt_pending),1)
            restored.write_forward_record(next(iter(restored.forward_receipt_pending.values())))
            self.assertFalse(restored.forward_receipt_pending)
            self.assertEqual(len(path.read_text().splitlines()),1)
            self.assertEqual(len(read_valid_receipts(path)),1)

    def test_startup_corruption_survives_idle_sampling_until_successful_revalidation(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            path=Path(folder)/'forward.jsonl'
            obj=self.fixture(path)
            obj.forward_writer.close()
            path.write_bytes(b'broken\n')
            obj.load_forward_index()
            self.assertEqual(obj.forward_startup_error,'JSONDecodeError')
            obj.append_forward_sample({})
            self.assertEqual(obj.forward_receipt_error,'JSONDecodeError')
            self.assertEqual(obj.forward_startup_error,'JSONDecodeError')
            path.write_bytes(b'')  # synthetic explicit repair, never production
            obj.load_forward_index()
            self.assertIsNone(obj.forward_startup_error)

if __name__=='__main__':unittest.main()
