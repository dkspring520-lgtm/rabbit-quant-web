const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

const STATE_RANK = {
  discovered: 1,
  confirming: 2,
  "waiting-pullback": 3,
  "waiting-retest": 3,
  "positive-t-confirmed": 4,
  "reverse-t-confirmed": 4,
  "repair-confirmed": 4,
  absorbed: 4,
  invalid: 4,
  expired: 4,
};

const MATERIAL_STATES = new Set(Object.keys(STATE_RANK));

function normalizeMinute(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 12) return digits.slice(0, 12);
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function marketDate(value, fallback = null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : fallback;
}

function observationMinute(date, value) {
  const minute = normalizeMinute(value);
  if (!minute) return null;
  return minute.length === 12 ? minute : `${date}${minute}`;
}

function minuteIndex(value) {
  const minute = normalizeMinute(value);
  if (!minute) return null;
  const hhmm = minute.slice(-4);
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2));
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function scoreBand(score) {
  if (score >= 85) return "85+";
  if (score >= 75) return "75-84";
  if (score >= 65) return "65-74";
  if (score >= 50) return "50-64";
  return "0-49";
}

export function buildZijinL2Observation({
  evaluation,
  structure,
  exchangeMinute,
  observedAt = new Date().toISOString(),
} = {}) {
  const machine = evaluation?.stateMachine;
  if (!evaluation?.ready || !machine || !MATERIAL_STATES.has(machine.state) || !machine.eventTime) return null;
  const date = marketDate(exchangeMinute);
  if (!date) return null;
  const eventMinute = observationMinute(date, machine.eventTime);
  const decisionMinute = observationMinute(date, evaluation.asOfTime ?? exchangeMinute);
  if (!eventMinute || !decisionMinute) return null;
  const side = machine.side ?? evaluation.side;
  if (!["buy", "sell"].includes(side)) return null;
  const eventId = `601899:${eventMinute}:${side}`;
  return {
    schemaVersion: 1,
    observationId: `${eventId}:${machine.state}`,
    eventId,
    symbol: "601899",
    marketDate: date,
    eventMinute,
    decisionMinute,
    observedAt,
    state: machine.state,
    side,
    researchOnly: true,
    executable: false,
    featureSnapshot: {
      score: finite(evaluation.score) ?? 0,
      scoreBand: scoreBand(finite(evaluation.score) ?? 0),
      abnormality: finite(evaluation.abnormality),
      baseline: finite(evaluation.baseline),
      baselineSource: evaluation.baselineSource ?? null,
      netNotional: finite(evaluation.netNotional),
      activeNetNotional: finite(evaluation.activeNetNotional),
      priceImpactPct: finite(evaluation.priceImpactPct),
      absorption: Boolean(evaluation.absorption),
      inverseAbsorption: Boolean(evaluation.inverseAbsorption),
      directionConflict: Boolean(evaluation.directionConflict),
      highLevelLure: Boolean(evaluation.highLevelLure),
      components: evaluation.components ?? null,
      unavailable: Array.isArray(evaluation.unavailable) ? evaluation.unavailable : [],
      eventAgeMinutes: finite(machine.ageMinutes),
      eventPrice: finite(machine.costPrice),
      triggerPrice: finite(machine.triggerPrice),
      pricePushPct: finite(machine.pricePushPct),
      pullbackPct: finite(machine.pullbackPct),
      costHeld: machine.costHeld ?? null,
      referenceRecovered: machine.referenceRecovered ?? null,
      structure: structure ? {
        asOfTime: structure.asOfTime ?? null,
        directionScore: finite(structure.directionScore),
        coverage: finite(structure.coverage),
        vwap: finite(structure.vwap),
        biasPct: finite(structure.biasPct),
        support: finite(structure.support),
        resistance: finite(structure.resistance),
        permissions: structure.permissions ?? null,
        chan: structure.chan ?? null,
        wyckoff: structure.wyckoff ?? null,
      } : null,
    },
  };
}

export function buildZijinRepairObservation({
  repair,
  exchangeMinute,
  observedAt = new Date().toISOString(),
} = {}) {
  if (repair?.status !== "candidate" || !repair?.candidateKey) return null;
  const date = marketDate(exchangeMinute);
  if (!date) return null;
  const eventMinute = observationMinute(date, repair.metrics?.secondLow?.time);
  const decisionMinute = observationMinute(date, repair.asOfTime ?? exchangeMinute);
  if (!eventMinute || !decisionMinute) return null;
  const eventId = `601899:${eventMinute}:buy:repair`;
  return {
    schemaVersion: 1,
    observationId: `${eventId}:repair-confirmed`,
    eventId,
    symbol: "601899",
    marketDate: date,
    eventMinute,
    decisionMinute,
    observedAt,
    state: "repair-confirmed",
    side: "buy",
    researchOnly: true,
    executable: false,
    featureSnapshot: {
      score: finite(repair.score) ?? 0,
      scoreBand: scoreBand(finite(repair.score) ?? 0),
      triggerPrice: finite(repair.metrics?.price),
      eventPrice: finite(repair.metrics?.secondLow?.price),
      vwap: finite(repair.metrics?.vwap),
      vwapBiasPct: finite(repair.metrics?.vwapBiasPct),
      deepestBiasPct: finite(repair.metrics?.deepestBiasPct),
      momentum3Pct: finite(repair.metrics?.momentum3Pct),
      pullbackVolumeRatio: finite(repair.metrics?.pullbackVolumeRatio),
      activeBuyRatio: finite(repair.metrics?.activeBuyRatio),
      netActiveNotional: finite(repair.metrics?.netActiveNotional),
      bigOrderNet: finite(repair.metrics?.bigOrderNet),
      firstLow: repair.metrics?.firstLow ?? null,
      secondLow: repair.metrics?.secondLow ?? null,
      breakoutPrice: finite(repair.metrics?.breakoutPrice),
      checks: repair.checks ?? null,
      hardConditions: repair.hardConditions ?? null,
    },
  };
}

export function decideZijinL2Append(existing = [], candidate = null) {
  if (!candidate) return { append: false, reason: "idle" };
  if (existing.some(item => item?.observationId === candidate.observationId)) {
    return { append: false, reason: "duplicate-state" };
  }
  const previous = [...existing].reverse().find(item => item?.eventId === candidate.eventId);
  if (!previous) return { append: true, reason: "new-event" };
  const previousRank = STATE_RANK[previous.state] ?? 0;
  const nextRank = STATE_RANK[candidate.state] ?? 0;
  if (previousRank >= 4) return { append: false, reason: "event-terminal" };
  if (nextRank < previousRank) return { append: false, reason: "state-regression" };
  if (nextRank === previousRank && previous.state !== candidate.state) {
    return { append: false, reason: "same-stage-churn" };
  }
  return { append: true, reason: "state-advanced" };
}

function normalizeRows(minutes) {
  return (Array.isArray(minutes) ? minutes : []).map(row => {
    const date = marketDate(row?.exchangeMinute);
    const minute = observationMinute(date, row?.exchangeMinute ?? row?.time);
    const price = finite(row?.price ?? row?.close);
    return { minute, index: minuteIndex(minute), date, price };
  }).filter(row => row.minute && row.date && row.index != null && row.price > 0);
}

export function buildMatureZijinL2Labels({
  observations = [],
  existingLabels = [],
  minutes = [],
  horizons = [5, 15, 30],
  costPct = 0.46,
  labeledAt = new Date().toISOString(),
} = {}) {
  const rows = normalizeRows(minutes);
  const existing = new Set(existingLabels.map(item => item?.labelId).filter(Boolean));
  const labels = [];
  for (const observation of observations) {
    const decisionIndex = minuteIndex(observation?.decisionMinute);
    const date = observation?.marketDate;
    const anchorRow = [...rows].reverse().find(row => row.date === date && row.index <= decisionIndex);
    if (!anchorRow) continue;
    const anchorPrice = finite(observation?.featureSnapshot?.triggerPrice)
      ?? finite(observation?.featureSnapshot?.eventPrice)
      ?? anchorRow.price;
    if (!(anchorPrice > 0)) continue;
    for (const horizon of horizons) {
      const labelId = `${observation.observationId}:${horizon}m`;
      if (existing.has(labelId)) continue;
      const endIndex = decisionIndex + horizon;
      const future = rows.filter(row => row.date === date && row.index > decisionIndex && row.index <= endIndex);
      if (!future.length || future.at(-1).index < endIndex) continue;
      const prices = future.map(row => row.price);
      const maxUpPct = (Math.max(...prices) - anchorPrice) / anchorPrice * 100;
      const maxDownPct = (Math.min(...prices) - anchorPrice) / anchorPrice * 100;
      const terminalPct = (future.at(-1).price - anchorPrice) / anchorPrice * 100;
      const positiveSide = observation.side === "buy";
      const favorablePct = positiveSide ? maxUpPct : -maxDownPct;
      const adversePct = positiveSide ? -maxDownPct : maxUpPct;
      labels.push({
        schemaVersion: 1,
        labelId,
        observationId: observation.observationId,
        eventId: observation.eventId,
        symbol: "601899",
        marketDate: date,
        decisionMinute: observation.decisionMinute,
        horizonMinutes: horizon,
        labeledAt,
        anchorPrice,
        maxUpPct,
        maxDownPct,
        terminalPct,
        favorablePct,
        adversePct,
        reachedCost: favorablePct >= costPct,
        netDirectionalWin: favorablePct - costPct > adversePct,
        costPct,
        causal: true,
      });
    }
  }
  return labels;
}

export function summarizeZijinL2Audit({
  observations = [],
  labels = [],
  suppressedRepeats = 0,
  updatedAt = new Date().toISOString(),
  minimumConfirmedEvents = 50,
  minimumTradingDays = 5,
} = {}) {
  const confirmedStates = new Set(["positive-t-confirmed", "reverse-t-confirmed", "repair-confirmed"]);
  const confirmed = observations.filter(item => confirmedStates.has(item?.state));
  const days = new Set(observations.map(item => item?.marketDate).filter(Boolean));
  const byState = {};
  const byScoreBand = {};
  for (const item of observations) byState[item.state] = (byState[item.state] ?? 0) + 1;
  for (const item of labels) {
    const observation = observations.find(row => row.observationId === item.observationId);
    const band = observation?.featureSnapshot?.scoreBand ?? "unknown";
    const bucket = byScoreBand[band] ?? { labels: 0, reachedCost: 0, directionalWins: 0 };
    bucket.labels += 1;
    bucket.reachedCost += item.reachedCost ? 1 : 0;
    bucket.directionalWins += item.netDirectionalWin ? 1 : 0;
    byScoreBand[band] = bucket;
  }
  for (const bucket of Object.values(byScoreBand)) {
    bucket.costReachRate = bucket.labels ? bucket.reachedCost / bucket.labels : null;
    bucket.directionalWinRate = bucket.labels ? bucket.directionalWins / bucket.labels : null;
  }
  const calibrationByHorizon = {};
  for (const horizon of [5, 15, 30]) {
    const bucket = labels.filter(item => Number(item?.horizonMinutes) === horizon);
    const bucketDays = new Set(bucket.map(item => item?.marketDate).filter(Boolean)).size;
    const wins = bucket.filter(item => item?.netDirectionalWin).length;
    const probabilityReady = bucket.length >= 30 && bucketDays >= 5;
    calibrationByHorizon[`${horizon}m`] = {
      samples: bucket.length,
      tradingDays: bucketDays,
      costReached: bucket.filter(item => item?.reachedCost).length,
      directionalWins: wins,
      calibratedWinProbability: probabilityReady ? (wins + 1) / (bucket.length + 2) : null,
      probabilityReady,
      status: probabilityReady ? "sample-ready-for-review" : "collecting-forward-samples",
    };
  }
  const ready = confirmed.length >= minimumConfirmedEvents && days.size >= minimumTradingDays;
  return {
    schemaVersion: 1,
    symbol: "601899",
    updatedAt,
    researchOnly: true,
    automaticPromotion: false,
    affectsFormalV4: false,
    observations: observations.length,
    uniqueEvents: new Set(observations.map(item => item.eventId)).size,
    tradingDays: days.size,
    confirmedEvents: confirmed.length,
    labels: labels.length,
    suppressedRepeats,
    byState,
    byScoreBand,
    calibrationByHorizon,
    readiness: {
      ready,
      minimumConfirmedEvents,
      minimumTradingDays,
      reason: ready
        ? "证据达到人工复核门槛，仍需样本外验证"
        : `继续积累真实L2事件：确认事件 ${confirmed.length}/${minimumConfirmedEvents}，交易日 ${days.size}/${minimumTradingDays}`,
    },
    thresholdRecommendation: ready ? "manual-review-required" : "keep-current-thresholds",
  };
}
