export type HistoricalSession = { date?:string|null; previousClose?:number|null };
export type HistoricalDailyBar = { date?:string|null; close?:number|null };
export function resolveHistoricalPreviousClose(
  session:HistoricalSession,
  bars?:HistoricalDailyBar[],
):number|null;
