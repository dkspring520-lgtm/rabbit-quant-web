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
export function evaluateZijinPreopenGate(input?:{plan?:ZijinPreopenPricePlan|null; minutes?:Array<Record<string,unknown>>}): {
  mode: "shadow-only"; predictedDirection: string|null; anchorDirection: string|null;
  anchorSource: string|null; allowedDirections: string[]; confirmationCount: number;
  requiredConfirmations: number; asOfTime: string|null; expiresAt: string;
  executable: boolean; affectsV4: boolean; phase: string; status: string; reason: string;
  [key: string]: unknown;
};
