const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const conditioned = (raw, action) => action === "BUY_SMALL" ? raw * .5 : action === "SELL_PART" ? raw * -.25 : action === "SELL_ALL" ? raw * -1 : action === "BUY" ? raw : 0;
export function resolveReferenceSample(sample, bars) {
  const entry = finite(sample.entryPrice); const i = sample.entryIndex; const raw = {};
  for (const h of [1,3,5,10]) { const p = finite(bars[i+h]?.price ?? bars[i+h]?.close); raw[`${h}m`] = entry !== null && p !== null ? p / entry - 1 : null; }
  const direction = sample.signal === "SELL" ? -1 : 1; const path = bars.slice(i+1,i+11).map(b=>finite(b.price??b.close)).filter(v=>v!==null).map(p=>(p/entry-1)*direction); const pnl=raw["5m"]===null?null:raw["5m"]*direction;
  return { sampleId:sample.sampleId,timestamp:sample.timestamp,future1mReturn:raw["1m"],future3mReturn:raw["3m"],future5mReturn:raw["5m"],future10mReturn:raw["10m"],mfe:path.length?Math.max(...path):null,mae:path.length?Math.min(...path):null,actionConditionedReturnRate:conditioned(pnl,sample.action),reward:conditioned(pnl,sample.action) };
}
export function resolveReferenceSamples(samples, bars) { return samples.map(sample=>resolveReferenceSample(sample,bars)); }
