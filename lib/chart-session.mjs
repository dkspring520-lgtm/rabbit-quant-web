import {isAShareRegularTradingMinute} from './intraday-axis.mjs';
// Fetch time is transport metadata, never a trading date.
export function tradingDate(value) {
  if(typeof value!=='string')return null;
  const match=value.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if(!match)return null;
  const [,y,m,d]=match;
  const date=new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===`${y}-${m}-${d}`?`${y}-${m}-${d}`:null;
}
export function snapshotTradingDate(data) {
  return tradingDate(data?.sampleDate)||tradingDate(data?.sourceTimestamp)||null;
}
export function selectChartSession(snapshots, options={}) {
  return selectDatedChartSession(snapshots, options);
}

export function currentChartWindow(now) {
  if(!now || !Number.isFinite(now.getTime())) return {date:null,cutoff:null};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const date=`${parts.year}-${parts.month}-${parts.day}`;
  const time=parts.hour+parts.minute;
  const cutoff=['Sat','Sun'].includes(parts.weekday)||time<'0930'?null:time<'1300'&&time>'1130'?'1130':time>'1500'?'1500':time;
  return {date,cutoff};
}

// A quote date cannot certify a minute series. Only the minute source's own
// date (row date or explicit session date) is accepted.
/**
 * @template {{time:string,date?:string|null}} T
 * @param {T[]} minutes
 * @param {{date:string|null,cutoff:string|null}} window
 * @param {string|null} sessionDate
 * @returns {(T & {date:string})[]}
 */
export function filterChartMinutes(minutes, {date,cutoff}, sessionDate=null) {
  if(!date||!cutoff)return [];
  return minutes.filter(p=>tradingDate(p.date??sessionDate)===date && /^\d{4}$/.test(p.time) && isAShareRegularTradingMinute(p.time) && p.time<=cutoff)
    .map(p=>({...p,date}));
}

function selectDatedChartSession(snapshots, {mode='current',now=null,date:requestedDate=null,code=null}) {
  const current=currentChartWindow(now);
  const historyDate=tradingDate(requestedDate);
  const window=mode==='history'
    ? {date:historyDate,cutoff:current.date&&historyDate>=current.date?(historyDate===current.date?current.cutoff:null):'1500'}
    : current;
  const valid=snapshots.filter(d=>d&&(!code||d.quote?.code===code));
  for(const data of valid){
    const minutes=filterChartMinutes(data.minutes??[],window,data.minuteDate??data.sampleDate);
    if(minutes.length)return {date:window.date,minutes};
    for(const session of data.intradaySessions??[]){
      const minutes=filterChartMinutes(session.minutes??[],window,session.date);
      if(minutes.length)return {date:window.date,minutes};
    }
  }
  return {date:window.date,minutes:[]};
}

export function chartSessionNotice({now,minutes,quoteDate,phase,error=false}) {
  const {date}=currentChartWindow(now);
  const last=minutes.at(-1)?.time;
  const label=phase==='lunch'?'午间休市':phase==='morning'||phase==='afternoon'?'今日分时':phase==='closed'||phase==='closing'||phase==='afterhours'?'收盘分时':'盘前待开';
  const time=last?`${last.slice(0,2)}:${last.slice(2)}`:null;
  const mismatch=quoteDate!==date?`报价日期${quoteDate??'未知'}，与今日图未对齐` : '';
  return {label,detail:[`${date??'日期未知'} · ${time?`截至${time}`:'今日分时待数据'}`,error&&time?'更新失败，保留同日旧图':'',mismatch].filter(Boolean).join(' · ')};
}

// Date-qualified keys prevent an old 15:00 bar surviving the next morning.
/** @param {Date|null} now */
export function mergeDatedMinuteMap(current, incoming, date, now=null) {
  date=tradingDate(date);
  if(!date)return current;
  if(now&&date!==currentChartWindow(now).date)return current;
  const latest=Object.keys(current).map(k=>k.slice(0,10)).filter(d=>tradingDate(d)).sort().at(-1);
  if(latest&&date<latest)return current;
  const next=Object.fromEntries(Object.entries(current).filter(([key])=>key.startsWith(date+':')));
  for(const [time,value] of Object.entries(incoming))if(/^\d{4}$/.test(time))next[`${date}:${time}`]=value;
  return next;
}

export function currentMinuteMap(current, now) {
  const {date,cutoff}=currentChartWindow(now);
  return Object.fromEntries(Object.entries(current).filter(([key])=>date&&cutoff&&key.startsWith(date+':')&&key.slice(11)<=cutoff).map(([key,value])=>[key.slice(11),value]));
}
