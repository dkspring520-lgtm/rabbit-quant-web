import { readFile } from 'node:fs/promises';
export async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
export function mergeUnverifiedArchive(previous, date, minutes, updatedAt) {
  const rows = new Map((previous?.minutes ?? []).map(row => [row.exchangeMinute, row]));
  for (const row of minutes) {
    if (!String(row.exchangeMinute ?? '').startsWith(`${date}-`)) continue;
    rows.set(row.exchangeMinute, { ...row, quality: { ...row.quality, verified: false } });
  }
  return { schemaVersion: 2, symbol: '601899', date, updatedAt, causal: false,
    completionStatus: 'SOURCE_FINALITY_AND_AVAILABILITY_UNVERIFIED',
    minutes: [...rows.values()].sort((a,b)=>a.exchangeMinute.localeCompare(b.exchangeMinute)) };
}
