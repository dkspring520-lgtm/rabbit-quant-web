function minuteOrdinal(time) {
  const match = /^(\d{2}):?(\d{2})$/.exec(String(time ?? ""));
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// Keep incomplete and discontinuous windows out of fixed-horizon denominators.
export function riskEventOutcome(points, index, horizon, costPct) {
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(horizon) || horizon < 1 || !Number.isFinite(costPct) || costPct < 0) throw new RangeError("Invalid event window or cost");
  if (index + horizon >= points.length) return { excluded: "incomplete" };
  const window = points.slice(index, index + horizon + 1);
  if (window.some(point => !Number.isFinite(point.price) || point.price <= 0)) return { excluded: "invalid-price" };
  const times = window.map(point => minuteOrdinal(point.time));
  if (times.some((time, i) => time === null || (i > 0 && time !== times[i - 1] + 1))) return { excluded: "discontinuous" };
  const entry = window[0].price;
  const future = window.slice(1).map(point => point.price);
  const gross = (future.at(-1) / entry - 1) * 100;
  return { gross, net: gross - costPct, maxUp: (Math.max(...future) / entry - 1) * 100, maxDown: (Math.min(...future) / entry - 1) * 100,
    recoveryPath: Math.min(...future) <= entry && gross >= costPct };
}

export function summarizeRiskOutcomes(outcomes) {
  const valid = outcomes.filter(item => !item.excluded);
  const mean = key => valid.length ? Number((valid.reduce((sum, item) => sum + item[key], 0) / valid.length).toFixed(5)) : null;
  const rate = predicate => valid.length ? Number((valid.filter(predicate).length / valid.length).toFixed(4)) : null;
  return { totalEvents: outcomes.length, n: valid.length, excluded: Object.fromEntries(["incomplete", "invalid-price", "discontinuous"].map(reason => [reason, outcomes.filter(item => item.excluded === reason).length])),
    grossMeanPct: mean("gross"), longNetMeanPct: mean("net"), grossPositiveRate: rate(item => item.gross > 0), longNetPositiveRate: rate(item => item.net > 0),
    meanMaxUpPct: mean("maxUp"), meanMaxDownPct: mean("maxDown"), recoveryPathRate: rate(item => item.recoveryPath) };
}
