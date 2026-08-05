import type { ZijinMainForceBar } from "./zijin-main-force-track.mjs";

export type ZijinMainForceIntent = {
  available:boolean;
  state:"waiting"|"accumulation"|"absorbed"|"outflow";
  label:string;
  confidence:number;
  message:string;
  evidence:string;
};

export function summarizeZijinMainForceIntent(bars?:ZijinMainForceBar[]):ZijinMainForceIntent;
