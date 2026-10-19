"""Synthetic blocking-ledger regressions; no market data, NATS or network."""
import ast
import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
from contextlib import suppress
from pathlib import Path

SOURCE = Path(os.getenv("L2_COLLECTOR_SOURCE", str(Path(__file__).resolve().parents[1] / "scripts/zijin_l2_collector.py")))
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
collector = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Collector")
names = {"write_forward_record", "publish_state", "refresh_forward_research_background", "refresh_forward_research"}
methods = [n for n in collector.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
scope = dict(asyncio=asyncio, Path=Path, json=json, os=os)
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ClassDef(name="CollectorUnderTest", bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])), str(SOURCE), "exec"), scope)
CollectorUnderTest = scope["CollectorUnderTest"]


class ResearchSchedulingTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self, folder):
        obj = CollectorUnderTest()
        obj.forward_path = str(Path(folder) / "forward.jsonl")
        obj.forward_minutes, obj.forward_days = set(), set()
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
        with tempfile.TemporaryDirectory() as folder:
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
        with tempfile.TemporaryDirectory() as folder:
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
        with tempfile.TemporaryDirectory() as folder:
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
        with tempfile.TemporaryDirectory() as folder:
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
        with tempfile.TemporaryDirectory() as folder:
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
        self.assertIn("await forward_research", run_text)


if __name__ == "__main__":
    unittest.main()
