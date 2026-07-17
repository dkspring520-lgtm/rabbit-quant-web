export type ZijinOpeningMinute = { time:string; price:number; volume:number };
export type ZijinOpeningStatus = "waiting" | "watch" | "candidate" | "blocked";
export type ZijinOpeningDirection = "正T" | "反T" | null;
export type ZijinOpeningMetrics = {
  latestPrice:number|null;
  vwap:number|null;
  openingRangePct:number;
  distanceToVwapPct:number;
  recoveryFromLowPct:number;
  pullbackFromHighPct:number;
  volumeRatio:number|null;
};
export type ZijinOpeningResult = {
  code:"601899";
  playbook:string;
  layer:"candidate-observation";
  status:ZijinOpeningStatus;
  direction:ZijinOpeningDirection;
  score:number;
  asOfTime:string|null;
  usedPoints:number;
  reasons:string[];
  metrics:ZijinOpeningMetrics;
};
export const ZIJIN_OPENING_PLAYBOOK:Readonly<{
  code:"601899";
  name:string;
  evaluationStart:"09:30";
  evaluationEnd:"10:30";
  minimumPoints:number;
  rangeThresholdPct:number;
  structureThresholdPct:number;
  momentumThresholdPct:number;
  minimumVolumeRatio:number;
  candidateScore:number;
  extremeRangePct:number;
  extremeVolumeRatio:number;
}>;
export function evaluateZijinOpeningPlaybook(
  minutePrefix:ZijinOpeningMinute[],
  options?:{previousClose?:number|null},
):ZijinOpeningResult;
