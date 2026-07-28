import { evaluateZijinRepairCandidate } from "./zijin-repair-candidate.mjs";

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function dateKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

function minuteKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function normalizeZijinL2ReplayPayload(payload, requestedDate) {
  const date = dateKey(requestedDate);
  const rows = Array.isArray(payload?.minutes)
    ? payload.minutes
    : Array.isArray(payload?.recentMinutes)
      ? payload.recentMinutes
      : [];
  if (!date) return { available: false, date: null, minutes: [], reason: "交易日格式无效" };
  const minutes = rows
    .filter(row => dateKey(row?.exchangeMinute ?? payload?.lastExchangeTime) === date)
    .map(row => ({
      ...row,
      time: minuteKey(row?.time ?? row?.exchangeMinute),
      exchangeMinute: `${date}-${minuteKey(row?.time ?? row?.exchangeMinute)}`,
    }))
    .filter(row => row.time)
    .sort((left, right) => left.time.localeCompare(right.time));
  return {
    schemaVersion: 1,
    symbol: "601899",
    date,
    available: minutes.length > 0,
    minutes,
    reason: minutes.length ? null : "本交易日未保存历史L2分钟快照",
  };
}

export function mergeZijinL2ReplayMinutes(marketMinutes, l2Minutes, date) {
  const normalizedDate = dateKey(date);
  const l2ByTime = new Map((Array.isArray(l2Minutes) ? l2Minutes : [])
    .map(row => [minuteKey(row?.time ?? row?.exchangeMinute), row])
    .filter(([time]) => time));
  return (Array.isArray(marketMinutes) ? marketMinutes : []).map(row => {
    const time = minuteKey(row?.time);
    const l2 = l2ByTime.get(time);
    return {
      ...row,
      ...(l2 ?? {}),
      time,
      exchangeMinute: normalizedDate && time ? `${normalizedDate}-${time}` : l2?.exchangeMinute,
      price: finite(row?.price) ?? finite(l2?.price),
      volume: finite(row?.volume) ?? finite(l2?.volume) ?? 0,
      amount: finite(row?.amount) ?? finite(l2?.amount) ?? 0,
      averagePrice: finite(row?.averagePrice) ?? finite(l2?.averagePrice),
      l2Status: l2 ? { connected: true, authorized: true, stale: false } : undefined,
    };
  }).filter(row => row.time && row.price > 0);
}

export function buildZijinL2CausalReplayObservations(minutes) {
  const observations = [];
  const seen = new Set();
  for (let index = 0; index < (Array.isArray(minutes) ? minutes.length : 0); index += 1) {
    const evaluation = evaluateZijinRepairCandidate(minutes.slice(0, index + 1));
    if (evaluation.status !== "candidate" || !evaluation.candidateKey || seen.has(evaluation.candidateKey)) continue;
    seen.add(evaluation.candidateKey);
    const price = finite(evaluation.metrics?.price) ?? finite(minutes[index]?.price) ?? 0;
    observations.push({
      time: evaluation.asOfTime,
      price,
      direction: "正T",
      score: evaluation.score,
      threshold: 70,
      edge: Math.max(0, finite(evaluation.metrics?.extensionFromSecondLowPct) ?? 0),
      executable: false,
      stage: "candidate",
      coverageOnly: true,
      confirmationLabel: "L2修复",
      blockers: ["研究候选：仍需正式策略、成本与账户风控确认"],
      reason: evaluation.reasons.join(" "),
      l2Strict: true,
      candidateKey: evaluation.candidateKey,
    });
  }
  return observations;
}
