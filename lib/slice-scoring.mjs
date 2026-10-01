export const SCORE_WEIGHTS=Object.freeze({location:20,turn:25,vwap:20,flow:20,volume:15});
export function scoreSlice(rows,weights=SCORE_WEIGHTS){
 const r=rows.at(-1), prior=rows.slice(-6,-1);
 if(!r||prior.length<5)return {buy:0,sell:0,reasons:[],ready:false};
 const high=Math.max(...prior.map(x=>x.high??x.price)),low=Math.min(...prior.map(x=>x.low??x.price));
 const range=Math.max(high-low,r.price*.001), position=(r.price-low)/range;
 const volume=prior.reduce((s,x)=>s+(x.volume??0),0)/prior.length;
 const flow=typeof r.activeBuyRatio==='number'?r.activeBuyRatio:null;
 const values={buy:{location:Math.max(0,Math.min(1,1-position)),turn:r.price>prior.at(-1).price?1:0,vwap:r.averagePrice>0&&r.price>r.averagePrice?1:0,flow:flow===null?0:flow,volume:volume>0&&r.volume>volume?1:0},sell:{location:Math.max(0,Math.min(1,position)),turn:r.price<prior.at(-1).price?1:0,vwap:r.averagePrice>0&&r.price<r.averagePrice?1:0,flow:flow===null?0:1-flow,volume:volume>0&&r.volume>volume?1:0}};
 const result={ready:true,reasons:[],buy:0,sell:0};
 for(const side of ['buy','sell'])result[side]=Math.round(Object.entries(weights).reduce((s,[k,w])=>s+values[side][k]*w,0));
 result.reasons=[r.price>prior.at(-1).price?'短周期回升':'短周期回落',r.averagePrice>0?(r.price>r.averagePrice?'VWAP上方':'VWAP下方'):'VWAP缺失',flow===null?'主动成交缺失':`主动买占比 ${(flow*100).toFixed(0)}%`];
 return result;
}
export function suggestSlice({score,baseShares,sellable,cash,price,usedShares=0,side}){
 const fraction=score>=90?.3:score>=80?.2:score>=70?.15:score>=60?.05:0;
 const target=Math.max(0,Math.floor((baseShares*fraction-usedShares)/100)*100);
 const capacity=side==='sell'?sellable:price>0?cash/price:0;
 return Math.max(0,Math.min(target,Math.floor(capacity/100)*100));
}
