const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function median(values) {
  const clean = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function normalize(minutes) {
  return (Array.isArray(minutes) ? minutes : []).map(row => {
    const l2 = row?.l2?.l2Bar ?? row?.l2Bar ?? row;
    const price = finite(row?.price ?? l2?.price);
    const bigBuy = Math.max(0, finite(l2?.bigBuyNotional ?? row?.l2?.flow?.bigBuyNotional60s) ?? 0);
    const bigSell = Math.max(0, finite(l2?.bigSellNotional ?? row?.l2?.flow?.bigSellNotional60s) ?? 0);
    const activeBuy = Math.max(0, finite(l2?.activeBuyNotional ?? row?.l2?.flow?.activeBuyNotional60s) ?? 0);
    const activeSell = Math.max(0, finite(l2?.activeSellNotional ?? row?.l2?.flow?.activeSellNotional60s) ?? 0);
    return {
      time:String(row?.time ?? l2?.time ?? "").replace(/\D/g, "").slice(-4),
      price,
      volume:Math.max(0, finite(row?.volume ?? l2?.volume) ?? 0),
      bigBuy,
      bigSell,
      bigBuyVolume:Math.max(0, finite(l2?.bigBuyVolume) ?? 0),
      bigSellVolume:Math.max(0, finite(l2?.bigSellVolume) ?? 0),
      bigNet:bigBuy - bigSell,
      activeBuy,
      activeSell,
      activeNet:activeBuy - activeSell,
      displayedBigBuy:finite(l2?.displayedBigBuyNotional ?? row?.l2?.book?.displayedBigBuyNotional),
      cancelledBigBuy:finite(l2?.cancelledBigBuyNotional ?? row?.l2?.book?.cancelledBigBuyNotional),
    };
  }).filter(row => row.price > 0 && /^\d{4}$/.test(row.time));
}

function scoreLabel(score) {
  if (score >= 85) return "强资金推动·禁止追高";
  if (score >= 75) return "真实买盘确认";
  if (score >= 65) return "资金流入待确认";
  if (score >= 50) return "异常大单·继续观察";
  return "普通资金波动";
}

function buildStateMachine(rows, latest, context) {
  const {baseline, structure, absorption, inverseAbsorption, confirmed} = context;
  const candidates = rows
    .map((row, index) => ({...row,index,scale:baseline > 0 ? Math.abs(row.bigNet) / baseline : 0}))
    .filter(row => row.bigNet !== 0 && (row.scale >= 1.5 || Math.abs(row.bigNet) >= 500_000));
  const event = candidates.at(-1);
  if (!event) {
    return {state:"idle", label:"等待异常资金", ageMinutes:null, triggerPrice:null, costPrice:null, expiresAt:null};
  }
  const ageMinutes = Math.max(0, rows.length - 1 - event.index);
  const side = event.bigNet > 0 ? "buy" : "sell";
  // The candidate is built from actual L2 prints, not a displayed order. Once
  // its relative/absolute size qualifies, later retest minutes may carry little
  // or no new big print and must not erase the original event confirmation.
  const eventQualified = confirmed || event.scale >= 1.5 || Math.abs(event.bigNet) >= 500_000;
  const volume = side === "buy" ? event.bigBuyVolume : event.bigSellVolume;
  const notional = side === "buy" ? event.bigBuy : event.bigSell;
  const costPrice = volume > 0 ? notional / volume : event.price;
  const after = rows.slice(event.index);
  const prices = after.map(row => row.price);
  const peak = Math.max(...prices);
  const trough = Math.min(...prices);
  const pricePushPct = side === "buy"
    ? (peak - event.price) / event.price * 100
    : (event.price - trough) / event.price * 100;
  const pullbackPct = side === "buy"
    ? (peak - latest.price) / peak * 100
    : (latest.price - trough) / trough * 100;
  const recent = rows.slice(-3);
  const activeNet = recent.reduce((sum, row) => sum + row.activeNet, 0);
  const reaccelerating = side === "buy"
    ? latest.price > (recent.at(-2)?.price ?? latest.price) && activeNet > 0
    : latest.price < (recent.at(-2)?.price ?? latest.price) && activeNet < 0;
  const costHeld = side === "buy" ? latest.price >= costPrice * .9985 : latest.price <= costPrice * 1.0015;
  const vwap = finite(structure?.vwap);
  const referenceRecovered = vwap == null || (side === "buy" ? latest.price >= vwap : latest.price <= vwap);
  const expired = ageMinutes > 15;
  const invalid = side === "buy" ? latest.price < costPrice * .997 : latest.price > costPrice * 1.003;

  let state = "discovered";
  let label = "异常资金，暂不操作";
  let triggerPrice = null;
  if (expired) {
    state = "expired";
    label = "资金事件已过期·重新计算";
  } else if (invalid) {
    state = "invalid";
    label = side === "buy" ? "跌破大单成本区·正T失效" : "突破大单成本区·反T失效";
  } else if (absorption || inverseAbsorption) {
    state = "absorbed";
    label = absorption ? "买盘被吸收·警惕反T" : "卖压被承接·警惕修复";
  } else if (ageMinutes <= 1 || pricePushPct < .06) {
    state = "confirming";
    label = "真实成交确认中";
  } else if (eventQualified && pricePushPct >= .06 && pullbackPct < .06) {
    state = "waiting-pullback";
    label = side === "buy" ? "买盘有效·禁止追高" : "卖压有效·等待反抽";
  } else if (
    eventQualified
    && ageMinutes >= 2
    && ageMinutes <= 8
    && pullbackPct >= .06
    && costHeld
    && referenceRecovered
    && reaccelerating
  ) {
    state = side === "buy" ? "positive-t-confirmed" : "reverse-t-confirmed";
    label = side === "buy" ? "回踩不破并转强·正T确认" : "反抽失败再转弱·反T确认";
    triggerPrice = latest.price;
  } else if (eventQualified) {
    state = "waiting-retest";
    label = side === "buy" ? "等待缩量回踩确认" : "等待反抽失败确认";
  }
  return {
    state,
    label,
    side,
    eventTime:event.time,
    ageMinutes,
    triggerPrice,
    costPrice,
    pricePushPct,
    pullbackPct,
    costHeld,
    referenceRecovered,
    eventQualified,
    expiresAt:Math.min(15, ageMinutes) === 15 ? "已到期" : `剩余约 ${15 - ageMinutes} 分钟`,
  };
}

/**
 * Research-only large-order authenticity assessment. Missing cancellation or
 * same-time history stays explicitly unavailable and never receives points.
 */
export function evaluateZijinLargeOrder({
  minutes = [],
  structure = null,
  sameTimeMedianNotional = null,
} = {}) {
  const rows = normalize(minutes);
  const latest = rows.at(-1);
  if (!latest) {
    return {ready:false, score:0, label:"等待逐笔主动成交", confirmed:false, absorption:false, executable:false};
  }
  const recent = rows.slice(-3);
  const trailing = rows.slice(Math.max(0, rows.length - 23), Math.max(0, rows.length - 3));
  const historicalBaseline = finite(sameTimeMedianNotional);
  const trailingBaseline = median(trailing.map(row => Math.abs(row.bigNet)));
  const baseline = historicalBaseline > 0 ? historicalBaseline : trailingBaseline;
  const baselineSource = historicalBaseline > 0 ? "20日同分钟中位数" : trailingBaseline > 0 ? "当日已出现分钟滚动中位数" : "基线不足";
  const abnormality = baseline > 0 ? Math.abs(latest.bigNet) / baseline : null;
  const relativeScaleScore = abnormality == null ? 0 : clamp((abnormality - .8) / 2.2 * 100, 0, 100);

  const displayed = latest.displayedBigBuy;
  const fillRate = displayed > 0 ? clamp(latest.bigBuy / displayed, 0, 1) : null;
  const fillScore = fillRate == null ? 0 : fillRate * 100;
  const cancellationRate = latest.cancelledBigBuy != null && displayed > 0
    ? clamp(latest.cancelledBigBuy / displayed, 0, 1)
    : null;

  const startPrice = recent[0]?.price ?? latest.price;
  const priceChangePct = (latest.price - startPrice) / startPrice * 100;
  const totalActive = recent.reduce((sum, row) => sum + Math.abs(row.activeNet), 0);
  const netActive = recent.reduce((sum, row) => sum + row.activeNet, 0);
  const priceImpact = latest.bigNet >= 0
    ? clamp(priceChangePct / .35 * 100, 0, 100)
    : clamp(-priceChangePct / .35 * 100, 0, 100);
  const alignedMinutes = recent.filter(row => latest.bigNet >= 0 ? row.bigNet > 0 : row.bigNet < 0).length;
  const persistenceScore = alignedMinutes / Math.max(1, recent.length) * 100;

  const last = latest.price;
  const support = finite(structure?.support);
  const resistance = finite(structure?.resistance);
  const vwap = finite(structure?.vwap);
  let locationScore = 45;
  if (latest.bigNet >= 0) {
    if (support && Math.abs(last - support) / last <= .006) locationScore += 30;
    if (vwap && last >= vwap) locationScore += 15;
    if (resistance && last > resistance * 1.006) locationScore -= 20;
  } else {
    if (resistance && Math.abs(last - resistance) / last <= .006) locationScore += 30;
    if (vwap && last <= vwap) locationScore += 15;
    if (support && last < support * .994) locationScore -= 20;
  }
  locationScore = clamp(locationScore, 0, 100);

  const directionConflict = latest.bigNet > 0 && structure?.directionScore < -35
    || latest.bigNet < 0 && structure?.directionScore > 35;
  const highLevelLure = latest.bigNet > 0 && resistance && last >= resistance && priceChangePct <= .03;
  const largeFlow = abnormality != null ? abnormality >= 1.5 : Math.abs(latest.bigNet) >= Math.max(1, latest.activeBuy + latest.activeSell) * .2;
  const absorption = latest.bigNet > 0
    && largeFlow
    && netActive > 0
    && priceChangePct <= .04
    && recent.length >= 2;
  const inverseAbsorption = latest.bigNet < 0
    && largeFlow
    && netActive < 0
    && priceChangePct >= -.04
    && recent.length >= 2;

  const availableWeights = [
    [relativeScaleScore, baseline > 0 ? .20 : 0],
    [fillScore, fillRate != null ? .25 : 0],
    [priceImpact, .20],
    [persistenceScore, .20],
    [locationScore, .15],
  ];
  const weight = availableWeights.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  let score = weight ? availableWeights.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight : 0;
  if (cancellationRate != null) score -= cancellationRate * 28;
  if (highLevelLure) score -= 18;
  if (directionConflict) score -= 16;
  if (absorption || inverseAbsorption) score -= 28;
  score = Math.round(clamp(score, 0, 100));

  const confirmed = score >= 75 && !absorption && !inverseAbsorption && !directionConflict;
  const stateMachine = buildStateMachine(rows, latest, {
    baseline,
    structure,
    absorption,
    inverseAbsorption,
    confirmed,
  });
  return {
    ready:true,
    asOfTime:latest.time,
    side:latest.bigNet > 0 ? "buy" : latest.bigNet < 0 ? "sell" : "neutral",
    score,
    label:scoreLabel(score),
    confirmed,
    stateMachine,
    abnormality,
    baseline,
    baselineSource,
    fillRate,
    cancellationRate,
    priceImpactPct:priceChangePct,
    persistence:{aligned:alignedMinutes, samples:recent.length},
    absorption,
    inverseAbsorption,
    directionConflict,
    highLevelLure,
    netNotional:latest.bigNet,
    activeNetNotional:netActive,
    totalActiveNotional:totalActive,
    components:{
      relativeScale:Math.round(relativeScaleScore),
      actualFill:fillRate == null ? null : Math.round(fillScore),
      priceImpact:Math.round(priceImpact),
      persistence:Math.round(persistenceScore),
      structureLocation:Math.round(locationScore),
    },
    unavailable:[
      ...(fillRate == null ? ["大额挂单实际成交率"] : []),
      ...(cancellationRate == null ? ["大额撤单率"] : []),
      ...(historicalBaseline == null ? ["20日同分钟基线"] : []),
    ],
    reason:absorption
      ? "大额主动净买明显，但价格未被推动，判为买盘被吸收/出货风险"
      : inverseAbsorption
        ? "大额主动净卖明显，但价格抗跌，判为卖压被承接"
        : confirmed
          ? "大额成交、价格推动、持续性与结构位置共同确认"
          : "大单仅作异常资金证据，尚未满足真实性确认",
    executable:false,
    affectsV4:false,
  };
}
