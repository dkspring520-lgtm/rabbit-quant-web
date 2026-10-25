export function paperTradingDate(value) {
  const date = String(value ?? '').replace(/-/g, '');
  if (!/^\d{8}$/.test(date)) throw new RangeError('Invalid paper trading date');
  const iso = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== iso) throw new RangeError('Invalid paper trading date');
  return date;
}
