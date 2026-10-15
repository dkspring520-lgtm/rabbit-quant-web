export const KDJ_CONTRACT_VERSION: string;
export const KDJ_DEFAULT_PERIOD: 9;
export interface KdjOptions {
  period?: number; n?: number; length?: number; signal?: 3;
  timeframeMinutes?: number; timestampRole?: "end"; completedBars?: boolean;
  asOf?: string | number;
}
export interface KdjSample {
  timestamp: unknown;
  value: { k: number; d: number; j: number } | null;
  metadata: { contractVersion: string; inputKind: "OHLC"; valid: boolean; status: string;
    reason: string | null; period: number; smoothing: number; seed: number; warmupBars: number;
    validWindowBars: number; barEndTime: number | null; availableAt: number | null;
    resetReason: string | null; rsv: number | null };
}
export function resolveKdjOptions(options?: KdjOptions): KdjOptions & { period: number; timeframeMinutes: number };
export class CausalKdj {
  constructor(options?: KdjOptions);
  update(bar?: unknown, context?: { asOf?: string | number }): KdjSample;
  updateSeries(bars?: readonly unknown[], context?: { asOf?: string | number }): KdjSample[];
}
export function calculateKdjSeries(bars?: readonly unknown[], options?: KdjOptions): KdjSample[];
