export const PATH_CONFIG = Object.freeze({flatGap:.003,extremeGap:.03,window:5,enter:0.7,exit:0.25});
// Closed minutes only: later observations cannot change an earlier event.
export function openingPathEvents(minutes, previousClose, config=PATH_CONFIG) {
  const rows=minutes.filter(r=>Number.isFinite(r.price)&&r.price>0);
  if(!rows.length||!(previousClose>0))return [];
  const open=rows[0].open>0?rows[0].open:rows[0].price;
  const gap=open/previousClose-1;
  const background=Math.abs(gap)>=config.extremeGap?(gap<0?'极端低开':'极端高开'):Math.abs(gap)<config.flatGap?'平开':gap<0?'低开':'高开';
  const events=[]; let direction=0;
  for(let i=config.window;i<rows.length;i++){
    const row=rows[i], prior=rows.slice(i-config.window,i);
    const time=String(row.time).replace(/\D/g,'').slice(0,4);
    if(!/^\d{4}$/.test(time)||time<'0935'||time>'1456'||(time>'1129'&&time<'1300'))continue;
    const range=Math.max(...prior.map(r=>r.high??r.price))-Math.min(...prior.map(r=>r.low??r.price));
    const scale=Math.max(range,open*.001);
    const move=(row.price-prior[0].price)/scale;
    const vwap=Number(row.averagePrice);
    const up=row.price>Math.max(...prior.map(r=>r.price));
    const down=row.price<Math.min(...prior.map(r=>r.price));
    const proposed=move>config.enter&&up?1:move< -config.enter&&down?-1:Math.abs(move)<config.exit?0:direction;
    if(proposed===direction)continue;
    const reasons=[proposed>0?'突破此前局部高点':proposed<0?'跌破此前局部低点':'动量收敛，转为震荡观察'];
    if(vwap>0)reasons.push(row.price>=vwap?'价格位于VWAP上方':'价格位于VWAP下方');
    const reversed=direction!==0&&proposed!==0&&direction!==proposed;
    direction=proposed;
    events.push({id:`${time}:${events.length}`,time,price:row.price,side:direction>0?'buy':direction<0?'sell':'neutral',state:`${background} · ${direction>0?(gap<0?'修复走强':'上涨延续'):direction<0?(gap>0?'回落修复':'下跌延续'):'震荡观察'}`,reasons,reversed,executionAllowed:false});
  }
  return events;
}
