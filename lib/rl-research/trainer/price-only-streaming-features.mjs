export const PRICE_ONLY_STREAM_VERSION = "price-only-streaming-v0.2";
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const standardDeviation = values => values.length > 1 ? Math.sqrt(Math.max(0, values.reduce((sum, value) => sum + (value - mean(values)) ** 2, 0) / values.length)) : null;
class RingBuffer {
  constructor(limit) { this.limit = limit; this.values = []; }
  push(value) { this.values.push(value); if (this.values.length > this.limit) this.values.shift(); }
  atFromEnd(offset) { return this.values[this.values.length - 1 - offset]; }
  last(count) { return this.values.slice(Math.max(0, this.values.length - count)); }
}
export class PriceOnlyFeatureContext {
  constructor() { this.date=""; this.prices=new RingBuffer(61); this.returns=new RingBuffer(61); this.volumes=new RingBuffer(61); this.currentPrice=null; this.previousClose=null; this.runningHigh=null; this.runningLow=null; this.sessionPV=0; this.sessionVolume=0; }
  resetSession(date, previousClose=null) { this.date=date; this.previousClose=finite(previousClose); this.runningHigh=null; this.runningLow=null; this.sessionPV=0; this.sessionVolume=0; }
  update(row) {
    const date=String(row.timestamp).slice(0,10); if(date!==this.date)this.resetSession(date,row.previousClose); if(this.previousClose===null&&finite(row.previousClose)!==null)this.previousClose=finite(row.previousClose);
    const price=finite(row.price); if(price===null)return null; const volume=finite(row.volume)??0; const priorPrice=this.prices.atFromEnd(0); const currentReturn=priorPrice===undefined?null:price/priorPrice-1;
    this.currentPrice=price; this.runningHigh=this.runningHigh===null?price:Math.max(this.runningHigh,price); this.runningLow=this.runningLow===null?price:Math.min(this.runningLow,price); this.sessionPV+=price*volume; this.sessionVolume+=volume;
    const returnAt=h=>{const historicalPrice=this.prices.atFromEnd(h-1);return historicalPrice===undefined?null:price/historicalPrice-1;}; const priorReturns=this.returns.last(60).filter(value=>value!==null); const volatility=h=>standardDeviation([...priorReturns.slice(-(h-1)),...(currentReturn===null?[]:[currentReturn])].slice(-h)); const priorVolumes=this.volumes.last(60); const volumeRatio=h=>volume/(mean(priorVolumes.slice(-h))||volume||1); const priorVolume20=priorVolumes.slice(-20); const vwap=this.sessionVolume?this.sessionPV/this.sessionVolume:null; const minute=Number(String(row.timestamp).slice(11,13))*60+Number(String(row.timestamp).slice(14,16));
    const features={return_1m:returnAt(1),return_3m:returnAt(3),return_5m:returnAt(5),return_10m:returnAt(10),return_20m:returnAt(20),return_from_previous_close:price&&this.previousClose?price/this.previousClose-1:null,price_vs_session_vwap:price&&vwap?price/vwap-1:null,drawdown_from_running_high:price/this.runningHigh-1,rebound_from_running_low:price/this.runningLow-1,rolling_return_std_5:volatility(5),rolling_return_std_20:volatility(20),rolling_return_std_60:volatility(60),volume_ratio_5:volumeRatio(5),volume_ratio_20:volumeRatio(20),volume_ratio_60:volumeRatio(60),volume_zscore:(volume-(mean(priorVolume20)||volume))/(standardDeviation(priorVolume20)||1),runningHigh:this.runningHigh,runningLow:this.runningLow,minuteOfSession:minute>=570?minute-570:0,minutesSinceOpen:minute>=780?minute-780+120:Math.max(0,minute-570),isMorning:minute>=570&&minute<=690,isAfternoon:minute>=781&&minute<=900};
    this.prices.push(price); this.returns.push(currentReturn); this.volumes.push(volume); return features;
  }
}
export function buildPriceOnlyFeaturesStreaming(rows=[]){const context=new PriceOnlyFeatureContext();return rows.map(row=>context.update(row));}
