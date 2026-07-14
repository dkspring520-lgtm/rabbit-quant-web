export const A_SHARE_TRADING_MINUTES = 240;

export const A_SHARE_INTRADAY_AXIS = Object.freeze([
  { label: "09:30", slot: 0 },
  { label: "10:00", slot: 30 },
  { label: "10:30", slot: 60 },
  { label: "11:30/13:00", slot: 120 },
  { label: "14:00", slot: 180 },
  { label: "14:30", slot: 210 },
  { label: "15:00", slot: 240 },
]);

function parseClock(value) {
  const text = String(value ?? "");
  const colonMatch = text.match(/(?:^|\D)(\d{1,2}):(\d{2})(?::\d{2})?(?:\D|$)/);
  if (colonMatch) return { hour: Number(colonMatch[1]), minute: Number(colonMatch[2]) };

  const digits = text.replace(/\D/g, "");
  const compact = digits.length === 6 && Number(digits.slice(0, 2)) <= 23
    ? digits.slice(0, 4)
    : digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, "0");
  return { hour: Number(compact.slice(0, 2)), minute: Number(compact.slice(2, 4)) };
}

export function aShareMinuteSlot(time) {
  const { hour, minute } = parseClock(time);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return 0;

  const absoluteMinute = hour * 60 + minute;
  const morningOpen = 9 * 60 + 30;
  const morningClose = 11 * 60 + 30;
  const afternoonOpen = 13 * 60;
  const marketClose = 15 * 60;

  if (absoluteMinute <= morningOpen) return 0;
  if (absoluteMinute <= morningClose) return absoluteMinute - morningOpen;
  if (absoluteMinute < afternoonOpen) return 120;
  if (absoluteMinute <= marketClose) return 120 + absoluteMinute - afternoonOpen;
  return A_SHARE_TRADING_MINUTES;
}

export function isAShareTradingMinute(time) {
  const { hour, minute } = parseClock(time);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return false;
  const absoluteMinute = hour * 60 + minute;
  return (absoluteMinute >= 9 * 60 + 30 && absoluteMinute <= 11 * 60 + 30)
    || (absoluteMinute >= 13 * 60 && absoluteMinute <= 15 * 60);
}

export function intradayChartX(time, start = 10, width = 900) {
  return start + (aShareMinuteSlot(time) / A_SHARE_TRADING_MINUTES) * width;
}

export function intradaySlotX(slot, start = 10, width = 900) {
  const safeSlot = Math.min(A_SHARE_TRADING_MINUTES, Math.max(0, Number(slot) || 0));
  return start + (safeSlot / A_SHARE_TRADING_MINUTES) * width;
}
