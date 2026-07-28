export type ZijinDisplacementWatch = {
  id: string;
  stage: "displacement-watch";
  direction: "正T" | "反T";
  label: string;
  time: string;
  price: number;
  vwap: number;
  biasPct: number;
  fastMovePct: number;
  tier: number;
  executable: false;
  reason: string;
};

export function evaluateZijinDisplacementWatch(
  rawMinutes?: Array<Record<string, unknown>>,
  options?: {
    minimumBiasPct?: number;
    tierStepPct?: number;
    minimumPoints?: number;
  },
): ZijinDisplacementWatch | null;
