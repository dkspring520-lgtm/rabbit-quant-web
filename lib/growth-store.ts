export type GrowthEvent = {
  id: string;
  type: "page_view" | "keyword_added" | "draft_created" | "draft_published";
  path?: string;
  createdAt: string;
};

const EVENTS_KEY = "rabbit-growth-events-v1";

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readGrowthEvents(): GrowthEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function trackGrowthEvent(
  type: GrowthEvent["type"],
  path?: string,
) {
  if (typeof window === "undefined") return;
  const event: GrowthEvent = {
    id: makeId(),
    type,
    path: path ?? window.location.pathname,
    createdAt: new Date().toISOString(),
  };
  const events = [...readGrowthEvents(), event].slice(-1000);
  try {
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // Privacy mode or a full storage quota should not block the page.
  }
}
