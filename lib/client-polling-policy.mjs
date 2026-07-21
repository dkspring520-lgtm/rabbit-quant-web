const intervals = Object.freeze({
  activeQuote: { live: 1_000, idle: 30_000 },
  watchlist: { live: 5_000, idle: 30_000 },
  referenceData: { live: 300_000, idle: 300_000 },
  marketContext: { live: 15_000, idle: 180_000 },
  eventRadar: { live: 60_000, idle: 180_000 },
});

export function shouldRunClientPolling(visibilityState = "visible") {
  return visibilityState === "visible";
}

export function clientPollingInterval(kind, live) {
  const policy = intervals[kind];
  if (!policy) throw new Error(`Unknown polling kind: ${kind}`);
  return live ? policy.live : policy.idle;
}

export function passiveWatchlistItems(items = [], activeCode = "") {
  return items.filter((item) => item?.code && item.code !== activeCode);
}
