import { createHash } from "node:crypto";
export const ACTIONS=Object.freeze(["WAIT","BUY_SMALL","BUY","SELL_PART","SELL_ALL"]);
export const V21_STRATEGY_ID="OHLCV_T_RESEARCH_V2";
export const V21_STRATEGY_VERSION="OHLCV_T_RESEARCH_V2_1_RESEARCH_ONLY_V0.1";
export function hash(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function summary(values){const x=values.slice().sort((a,b)=>a-b);const q=p=>x.length?x[Math.floor((x.length-1)*p)]:null;const mean=x.length?x.reduce((a,b)=>a+b,0)/x.length:null;return {count:x.length,min:x.length?x[0]:null,p01:q(.01),p05:q(.05),p10:q(.10),p25:q(.25),median:q(.5),p50:q(.5),p75:q(.75),p90:q(.9),p95:q(.95),p99:q(.99),max:x.length?x.at(-1):null,mean,std:x.length?Math.sqrt(Math.max(0,x.reduce((a,b)=>a+b*b,0)/x.length-mean*mean)):null};}
export function scoreBin(score){if(score<60)return "<60";if(score<65)return "60-65";if(score<70)return "65-70";if(score<75)return "70-75";if(score<80)return "75-80";if(score<85)return "80-85";if(score<90)return "85-90";if(score<95)return "90-95";return ">=95";}
export function hasPartialExitContext(account={}){return Number(account.position)>0&&Number(account.sellablePosition)>0&&Number(account.sellablePosition)<=Number(account.position)&&Number(account.todayBought||0)<=Number(account.position)-Number(account.sellablePosition);}
export function classifyPartialCandidate({reverseT=false,score=0,account={}}={}){if(!reverseT)return {candidate:false,reason:"NO_REVERSE_T"};if(!hasPartialExitContext(account))return {candidate:false,reason:"INFEASIBLE_PORTFOLIO_CONTEXT"};return {candidate:false,reason:score<75?"NO_OBSERVED_PARTIAL_EXIT_REGIME":"STRONG_REVERSE_T_RESERVED_FOR_SELL_ALL"};}
