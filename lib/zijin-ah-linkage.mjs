const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

const minuteMomentum = (points, index, lookback) => {
  const current = points[index];
  const previous = points[Math.max(0, index - lookback)];
  if (!current || !previous || previous.returnPercent == null) return null;
  return current.returnPercent - previous.returnPercent;
};

export function analyzeZijinAhLinkage({
  aMinutes = [],
  aPreviousClose = null,
  hkMinutes = [],
  hkPreviousClose = null,
} = {}) {
  const aBase = finite(aPreviousClose);
  const hkBase = finite(hkPreviousClose);
  if (!aBase || !hkBase) {
    return { available:false, state:"unavailable", label:"港股联动待数据", bias:"neutral", weight:0, reason:"缺少 A/H 昨收基准", asOfTime:null, spreadPercent:null, points:[] };
  }

  const aByTime = new Map(aMinutes
    .filter(point => /^\d{4}$/.test(point?.time ?? "") && finite(point?.price))
    .map(point => [point.time, finite(point.price)]));
  const points = hkMinutes
    .filter(point => /^\d{4}$/.test(point?.time ?? "") && finite(point?.price) && aByTime.has(point.time))
    .map(point => {
      const aPrice = aByTime.get(point.time);
      const hkPrice = finite(point.price);
      return {
        time:point.time,
        aPrice,
        hkPrice,
        aReturnPercent:(aPrice - aBase) / aBase * 100,
        hkReturnPercent:(hkPrice - hkBase) / hkBase * 100,
        returnPercent:(hkPrice - hkBase) / hkBase * 100,
      };
    });
  if (points.length < 3) {
    return { available:false, state:"unavailable", label:"港股联动待同步", bias:"neutral", weight:0, reason:"A/H 同分钟样本不足", asOfTime:points.at(-1)?.time ?? null, spreadPercent:null, points };
  }

  const latest = points.at(-1);
  const index = points.length - 1;
  const hkMomentum3 = minuteMomentum(points, index, 3) ?? 0;
  const hkMomentum5 = minuteMomentum(points, index, 5) ?? hkMomentum3;
  const aMomentum3 = latest.aReturnPercent - points[Math.max(0, index - 3)].aReturnPercent;
  const aMomentum5 = latest.aReturnPercent - points[Math.max(0, index - 5)].aReturnPercent;
  const spreadPercent = latest.hkReturnPercent - latest.aReturnPercent;
  const reboundLead = hkMomentum3 >= .12 && hkMomentum5 >= .16 && hkMomentum3 - aMomentum3 >= .1;
  const dropLead = hkMomentum3 <= -.12 && hkMomentum5 <= -.16 && hkMomentum3 - aMomentum3 <= -.1;
  const synchronousUp = hkMomentum3 >= .1 && aMomentum3 >= .1;
  const synchronousDown = hkMomentum3 <= -.1 && aMomentum3 <= -.1;

  let state = "neutral";
  let label = "A/H走势接近";
  let bias = "neutral";
  let weight = 0;
  let reason = `港股 ${hkMomentum3 >= 0 ? "+" : ""}${hkMomentum3.toFixed(2)}%，A股 ${aMomentum3 >= 0 ? "+" : ""}${aMomentum3.toFixed(2)}%（近3分钟）`;
  if (reboundLead) {
    state = "hk_leads_rebound";
    label = "港股反弹领先";
    bias = "buy";
    weight = Math.min(12, Math.round(5 + Math.abs(hkMomentum3 - aMomentum3) * 18));
    reason = `港股近3分钟先反弹 ${hkMomentum3.toFixed(2)}%，A股仅 ${aMomentum3.toFixed(2)}%；等待A股量价确认`;
  } else if (dropLead) {
    state = "hk_leads_drop";
    label = "港股回落领先";
    bias = "sell";
    weight = Math.min(12, Math.round(5 + Math.abs(hkMomentum3 - aMomentum3) * 18));
    reason = `港股近3分钟先回落 ${Math.abs(hkMomentum3).toFixed(2)}%，A股变化 ${aMomentum3.toFixed(2)}%；注意滞后风险`;
  } else if (synchronousUp) {
    state = "synchronous_up";
    label = "A/H同步走强";
    bias = "buy";
    weight = 6;
  } else if (synchronousDown) {
    state = "synchronous_down";
    label = "A/H同步走弱";
    bias = "sell";
    weight = 6;
  } else if (Math.abs(spreadPercent) >= .45) {
    state = "divergent";
    label = spreadPercent > 0 ? "港股相对偏强" : "港股相对偏弱";
    bias = spreadPercent > 0 ? "buy" : "sell";
    weight = 4;
    reason = `A/H当日涨幅差 ${spreadPercent >= 0 ? "+" : ""}${spreadPercent.toFixed(2)}%，仅作相对强弱观察`;
  }

  return {
    available:true,
    state,
    label,
    bias,
    weight,
    reason,
    asOfTime:latest.time,
    spreadPercent,
    aReturnPercent:latest.aReturnPercent,
    hkReturnPercent:latest.hkReturnPercent,
    aMomentum3,
    hkMomentum3,
    aMomentum5,
    hkMomentum5,
    points,
  };
}
