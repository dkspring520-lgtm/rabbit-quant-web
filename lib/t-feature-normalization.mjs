/** Causal rolling feature normalization for intraday T decisions. */
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function rollingZScore(values, index, window = 60) {
  if (!Array.isArray(values) || index < 0 || index >= values.length) return null;
  const current = finite(values[index]);
  if (current === null) return null;
  const start = Math.max(0, index - Math.max(2, window) + 1);
  const sample = values.slice(start, index + 1).map(finite).filter((value) => value !== null);
  if (sample.length < 3) return 0;
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sample.length;
  const deviation = Math.sqrt(variance);
  return deviation > 1e-9 ? (current - mean) / deviation : 0;
}

export function causalTFeatureSnapshot(points, index, vwaps = [], window = 60) {
  const point = points?.[index];
  if (!point) return null;
  const price = finite(point.price);
  const vwap = finite(vwaps[index]);
  if (price === null) return null;
  const vwapBias = vwap && vwap > 0 ? (price - vwap) / vwap : 0;
  const momentum = index > 0 && finite(points[index - 1]?.price)
    ? (price - Number(points[index - 1].price)) / Number(points[index - 1].price)
    : 0;
  const volumes = points.map((item) => finite(item.volume) ?? 0);
  const biases = points.map((item, itemIndex) => {
    const itemPrice = finite(item.price);
    const itemVwap = finite(vwaps[itemIndex]);
    return itemPrice !== null && itemVwap ? (itemPrice - itemVwap) / itemVwap : 0;
  });
  const momenta = points.map((item, itemIndex) => {
    const current = finite(item.price);
    const previous = finite(points[itemIndex - 1]?.price);
    return current !== null && previous ? (current - previous) / previous : 0;
  });
  return {
    window,
    vwapBias,
    momentum,
    vwapBiasZ: rollingZScore(biases, index, window),
    momentumZ: rollingZScore(momenta, index, window),
    volumeZ: rollingZScore(volumes, index, window),
  };
}

export function estimateTFlyRisk(snapshot, regime = "NEUTRAL") {
  if (!snapshot) return { level: "unknown", score: 0, reasons: [] };
  const reasons = [];
  let score = 0;
  if ((regime === "BULL_TREND" && snapshot.vwapBias > 0) || (regime === "uptrend" && snapshot.vwapBias > 0)) { score += 35; reasons.push("上涨趋势且价格在VWAP上方"); }
  if ((snapshot.momentumZ ?? 0) > 1.5) { score += 25; reasons.push("短线动量异常偏强"); }
  if ((snapshot.volumeZ ?? 0) > 1.5) { score += 20; reasons.push("放量延续风险"); }
  return { level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", score, reasons };
}
