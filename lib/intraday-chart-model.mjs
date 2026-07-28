const finitePositive = value => Number.isFinite(Number(value)) && Number(value) > 0;

/**
 * Exact provider averages are preferred. Other sources fall back to a causal
 * minute-volume weighted average without inspecting a later point.
 */
export function cumulativeIntradayAverage(points = []) {
  let tradedValue = 0;
  let totalVolume = 0;
  let priceTotal = 0;
  return points.map((point, index) => {
    const price = Number(point?.price);
    const volume = Math.max(0, Number(point?.volume) || 0);
    tradedValue += price * volume;
    totalVolume += volume;
    priceTotal += price;
    const exactAverage = Number(point?.averagePrice);
    if (finitePositive(exactAverage)) {
      if (totalVolume > 0) tradedValue = exactAverage * totalVolume;
      return exactAverage;
    }
    return totalVolume > 0 ? tradedValue / totalVolume : priceTotal / (index + 1);
  });
}

/**
 * Previous close is the 0% centre and both price ranges are symmetrical.
 * Only visible prices are used, preserving live/replay causality.
 */
export function symmetricIntradayScale(prices = [], previousClose = null, options = {}) {
  const values = prices.map(Number).filter(finitePositive);
  if (!values.length) return null;
  const reference = finitePositive(previousClose) ? Number(previousClose) : null;
  const requestedTicks = Math.max(3, Math.trunc(Number(options.tickCount) || 9));
  const tickCount = requestedTicks % 2 === 0 ? requestedTicks + 1 : requestedTicks;

  if (!reference) {
    const observedMin = Math.min(...values);
    const observedMax = Math.max(...values);
    const observedRange = observedMax - observedMin || Math.max(observedMax * 0.002, 0.01);
    const padding = observedRange * 0.08;
    const min = observedMin - padding;
    const max = observedMax + padding;
    return {
      reference: null, min, max,
      ticks: Array.from({ length: tickCount }, (_, index) => ({
        value: max - (max - min) * index / (tickCount - 1),
        percent: null,
      })),
    };
  }

  const observedDeviation = Math.max(...values.map(value => Math.abs(value - reference)));
  const minimumDeviation = reference * Math.max(0.001, Number(options.minimumPercent) || 0.005);
  const halfRange = Math.max(observedDeviation, minimumDeviation)
    * Math.max(1.02, Number(options.paddingFactor) || 1.3);
  const min = reference - halfRange;
  const max = reference + halfRange;
  return {
    reference, min, max,
    ticks: Array.from({ length: tickCount }, (_, index) => {
      const value = index === Math.floor(tickCount / 2)
        ? reference
        : max - (max - min) * index / (tickCount - 1);
      return { value, percent: (value - reference) / reference * 100 };
    }),
  };
}
