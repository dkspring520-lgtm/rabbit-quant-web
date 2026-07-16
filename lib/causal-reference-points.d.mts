export type CausalMinute = { time: string; price: number; volume?: number };
export type CausalReferencePoint = {
  time: string;
  price?: number;
  direction: "正T" | "反T";
  score: number;
  threshold: number;
  edge: number;
  executable: boolean;
  stage?: "watch" | "candidate";
  pairGap?: number | null;
  pivotTime?: string;
  pivotPrice?: number;
  pivotLabel?: string;
  pivotAssessment?: "strong" | "confirmed" | "unconfirmed";
  confirmationLabel?: string;
  blockers: string[];
  reason: string;
};

export function buildCausalReferencePoints(
  minutes: CausalMinute[],
  observations?: CausalReferencePoint[],
): CausalReferencePoint[];
