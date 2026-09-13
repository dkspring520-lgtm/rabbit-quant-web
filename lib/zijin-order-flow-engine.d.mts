export type ZijinOrderFlowDelta = {
  oneMinute: number|null;
  threeMinute: number|null;
  fiveMinute: number|null;
  oneMinuteVolume?: number|null;
  threeMinuteVolume?: number|null;
  fiveMinuteVolume?: number|null;
  activeBuyRatio?: number|null;
};
export type ZijinOrderFlowFootprintRow = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  deltaVolume: number;
  trades?: number;
};
export type ZijinOrderFlowEvidence = { label: string; reason: string; value?: number|null };
export type ZijinOrderFlowRadarUnavailable = {
  available: false;
  reason: string;
  researchOnly: true;
  canCreateSignal: false;
  asOfTime?: string | null;
  footprint?: ZijinOrderFlowFootprintRow[];
  reference?: Record<string, unknown>;
  scores?: { lowBuy: number; takeProfit: number; stance?: string };
  efficiency?: Record<string, unknown>;
  observedMinutes?: number;
  delta?: ZijinOrderFlowDelta;
  absorption?: ZijinOrderFlowEvidence;
  divergence?: ZijinOrderFlowEvidence;
};
export type ZijinOrderFlowRadar = {
  available: true;
  asOfTime: string|null;
  researchOnly: true;
  canCreateSignal: false;
  observedMinutes: number;
  delta: ZijinOrderFlowDelta;
  footprint: ZijinOrderFlowFootprintRow[];
  reference: Record<string, unknown>;
  scores: { lowBuy: number; takeProfit: number; stance: string };
  efficiency: ZijinOrderFlowEvidence;
  absorption: ZijinOrderFlowEvidence;
  divergence: ZijinOrderFlowEvidence;
  [key: string]: unknown;
};
export function evaluateZijinOrderFlowRadar(input?: {
  minutes?: Array<Record<string, unknown>>;
  index?: number;
  stale?: boolean;
}): ZijinOrderFlowRadar | ZijinOrderFlowRadarUnavailable;
