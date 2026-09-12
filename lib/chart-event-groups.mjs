// Display grouping only. Does not create signals or alter source events.
export function groupChartEvents(paths=[],observations=[],scores=[]) {
  const groups=new Map();
  for(const [type,events] of [['path',paths],['observation',observations],['score',scores]]) {
    for(const event of events) {
      if(!/^\d{4}$/.test(event.time)||!Number.isFinite(event.price))continue;
      const id=`${event.time}:${Math.round(event.price*100)}`;
      if(!groups.has(id))groups.set(id,{id,time:event.time,price:event.price,layers:[]});
      groups.get(id).layers.push({type,id:event.id,label:type==='score'?(event.side==='buy'?'买方':'卖方'):event.label??event.state,score:event.score,side:event.side,reasons:[...(event.reasons??[])]});
    }
  }
  return [...groups.values()].sort((a,b)=>a.time.localeCompare(b.time)||a.price-b.price).map(group=>{
    const scores=group.layers.filter(layer=>layer.type==='score');
    const observation=group.layers.find(layer=>layer.type==='observation');
    const path=group.layers.find(layer=>layer.type==='path');
    const context=observation?.label??path?.label;
    const conflict=scores.some(s=>s.side==='buy')&&scores.some(s=>s.side==='sell');
    const label=scores.length?`${context?`${context} · `:''}${conflict?'买卖分歧':scores.map(s=>`${s.label}${s.score}分`).join(' / ')}`:observation?`${observation.label} · 观察${observation.score}分`:`${path?.label??'路径'} · 观察`;
    const shortLabel=scores.length?(conflict?'买卖分歧':scores.map(s=>`${s.label}${s.score}分`).join(' / ')):'';
    return {...group,label,shortLabel,side:conflict?'neutral':scores[0]?.side??'neutral'};
  });
}
