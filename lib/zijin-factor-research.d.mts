export type ZijinFactorMinute = { time:string; price:number; volume:number };
export type ZijinFactorSession = { date:string; previousClose?:number|null; minutes:ZijinFactorMinute[] };
export type ZijinFactorSnapshot = {
  asOfTime:string|null; points:number; price:number|null; vwap:number|null;
  vwapBiasPct:number; momentum3Pct:number; volumeRatio:number|null; rangePct:number;
  direction:"positive"|"reverse"|null; directionLabel:"正T"|"反T"|null;
  score:number; status:"waiting"|"watch"|"candidate"; label:string;
};
export type ZijinFactorResearch = {
  mode:"research-only"; affectsV4:false; live:ZijinFactorSnapshot;
  evidence:{sessions:number;samples:number;trainingSamples:number;validationSamples:number;validationWins:number;validationWinRate:number|null;validationNetAveragePct:number;ready:boolean;label:string};
};
export const ZIJIN_FACTOR_RESEARCH:Readonly<{code:string;horizonMinutes:number;estimatedRoundTripCostPct:number;minimumLivePoints:number;validationRatio:number}>;
export function calculateZijinFactorSnapshot(minutes:ZijinFactorMinute[],previousClose?:number|null):ZijinFactorSnapshot;
export function analyzeZijinFactorResearch(options?:{sessions?:ZijinFactorSession[];liveMinutes?:ZijinFactorMinute[];previousClose?:number|null}):ZijinFactorResearch;
