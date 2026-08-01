export type SmartTMinute = {
  time: string;
  price: number;
  volume: number;
  l2?: {
    volatility?: {
      source?: string;
      period?: number;
      samples?: number;
      ready?: boolean;
      atr14?: number | null;
      atrPct14?: number | null;
    };
  };
};
export type SmartTAction = {
  time: string;
  side: "买入" | "卖出";
  price: number;
  quantity: number;
  curveIndex: number;
  direction: "正T" | "反T";
  cycleId: number;
  reason: string;
  meta?: Record<string, number | string | boolean>;
};
export type SmartTObservation = {
  time: string;
  price: number;
  direction: "正T" | "反T";
  score: number;
  threshold: number;
  scoreBreakdown?: {
    direction: number;
    location: number;
    trigger: number;
    thresholds: { direction: number; location: number; trigger: number };
    passed: { direction: boolean; location: boolean; trigger: boolean };
    confirmed: boolean;
  };
  similarity?: {
    samples: number;
    ready: boolean;
    hitRate: number | null;
    averageFavorablePct: number | null;
    averageAdversePct: number | null;
  };
  edge: number;
  executable: boolean;
  stage: "watch" | "candidate";
  coverageOnly?: boolean;
  pairGap: number | null;
  pivotTime: string;
  pivotPrice: number;
  pivotLabel: string;
  pivotAssessment: "strong" | "confirmed" | "unconfirmed";
  confirmationLabel: string;
  blockers: string[];
  reason: string;
};
export type SmartTReplayResult = {
  net: number;
  gross: number;
  fees: number;
  executionCost: number;
  maxDrawdown: number;
  trades: number;
  wins: number;
  days: number;
  curve: number[];
  curveTimes: string[];
  cycleNets: number[];
  candidateCycles: Array<{
    id: number;
    direction: "正T" | "反T";
    entryTime: string;
    entryPrice: number;
    entryLabel: string;
    exitTime: string;
    exitPrice: number;
    exitLabel: string;
    grossPct: number;
    holdingMinutes: number;
    mfePct: number;
    maePct: number;
    bestTime: string;
    worstTime: string;
    outcomeMode: "post-replay-causal";
    favorable: boolean;
    status: string;
  }>;
  candidateOutcomes: Array<{
    direction: "正T" | "反T";
    time: string;
    price: number;
    outcomeMode: "post-replay-fixed-horizon";
    horizons: Array<{
      minutes: number;
      complete: boolean;
      endTime?: string;
      returnPct?: number;
      mfePct?: number;
      maePct?: number;
      bestTime?: string;
      worstTime?: string;
    }>;
  }>;
  openCandidate: null | {
    direction: "正T" | "反T";
    time: string;
    price: number;
    label: string;
    status: "候补未闭环";
  };
  startTime: string;
  status: string;
  actions: SmartTAction[];
  observations: SmartTObservation[];
  diagnostics: Record<string, number>;
  gateAudit: null | {
    mode: "research-only-post-replay";
    horizonMinutes: number;
    rejectedCandidateMinutes: number;
    auditedCandidateMinutes: number;
    favourableRejected: number;
    gates: Record<string, {
      rejected: number;
      soleReject: number;
      favourable: number;
      favourableRate: number;
      soleFavourable: number;
      soleFavourableRate: number;
      averageMfePct: number;
      averageMaePct: number;
    }>;
  };
};
export type SmartTOptions = {
  capital: number;
  baseShares: number;
  sellable: number;
  feeRate: number;
  slippage: number;
  minCommission: boolean;
  slippageMode: "percent" | "tick";
  forceCloseTime: string;
  profile?: string;
  profileOverrides?: Record<string, number>;
  positionSizeMode?: "fixed" | "quality-tiered";
  minimumNetProfitAmount?: number;
  minimumGrossSpreadAmount?: number;
  previousClose?: number | null;
  randomValue?: number;
  strategyVersion?: string;
  gateAudit?: boolean;
  volatilityMode?: "fixed" | "causal-realized" | "causal-hybrid";
  similarityArchive?: Array<{
    date?: string;
    direction: "BUY_FIRST" | "SELL_FIRST";
    timeBucket: string;
    deviation: number;
    momentum3: number;
    volumeRatio: number;
    sessionMove: number;
    favorablePct: number;
    adversePct: number;
    hitTarget: boolean;
  }>;
};
export function runSmartTReplay(minutes: SmartTMinute[], options: SmartTOptions): SmartTReplayResult;
export function resolveReplayPositionSize(
  plannedQuantity: number,
  mode?: "fixed" | "quality-tiered" | "liquidity-risk-tiered",
  evidence?: {
    score?: number;
    threshold?: number;
    volumeRatio?: number;
    minuteVolume?: number;
    volatilityScale?: number;
    structuralConfirmation?: boolean;
    executionMomentumConfirmed?: boolean;
  },
): number;
export function evaluateTripleScoreEvidence(input: {
  rawScore?: number;
  rawThreshold?: number;
  regimeConflict?: boolean;
  vwapDirectionConflict?: boolean;
  deviation?: number;
  effectiveDeviation?: number;
  pivotReversal?: number;
  effectiveReversal?: number;
  edge?: number;
  requiredEdge?: number;
  structuralConfirmation?: boolean;
  executionMomentumConfirmed?: boolean;
  crossedVwap?: boolean;
  volumeRatio?: number;
}): SmartTObservation["scoreBreakdown"];
export function buildHistoricalSimilarityArchive(
  sessions: Array<{ date?: string; minutes?: SmartTMinute[] }>,
  options?: { asOfDate?: string | null; horizonMinutes?: number; stride?: number },
): NonNullable<SmartTOptions["similarityArchive"]>;
export function summarizeHistoricalSimilarity(
  feature: Record<string, unknown>,
  archive?: SmartTOptions["similarityArchive"],
  options?: { minimumSamples?: number; maximumSamples?: number },
): NonNullable<SmartTObservation["similarity"]>;
export function causalVolatilityScale(
  points: SmartTMinute[],
  index: number,
  options?: {
    window?: number;
    referencePct?: number;
    minScale?: number;
    maxScale?: number;
    minSamples?: number;
  },
): { scale: number; realisedPct: number; samples: number };
export function causalBrokerAtrScale(
  points: SmartTMinute[],
  index: number,
  options?: {
    referencePct?: number;
    minScale?: number;
    maxScale?: number;
    minSamples?: number;
  },
): {
  scale: number;
  realisedPct: number;
  samples: number;
  source: string;
  available: boolean;
};
export function buildCandidateObservationCycles(observations: SmartTObservation[], points?: SmartTMinute[]): {
  cycles: SmartTReplayResult["candidateCycles"];
  open: SmartTReplayResult["openCandidate"];
};
export function buildCandidateOutcomeLedger(observations: SmartTObservation[], points: SmartTMinute[], horizons?: number[]): SmartTReplayResult["candidateOutcomes"];
export function confirmCandidateDirectionFlip(input: {
  oppositeCandidate?: null | { minute: number };
  pairEconomicallyDistinct: boolean;
  nowMinute: number;
  cooldown: number;
  structuralConfirmation: boolean;
  executionMomentumConfirmed: boolean;
}): boolean;
export function evaluateStructuralStop(input: {
  direction: "BUY_FIRST" | "SELL_FIRST";
  currentPrice: number;
  previousPrice: number;
  beforePrice: number;
  entryPivotPrice: number;
  movePct: number;
  holdMinutes: number;
  hardStopPct: number;
  catastrophicStopPct: number;
  stopBreakBufferPct: number;
  softStopPct: number;
  softStopMinutes: number;
}): {
  stop: boolean;
  catastrophicStop: boolean;
  structuralStopConfirmed: boolean;
  pivotBreakPrice: number;
  adverseMomentum: boolean;
};
export function qualifiesMatureSellReversalRiskOverride(input: {
  direction: "BUY_FIRST" | "SELL_FIRST";
  trendRiskVotes: number;
  maxTrendRiskVotes: number;
  trendRiskGroups: {
    cycleRegime: boolean;
    oneWayContinuation: boolean;
    weakReversalQuality: boolean;
  };
  pivotAge: number;
  minPivotAge?: number;
  orderFlow?: {
    available?: boolean;
    pass?: boolean;
    score?: number;
  };
}): boolean;
export function confirmsRapidRiseSellReversal(input: {
  direction: "BUY_FIRST" | "SELL_FIRST";
  rapidRiseUnconfirmed?: boolean;
  pivotAge?: number;
  minPivotAge?: number;
  maxUnconfirmedPivotAge?: number;
  structuralConfirmation?: boolean;
  executionMomentumConfirmed?: boolean;
  executionConfirmationVotes?: number;
}): boolean;
export function isWithinSellEntryTimeWindow(input: {
  direction: "BUY_FIRST" | "SELL_FIRST";
  time?: string;
  maxSellEntryTime?: string | null;
}): boolean;
export function evaluateAdaptiveTimeExit(input: {
  direction: "BUY_FIRST" | "SELL_FIRST";
  points: Array<{ price: number }>;
  index: number;
  vwaps: number[];
  entryPivotPrice: number;
  holdMinutes: number;
  reviewMinutes?: number;
  maxHoldMinutes?: number;
  pivotBufferPct?: number;
  momentumPct?: number;
}): {
  exit: boolean;
  reviewing: boolean;
  extended: boolean;
  reason: string;
  maxHoldReached?: boolean;
  pivotIntact?: boolean;
  supportVotes?: number;
  momentum3?: number;
  momentum8?: number;
};
export const PROFILES: Record<string, {
  score: number;
  cooldown: number;
  candidateNetPct: number;
  targetNetPct: number;
  maxTargetNetPct: number;
  minHoldMinutes: number;
  maxCycles: number;
  deviation: number;
  reversal: number;
  maxSellPullback: number;
  hardStopPct?: number;
  catastrophicStopPct?: number;
  stopBreakBufferPct?: number;
  softStopPct?: number;
  softStopMinutes?: number;
  timeExitMinutes?: number;
  adaptiveTimeExit?: number;
  adaptiveMaxHoldMinutes?: number;
  adaptiveExitPivotBufferPct?: number;
  adaptiveExitMomentumPct?: number;
  trailActivationPct?: number;
  trailRetracePct?: number;
  trailMinNetPct?: number;
  maxOpeningChasePct?: number;
  strongBuySessionMove?: number;
  strongBuyVwap30?: number;
  strongSellSessionMove?: number;
  strongSellVwap30?: number;
  counterTrendVwap30?: number;
  counterTrendSessionMove?: number;
  counterTrendMinVolumeRatio?: number;
  maxBuyTrendRiskVotes?: number;
  maxSellTrendRiskVotes?: number;
  matureSellReversalMinPivotAge?: number;
}>;
