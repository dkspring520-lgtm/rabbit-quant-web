import {useEffect,useState} from 'react';
import {advanceSlice} from '../lib/slice-alerts.mjs';
export function SliceScorePanel({available,buy,sell,time,price}:{available:boolean;buy:number;sell:number;time:string;price:number}) {
  const [state,setState]=useState<any>({levels:{},events:[]});
  useEffect(()=>{setState((previous:any)=>advanceSlice(previous,{available,buy,sell,time,price}));},[available,buy,sell,time,price]);
  const labels:Record<number,string>={0:'等待',50:'观察',60:'小切片',70:'中切片',80:'大切片',90:'最高档'};
  return <section className="order-flow-score-row" aria-label="日内切片评分"><span>切片状态 · {available?'实时观察':'暂停判断'} · 评分非胜率</span><b className="buy"><span>买入评分 · {available?labels[state.levels.buy??0]:'待数据'}</span><strong>{available?Math.round(buy):'—'}</strong></b><b className="sell"><span>卖出评分 · {available?labels[state.levels.sell??0]:'待数据'}</span><strong>{available?Math.round(sell):'—'}</strong></b><span role="status">{available&&state.events.length?`最近事件：${state.events.at(-1).time} ${state.events.at(-1).side==='buy'?'买方':'卖方'}进入 ${state.events.at(-1).level} 档`:'等待有效评分事件'}</span></section>;
}
