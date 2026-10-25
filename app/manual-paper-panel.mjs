import React,{useEffect,useState} from 'react';
import {openManualPaperSession,executeManualPaperOrder} from '../lib/paper-trading/manual-session.mjs';

/** @param {{accountKey:string,symbol:string}} props */
export function ManualPaperPanel({accountKey,symbol}) {
  const [session,setSession]=useState(null);
  const [snapshot,setSnapshot]=useState(null);
  const [error,setError]=useState('');
  const [cash,setCash]=useState('');
  const [shares,setShares]=useState('1000');
  const [date,setDate]=useState('');
  const [time,setTime]=useState('');
  const [price,setPrice]=useState('');
  const [quantity,setQuantity]=useState('1000');
  const [orderId,setOrderId]=useState('');
  const [feedback,setFeedback]=useState('');
  useEffect(()=>{
    try {
      const restored=openManualPaperSession({storage:localStorage,accountKey,symbol});
      setSession(restored);setSnapshot(restored?.snapshot()??null);setError('');
    } catch {setSession(null);setSnapshot(null);setError('模拟账本读取失败，禁止覆盖。');}
  },[accountKey,symbol]);
  const initialize=()=>{
    try {
      if(error)throw new Error(error);
      const initialCash=Number(cash),initialPosition=Number(shares);
      if(!cash.trim()||!Number.isFinite(initialCash)||initialCash<0||!Number.isSafeInteger(initialPosition)||initialPosition<0||initialPosition%100)throw new Error('填写明确现金与100股整手隔夜股。');
      const candidate=openManualPaperSession({storage:localStorage,accountKey,symbol,initialOptions:{initialCash,initialPosition,initialSellablePosition:initialPosition}});
      candidate.execute({date,time},{orderId:'initialize',side:'WAIT',quantity:0});
      setSession(candidate);setSnapshot(candidate.snapshot());setFeedback('模拟账户已保存。');
    }catch(e){setFeedback(`未初始化：${e.message}`);}
  };
  const execute=side=>{
    try {
      if(!session||!orderId.trim()||orderId==='initialize')throw new Error('先初始化并填写唯一模拟单号；重试使用同号。');
      if(!price.trim()||!quantity.trim())throw new Error('填写模拟价格与数量。');
      const result=executeManualPaperOrder(session,{symbol,date,time,price:Number(price)},
        {orderId:orderId.trim(),symbol,side,quantity:Number(quantity),orderPrice:Number(price),timestamp:`${date} ${time}`});
      // Only publish React state after durable storage acknowledges execution.
      setSnapshot(session.snapshot());
      setFeedback(result.status==='FILLED'?`模拟成交 · 费用 ${result.fees.toFixed(2)} 元`:`未成交：${result.reason??result.status}`);
    }catch(e){setFeedback(`未发布成交：${e.message}`);}
  };
  const h=React.createElement;
  const field=(label,value,setter,type='text')=>h('label',null,label,h('input',{type,value,onChange:e=>setter(e.target.value),'aria-label':label}));
  return h('details',{className:'manual-paper-panel'},
    h('summary',null,'独立模拟账户 · 手动执行'),
    h('p',null,'仅本机模拟，与手工流水及真实持仓分离。1000股配置未经收益验证，不自动产生策略订单。单标签页使用，其他页面改动后须刷新。'),
    h('p',null,'佣金每边0.025%最低5元；卖出印花税0.05%；过户每边0.001%。价格为手工假设，非盘口撮合，未模拟滑点/部分成交。'),
    error&&h('p',{role:'alert'},error),
    h('div',null,field('模拟交易日 YYYY-MM-DD',date,setDate),field('模拟时间 HH:mm',time,setTime)),
    !snapshot&&h('div',null,field('模拟初始现金（含费用缓冲）',cash,setCash,'number'),field('模拟隔夜股数',shares,setShares,'number'),h('button',{type:'button',disabled:!!error,onClick:initialize},'保存模拟初始状态')),
    snapshot&&h('div',null,
      h('p',null,`模拟现金 ${snapshot.cash.toFixed(2)} · 持股 ${snapshot.position.totalPosition} · 可卖 ${snapshot.position.availableSellablePosition}`),
      field('模拟单号（重试用同号）',orderId,setOrderId),field('模拟假设价格',price,setPrice,'number'),field('模拟申报股数',quantity,setQuantity,'number'),
      h('button',{type:'button',onClick:()=>execute('BUY')},'模拟买入'),h('button',{type:'button',onClick:()=>execute('SELL')},'模拟卖出'),
      h('ul',null,snapshot.orders.filter(order=>order.status==='FILLED').map(order=>h('li',{key:order.orderId},`${order.orderId} · 引擎模拟 · ${order.side} ${order.quantity}股 · ${order.fillPrice}元 · 费用${order.fees}元`)))),
    h('p',{role:'status'},feedback));
}
