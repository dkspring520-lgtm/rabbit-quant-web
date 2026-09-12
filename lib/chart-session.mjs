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
export function selectChartSession(snapshots) {
  const valid=snapshots.filter(Boolean);
  const reference=valid.map(snapshotTradingDate).find(Boolean);
  for(const data of valid){
    const date=snapshotTradingDate(data);
    if(data.minutes?.length&&date&&(!reference||date===reference))return {date,minutes:data.minutes};
  }
  const sessions=valid.flatMap(data=>data.intradaySessions??[])
    .map(session=>({...session,date:tradingDate(session.date)}))
    .filter(session=>session.date&&session.minutes?.length&&(!reference||session.date<=reference))
    .sort((a,b)=>b.date.localeCompare(a.date));
  if(sessions.length)return {date:sessions[0].date,minutes:sessions[0].minutes};
  // Undated rows can be viewed, but must not receive a fabricated date.
  const undated=valid.find(data=>data.minutes?.length&&!snapshotTradingDate(data));
  return {date:undated?null:reference??null,minutes:undated?.minutes??[]};
}
