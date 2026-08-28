export type IntradayRegime = "BULL_TREND" | "BEAR_TREND" | "WIDE_RANGE" | "NARROW_RANGE" | "NEUTRAL";

export type RegimeEvaluation = {
  regime: IntradayRegime;
  vwapSlope15: number;
  vwapAboveRatio30: number;
  sessionRangePct: number;
  sessionMovePct: number;
  vwapCrossings: number;
  atrRatio: number;
  /** Intra-session volume acceleration: 5-minute SMA / 20-minute SMA. */
  volumeRatio: number | null;
  /** 量比: causal mean volume per elapsed minute / avgVolume5d. Null without a baseline. */
  sessionVolumeRatio: number | null;
  regimeMultiplier: {
    targetNetPctMultiplier: number;
    hardStopPctMultiplier: number;
    allowPositiveT: boolean;
    allowReverseT: boolean;
    counterTrendStrictness: number;
  };
};

export function detectCausalMarketRegime(
  points: Array<{ time?: string; price: number; high?: number; low?: number; volume?: number }>,
  currentIndex: number,
  vwaps?: number[],
  previousClose?: number | { previousClose?: number; avgAtr5d?: number; avgVolume5d?: number } | null,
  options?: { avgAtr5d?: number; avgVolume5d?: number },
): RegimeEvaluation;
