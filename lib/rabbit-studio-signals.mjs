// Adapt stored account signals; never derive a trade from a chart shape.
export function studioSignals(alerts, code, date) {
  const unique = new Map();
  for (const alert of Array.isArray(alerts) ? alerts : []) {
    if (alert.code !== code || String(alert.marketDate ?? alert.payload?.marketDate ?? '').replace(/\D/g, '') !== date) continue;
    if (!['formal', 'candidate'].includes(alert.level)) continue;
    const data = alert.level === 'formal' ? alert.payload?.action : alert.payload?.observation;
    if (!data) continue;
    const time = String(alert.marketTime ?? data.time ?? '').replace(':', '');
    const price = Number(data.price);
    if (!/^\d{4}$/.test(time) || !Number.isFinite(price) || price <= 0) continue;
    const side = alert.level === 'formal' ? (/卖/.test(data.side) ? 'sell' : /买/.test(data.side) ? 'buy' : null) : data.direction === '反T' ? 'sell' : data.direction === '正T' ? 'buy' : null;
    if (!side) continue;
    const score = typeof data.score === 'number' && Number.isFinite(data.score) && data.score >= 0 && data.score <= 100 ? Math.round(data.score) : null;
    const label = alert.level === 'formal' ? (side === 'buy' ? '正式买' : '正式卖') : (side === 'buy' ? '候买' : '候卖');
    const key = `${time}:${side}`;
    const previous = unique.get(key);
    if (previous?.level === 'formal') continue;
    unique.set(key, { id: String(alert.eventKey ?? alert.id), time, price, side, level: alert.level, score, label, reason: String(data.reason ?? alert.message ?? '暂无补充依据') });
  }
  return [...unique.values()].sort((a, b) => a.time.localeCompare(b.time));
}
