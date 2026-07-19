export function moveWatchlistItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) return [];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return [...items];
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveWatchlistItemByCode(items, sourceCode, targetCode) {
  if (!Array.isArray(items)) return [];
  const fromIndex = items.findIndex((item) => item?.code === sourceCode);
  const toIndex = items.findIndex((item) => item?.code === targetCode);
  return moveWatchlistItem(items, fromIndex, toIndex);
}
