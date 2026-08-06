const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Causal five-minute price/fund response classifier.
 * It reads only completed L2 minute rows available at the evaluation time.
 */
export function evaluateZijinFundResponse(bars = [], windowSize = 5) {
  const window = Math.max(2, windowSize);
  const eligible = bars
    .filter(row => Number.isFinite(Number(row?.price)) && Number(row.price) > 0);
  const usable = eligible.slice(-window);
  const prior = eligible.slice(-window * 2, -window);
  const rowNet = row => Number.isFinite(Number(row?.netNotional))
    ? finite(row.netNotional)
    : finite(row?.bigBuyNotional) - finite(row?.bigSellNotional);

  const gross = usable.reduce(
    (sum, row) => sum + Math.max(0, finite(row.bigBuyNotional)) + Math.max(0, finite(row.bigSellNotional)),
    0,
  );
  if (usable.length < 2 || gross <= 0) {
    return {
      ready: false,
      state: "waiting",
      label: "等待联动",
      score: 0,
      netNotional: 0,
      netFlowAcceleration: 0,
      outflowDecelerating: false,
      positiveTBlocked: false,
      priceChangePercent: 0,
      persistence: 0,
      message: "等待 L2 成交与价格共同确认",
      evidence: "尚无足够的连续分钟数据",
    };
  }

  const first = usable[0];
  const last = usable.at(-1);
  const buyNotional = usable.reduce((sum, row) => sum + Math.max(0, finite(row.bigBuyNotional)), 0);
  const sellNotional = usable.reduce((sum, row) => sum + Math.max(0, finite(row.bigSellNotional)), 0);
  const netNotional = buyNotional - sellNotional;
  const priorNetNotional = prior.reduce((sum, row) => sum + rowNet(row), 0);
  const recentAverageNet = netNotional / usable.length;
  const priorAverageNet = prior.length ? priorNetNotional / prior.length : 0;
  const netFlowAcceleration = recentAverageNet - priorAverageNet;
  const priceChangePercent = (finite(last.price) - finite(first.price)) / finite(first.price) * 100;
  const direction = Math.sign(netNotional);
  const persistence = usable.filter(row => Math.sign(rowNet(row)) === direction).length / usable.length;
  const dominance = gross > 0 ? Math.abs(netNotional) / gross : 0;
  const aligned = direction !== 0
    && Math.sign(priceChangePercent) === direction
    && Math.abs(priceChangePercent) >= .03;
  const outflowAligned = netNotional < 0 && aligned && priceChangePercent <= -.08;
  const outflowDecelerating = outflowAligned
    && prior.length >= 2
    && netFlowAcceleration > Math.max(1, Math.abs(priorAverageNet) * .08);
  const positiveTBlocked = outflowAligned;
  const score = Math.round(clamp(
    (aligned ? 35 : Math.abs(priceChangePercent) < .03 ? 10 : 0)
      + Math.min(25, dominance * 50)
      + persistence * 20
      + Math.min(20, Math.abs(priceChangePercent) / .35 * 20),
    0,
    100,
  ));

  let state = "waiting";
  let label = "等待联动";
  let message = "资金与价格尚未形成同向确认";
  if (netNotional > 0 && aligned && priceChangePercent >= .1) {
    state = "push";
    label = "有效推升";
    message = "净买入与价格同向，等待回踩确认";
  } else if (netNotional > 0 && (priceChangePercent <= -.05 || (dominance >= .28 && priceChangePercent < .03))) {
    state = "absorbed";
    label = "买盘被吸收";
    message = "净买入未推动价格，暂不追涨";
  } else if (netNotional > 0) {
    state = "accumulation";
    label = "吸筹观察";
    message = "净买入增加，价格响应仍待确认";
  } else if (outflowAligned) {
    state = "outflow";
    label = "主动流出";
    message = outflowDecelerating
      ? "主动净卖仍与价格同向，但卖压正在放缓；正T继续等待净卖状态解除"
      : "主动净卖与价格同向，暂锁正T候选，注意回落";
  } else if (netNotional < 0) {
    state = "waiting";
    label = "卖压待确认";
    message = "净卖出出现，但价格尚未同步走弱";
  }

  return {
    ready: true,
    state,
    label,
    score,
    netNotional,
    netFlowAcceleration,
    outflowDecelerating,
    positiveTBlocked,
    priceChangePercent,
    persistence,
    message,
    evidence: `近${usable.length}分钟 · 资金连续度${Math.round(persistence * 100)}% · 价格响应${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}%`,
  };
}
