export type Web4VoteState = "support" | "waiting" | "conflict" | "missing";
export type Web4RealtimeResult = {
  version: "WEB 4.0";
  status: "scanning" | "degraded" | "conflict" | "risk" | "candidate" | "confirming" | "confirmed";
  label: string;
  direction: "正T" | "反T" | null;
  confidence: number;
  /** Multi-source consistency in the diagnostic shadow layer only. */
  shadowAligned: boolean;
  /** Always false: this monitor must not alter formal strategy execution. */
  affectsFormal: false;
  candidate: boolean;
  nonTechnicalSupport: number;
  votes: Array<{ id:string; label:string; state:Web4VoteState; detail:string }>;
  blockers: string[];
  asOf: string;
  summary: string;
};
export function evaluateWeb4RealtimeMonitor(input?: Record<string, unknown>): Web4RealtimeResult;
