export type BatchSeed = string | number | bigint;

export function normalizeBatchSeed(seed: BatchSeed): number;

export function sampleWithSeed<T>(
  items: readonly T[],
  count: number,
  seed: BatchSeed,
): T[];

export function randomizedUniqueQueue<T extends Record<string, unknown>>(
  items: readonly T[],
  seed: BatchSeed,
  recentKeys?: readonly (string | number)[],
  key?: string,
): T[];
