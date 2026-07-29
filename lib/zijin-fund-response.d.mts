import type { ZijinMainForceBar } from "./zijin-main-force-track.mjs";

export type ZijinFundResponse = {
  ready:boolean;
  state:"waiting"|"push"|"absorbed"|"accumulation"|"outflow";
  label:string;
  score:number;
  netNotional:number;
  priceChangePercent:number;
  persistence:number;
  message:string;
  evidence:string;
};

export function evaluateZijinFundResponse(bars?:ZijinMainForceBar[], windowSize?:number):ZijinFundResponse;
