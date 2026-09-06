"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, type IChartApi, type UTCTimestamp } from "lightweight-charts";

export type LightweightCandle = { time: UTCTimestamp; open:number; high:number; low:number; close:number; volume?:number; vwap?:number|null };

export function LightweightIntradayChart({ data, height=420 }: { data: LightweightCandle[]; height?:number }) {
  const host=useRef<HTMLDivElement>(null);
  const chartRef=useRef<IChartApi|null>(null);
  useEffect(()=>{
    if(!host.current)return;
    const chart=createChart(host.current,{height,autoSize:true,layout:{background:{type:ColorType.Solid,color:"#0b0f12"},textColor:"#9aa6ad"},grid:{vertLines:{color:"#182127"},horzLines:{color:"#182127"}},crosshair:{mode:1},rightPriceScale:{borderColor:"#29343b"},timeScale:{borderColor:"#29343b",timeVisible:true,secondsVisible:false}});
    const candles=chart.addSeries(CandlestickSeries,{upColor:"#ef5350",downColor:"#26a69a",borderVisible:false,wickUpColor:"#ef5350",wickDownColor:"#26a69a"});
    candles.setData(data.map(({time,open,high,low,close})=>({time,open,high,low,close})));
    const volumes=chart.addSeries(HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:""});
    volumes.priceScale().applyOptions({scaleMargins:{top:.78,bottom:0}});
    volumes.setData(data.map((point,index)=>({time:point.time,value:point.volume??0,color:point.close>=point.open?"rgba(239,83,80,.55)":"rgba(38,166,154,.55)"})));
    const vwap=data.filter(point=>point.vwap!=null).map(point=>({time:point.time,value:point.vwap as number}));
    if(vwap.length){const line=chart.addSeries(LineSeries,{color:"#e2b75f",lineWidth:2,priceLineVisible:false,lastValueVisible:false});line.setData(vwap);}
    chart.timeScale().fitContent(); chartRef.current=chart;
    return()=>{chart.remove();chartRef.current=null;};
  },[data,height]);
  return <div ref={host} style={{width:"100%",height}} aria-label="TradingView 风格一分钟K线图"/>;
}
