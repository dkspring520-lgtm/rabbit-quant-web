export type IntradayAxisTick = { label: string; slot: number };

export const A_SHARE_TRADING_MINUTES: number;
export const A_SHARE_INTRADAY_AXIS: readonly IntradayAxisTick[];
export function aShareMinuteSlot(time: string | number | null | undefined): number;
export function isAShareTradingMinute(time: string | number | null | undefined): boolean;
export function intradayChartX(time: string | number | null | undefined, start?: number, width?: number): number;
export function intradaySlotX(slot: number, start?: number, width?: number): number;
