import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { ObservedMinuteFeed, parseEastmoneyMinutePayload, replayFeedObservations, EASTMONEY_MINUTE_CONTRACT } from "../lib/indicators/eastmoney-minute-feed.mjs";
import { calculateKdjSeries } from "../lib/indicators/causal-kdj.mjs";
import { readEastmoneyMinuteSnapshot } from "../lib/indicators/eastmoney-minute-source.mjs";
import { normalizeKdjMarketBars as normalizeMarketBars } from "../lib/indicators/kdj-historical-adapter.mjs";
import { summarizeAcceptance, runObservationWindow, LIVE_ACCEPTANCE } from "../scripts/observe-kdj-feed.mjs";

const at = minute => Date.parse(`2026-10-14T${minute}+08:00`);
function payload(count = 12) {
  return { rc: 0, data: { code: "601899", klines: Array.from({ length: count }, (_, i) => {
    const time = new Date(at("09:31:00") + i * 60_000 + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
    return `${time},10,11,12,9,100,105000`;
  }) } };
}
const obs = time => ({ requestedAt: at(time) - 100, receivedAt: at(time), httpDate: null });
const editPrice = (p, index, close = "10.5") => { p.data.klines[index] = p.data.klines[index].replace(',10,11,12,9,', `,10,${close},12,9,`); return p; };
async function outputDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "kdj-feed-v2-"));
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("kdj-feed-v2-"));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("vendor OHLC remains intact and price-field contract uses official mappings", () => {
  const result = parseEastmoneyMinutePayload(payload());
  assert.deepEqual([result.bars[0].open, result.bars[0].high, result.bars[0].low, result.bars[0].close], [10, 12, 9, 11]);
  assert.equal(result.bars[0].volume, 100); assert.equal(result.bars[0].amount, 105000);
  assert.equal(result.bars[0].inputKind, "VENDOR_OHLC_CANDIDATE");
  assert.equal(result.issues.length, 0);
  const snapshot = new ObservedMinuteFeed().observe(payload(), obs("09:44:00"));
  assert.equal(snapshot.sourceGates.priceFields, "PASS_OFFICIAL_FIELD_MAPPING");
  assert.equal(snapshot.sourceGates.priceRows, "PASS_OBSERVED_ROWS_ONLY");
});

test("missing, invalid and unknown quantity units do not discard valid prices or hard-block price quality", () => {
  for (const suffix of [",?,", ",-1,NaN", "", ",100"]) {
    const p = payload(); p.data.klines = p.data.klines.map(row => row.split(',').slice(0, 5).join(',') + suffix);
    const parsed = parseEastmoneyMinutePayload(p);
    assert.equal(parsed.bars.length, 12); assert.equal(parsed.issues.length, 0); assert.ok(parsed.quantityDiagnostics.length);
    const result = new ObservedMinuteFeed().observe(p, obs("09:44:00"));
    assert.equal(result.sourceGates.priceRows, "PASS_OBSERVED_ROWS_ONLY");
    assert.equal(result.sourceGates.quantity, "DIAGNOSTICS_ONLY");
    assert.ok(!result.blockers.some(x => /QUANTITY|UNITS_AND_ADJUSTMENT/.test(x)));
    assert.equal(result.acceptedCount, 0); // separate unsupported completion contract
  }
});

test("quantity diagnostics cannot alter numeric KDJ for independently complete synthetic price fixtures", () => {
  const good = payload(), quantitiesUnknown = payload();
  quantitiesUnknown.data.klines = quantitiesUnknown.data.klines.map(row => row.split(',').slice(0, 5).join(',') + ',?,?');
  // Synthetic completed-bar evidence is local to this core-math test, never granted by the provider adapter.
  const completeFixture = p => parseEastmoneyMinutePayload(p).bars.map(bar => ({ ...bar, inputKind: "OHLC", isComplete: true,
    barEndTime: new Date(bar.labelTime).toISOString(), availableAt: new Date(at("09:44:00")).toISOString() }));
  const options = { asOf: at("09:44:00") };
  assert.deepEqual(calculateKdjSeries(completeFixture(good), options), calculateKdjSeries(completeFixture(quantitiesUnknown), options));
  assert.ok(calculateKdjSeries(completeFixture(good), options).at(-1).value);
});

test("two spaced stable observations expose system evidence without canonical completion or historical availability", () => {
  const feed = new ObservedMinuteFeed();
  const first = feed.observe(payload(), obs("09:44:00"));
  const tooSoon = feed.observe(payload(), obs("09:44:01"));
  const stable = feed.observe(payload(), obs("09:45:00"));
  assert.equal(first.candidateBars[0].observationState, "CANDIDATE_OBSERVED");
  assert.equal(tooSoon.candidateBars[0].stableObservations, 1);
  const bar = stable.candidateBars[0];
  assert.equal(bar.stableObservations, 2); assert.equal(bar.observationState, "REPEATED_PRICE_OBSERVATIONS");
  assert.equal(bar.systemAvailableAt, new Date(at("09:44:00")).toISOString());
  assert.equal(bar.stableSystemAvailableAt, new Date(at("09:45:00")).toISOString());
  assert.equal(bar.availableAt, null); assert.equal(bar.barEndTime, null); assert.equal(bar.barStartTime, null);
  assert.equal(bar.isComplete, false); assert.equal(bar.providerComplete, false); assert.equal(bar.providerFinal, null);
  assert.equal(stable.status, "BLOCKED"); assert.equal(stable.kdj, null); assert.equal(stable.acceptedCount, 0);
});

test("quantity-only revisions preserve price version and repeated-price observation progress", () => {
  const feed = new ObservedMinuteFeed(); feed.observe(payload(), obs("09:44:00"));
  const p = payload(); p.data.klines[0] = p.data.klines[0].replace('100,105000', '200,?');
  const result = feed.observe(p, obs("09:45:00")), bar = result.candidateBars[0];
  assert.equal(bar.revision, 0); assert.equal(bar.quantityRevision, 1); assert.equal(bar.stableObservations, 2);
  assert.equal(bar.priceVersions.length, 1); assert.ok(result.events.some(x => x.type === "QUANTITY_REVISION"));
  assert.ok(!result.events.some(x => x.type === "PRICE_REVISION"));
  assert.equal(result.sourceGates.priceRows, "PASS_OBSERVED_ROWS_ONLY");
});

test("current and earlier label price corrections create immutable versions at their actual receipt", () => {
  const feed = new ObservedMinuteFeed();
  const first = feed.observe(payload(2), obs("09:33:00"));
  const original = JSON.stringify(first);
  const current = feed.observe(editPrice(payload(2), 1), obs("09:34:00"));
  assert.equal(current.events.find(x => x.type === "PRICE_REVISION").phase, "LATEST_LABEL");
  const previous = feed.observe(editPrice(editPrice(payload(2), 1), 0), obs("09:35:00"));
  assert.equal(previous.events.find(x => x.type === "PRICE_REVISION").phase, "EARLIER_LABEL");
  const bar = previous.candidateBars[0];
  assert.equal(bar.stableObservations, 1); assert.equal(bar.stableObservedAt, null);
  assert.equal(bar.systemAvailableAt, new Date(at("09:35:00")).toISOString());
  assert.equal(bar.priceVersions.length, 2); assert.equal(bar.priceVersions[0].prices.close, 11);
  assert.equal(bar.priceVersions[1].prices.close, 10.5); assert.equal(bar.providerComplete, false);
  assert.equal(JSON.stringify(first), original);
  previous.candidateBars[0].priceVersions[0].prices.close = -100;
  assert.equal(feed.observe(editPrice(editPrice(payload(2), 1), 0), obs("09:36:00")).candidateBars[0].priceVersions[0].prices.close, 11);
});

test("new labels and next-bar observations are recorded even though provider completion remains blocked", () => {
  const feed = new ObservedMinuteFeed(); feed.observe(payload(1), obs("09:31:10"));
  const second = feed.observe(payload(2), obs("09:32:10"));
  assert.ok(second.events.some(x => x.type === "LABEL_ADVANCED"));
  const next = second.events.find(x => x.type === "NEXT_LABEL_OBSERVED");
  assert.equal(next.reportedTime, "2026-10-14 09:31"); assert.equal(next.nextReportedTime, "2026-10-14 09:32");
  assert.equal(next.previousBarSeenEarlier, true); assert.equal(next.receivedAt, at("09:32:10"));
  assert.equal(second.acceptedBars.length, 0);
});

test("verified flags or claimed contract metadata cannot enable an unsupported provider completion adapter", () => {
  const contract = { ...EASTMONEY_MINUTE_CONTRACT, verified: true, evidenceId: "CLAIM_ONLY",
    labelRole: "end", timezone: "Asia/Shanghai", periodMinutes: 1,
    volumeUnit: "100_SHARES", amountUnit: "CNY", providerCompletionEvidence: "CLAIM_ONLY" };
  const feed = new ObservedMinuteFeed({ contract });
  feed.observe(payload(), obs("09:44:00"));
  const result = feed.observe(payload(), obs("09:45:00"));
  assert.equal(result.acceptedCount, 0); assert.equal(result.kdj, null);
  assert.equal(result.sourceGates.providerCompletion, "BLOCKED_NO_SUPPORTED_COMPLETION_ADAPTER");
});

test("neither lunch nor close terminal labels become complete after long elapsed guards", () => {
  for (const label of ["11:30", "15:00"]) {
    const p = payload(1); p.data.klines[0] = p.data.klines[0].replace('09:31', label);
    const feed = new ObservedMinuteFeed(); feed.observe(p, obs("15:10:00"));
    const result = feed.observe(p, obs("15:20:00"));
    assert.equal(result.candidateBars[0].stableObservations, 2);
    assert.equal(result.candidateBars[0].providerComplete, false); assert.equal(result.acceptedCount, 0);
  }
});

test("disconnect resets stable qualification while preserving price-version first availability", () => {
  const feed = new ObservedMinuteFeed(); feed.observe(payload(), obs("09:42:20"));
  feed.observe(payload(), obs("09:43:20")); feed.disconnect();
  const first = feed.observe(payload(), obs("09:44:20"));
  assert.equal(first.candidateBars[0].stableObservations, 1); assert.equal(first.candidateBars[0].stableObservedAt, null);
  assert.ok(first.events.some(event => event.type === "RECOVERY_OBSERVATION"));
  const recovered = feed.observe(payload(), obs("09:45:20"));
  assert.equal(recovered.candidateBars[0].systemAvailableAt, new Date(at("09:42:20")).toISOString());
  assert.equal(recovered.candidateBars[0].stableSystemAvailableAt, new Date(at("09:45:20")).toISOString());
  assert.equal(recovered.acceptedCount, 0);
});

test("event replay reproduces observations exactly and later corrections never rewrite earlier snapshots", () => {
  const records = [{ payload: payload(1), observation: obs("09:32:00") }, { payload: payload(2), observation: obs("09:33:00") }];
  const prefix = replayFeedObservations(records);
  const longer = replayFeedObservations([...records, { payload: editPrice(payload(2), 0), observation: obs("09:34:00") }]);
  assert.deepEqual(longer.slice(0, 2), prefix);
  const summary = summarizeAcceptance(longer, [...records, { payload: editPrice(payload(2), 0), observation: obs("09:34:00") }]);
  assert.equal(summary.observationReplayMatches, true); assert.equal(summary.status, "NOT_ACCEPTED");
  assert.equal(summary.observationEvidence.earlierLabelPriceRevisions, 1);
  assert.equal(summary.gates.numericLiveReplay, "PENDING_NO_NUMERIC_LIVE_KDJ");
});

test("malformed prices, duplicate, unordered and special-session labels remain price-quality failures", () => {
  for (const change of [p => p.data.klines.push(p.data.klines[0]), p => p.data.klines.reverse(),
    p => { p.data.klines[0] = p.data.klines[0].replace('09:31', '09:30'); },
    p => { p.data.klines[0] = p.data.klines[0].replace(',12,9,', ',5,9,'); },
    p => { p.data.klines[0] = p.data.klines[0].replace('2026-10-14', '2026-02-30'); }]) {
    const p = payload(); change(p); const result = new ObservedMinuteFeed().observe(p, obs("09:44:00"));
    assert.ok(result.issues.length); assert.equal(result.sourceGates.priceRows, "FAIL_OR_EMPTY");
    assert.equal(result.kdj, null); assert.equal(result.acceptedCount, 0);
  }
});

test("non-causal receipt timestamps are rejected", () => {
  const feed = new ObservedMinuteFeed(); feed.observe(payload(), obs("09:44:00"));
  assert.throws(() => feed.observe(payload(), obs("09:44:00")), /OBSERVATION_TIME_INVALID/);
  assert.throws(() => feed.observe(payload(), { requestedAt: at("09:46:00"), receivedAt: at("09:45:00") }), /OBSERVATION_TIME_INVALID/);
});

test("network requests stay deduplicated and cached; cached calls create no new observation evidence", async () => {
  let count = 0, clock = at("09:42:20"), receipts = 0;
  const p = payload(); p.data.code = "600001";
  const fetchImpl = async () => { count++; return new Response(JSON.stringify(p), { status: 200 }); };
  const options = { fetchImpl, now: () => clock, onObservation: () => receipts++ };
  await Promise.all([readEastmoneyMinuteSnapshot("600001", options), readEastmoneyMinuteSnapshot("600001", options)]);
  await readEastmoneyMinuteSnapshot("600001", options); assert.equal(count, 1); assert.equal(receipts, 1);
  clock += 60_001; await readEastmoneyMinuteSnapshot("600001", options); assert.equal(count, 2); assert.equal(receipts, 2);
});

test("historical wrapper preserves raw OHLC evidence without granting completion", () => {
  const raw = { timestamp: "2026-10-14T09:31:00+08:00", open: 10, high: null, low: 9, close: 11, volume: 1,
    barEndTime: "2026-10-14T09:31:00+08:00", availableAt: "2026-10-14T09:32:02+08:00", isComplete: false };
  const row = normalizeMarketBars([raw]).bars[0];
  assert.equal(row.kdjInput.high, null); assert.equal(row.kdjInput.isComplete, false);
  assert.equal(row.kdjInput.availableAt, raw.availableAt);
});

test("night probes and all-null comparisons cannot pass formal live acceptance", () => {
  const record = { payload: payload(), observation: obs("09:42:20") };
  const snapshot = new ObservedMinuteFeed().observe(record.payload, record.observation);
  const result = summarizeAcceptance([snapshot], [record], { probe: true });
  assert.equal(result.status, "NOT_ACCEPTED"); assert.equal(result.gates.numericLiveReplay, "PENDING_NO_NUMERIC_LIVE_KDJ");
  assert.equal(result.gates.observationCollection, "COLLECTED_UNCERTIFIED");
  assert.equal(result.gates.sourceContract, "BLOCKED_VENDOR_CONTRACT");
  assert.equal(result.gates.lunchBoundary, "PENDING_SEPARATE_OBSERVATION");
  assert.equal(result.gates.closingBoundary, "PENDING_SEPARATE_OBSERVATION");
});

test("dedicated OHLC route stays independent of quote and display-price fallback", () => {
  const source = readFileSync(new URL("../app/api/market-data/route.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf('if (mode === "kdj-ohlc")'), source.indexOf('if (mode === "trial-quote")'));
  assert.match(block, /readEastmoneyMinuteSnapshot/); assert.doesNotMatch(block, /fromPublicQuote|fromPublicMinutes/);
});

test("actual bounded loop collects gate-blocked revisions/next bars, persists receipts, enforces spacing and request cap", async t => {
  const out = await outputDir(t), feed = new ObservedMinuteFeed(), requestTimes = [];
  let clock = at("09:31:00"), pauses = 0;
  const result = await runObservationWindow({ out, now: () => clock, wait: async ms => { assert.ok(ms >= 0 && ms <= 60_000); clock += ms; },
    disconnect: () => { pauses++; feed.disconnect(); }, progress: () => {},
    readSnapshot: async (_symbol, { onObservation }) => {
      requestTimes.push(clock);
      // Prove incremental durable raw evidence exists before the next request.
      if (requestTimes.length > 1) assert.ok((await readFile(join(out, "observations.jsonl"), "utf8")).includes('"payload"'));
      const p = payload(Math.min(requestTimes.length, 12));
      if (requestTimes.length >= 3) editPrice(p, 0, "10.25");
      else if (requestTimes.length >= 2) editPrice(p, 0);
      const observation = { requestedAt: clock, receivedAt: clock, httpDate: null };
      const snapshot = feed.observe(p, observation); onObservation({ payload: p, observation }); return snapshot;
    } });
  assert.ok(requestTimes.length > 10 && requestTimes.length <= LIVE_ACCEPTANCE.maxRequests);
  assert.ok(requestTimes.every((time, i) => time <= at("09:50:00") && (!i || time - requestTimes[i-1] >= 60_000)));
  assert.equal(pauses, 1); assert.equal(result.acceptedBars, 0); assert.equal(result.status, "NOT_ACCEPTED");
  assert.ok(result.observationEvidence.labelAdvances > 0);
  assert.ok(result.observationEvidence.nextLabelAppearancesAfterPriorObservation > 0);
  assert.ok(result.observationEvidence.latestLabelPriceRevisions > 0);
  assert.ok(result.observationEvidence.earlierLabelPriceRevisions > 0);
  assert.equal(result.observationReplayMatches, true);
  const raw = await readFile(join(out, "observations.jsonl"), "utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"), result.observationsSha256);
  assert.match(await readFile(join(out, "events.jsonl"), "utf8"), /PRICE_REVISION/);
  const records = raw.trim().split('\n').map(JSON.parse).filter(x => x.payload);
  assert.equal(records.length, requestTimes.length);
  assert.deepEqual(records.map(x => x.observation.receivedAt), requestTimes);
});

test("outside-window loop exits without requests and existing output directory cannot overwrite evidence", async t => {
  for (const time of ["09:30:59", "09:50:01"]) {
    const out = await outputDir(t); let requests = 0;
    const options = { out, now: () => at(time), progress: () => {}, readSnapshot: async () => { requests++; throw new Error("unexpected"); } };
    const result = await runObservationWindow(options);
    assert.equal(result.status, "PENDING_TRADING_WINDOW"); assert.equal(requests, 0);
    await assert.rejects(runObservationWindow(options), /EEXIST/);
  }
});
