const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function seedText(seed) {
  if (typeof seed === "string") return `string:${seed}`;
  if (typeof seed === "number") {
    if (Number.isNaN(seed)) return "number:NaN";
    if (seed === Infinity) return "number:Infinity";
    if (seed === -Infinity) return "number:-Infinity";
    if (Object.is(seed, -0)) return "number:-0";
    return `number:${seed}`;
  }
  if (typeof seed === "bigint") return `bigint:${seed}`;
  throw new TypeError("seed must be a string, number, or bigint");
}

/** Convert an accepted seed, including an empty string, to a stable uint32. */
export function normalizeBatchSeed(seed) {
  const text = seedText(seed);
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function normalizedCount(count, length) {
  const requested = Number(count);
  if (Number.isNaN(requested) || requested <= 0 || length === 0) return 0;
  if (requested === Infinity) return length;
  if (!Number.isFinite(requested)) return 0;
  return Math.min(length, Math.floor(requested));
}

/**
 * Sample array positions without replacement using a reproducible seed.
 *
 * The function intentionally performs no validation or de-duplication of the
 * item values. Callers can clean a domain-specific stock pool before sampling.
 */
export function sampleWithSeed(items, count, seed) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");

  const pool = items.slice();
  const limit = normalizedCount(count, pool.length);
  if (limit === 0) return [];

  const random = mulberry32(normalizeBatchSeed(seed));
  for (let index = 0; index < limit; index += 1) {
    const remaining = pool.length - index;
    const selected = index + Math.floor(random() * remaining);
    [pool[index], pool[selected]] = [pool[selected], pool[index]];
  }

  return pool.slice(0, limit);
}
