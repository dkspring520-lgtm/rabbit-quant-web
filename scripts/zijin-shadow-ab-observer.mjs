import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendIntegrity,
  createShadowState,
  processVisibleMinute,
} from "../lib/zijin-shadow-ab.mjs";

const origin = process.env.ZIJIN_SHADOW_MARKET_ORIGIN || "http://web:3000";
const statePath = process.env.ZIJIN_SHADOW_STATE_PATH || "/training-state/zijin-shadow-ab.json";
const ledgerPath = process.env.ZIJIN_SHADOW_LEDGER_PATH || "/training-runtime/shadow/zijin-shadow-ab-events.jsonl";
const pollMs = Math.max(5_000, Number(process.env.ZIJIN_SHADOW_POLL_MS) || 15_000);
const idlePollMs = Math.max(30_000, Number(process.env.ZIJIN_SHADOW_IDLE_POLL_MS) || 60_000);
const targetCode = "601899";
const peerCodes = (process.env.ZIJIN_SHADOW_PEERS || "600489,600547,603993,601168,600362,000630").split(",").map((value) => value.trim()).filter(Boolean);

async function loadState() {
  try {
    const value = JSON.parse(await readFile(statePath, "utf8"));
    if (value?.experimentId === "zijin-round10-vs-round11-forward-shadow" && value?.models?.A && value?.models?.B) return value;
  } catch {
    // A missing state is expected on the first deployment.
  }
  return createShadowState();
}

async function saveState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

async function fetchStock(code) {
  const response = await fetch(`${origin}/api/market-data?code=${encodeURIComponent(code)}&mode=trial-realtime`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${code}行情HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.quote || !Array.isArray(payload?.minutes)) throw new Error(`${code}行情结构无效`);
  return payload;
}

function marketDate(payload) {
  const raw = payload.sourceTimestamp || payload.fetchedAt;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replaceAll("-", "");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
}

async function appendEvents(state, events, source) {
  if (!events.length) return;
  await mkdir(dirname(ledgerPath), { recursive: true });
  for (const event of events) {
    const record = appendIntegrity({
      ...event,
      experimentId: state.experimentId,
      stockCode: targetCode,
      marketDate: state.marketDate,
      observedAt: new Date().toISOString(),
      source,
      affectsV4: false,
      sendsAlerts: false,
    }, state.integrity.lastHash);
    await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
    state.integrity.eventCount += 1;
    state.integrity.lastHash = record.hash;
  }
}

async function observe(state) {
  const settled = await Promise.allSettled([fetchStock(targetCode), ...peerCodes.map(fetchStock)]);
  const target = settled[0];
  if (target.status !== "fulfilled") throw target.reason;
  const payload = target.value;
  const minutes = payload.minutes.filter((point) => /^\d{4}$/.test(point.time) && point.time <= "1500" && Number.isFinite(point.price) && point.price > 0);
  if (!minutes.length) throw new Error("紫金矿业暂无有效分钟数据");
  const peers = settled.slice(1).flatMap((result, index) => result.status === "fulfilled"
    ? [{ code: peerCodes[index], minutes: result.value.minutes.filter((point) => point.time <= "1500") }]
    : []);
  const date = marketDate(payload);
  const lastIndex = minutes.length - 1;
  let indices;
  if (state.marketDate !== date || !state.lastProcessedMinute) {
    // Forward observation starts at the latest visible minute. It never replays
    // the earlier part of a day that was already known before registration.
    indices = [lastIndex];
  } else {
    const previousIndex = minutes.findIndex((point) => point.time === state.lastProcessedMinute);
    indices = previousIndex >= 0
      ? Array.from({ length: Math.max(0, lastIndex - previousIndex) }, (_, offset) => previousIndex + offset + 1)
      : [lastIndex];
  }

  const allEvents = [];
  for (const index of indices) {
    allEvents.push(...processVisibleMinute(state, {
      marketDate: date,
      minutes,
      index,
      previousClose: payload.quote.previousClose,
      peers,
    }));
  }
  state.source = {
    provider: payload.provider || null,
    sourceTimestamp: payload.sourceTimestamp || null,
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
    peerCoverage: peers.length / Math.max(1, peerCodes.length),
    error: null,
  };
  // Keep the service heartbeat fresh even when the market has no new minute.
  // lastProcessedMinute remains unchanged, so this cannot manufacture evidence.
  state.updatedAt = new Date().toISOString();
  await appendEvents(state, allEvents, { provider: state.source.provider, sourceTimestamp: state.source.sourceTimestamp });
  await saveState(state);
}

let state = await loadState();
let stopping = false;

function nextDelay() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return idlePollMs;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= 9 * 60 + 15 && minute <= 15 * 60 + 5 ? pollMs : idlePollMs;
}

async function cycle() {
  try {
    await observe(state);
  } catch (error) {
    state.updatedAt = new Date().toISOString();
    state.status = "degraded";
    state.source = { ...state.source, error: error instanceof Error ? error.message : String(error) };
    await saveState(state);
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { stopping = true; });
}

await cycle();
while (!stopping) {
  await new Promise((resolve) => setTimeout(resolve, nextDelay()));
  await cycle();
}
