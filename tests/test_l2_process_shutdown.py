"""Real parent/child stop and restart, synthetic ledger only; no NATS imports."""
import ast
import asyncio
import os
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import suppress
from pathlib import Path
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'scripts/zijin_l2_collector.py'
sys.path.insert(0,str(ROOT/'scripts'))
from zijin_l2_receipt_writer import ReceiptWriter
tree=ast.parse(SOURCE.read_text(encoding='utf-8'))
functions={'heartbeat_signature','stop_reader','supervise_collector','run_collector_child'}
methods={'load_forward_index','write_forward_record','flush_forward_records_background',
         'flush_forward_records_loop','shutdown_forward_records'}
nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in functions]
original=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Collector')
nodes.append(ast.ClassDef(name='CollectorMethods',bases=[],keywords=[],decorator_list=[],
    body=[n for n in original.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in methods]))
scope=dict(globals(),is_a_share_cash_session=lambda value:True)
exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(SOURCE),'exec'),scope)

class SyntheticCollector(scope['CollectorMethods']):
    def __init__(self,folder,mode):
        self.folder=Path(folder);self.mode=mode
        self.forward_path=str(self.folder/'forward.jsonl')
        self.forward_minutes=set();self.forward_days=set()
        self.reverse_shadow=SimpleNamespace(observe=lambda row:None)
        self.forward_research_requested=asyncio.Event()
        self.load_forward_index()

    async def run(self):
        if self.mode=='start':
            for key in ['one','two']:
                self.forward_receipt_pending[key]={'exchangeMinute':key,'persistenceContract':'local-append-receipt-v1'}
            # Deterministic uncompleted minute at shutdown, not a timing race.
            self.forward_retry_state['two']=(5,float('inf'))
        worker=asyncio.create_task(self.flush_forward_records_background())
        try:
            if self.mode=='start':
                while 'one' in self.forward_receipt_pending:await asyncio.sleep(.01)
                (self.folder/'ready').write_text('ready')
                await asyncio.Event().wait()
            else:
                deadline=time.monotonic()+3
                while self.forward_receipt_pending and time.monotonic()<deadline:await asyncio.sleep(.01)
                if self.forward_receipt_pending:raise RuntimeError('recovery did not finish')
        finally:
            await self.shutdown_forward_records(worker,timeout=.05)

class ProcessShutdownTests(unittest.TestCase):
    def test_parent_control_stop_then_new_child_recovers_pending_minute(self):
        with tempfile.TemporaryDirectory() as folder:
            command=[sys.executable,'-B',str(Path(__file__).resolve()),'--fixture',folder,'start']
            ready=Path(folder)/'ready'
            result=scope['supervise_collector'](command,Path(folder)/'heartbeat',
                startup_timeout=5,poll_interval=.01,termination_timeout=2,stop_requested=ready.exists)
            self.assertEqual(result,0)
            self.assertTrue(ready.exists())
            self.assertTrue(list(Path(folder).glob('*.pending-*.json')))
            resumed=subprocess.run(command[:-1]+['recover'],stdin=subprocess.DEVNULL,
                capture_output=True,text=True,timeout=5)
            self.assertEqual(resumed.returncode,0,resumed.stderr)
            with ReceiptWriter(Path(folder)/'forward.jsonl') as writer:
                self.assertEqual(set(writer.rows),{'one','two'})
                self.assertEqual(set(writer.receipts),{'one','two'})
                self.assertFalse(writer.recover_pending())
                self.assertTrue(all(not row['verified'] for row in writer.receipts.values()))

    @unittest.skipIf(os.name=='nt','POSIX SIGTERM requires Linux/POSIX; Windows control pipe tested separately')
    def test_posix_sigterm_enters_checkpoint_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            command=[sys.executable,'-B',str(Path(__file__).resolve()),'--fixture',folder,'start']
            child=subprocess.Popen(command,stdin=subprocess.PIPE)
            try:
                deadline=time.monotonic()+5
                while not (Path(folder)/'ready').exists() and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue((Path(folder)/'ready').exists())
                child.send_signal(signal.SIGTERM)
                self.assertEqual(child.wait(timeout=3),0)
                self.assertTrue(list(Path(folder).glob('*.pending-*.json')))
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=2)
                child.stdin.close()

if __name__=='__main__':
    if '--fixture' in sys.argv:
        raise SystemExit(asyncio.run(scope['run_collector_child'](lambda:SyntheticCollector(sys.argv[2],sys.argv[3]))))
    unittest.main()
