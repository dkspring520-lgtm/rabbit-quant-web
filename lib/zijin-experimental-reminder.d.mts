export type ZijinExperimentalReminder = {
  id:string;
  stage:"experimental-candidate";
  direction:"正T"|"反T";
  asOfTime:string;
  price:number;
  vwap:number;
  vwapBiasPct:number;
  volumeRatio:number;
  regimeSlopePct:number;
  executable:false;
  affectsV4:false;
  title:string;
  reason:string;
  plan:string;
};
export const ZIJIN_EXPERIMENTAL_REMINDER:Readonly<{
  code:"601899";
  id:string;
  minimumVolumeRatio:number;
  maximumVolumeRatio:number;
  armedMinutes:number;
  volumeLookback:number;
  minimumVwapDeviationPct:number;
  minimumRegimeSlopePct:number;
  signalStart:string;
  signalEnd:string;
  minimumProtectedNetPct:number;
  maximumProtectedNetPct:number;
  maximumHoldMinutes:number;
  maximumRemindersPerDay:number;
}>;
export function evaluateZijinExperimentalReminder(
  minutes?:{time:string;price:number;volume:number}[],
  options?:Partial<typeof ZIJIN_EXPERIMENTAL_REMINDER>,
):ZijinExperimentalReminder|null;

