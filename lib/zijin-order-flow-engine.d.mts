export type ZijinOrderFlowRadarUnavailable = {
  available: false;
  reason: string;
  researchOnly: true;
  canCreateSignal: false;
  asOfTime?: string | null;
  footprint?: Array<Record<string, unknown>>;
  reference?: Record<string, unknown>;
  scores?: { lowBuy: number; takeProfit: number; stance?: string };
  efficiency?: Record<string, unknown>;
  observedMinutes?: number;
  delta?: number;
  absorption?: Record<string, unknown>;
  divergence?: Record<string, unknown>;
};
export type ZijinOrderFlowRadar = {
  available: true;
  researchOnly: true;
  canCreateSignal: false;
  observedMinutes: number;
  delta: number;
  footprint: Array<Record<string, unknown>>;
  reference: Record<string, unknown>;
  scores: { lowBuy: number; takeProfit: number; stance: string };
  efficiency: Record<string, unknown>;
  [key: string]: unknown;
};
export function evaluateZijinOrderFlowRadar(input?: {
  minutes?: Array<Record<string, unknown>>;
  index?: number;
  stale?: boolean;
}): ZijinOrderFlowRadar | ZijinOrderFlowRadarUnavailable;
