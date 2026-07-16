export type BatchSeed = string | number | bigint;

export function normalizeBatchSeed(seed: BatchSeed): number;

export function sampleWithSeed<T>(
  items: readonly T[],
  count: number,
  seed: BatchSeed,
): T[];
