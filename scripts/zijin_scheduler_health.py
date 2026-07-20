#!/usr/bin/env python3
"""Shared health rules for the Zijin scheduler and its Docker supervisor."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def scheduler_health(
    state: dict[str, Any] | None,
    *,
    now: datetime | None = None,
    idle_grace_seconds: int = 180,
) -> tuple[bool, str]:
    now = now or datetime.now(timezone.utc)
    scheduler = (state or {}).get("scheduler")
    if not isinstance(scheduler, dict):
        return False, "训练状态文件不存在或缺少 scheduler"
    if scheduler.get("enabled") is False:
        return False, "训练调度器已禁用"

    status = str(scheduler.get("status") or "unknown")
    reason = str(scheduler.get("reason") or "")
    if status == "failed":
        return False, reason or "训练调度器报告失败"

    heartbeat = parse_time(scheduler.get("heartbeatAt"))
    if heartbeat is None:
        return False, "训练调度器没有有效心跳"

    stale_after = max(30, int(scheduler.get("staleAfterSeconds") or 120))
    heartbeat_age = (now - heartbeat).total_seconds()
    if status == "running":
        if heartbeat_age > stale_after:
            return False, f"训练中心跳超时 {int(heartbeat_age)} 秒"
        return True, "训练任务运行正常"

    next_check = parse_time(scheduler.get("nextCheckAt"))
    if next_check is None:
        return False, "等待状态缺少下一次检查时间"
    overdue = (now - next_check).total_seconds()
    if overdue > max(30, idle_grace_seconds):
        return False, f"自动检查逾期 {int(overdue)} 秒"
    return True, "调度器在线，等待数据或实验协议变化"
