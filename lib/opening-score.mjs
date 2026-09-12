// Observation only. Thresholds are heuristic, not calibrated probabilities.
export function openingScoreEvents(minutes, previousClose) {
  if (!(previousClose > 0)) return [];
  const rows = minutes.filter(r => /^\d{4}$/.test(r.time) && ((r.time >= '0930' && r.time <= '1129') || (r.time >= '1300' && r.time <= '1456')) && Number.isFinite(r.price) && r.price > 0);
  if (!rows.length || rows[0].time !== '0930') return [];
  const open = rows[0].open > 0 ? rows[0].open : rows[0].price;
  const gap = open / previousClose - 1;
  const background = Math.abs(gap) >= .03 ? (gap < 0 ? '极端低开' : '极端高开') : Math.abs(gap) < .003 ? '平开' : gap < 0 ? '低开' : '高开';
  const events = [], seen = new Map();
  let direction = 0, episode = 0;
  function emit(row, key, label, score, reasons) {
    const band = Math.min(100, Math.floor(score / 10) * 10);
    if (band < 70 || band <= (seen.get(key) ?? 0)) return;
    seen.set(key, band);
    events.push({id: `${key}:${band}`, time: row.time, price: row.price, label, score: band, reasons, executionAllowed: false});
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Magnitude describes shock severity, never buy/sell confidence.
    if (i === 0 && Math.abs(gap) >= .03) emit(row, 'opening', background, 70 + Math.min(30, (Math.abs(gap) - .03) * 1000 + 1e-8), ['开盘价相对昨收偏离', '冲击强度，不代表后续方向']);
    const move = row.price / open - 1;
    if (row.time < '0935' && Math.abs(move) >= .03) emit(row, `shock:${Math.sign(move)}`, move < 0 ? '开盘急跌' : '开盘急涨', 70 + Math.min(30, (Math.abs(move) - .03) * 1000 + 1e-8), ['相对正式开盘价偏离', '冲击强度，不是买卖信号']);
    if (i < 2) continue;
    const prior = rows.slice(Math.max(0, i - 5), i);
    const up = row.price > Math.max(...prior.map(r => r.price));
    const down = row.price < Math.min(...prior.map(r => r.price));
    const next = up ? 1 : down ? -1 : 0;
    if (!next) continue;
    if (next !== direction) { direction = next; episode++; }
    const reasons = [next > 0 ? '突破此前局部高点' : '跌破此前局部低点'];
    let score = 40;
    const last = prior.at(-1), before = prior.at(-2);
    if ((last.price - before.price) * next > 0) { score += 20; reasons.push('连续同向价格结构'); }
    if (Number.isFinite(row.averagePrice) && (row.price - row.averagePrice) * next > 0) { score += 20; reasons.push(next > 0 ? '价格站上VWAP' : '价格低于VWAP'); }
    const flowRatio = row.activeBuyRatio ?? row.l2?.l2Bar?.activeBuyRatio ?? row.l2?.flow?.activeBuyRatio60s;
    const flowAvailable = row.l2Available === true || (row.l2?.status?.connected === true && row.l2?.status?.authorized !== false && row.l2?.status?.stale !== true && row.l2?.meta?.stale !== true);
    if (flowAvailable && Number.isFinite(flowRatio) && (next > 0 ? flowRatio >= .6 : flowRatio <= .4)) { score += 10; reasons.push('主动成交方向确认'); }
    const volumes = prior.map(r => r.volume);
    if (volumes.every(v => Number.isFinite(v) && v > 0) && row.volume > volumes.reduce((a,b) => a+b,0) / volumes.length * 1.2) { score += 10; reasons.push('成交量放大'); }
    const label = `${background}·${next > 0 ? (gap < 0 || move < 0 ? '修复走强' : '上涨延续') : (gap > 0 || move > 0 ? '回落修复' : '下跌延续')}`;
    emit(row, `path:${episode}`, label, score, reasons);
  }
  return events;
}
