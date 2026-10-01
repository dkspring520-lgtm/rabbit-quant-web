const keyFor = (account, symbol) => `rabbit-research-observations:${String(account ?? "guest").trim().toLowerCase()}:${String(symbol ?? "").trim().toUpperCase()}`;

export function loadResearchObservations(storage, account, symbol) {
  try {
    const raw = storage?.getItem?.(keyFor(account, symbol));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(item => item?.type === "research-observation" && item.executable === false) : [];
  } catch {
    return [];
  }
}

export function saveResearchObservations(storage, account, symbol, observations, limit = 120) {
  const safe = (Array.isArray(observations) ? observations : [])
    .filter(item => item?.type === "research-observation" && item.executable === false)
    .slice(-Math.max(1, limit));
  try { storage?.setItem?.(keyFor(account, symbol), JSON.stringify(safe)); } catch {}
  return safe;
}
