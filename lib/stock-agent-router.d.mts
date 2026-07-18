export type StockAgent = Readonly<{
  id:"smart-t-v4"|"zijin-agent";
  code:string;
  name:string;
  shortName:string;
  mode:"formal"|"research-only";
  badge:string;
  canExecute:boolean;
  affectsV4:boolean;
}>;
export type StockAgentEvaluation = {
  agent:StockAgent;
  phase:"waiting"|"opening"|"intraday";
  status:"waiting"|"watch"|"candidate"|"blocked";
  direction:"正T"|"反T"|null;
  score:number;
  asOfTime:string|null;
  title:string;
  reasons:string[];
  metrics:{rangePct:number;vwapBiasPct:number;momentumPct:number;volumeRatio:number|null};
  executable:false;
  affectsV4:false;
};
export const STOCK_AGENTS:Readonly<{smartT:StockAgent;zijin:StockAgent}>;
export function resolveStockAgent(code?:string|null):StockAgent;
export function evaluateStockAgent(options?:{
  code?:string|null;
  minutes?:{time:string;price:number;volume:number}[];
  previousClose?:number|null;
}):StockAgentEvaluation|null;
