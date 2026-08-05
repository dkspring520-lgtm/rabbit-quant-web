const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

/**
 * Summarises the all-day relationship between L2 large active orders and price.
 * This is an observation layer only: it never identifies a trading entity and
 * must not be used as an order trigger.
 */
export function summarizeZijinMainForceIntent(bars = []) {
  const usable = bars.filter(row => Number.isFinite(Number(row?.price)) && Number(row.price) > 0);
  const active = usable.filter(row => finite(row.bigBuyNotional) + finite(row.bigSellNotional) > 0);
  if (active.length < 3) {
    return {
      available: false,
      state: "waiting",
      label: "暂不判断",
      confidence: 0,
      message: "等待足够的大额主动成交",
      evidence: "当前 L2 分钟样本不足",
    };
  }

  const totals = active.reduce((result, row) => ({
    buy: result.buy + Math.max(0, finite(row.bigBuyNotional)),
    sell: result.sell + Math.max(0, finite(row.bigSellNotional)),
  }), {buy: 0, sell: 0});
  const gross = totals.buy + totals.sell;
  if (gross <= 0) return summarizeZijinMainForceIntent([]);

  const net = totals.buy - totals.sell;
  const side = Math.sign(net);
  const dominance = Math.abs(net) / gross;
  const priceChangePercent = (finite(active.at(-1).price) - finite(active[0].price)) / finite(active[0].price) * 100;
  const persistence = active.filter(row => Math.sign(finite(row.bigBuyNotional) - finite(row.bigSellNotional)) === side).length / active.length;
  const recent = active.slice(-Math.min(8, active.length));
  const recentNet = recent.reduce((sum, row) => sum + finite(row.bigBuyNotional) - finite(row.bigSellNotional), 0);
  const recentAligned = side !== 0 && Math.sign(recentNet) === side;
  const confidence = Math.round(clamp(24 + dominance * 42 + persistence * 22 + (recentAligned ? 12 : 0), 0, 95));
  const priceUp = priceChangePercent >= 0.08;
  const priceDown = priceChangePercent <= -0.08;

  let state = "waiting";
  let label = "多空分歧";
  let message = "大额买卖力量接近，等待价格选择方向";
  if (dominance < 0.08 || side === 0) {
    state = "waiting";
  } else if (side > 0 && priceUp) {
    state = "accumulation";
    label = "承接偏强";
    message = "大额净买与价格上行同向，关注承接是否延续";
  } else if (side > 0 && priceDown) {
    state = "absorbed";
    label = "下跌承接";
    message = "大额净买出现但价格仍弱，先观察止跌确认";
  } else if (side > 0) {
    state = "accumulation";
    label = "买盘观察";
    message = "大额净买占优，价格响应仍需确认";
  } else if (priceDown) {
    state = "outflow";
    label = "派发压力";
    message = "大额净卖与价格走弱同向，注意卖压延续";
  } else if (priceUp) {
    state = "outflow";
    label = "冲高分歧";
    message = "价格上行但大额净卖占优，留意冲高回落";
  } else {
    state = "outflow";
    label = "卖压观察";
    message = "大额净卖占优，价格响应仍需确认";
  }

  return {
    available: true,
    state,
    label,
    confidence,
    message,
    evidence: `全天 ${active.length} 个 L2 分钟点 · 大额净额${net >= 0 ? "+" : ""}${Math.round(net / 10_000)}万 · 价格响应${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}%`,
  };
}
