const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function minuteSlot(time) {
  const digits = String(time ?? "").replace(/\D/g, "").slice(-4);
  if (!/^\d{4}$/.test(digits)) return null;
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (hour === 9 && minute >= 30) return minute - 30;
  if (hour === 10) return 30 + minute;
  if (hour === 11 && minute <= 30) return 90 + minute;
  if (hour === 13) return 120 + minute;
  if (hour === 14) return 180 + minute;
  if (hour === 15 && minute === 0) return 240;
  return null;
}

function normalizeMinutes(minutes) {
  return (Array.isArray(minutes) ? minutes : [])
    .map((row, index) => {
      const price = finite(row?.price ?? row?.close);
      const slot = minuteSlot(row?.time);
      if (!(price > 0) || slot == null) return null;
      return {
        time: String(row.time).replace(/\D/g, "").slice(-4),
        slot,
        price,
        open: finite(row?.open) ?? price,
        high: finite(row?.high) ?? price,
        low: finite(row?.low) ?? price,
        volume: Math.max(0, finite(row?.volume) ?? 0),
        amount: Math.max(0, finite(row?.amount) ?? 0),
        averagePrice: finite(row?.averagePrice),
        sourceIndex: index,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.slot - b.slot);
}

function resample(points, size) {
  const groups = new Map();
  for (const point of points) {
    const bucket = Math.floor(point.slot / size);
    const current = groups.get(bucket);
    if (!current) {
      groups.set(bucket, {
        time: point.time,
        slot: point.slot,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.price,
        price: point.price,
        volume: point.volume,
        amount: point.amount,
      });
    } else {
      current.time = point.time;
      current.slot = point.slot;
      current.high = Math.max(current.high, point.high);
      current.low = Math.min(current.low, point.low);
      current.close = point.price;
      current.price = point.price;
      current.volume += point.volume;
      current.amount += point.amount;
    }
  }
  return [...groups.values()];
}

function normalizeDailyBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map(row => {
      const close = finite(row?.close ?? row?.price);
      if (!(close > 0)) return null;
      return {
        date: String(row?.date ?? ""),
        open: finite(row?.open) ?? close,
        high: finite(row?.high) ?? close,
        low: finite(row?.low) ?? close,
        close,
        price: close,
        volume: Math.max(0, finite(row?.volume) ?? 0),
        amount: Math.max(0, finite(row?.amount) ?? 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function weeklyBars(daily) {
  const groups = new Map();
  for (const bar of daily) {
    const digits = bar.date.replace(/\D/g, "");
    if (digits.length !== 8) continue;
    const date = new Date(Date.UTC(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1, Number(digits.slice(6, 8))));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    const key = date.toISOString().slice(0, 10);
    const current = groups.get(key);
    if (!current) groups.set(key, {...bar, date:key});
    else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.price = bar.close;
      current.volume += bar.volume;
      current.amount += bar.amount;
    }
  }
  return [...groups.values()];
}

function movingAverage(values, length) {
  if (!values.length) return null;
  const sample = values.slice(-Math.min(length, values.length));
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

function confirmedPivots(bars, radius = 2) {
  const pivots = [];
  for (let index = radius; index < bars.length - radius; index += 1) {
    const bar = bars[index];
    const window = bars.slice(index - radius, index + radius + 1);
    const high = window.every((item, offset) => offset === radius || bar.high > item.high);
    const low = window.every((item, offset) => offset === radius || bar.low < item.low);
    if (high || low) {
      pivots.push({
        type: high ? "high" : "low",
        price: high ? bar.high : bar.low,
        pivotTime: bar.time ?? bar.date,
        confirmedAt: bars[index + radius].time ?? bars[index + radius].date,
        index,
      });
    }
  }
  return pivots;
}

function trendSnapshot(bars, label) {
  if (!bars.length) return {label, available:false, score:0, state:"数据不足", bars:0};
  const closes = bars.map(bar => bar.close ?? bar.price);
  const fast = movingAverage(closes, Math.min(5, closes.length));
  const slow = movingAverage(closes, Math.min(20, closes.length));
  const priorFast = closes.length >= 4
    ? movingAverage(closes.slice(0, -Math.min(3, closes.length - 1)), Math.min(5, closes.length - 1))
    : fast;
  const pivots = confirmedPivots(bars);
  const highs = pivots.filter(item => item.type === "high").slice(-2);
  const lows = pivots.filter(item => item.type === "low").slice(-2);
  let structure = 0;
  if (highs.length === 2) structure += highs[1].price > highs[0].price ? 1 : -1;
  if (lows.length === 2) structure += lows[1].price > lows[0].price ? 1 : -1;
  const base = slow || closes.at(-1);
  const maSpread = base ? (fast - slow) / base * 100 : 0;
  const slope = base ? (fast - priorFast) / base * 100 : 0;
  const score = clamp(Math.round(maSpread * 420 + slope * 520 + structure * 18), -100, 100);
  const state = score >= 45 ? "强上涨" : score >= 18 ? "弱上涨" : score <= -45 ? "强下跌" : score <= -18 ? "弱下跌" : "区间震荡";
  return {label, available:true, score, state, bars:bars.length, fast, slow, slope, structure, pivots:pivots.slice(-6)};
}

function chanStructure(bars) {
  const fractals = confirmedPivots(bars);
  const strokes = [];
  for (const pivot of fractals) {
    const last = strokes.at(-1);
    if (!last || last.type !== pivot.type) strokes.push(pivot);
    else if ((pivot.type === "high" && pivot.price >= last.price) || (pivot.type === "low" && pivot.price <= last.price)) {
      strokes[strokes.length - 1] = pivot;
    }
  }
  const segments = strokes.slice(1).map((end, index) => {
    const start = strokes[index];
    return {start, end, low:Math.min(start.price, end.price), high:Math.max(start.price, end.price), direction:end.price > start.price ? "up" : "down"};
  });
  let centralZone = null;
  for (let index = Math.max(0, segments.length - 5); index <= segments.length - 3; index += 1) {
    const sample = segments.slice(index, index + 3);
    const low = Math.max(...sample.map(item => item.low));
    const high = Math.min(...sample.map(item => item.high));
    if (low <= high) centralZone = {low, high, start:sample[0].start.confirmedAt, confirmedAt:sample[2].end.confirmedAt};
  }
  const last = bars.at(-1)?.close ?? bars.at(-1)?.price ?? null;
  const location = !centralZone || last == null ? "中枢待确认"
    : last < centralZone.low ? "中枢下方"
      : last > centralZone.high ? "中枢上方"
        : "中枢内部";
  const recentUp = segments.filter(item => item.direction === "up").slice(-2);
  const recentDown = segments.filter(item => item.direction === "down").slice(-2);
  const divergence = recentUp.length === 2 && recentUp[1].high - recentUp[1].low < (recentUp[0].high - recentUp[0].low) * .72
    ? "上行背驰候选"
    : recentDown.length === 2 && recentDown[1].high - recentDown[1].low < (recentDown[0].high - recentDown[0].low) * .72
      ? "下行背驰候选"
      : "未见背驰";
  return {
    method:"因果量化缠论",
    fractals:fractals.slice(-8),
    strokes:strokes.slice(-8),
    segments:segments.slice(-6),
    centralZone,
    location,
    divergence,
    confirmedAt:strokes.at(-1)?.confirmedAt ?? null,
  };
}
function volumeProfile(points, bins = 24) {
  if (!points.length) return {ready:false};
  const low = Math.min(...points.map(point => point.low));
  const high = Math.max(...points.map(point => point.high));
  const span = Math.max(high - low, low * .0001);
  const width = span / bins;
  const values = Array.from({length:bins}, (_, index) => ({price:low + (index + .5) * width, volume:0}));
  for (const point of points) {
    const typical = (point.high + point.low + point.price) / 3;
    const index = clamp(Math.floor((typical - low) / width), 0, bins - 1);
    values[index].volume += point.volume || (point.amount > 0 ? point.amount / point.price : 1);
  }
  const total = values.reduce((sum, item) => sum + item.volume, 0);
  const pocIndex = values.reduce((best, item, index) => item.volume > values[best].volume ? index : best, 0);
  const ranked = values.map((item, index) => ({...item,index})).sort((a, b) => b.volume - a.volume);
  const selected = [];
  let accumulated = 0;
  for (const item of ranked) {
    selected.push(item.index);
    accumulated += item.volume;
    if (accumulated >= total * .7) break;
  }
  return {
    ready:true,
    poc:values[pocIndex].price,
    valueAreaLow:values[Math.min(...selected)].price - width / 2,
    valueAreaHigh:values[Math.max(...selected)].price + width / 2,
    totalVolume:total,
    bins:values,
  };
}

function wyckoffState(points, profile, vwap) {
  if (points.length < 8) return {phase:"样本积累", confidence:20, evidence:["少于 8 个分钟点"]};
  const prices = points.map(point => point.price);
  const last = prices.at(-1);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const range = Math.max(high - low, last * .0001);
  const position = (last - low) / range;
  const recent = prices.slice(-5);
  const prior = prices.slice(-10, -5);
  const recentSlope = (recent.at(-1) - recent[0]) / last * 100;
  const priorVolume = median(points.slice(-20, -5).map(point => point.volume)) || 1;
  const recentVolume = median(points.slice(-5).map(point => point.volume)) || 0;
  const volumeRatio = recentVolume / priorVolume;
  const abovePoc = profile.ready && last >= profile.poc;
  const aboveVwap = vwap > 0 && last >= vwap;
  let phase = "区间震荡";
  const evidence = [];
  if (position < .22 && recentSlope > .08 && volumeRatio >= 1.15) phase = "震仓后承接";
  else if (position > .78 && recentSlope < -.08 && volumeRatio >= 1.15) phase = "派发/上冲回落";
  else if (position > .66 && recentSlope > .06 && abovePoc && aboveVwap) phase = "标记上升";
  else if (position < .34 && recentSlope < -.06 && !abovePoc && !aboveVwap) phase = "标记下跌";
  else if (position < .45 && volumeRatio < .9) phase = "吸筹观察";
  else if (position > .55 && volumeRatio < .9) phase = "派发观察";
  evidence.push(`区间位置 ${(position * 100).toFixed(0)}%`, `近5分钟量比 ${volumeRatio.toFixed(2)}`, aboveVwap ? "均价线上" : "均价线下");
  return {phase, confidence:Math.round(clamp(45 + Math.abs(position - .5) * 40 + Math.min(15, Math.abs(recentSlope) * 70), 35, 82)), evidence, position, recentSlope, volumeRatio};
}

function observedVwap(points) {
  const amount = points.reduce((sum, point) => sum + point.amount, 0);
  const volume = points.reduce((sum, point) => sum + point.volume, 0);
  if (amount > 0 && volume > 0) return amount / volume;
  const explicit = points.map(point => point.averagePrice).filter(value => value > 0);
  if (explicit.length) return explicit.at(-1);
  const weighted = points.reduce((sum, point) => sum + point.price * Math.max(1, point.volume), 0);
  const weight = points.reduce((sum, point) => sum + Math.max(1, point.volume), 0);
  return weight ? weighted / weight : null;
}

export function evaluateZijinStructure({minutes = [], historicalBars = []} = {}) {
  const points = normalizeMinutes(minutes);
  const daily = normalizeDailyBars(historicalBars);
  const frames = {
    weekly:trendSnapshot(weeklyBars(daily), "周线"),
    daily:trendSnapshot(daily, "日线"),
    sixty:trendSnapshot(resample(points, 60), "60分钟"),
    fifteen:trendSnapshot(resample(points, 15), "15分钟"),
    five:trendSnapshot(resample(points, 5), "5分钟"),
    one:trendSnapshot(resample(points, 1), "1分钟"),
  };
  const weightedFrames = [
    [frames.weekly, .15],
    [frames.daily, .45],
    [frames.sixty, .30],
    [frames.fifteen, .10],
  ];
  const availableWeight = weightedFrames.reduce((sum, [frame, weight]) => sum + (frame.available ? weight : 0), 0);
  const directionScore = availableWeight
    ? Math.round(weightedFrames.reduce((sum, [frame, weight]) => sum + (frame.available ? frame.score * weight : 0), 0) / availableWeight)
    : 0;
  const direction = directionScore >= 45 ? "上升趋势"
    : directionScore >= 18 ? "低位/弱势转强"
      : directionScore <= -45 ? "下降趋势"
        : directionScore <= -18 ? "高位/弱势转弱"
          : "趋势不明";
  const intradayBars = resample(points, 5);
  const chan = chanStructure(intradayBars);
  const profile = volumeProfile(points);
  const vwap = observedVwap(points);
  const wyckoff = wyckoffState(points, profile, vwap);
  const last = points.at(-1)?.price ?? null;
  const biasPct = last && vwap ? (last - vwap) / vwap * 100 : null;
  const peakVolume = points.reduce((best, point) => !best || point.volume > best.volume ? point : best, null);
  const positiveTAllowed = directionScore > -45 && !["标记下跌", "派发/上冲回落"].includes(wyckoff.phase);
  const reverseTAllowed = directionScore < 45 && wyckoff.phase !== "震仓后承接";
  return {
    ready:points.length >= 5,
    asOfTime:points.at(-1)?.time ?? null,
    direction,
    directionScore,
    coverage:Math.round(availableWeight * 100),
    frames,
    dow:frames.five,
    chan,
    volumeProfile:profile,
    wyckoff,
    vwap,
    biasPct,
    peakVolume:peakVolume ? {time:peakVolume.time, volume:peakVolume.volume, price:peakVolume.price} : null,
    permissions:{positiveT:positiveTAllowed, reverseT:reverseTAllowed},
    support:chan.centralZone?.low ?? profile.valueAreaLow ?? null,
    resistance:chan.centralZone?.high ?? profile.valueAreaHigh ?? null,
    executable:false,
    affectsV4:false,
  };
}
