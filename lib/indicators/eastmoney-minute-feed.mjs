// Official field/adjustment mappings are verified. The public 1m endpoint has
// no supported boundary/completion adapter: observations never grant completion.
export const EASTMONEY_MINUTE_CONTRACT = Object.freeze({
  id: "eastmoney-public-1m-candidate-v2", provider: "eastmoney-public",
  periodMinutesRequest: 1, timezoneAssumption: "Asia/Shanghai", adjustmentRequest: "fqt=0",
  fieldOrder: "time,open,close,high,low,volume,amount", priceFieldsVerified: true,
  fieldEvidenceId: "eastmoney-official-chart-20261013",
  adjustmentMappingVerified: true, adjustment: "none", priceScale: "DIRECT_NUMERIC_COMMON_BASIS",
  labelRole: "UNVERIFIED", timezone: "UNVERIFIED", priceUnit: "UNVERIFIED",
  volumeUnit: "UNVERIFIED", amountUnit: "UNVERIFIED", verified: false,
  providerCompletionEvidence: null,
  blockers: ["VENDOR_INTERVAL_LABEL_CONTRACT_MISSING", "AUCTION_COVERAGE_UNVERIFIED", "PROVIDER_COMPLETION_ADAPTER_MISSING"],
});
export const KDJ_FEED_POLICY = Object.freeze({
  version: "observed-ohlc-feed-v2", minObservations: 2, minObservationSpacingMs: 60_000,
  maxLiveLagMs: 180_000, completionPolicy: "NO_SUPPORTED_PROVIDER_COMPLETION_ADAPTER",
});
export function eastmoneyMinuteUrl(symbol = "601899") {
  if (!/^\d{6}$/.test(symbol)) throw new TypeError("Six-digit A-share symbol required");
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${symbol.startsWith("6") ? "1" : "0"}.${symbol}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=1&fqt=0&beg=0&end=20500101&lmt=500`;
}
export function shanghaiDay(time) { return new Date(time + 8 * 3600000).toISOString().slice(0, 10); }
const iso = time => time === null ? null : new Date(time).toISOString();
const numeric = value => typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const pricesOf = bar => ({ open: bar.open, high: bar.high, low: bar.low, close: bar.close });
const priceFingerprint = bar => JSON.stringify(pricesOf(bar));
const quantityFingerprint = bar => JSON.stringify(bar.reportedQuantity);

export function parseEastmoneyMinutePayload(payload, { symbol = "601899" } = {}) {
  if (payload?.rc !== 0 || payload?.data?.code !== symbol || !Array.isArray(payload?.data?.klines)) {
    throw new Error("UPSTREAM_SCHEMA_OR_SYMBOL_MISMATCH");
  }
  const bars = [], issues = [], quantityDiagnostics = [];
  let previous = null;
  const seen = new Set();
  for (const [index, row] of payload.data.klines.entries()) {
    const fields = typeof row === "string" ? row.split(",") : [];
    const [reportedTime, o, c, h, l, v, a] = fields;
    // Missing quantity columns do not make otherwise valid price fields invalid.
    if (fields.length < 5 || fields.length > 7 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(reportedTime ?? "")) {
      issues.push({ index, reason: "ROW_SCHEMA_INVALID" }); continue;
    }
    const labelTime = Date.parse(reportedTime.replace(" ", "T") + ":00+08:00");
    const time = reportedTime.slice(11).replace(":", "");
    const date = reportedTime.slice(0, 10);
    if (!Number.isFinite(labelTime) || new Date(labelTime + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ") !== reportedTime) {
      issues.push({ index, reason: "LABEL_TIME_INVALID" }); continue;
    }
    const bar = { symbol, date, time, reportedTime, labelTime,
      labelTimeInterpretation: "ASSUMED_ASIA_SHANGHAI_NOT_BAR_BOUNDARY",
      open: numeric(o), close: numeric(c), high: numeric(h), low: numeric(l),
      volume: numeric(v), amount: numeric(a), reportedQuantity: { volume: v ?? null, amount: a ?? null },
      inputKind: "VENDOR_OHLC_CANDIDATE" };
    const prices = [bar.open, bar.close, bar.high, bar.low];
    if (prices.some(x => x === null || x <= 0) || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
      issues.push({ index, reportedTime, reason: "OHLC_INVALID" }); continue;
    }
    for (const key of ["volume", "amount"]) {
      if (bar[key] === null || bar[key] < 0) {
        quantityDiagnostics.push({ index, reportedTime, field: key, raw: bar.reportedQuantity[key], reason: "QUANTITY_MISSING_OR_INVALID" });
        bar[key] = null;
      }
    }
    if (seen.has(labelTime)) issues.push({ index, reportedTime, reason: "DUPLICATE_LABEL" });
    if (previous !== null && labelTime <= previous) issues.push({ index, reportedTime, reason: "NON_MONOTONIC_LABEL" });
    seen.add(labelTime); previous = labelTime;
    if (!((time >= "0931" && time <= "1130") || (time >= "1301" && time <= "1500"))) {
      issues.push({ index, reportedTime, reason: "UNVERIFIED_SESSION_LABEL" });
    }
    bars.push(bar);
  }
  return { bars, issues, quantityDiagnostics, rowsReceived: payload.data.klines.length };
}

export class ObservedMinuteFeed {
  constructor({ symbol = "601899", contract = EASTMONEY_MINUTE_CONTRACT } = {}) {
    this.symbol = symbol; this.contract = Object.freeze({ ...contract });
    this.entries = new Map(); this.lastReceivedAt = null; this.lastDay = null;
    this.disconnected = false; this.sequence = 0; this.latestLabel = null;
  }
  disconnect() {
    this.disconnected = true;
    // Keep price versions/first availability. Only repeated-observation evidence resets.
    for (const entry of this.entries.values()) {
      Object.assign(entry, { stableObservations: 0, stableSince: null, stableObservedAt: null, lastStableObservationAt: null });
    }
  }
  observe(payload, { requestedAt, receivedAt, httpDate = null } = {}) {
    if (!Number.isFinite(requestedAt) || !Number.isFinite(receivedAt) || receivedAt < requestedAt
      || (this.lastReceivedAt !== null && receivedAt <= this.lastReceivedAt)) throw new Error("OBSERVATION_TIME_INVALID");
    const parsed = parseEastmoneyMinutePayload(payload, { symbol: this.symbol });
    const day = parsed.bars.at(-1)?.date ?? null;
    if (day && day !== this.lastDay) { this.entries.clear(); this.latestLabel = null; this.lastDay = day; }
    this.lastReceivedAt = receivedAt; this.sequence += 1;
    const events = [], previousLatest = this.latestLabel;
    const labels = [...new Set(parsed.bars.map(bar => bar.labelTime))].sort((a, b) => a - b);
    if (this.disconnected) events.push({ type: "RECOVERY_OBSERVATION", receivedAt });
    this.disconnected = false;
    for (const bar of parsed.bars) {
      const hash = priceFingerprint(bar), quantityHash = quantityFingerprint(bar);
      let entry = this.entries.get(bar.labelTime);
      if (!entry) {
        entry = { bar, hash, quantityHash, firstSeenAt: receivedAt, versionFirstSeenAt: receivedAt,
          stableSince: receivedAt, lastSeenAt: receivedAt, lastStableObservationAt: receivedAt,
          stableObservedAt: null, stableObservations: 1, revision: 0, quantityRevision: 0,
          priceVersions: [{ revision: 0, systemAvailableAt: iso(receivedAt), prices: pricesOf(bar) }],
          nextLabelFirstSeenAt: null, nextReportedTime: null };
        this.entries.set(bar.labelTime, entry);
        events.push({ type: "FIRST_OBSERVATION", reportedTime: bar.reportedTime, receivedAt, prices: pricesOf(bar) });
      } else {
        if (hash !== entry.hash) {
          events.push({ type: "PRICE_REVISION", reportedTime: bar.reportedTime, receivedAt,
            phase: previousLatest !== null && bar.labelTime < previousLatest ? "EARLIER_LABEL" : "LATEST_LABEL",
            revision: entry.revision + 1, previousPrices: pricesOf(entry.bar), prices: pricesOf(bar) });
          Object.assign(entry, { hash, versionFirstSeenAt: receivedAt, stableSince: receivedAt,
            lastStableObservationAt: receivedAt, stableObservedAt: null, stableObservations: 1, revision: entry.revision + 1 });
          entry.priceVersions.push({ revision: entry.revision, systemAvailableAt: iso(receivedAt), prices: pricesOf(bar) });
        } else if (entry.lastStableObservationAt === null || receivedAt - entry.lastStableObservationAt >= KDJ_FEED_POLICY.minObservationSpacingMs) {
          entry.stableObservations += 1; entry.lastStableObservationAt = receivedAt;
          entry.stableSince ??= receivedAt;
        }
        if (quantityHash !== entry.quantityHash) {
          entry.quantityRevision += 1;
          events.push({ type: "QUANTITY_REVISION", reportedTime: bar.reportedTime, receivedAt,
            quantityRevision: entry.quantityRevision, previousQuantity: entry.bar.reportedQuantity, quantity: bar.reportedQuantity });
          entry.quantityHash = quantityHash;
        }
        entry.bar = bar; entry.lastSeenAt = receivedAt;
      }
      if (entry.stableObservations >= KDJ_FEED_POLICY.minObservations && entry.stableObservedAt === null) {
        entry.stableObservedAt = receivedAt;
        events.push({ type: "REPEATED_PRICE_OBSERVATIONS", reportedTime: bar.reportedTime, revision: entry.revision, receivedAt });
      }
      const next = labels.find(time => time > bar.labelTime);
      if (next !== undefined && entry.nextLabelFirstSeenAt === null) {
        entry.nextLabelFirstSeenAt = receivedAt;
        entry.nextReportedTime = parsed.bars.find(x => x.labelTime === next).reportedTime;
        events.push({ type: "NEXT_LABEL_OBSERVED", reportedTime: bar.reportedTime, nextReportedTime: entry.nextReportedTime,
          previousBarSeenEarlier: entry.firstSeenAt < receivedAt, receivedAt });
      }
    }
    if (labels.length) {
      const latest = labels.at(-1);
      if (previousLatest !== null && latest > previousLatest) events.push({ type: "LABEL_ADVANCED", from: previousLatest, to: latest, receivedAt });
      this.latestLabel = Math.max(previousLatest ?? latest, latest);
    }
    const candidates = parsed.bars.map(bar => {
      const entry = this.entries.get(bar.labelTime);
      return { ...bar, barStartTime: null, barEndTime: null, isComplete: false, availableAt: null,
        providerComplete: false, providerFinal: null, completionStatus: "PROVIDER_COMPLETION_UNVERIFIED",
        observationState: entry.stableObservedAt === null ? "CANDIDATE_OBSERVED" : "REPEATED_PRICE_OBSERVATIONS",
        firstSeenAt: entry.firstSeenAt, observedAt: receivedAt, systemAvailableAt: iso(entry.versionFirstSeenAt),
        stableSince: iso(entry.stableSince), stableObservedAt: iso(entry.stableObservedAt),
        stableSystemAvailableAt: iso(entry.stableObservedAt), stableObservations: entry.stableObservations,
        revision: entry.revision, quantityRevision: entry.quantityRevision, priceVersions: entry.priceVersions,
        nextLabelFirstSeenAt: iso(entry.nextLabelFirstSeenAt), nextReportedTime: entry.nextReportedTime };
    });
    const priceFieldsVerified = this.contract.priceFieldsVerified === true && Boolean(this.contract.fieldEvidenceId)
      && this.contract.adjustmentMappingVerified === true && this.contract.adjustment === "none";
    const sourceGates = { priceFields: priceFieldsVerified ? "PASS_OFFICIAL_FIELD_MAPPING" : "BLOCKED_PRICE_FIELD_CONTRACT",
      priceRows: parsed.bars.length && !parsed.issues.length ? "PASS_OBSERVED_ROWS_ONLY" : "FAIL_OR_EMPTY",
      quantity: parsed.quantityDiagnostics.length ? "DIAGNOSTICS_ONLY" : "UNITS_UNKNOWN_DIAGNOSTIC_ONLY",
      timeBoundary: "BLOCKED_NO_VALIDATED_1M_BOUNDARY_ADAPTER", providerCompletion: "BLOCKED_NO_SUPPORTED_COMPLETION_ADAPTER" };
    const blockers = ["SOURCE_CONTRACT_UNVERIFIED", "VENDOR_INTERVAL_LABEL_CONTRACT_MISSING", "AUCTION_COVERAGE_UNVERIFIED", "PROVIDER_COMPLETION_ADAPTER_MISSING",
      ...(!priceFieldsVerified ? ["PRICE_FIELD_CONTRACT_UNVERIFIED"] : []),
      ...(parsed.issues.length || !parsed.bars.length ? ["INPUT_PRICE_QUALITY_FAILURE"] : []),
      ...(day !== shanghaiDay(receivedAt) ? ["NOT_CURRENT_TRADING_DATE"] : [])];
    // Deliberately no completion inference, terminal guard, or verified-flag bypass.
    // A future provider-completion adapter requires actual evidence and a new policy version.
    return structuredClone({ version: KDJ_FEED_POLICY.version, symbol: this.symbol, sequence: this.sequence,
      provider: this.contract.provider, sourceContract: this.contract, policy: KDJ_FEED_POLICY, sourceGates,
      requestedAt: iso(requestedAt), receivedAt: iso(receivedAt), httpDate,
      marketDate: day, status: "BLOCKED", blockers, issues: parsed.issues,
      quantityDiagnostics: parsed.quantityDiagnostics, events, rowsReceived: parsed.rowsReceived,
      candidateBars: candidates, acceptedBars: [], acceptedCount: 0, lagMs: null, kdj: null });
  }
}

export function replayFeedObservations(observations, options = {}) {
  const feed = new ObservedMinuteFeed(options);
  return observations.map(record => {
    if (record.disconnected) { feed.disconnect(); return { status: "DISCONNECTED" }; }
    return feed.observe(record.payload, record.observation);
  });
}
