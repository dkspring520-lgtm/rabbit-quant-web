"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./fortune.css";
import "./traditional.css";
import "./interpretation.css";
import "./astro.css";
import "./premium.css";

const lots = [
  ["上上签","云开见月","潮来有信，风起于青萍；先看承接，再等长阳。"],
  ["上签","竹节新高","节节有序，不争一日之先；守住均线，方见新枝。"],
  ["中上签","雁行有序","远近相随，量价相和；缓步为宜，忌见急追。"],
  ["中签","雾里看花","花影未定，真假相生；等风吹雾，莫凭一念。"],
  ["中下签","逆水行舟","水急舟轻，宜减不宜争；先守船身，再候回流。"],
  ["下签","惊弦之鸟","高枝风紧，声动先飞；宁失一程，不失归路。"],
] as const;
const trigrams=[["乾","☰","金","天"],["兑","☱","金","泽"],["离","☲","火","火"],["震","☳","木","雷"],["巽","☴","木","风"],["坎","☵","水","水"],["艮","☶","土","山"],["坤","☷","土","地"]] as const;
const elements=["水","土","木","木","土","火","火","土","金","金","土","水"] as const;
const lineNames=["初爻","二爻","三爻","四爻","五爻","上爻"];
const trigramByLines:Record<string,number>={"111":0,"110":1,"101":2,"100":3,"011":4,"010":5,"001":6,"000":7};
const trigramMeanings:Record<string,string>={
  "乾":"刚健主动，象征趋势延续与进取，但过刚容易追高。",
  "兑":"悦而有缺，象征情绪活跃与兑现压力，宜观察放量后的承接。",
  "离":"明而附丽，象征热度、辨识度与波动，强势时也需防过热。",
  "震":"一阳发动，象征消息或资金突然驱动，方向确认前波动较大。",
  "巽":"渐入而行，象征趋势渗透与缓慢积累，更重持续性而非急涨。",
  "坎":"险中有流，象征资金反复与风险考验，先看支撑是否有效。",
  "艮":"止于其所，象征阻力、整理与边界，突破前不宜预判。",
  "坤":"厚载顺势，象征承接、蓄势与被动跟随，需要外部动能启动。"
};

function seeded(text:string){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0)/4294967295}
function trigramFor(lines:{yang:boolean}[]){return trigrams[trigramByLines[lines.map(line=>line.yang?"1":"0").join("")]??7]}
function zodiacFor(date:string){
  const [,month=1,day=1]=date.split("-").map(Number);const md=month*100+day;
  if(md>=321&&md<=419)return["白羊座","火","行动与突破"];if(md<=520&&md>=420)return["金牛座","土","稳定与价值"];
  if(md<=621&&md>=521)return["双子座","风","信息与变化"];if(md<=722&&md>=622)return["巨蟹座","水","情绪与防守"];
  if(md<=822&&md>=723)return["狮子座","火","热度与表现"];if(md<=922&&md>=823)return["处女座","土","秩序与筛选"];
  if(md<=1023&&md>=923)return["天秤座","风","平衡与博弈"];if(md<=1122&&md>=1024)return["天蝎座","水","深度与转折"];
  if(md<=1221&&md>=1123)return["射手座","火","扩张与预期"];if(md>=1222||md<=119)return["摩羯座","土","纪律与周期"];
  if(md<=218)return["水瓶座","风","创新与独立"];return["双鱼座","水","想象与流动"];
}

export default function FortunePage(){
  const [code,setCode]=useState("601899");
  const [name,setName]=useState("紫金矿业");
  const [horizon,setHorizon]=useState("20");
  const [listingDate,setListingDate]=useState("2008-04-25");
  const [listingDateAuto,setListingDateAuto]=useState(true);
  const [draw,setDraw]=useState(0);
  const [prices,setPrices]=useState("18.62,18.75,18.58,18.91,19.06,19.12,18.98,19.26,19.38,19.51,19.44,19.70,19.82,19.66,19.94,20.08,20.22,20.16,20.41,20.56");
  const [volumes,setVolumes]=useState<number[]>([]);
  const [marketBars,setMarketBars]=useState<{open:number;high:number;low:number;close:number}[]>([]);
  const [marketStatus,setMarketStatus]=useState<"idle"|"loading"|"ready"|"error">("idle");
  const [marketMessage,setMarketMessage]=useState("输入 6 位股票代码后自动读取行情");
  const [readingProgress,setReadingProgress]=useState(0);
  const [readingStage,setReadingStage]=useState("等待起卦");
  const [readingStatus,setReadingStatus]=useState<"idle"|"reading"|"cached"|"fresh">("idle");
  const [shareImage,setShareImage]=useState("");
  const [shareBusy,setShareBusy]=useState(false);
  const [shareMessage,setShareMessage]=useState("");
  const readingRun=useRef(0);
  const chartRef=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!/^\d{6}$/.test(code)){setMarketStatus("idle");setMarketMessage("请输入 6 位股票代码");return}
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      setMarketStatus("loading");setMarketMessage("正在读取真实行情…");
      try{
        const response=await fetch(`/api/market-data?code=${encodeURIComponent(code)}`,{cache:"no-store",signal:controller.signal});
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.error||"行情暂不可用");
        const bars=Array.isArray(payload.bars)?payload.bars.filter((bar:{close?:unknown})=>Number.isFinite(Number(bar.close))):[];
        if(bars.length<5)throw new Error("历史行情样本不足");
        setName(payload.quote?.name||code);
        if(payload.listingDate){setListingDate(payload.listingDate);setListingDateAuto(true)}else setListingDateAuto(false);
        setPrices(bars.slice(-120).map((bar:{close:number})=>Number(bar.close).toFixed(2)).join(","));
        setVolumes(bars.slice(-120).map((bar:{volume:number})=>Number(bar.volume)||0));
        setMarketBars(bars.slice(-120).map((bar:{open?:number;high?:number;low?:number;close:number})=>{const close=Number(bar.close);return {open:Number(bar.open)||close,high:Number(bar.high)||close,low:Number(bar.low)||close,close}}));
        setMarketStatus("ready");setMarketMessage(`已更新 ${bars.length} 个交易日 · ${payload.provider||"公开行情源"}`);
      }catch(error){if(!controller.signal.aborted){setMarketStatus("error");setMarketMessage(error instanceof Error?error.message:"行情读取失败")}}
    },500);
    return()=>{window.clearTimeout(timer);controller.abort()};
  },[code]);
  const marketFingerprint=useMemo(()=>{
    const values=prices.split(/[,，\s]+/).filter(Boolean);
    return `${values.length}-${values.at(-1)||"0"}-${volumes.at(-1)||0}`;
  },[prices,volumes]);
  const readingDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date());
  const readingKey=`stock-oracle:v2:${code}:${horizon}:${readingDate}:${marketFingerprint}`;
  const runReading=async(forceNew=false)=>{
    if(marketStatus==="loading"||!/^\d{6}$/.test(code))return;
    const run=++readingRun.current;
    let cachedDraw:number|undefined;
    if(!forceNew){
      try{const saved=JSON.parse(localStorage.getItem(readingKey)||"null");if(Number.isInteger(saved?.draw))cachedDraw=saved.draw}catch{}
    }
    const nextDraw=forceNew?draw+1:(cachedDraw??0);
    const cached=cachedDraw!==undefined&&!forceNew;
    setReadingStatus("reading");setReadingProgress(4);setReadingStage(cached?"读取今日缓存":"校准推演环境");
    const stages=cached
      ? [[24,"读取今日缓存"],[58,"核对行情指纹"],[82,"复核卦象与趋势"],[100,"恢复本次解签"]] as const
      : [[14,"行情入盘"],[34,"六爻成卦"],[55,"五行流转"],[76,"星盘合参"],[92,"趋势复核"],[100,"小兔揭签"]] as const;
    for(const [progress,label] of stages){
      await new Promise(resolve=>window.setTimeout(resolve,cached?220:390));
      if(run!==readingRun.current)return;
      setReadingProgress(progress);setReadingStage(label);
    }
    setDraw(nextDraw);
    try{localStorage.setItem(readingKey,JSON.stringify({draw:nextDraw,createdAt:Date.now()}))}catch{}
    setReadingStatus(cached?"cached":"fresh");
  };
  useEffect(()=>{
    readingRun.current+=1;setReadingStatus("idle");setReadingProgress(0);setReadingStage("等待起卦");
  },[code,horizon,marketFingerprint]);
  const analysis=useMemo(()=>{
    const values=prices.split(/[,，\s]+/).map(Number).filter(v=>Number.isFinite(v)&&v>0);
    const safeValues=values.length?values:[0];
    const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
    const ma5=avg(values.slice(-5)),ma20=avg(values.slice(-20));
    const momentum=values.length>5?(values.at(-1)!/values.at(-6)!-1)*100:0;
    let gains=0,losses=0;values.slice(-15).forEach((v,i,a)=>{if(i){const d=v-a[i-1];d>0?gains+=d:losses-=d}});
    const rsi=losses?100-100/(1+gains/losses):gains?72:50;
    const recentVolume=avg(volumes.slice(-5)),baseVolume=avg(volumes.slice(-20));
    const volumeBoost=baseVolume&&momentum>0?Math.min(6,(recentVolume/baseVolume-1)*8):0;
    const fractals=values.slice(1,-1).flatMap((value,index)=>{
      const i=index+1;
      if(value>values[i-1]&&value>values[i+1])return[{type:"顶" as const,index:i,value}];
      if(value<values[i-1]&&value<values[i+1])return[{type:"底" as const,index:i,value}];
      return[];
    });
    const thirds=[values.slice(-30,-20),values.slice(-20,-10),values.slice(-10)].filter(part=>part.length);
    const centerLow=thirds.length===3?Math.max(...thirds.map(part=>Math.min(...part))):0;
    const centerHigh=thirds.length===3?Math.min(...thirds.map(part=>Math.max(...part))):0;
    const hasCenter=centerLow<=centerHigh&&centerHigh>0;
    const last=safeValues.at(-1)||0;
    const chanState=hasCenter?(last>centerHigh?"离开中枢向上":last<centerLow?"离开中枢向下":"中枢震荡"):"中枢尚未确认";
    const chanBoost=hasCenter?(last>centerHigh?5:last<centerLow?-5:0):0;
    const horizonDays=Number(horizon);
    const horizonSlice=values.slice(-Math.min(horizonDays,values.length));
    const horizonBase=avg(horizonSlice);
    const horizonMomentum=horizonSlice.length>2?(horizonSlice.at(-1)!/horizonSlice[0]-1)*100:momentum;
    const shortSignal=(ma20?(ma5/ma20-1)*600:0)+momentum*2+volumeBoost;
    const mediumSignal=(ma20&&last?(last/ma20-1)*420:0)+horizonMomentum*1.25+chanBoost;
    const longSignal=(horizonBase&&last?(last/horizonBase-1)*330:0)+horizonMomentum*.8+chanBoost*.65;
    const periodSignal=horizonDays<=5?shortSignal:horizonDays<=20?mediumSignal:longSignal;
    const score=Math.max(18,Math.min(82,Math.round(50+periodSignal)));
    const waveState=score>=65?(rsi>68?"上升推进浪后段":"上升推进浪"):score>=56?(momentum>=0?"上升初段":"回撤浪修复"):score<=35?(rsi<32?"下跌推动浪后段":"下跌推动浪"):score<=44?(momentum<=0?"下跌初段":"反弹浪修复"):"震荡整理浪";
    const seed=`${code}-${horizon}-${draw}-${readingDate}-${marketFingerprint}`;
    const lot=lots[Math.max(0,Math.min(5,Math.floor((1-(seeded(seed)*.72+(score-50)/180+.14))*6)))];
    const moving=Math.floor(seeded(seed+"变")*6);
    const lines=Array.from({length:6},(_,i)=>({yang:seeded(seed+`爻${i}`)>.5,moving:i===moving,element:elements[Math.floor(seeded(seed+`支${i}`)*12)]}));
    const changedLines=lines.map((line,i)=>({...line,yang:i===moving?!line.yang:line.yang}));
    const lower=trigramFor(lines.slice(0,3)),upper=trigramFor(lines.slice(3,6));
    const changedLower=trigramFor(changedLines.slice(0,3)),changedUpper=trigramFor(changedLines.slice(3,6));
    const elementCounts=(["金","木","水","火","土"] as const).map(element=>({element,count:lines.filter(line=>line.element===element).length})).sort((a,b)=>b.count-a.count);
    return {values,ma5,ma20,momentum,rsi,score,waveState,lot,upper,lower,changedUpper,changedLower,moving,lines,dominantElement:elementCounts[0],support:Math.min(...(horizonSlice.length?horizonSlice:safeValues)),resistance:Math.max(...(horizonSlice.length?horizonSlice:safeValues)),fractals,hasCenter,centerLow,centerHigh,chanState};
  },[prices,volumes,code,horizon,draw,readingDate,marketFingerprint]);
  const projectedBars=useMemo(()=>{
    const count=Number(horizon),last=analysis.values.at(-1)||1;
    const direction=(analysis.score-50)/50;
    const chanFactor=analysis.chanState.includes("向上")?1.12:analysis.chanState.includes("向下")?1.12:.78;
    const exhaustion=analysis.waveState.includes("后段")?.68:analysis.waveState.includes("修复")?.76:1;
    const totalMove=direction*(count<=5?.045:count<=20?.1:.18)*chanFactor*exhaustion;
    let previous=last;
    return Array.from({length:count},(_,index)=>{
      const progress=(index+1)/count;
      const noise=(seeded(`${code}-${horizon}-${draw}-forecast-${index}`)-.5)*(count<=5?.026:.018);
      const wavePhase=analysis.waveState.includes("回撤")||analysis.waveState.includes("反弹")?Math.PI:.25;
      const wave=Math.sin(progress*Math.PI*3.2+wavePhase)*(count<=5?.012:.008);
      const target=last*(1+totalMove*progress+wave+noise);
      const open=previous*(1+(seeded(`${code}-${index}-open`)-.5)*.008);
      const close=Math.max(.01,target);
      const wick=.006+seeded(`${code}-${index}-wick`)*.012;
      const high=Math.max(open,close)*(1+wick);
      const low=Math.min(open,close)*(1-wick);
      previous=close;return {open,high,low,close};
    });
  },[analysis.values,analysis.score,analysis.chanState,analysis.waveState,code,horizon,draw]);
  useEffect(()=>{
    const canvas=chartRef.current;if(!canvas)return;
    const drawChart=()=>{
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.round(430*dpr);
      const ctx=canvas.getContext("2d");if(!ctx)return;ctx.scale(dpr,dpr);
      const width=rect.width,height=430,pad={l:56,r:58,t:42,b:46};
      const fallback=analysis.values.slice(-36).map((close,index,array)=>{const open=index?array[index-1]:close;return {open,close,high:Math.max(open,close)*1.006,low:Math.min(open,close)*.994}});
      const history=(marketBars.length?marketBars:fallback).slice(-36);
      const all=[...history,...projectedBars],min=Math.min(...all.map(bar=>bar.low)),max=Math.max(...all.map(bar=>bar.high)),range=max-min||1;
      const x0=pad.l,plotW=width-pad.l-pad.r,plotH=height-pad.t-pad.b,step=plotW/all.length,candleW=Math.max(2,Math.min(9,step*.58));
      ctx.clearRect(0,0,width,height);ctx.font='12px "Songti SC",serif';ctx.textBaseline="middle";
      for(let i=0;i<=4;i++){const y=pad.t+plotH*i/4,price=max-range*i/4;ctx.strokeStyle="rgba(167,193,180,.1)";ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.fillStyle="#61786e";ctx.textAlign="right";ctx.fillText(price.toFixed(2),width-8,y)}
      const forecastX=x0+history.length*step;ctx.fillStyle="rgba(205,169,96,.045)";ctx.fillRect(forecastX,pad.t,width-pad.r-forecastX,plotH);ctx.setLineDash([5,6]);ctx.strokeStyle="rgba(210,173,99,.42)";ctx.beginPath();ctx.moveTo(forecastX,pad.t);ctx.lineTo(forecastX,pad.t+plotH);ctx.stroke();ctx.setLineDash([]);
      const y=(value:number)=>pad.t+(max-value)/range*plotH;
      if(analysis.hasCenter&&analysis.centerHigh>=min&&analysis.centerLow<=max){const top=y(Math.min(max,analysis.centerHigh)),bottom=y(Math.max(min,analysis.centerLow));ctx.fillStyle="rgba(199,158,76,.09)";ctx.fillRect(x0,top,plotW,bottom-top);ctx.strokeStyle="rgba(206,168,88,.34)";ctx.setLineDash([7,5]);ctx.strokeRect(x0,top,plotW,bottom-top);ctx.setLineDash([]);ctx.fillStyle="#a98a4f";ctx.font='10px "Songti SC",serif';ctx.fillText("中枢",x0+8,top+13)}
      all.forEach((bar,index)=>{const predicted=index>=history.length,x=x0+(index+.5)*step,y=(value:number)=>pad.t+(max-value)/range*plotH,up=bar.close>=bar.open,color=up?"#bd5c46":"#4e9c83";ctx.strokeStyle=color;ctx.globalAlpha=predicted?.62:1;ctx.beginPath();ctx.moveTo(x,y(bar.high));ctx.lineTo(x,y(bar.low));ctx.stroke();ctx.fillStyle=up?color:"transparent";ctx.strokeStyle=color;const top=Math.min(y(bar.open),y(bar.close)),body=Math.max(1,Math.abs(y(bar.open)-y(bar.close)));ctx.fillRect(x-candleW/2,top,candleW,body);if(!up)ctx.strokeRect(x-candleW/2,top,candleW,body);ctx.globalAlpha=1});
      const rawPivots=all.slice(1,-1).flatMap((bar,index)=>{const i=index+1;if(bar.high>all[i-1].high&&bar.high>=all[i+1].high)return[{index:i,value:bar.high,type:"顶" as const}];if(bar.low<all[i-1].low&&bar.low<=all[i+1].low)return[{index:i,value:bar.low,type:"底" as const}];return[]});
      const pivots=rawPivots.reduce<typeof rawPivots>((list,pivot)=>{const last=list.at(-1);if(!last||last.type!==pivot.type)return[...list,pivot];const moreExtreme=pivot.type==="顶"?pivot.value>last.value:pivot.value<last.value;return moreExtreme?[...list.slice(0,-1),pivot]:list},[]);
      if(pivots.length>1){ctx.lineWidth=1.6;ctx.beginPath();pivots.forEach((pivot,index)=>{const x=x0+(pivot.index+.5)*step,py=y(pivot.value);if(index===0)ctx.moveTo(x,py);else{const previous=pivots[index-1];ctx.setLineDash(previous.index<history.length&&pivot.index>=history.length?[6,5]:[]);ctx.strokeStyle=pivot.index>=history.length?"rgba(220,180,94,.78)":"rgba(205,191,150,.72)";ctx.lineTo(x,py);ctx.stroke();ctx.beginPath();ctx.moveTo(x,py)}ctx.setLineDash([]);ctx.fillStyle=pivot.index>=history.length?"#c5a052":"#829b90";ctx.beginPath();ctx.arc(x,py,3,0,Math.PI*2);ctx.fill();if(index>=pivots.length-6){ctx.font='9px "Songti SC",serif';ctx.fillText(pivot.type,x+5,py+(pivot.type==="顶"?-7:8))}})}
      ctx.textAlign="left";ctx.fillStyle="#82988e";ctx.fillText("历史日线",x0,pad.t-20);ctx.fillStyle="#c2a35f";ctx.fillText(`推演区 · ${horizon}日`,forecastX+12,pad.t-20);
      ctx.fillStyle="#51685e";ctx.font='11px "Songti SC",serif';ctx.fillText("虚线右侧为模型推演，不是真实行情",x0,height-18);
    };
    drawChart();const observer=new ResizeObserver(drawChart);observer.observe(canvas);return()=>observer.disconnect();
  },[analysis.values,analysis.hasCenter,analysis.centerHigh,analysis.centerLow,marketBars,projectedBars,horizon]);
  const trend=analysis.score>58?"偏多":analysis.score<42?"偏空":"震荡";
  const paths=[
    ["顺势",Math.max(20,Math.round(analysis.score*.62)),`守住 ${analysis.ma20.toFixed(2)}，量能温和放大`],
    ["盘整",Math.max(18,Math.round(48-Math.abs(analysis.score-50)*.35)),"均线反复缠绕，等待方向选择"],
    ["转弱",Math.max(15,Math.round((100-analysis.score)*.55)),`跌破 ${analysis.support.toFixed(2)}，优先控制风险`],
  ] as const;
  const total=paths.reduce((s,p)=>s+p[1],0);
  const agreement=trend==="偏多"&&analysis.lot[0].includes("上")||trend==="偏空"&&analysis.lot[0].includes("下")?"卦势相合":"仍待行情验证";
  const futureTitle=trend==="偏多"?"震荡上行，回踩后仍有走强机会":trend==="偏空"?"弱势震荡，反弹后仍有回落风险":"区间震荡，方向尚未选择";
  const futurePath=trend==="偏多"?`未来 ${horizon} 个交易日更可能先震荡消化，再尝试向上突破。`:trend==="偏空"?`未来 ${horizon} 个交易日更可能维持弱势或出现冲高回落。`:`未来 ${horizon} 个交易日更可能在 ${analysis.support.toFixed(2)} 至 ${analysis.resistance.toFixed(2)} 区间反复。`;
  const riskLevel=analysis.score>=68||analysis.score<=32?"较高":analysis.score>=58||analysis.score<=42?"中等":"一般";
  const zodiac=zodiacFor(listingDate);
  const astroTone=zodiac[1]==="火"?"倾向快速启动与较大波动":zodiac[1]==="土"?"倾向重视支撑与趋势确认":zodiac[1]==="风"?"倾向受消息和市场预期推动":"倾向受资金流动与市场情绪影响";
  const spokenReport=`小兔为你解签。${name||code}，${analysis.upper[0]}上${analysis.lower[0]}下，${lineNames[analysis.moving]}动。未来走势判断：${futureTitle}。${futurePath} 上行观察位${analysis.resistance.toFixed(2)}元，下行警戒位${analysis.support.toFixed(2)}元。卦象仅供文化娱乐，走势判断不构成投资建议。`;
  const speak=()=>{if(!("speechSynthesis" in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(spokenReport);utterance.lang="zh-CN";utterance.rate=.92;window.speechSynthesis.speak(utterance)};
  const shareCopy=`${name||code}（${code}）股票推演签\n未来 ${horizon} 个交易日：${trend} · ${analysis.score}/100\n${futureTitle}\n上行确认 ¥${analysis.resistance.toFixed(2)}｜下行警戒 ¥${analysis.support.toFixed(2)}\n卦象：${analysis.upper[0]}上${analysis.lower[0]}下，${lineNames[analysis.moving]}动\n#股票推演 #传统文化 #行情观察\n仅供文化娱乐，不构成投资建议。`;
  const generateShareCard=async()=>{
    setShareBusy(true);setShareMessage("");
    const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1440;
    const ctx=canvas.getContext("2d");if(!ctx){setShareBusy(false);return}
    const wrap=(text:string,x:number,y:number,maxWidth:number,lineHeight:number,maxLines=3)=>{let line="",lineNo=0;for(const char of text){const test=line+char;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y+lineNo*lineHeight);line=char;lineNo++;if(lineNo>=maxLines)return}else line=test}if(lineNo<maxLines)ctx.fillText(line,x,y+lineNo*lineHeight)};
    const gradient=ctx.createRadialGradient(820,180,20,540,600,1100);gradient.addColorStop(0,"#17372c");gradient.addColorStop(.42,"#0b211a");gradient.addColorStop(1,"#040d0a");ctx.fillStyle=gradient;ctx.fillRect(0,0,1080,1440);
    ctx.fillStyle="rgba(210,174,103,.025)";for(let y=0;y<1440;y+=12)ctx.fillRect(0,y,1080,1);
    ctx.strokeStyle="rgba(219,181,105,.42)";ctx.lineWidth=2;ctx.strokeRect(40,40,1000,1360);ctx.strokeStyle="rgba(219,181,105,.12)";ctx.strokeRect(58,58,964,1324);
    ctx.beginPath();ctx.arc(866,270,190,0,Math.PI*2);ctx.strokeStyle="rgba(206,170,98,.09)";ctx.lineWidth=1;ctx.stroke();ctx.beginPath();ctx.arc(866,270,150,0,Math.PI*2);ctx.stroke();
    analysis.lines.forEach((line,i)=>{const y=178+i*35,x=770;ctx.strokeStyle="rgba(210,177,106,.13)";ctx.lineWidth=8;ctx.beginPath();if(line.yang){ctx.moveTo(x,y);ctx.lineTo(x+190,y)}else{ctx.moveTo(x,y);ctx.lineTo(x+78,y);ctx.moveTo(x+112,y);ctx.lineTo(x+190,y)}ctx.stroke()});
    ctx.fillStyle="#b79656";ctx.font='25px "Songti SC","Noto Serif SC",serif';ctx.fillText("股票推演局",88,116);
    ctx.fillStyle="#536e62";ctx.font="18px Georgia,serif";ctx.fillText("ORIENTAL MARKET ORACLE",88,153);
    ctx.textAlign="right";ctx.fillStyle="#6f8a7e";ctx.font="21px Georgia,serif";ctx.fillText(`${code}  ·  ${horizon}D`,982,124);ctx.textAlign="left";
    ctx.fillStyle="#e9d7ac";ctx.font='700 86px "Songti SC","Noto Serif SC",serif';wrap(name||code,84,318,760,102,2);
    ctx.fillStyle="#6e8b7e";ctx.font='24px "Songti SC",serif';ctx.fillText(`证券代码 ${code}  ·  推演周期 ${horizon} 个交易日`,88,470);
    ctx.strokeStyle="rgba(213,176,100,.25)";ctx.beginPath();ctx.moveTo(88,520);ctx.lineTo(992,520);ctx.stroke();
    ctx.fillStyle="#78968a";ctx.font='22px "Songti SC",serif';ctx.fillText("未来定势",88,590);
    ctx.fillStyle="#e7c474";ctx.font='700 126px "Songti SC","Noto Serif SC",serif';ctx.fillText(trend,80,735);
    ctx.fillStyle="#78988b";ctx.font="700 68px Georgia,serif";ctx.textAlign="right";ctx.fillText(`${analysis.score}`,982,700);ctx.font="20px Georgia,serif";ctx.fillText("TENDENCY / 100",982,738);ctx.textAlign="left";
    ctx.fillStyle="#e1e5dd";ctx.font='39px "Songti SC","Noto Serif SC",serif';wrap(futureTitle,88,820,900,58,2);
    ctx.fillStyle="#82978e";ctx.font='25px "Songti SC","Noto Serif SC",serif';wrap(futurePath,88,945,900,42,2);
    ctx.strokeStyle="rgba(210,173,99,.18)";ctx.beginPath();ctx.moveTo(88,1055);ctx.lineTo(992,1055);ctx.stroke();
    const facts=[["上行确认",`¥${analysis.resistance.toFixed(2)}`],["下行警戒",`¥${analysis.support.toFixed(2)}`],["风险等级",riskLevel],["缠论状态",analysis.chanState]];
    facts.forEach(([label,value],i)=>{const x=88+(i%2)*455,y=1110+Math.floor(i/2)*108;ctx.fillStyle="#60796e";ctx.font='20px "Songti SC",serif';ctx.fillText(label,x,y);ctx.fillStyle="#d8c18a";ctx.font='29px "Songti SC",serif';ctx.fillText(value,x,y+40)});
    ctx.fillStyle="#b89655";ctx.font='24px "Songti SC",serif';ctx.fillText(`${analysis.upper[1]} ${analysis.upper[0]}上 · ${analysis.lower[1]} ${analysis.lower[0]}下 · ${lineNames[analysis.moving]}动`,88,1327);
    ctx.strokeStyle="#a84c38";ctx.fillStyle="rgba(168,76,56,.07)";ctx.lineWidth=3;ctx.strokeRect(862,1255,106,106);ctx.fillRect(862,1255,106,106);ctx.fillStyle="#c1644d";ctx.font='30px "Songti SC",serif';ctx.fillText("定 势",872,1318);
    ctx.fillStyle="#4f685d";ctx.font='18px "Songti SC",serif';ctx.fillText("传统文化娱乐推演 · 不构成投资建议",88,1370);
    setShareImage(canvas.toDataURL("image/png"));setShareBusy(false);
  };
  const downloadShare=()=>{if(!shareImage)return;const a=document.createElement("a");a.href=shareImage;a.download=`${name||code}-${code}-股票推演签.png`;a.click()};
  const copyShare=async()=>{await navigator.clipboard.writeText(shareCopy);setShareMessage("分享文案已复制")};
  const systemShare=async()=>{if(!shareImage)return;try{const blob=await(await fetch(shareImage)).blob();const file=new File([blob],`${name||code}-股票推演签.png`,{type:"image/png"});if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({title:`${name||code} 股票推演签`,text:shareCopy,files:[file]})}else{downloadShare();await copyShare();setShareMessage("图片已保存，文案已复制")}}catch(error){if((error as Error).name!=="AbortError")setShareMessage("分享未完成，请先保存图片")}};
  return <main className="oracle">
    <nav><a href="/">← 返回做T神器</a><span>股票占卜 · STOCK ORACLE</span><b>娱乐推演</b></nav>
    <header><div><small>东方术数 × 西方星象 × 行情技术</small><h1>股票<br/><span>推演局</span></h1><p>输入代码，查看未来走势、卦象与关键价位。</p></div>
      <form onSubmit={e=>{e.preventDefault();void runReading(false)}}><label>股票代码<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="例如 601899"/></label><label>股票名称<input value={name} readOnly placeholder="行情自动识别"/></label><label>问卦周期<select value={horizon} onChange={e=>setHorizon(e.target.value)}><option value="5">短线 · 未来 5 个交易日</option><option value="20">波段 · 未来 20 个交易日</option><option value="60">中期 · 未来 3 个月（约 60 个交易日）</option></select></label><label>上市日期 · {listingDateAuto?"自动识别":"可手动补充"}<input type="date" value={listingDate} onChange={e=>{setListingDate(e.target.value);setListingDateAuto(false)}}/></label><div className={`market-fetch ${marketStatus}`}><i/>{marketMessage}{marketStatus==="ready"&&listingDateAuto?` · 上市 ${listingDate}`:""}</div><button disabled={marketStatus==="loading"||readingStatus==="reading"}>{marketStatus==="loading"?"正在观盘…":readingStatus==="reading"?"正在推演…":`为 ${name||code} 起卦 →`}</button></form>
    </header>
    {readingStatus!=="idle"&&<section className={`reading-ritual ${readingStatus}`} aria-live="polite" aria-busy={readingStatus==="reading"}>
      <div className="ritual-copy"><small>ORACLE ENGINE · {readingStatus==="cached"?"今日卦象已读取":"东西合参推演"}</small><h2>{readingStage}</h2><p>{readingStatus==="cached"?"行情指纹未变化，沿用同一份今日解签。":readingStatus==="fresh"?"本次推演已完成，结果已锁定到当前行情。":"正在把实时行情、六爻五行与星象叙事逐层合参。"}</p></div>
      <div className="ritual-orbit" aria-hidden="true"><i/><b>☯</b><em>{analysis.upper[1]}{analysis.lower[1]}</em></div>
      <div className="ritual-progress"><div><i style={{width:`${readingProgress}%`}}/></div><strong>{readingProgress}%</strong></div>
      <div className="ritual-steps">{[["行情入盘",14],["六爻成卦",34],["五行流转",55],["星盘合参",76],["趋势定签",92]].map(([label,point])=><span className={readingProgress>=Number(point)?"done":""} key={label}><i/>{label}</span>)}</div>
      <div className="ritual-ledger">
        <span><small>梅花取数</small><b>{code.slice(-2)} · {readingDate.slice(-2)} · {horizon}日</b></span>
        <span><small>六爻动变</small><b>{lineNames[analysis.moving]} · {analysis.upper[0]}变{analysis.changedUpper[0]}</b></span>
        <span><small>五行旺气</small><b>{analysis.dominantElement.element} · {analysis.dominantElement.count}/6</b></span>
        <span><small>星象象征</small><b>{zodiacFor(listingDate)[0]} · {zodiacFor(listingDate)[1]}象</b></span>
        <span><small>缠论结构</small><b>{analysis.chanState}</b></span>
      </div>
    </section>}
    <section className="method-strip"><span><b>起卦法</b> 梅花易数 · 数字起卦</span><i>股票代码</i><u>＋</u><i>问卦日期</i><u>＋</u><i>测算周期</i><em>传统文化娱乐推演</em></section>
    <section className="engine-map"><header><small>推演法门</small><h2>文化取象，技术定势</h2><p>每一层都展示依据，但只有行情层参与方向评分。</p></header><div><article><em>01</em><b>易学取象</b><p>梅花数字起卦、六爻阴阳与动爻、八卦上下体。</p></article><article><em>02</em><b>道家观变</b><p>以阴阳消长、五行生克描述强弱转换，不作宗教断言。</p></article><article><em>03</em><b>西方占星</b><p>以上市日期映射星座四元素，作为市场性格叙事。</p></article><article><em>04</em><b>量价技术</b><p>均线、RSI、动量、成交量与支撑压力共同评分。</p></article><article><em>05</em><b>缠论复核</b><p>识别顶底分型、三段重叠中枢及价格离开方向。</p></article></div></section>
    <section className={`result ${readingStatus==="reading"?"result-thinking":""}`}>
      <article className="lot gua-card"><div className="gua-heading"><em>{analysis.lot[0]}</em><span>本卦</span><h2>{analysis.upper[3]}上{analysis.lower[3]}下</h2><p>{analysis.upper[0]}上 {analysis.lower[0]}下 · {lineNames[analysis.moving]}动 · 之卦 {analysis.changedUpper[0]}上{analysis.changedLower[0]}下</p></div><div className="hexagram">{analysis.lines.map((line,index)=><div className={`yao ${line.moving?"moving":""}`} key={index}><small>{lineNames[index]}</small><span className={`yao-line ${line.yang?"yang":"yin"}`}>{line.yang?<i/>:<><i/><i/></>}</span><b>{line.element}</b>{line.moving?<em>○</em>:<em/>}</div>)}</div><div className="gua-symbols"><div><strong>{analysis.upper[1]}</strong><span>上卦 · {analysis.upper[0]}</span><small>{analysis.upper[2]} · {analysis.upper[3]}</small></div><i/><div><strong>{analysis.lower[1]}</strong><span>下卦 · {analysis.lower[0]}</span><small>{analysis.lower[2]} · {analysis.lower[3]}</small></div><i/><div><strong>{analysis.changedUpper[1]}{analysis.changedLower[1]}</strong><span>变卦</span><small>{analysis.changedUpper[0]} / {analysis.changedLower[0]}</small></div></div><blockquote><b>{analysis.lot[1]}</b><br/>{analysis.lot[2]}</blockquote><button disabled={readingStatus==="reading"} onClick={()=>void runReading(true)}>主动重新起卦</button><small className="seed-note">同一行情、周期与交易日保持同一卦；只有主动重起才会换签。</small></article>
      <article className="tech forecast-card"><header><div><small>最终走势</small><h2>{trend}</h2></div><strong>{analysis.score}<i>/100</i></strong></header><div className="meter"><i style={{width:`${analysis.score}%`}}/></div><h3>{futureTitle}</h3><p className="future-path">{futurePath}</p><dl><div><dt>预测周期</dt><dd>未来 {horizon} 个交易日</dd></div><div><dt>风险等级</dt><dd>{riskLevel}</dd></div><div><dt>上行确认</dt><dd>¥{analysis.resistance.toFixed(2)}</dd></div><div><dt>下行警戒</dt><dd>¥{analysis.support.toFixed(2)}</dd></div><div><dt>缠论状态</dt><dd>{analysis.chanState}</dd></div><div><dt>波浪阶段</dt><dd>{analysis.waveState}</dd></div></dl><footer><button type="button" onClick={speak}>◉ 小兔播报</button><button type="button" className="share-trigger" onClick={()=>void generateShareCard()}>{shareBusy?"正在生成…":"生成分享签"}</button><div className="result-seal">行情模型定势 · 术数星象解签</div></footer></article>
    </section>
    <section className="forecast-chart"><header><div><small>缠论 × 波浪理论 · 推演日线</small><h2>{name||code} · 未来{horizon==="60"?"三个月":`${horizon}日`}路径</h2></div><div className="chart-legend"><span><i/>历史日线</span><span className="chan-line"><i/>缠论笔</span><span className="chan-center"><i/>中枢</span><span className="projected"><i/>模型推演</span></div></header><canvas ref={chartRef} aria-label={`${name||code}历史日线与未来${horizon}日推演K线图，含缠论笔和中枢`}/><footer><span>{analysis.chanState}</span><span>{analysis.waveState}</span><span>推演末值 ¥{(projectedBars.at(-1)?.close||0).toFixed(2)}</span><span>模型倾向 {analysis.score}/100</span></footer></section>
    {shareImage&&<div className="share-modal" role="dialog" aria-modal="true" aria-label="分享股票推演签" onClick={()=>setShareImage("")}><section onClick={e=>e.stopPropagation()}><header><div><small>分享签已生成</small><h2>发布你的推演结果</h2></div><button type="button" aria-label="关闭" onClick={()=>setShareImage("")}>×</button></header><img src={shareImage} alt={`${name||code} 股票推演结果分享签`}/><div className="share-actions"><button type="button" className="primary" onClick={()=>void systemShare()}>一键分享</button><button type="button" onClick={downloadShare}>保存图片</button><button type="button" onClick={()=>void copyShare()}>复制文案</button></div>{shareMessage&&<p aria-live="polite">{shareMessage}</p>}<small>手机端会唤起系统分享面板；不支持时自动保存图片并复制文案。</small></section></div>}
    <section className="five-elements"><header><div><small>五行审势</small><h2>金木水火土 · 旺衰分布</h2></div><p>由六爻元素分布生成，仅作文化展示。</p></header><div>{(["金","木","水","火","土"] as const).map(element=>{const count=analysis.lines.filter(line=>line.element===element).length;return <article className="element" key={element}><strong>{element}</strong><i><u style={{height:`${24+count*22}%`}}/></i><span><b>{count>=2?"旺":count===1?"平":"弱"}</b><small>{element==="金"?"纪律 / 收敛":element==="木"?"生长 / 趋势":element==="水"?"流动 / 资金":element==="火"?"热度 / 动能":"承载 / 支撑"}</small></span><em>{count}/6</em></article>})}</div></section>
    <section className="rabbit-oracle"><img src="/rabbit-brand-gold.png" alt="小兔解签官"/><div><small>小兔解签官</small><h2>{futureTitle}</h2><p>{spokenReport}</p></div><button type="button" onClick={speak}>🔊 语音播报</button></section>
    <section className="east-west"><header><small>EAST × WEST</small><h2>东方六爻 · 西方星象</h2><p>两套文化象征共同参与叙事，技术模型独立决定走势评分。</p></header><div><article><span>东方</span><strong>{analysis.upper[1]}{analysis.lower[1]}</strong><h3>{analysis.upper[0]}上{analysis.lower[0]}下</h3><p>{lineNames[analysis.moving]}动，变为{analysis.changedUpper[0]}上{analysis.changedLower[0]}下。</p></article><i>合参</i><article><span>西方</span><strong>✦</strong><h3>{zodiac[0]} · {zodiac[1]}象</h3><p>以上市日期 {listingDate} 作为象征性诞生日期，主题为“{zodiac[2]}”，{astroTone}。</p></article><article className="combined"><span>东西方合盘</span><h3>{agreement} · {futureTitle}</h3><p>东方卦象用于解释变化阶段，西方四元素用于描述市场性格；最终方向仍由真实行情模型给出。</p></article></div></section>
    <section className="interpretation"><header><small>卦象解签</small><h2>传统卦意与未来走势</h2><p>科学技术模型在后台参与判断。</p></header><div className="interpretation-grid">
      <article className="traditional-reading"><span>传统卦象解释</span><h3>{analysis.upper[0]}上{analysis.lower[0]}下，{lineNames[analysis.moving]}动</h3><dl><div><dt>上卦 · 外部环境</dt><dd>{trigramMeanings[analysis.upper[0]]}</dd></div><div><dt>下卦 · 内部结构</dt><dd>{trigramMeanings[analysis.lower[0]]}</dd></div><div><dt>动爻 · 变化位置</dt><dd>{analysis.moving<2?"动在下位，故事指向行情初起或基础尚未稳定。":analysis.moving<4?"动在中位，故事指向多空正在交换、进入关键验证阶段。":"动在上位，故事指向趋势后段或情绪释放，宜防盛极转折。"}</dd></div><div><dt>变卦 · 后续叙事</dt><dd>变为{analysis.changedUpper[0]}上{analysis.changedLower[0]}下。{trigramMeanings[analysis.changedUpper[0]]}</dd></div><div><dt>五行 · 主要气象</dt><dd>{analysis.dominantElement.count?`${analysis.dominantElement.element}出现 ${analysis.dominantElement.count} 次，文化象征偏向${analysis.dominantElement.element==="金"?"收敛与纪律":analysis.dominantElement.element==="木"?"生长与延续":analysis.dominantElement.element==="水"?"流动与资金":analysis.dominantElement.element==="火"?"热度与动能":"承载与支撑"}。`:"五行分布较弱，不作额外推断。"}</dd></div></dl></article>
      <article className="evidence-reading"><span>未来走势判断</span><h3>{futureTitle}</h3><div className="plain-forecast"><b>{futurePath}</b><p>上行观察位：¥{analysis.resistance.toFixed(2)}</p><p>下行警戒位：¥{analysis.support.toFixed(2)}</p><p>波动风险：{riskLevel}</p></div><div className={`verdict ${agreement==="卦势相合"?"agree":"neutral"}`}><small>综合判读 · {agreement}</small><b>{trend==="偏多"?"整体偏强，适合等待回踩或突破确认，不宜盲目追高。":trend==="偏空"?"整体偏弱，先观察止跌信号，反弹暂按修复看待。":"整体以震荡看待，在突破前不提前押注方向。"}</b><p>这是基于当前行情结构的概率判断，不是确定性预言。</p></div></article>
    </div></section>
    <section className="paths"><header><div><small>三路演算</small><h2>未来并非一条线</h2></div><p>结构化情景权重，不代表真实概率。</p></header><div>{paths.map((p,i)=>{const percent=Math.round(p[1]/total*100);return <article key={p[0]}><em>0{i+1}</em><span><b>{p[0]}</b><p>{p[2]}</p><i><u style={{width:`${percent}%`}}/></i></span><strong>{percent}%</strong></article>})}</div></section>
    <section className="levels"><article><small>守 · 近期支撑</small><b>¥{analysis.support.toFixed(2)}</b><p>有效跌破时，签文再吉也应重新评估。</p></article><article><small>望 · 近期压力</small><b>¥{analysis.resistance.toFixed(2)}</b><p>放量突破后，才算趋势给出确认。</p></article><article className="warning"><small>卦外之言</small><b>不据此下单</b><p>仅供娱乐与研究参考，不构成投资建议。真实交易请结合仓位、成本与止损纪律。</p></article></section>
  </main>
}
