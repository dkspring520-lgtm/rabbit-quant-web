import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateZijinLargeOrder } from "../lib/zijin-large-order-confirmation.mjs";
import {
  buildMatureZijinL2Labels,
  buildZijinL2Observation,
  decideZijinL2Append,
  summarizeZijinL2Audit,
} from "../lib/zijin-l2-event-ledger.mjs";
import { evaluateZijinStructure } from "../lib/zijin-structure-engine.mjs";

const origin = process.env.ZIJIN_L2_AUDIT_ORIGIN || "http://web-blue:3000";
const statePath = process.env.ZIJIN_L2_AUDIT_STATE_PATH || "/training-state/zijin-l2-state-audit.json";
const ledgerPath = process.env.ZIJIN_L2_AUDIT_LEDGER_PATH || "/training-state/zijin-l2-state-events.jsonl";
const labelPath = process.env.ZIJIN_L2_AUDIT_LABEL_PATH || "/training-state/zijin-l2-state-event-labels.jsonl";
const pollMs = Math.max(10_000, Number(process.env.ZIJIN_L2_AUDIT_POLL_MS) || 15_000);
const idlePollMs = Math.max(30_000, Number(process.env.ZIJIN_L2_AUDIT_IDLE_POLL_MS) || 60_000);
const costPct = Math.max(0, Number(process.env.ZIJIN_L2_AUDIT_COST_PCT) || 0.46);

function shanghaiClockParts(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}${values.month}${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isAshareContinuousSessionAt(at = new Date()) {
  const { minute } = shanghaiClockParts(at);
  return (minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30)
    || (minute >= 13 * 60 && minute <= 15 * 60);
}

export function isFreshLiveExchangeMinute(exchangeMinute, observedAt = new Date(), maximumLagMinutes = 3) {
  const match = String(exchangeMinute ?? "").match(/^(\d{8})-?(\d{2})(\d{2})$/);
  if (!match) return false;
  const [, date, hours, minutes] = match;
  const exchangeClock = Number(hours) * 60 + Number(minutes);
  const now = shanghaiClockParts(observedAt);
  const inContinuousSession = (exchangeClock >= 9 * 60 + 30 && exchangeClock <= 11 * 60 + 30)
    || (exchangeClock >= 13 * 60 && exchangeClock <= 15 * 60);
  const lag = now.minute - exchangeClock;
  return date === now.date && inContinuousSession && lag >= 0 && lag <= maximumLagMinutes;
}

async function readJsonLines(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

async function appendJsonLines(path, rows) {
  if (!rows.length) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${rows.map(row => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function readPreviousState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return { suppressedRepeats: 0 };
  }
}

async function fetchL2State() {
  const response = await fetch(`${origin}/api/research/zijin-l2-orderflow`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`L2 HTTP ${response.status}`);
  return response.json();
}

export async function runOnce() {
  const now = new Date().toISOString();
  const [payload, observations, existingLabels, previous] = await Promise.all([
    fetchL2State(),
    readJsonLines(ledgerPath),
    readJsonLines(labelPath),
    readPreviousState(),
  ]);
  const minutes = Array.isArray(payload?.recentMinutes) ? payload.recentMinutes : [];
  const stale = Boolean(payload?.meta?.stale || payload?.status?.stale);
  const exchangeMinute = payload.lastExchangeTime ?? minutes.at(-1)?.exchangeMinute;
  const freshLiveMinute = isFreshLiveExchangeMinute(exchangeMinute, now);
  if (!payload?.status?.connected || !payload?.status?.authorized || stale || !minutes.length || !freshLiveMinute) {
    const audit = summarizeZijinL2Audit({
      observations,
      labels: existingLabels,
      suppressedRepeats: previous.suppressedRepeats ?? 0,
      updatedAt: now,
    });
    const sourceStatus = !isAshareContinuousSessionAt(now)
      ? "market-closed"
      : stale || !freshLiveMinute
        ? "data-delayed"
        : "waiting-live-l2";
    const state = {
      ...audit,
      sourceStatus,
      sourceUpdatedAt: payload?.updatedAt ?? null,
      lastExchangeTime: exchangeMinute ?? null,
    };
    await writeJsonAtomic(statePath, state);
    return { state, marketOpen: false };
  }

  const structure = evaluateZijinStructure({ minutes });
  const evaluation = evaluateZijinLargeOrder({ minutes, structure });
  const candidate = buildZijinL2Observation({ evaluation, structure, exchangeMinute, observedAt: now });
  const decision = decideZijinL2Append(observations, candidate);
  if (decision.append) {
    await appendJsonLines(ledgerPath, [candidate]);
    observations.push(candidate);
  }
  const suppressedRepeats = (previous.suppressedRepeats ?? 0)
    + (!decision.append && !["idle"].includes(decision.reason) ? 1 : 0);
  const newLabels = buildMatureZijinL2Labels({
    observations,
    existingLabels,
    minutes,
    costPct,
    labeledAt: now,
  });
  await appendJsonLines(labelPath, newLabels);
  existingLabels.push(...newLabels);
  const audit = summarizeZijinL2Audit({
    observations,
    labels: existingLabels,
    suppressedRepeats,
    updatedAt: now,
  });
  const state = {
    ...audit,
    sourceStatus: "live",
    sourceUpdatedAt: payload.updatedAt ?? null,
    lastExchangeTime: payload.lastExchangeTime ?? null,
    current: candidate ? {
      eventId: candidate.eventId,
      state: candidate.state,
      side: candidate.side,
      score: candidate.featureSnapshot.score,
      appendDecision: decision.reason,
    } : null,
  };
  await writeJsonAtomic(statePath, state);
  return { state, marketOpen: true };
}

async function main() {
  for (;;) {
    let marketOpen = false;
    try {
      ({ marketOpen } = await runOnce());
    } catch (error) {
      const previous = await readPreviousState();
      await writeJsonAtomic(statePath, {
        ...previous,
        updatedAt: new Date().toISOString(),
        sourceStatus: "observer-error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise(resolve => setTimeout(resolve, marketOpen ? pollMs : idlePollMs));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
