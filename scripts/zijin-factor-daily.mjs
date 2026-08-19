import { appendFile, mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  buildZijinFactorDailyRun,
  createZijinFactorRegistry,
  hashZijinFactorLedgerRecord,
  normalizeZijinFactorRegistry,
} from "../lib/zijin-factor-lifecycle.mjs";
import { createZijinDailyAssignment } from "../lib/zijin-daily-assignment.mjs";
import { createZijinOnlineLearningObservations } from "../lib/zijin-online-learning.mjs";

const bundledRegistry = resolve(process.cwd(), "public/research/zijin-factor-registry.json");
const bundledDailyState = resolve(process.cwd(), "public/research/zijin-factor-daily.json");
const bundledShadowState = resolve(process.cwd(), "public/research/zijin-shadow-ab.json");
const registryPath = process.env.ZIJIN_FACTOR_REGISTRY_PATH || bundledRegistry;
const dailyStatePath = process.env.ZIJIN_FACTOR_DAILY_STATE_PATH || "/training-state/zijin-factor-daily.json";
const ledgerPath = process.env.ZIJIN_FACTOR_DAILY_LEDGER_PATH || "/training-runtime/factors/zijin-factor-daily.jsonl";
const shadowStatePath = process.env.ZIJIN_SHADOW_STATE_PATH || "/training-state/zijin-shadow-ab.json";
const assignmentPath = process.env.ZIJIN_DAILY_ASSIGNMENT_PATH || "/training-state/zijin-daily-assignment.json";
const observationsPath = process.env.ZIJIN_DAILY_OBSERVATIONS_PATH || "/training-state/zijin-daily-observations.json";
const researchOrigin = process.env.ZIJIN_RESEARCH_ORIGIN || process.env.ZIJIN_SHADOW_MARKET_ORIGIN || "http://web:3000";

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const todayInShanghai = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const shanghaiClock = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts
    .filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  return {
    marketDate: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
};

const parseWindowStart = window => {
  const match = String(window || "15:20-16:00").match(/^(\d{2}):(\d{2})-/);
  if (!match) return 15 * 60 + 20;
  return Number(match[1]) * 60 + Number(match[2]);
};

async function readFirst(paths, fallback) {
  for (const path of paths) {
    try {
      return await readJson(path);
    } catch {
      // Use the bundled audit snapshot when the runtime volume is not mounted.
    }
  }
  return fallback;
}

async function readLedger() {
  try {
    const lines = (await readFile(ledgerPath, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporaryPath, path);
}

async function fetchResearchJson(path, fetchImpl = fetch) {
  const response = await fetchImpl(`${researchOrigin}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

export async function collectZijinOnlineLearning({
  marketDate = todayInShanghai(),
  collectedAt = new Date().toISOString(),
  fetchImpl = fetch,
} = {}) {
  const errors = [];
  const marketDataResult = await Promise.allSettled([
    fetchResearchJson("/api/market-data?code=601899&mode=trial-realtime", fetchImpl),
  ]);
  const marketData = marketDataResult[0].status === "fulfilled" ? marketDataResult[0].value : null;
  if (marketDataResult[0].status === "rejected") errors.push(`紫金行情：${marketDataResult[0].reason instanceof Error ? marketDataResult[0].reason.message : "请求失败"}`);
  const change = Number(marketData?.quote?.changePercent);
  const settled = await Promise.allSettled([
    fetchResearchJson(`/api/market-context?code=601899&change=${encodeURIComponent(Number.isFinite(change) ? change : 0)}`, fetchImpl),
    fetchResearchJson(`/api/event-radar?codes=601899&names=${encodeURIComponent("紫金矿业")}`, fetchImpl),
    fetchResearchJson("/api/research/zijin-l2-orderflow", fetchImpl),
  ]);
  const labels = ["市场环境", "事件雷达", "L2盘口"];
  settled.forEach((result, index) => {
    if (result.status === "rejected") errors.push(`${labels[index]}：${result.reason instanceof Error ? result.reason.message : "请求失败"}`);
  });
  for (const failure of Array.isArray(marketData?.failures) ? marketData.failures : []) errors.push(`紫金行情：${String(failure)}`);
  if (settled[0].status === "fulfilled") {
    for (const failure of Array.isArray(settled[0].value?.errors) ? settled[0].value.errors : []) errors.push(`市场环境：${String(failure)}`);
  }
  if (settled[1].status === "fulfilled") {
    for (const failure of Array.isArray(settled[1].value?.errors) ? settled[1].value.errors : []) errors.push(`事件雷达：${String(failure)}`);
  }
  const observations = createZijinOnlineLearningObservations({
    marketDate,
    collectedAt,
    marketData,
    marketContext: settled[0].status === "fulfilled" ? settled[0].value : null,
    eventRadar: settled[1].status === "fulfilled" ? settled[1].value : null,
    l2: settled[2].status === "fulfilled" ? settled[2].value : null,
    errors,
  });
  await writeJsonAtomic(observationsPath, observations);
  return observations;
}

export async function runZijinFactorDaily({ marketDate = todayInShanghai(), scheduledAt = new Date().toISOString(), force = false } = {}) {
  const registry = normalizeZijinFactorRegistry(await readFirst(
    registryPath === bundledRegistry ? [bundledRegistry] : [registryPath, bundledRegistry],
    createZijinFactorRegistry(),
  ));
  const shadowState = await readFirst(
    shadowStatePath === bundledShadowState ? [bundledShadowState] : [shadowStatePath, bundledShadowState],
    null,
  );
  const existing = await readLedger();
  const runId = "zijin-factor-daily-" + marketDate;
  const duplicate = existing.find(record => record.runId === runId);
  if (duplicate && !force) {
    return { ...duplicate, skipped: true, reason: "already-recorded-for-market-date" };
  }
  const run = buildZijinFactorDailyRun({ registry, shadowState, marketDate, scheduledAt });
  const previousHash = existing.at(-1)?.hash || "GENESIS";
  const ledgerRecord = {
    ...run,
    previousHash,
    hash: hashZijinFactorLedgerRecord(run, previousHash),
  };
  await mkdir(dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, JSON.stringify(ledgerRecord) + "\n", "utf8");
  await writeJsonAtomic(dailyStatePath, {
    ...run,
    integrity: {
      ...run.integrity,
      ledgerPath,
      ledgerHash: ledgerRecord.hash,
      previousHash,
      records: existing.length + 1,
      formalStrategyWriteEnabled: false,
    },
  });
  return ledgerRecord;
}

export async function runZijinDailyAssignment({ marketDate = todayInShanghai(), generatedAt = new Date().toISOString() } = {}) {
  const registry = normalizeZijinFactorRegistry(await readFirst(
    registryPath === bundledRegistry ? [bundledRegistry] : [registryPath, bundledRegistry],
    createZijinFactorRegistry(),
  ));
  const dailyRun = await readFirst(
    dailyStatePath === bundledDailyState ? [bundledDailyState] : [dailyStatePath, bundledDailyState],
    null,
  );
  const shadowState = await readFirst(
    shadowStatePath === bundledShadowState ? [bundledShadowState] : [shadowStatePath, bundledShadowState],
    null,
  );
  const observations = await readFirst([observationsPath], null);
  const assignment = createZijinDailyAssignment({ marketDate, generatedAt, registry, dailyRun, shadowState, observations });
  await writeJsonAtomic(assignmentPath, assignment);
  return assignment;
}

export async function runZijinFactorDailyDaemon({ pollMs = Number(process.env.ZIJIN_FACTOR_DAILY_POLL_MS || 60000) } = {}) {
  const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
  let lastAttemptedDate = "";
  let lastAssignmentDate = "";
  console.log("[zijin-factor-daily] daemon started; shadow-only scheduler active");
  while (true) {
    try {
      const registry = normalizeZijinFactorRegistry(await readFirst(
        registryPath === bundledRegistry ? [bundledRegistry] : [registryPath, bundledRegistry],
        createZijinFactorRegistry(),
      ));
      const clock = shanghaiClock();
      const startMinutes = parseWindowStart(registry.scheduler?.window);
      if (registry.scheduler?.enabled !== false && clock.minutes >= startMinutes && lastAttemptedDate !== clock.marketDate) {
        const observations = await collectZijinOnlineLearning({ marketDate: clock.marketDate });
        const result = await runZijinFactorDaily({ marketDate: clock.marketDate });
        lastAttemptedDate = clock.marketDate;
        console.log(JSON.stringify({
          runId: result.runId,
          marketDate: result.marketDate,
          status: result.status,
          skipped: result.skipped === true,
          shadow: result.summary?.shadow ?? 0,
          formal: result.summary?.formal ?? 0,
          onlineSources: observations.onlineLearning.readySources,
        }));
      }
      // Generate the research assignment after the market closes, before midnight.
      if (clock.minutes >= 23 * 60 + 45 && lastAssignmentDate !== clock.marketDate) {
        const observations = await collectZijinOnlineLearning({ marketDate: clock.marketDate });
        const assignment = await runZijinDailyAssignment({ marketDate: clock.marketDate });
        lastAssignmentDate = clock.marketDate;
        console.log(JSON.stringify({ assignmentId: assignment.assignmentId, marketDate: assignment.marketDate, status: assignment.status, onlineSources: observations.onlineLearning.readySources, reportHash: assignment.integrity.reportHash }));
      }
    } catch (error) {
      console.error(`[zijin-factor-daily] ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(Math.max(10000, pollMs));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--daemon")) {
    await runZijinFactorDailyDaemon();
    process.exit(0);
  }
  if (process.argv.includes("--assignment")) {
    const dateArgumentIndex = process.argv.indexOf("--date");
    const marketDate = dateArgumentIndex >= 0 ? process.argv[dateArgumentIndex + 1] : todayInShanghai();
    const result = await runZijinDailyAssignment({ marketDate });
    console.log(JSON.stringify({ assignmentId: result.assignmentId, marketDate: result.marketDate, status: result.status, reportHash: result.integrity.reportHash }));
    process.exit(0);
  }
  const dateArgumentIndex = process.argv.indexOf("--date");
  const marketDate = dateArgumentIndex >= 0 ? process.argv[dateArgumentIndex + 1] : todayInShanghai();
  const result = await runZijinFactorDaily({
    marketDate,
    force: process.argv.includes("--force"),
  });
  console.log(JSON.stringify({
    runId: result.runId,
    marketDate: result.marketDate,
    status: result.status,
    skipped: result.skipped === true,
    shadow: result.summary?.shadow ?? 0,
    formal: result.summary?.formal ?? 0,
    shadowEvents: result.summary?.shadowEvents ?? 0,
  }));
}
