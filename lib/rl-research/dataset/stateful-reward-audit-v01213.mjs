import { createHash } from "node:crypto";
export const ACTIONS=Object.freeze(["WAIT","BUY_SMALL","BUY","SELL_PART","SELL_ALL"]);
export const SPLITS=Object.freeze(["train","validation","test"]);
export function splitOf(timestamp){const day=String(timestamp).slice(0,10);return day<="2024-12-31"?"train":day<="2025-09-30"?"validation":"test";}
export function hash(v){return createHash("sha256").update(JSON.stringify(v)).digest("hex");}
export function quantile(values,q){const x=values.slice().sort((a,b)=>a-b);if(!x.length)return null;const i=(x.length-1)*q,l=Math.floor(i),h=Math.ceil(i);return l===h?x[l]:x[l]+(x[h]-x[l])*(i-l);}
export function summary(values){const x=values.filter(Number.isFinite);const mean=x.length?x.reduce((a,b)=>a+b,0)/x.length:null;return {count:x.length,mean, std:x.length?Math.sqrt(Math.max(0,x.reduce((a,b)=>a+b*b,0)/x.length-mean*mean)):null,min:x.length?x[0]:null,max:x.length?x.at(-1):null,p1:quantile(x,.01),p5:quantile(x,.05),p10:quantile(x,.1),p25:quantile(x,.25),p50:quantile(x,.5),p75:quantile(x,.75),p90:quantile(x,.9),p95:quantile(x,.95),p99:quantile(x,.99)};}
export function forwardReturns(rowsByEpisode, row){const rows=rowsByEpisode.get(row.episodeId)||[];const index=rows.findIndex(x=>x.timestamp===row.timestamp);const base=Number(row.marketState?.price);const output={};for(const n of [1,3,5,10]){const next=rows[index+n];output["forwardReturn"+n]=next&&Number.isFinite(base)&&base>0&&Number(next.marketState?.price)>0?Number(next.marketState.price)/base-1:null;}return output;}
export function rewardRecord(row){return Number.isFinite(Number(row.reward))?Number(row.reward):null;}
