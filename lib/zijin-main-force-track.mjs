const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

/**
 * Builds the Zijin all-day large-print tracker from data observed up to each
 * minute. Every bar uses its own trailing reference, so later packets cannot
 * repaint an earlier bar.
 */
export function buildZijinMainForceTrack(minutes = []) {
  const source = minutes
    .map(row => ({
      time: String(row?.time ?? "").replace(/\D/g, "").slice(0, 4),
      bigBuyNotional: Math.max(0, finite(row?.bigBuyNotional)),
      bigSellNotional: Math.max(0, finite(row?.bigSellNotional)),
      activeBuyNotional: Math.max(0, finite(row?.activeBuyNotional)),
      activeSellNotional: Math.max(0, finite(row?.activeSellNotional)),
      activeBuyRatio: Number.isFinite(Number(row?.activeBuyRatio)) ? Number(row.activeBuyRatio) : null,
      bigBuyCount: Math.max(0, Math.round(finite(row?.bigBuyCount))),
      bigSellCount: Math.max(0, Math.round(finite(row?.bigSellCount))),
    }))
    .filter(row => /^\d{4}$/.test(row.time) && row.time >= "0930" && row.time <= "1500")
    .sort((left, right) => left.time.localeCompare(right.time));

  let cumulativeNetNotional = 0;
  const bars = source.map((row, index) => {
    const netNotional = row.bigBuyNotional - row.bigSellNotional;
    const trailing = source
      .slice(Math.max(0, index - 19), index + 1)
      .map(item => Math.abs(item.bigBuyNotional - item.bigSellNotional))
      .filter(value => value > 0);
    const reference = Math.max(1, percentile(trailing, .9));
    const strength = Math.sign(netNotional) * Math.min(1.25, Math.sqrt(Math.abs(netNotional) / reference));
    cumulativeNetNotional += netNotional;
    return {...row, netNotional, cumulativeNetNotional, strength};
  });

  const totals = bars.reduce((result, row) => ({
    bigBuyNotional: result.bigBuyNotional + row.bigBuyNotional,
    bigSellNotional: result.bigSellNotional + row.bigSellNotional,
    netNotional: result.netNotional + row.netNotional,
    bigBuyCount: result.bigBuyCount + row.bigBuyCount,
    bigSellCount: result.bigSellCount + row.bigSellCount,
  }), {bigBuyNotional: 0, bigSellNotional: 0, netNotional: 0, bigBuyCount: 0, bigSellCount: 0});

  const recent = bars.slice(-3);
  const positive = recent.filter(row => row.netNotional > 0).length;
  const negative = recent.filter(row => row.netNotional < 0).length;
  const stance = !bars.some(row => row.bigBuyNotional + row.bigSellNotional > 0)
    ? "等待大额成交"
    : positive >= 2 ? "大额买入延续"
      : negative >= 2 ? "大额卖出延续"
        : totals.netNotional > 0 ? "全天净买占优"
          : totals.netNotional < 0 ? "全天净卖占优"
            : "大额资金均衡";
  return {bars, totals, stance};
}
