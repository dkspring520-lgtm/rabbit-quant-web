#!/usr/bin/env python3
"""Change-driven, auditable scheduler for Zijin research experiments.

The scheduler never promotes a model.  It runs only when the sealed data file
or preregistered protocol changes (unless --force is supplied), maintains a
heartbeat for the public dashboard, and appends one hash-chained run record.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROTOCOL = ROOT / "scripts" / "zijin-round11-protocol.json"
DEFAULT_RUNNER = ROOT / "scripts" / "run_zijin_round4_experiments.py"
DEFAULT_STATE = ROOT / "public" / "research" / "zijin-automation-status.json"
DEFAULT_REPORT = ROOT / "public" / "research" / "zijin-round11-report.json"
GENESIS = "0" * 64


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_json(path: Path, fallback: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def refresh_idle_heartbeat(path: Path) -> None:
    value = load_json(path)
    if not isinstance(value, dict):
        return
    scheduler = value.get("scheduler")
    if not isinstance(scheduler, dict) or scheduler.get("status") != "idle":
        return
    now = iso()
    scheduler["heartbeatAt"] = now
    value["updatedAt"] = now
    atomic_json(path, value)


def fingerprint(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    stat = path.stat()
    return {"path": str(path.resolve()), "size": stat.st_size, "mtimeNs": stat.st_mtime_ns, "sha256": digest.hexdigest()}


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def append_history(path: Path, record: dict[str, Any]) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = GENESIS
    if path.exists():
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if lines:
            previous = json.loads(lines[-1])["recordHash"]
    prepared = {**record, "previousRecordHash": previous}
    prepared["recordHash"] = canonical_hash(prepared)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(prepared, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return prepared


def rabbit_state(stage: str, progress: int, child: dict[str, Any], report: dict[str, Any] | None = None) -> dict[str, Any]:
    latest = child.get("latest") if isinstance(child.get("latest"), dict) else {}
    report_total = len((report or {}).get("hypotheses", []))
    completed_hypotheses = int(latest.get("completedHypotheses", 0) or 0)
    total_hypotheses = int(latest.get("totalHypotheses", report_total or 4) or report_total or 4)
    qualified = len((report or {}).get("qualifiedHypothesisIds", []))
    # `waiting` is the normal daemon state after an already completed run.
    # It must not make the dashboard pretend that the training rabbit is busy.
    finished = stage in {"completed", "waiting"}
    if finished:
        completed_hypotheses = total_hypotheses
    failed = stage == "failed"
    return {
        "training": {
            "status": "failed" if failed else ("completed" if finished or stage == "rolling-oos" else "running"),
            "task": "读取封存数据并评估预登记参数" if not finished else "参数评估完成",
            "completed": completed_hypotheses,
            "total": total_hypotheses,
        },
        "challenger": {
            "status": "failed" if failed else ("completed" if finished else ("running" if stage == "rolling-oos" else "waiting")),
            "task": "滚动样本外验证；不读取2026" if not finished else "样本外验证已完成",
            "completed": completed_hypotheses,
            "total": total_hypotheses,
        },
        "risk": {
            "status": "failed" if failed else ("completed" if finished else "waiting"),
            "task": "核查费用、PBO、DSR与跨季度稳定性" if not finished else "风控门槛已审计",
            "completed": 1 if finished else 0,
            "total": 1,
        },
        "official": {
            "status": "qualified" if qualified else ("blocked" if finished else "locked"),
            "task": "仅允许合格模型进入影子观察" if not finished else ("存在合格候选，等待人工评审" if qualified else "没有模型获准晋级"),
            "completed": qualified,
            "total": total_hypotheses,
        },
        "overallProgress": max(0, min(100, int(progress))),
    }


def state_payload(
    *, status: str, reason: str, run_id: str | None, stage: str, progress: int,
    started_at: str | None, checked_at: str, next_check_at: str, data: dict[str, Any],
    protocol: dict[str, Any], child: dict[str, Any] | None = None,
    report: dict[str, Any] | None = None, last_run: dict[str, Any] | None = None,
    history_path: Path | None = None,
) -> dict[str, Any]:
    child = child or {}
    started = datetime.fromisoformat(started_at) if started_at else None
    elapsed = max(0, int((utc_now() - started).total_seconds())) if started else 0
    return {
        "schemaVersion": 1,
        "stock": {"code": "601899", "name": "紫金矿业"},
        "scheduler": {
            "enabled": True,
            "mode": "change-driven",
            "status": status,
            "reason": reason,
            "lastCheckAt": checked_at,
            "heartbeatAt": iso(),
            "nextCheckAt": next_check_at,
            "staleAfterSeconds": 120,
        },
        "run": {
            "id": run_id,
            "stage": stage,
            "progress": progress,
            "startedAt": started_at,
            "elapsedSeconds": elapsed,
            "currentTask": reason,
        },
        "input": {"data": data, "protocol": protocol, "sealed2026": True},
        "rabbits": rabbit_state(stage, progress, child, report),
        "lastRun": last_run,
        "history": {"path": str(history_path) if history_path else None, "appendOnly": True, "hashChained": True},
        "updatedAt": iso(),
    }


def lock_owner_id() -> str:
    return os.environ.get("HOSTNAME", "").strip() or socket.gethostname()


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def acquire_lock(path: Path, stale_seconds: int = 7200) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            fields = path.read_text(encoding="utf-8").strip().split()
            recorded_pid = int(fields[0]) if fields else -1
            recorded_owner = fields[2] if len(fields) >= 3 else None
            age = time.time() - path.stat().st_mtime
            abandoned = (
                recorded_owner is None
                or recorded_owner != lock_owner_id()
                or not process_exists(recorded_pid)
                or age > stale_seconds
            )
            if abandoned:
                path.unlink()
                return os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except (OSError, ValueError):
            pass
        raise RuntimeError("已有训练进程持有互斥锁")


def run_once(args: argparse.Namespace) -> int:
    checked = utc_now()
    next_check = checked + timedelta(minutes=args.interval_minutes)
    data_fp = fingerprint(args.input)
    protocol_fp = fingerprint(args.protocol)
    previous = load_json(args.state, {}) or {}
    last_run = previous.get("lastRun") if isinstance(previous, dict) else None
    unchanged = bool(
        last_run
        and last_run.get("dataSha256") == data_fp["sha256"]
        and last_run.get("protocolSha256") == protocol_fp["sha256"]
        and last_run.get("status") == "completed"
    )
    if unchanged and not args.force:
        atomic_json(args.state, state_payload(
            status="idle", reason="数据与实验协议没有变化，等待新样本或新假设", run_id=None,
            stage="waiting", progress=100, started_at=None, checked_at=iso(checked),
            next_check_at=iso(next_check), data=data_fp, protocol=protocol_fp,
            report=load_json(args.report), last_run=last_run, history_path=args.history,
        ))
        return 0

    lock_fd = acquire_lock(args.lock)
    run_id = utc_now().strftime("auto-%Y%m%dT%H%M%SZ")
    started_at = iso()
    run_dir = args.runtime / "runs" / run_id
    child_progress = run_dir / "progress.json"
    child_report = run_dir / "report.json"
    protocol_document = load_json(args.protocol, {}) or {}
    experiment_id = str(protocol_document.get("experimentId") or "zijin-experiment")
    safe_experiment_id = "".join(character if character.isalnum() or character in "-_" else "-" for character in experiment_id)
    ledger = args.runtime / "ledger" / f"{safe_experiment_id}-trials.jsonl"
    shared_runtime = args.runtime / "shared"
    run_dir.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, str(args.runner), str(args.input), "--protocol", str(args.protocol),
        "--runtime", str(shared_runtime), "--ledger", str(ledger),
        "--report", str(child_report), "--progress", str(child_progress),
    ]
    try:
        os.write(lock_fd, f"{os.getpid()} {run_id} {lock_owner_id()}\n".encode())
        atomic_json(args.state, state_payload(
            status="running", reason="训练兔正在载入封存数据", run_id=run_id, stage="loading", progress=1,
            started_at=started_at, checked_at=iso(checked), next_check_at=iso(next_check),
            data=data_fp, protocol=protocol_fp, last_run=last_run, history_path=args.history,
        ))
        process = subprocess.Popen(command, cwd=ROOT)
        while process.poll() is None:
            child = load_json(child_progress, {}) or {}
            stage = str(child.get("stage", "loading"))
            progress = int(child.get("progress", 1) or 1)
            message = str(child.get("message") or "训练进程运行中")
            atomic_json(args.state, state_payload(
                status="running", reason=message, run_id=run_id, stage=stage, progress=progress,
                started_at=started_at, checked_at=iso(checked), next_check_at=iso(next_check),
                data=data_fp, protocol=protocol_fp, child=child, last_run=last_run, history_path=args.history,
            ))
            time.sleep(max(1, args.heartbeat_seconds))
        if process.returncode:
            raise RuntimeError(f"训练子进程退出码 {process.returncode}")

        report = load_json(child_report)
        if not isinstance(report, dict):
            raise RuntimeError("训练完成但没有生成有效报告")
        args.report.parent.mkdir(parents=True, exist_ok=True)
        temporary_report = args.report.with_suffix(args.report.suffix + ".tmp")
        temporary_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary_report, args.report)
        completed_at = iso()
        last_run = {
            "id": run_id,
            "status": "completed",
            "startedAt": started_at,
            "completedAt": completed_at,
            "elapsedSeconds": report.get("elapsedSeconds"),
            "dataSha256": data_fp["sha256"],
            "protocolSha256": protocol_fp["sha256"],
            "qualifiedHypotheses": len(report.get("qualifiedHypothesisIds", [])),
            "ledgerRecords": report.get("ledger", {}).get("records"),
            "reportHash": canonical_hash(report),
        }
        append_history(args.history, last_run)
        atomic_json(args.state, state_payload(
            status="idle", reason="本轮完成；未自动晋级，等待新数据或新协议", run_id=run_id,
            stage="completed", progress=100, started_at=started_at, checked_at=iso(checked),
            next_check_at=iso(next_check), data=data_fp, protocol=protocol_fp,
            child=load_json(child_progress, {}) or {}, report=report, last_run=last_run, history_path=args.history,
        ))
        return 0
    except Exception as error:
        failed_run = {
            "id": run_id, "status": "failed", "startedAt": started_at, "completedAt": iso(),
            "dataSha256": data_fp["sha256"], "protocolSha256": protocol_fp["sha256"], "error": str(error),
        }
        append_history(args.history, failed_run)
        atomic_json(args.state, state_payload(
            status="failed", reason=str(error), run_id=run_id, stage="failed", progress=0,
            started_at=started_at, checked_at=iso(checked), next_check_at=iso(next_check),
            data=data_fp, protocol=protocol_fp, last_run=failed_run, history_path=args.history,
        ))
        return 1
    finally:
        os.close(lock_fd)
        try:
            args.lock.unlink()
        except FileNotFoundError:
            pass


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Continuous, change-driven Zijin experiment scheduler")
    value.add_argument("input", type=Path)
    value.add_argument("--protocol", type=Path, default=DEFAULT_PROTOCOL)
    value.add_argument("--runner", type=Path, default=DEFAULT_RUNNER)
    value.add_argument("--state", type=Path, default=DEFAULT_STATE)
    value.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    value.add_argument("--runtime", type=Path, default=ROOT / ".zijin-auto-runtime")
    value.add_argument("--history", type=Path)
    value.add_argument("--lock", type=Path)
    value.add_argument("--interval-minutes", type=int, default=30)
    value.add_argument("--heartbeat-seconds", type=int, default=5)
    value.add_argument("--idle-heartbeat-seconds", type=int, default=30)
    value.add_argument("--force", action="store_true")
    value.add_argument("--daemon", action="store_true")
    value.add_argument("--dry-run", action="store_true")
    return value


def main() -> None:
    args = parser().parse_args()
    args.input = args.input.resolve()
    args.protocol = args.protocol.resolve()
    args.runner = args.runner.resolve()
    args.state = args.state.resolve()
    args.report = args.report.resolve()
    args.runtime = args.runtime.resolve()
    args.history = (args.history or args.runtime / "run-history.jsonl").resolve()
    args.lock = (args.lock or args.runtime / "trainer.lock").resolve()
    if args.dry_run:
        print(json.dumps({
            "valid": args.input.exists() and args.protocol.exists() and args.runner.exists(),
            "mode": "change-driven", "automaticPromotion": False, "sealed2026": True,
            "input": str(args.input), "state": str(args.state), "intervalMinutes": args.interval_minutes,
        }, ensure_ascii=False, indent=2))
        return
    while True:
        code = run_once(args)
        if not args.daemon:
            raise SystemExit(code)
        remaining = max(60, args.interval_minutes * 60)
        idle_heartbeat = max(10, args.idle_heartbeat_seconds)
        while remaining > 0:
            pause = min(idle_heartbeat, remaining)
            time.sleep(pause)
            remaining -= pause
            refresh_idle_heartbeat(args.state)


if __name__ == "__main__":
    main()
