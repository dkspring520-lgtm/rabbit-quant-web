export type OrderFlowFormalSignal = {
  direction?: string|null;
  comparisonSide?: string|null;
  side?: string|null;
  action?: string|null;
  status?: string|null;
  confidence?: number|null;
  score?: number|null;
  time?: string|null;
  asOfTime?: string|null;
};

export type OrderFlowFormalRadar = {
  available?: boolean;
  reason?: string|null;
  asOfTime?: string|null;
  scores?: { lowBuy?: number|null; takeProfit?: number|null; stance?: string|null };
  delta?: { threeMinute?: number|null };
  divergence?: { label?: string|null };
  absorption?: { label?: string|null };
};

export type OrderFlowFormalLink = {
  displayOnly: true;
  affectsFormal: false;
  canCreateSignal: false;
  canBlockFormal: false;
  canModifyFormalDirection: false;
  canModifyFormalScore: false;
  canEnableExecution: false;
  formal: Record<string, unknown>;
  shadow: {
    available: boolean;
    lowBuyScore: number|null;
    takeProfitScore: number|null;
    divergence: string|null;
    absorption: string|null;
    reason: string|null;
    time: string|null;
  };
  formalDirection: string|null;
  shadowDirection: string|null;
  timeGapMinutes: number|null;
  scoreLabel: string;
  disclaimer: string;
  relation: string;
  state: string;
  tone: string;
  label: string;
  detail: string;
};

export function relateOrderFlowShadowToFormalSignal(input?: {
  formalSignal?: OrderFlowFormalSignal|null;
  orderFlowRadar?: OrderFlowFormalRadar|null;
  radar?: OrderFlowFormalRadar|null;
}): OrderFlowFormalLink;
