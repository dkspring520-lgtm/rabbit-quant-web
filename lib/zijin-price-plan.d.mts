export type ZijinPricePlanMinute = { time:string; price:number };
export type ZijinPricePlan =
  | { ready:false; status:"warming"; asOfTime:string|null; reason:string }
  | {
      ready:true;
      status:"ready"|"waiting";
      asOfTime:string;
      buyRange:[number,number];
      sellRange:[number,number];
      expectedGrossSpread:number;
      minimumGrossSpread:number;
      confidence:number;
      confidenceBreakdown:{label:string;value:number}[];
      position:string;
      riskPlan:{
        positiveT:{hardStop:number;takeProfit1:number;takeProfit2:number;invalidation:string};
        reverseT:{hardStop:number;takeProfit1:number;takeProfit2:number;invalidation:string};
      };
      source:string;
      reason:string;
    };
export function buildZijinPricePlan(input?:{
  minutes?:ZijinPricePlanMinute[];
  previousClose?:number|null;
  open?:number|null;
  vwap?:number|null;
  l2Coverage?:number;
}):ZijinPricePlan;
