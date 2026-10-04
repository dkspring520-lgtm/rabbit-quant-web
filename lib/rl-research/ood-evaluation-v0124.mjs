import { createHash } from "node:crypto";
export const ACTIONS=Object.freeze(["WAIT","BUY_SMALL","SELL_ALL"]);
export function hash(v){return createHash("sha256").update(JSON.stringify(v)).digest("hex");}
export function normalize(vector,reference){return [1,...vector.slice(1).map((x,i)=>(x-reference.mean[i])/reference.std[i])];}
export function oodReasons(vector,reference,featureNames){return Object.fromEntries(vector.slice(1).map((x,i)=>[featureNames[i],Math.abs(x-reference.mean[i])>3*Math.max(reference.std[i],1e-9)]).filter(([,v])=>v));}
export function qValues(models,vector,predict){return Object.fromEntries(ACTIONS.map(action=>[action,predict(models[action],vector)]));}
export function rank(q){return Object.entries(q).sort((a,b)=>b[1]-a[1]).map(([a])=>a);}
export function quantile(values,q){const x=values.slice().sort((a,b)=>a-b);if(!x.length)return null;const i=(x.length-1)*q,l=Math.floor(i),h=Math.ceil(i);return l===h?x[l]:x[l]+(x[h]-x[l])*(i-l);}
export function summary(values){return {count:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,median:quantile(values,.5),p05:quantile(values,.05),p25:quantile(values,.25),p75:quantile(values,.75),p95:quantile(values,.95)};}
