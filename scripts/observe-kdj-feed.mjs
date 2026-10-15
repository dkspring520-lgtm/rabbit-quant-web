// Bounded read-only evidence collection, independent of canonical KDJ admission.
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readEastmoneyMinuteSnapshot, markMinuteSourceDisconnected } from "../lib/indicators/eastmoney-minute-source.mjs";
import { replayFeedObservations } from "../lib/indicators/eastmoney-minute-feed.mjs";

export const LIVE_ACCEPTANCE = Object.freeze({ version: "kdj-live-20261014-v2", symbol: "601899",
  date: "2026-10-14", timezone: "Asia/Shanghai", start: "09:31:00", end: "09:50:00",
  cadenceMs: 60_000, maxRequests: 20, minimumWarmupBars: 9, minimumNewCompletedBars: 5,
  maxLagMs: 180_000, simulatedObserverDisconnectBeforeRequest: 12,
  rules: ["Observation collection is independent of canonical admission", "Repeated values do not prove closure or provider finality",
    "System availability is the actual receipt for that version, not historical tradability",
    "No price proxy or source-contract bypass", "No future availability or rewritten prior signals",
    "Numeric replay equality alone is insufficient", "Lunch and close require separate observations",
    "Source, live and deployment-isolation gates remain required before push"],
});

export function summarizeAcceptance(snapshots, observations, { probe = false } = {}) {
  const observed = snapshots.filter(s => s.status !== "UNAVAILABLE");
  const numeric = observed.filter(s => s.kdj?.value);
  const replay = replayFeedObservations(observations).filter(s => s.status !== "DISCONNECTED");
  const observationReplayMatches = JSON.stringify(replay) === JSON.stringify(observed);
  const replayMatches = JSON.stringify(replay.map(s => s.kdj)) === JSON.stringify(observed.map(s => s.kdj));
  const accepted = new Map(observed.flatMap(s => s.acceptedBars ?? []).map(bar => [bar.barEndTime, bar]));
  const firstRequest = Date.parse(snapshots[0]?.requestedAt ?? "");
  const newBars = [...accepted.values()].filter(bar => Date.parse(bar.barEndTime) > firstRequest);
  const inWindow = snapshots.length > 0 && snapshots.every(s => {
    const at = Date.parse(s.receivedAt);
    return at >= Date.parse(`${LIVE_ACCEPTANCE.date}T${LIVE_ACCEPTANCE.start}+08:00`)
      && at <= Date.parse(`${LIVE_ACCEPTANCE.date}T${LIVE_ACCEPTANCE.end}+08:00`)
      && s.marketDate === LIVE_ACCEPTANCE.date;
  });
  const events = observed.flatMap(s => s.events ?? []);
  const labels = new Set(observed.flatMap(s => (s.candidateBars ?? []).map(b => b.reportedTime)));
  const rawReceipts = observations.filter(r => r.payload);
  const quality = observed.length > 0 && observed.every(s => !(s.issues?.length));
  const gates = { transport: observed.length ? "PASS" : "UNAVAILABLE",
    observationCollection: rawReceipts.length ? "COLLECTED_UNCERTIFIED" : "PENDING",
    observationReplay: rawReceipts.length && observationReplayMatches ? "PASS_OBSERVATION_EVENTS_ONLY" : "PENDING_OR_MISMATCH",
    priceFields: observed.length && observed.every(s => s.sourceGates?.priceFields === "PASS_OFFICIAL_FIELD_MAPPING") ? "PASS" : "PENDING_OR_BLOCKED",
    timeBoundary: "BLOCKED_NO_VALIDATED_1M_BOUNDARY_ADAPTER",
    providerCompletion: "BLOCKED_NO_SUPPORTED_COMPLETION_ADAPTER", sourceContract: "BLOCKED_VENDOR_CONTRACT",
    liveWindow: !probe && inWindow ? "PASS_WINDOW_ONLY" : "PENDING_TRADING_WINDOW",
    priceQuality: quality ? "PASS_OBSERVED_ROWS_ONLY" : "PENDING_OR_FAIL",
    quantity: "SEPARATE_DIAGNOSTIC_NOT_PRICE_KDJ_GATE",
    warmupAndNewBars: accepted.size >= LIVE_ACCEPTANCE.minimumWarmupBars && newBars.length >= LIVE_ACCEPTANCE.minimumNewCompletedBars ? "PASS" : "PENDING",
    numericLiveReplay: numeric.length && replayMatches ? "PASS_NUMERIC_COMPARISON_ONLY" : "PENDING_NO_NUMERIC_LIVE_KDJ",
    lunchBoundary: "PENDING_SEPARATE_OBSERVATION", closingBoundary: "PENDING_SEPARATE_OBSERVATION",
    push: "BLOCKED_UNTIL_ALL_GATES_AND_DEPLOYMENT_RULES_VERIFIED" };
  // There is no supported provider-completion adapter for this endpoint/version.
  return { status: "NOT_ACCEPTED", probe, acceptance: LIVE_ACCEPTANCE,
    requests: snapshots.length, acceptedBars: accepted.size, newCompletedBars: newBars.length,
    numericSnapshots: numeric.length, replayMatches, observationReplayMatches,
    observationEvidence: { rawReceipts: rawReceipts.length, distinctLabels: labels.size,
      labelAdvances: events.filter(e => e.type === "LABEL_ADVANCED").length,
      nextLabelAppearancesAfterPriorObservation: events.filter(e => e.type === "NEXT_LABEL_OBSERVED" && e.previousBarSeenEarlier).length,
      latestLabelPriceRevisions: events.filter(e => e.type === "PRICE_REVISION" && e.phase === "LATEST_LABEL").length,
      earlierLabelPriceRevisions: events.filter(e => e.type === "PRICE_REVISION" && e.phase === "EARLIER_LABEL").length,
      quantityRevisions: events.filter(e => e.type === "QUANTITY_REVISION").length,
      repeatedPriceObservations: events.filter(e => e.type === "REPEATED_PRICE_OBSERVATIONS").length,
      receiptRange: rawReceipts.length ? [rawReceipts[0].observation.receivedAt, rawReceipts.at(-1).observation.receivedAt] : null }, gates };
}

// Injectable time/transport permits deterministic tests of the actual bounded loop.
export async function runObservationWindow({ out, probe = false, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readSnapshot = readEastmoneyMinuteSnapshot, disconnect = markMinuteSourceDisconnected,
  progress = value => console.log(JSON.stringify(value)) } = {}) {
  if (!out) throw new Error("--out is required; use a new evidence directory");
  out = resolve(out); await mkdir(out, { recursive: true });
  await writeFile(join(out, "acceptance-contract.json"), JSON.stringify(LIVE_ACCEPTANCE, null, 2), { flag: "wx" });
  const start = Date.parse(`${LIVE_ACCEPTANCE.date}T${LIVE_ACCEPTANCE.start}+08:00`);
  const end = Date.parse(`${LIVE_ACCEPTANCE.date}T${LIVE_ACCEPTANCE.end}+08:00`);
  if (!probe && (now() < start || now() > end)) {
    const summary = { status: "PENDING_TRADING_WINDOW", acceptance: LIVE_ACCEPTANCE, requests: 0 };
    await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
    progress(summary); return summary;
  }
  const snapshots = [], observations = [], rawLines = [];
  for (const file of ["observations.jsonl", "snapshots.jsonl", "events.jsonl"]) await writeFile(join(out, file), "", { flag: "wx" });
  const recordObservation = async record => {
    observations.push(record); const line = JSON.stringify(record) + "\n"; rawLines.push(line);
    await appendFile(join(out, "observations.jsonl"), line);
  };
  const count = probe ? 1 : LIVE_ACCEPTANCE.maxRequests;
  let lastRequestAt = null;
  for (let i = 0; i < count; i++) {
    if (!probe && lastRequestAt !== null) await wait(Math.max(0, lastRequestAt + LIVE_ACCEPTANCE.cadenceMs - now()));
    if (!probe && (now() < start || now() > end)) break;
    if (!probe && i + 1 === LIVE_ACCEPTANCE.simulatedObserverDisconnectBeforeRequest) {
      disconnect(LIVE_ACCEPTANCE.symbol);
      await recordObservation({ disconnected: true, observedAt: now(), reason: "BOUNDED_LOCAL_OBSERVER_PAUSE" });
      await wait(LIVE_ACCEPTANCE.cadenceMs);
      if (now() > end) break;
    }
    lastRequestAt = now();
    const freshRecords = [];
    const snapshot = await readSnapshot(LIVE_ACCEPTANCE.symbol, { now, onObservation: record => freshRecords.push(record) });
    // Persist each response even while the formal KDJ gate is blocked.
    for (const record of freshRecords) await recordObservation(record);
    snapshots.push(snapshot);
    await appendFile(join(out, "snapshots.jsonl"), JSON.stringify(snapshot) + "\n");
    for (const event of snapshot.events ?? []) await appendFile(join(out, "events.jsonl"), JSON.stringify({ sequence: snapshot.sequence, ...event }) + "\n");
    progress({ request: i + 1, receivedAt: snapshot.receivedAt, status: snapshot.status,
      candidates: snapshot.candidateBars?.length ?? 0, accepted: snapshot.acceptedCount ?? 0 });
    if (probe) break;
  }
  const summary = summarizeAcceptance(snapshots, observations, { probe });
  summary.observationsSha256 = createHash("sha256").update(rawLines.join("")).digest("hex");
  await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
  progress(summary.gates); return summary;
}

export async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" }, probe: { type: "boolean", default: false } }, strict: true });
  await runObservationWindow({ out: values.out, probe: values.probe });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
