export type ZijinDisplacementWatch = {
  id: string;
  stage: "displacement-watch" | "displacement-progress" | "displacement-l2-confirmation";
  direction: "正T" | "反T";
  label: string;
  time: string;
  price: number;
  vwap: number;
  biasPct: number;
  fastMovePct: number;
  progressPct: number;
  tier: number;
  l2: {
    available: boolean;
    confirmed: boolean;
    aligned: number;
    samples: number;
    activeBuyRatio: number | null;
  };
  executable: false;
  reason: string;
};

export function evaluateZijinDisplacementWatch(
  rawMinutes?: Array<Record<string, unknown>>,
  options?: {
    minimumBiasPct?: number;
    tierStepPct?: number;
    minimumPoints?: number;
    lookbackPoints?: number;
    minimumProgressPct?: number;
    minimumMomentum3Pct?: number;
  },
): ZijinDisplacementWatch | null;
