export type ZijinRepairCandidate = {
  ready:boolean;
  phase:"repair";
  status:"waiting"|"watch"|"candidate";
  direction:"正T";
  score:number;
  asOfTime:string|null;
  title:string;
  reasons:string[];
  hardConditions:{afterStart:boolean;deepVwapDiscount:boolean};
  checks:Record<string,boolean>;
  metrics:Record<string,unknown>;
  candidateKey:string|null;
  executable:false;
  affectsV4:false;
};

export const ZIJIN_REPAIR_RULES:Readonly<Record<string,number|string>>;
export function evaluateZijinRepairCandidate(
  minutes?:Array<Record<string,unknown>>,
  options?:Record<string,number|string>,
):ZijinRepairCandidate;

