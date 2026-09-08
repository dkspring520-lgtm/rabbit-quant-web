import type { ZijinMainForceBar } from "./zijin-main-force-track.mjs";

export type ZijinFundResponse = {
  ready:boolean;
  state:"waiting"|"push"|"absorbed"|"accumulation"|"outflow";
  label:string;
  score:number;
  netNotional:number;
  netFlowAcceleration:number;
  outflowDecelerating:boolean;
  /** L2/order-flow shadow flag; it never blocks a formal positive-T signal. */
  bearishFlowShadow:boolean;
  priceChangePercent:number;
  persistence:number;
  message:string;
  evidence:string;
};

export function evaluateZijinFundResponse(bars?:ZijinMainForceBar[], windowSize?:number):ZijinFundResponse;
