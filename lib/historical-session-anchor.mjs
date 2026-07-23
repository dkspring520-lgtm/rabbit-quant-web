const dateKey = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 8);

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * Resolve the previous close for a historical intraday replay without using
 * today's quote or a daily bar from after the replay date.
 */
export function resolveHistoricalPreviousClose(session, bars = []) {
  const sessionPreviousClose = positiveNumber(session?.previousClose);
  if (sessionPreviousClose !== null) return sessionPreviousClose;

  const targetDate = dateKey(session?.date);
  if (!targetDate) return null;

  let matchedDate = "";
  let matchedClose = null;
  for (const bar of bars) {
    const barDate = dateKey(bar?.date);
    const close = positiveNumber(bar?.close);
    if (!barDate || close === null || barDate >= targetDate || barDate <= matchedDate) continue;
    matchedDate = barDate;
    matchedClose = close;
  }
  return matchedClose;
}
