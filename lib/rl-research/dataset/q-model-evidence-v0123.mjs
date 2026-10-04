import { createHash } from "node:crypto";
import { featureVector } from "./value-q-benchmark-v011.mjs";
export const ACTIONS=Object.freeze(["WAIT","BUY_SMALL","SELL_ALL"]);export const ALGORITHM_VERSION="CQL_INSPIRED_LINEAR_V0.12.1";export const SAMPLING_VERSION="SHA256_SYMBOL_TIMESTAMP_SCENARIO_V0.1";
export function stats(){return {count:0,sum:[],sumSq:[]};}
export function addStats(s,v){if(!s.sum.length){s.sum=Array(v.length-1).fill(0);s.sumSq=Array(v.length-1).fill(0);}s.count++;for(let i=1;i<v.length;i++){s.sum[i-1]+=v[i];s.sumSq[i-1]+=v[i]*v[i];}return s;}
export function finishStats(s){const mean=s.sum.map(x=>x/s.count);const std=s.sumSq.map((x,i)=>Math.sqrt(Math.max(0,x/s.count-mean[i]**2))||1);return {count:s.count,mean,std};}
export function normalize(v,n){return [1,...v.slice(1).map((x,i)=>(x-n.mean[i])/n.std[i])];}
export function acc(d){return {count:0,xtx:Array.from({length:d},()=>Array(d).fill(0)),xty:Array(d).fill(0)};}
export function addSample(a,v,y){a.count++;for(let i=0;i<v.length;i++){a.xty[i]+=v[i]*y;for(let j=0;j<v.length;j++)a.xtx[i][j]+=v[i]*v[j];}}
function solve(m,b,r=.001){const n=b.length,a=m.map((x,i)=>[...x,b[i]]);for(let i=0;i<n;i++){a[i][i]+=r;let p=i;for(let k=i+1;k<n;k++)if(Math.abs(a[k][i])>Math.abs(a[p][i]))p=k;[a[i],a[p]]=[a[p],a[i]];const q=a[i][i]||1e-12;for(let j=i;j<=n;j++)a[i][j]/=q;for(let k=0;k<n;k++){if(k===i)continue;const f=a[k][i];for(let j=i;j<=n;j++)a[k][j]-=f*a[i][j];}}return a.map(x=>x[n]);}
export function fit(a){return {count:a.count,weights:solve(a.xtx,a.xty)};}
export function predict(model,v){return model.weights.reduce((s,x,i)=>s+x*v[i],0);}
export function hash(v){return createHash("sha256").update(JSON.stringify(v)).digest("hex");}
export function sample(row,rate=.0005){const key=String(row.symbol)+"|"+String(row.timestamp)+"|"+String(row.scenarioId);const h=parseInt(createHash("sha256").update(key).digest("hex").slice(0,8),16)/0xffffffff;return h<rate;}
export function rank(q){return Object.entries(q).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);}
