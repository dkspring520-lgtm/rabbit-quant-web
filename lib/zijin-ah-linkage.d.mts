export type ZijinAhMinute = { time:string; price:number };
export type ZijinAhLinkagePoint = {
  time:string; aPrice:number; hkPrice:number;
  aReturnPercent:number; hkReturnPercent:number; returnPercent:number;
};
export type ZijinAhLinkage = {
  available:boolean;
  state:string;
  label:string;
  bias:"buy"|"sell"|"neutral";
  weight:number;
  reason:string;
  asOfTime:string|null;
  spreadPercent:number|null;
  aReturnPercent?:number;
  hkReturnPercent?:number;
  aMomentum3?:number;
  hkMomentum3?:number;
  aMomentum5?:number;
  hkMomentum5?:number;
  points:ZijinAhLinkagePoint[];
};
export function analyzeZijinAhLinkage(input?:{
  aMinutes?:ZijinAhMinute[];
  aPreviousClose?:number|null;
  hkMinutes?:ZijinAhMinute[];
  hkPreviousClose?:number|null;
}):ZijinAhLinkage;
