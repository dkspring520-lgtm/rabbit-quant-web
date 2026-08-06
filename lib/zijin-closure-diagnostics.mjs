const LOSS_EPSILON = 0.000001;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emptySlice() {
  return {
    cycles: 0,
    wins: 0,
    losses: 0,
    net: 0,
    gross: 0,
    fees: 0,
    executionCost: 0,
    holdingMinutes: 0,
  };
}

function addSlice(target, key, cycle) {
  const bucket = target[key] ?? emptySlice();
  bucket.cycles += 1;
  bucket.wins += cycle.net > 0 ? 1 : 0;
  bucket.losses += cycle.net < 0 ? 1 : 0;
  bucket.net += cycle.net;
  bucket.gross += cycle.gross;
  bucket.fees += cycle.fees;
  bucket.executionCost += cycle.executionCost;
  bucket.holdingMinutes += cycle.holdingMinutes;
  target[key] = bucket;
}

export function classifyClosureExit(reason = "") {
  const normalized = String(reason).toLowerCase();
  if (normalized.includes("止盈") || normalized.includes("profit")) return "take-profit";
  if (normalized.includes("止损") || normalized.includes("stop")) return "stop";
  if (normalized.includes("时间") || normalized.includes("time")) return "time-exit";
  if (normalized.includes("14:50") || normalized.includes("强制") || normalized.includes("force")) return "force-close";
  return "other";
}

export function classifyEntryWindow(time = "", opening = false) {
  if (opening) return "opening-0930-0944";
  const numeric = Number(String(time).replace(":", ""));
  if (!Number.isFinite(numeric)) return "unknown";
  if (numeric < 945) return "opening-0930-0944";
  if (numeric <= 1030) return "morning-0945-1030";
  if (numeric < 1130) return "morning-1031-1130";
  if (numeric < 1330) return "lunch-or-unknown";
  if (numeric <= 1430) return "afternoon-1330-1430";
  return "late-1431-1450";
}

export function classifyVwapLocation(deviation) {
  const value = number(deviation, Number.NaN);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= -0.45) return "far-below-vwap";
  if (value < -0.15) return "below-vwap";
  if (value <= 0.15) return "near-vwap";
  if (value < 0.45) return "above-vwap";
  return "far-above-vwap";
}

export function classifyHoldingDuration(minutes) {
  const value = number(minutes, Number.NaN);
  if (!Number.isFinite(value)) return "unknown";
  if (value <= 15) return "0-15m";
  if (value <= 30) return "16-30m";
  if (value <= 45) return "31-45m";
  if (value <= 60) return "46-60m";
  return "61-90m";
}

export function classifyClosureFailure({ net = 0, gross = 0, exitReason = "" } = {}) {
  if (number(net) >= -LOSS_EPSILON) return { rootCause: null, trigger: null };
  return {
    rootCause: number(gross) <= LOSS_EPSILON ? "price-direction" : "cost-and-slippage",
    trigger: classifyClosureExit(exitReason),
  };
}

export function createClosureDiagnosticsBucket() {
  return {
    days: 0,
    tradeDays: 0,
    cycles: 0,
    wins: 0,
    net: 0,
    gross: 0,
    fees: 0,
    executionCost: 0,
    slices: {
      direction: {},
      entryWindow: {},
      marketRegime: {},
      regimeDirection: {},
      vwapLocation: {},
      holdingDuration: {},
      exit: {},
      trendRiskVotes: {},
      failureRootCause: {},
      failureTrigger: {},
    },
  };
}

function cycleFromActions({ net, entry, exit }) {
  const meta = exit?.meta ?? {};
  const fees = number(meta.cycleFees);
  const executionCost = number(meta.cycleExecution);
  const gross = number(meta.cycleGross, number(net) + fees + executionCost);
  const holdingMinutes = number(meta.hold);
  const direction = entry?.direction ?? "unknown";
  const regime = entry?.meta?.regime ?? "unknown";
  const exitClass = classifyClosureExit(exit?.reason);
  return {
    net: number(net),
    gross,
    fees,
    executionCost,
    holdingMinutes,
    direction,
    regime,
    entryWindow: classifyEntryWindow(entry?.time, Boolean(entry?.meta?.opening)),
    vwapLocation: classifyVwapLocation(entry?.meta?.deviation),
    holdingDuration: classifyHoldingDuration(holdingMinutes),
    exitClass,
    trendRiskVotes: String(entry?.meta?.trendRiskVotes ?? "unknown"),
    failure: classifyClosureFailure({ net, gross, exitReason: exit?.reason }),
  };
}

export function addClosureReplayResult(bucket, result) {
  bucket.days += 1;
  bucket.tradeDays += result.trades > 0 ? 1 : 0;
  bucket.cycles += result.trades;
  bucket.wins += result.wins;
  bucket.net += result.net;
  bucket.gross += result.gross;
  bucket.fees += result.fees;
  bucket.executionCost += result.executionCost;

  for (let index = 0; index < result.cycleNets.length; index += 1) {
    const cycleId = index + 1;
    const entry = result.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "entry");
    const exit = result.actions.find((action) => action.cycleId === cycleId && action.meta?.phase === "exit");
    const cycle = cycleFromActions({ net: result.cycleNets[index], entry, exit });
    addSlice(bucket.slices.direction, cycle.direction, cycle);
    addSlice(bucket.slices.entryWindow, cycle.entryWindow, cycle);
    addSlice(bucket.slices.marketRegime, cycle.regime, cycle);
    addSlice(bucket.slices.regimeDirection, `${cycle.regime}:${cycle.direction}`, cycle);
    addSlice(bucket.slices.vwapLocation, cycle.vwapLocation, cycle);
    addSlice(bucket.slices.holdingDuration, cycle.holdingDuration, cycle);
    addSlice(bucket.slices.exit, cycle.exitClass, cycle);
    addSlice(bucket.slices.trendRiskVotes, cycle.trendRiskVotes, cycle);
    if (cycle.failure.rootCause) addSlice(bucket.slices.failureRootCause, cycle.failure.rootCause, cycle);
    if (cycle.failure.trigger) addSlice(bucket.slices.failureTrigger, cycle.failure.trigger, cycle);
  }
}

function finalizeSlice(slice) {
  return Object.fromEntries(Object.entries(slice)
    .map(([key, value]) => [key, {
      ...value,
      winRate: value.cycles ? value.wins / value.cycles : 0,
      lossRate: value.cycles ? value.losses / value.cycles : 0,
      averageNet: value.cycles ? Number((value.net / value.cycles).toFixed(2)) : 0,
      averageHoldingMinutes: value.cycles ? Number((value.holdingMinutes / value.cycles).toFixed(1)) : 0,
      net: Number(value.net.toFixed(2)),
      gross: Number(value.gross.toFixed(2)),
      fees: Number(value.fees.toFixed(2)),
      executionCost: Number(value.executionCost.toFixed(2)),
    }])
    .sort((left, right) => right[1].cycles - left[1].cycles));
}

function topLossSegments(slices) {
  const segmentKinds = ["regimeDirection", "entryWindow", "vwapLocation", "holdingDuration"];
  return segmentKinds.flatMap((kind) => Object.entries(slices[kind] ?? {})
    .filter(([, value]) => value.cycles >= 3 && value.net < 0)
    .map(([key, value]) => ({ kind, key, cycles: value.cycles, winRate: value.winRate, net: value.net, averageNet: value.averageNet })))
    .sort((left, right) => left.net - right.net || right.cycles - left.cycles)
    .slice(0, 8);
}

export function finalizeClosureDiagnosticsBucket(bucket, { closureFloor = 0.25 } = {}) {
  const slices = Object.fromEntries(Object.entries(bucket.slices)
    .map(([name, slice]) => [name, finalizeSlice(slice)]));
  const losses = bucket.cycles - bucket.wins;
  return {
    ...bucket,
    net: Number(bucket.net.toFixed(2)),
    gross: Number(bucket.gross.toFixed(2)),
    fees: Number(bucket.fees.toFixed(2)),
    executionCost: Number(bucket.executionCost.toFixed(2)),
    cyclesPer100Days: bucket.days ? Number((bucket.cycles / bucket.days * 100).toFixed(2)) : 0,
    cycleClosureRate: bucket.days ? bucket.cycles / bucket.days : 0,
    meetsClosureFloor: bucket.days > 0 && bucket.cycles / bucket.days >= closureFloor,
    tradeDayCoverage: bucket.days ? bucket.tradeDays / bucket.days : 0,
    winRate: bucket.cycles ? bucket.wins / bucket.cycles : 0,
    lossRate: bucket.cycles ? losses / bucket.cycles : 0,
    averageNetPerCycle: bucket.cycles ? Number((bucket.net / bucket.cycles).toFixed(2)) : 0,
    slices,
    failureAttribution: {
      lossCycles: losses,
      priceDirection: slices.failureRootCause["price-direction"] ?? null,
      costAndSlippage: slices.failureRootCause["cost-and-slippage"] ?? null,
      exitTriggers: slices.failureTrigger,
      worstSegments: topLossSegments(slices),
    },
  };
}
