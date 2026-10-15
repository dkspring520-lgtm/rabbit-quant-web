import { ObservedMinuteFeed, eastmoneyMinuteUrl } from "./eastmoney-minute-feed.mjs";

const sources = new Map();
const CACHE_MS = 60_000;
export function markMinuteSourceDisconnected(symbol = "601899") {
  const entry = sources.get(symbol);
  if (entry) { entry.feed.disconnect(); entry.cached = null; }
}
export async function readEastmoneyMinuteSnapshot(symbol = "601899", { fetchImpl = fetch, now = Date.now, onObservation = null } = {}) {
  const url = eastmoneyMinuteUrl(symbol);
  let entry = sources.get(symbol);
  if (!entry) { entry = { feed: new ObservedMinuteFeed({ symbol }), requestedAt: -Infinity, cached: null, pending: null }; sources.set(symbol, entry); }
  if (entry.pending) return entry.pending;
  if (entry.cached && now() - entry.requestedAt < CACHE_MS) return structuredClone(entry.cached);
  entry.pending = (async () => {
    const requestedAt = now(); entry.requestedAt = requestedAt;
    try {
      const response = await fetchImpl(url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; SmartTKdj/1.0)" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
      const text = await response.text();
      if (text.length > 256_000) throw new Error("UPSTREAM_RESPONSE_LIMIT");
      const payload = JSON.parse(text), receivedAt = now();
      const observation = { requestedAt, receivedAt, httpDate: response.headers.get("date") };
      const snapshot = entry.feed.observe(payload, observation);
      onObservation?.({ payload, observation });
      entry.cached = snapshot;
    } catch (error) {
      entry.feed.disconnect();
      entry.cached = { symbol, provider: "eastmoney-public", status: "UNAVAILABLE", kdj: null,
        acceptedBars: [], candidateBars: [], blockers: ["UPSTREAM_UNAVAILABLE_OR_INVALID"],
        errorCode: /^(UPSTREAM_|OBSERVATION_)/.test(error.message ?? "") ? error.message : "UPSTREAM_REQUEST_FAILED",
        requestedAt: new Date(requestedAt).toISOString(), receivedAt: new Date(now()).toISOString() };
      onObservation?.({ disconnected: true, observedAt: now() });
    }
    return structuredClone(entry.cached);
  })();
  try { return await entry.pending; } finally { entry.pending = null; }
}
