from contextlib import nullcontext
"""Synthetic blocking-ledger regressions; no market data, NATS or network."""
import ast
import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from contextlib import suppress
from pathlib import Path

SOURCE = Path(os.getenv("L2_COLLECTOR_SOURCE", str(Path(__file__).resolve().parents[1] / "scripts/zijin_l2_collector.py")))
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
collector = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Collector")
names = {"write_forward_record", "publish_state", "refresh_forward_research_background", "refresh_forward_research", "flush_forward_records_background", "flush_forward_records_loop", "shutdown_forward_records", "load_forward_index", "run"}
methods = [n for n in collector.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
import sys
sys.path.insert(0, str(SOURCE.parents[0]))
from zijin_l2_receipt_writer import ReceiptWriter
scope = dict(asyncio=asyncio, Path=Path, json=json, os=os, ReceiptWriter=ReceiptWriter, time=time, suppress=suppress, is_a_share_cash_session=lambda value: True)
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ClassDef(name="CollectorUnderTest", bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])), str(SOURCE), "exec"), scope)
CollectorUnderTest = scope["CollectorUnderTest"]


class ResearchSchedulingTests(unittest.IsolatedAsyncioTestCase):
    def enterContext(self, context):
        # Python 3.10 equivalent: only register exit after successful entry.
        # addCleanup is LIFO, so writer locks close before temporary directories.
        cls = type(context)
        enter, exit = cls.__enter__, cls.__exit__
        result = enter(context)
        self.addCleanup(exit, context, None, None, None)
        return result

    def test_context_cleanup_preserves_exit_arguments_and_lifo_on_failure(self):
        probe = unittest.TestCase()
        events = []
        class Context:
            def __enter__(self):events.append('enter');return 'value'
            def __exit__(self, *args):events.append(('exit', args))
        self.assertEqual(ResearchSchedulingTests.enterContext(probe, Context()), 'value')
        probe.addCleanup(events.append, 'writer-close')
        try:
            raise RuntimeError('synthetic body failure')
        except RuntimeError:
            probe.doCleanups()
        self.assertEqual(events, ['enter', 'writer-close', ('exit', (None, None, None))])
        class FailedEntry(Context):
            def __enter__(self):raise ValueError('synthetic entry failure')
        with self.assertRaises(ValueError):ResearchSchedulingTests.enterContext(probe, FailedEntry())
        probe.doCleanups()
        self.assertEqual(len(events), 3)

    async def test_run_cleanup_executes_even_when_shutdown_checkpoint_fails(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        obj.urls=['synthetic'];obj.user=obj.password=None
        obj.forward_receipt_pending['one']={'exchangeMinute':'one','persistenceContract':'local-append-receipt-v1'}
        obj.forward_retry_state['one']=(5,0)
        def fail(records):raise OSError('synthetic disk failure')
        obj.forward_writer.preserve_pending=fail
        entered=asyncio.Event();cleaned=[]
        async def connect(**kwargs):entered.set();await asyncio.sleep(10)
        scope['nats']=SimpleNamespace(connect=connect)
        async def sibling(name):
            try:await asyncio.sleep(10)
            finally:cleaned.append(name)
        obj.publish_state=lambda:sibling('publisher')
        obj.refresh_forward_research_background=lambda:sibling('research')
        obj.refresh_reverse_shadow_regime=lambda:sibling('regime')
        obj.refresh_reverse_shadow_peers=lambda:sibling('peers')
        task=asyncio.create_task(obj.run())
        await entered.wait();task.cancel()
        with self.assertRaises(OSError):await task
        self.assertEqual(set(cleaned),{'publisher','research','regime','peers'})
        self.assertIsNone(obj.forward_writer.lock)

    async def test_shutdown_drains_two_and_restart_deduplicates_checkpoint(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        for key in ['one','two']:
            obj.forward_receipt_pending[key]={'exchangeMinute':key,'persistenceContract':'local-append-receipt-v1'}
        worker=asyncio.create_task(obj.flush_forward_records_background())
        await obj.shutdown_forward_records(worker, timeout=.5)
        self.assertFalse(obj.forward_receipt_pending)
        self.assertTrue(obj.forward_stopping)
        self.assertIsNone(obj.forward_writer.lock)
        restored=self.fixture(folder);restored.load_forward_index()
        self.assertFalse(restored.forward_receipt_pending)
        self.assertEqual(len(Path(obj.forward_path).read_text().splitlines()),2)

    async def test_shutdown_timeout_preserves_two_and_holds_lock_until_thread_finishes(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        started,release=threading.Event(),threading.Event()
        original=obj.forward_writer.append
        def slow(row):
            started.set();release.wait(2);return original(row)
        obj.forward_writer.append=slow
        for key in ['one','two']:
            obj.forward_receipt_pending[key]={'exchangeMinute':key,'persistenceContract':'local-append-receipt-v1'}
        worker=asyncio.create_task(obj.flush_forward_records_background())
        try:
            for _ in range(100):
                if started.is_set():break
                await asyncio.sleep(.005)
            self.assertTrue(started.is_set())
            await obj.shutdown_forward_records(worker,timeout=.05)
            self.assertIsNotNone(obj.forward_writer.lock)
            self.assertEqual(len(obj.forward_writer.recover_pending()),2)
        finally:
            release.set()
            await obj.forward_close_task
        restored=self.fixture(folder);restored.load_forward_index()
        self.assertEqual(list(restored.forward_receipt_pending),['two'])

    async def test_worker_crash_is_visible_and_shutdown_releases_owner(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        def crash(row):raise RuntimeError('injected crash')
        obj.forward_writer.append=crash
        obj.forward_receipt_pending['one']={'exchangeMinute':'one','persistenceContract':'local-append-receipt-v1'}
        worker=asyncio.create_task(obj.flush_forward_records_background())
        obj.forward_receipt_worker=worker
        await worker
        self.assertEqual(obj.forward_worker_error,'RuntimeError')
        obj.state=lambda:{};obj.append_forward_sample=lambda state:None
        published=[];scope['atomic_json']=lambda path,state:published.append(state)
        publisher=asyncio.create_task(obj.publish_state())
        try:
            await asyncio.sleep(.03)
            self.assertEqual(published[-1]['forwardPersistence']['status'],'worker-error')
            await obj.shutdown_forward_records(worker,timeout=.05)
            self.assertIsNone(obj.forward_writer.lock)
            restored=self.fixture(folder);restored.load_forward_index()
            self.assertIn('one',restored.forward_receipt_pending)
        finally:await self.stop(publisher)

    async def test_checkpoint_failure_is_raised_and_lock_cleanup_still_runs(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        obj.forward_receipt_pending['one']={'exchangeMinute':'one','persistenceContract':'local-append-receipt-v1'}
        def fail(records):raise OSError('disk unavailable')
        obj.forward_writer.preserve_pending=fail
        worker=asyncio.create_task(asyncio.sleep(10))
        with self.assertRaises(OSError):await obj.shutdown_forward_records(worker,timeout=.1)
        self.assertEqual(obj.forward_worker_error,'ShutdownPreservationFailed:OSError')
        self.assertIsNone(obj.forward_writer.lock)
        self.assertTrue(worker.done())
    async def test_idle_publication_keeps_startup_validation_error(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        obj.forward_startup_error='JSONDecodeError'
        obj.forward_receipt_error='JSONDecodeError'
        obj.state=lambda:{}
        obj.append_forward_sample=lambda state:None
        published=[]
        scope['atomic_json']=lambda path,state:published.append(state)
        task=asyncio.create_task(obj.publish_state())
        try:
            await asyncio.sleep(.03)
            self.assertTrue(published)
            self.assertTrue(all(row['forwardPersistence']['status']=='validation-error' for row in published))
        finally:await self.stop(task)

    async def test_slow_forward_fsync_runs_off_publisher_loop(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        started=threading.Event()
        original=obj.forward_writer.append
        def slow(record):
            started.set();time.sleep(.25);return original(record)
        obj.forward_writer.append=slow
        row={'exchangeMinute':'20990101-0930','persistenceContract':'local-append-receipt-v1'}
        obj.forward_receipt_pending[row['exchangeMinute']]=row
        obj.append_forward_sample=lambda state:None
        obj.state=lambda:{}
        published=[]
        scope['atomic_json']=lambda path,state:published.append(started.is_set())
        tasks=[asyncio.create_task(obj.flush_forward_records_background()),asyncio.create_task(obj.publish_state())]
        try:
            await asyncio.sleep(.4)
            self.assertGreaterEqual(sum(published),5)
            self.assertFalse(obj.forward_receipt_pending)
        finally:await self.stop(*tasks)

    async def test_failed_writes_back_off_and_stop_after_limit(self):
        folder=self.enterContext(tempfile.TemporaryDirectory())
        obj=self.fixture(folder)
        calls=[]
        def fail(record):calls.append(record);raise OSError('synthetic failure')
        obj.forward_writer.append=fail
        obj.forward_receipt_pending['one']={'exchangeMinute':'one'}
        worker=asyncio.create_task(obj.flush_forward_records_background())
        try:
            await asyncio.sleep(.35)
            self.assertEqual(len(calls),1)
            self.assertEqual(obj.forward_write_error,'OSError')
            obj.forward_retry_state['one']=(5,0)
            await asyncio.sleep(.3)
            self.assertEqual(len(calls),1)
            self.assertIn('one',obj.forward_receipt_pending)
        finally:await self.stop(worker)

    def fixture(self, folder):
        obj = CollectorUnderTest()
        obj.forward_path = str(Path(folder) / "forward.jsonl")
        obj.forward_minutes, obj.forward_days = set(), set()
        obj.forward_receipt_pending={}
        obj.forward_retry_state={}
        obj.forward_startup_error=None
        obj.forward_write_error=None
        obj.forward_worker_error=None
        obj.forward_writer=ReceiptWriter(obj.forward_path)
        self.addCleanup(lambda: obj.forward_writer.close() if obj.forward_writer else None)
        obj.forward_research_requested = asyncio.Event()
        obj.reverse_shadow = type("Shadow", (), {"observe": lambda self, record: None})()
        obj.publish_interval, obj.state_path = .01, "synthetic-state"
        obj.append_second_event = lambda state: None
        return obj

    async def stop(self, *tasks):
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task

    async def test_slow_ledger_does_not_stop_publication_or_callbacks(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            obj = self.fixture(folder)
            running, done = threading.Event(), threading.Event()
            published, callbacks = [], []
            def calculate():
                running.set()
                try:
                    time.sleep(.25)  # A blocked ledger, never real history.
                finally:
                    running.clear()
                    done.set()
            obj.refresh_forward_research = calculate
            obj.state = lambda: {"fixture": True}
            queued = False
            def append(state):
                nonlocal queued
                if not queued:
                    queued = True
                    obj.write_forward_record({"exchangeMinute": "20990101-0930", "fixture": True})
            obj.append_forward_sample = append
            scope["atomic_json"] = lambda path, state: published.append(running.is_set())
            writer = asyncio.create_task(obj.publish_state())
            worker = asyncio.create_task(obj.refresh_forward_research_background()) if hasattr(obj, "refresh_forward_research_background") else None
            async def callbacks_on_loop():
                deadline = time.monotonic() + .45
                while time.monotonic() < deadline:
                    callbacks.append(running.is_set())
                    await asyncio.sleep(.01)
            try:
                await callbacks_on_loop()
                self.assertTrue(done.is_set())
                self.assertGreaterEqual(sum(published), 5, "heartbeat must advance while labeling blocks")
                self.assertGreaterEqual(sum(callbacks), 5, "market callbacks must run while labeling blocks")
                self.assertEqual(len(Path(obj.forward_path).read_text().splitlines()), 1)
            finally:
                await self.stop(*[t for t in [writer, worker] if t is not None])

    async def test_requests_during_refresh_are_coalesced_and_serial(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            obj = self.fixture(folder)
            started, release = threading.Event(), threading.Event()
            active, maximum, calls = 0, 0, 0
            def calculate():
                nonlocal active, maximum, calls
                active += 1
                maximum = max(maximum, active)
                calls += 1
                started.set()
                release.wait(1)
                active -= 1
            obj.refresh_forward_research = calculate
            self.assertTrue(hasattr(obj, "refresh_forward_research_background"))
            worker = asyncio.create_task(obj.refresh_forward_research_background())
            try:
                obj.forward_research_requested.set()
                deadline = time.monotonic() + .7
                while not started.is_set() and time.monotonic() < deadline:
                    await asyncio.sleep(.01)
                self.assertTrue(started.is_set())
                for _ in range(20):
                    obj.forward_research_requested.set()
                release.set()
                deadline = time.monotonic() + .7
                while calls < 2 and time.monotonic() < deadline:
                    await asyncio.sleep(.01)
                await asyncio.sleep(.05)
                self.assertEqual(calls, 2)
                self.assertEqual(maximum, 1, "never run concurrent label-ledger writers")
            finally:
                release.set()
                await self.stop(worker)

    async def test_duplicate_minutes_do_not_queue_more_work(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            obj = self.fixture(folder)
            obj.refresh_forward_research = lambda: None
            row = {"exchangeMinute": "20990101-0930", "fixture": True}
            obj.write_forward_record(row)
            self.assertTrue(obj.forward_research_requested.is_set())
            obj.forward_research_requested.clear()
            obj.write_forward_record(row)
            self.assertFalse(obj.forward_research_requested.is_set())
            self.assertEqual(len(Path(obj.forward_path).read_text().splitlines()), 1)

    async def test_idle_worker_has_no_polling_or_spurious_refresh(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            obj = self.fixture(folder)
            calls = []
            obj.refresh_forward_research = lambda: calls.append(True)
            worker = asyncio.create_task(obj.refresh_forward_research_background())
            try:
                await asyncio.sleep(.03)
                self.assertEqual(calls, [])
                self.assertFalse(worker.done())
            finally:
                await self.stop(worker)

    def test_research_failures_keep_existing_retry_status(self):
        with nullcontext(self.enterContext(tempfile.TemporaryDirectory())) as folder:
            obj = self.fixture(folder)
            for name in ["forward_label_path", "forward_research_state_path"]:
                setattr(obj, name, "synthetic-only")
            obj.forward_cost_pct = None
            obj.forward_min_samples = obj.forward_min_days = obj.forward_min_opening_labels = 1
            obj.forward_cost_options = {}
            def fail(*args, **kwargs):
                raise OSError("synthetic ledger failure")
            scope["refresh_labels_and_state"] = fail
            obj.refresh_forward_research()
            self.assertEqual(obj.forward_research_status, "labeling-retry-pending")

    def test_startup_queues_research_and_run_owns_worker_cleanup(self):
        init = next(n for n in collector.body if isinstance(n, ast.FunctionDef) and n.name == "__init__")
        init_text = ast.get_source_segment(SOURCE.read_text(encoding="utf-8"), init)
        self.assertNotIn("self.refresh_forward_research()", init_text)
        self.assertIn("self.forward_research_requested.set()", init_text)
        run = next(n for n in collector.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "run")
        run_text = ast.get_source_segment(SOURCE.read_text(encoding="utf-8"), run)
        self.assertIn("forward_research.cancel()", run_text)
        self.assertIn("await asyncio.gather(writer, forward_research", run_text)


if __name__ == "__main__":
    unittest.main()
