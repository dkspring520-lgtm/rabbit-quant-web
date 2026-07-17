import { isAShareRegularTradingMinute } from "./intraday-axis.mjs";

export const ZIJIN_FACTOR_RESEARCH = Object.freeze({
  code: "601899",
  horizonMinutes: 10,
  estimatedRoundTripCostPct: 0.12,
  minimumLivePoints: 20,
  validationRatio: 0.30,
});

const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));
const percent = (value, base) => base > 0 ? ((value - base) / base) * 100 : 0;

function sanitizeMinutes(minutes) {
  const seen = new Map();
  for (const minute of Array.isArray(minutes) ? minutes : []) {
    const time = String(minute?.time || "").replace(/:/g, "").slice(0, 4);
    const price = Number(minute?.price);
    const volume = Math.max(0, Number(minute?.volume) || 0);
    if (!isAShareRegularTradingMinute(time) || !Number.isFinite(price) || price <= 0) continue;
    seen.set(time, { time, price, volume });
  }
  return [...seen.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function factorSnapshot(minutes, previousClose = null) {
  const points = sanitizeMinutes(minutes);
  if (!points.length) return {
    asOfTime: null, points: 0, price: null, vwap: null, vwapBiasPct: 0,
    momentum3Pct: 0, volumeRatio: null, rangePct: 0, direction: null,
    directionLabel: null, score: 0, status: "waiting", label: "等待真实分钟数据",
  };

  const latest = points.at(-1);
  const totalVolume = points.reduce((sum, point) => sum + point.volume, 0);
  const vwap = totalVolume > 0
    ? points.reduce((sum, point) => sum + point.price * point.volume, 0) / totalVolume
    : average(points.map(point => point.price));
  const high = Math.max(...points.map(point => point.price));
  const low = Math.min(...points.map(point => point.price));
  const reference = Number(previousClose) > 0 ? Number(previousClose) : points[0].price;
  const momentumBase = points[Math.max(0, points.length - 4)].price;
  const recentVolumes = points.slice(-3).map(point => point.volume).filter(Boolean);
  const baselineVolumes = points.slice(Math.max(0, points.length - 23), -3).map(point => point.volume).filter(Boolean);
  const volumeRatio = recentVolumes.length && baselineVolumes.length
    ? average(recentVolumes) / average(baselineVolumes)
    : null;
  const vwapBiasPct = percent(latest.price, vwap);
  const momentum3Pct = percent(latest.price, momentumBase);
  const rangePct = reference > 0 ? ((high - low) / reference) * 100 : 0;

  const positiveScore = Math.min(100,
    Math.max(0, -vwapBiasPct) * 72
    + Math.max(0, momentum3Pct) * 95
    + Math.max(0, (volumeRatio || 0) - 0.85) * 22
    + Math.min(rangePct, 2) * 8,
  );
  const reverseScore = Math.min(100,
    Math.max(0, vwapBiasPct) * 72
    + Math.max(0, -momentum3Pct) * 95
    + Math.max(0, (volumeRatio || 0) - 0.85) * 22
    + Math.min(rangePct, 2) * 8,
  );
  const direction = positiveScore >= reverseScore ? "positive" : "reverse";
  const directionLabel = direction === "positive" ? "正T" : "反T";
  const score = Math.round(Math.max(positiveScore, reverseScore));
  const enough = points.length >= ZIJIN_FACTOR_RESEARCH.minimumLivePoints;
  const biasConfirmed = direction === "positive" ? vwapBiasPct <= -0.35 : vwapBiasPct >= 0.35;
  const turnConfirmed = direction === "positive" ? momentum3Pct >= 0.08 : momentum3Pct <= -0.08;
  const volumeConfirmed = volumeRatio !== null && volumeRatio >= 1.05;
  const status = enough && biasConfirmed && turnConfirmed && volumeConfirmed ? "candidate" : enough ? "watch" : "waiting";
  const label = status === "candidate"
    ? `${directionLabel}因子组合待验证`
    : status === "watch"
      ? `${directionLabel}方向继续观察`
      : `已积累 ${points.length}/${ZIJIN_FACTOR_RESEARCH.minimumLivePoints} 个分钟点`;

  return {
    asOfTime: latest.time,
    points: points.length,
    price: round(latest.price),
    vwap: round(vwap),
    vwapBiasPct: round(vwapBiasPct),
    momentum3Pct: round(momentum3Pct),
    volumeRatio: volumeRatio === null ? null : round(volumeRatio),
    rangePct: round(rangePct),
    direction,
    directionLabel,
    score,
    status,
    label,
  };
}

function buildCompletedSamples(sessions) {
  const samples = [];
  const ordered = [...(Array.isArray(sessions) ? sessions : [])]
    .filter(session => Array.isArray(session?.minutes) && session.minutes.length >= 60)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));

  for (const session of ordered) {
    const minutes = sanitizeMinutes(session.minutes);
    for (let index = ZIJIN_FACTOR_RESEARCH.minimumLivePoints - 1;
      index + ZIJIN_FACTOR_RESEARCH.horizonMinutes < minutes.length;
      index += 10) {
      const prefix = minutes.slice(0, index + 1);
      const snapshot = factorSnapshot(prefix, session.previousClose);
      if (snapshot.status !== "candidate" || !snapshot.direction) continue;
      const future = minutes[index + ZIJIN_FACTOR_RESEARCH.horizonMinutes];
      const rawMovePct = percent(future.price, minutes[index].price);
      const directionalMovePct = snapshot.direction === "positive" ? rawMovePct : -rawMovePct;
      const netMovePct = directionalMovePct - ZIJIN_FACTOR_RESEARCH.estimatedRoundTripCostPct;
      samples.push({
        date: String(session.date || ""),
        time: minutes[index].time,
        direction: snapshot.direction,
        netMovePct,
        success: netMovePct > 0,
      });
    }
  }
  return { sessions: ordered.length, samples };
}

export function analyzeZijinFactorResearch({ sessions = [], liveMinutes = [], previousClose = null } = {}) {
  const live = factorSnapshot(liveMinutes, previousClose);
  const completed = buildCompletedSamples(sessions);
  const splitIndex = Math.max(0, Math.floor(completed.samples.length * (1 - ZIJIN_FACTOR_RESEARCH.validationRatio)));
  const training = completed.samples.slice(0, splitIndex);
  const validation = completed.samples.slice(splitIndex);
  const validationWins = validation.filter(sample => sample.success).length;
  const validationNetAveragePct = validation.length ? average(validation.map(sample => sample.netMovePct)) : 0;
  const ready = completed.sessions >= 30 && validation.length >= 30;

  return {
    mode: "research-only",
    affectsV4: false,
    live,
    evidence: {
      sessions: completed.sessions,
      samples: completed.samples.length,
      trainingSamples: training.length,
      validationSamples: validation.length,
      validationWins,
      validationWinRate: validation.length ? validationWins / validation.length : null,
      validationNetAveragePct: round(validationNetAveragePct),
      ready,
      label: ready ? "具备初步样本外评审条件" : "样本积累中，不输出可用模型",
    },
  };
}

export { factorSnapshot as calculateZijinFactorSnapshot };
