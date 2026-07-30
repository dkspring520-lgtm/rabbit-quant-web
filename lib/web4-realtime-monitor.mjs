const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const riskLevel = value => ["restricted", "locked"].includes(value);

/**
 * WEB 4.0 realtime monitor.
 *
 * The fast path is deliberately deterministic. Technical analysis may open a
 * candidate, but it cannot promote itself to a confirmed multi-source state.
 * L2 flow, A/H linkage and external/event risk provide independent evidence.
 */
export function evaluateWeb4RealtimeMonitor({
  symbol = "",
  now = null,
  technical = {},
  l2 = {},
  linkage = {},
  market = {},
  events = {},
} = {}) {
  const direction = technical.direction === "反T" ? "反T" : technical.direction === "正T" ? "正T" : null;
  const candidate = Boolean(technical.candidate || technical.ready);
  const technicalScore = clamp(
    technical.ready ? 88 : candidate ? 58 + Math.min(18, Math.max(0, finite(technical.confirmed) ?? 0) * 4) : 24,
  );

  const l2Available = Boolean(l2.available);
  const l2Fresh = l2Available && !l2.stale;
  const l2State = String(l2.state ?? "waiting");
  const l2Score = clamp(finite(l2.score) ?? 0);
  const l2Buy = ["push", "accumulation", "repair", "confirmed_buy", "absorption_buy"].includes(l2State);
  const l2Sell = ["outflow", "absorbed", "confirmed_sell", "absorption_sell"].includes(l2State);
  const l2Supports = direction === "正T"
    ? l2Buy && l2Score >= 55
    : direction === "反T"
      ? l2Sell && l2Score >= 55
      : false;
  const l2Conflicts = direction === "正T" ? l2Sell && l2Score >= 60 : direction === "反T" ? l2Buy && l2Score >= 65 : false;

  const linkageAvailable = Boolean(linkage.available);
  const linkageBias = linkage.bias === "buy" ? "正T" : linkage.bias === "sell" ? "反T" : null;
  const linkageSupports = Boolean(direction && linkageBias === direction);
  const linkageConflicts = Boolean(direction && linkageBias && linkageBias !== direction && Math.abs(finite(linkage.weight) ?? 0) >= 6);

  const marketLevel = String(market.level ?? "degraded");
  const eventLevel = String(events.level ?? "normal");
  const hardRisk = Boolean(market.hardLock || events.hardLock || marketLevel === "locked" || eventLevel === "locked");
  const restricted = riskLevel(marketLevel) || riskLevel(eventLevel);
  const externalHealthy = !hardRisk && !restricted && marketLevel !== "degraded";

  const votes = [
    {
      id: "technical",
      label: "技术候选",
      state: candidate ? "support" : "waiting",
      detail: candidate ? `${direction ?? "方向待定"} · ${Math.round(technicalScore)}分` : "尚未进入候选区",
    },
    {
      id: "l2",
      label: "L2资金",
      state: !l2Fresh ? "missing" : l2Conflicts ? "conflict" : l2Supports ? "support" : "waiting",
      detail: !l2Available ? "无L2数据" : l2.stale ? "数据延迟" : `${l2.label ?? "资金待确认"} · ${Math.round(l2Score)}分`,
    },
    {
      id: "linkage",
      label: symbol === "601899" ? "A/H联动" : "关联品种",
      state: !linkageAvailable ? "missing" : linkageConflicts ? "conflict" : linkageSupports ? "support" : "waiting",
      detail: linkage.label ?? (linkageAvailable ? "方向接近" : "等待同步"),
    },
    {
      id: "external",
      label: "环境事件",
      state: hardRisk || restricted ? "conflict" : externalHealthy ? "support" : "waiting",
      detail: events.label && events.label !== "事件正常"
        ? `${market.label ?? "环境"} · ${events.label}`
        : market.label ?? "等待外部环境",
    },
  ];

  const nonTechnicalSupport = votes.slice(1).filter(vote => vote.state === "support").length;
  const conflicts = votes.filter(vote => vote.state === "conflict");
  const missing = votes.filter(vote => vote.state === "missing");
  const blockers = [];
  if (!candidate) blockers.push("技术面尚未形成候选");
  if (!l2Fresh) blockers.push(l2Available ? "L2数据延迟" : "L2资金证据缺失");
  if (l2Conflicts) blockers.push("L2资金方向与技术候选冲突");
  if (linkageConflicts) blockers.push("A/H或关联品种方向冲突");
  if (restricted) blockers.push("外部市场或事件风险限制");
  if (candidate && nonTechnicalSupport < 2) blockers.push("非技术证据不足2项");

  let status = "scanning";
  let label = "多源扫描中";
  if (hardRisk) {
    status = "risk";
    label = "风险锁定";
  } else if (missing.length >= 2 || !l2Fresh) {
    status = "degraded";
    label = candidate ? "候选降级观察" : "数据降级";
  } else if (conflicts.length) {
    status = "conflict";
    label = "证据冲突";
  } else if (candidate && nonTechnicalSupport >= 2 && technical.ready && l2Supports) {
    status = "confirmed";
    label = `${direction}多源确认`;
  } else if (candidate && nonTechnicalSupport >= 1) {
    status = "confirming";
    label = `${direction ?? ""}资金确认中`;
  } else if (candidate) {
    status = "candidate";
    label = `${direction ?? ""}技术候选`;
  }

  const confidence = Math.round(clamp(
    technicalScore * .34
      + (l2Fresh ? l2Score : 12) * .34
      + (linkageSupports ? 78 : linkageConflicts ? 18 : linkageAvailable ? 48 : 26) * .14
      + (externalHealthy ? 78 : restricted ? 20 : 42) * .18
      - conflicts.length * 12
      - missing.length * 5,
  ));
  const formalEligible = status === "confirmed" && confidence >= 60;

  return {
    version: "WEB 4.0",
    status,
    label,
    direction,
    confidence,
    formalEligible,
    candidate,
    nonTechnicalSupport,
    votes,
    blockers: blockers.slice(0, 3),
    asOf: now ?? new Date().toISOString(),
    summary: formalEligible
      ? "技术、资金与外部证据已形成同向确认"
      : blockers[0] ?? "等待独立证据共同确认",
  };
}
