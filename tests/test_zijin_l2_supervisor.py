"""Finite real-child liveness regression; no NATS, credentials or market inputs."""
import ast
import contextlib
import io
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "zijin_l2_collector.py"
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
# Same AST-isolation pattern as test_zijin_l2_event_semantics.py: execute the
# actual stdlib-only functions, without importing unavailable NATS or any model.
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef)
         and n.name in {"heartbeat_signature", "stop_reader", "supervise_collector"}]
env = dict(Path=Path, time=time, os=os, stat=stat, sys=sys, subprocess=subprocess, __file__=str(SOURCE))
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), env)


class SupervisorTests(unittest.TestCase):
    def test_default_entrypoint_does_not_start_unmonitored_reader(self):
        def forbidden():
            self.fail("parent must not instantiate reader in its event loop")

        scope = dict(__name__="__main__", sys=SimpleNamespace(argv=[str(SOURCE)]),
                     run_supervised_collector=lambda: 23, Collector=forbidden)
        with self.assertRaises(SystemExit) as stopped:
            exec(compile(ast.Module(body=[tree.body[-1]], type_ignores=[]), str(SOURCE), "exec"), scope)
        self.assertEqual(stopped.exception.code, 23)

    def test_child_entrypoint_runs_reader_without_recursive_supervision(self):
        called = []

        def forbidden():
            self.fail("reader child must not recursively create a supervisor")

        scope = dict(__name__="__main__", sys=SimpleNamespace(argv=[str(SOURCE), "--collector-child"]),
                     run_supervised_collector=forbidden,
                     run_collector_child=lambda: "reader-coroutine",
                     asyncio=SimpleNamespace(run=lambda value: called.append(value) or 0))
        with self.assertRaises(SystemExit) as stopped:
            exec(compile(ast.Module(body=[tree.body[-1]], type_ignores=[]), str(SOURCE), "exec"), scope)
        self.assertEqual(stopped.exception.code,0)
        self.assertEqual(called, ["reader-coroutine"])

    def exercise(self, code, *, preexisting=False, stop_after=None, future_mtime=False):
        with tempfile.TemporaryDirectory(prefix="l2-supervisor-fixture-") as folder:
            path = Path(folder) / "heartbeat.json"
            if preexisting:
                path.write_text("old fixture", encoding="utf-8")
                if future_mtime:
                    os.utime(path, (time.time() + 86400, time.time() + 86400))
            children = []

            def spawn(command, **kwargs):
                child = subprocess.Popen(command, **kwargs)
                children.append(child)
                return child

            original = env["subprocess"]
            env["subprocess"] = SimpleNamespace(Popen=spawn, PIPE=subprocess.PIPE, TimeoutExpired=subprocess.TimeoutExpired)
            started = time.monotonic()
            stderr = io.StringIO()
            try:
                with contextlib.redirect_stderr(stderr):
                    result = env["supervise_collector"](
                        [sys.executable, "-B", "-c", code, str(path)], path,
                        heartbeat_timeout=.25, startup_timeout=.8,
                        poll_interval=.02, termination_timeout=.4,
                        stop_requested=lambda: stop_after is not None and time.monotonic() - started >= stop_after)
            finally:
                env["subprocess"] = original
            elapsed = time.monotonic() - started
            self.assertEqual(len(children), 1)
            self.assertIsNotNone(children[0].poll(), "reader must be reaped")
            self.assertLess(elapsed, 4, "finite test must not leave a resident process")
            return result, elapsed, stderr.getvalue()

    def test_busy_reader_after_first_publish_is_terminated(self):
        code = "from pathlib import Path;import sys;Path(sys.argv[1]).write_text('fixture');exec('while True: pass')"
        result, elapsed, log = self.exercise(code)
        self.assertEqual(result, 1)
        self.assertIn("heartbeat stopped advancing", log)
        self.assertLess(elapsed, 1.8)

    def test_never_published_reader_has_bounded_startup(self):
        result, elapsed, _ = self.exercise("while True: pass")
        self.assertEqual(result, 1)
        self.assertGreaterEqual(elapsed, .8)

    def test_noncooperative_reader_is_killed_and_reaped(self):
        code = "from pathlib import Path;import sys,signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path(sys.argv[1]).write_text('fixture');exec('while True: pass')"
        result, elapsed, _ = self.exercise(code)
        self.assertEqual(result, 1)
        self.assertLess(elapsed, 2.2)

    def test_old_existing_state_does_not_count_as_child_progress(self):
        result, elapsed, _ = self.exercise("while True: pass", preexisting=True)
        self.assertEqual(result, 1)
        self.assertGreaterEqual(elapsed, .8)

    def test_future_wall_clock_mtime_cannot_disable_monotonic_deadline(self):
        result, elapsed, _ = self.exercise("while True: pass", preexisting=True, future_mtime=True)
        self.assertEqual(result, 1)
        self.assertGreaterEqual(elapsed, .8)

    def test_continuing_publication_keeps_reader_alive_until_clean_exit(self):
        code = "from pathlib import Path;import sys,time;p=Path(sys.argv[1]);[(p.write_text(str(i)),time.sleep(.08)) for i in range(8)]"
        result, elapsed, log = self.exercise(code)
        self.assertEqual(result, 0)
        self.assertGreater(elapsed, .6)
        self.assertEqual(log, "")

    def test_reader_failure_exit_code_is_preserved(self):
        result, _, log = self.exercise("raise SystemExit(7)")
        self.assertEqual(result, 7)
        self.assertEqual(log, "")

    def test_requested_stop_reaps_reader_without_restart_failure(self):
        result, _, log = self.exercise("import sys;sys.stdin.buffer.readline()", stop_after=.15)
        self.assertEqual(result, 0)
        self.assertEqual(log, "")

    def test_requested_stop_forced_kill_is_not_reported_clean(self):
        result, _, log = self.exercise("while True: pass",stop_after=.15)
        self.assertEqual(result,1)
        self.assertIn('forcing kill',log)

    def test_missing_or_nonregular_state_is_not_progress(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(env["heartbeat_signature"](Path(folder) / "missing"))
            self.assertIsNone(env["heartbeat_signature"](folder))

    def test_atomic_replacement_is_observed_even_at_same_size(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state"
            path.write_text("a")
            before = env["heartbeat_signature"](path)
            other = Path(folder) / "new"
            other.write_text("b")
            os.replace(other, path)
            self.assertNotEqual(before, env["heartbeat_signature"](path))


if __name__ == "__main__":
    unittest.main(verbosity=2)
