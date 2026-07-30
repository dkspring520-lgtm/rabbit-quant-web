export type Web4MicrostructureResult = {
  available:boolean;
  stale:boolean;
  state:string;
  score:number;
  label:string;
  direction?:"正T"|"反T";
  buyScore:number;
  sellScore:number;
  buyGroups?:number;
  sellGroups?:number;
  evidence:string[];
  rvol:{available:boolean;latestTime:string;currentVolume:number;baseline:number|null;sessions:number;value:number|null};
  cvd:{available:boolean;samples:number;unit:string;totalNet:number;totalBalance:number|null;recentNet:number;recentBalance:number|null;persistence:number;recent:unknown[]};
  absorption:{available:boolean;side:string;score:number;priceChangePct:number|null;rangePosition:number|null};
  book:{available:boolean;imbalance:number|null;micropriceEdgeBps:number|null;spreadBps:number|null};
};

export function evaluateWeb4Microstructure(input?:{
  points?:unknown[];
  historicalSessions?:unknown[];
  liveL2?:unknown;
  asOfDate?:string|null;
  stale?:boolean;
}):Web4MicrostructureResult;
