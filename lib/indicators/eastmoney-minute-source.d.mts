export interface MinuteFeedSnapshot {
  symbol: string; provider: string; status: string; kdj: unknown;
  acceptedBars: unknown[]; candidateBars: unknown[]; blockers: string[];
  requestedAt: string; receivedAt: string; [key: string]: unknown;
}
export function readEastmoneyMinuteSnapshot(symbol?: string, options?: {
  fetchImpl?: typeof fetch; now?: () => number; onObservation?: (record: unknown) => void;
}): Promise<MinuteFeedSnapshot>;
export function markMinuteSourceDisconnected(symbol?: string): void;
