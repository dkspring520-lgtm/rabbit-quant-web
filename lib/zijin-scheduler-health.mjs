function parseTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return Date.parse(normalized);
}

export function evaluateZijinSchedulerHealth(scheduler, nowMs = Date.now()) {
  const enabled = Boolean(scheduler?.enabled);
  const heartbeatMs = parseTimestamp(scheduler?.heartbeatAt);
  const nextCheckMs = parseTimestamp(scheduler?.nextCheckAt);
  const staleAfterSeconds = Math.max(30, Number(scheduler?.staleAfterSeconds) || 120);
  const staleAfterMs = staleAfterSeconds * 1000;
  const heartbeatAgeSeconds = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.floor((nowMs - heartbeatMs) / 1000))
    : null;

  if (!enabled) {
    return {
      status: "disabled",
      label: "自动训练未启用",
      detail: "当前只展示已经审计的历史训练结果。",
      heartbeatAgeSeconds,
      overdueSeconds: 0,
    };
  }

  if (scheduler?.status === "failed") {
    return {
      status: "failed",
      label: "自动训练运行失败",
      detail: String(scheduler?.reason || "请检查服务器训练日志。"),
      heartbeatAgeSeconds,
      overdueSeconds: 0,
    };
  }

  const heartbeatExpired = !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > staleAfterMs;
  if (scheduler?.status === "running") {
    return heartbeatExpired
      ? {
          status: "offline",
          label: "训练心跳超时",
          detail: "任务曾处于运行状态，但服务器已超过允许时间没有上报心跳。",
          heartbeatAgeSeconds,
          overdueSeconds: heartbeatAgeSeconds === null ? 0 : Math.max(0, heartbeatAgeSeconds - staleAfterSeconds),
        }
      : {
          status: "running",
          label: "正在训练",
          detail: String(scheduler?.reason || "服务器正在执行本轮实验。"),
          heartbeatAgeSeconds,
          overdueSeconds: 0,
        };
  }

  const missedScheduledCheck = Number.isFinite(nextCheckMs) && nowMs > nextCheckMs + staleAfterMs;
  if (missedScheduledCheck || !Number.isFinite(heartbeatMs)) {
    const overdueSeconds = Number.isFinite(nextCheckMs)
      ? Math.max(0, Math.floor((nowMs - nextCheckMs) / 1000))
      : 0;
    return {
      status: "offline",
      label: "自动调度器离线",
      detail: "上一轮已经结束，但后台没有按计划继续检查新数据或新实验。",
      heartbeatAgeSeconds,
      overdueSeconds,
    };
  }

  return {
    status: "waiting",
    label: "在线等待新数据",
    detail: String(scheduler?.reason || "数据或实验协议变化后自动启动下一轮。"),
    heartbeatAgeSeconds,
    overdueSeconds: 0,
  };
}
