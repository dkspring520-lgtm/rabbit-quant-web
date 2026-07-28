export type ZijinPreopenPricePlan =
  | { active:false; ready:false; status:"inactive"; asOfTime:string|null; reason:string }
  | { active:true; ready:false; status:"forming"|"degraded"; asOfTime:string|null; reason:string }
  | {
      active:true;
      ready:true;
      status:"preopen-ready"|"degraded";
      asOfTime:string;
      anchorPrice:number;
      gapPct:number;
      buyRange:[number,number];
      sellRange:[number,number];
      expectedGrossSpread:number;
      minimumGrossSpread:number;
      confidence:number;
      position:string;
      source:string;
      reason:string;
    };

export function buildZijinPreopenPricePlan(input?:{
  phase?:string;
  asOfTime?:string|null;
  previousClose?:number|null;
  indicativePrice?:number|null;
  bookImbalance?:number|null;
  activeBuyRatio?:number|null;
  atrPct?:number|null;
  spreadBps?:number|null;
  l2Connected?:boolean;
  l2Stale?:boolean;
}):ZijinPreopenPricePlan;
