export type SmartTMinute = { time: string; price: number; volume: number };
export type SmartTAction = { time:string; side:"买入"|"卖出"; price:number; quantity:number; curveIndex:number; direction:"正T"|"反T"; cycleId:number };
export type SmartTReplayResult = {
  net:number; gross:number; fees:number; executionCost:number; maxDrawdown:number;
  trades:number; wins:number; days:number; curve:number[]; curveTimes:string[];
  cycleNets:number[]; startTime:string; status:string; actions:SmartTAction[];
  diagnostics:Record<string,number>;
};
export type SmartTOptions = {
  capital:number; baseShares:number; sellable:number; feeRate:number; slippage:number;
  minCommission:boolean; slippageMode:"percent"|"tick"; forceCloseTime:string;
  profile?:string; previousClose?:number|null; randomValue?:number;
};
export function runSmartTReplay(minutes:SmartTMinute[], options:SmartTOptions):SmartTReplayResult;
export const PROFILES:Record<string,{score:number;cooldown:number;minNetPct:number;maxCycles:number}>;
