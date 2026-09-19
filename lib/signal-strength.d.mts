export function signalStrengthPresentation(input?: {
  score?: number | null;
  historicalProbability?: number | null;
}): { label: string; detail: string };
export function observationConfirmationScore(observation: {
  confirmationScore?: number | null;
  score?: number;
  scoreBreakdown?: { direction: number; location: number; trigger: number };
}, strategy: string): number | null;
export function scoreGrade(score: number | null): string;
export function buyRiskPresentation(observation: Parameters<typeof observationConfirmationScore>[0], strategy?: string): string;
