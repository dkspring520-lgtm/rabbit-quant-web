export type NormalizedQmtOrderFlow = {
  activeBuyVolume: number | null;
  activeSellVolume: number | null;
  activeBuyRatio: number | null;
  activeBuyNotional: number | null;
  activeSellNotional: number | null;
  ddx: number | null;
  bigOrderNet: number | null;
  bigBuyNotional: number | null;
  bigSellNotional: number | null;
  buySweepStreak: number | null;
  sellSweepStreak: number | null;
  transactionCount: number | null;
  bid1Price: number | null;
  ask1Price: number | null;
  bid1Volume: number | null;
  ask1Volume: number | null;
  bidVolumes: number[] | null;
  askVolumes: number[] | null;
  bidPrices: number[] | null;
  askPrices: number[] | null;
  nearTouchImbalance: number | null;
  spreadBps: number | null;
  microprice: number | null;
  micropriceEdgeBps: number | null;
  atr: number | null;
  atrPct: number | null;
  atrSamples: number | null;
  atrReady: boolean;
  status: Record<string, unknown>;
};

export type OrderBookImbalanceResult = {
  obi: number;
  depthRatio: number;
  totalBidDepth: number;
  totalAskDepth: number;
  spoofingRisk: "NONE" | "BULL_TRAP" | "BEAR_TRAP";
  available: boolean;
};

export function normalizeQmtOrderFlow(point: unknown): NormalizedQmtOrderFlow;
export function evaluateOrderBookImbalance(l2Snapshot: unknown): OrderBookImbalanceResult;
export function evaluateQmtOrderFlow(points: unknown[], index: number, phase?: "BUY_FIRST" | "SELL_FIRST"): {
  available: boolean;
  bookAvailable: boolean;
  pass: boolean;
  score: number;
  required: number;
  activeBuyRatio?: number;
  bookRatio?: number;
  depthImbalance?: number;
  integrityBlocked?: boolean;
  marketQualityBlocked?: boolean;
  reason: string;
};
export function summarizeZijinOrderFlow(point: unknown): {
  available: boolean;
  bookAvailable?: boolean;
  required?: number;
  stance: "buy" | "sell" | "neutral";
  score: number;
  buyVotes?: number;
  sellVotes?: number;
  activeBuyRatio?: number;
  depthImbalance?: number;
  bookRatio?: number;
  reason: string;
};
