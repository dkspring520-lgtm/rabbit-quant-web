const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
  ? Number(value)
  : null;

const round = (value, digits = 4) => Number.isFinite(Number(value))
  ? Number(Number(value).toFixed(digits))
  : null;

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function flowOf(point) {
  const bar = point?.l2?.l2Bar ?? point?.l2Bar ?? point ?? {};
  const nested = point?.l2?.flow ?? point?.flow ?? {};
  const buyVolume = Math.max(0, finite(bar.activeBuyVolume ?? nested.activeBuyVolume60s) ?? 0);
  const sellVolume = Math.max(0, finite(bar.activeSellVolume ?? nested.activeSellVolume60s) ?? 0);
  const buyNotional = Math.max(0, finite(bar.activeBuyNotional ?? nested.activeBuyNotional60s) ?? 0);
  const sellNotional = Math.max(0, finite(bar.activeSellNotional ?? nested.activeSellNotional60s) ?? 0);
  const totalVolume = buyVolume + sellVolume;
  const totalNotional = buyNotional + sellNotional;
  return {
    buyVolume,
    sellVolume,
    buyNotional,
    sellNotional,
    deltaVolume: buyVolume - sellVolume,
    deltaNotional: buyNotional - sellNotional,
    activeBuyRatio: finite(bar.activeBuyRatio ?? nested.activeBuyRatio60s)
      ?? (totalNotional > 0 ? buyNotional / totalNotional : totalVolume > 0 ? buyVolume / totalVolume : null),
    footprint: Array.isArray(bar.footprint) ? bar.footprint : [],
  };
}

function priceOf(point) {
  return finite(point?.price ?? point?.close);
}

function isCashSessionPoint(point) {
  const time = String(point?.time ?? point?.exchangeMinute ?? "").replace(/\D/g, "").slice(-4);
  return /^\d{4}$/.test(time) && (
    time >= "0915" && time <= "0925"
    || time >= "0930" && time <= "1129"
    || time >= "1300" && time <= "1500"
  );
}

function vwapSeries(points) {
  let volume = 0;
  let amount = 0;
  return points.map(point => {
    const supplied = finite(point?.averagePrice ?? point?.l2?.l2Bar?.averagePrice);
    const price = priceOf(point);
    const rowVolume = Math.max(0, finite(point?.volume) ?? 0);
    if (price !== null && rowVolume > 0) {
      volume += rowVolume;
      amount += price * rowVolume;
    }
    return supplied !== null && supplied > 0 ? supplied : volume > 0 ? amount / volume : price;
  });
}

function simpleMovingAverage(values, period = 5) {
  return values.map((_, index) => {
    const sample = values.slice(Math.max(0, index - period + 1), index + 1).filter(value => value !== null);
    return sample.length ? sample.reduce((sum, value) => sum + value, 0) / sample.length : null;
  });
}

function sumWindow(values, end, size) {
  return values.slice(Math.max(0, end - size + 1), end + 1).reduce((sum, value) => sum + value, 0);
}

function detectDeltaDivergence(points, flows, index, lookback = 8) {
  if (index < Math.max(3, lookback)) return { state: "none", label: "样本不足", reason: "等待价格与Delta形成可比较波段" };
  const start = Math.max(0, index - lookback);
  const prior = points.slice(start, index);
  const currentPrice = priceOf(points[index]);
  const priorPrices = prior.map(priceOf).filter(value => value !== null);
  if (currentPrice === null || !priorPrices.length) return { state: "none", label: "待数据", reason: "价格数据不足" };
  const currentDelta = sumWindow(flows.map(flow => flow.deltaNotional), index, 3);
  const priorDeltas = [];
  for (let cursor = Math.max(2, start); cursor < index; cursor += 1) {
    priorDeltas.push(sumWindow(flows.map(flow => flow.deltaNotional), cursor, 3));
  }
  if (!priorDeltas.length) return { state: "none", label: "样本不足", reason: "等待3分钟Delta基线" };
  const bullish = currentPrice <= Math.min(...priorPrices) && currentDelta > Math.min(...priorDeltas);
  const bearish = currentPrice >= Math.max(...priorPrices) && currentDelta < Math.max(...priorDeltas);
  return bullish
    ? { state: "bullish", label: "底背离", reason: "价格创新低，但3分钟Delta没有同步创新低" }
    : bearish
      ? { state: "bearish", label: "顶背离", reason: "价格创新高，但3分钟Delta没有同步创新高" }
      : { state: "none", label: "无背离", reason: "价格与Delta暂未形成反向变化" };
}

function detectAbsorption(points, flows, index, size = 3) {
  if (index < size - 1) return { state: "none", label: "样本不足", reason: "等待3分钟真实成交" };
  const start = index - size + 1;
  const samplePrices = points.slice(start, index + 1).map(priceOf).filter(value => value !== null);
  const sampleFlows = flows.slice(start, index + 1);
  if (samplePrices.length < size) return { state: "none", label: "待价格", reason: "价格数据不足" };
  const buy = sampleFlows.reduce((sum, flow) => sum + flow.buyNotional, 0);
  const sell = sampleFlows.reduce((sum, flow) => sum + flow.sellNotional, 0);
  const gross = buy + sell;
  if (gross <= 0) return { state: "none", label: "待成交", reason: "没有真实主动成交可判断" };
  const movePct = (samplePrices.at(-1) / samplePrices[0] - 1) * 100;
  const sellAbsorption = sell / gross >= 0.62 && movePct >= -0.10;
  const buyAbsorption = buy / gross >= 0.62 && movePct <= 0.10;
  return sellAbsorption
    ? { state: "sell-absorbed", label: "卖方被吸收", reason: `主动卖占比 ${(sell / gross * 100).toFixed(0)}%，价格3分钟仅变动 ${movePct.toFixed(2)}%` }
    : buyAbsorption
      ? { state: "buy-absorbed", label: "买方被吸收", reason: `主动买占比 ${(buy / gross * 100).toFixed(0)}%，价格3分钟仅变动 ${movePct.toFixed(2)}%` }
      : { state: "none", label: "无明显吸收", reason: "主动成交与价格推进基本一致" };
}

function priceEfficiency(points, flows, index, size = 5) {
  if (index < size - 1) return { value: null, label: "样本不足", priceMovePct: null, deltaNotional: null };
  const start = index - size + 1;
  const first = priceOf(points[start]);
  const last = priceOf(points[index]);
  const deltaNotional = sumWindow(flows.map(flow => flow.deltaNotional), index, size);
  if (first === null || last === null || first <= 0 || Math.abs(deltaNotional) < 1) {
    return { value: null, label: "等待有效Delta", priceMovePct: null, deltaNotional: round(deltaNotional, 2) };
  }
  const priceMovePct = (last / first - 1) * 100;
  const bpsPerMillion = (priceMovePct * 100) / (Math.abs(deltaNotional) / 1_000_000);
  const sameDirection = Math.sign(priceMovePct) === Math.sign(deltaNotional);
  const inefficient = !sameDirection || Math.abs(bpsPerMillion) < 0.8;
  return {
    value: round(bpsPerMillion, 2),
    label: inefficient ? "推进乏力" : "推进有效",
    priceMovePct: round(priceMovePct, 3),
    deltaNotional: round(deltaNotional, 2),
    sameDirection,
  };
}

function volumeConfirmation(points, index, size = 5) {
  const current = Math.max(0, finite(points[index]?.volume) ?? 0);
  const prior = points
    .slice(Math.max(0, index - size), index)
    .map(point => Math.max(0, finite(point?.volume) ?? 0))
    .filter(value => value > 0);
  if (current <= 0 || prior.length < 3) {
    return { ready: false, confirmed: false, ratio: null, label: "成交量待积累" };
  }
  const baseline = prior.reduce((sum, value) => sum + value, 0) / prior.length;
  const ratio = baseline > 0 ? current / baseline : null;
  return {
    ready: ratio !== null,
    confirmed: ratio !== null && ratio >= 1.1,
    ratio: round(ratio, 3),
    label: ratio !== null && ratio >= 1.1 ? "成交量确认" : "成交量未放大",
  };
}

function scoreRadar({ points, flows, index, vwap, ma5, divergence, absorption, efficiency, volume }) {
  const currentPrice = priceOf(points[index]);
  const recentPrices = points.slice(Math.max(0, index - 20), index + 1).map(priceOf).filter(value => value !== null);
  const newLow = currentPrice !== null && recentPrices.length > 2 && currentPrice <= Math.min(...recentPrices);
  const newHigh = currentPrice !== null && recentPrices.length > 2 && currentPrice >= Math.max(...recentPrices);
  const priorPrice = index > 0 ? priceOf(points[index - 1]) : null;
  const reclaimedVwap = currentPrice !== null && priorPrice !== null && vwap !== null
    && priorPrice < vwap && currentPrice >= vwap;
  const lostVwap = currentPrice !== null && priorPrice !== null && vwap !== null
    && priorPrice > vwap && currentPrice <= vwap;
  const aboveMa5 = currentPrice !== null && ma5 !== null && currentPrice >= ma5;
  const belowMa5 = currentPrice !== null && ma5 !== null && currentPrice <= ma5;
  const flow = flows[index];
  const buyPressure = flow.activeBuyRatio !== null && flow.activeBuyRatio >= 0.55;
  const sellPressure = flow.activeBuyRatio !== null && flow.activeBuyRatio <= 0.45;
  const deltaImproving = index > 0 && flow.deltaNotional > flows[index - 1].deltaNotional;
  const deltaWeakening = index > 0 && flow.deltaNotional < flows[index - 1].deltaNotional;
  const lowBuyChecks = [
    { label: "价格接近日内低位", points: 12, passed: newLow },
    { label: "Delta底背离", points: 18, passed: divergence.state === "bullish" },
    { label: "卖压开始衰竭", points: 13, passed: deltaImproving && !sellPressure },
    { label: "卖方被吸收", points: 18, passed: absorption.state === "sell-absorbed" },
    { label: "重新站回VWAP", points: 14, passed: reclaimedVwap },
    { label: "站上MA5", points: 5, passed: aboveMa5 },
    { label: "真实买盘占优", points: 10, passed: buyPressure },
    { label: "成交量确认", points: 10, passed: volume.confirmed },
  ];
  const takeProfitChecks = [
    { label: "价格接近日内高位", points: 12, passed: newHigh },
    { label: "Delta顶背离", points: 18, passed: divergence.state === "bearish" },
    { label: "买盘开始衰竭", points: 13, passed: deltaWeakening && !buyPressure },
    { label: "买方被吸收", points: 18, passed: absorption.state === "buy-absorbed" },
    { label: "跌回VWAP", points: 14, passed: lostVwap },
    { label: "跌破MA5", points: 5, passed: belowMa5 },
    { label: "真实卖盘占优", points: 10, passed: sellPressure },
    { label: "成交量确认", points: 10, passed: volume.confirmed },
  ];
  const sum = checks => clamp(checks.reduce((total, check) => total + (check.passed ? check.points : 0), 0));
  const lowBuy = sum(lowBuyChecks);
  const takeProfit = sum(takeProfitChecks);
  return {
    lowBuy,
    takeProfit,
    lowBuyChecks,
    takeProfitChecks,
    stance: lowBuy >= 70 && lowBuy >= takeProfit + 15
      ? "低吸观察"
      : takeProfit >= 70 && takeProfit >= lowBuy + 15
        ? "止盈观察"
        : "等待确认",
    efficiencyWarning: efficiency.label === "推进乏力",
  };
}

export function evaluateZijinOrderFlowRadar({ minutes, index, stale = false } = {}) {
  const points = Array.isArray(minutes) ? minutes : [];
  if (!points.length) {
    return Object.freeze({ available: false, reason: "等待L2分钟成交", researchOnly: true, canCreateSignal: false });
  }
  const boundary = Math.min(Math.max(0, Number.isInteger(index) ? index : points.length - 1), points.length - 1);
  const causal = points.slice(0, boundary + 1).filter(isCashSessionPoint);
  if (!causal.length) {
    return Object.freeze({ available: false, reason: "等待有效交易分钟", researchOnly: true, canCreateSignal: false });
  }
  const safeIndex = causal.length - 1;
  const flows = causal.map(flowOf);
  const observed = flows.filter(flow => flow.buyVolume + flow.sellVolume > 0 || flow.buyNotional + flow.sellNotional > 0).length;
  const current = flows.at(-1);
  const currentFlowAvailable = current.buyVolume + current.sellVolume > 0
    || current.buyNotional + current.sellNotional > 0;
  const deltas = flows.map(flow => flow.deltaNotional);
  const deltaVolume = flows.map(flow => flow.deltaVolume);
  const vwap = vwapSeries(causal).at(-1) ?? null;
  const ma5 = simpleMovingAverage(causal.map(priceOf), 5).at(-1) ?? null;
  const divergence = detectDeltaDivergence(causal, flows, safeIndex);
  const absorption = detectAbsorption(causal, flows, safeIndex);
  const efficiency = priceEfficiency(causal, flows, safeIndex);
  const volume = volumeConfirmation(causal, safeIndex);
  const scores = scoreRadar({ points: causal, flows, index: safeIndex, vwap, ma5, divergence, absorption, efficiency, volume });
  const footprint = current.footprint
    .map(row => ({
      price: finite(row?.price),
      buyVolume: Math.max(0, finite(row?.buyVolume) ?? 0),
      sellVolume: Math.max(0, finite(row?.sellVolume) ?? 0),
      deltaVolume: finite(row?.deltaVolume) ?? (finite(row?.buyVolume) ?? 0) - (finite(row?.sellVolume) ?? 0),
      buyNotional: Math.max(0, finite(row?.buyNotional) ?? 0),
      sellNotional: Math.max(0, finite(row?.sellNotional) ?? 0),
      trades: Math.max(0, finite(row?.trades) ?? 0),
    }))
    .filter(row => row.price !== null)
    .sort((left, right) => right.price - left.price);
  return Object.freeze({
    schemaVersion: 1,
    available: currentFlowAvailable && !stale,
    reason: stale ? "L2数据过期，等待更新" : currentFlowAvailable ? "真实L2主动成交" : "本分钟暂无真实主动成交",
    asOfTime: causal.at(-1)?.time ?? null,
    observedMinutes: observed,
    delta: Object.freeze({
      oneMinute: round(deltas.at(-1), 2),
      threeMinute: round(sumWindow(deltas, safeIndex, 3), 2),
      fiveMinute: round(sumWindow(deltas, safeIndex, 5), 2),
      cumulative: round(deltas.reduce((sum, value) => sum + value, 0), 2),
      oneMinuteVolume: round(deltaVolume.at(-1), 2),
      activeBuyRatio: round(current.activeBuyRatio),
    }),
    divergence: Object.freeze(divergence),
    absorption: Object.freeze(absorption),
    efficiency: Object.freeze(efficiency),
    volume: Object.freeze(volume),
    scores: Object.freeze(currentFlowAvailable && !stale ? scores : {
      ...scores, lowBuy: null, takeProfit: null, stance: "等待成交",
    }),
    winRate: null,
    probabilityStatus: "uncalibrated",
    reference: Object.freeze({ price: round(priceOf(causal.at(-1)), 4), vwap: round(vwap, 4), ma5: round(ma5, 4) }),
    footprint: Object.freeze(footprint),
    researchOnly: true,
    confirmationOnly: true,
    canCreateSignal: false,
    affectsProduction: false,
  });
}
