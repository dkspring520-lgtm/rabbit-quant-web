#!/usr/bin/env python3
"""Run the Zijin scheduler, detect stale heartbeats and force Docker recovery."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from zijin_scheduler_health import scheduler_health


ROOT = Path(__file__).resolve().parent.parent


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_path(name: str, fallback: str) -> Path:
    return Path(os.environ.get(name, fallback)).resolve()


def read_state(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def write_state_failure(path: Path, reason: str) -> None:
    value = read_state(path) or {
        "schemaVersion": 1,
        "stock": {"code": "601899", "name": "紫金矿业"},
        "rabbits": {},
    }
    scheduler = value.setdefault("scheduler", {})
    scheduler.update({
        "enabled": True,
        "mode": "change-driven",
        "status": "failed",
        "reason": reason,
        "heartbeatAt": utc_iso(),
    })
    value["updatedAt"] = utc_iso()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def append_alert(path: Path, event: str, reason: str, child_pid: int | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "at": utc_iso(),
        "event": event,
        "reason": reason,
        "action": "exit-for-docker-restart",
        "childPid": child_pid,
    }
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def terminate(child: subprocess.Popen[Any]) -> None:
    if child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)


def main() -> None:
    data = env_path("ZIJIN_TRAINING_INPUT", "/training-data/zijin-peer-panel-2022-2026.parquet")
    state = env_path("ZIJIN_AUTOMATION_STATE_PATH", "/training-state/zijin-automation-status.json")
    report = env_path("ZIJIN_TRAINING_REPORT_PATH", "/training-state/zijin-round8-report.json")
    protocol = env_path("ZIJIN_TRAINING_PROTOCOL", "/app/scripts/zijin-round8-protocol.json")
    runner = env_path("ZIJIN_TRAINING_RUNNER", "/app/scripts/run_zijin_round4_experiments.py")
    runtime = env_path("ZIJIN_TRAINING_RUNTIME", "/training-runtime")
    alerts = env_path("ZIJIN_TRAINER_ALERTS_PATH", "/training-state/zijin-trainer-alerts.jsonl")
    interval_minutes = max(1, int(os.environ.get("ZIJIN_CHECK_INTERVAL_MINUTES", "30")))
    heartbeat_seconds = max(1, int(os.environ.get("ZIJIN_HEARTBEAT_SECONDS", "5")))
    idle_heartbeat_seconds = max(10, int(os.environ.get("ZIJIN_IDLE_HEARTBEAT_SECONDS", "30")))
    monitor_seconds = max(2, int(os.environ.get("ZIJIN_SUPERVISOR_INTERVAL_SECONDS", "10")))
    startup_grace = max(30, int(os.environ.get("ZIJIN_STARTUP_GRACE_SECONDS", "90")))
    idle_grace = max(30, int(os.environ.get("ZIJIN_IDLE_GRACE_SECONDS", "180")))

    required = [data, protocol, runner]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        reason = "训练器缺少必要文件：" + "、".join(missing)
        append_alert(alerts, "configuration-error", reason, None)
        write_state_failure(state, reason)
        time.sleep(10)
        raise SystemExit(78)

    command = [
        sys.executable,
        str(ROOT / "scripts" / "zijin-auto-trainer.py"),
        str(data),
        "--protocol", str(protocol),
        "--runner", str(runner),
        "--state", str(state),
        "--report", str(report),
        "--runtime", str(runtime),
        "--history", str(runtime / "run-history.jsonl"),
        "--lock", str(runtime / "trainer.lock"),
        "--interval-minutes", str(interval_minutes),
        "--heartbeat-seconds", str(heartbeat_seconds),
        "--idle-heartbeat-seconds", str(idle_heartbeat_seconds),
        "--daemon",
    ]
    child = subprocess.Popen(command, cwd=ROOT)
    stopping = False

    def stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    started = time.monotonic()
    try:
        while not stopping:
            return_code = child.poll()
            if return_code is not None:
                reason = f"训练调度子进程意外退出，退出码 {return_code}"
                append_alert(alerts, "child-exit", reason, child.pid)
                write_state_failure(state, reason)
                raise SystemExit(return_code or 70)

            if time.monotonic() - started >= startup_grace:
                healthy, reason = scheduler_health(read_state(state), idle_grace_seconds=idle_grace)
                if not healthy:
                    terminate(child)
                    alert_reason = f"监督器触发自动恢复：{reason}"
                    append_alert(alerts, "heartbeat-timeout", alert_reason, child.pid)
                    write_state_failure(state, alert_reason)
                    raise SystemExit(75)
            time.sleep(monitor_seconds)
    finally:
        terminate(child)


if __name__ == "__main__":
    main()
