import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendIntegrity,
  createShadowState,
  deriveShadowStatus,
  processVisibleMinute,
  summarizeZijinExternalContext,
  upgradeShadowState,
} from "../lib/zijin-shadow-ab.mjs";
import { buildZijinPreopenPricePlan, evaluateZijinPreopenGate } from "../lib/zijin-preopen-price-plan.mjs";

const origin = process.env.ZIJIN_SHADOW_MARKET_ORIGIN || "http://web:3000";
const statePath = process.env.ZIJIN_SHADOW_STATE_PATH || "/training-state/zijin-shadow-ab.json";
const ledgerPath = process.env.ZIJIN_SHADOW_LEDGER_PATH || "/training-runtime/shadow/zijin-shadow-ab-events.jsonl";
const minuteArchiveDir = process.env.ZIJIN_SHADOW_MINUTES_DIR || "/training-runtime/shadow/minutes/601899";
const pollMs = Math.max(5_000, Number(process.env.ZIJIN_SHADOW_POLL_MS) || 15_000);
const idlePollMs = Math.max(30_000, Number(process.env.ZIJIN_SHADOW_IDLE_POLL_MS) || 60_000);
const targetCode = "601899";
const peerCodes = (process.env.ZIJIN_SHADOW_PEERS || "600489,600547,603993,601168,600362,000630").split(",").map((value) => value.trim()).filter(Boolean);

async function loadState() {
  try {
    const value = JSON.parse(await readFile(statePath, "utf8"));
    if (value?.experimentId === "zijin-round10-vs-round11-forward-shadow" && value?.models?.A && value?.models?.B) {
      return upgradeShadowState(value);
    }
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

async function saveMinuteArchive(date, payload, minutes) {
  await mkdir(minuteArchiveDir, { recursive: true });
  const path = `${minuteArchiveDir}/${date}.json`;
  const temporary = `${path}.tmp`;
  const archive = {
    schemaVersion: 1,
    code: targetCode,
    name: "紫金矿业",
    marketDate: date,
    updatedAt: new Date().toISOString(),
    provider: payload.provider || null,
    minuteProvider: payload.minuteProvider || null,
    sourceTimestamp: payload.sourceTimestamp || null,
    fetchedAt: payload.fetchedAt || null,
    previousClose: Number(payload.quote?.previousClose) || null,
    quote: payload.quote,
    minutes,
  };
  await writeFile(temporary, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  await rename(temporary, path);
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

async function fetchJson(path) {
  const response = await fetch(`${origin}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

async function fetchExternalContext(payload) {
  const change = Number(payload?.quote?.changePercent ?? payload?.quote?.change ?? 0);
  const [marketResult, radarResult] = await Promise.allSettled([
    fetchJson(`/api/market-context?code=${targetCode}&change=${encodeURIComponent(Number.isFinite(change) ? change : 0)}`),
    fetchJson(`/api/event-radar?codes=${targetCode}&names=${encodeURIComponent("紫金矿业")}`),
  ]);
  return summarizeZijinExternalContext(
    marketResult.status === "fulfilled" ? marketResult.value : null,
    radarResult.status === "fulfilled" ? radarResult.value : null,
  );
}

function l2ExchangeMinute(l2) {
  return l2?.lastExchangeTime?.match(/^\d{8}-(\d{4})/)?.[1] || null;
}

function freezePreopenPlan(state, date, payload, l2) {
  if (state.preopenPlan?.marketDate === date && state.preopenPlan.plan?.ready) return state.preopenPlan.plan;
  const asOfTime = l2ExchangeMinute(l2);
  if (!asOfTime || asOfTime < "0925" || asOfTime >= "0930") return null;
  const indicativePrice = [l2?.session?.open, l2?.book?.lastPrice, payload.quote?.open, payload.quote?.price]
    .map(Number)
    .find(value => Number.isFinite(value) && value > 0) || null;
  const plan = buildZijinPreopenPricePlan({
    phase: "auction-result",
    asOfTime,
    previousClose: l2?.session?.previousClose ?? payload.quote?.previousClose ?? null,
    indicativePrice,
    bookImbalance: l2?.book?.nearTouchImbalance ?? null,
    activeBuyRatio: l2?.flow?.activeBuyRatio60s ?? null,
    atrPct: l2?.volatility?.atrPct14 ?? null,
    spreadBps: l2?.book?.spreadBps ?? null,
    l2Connected: l2?.status?.connected === true,
    l2Stale: l2?.status?.stale !== false,
  });
  if (plan.ready) state.preopenPlan = { marketDate: date, frozenAt: new Date().toISOString(), plan };
  return plan.ready ? plan : null;
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
  const settled = await Promise.allSettled([fetchStock(targetCode), ...peerCodes.map(fetchStock), fetchJson("/api/research/zijin-l2-orderflow")]);
  const target = settled[0];
  if (target.status !== "fulfilled") throw target.reason;
  const payload = target.value;
  const minutes = payload.minutes.filter((point) => /^\d{4}$/.test(point.time) && point.time <= "1500" && Number.isFinite(point.price) && point.price > 0);
  if (!minutes.length) throw new Error("紫金矿业暂无有效分钟数据");
  const peers = settled.slice(1, 1 + peerCodes.length).flatMap((result, index) => result.status === "fulfilled"
    ? [{ code: peerCodes[index], minutes: result.value.minutes.filter((point) => point.time <= "1500") }]
    : []);
  const externalContext = await fetchExternalContext(payload);
  const date = marketDate(payload);
  const l2Result = settled.at(-1);
  const l2 = l2Result?.status === "fulfilled" ? l2Result.value : null;
  const preopenPlan = freezePreopenPlan(state, date, payload, l2);
  const preopenGate = evaluateZijinPreopenGate({ plan: preopenPlan, minutes });
  await saveMinuteArchive(date, payload, minutes);
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

  if (state.marketDate !== date) state.l2History = [];
  const allEvents = [];
  for (const index of indices) {
    const point = minutes[index];
    // L2 is an instantaneous feed. Never attach the newest book snapshot to
    // a missed public minute, otherwise a restarted observer would leak
    // future order-flow information into an older decision.
    const minuteL2 = l2ExchangeMinute(l2) === point?.time ? l2 : null;
    if (minuteL2) {
      state.l2History = (Array.isArray(state.l2History) ? state.l2History : [])
        .filter((item) => item?.time !== point.time && item?.time <= point.time)
        .concat({ time: point.time, snapshot: minuteL2 })
        .slice(-8);
    }
    allEvents.push(...processVisibleMinute(state, {
      marketDate: date,
      minutes,
      index,
      previousClose: payload.quote.previousClose,
      peers,
      externalContext,
      preopenGate,
      l2: minuteL2,
      l2History: (Array.isArray(state.l2History) ? state.l2History : [])
        .filter((item) => item?.time <= point.time),
    }));
  }
  state.source = {
    provider: payload.provider || null,
    sourceTimestamp: payload.sourceTimestamp || null,
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
    peerCoverage: peers.length / Math.max(1, peerCodes.length),
    externalCoverage: externalContext.coverage,
    externalObservedAt: externalContext.observedAt,
    l2: {
      connected: l2?.status?.connected === true,
      stale: l2?.status?.stale !== false,
      lastExchangeTime: l2?.lastExchangeTime || null,
      sourceTimestamp: l2?.updatedAt || null,
      historySamples: Array.isArray(state.l2History) ? state.l2History.length : 0,
    },
    preopenGate: {
      status: preopenGate.status,
      confirmationCount: preopenGate.confirmationCount,
      allowedDirections: preopenGate.allowedDirections,
      expiresAt: preopenGate.expiresAt,
    },
    error: null,
  };
  // Keep the service heartbeat fresh even when the market has no new minute.
  // lastProcessedMinute remains unchanged, so this cannot manufacture evidence.
  state.updatedAt = new Date().toISOString();
  state.status = deriveShadowStatus(date);
  await appendEvents(state, allEvents, {
    provider: state.source.provider,
    sourceTimestamp: state.source.sourceTimestamp,
    l2: state.source.l2,
    preopenGate: state.source.preopenGate,
  });
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
