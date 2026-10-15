/** Canonical KDJ v1. See docs/kdj-canonical-contract-v1.md. No price/OHLC proxies. */
export const KDJ_CONTRACT_VERSION = "kdj-ohlc-continuous-50-v1";
export const KDJ_DEFAULT_PERIOD = 9;

export function resolveKdjOptions(options = {}) {
  const aliases = [options.period, options.n, options.length].filter(value => value !== undefined);
  if (aliases.some(value => !Number.isInteger(value) || value < 1 || value > 10000)) {
    throw new RangeError("KDJ period/n/length must be an integer from 1 to 10000");
  }
  if (new Set(aliases).size > 1) throw new RangeError("Conflicting KDJ period/n/length");
  if (options.signal !== undefined && options.signal !== 3) throw new RangeError("Canonical KDJ smoothing is fixed at 3");
  const timeframeMinutes = options.timeframeMinutes ?? 1;
  if (!Number.isInteger(timeframeMinutes) || timeframeMinutes < 1 || timeframeMinutes > 240) {
    throw new RangeError("KDJ timeframeMinutes must be an integer from 1 to 240");
  }
  return { ...options, period: aliases[0] ?? KDJ_DEFAULT_PERIOD, timeframeMinutes };
}

function instant(value) {
  if (typeof value === "number") return Number.isFinite(new Date(value + 8 * 3600000).getTime()) ? value : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function exchangeClock(time) {
  const date = new Date(time + 8 * 60 * 60 * 1000);
  return { day: date.toISOString().slice(0, 10), minute: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

export class CausalKdj {
  constructor(options = {}) {
    this.options = resolveKdjOptions(options);
    this.lastEndTime = null;
    this.resetValues();
  }

  resetValues() { this.window = []; this.k = 50; this.d = 50; }

  update(bar = {}, context = {}) {
    const input = bar ?? {};
    const options = this.options;
    const end = instant(input.barEndTime ?? (options.timestampRole === "end" ? input.timestamp : undefined));
    const available = instant(input.availableAt ?? input.barEndTime ?? (options.timestampRole === "end" ? input.timestamp : undefined));
    const asOf = instant(context.asOf ?? options.asOf ?? end);
    const output = (status, reason, value = null, resetReason = null, rsv = null) => ({
      timestamp: input.timestamp ?? input.barEndTime ?? null,
      value,
      metadata: { contractVersion: KDJ_CONTRACT_VERSION, inputKind: "OHLC", valid: value !== null,
        status, reason, period: options.period, smoothing: 3, seed: 50,
        warmupBars: options.period - 1, validWindowBars: this.window.length,
        barEndTime: end, availableAt: available, resetReason, rsv },
    });
    // A forming/not-yet-visible bar never changes the stream; it may be resubmitted after close.
    if (input.isComplete === false || (input.isComplete !== true && options.completedBars !== true)) {
      return output("UNAVAILABLE", "BAR_NOT_CONFIRMED_COMPLETE");
    }
    if (end === null || available === null || asOf === null || available < end) return output("UNAVAILABLE", "BAR_TIME_CONTRACT_MISSING_OR_INVALID");
    if (end > asOf || available > asOf) return output("UNAVAILABLE", "BAR_NOT_YET_VISIBLE");
    if (this.lastEndTime !== null && end <= this.lastEndTime) return output("INVALID", "NON_MONOTONIC_BAR_END");

    let resetReason = null;
    if (this.lastEndTime !== null) {
      const previous = exchangeClock(this.lastEndTime);
      const current = exchangeClock(end);
      const lunch = previous.day === current.day && previous.minute === 690
        && current.minute === 780 + options.timeframeMinutes
        && end - this.lastEndTime === (90 + options.timeframeMinutes) * 60000;
      if (previous.day !== current.day) resetReason = "NEW_TRADING_DAY";
      else if (!lunch && end - this.lastEndTime !== options.timeframeMinutes * 60000) resetReason = "UNEXPECTED_BAR_GAP";
      if (resetReason) this.resetValues();
    }
    this.lastEndTime = end;
    const prices = [input.open, input.high, input.low, input.close];
    if (input.inputKind && input.inputKind !== "OHLC") {
      this.resetValues();
      return output("INVALID", "PRICE_PROXY_NOT_ALLOWED", null, "INVALID_INPUT");
    }
    if (prices.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      this.resetValues();
      return output("INVALID", "COMPLETE_POSITIVE_OHLC_REQUIRED", null, "INVALID_INPUT");
    }
    if (input.high < Math.max(input.open, input.close) || input.low > Math.min(input.open, input.close) || input.high < input.low) {
      this.resetValues();
      return output("INVALID", "OHLC_ORDER_INVALID", null, "INVALID_INPUT");
    }
    this.window.push({ high: input.high, low: input.low });
    if (this.window.length > options.period) this.window.shift();
    if (this.window.length < options.period) return output("WARMUP", "FULL_WINDOW_REQUIRED", null, resetReason);
    const high = Math.max(...this.window.map(item => item.high));
    const low = Math.min(...this.window.map(item => item.low));
    const rsv = high === low ? 50 : 100 * (input.close - low) / (high - low);
    this.k = (2 * this.k + rsv) / 3;
    this.d = (2 * this.d + this.k) / 3;
    return output("VALID", null, { k: this.k, d: this.d, j: 3 * this.k - 2 * this.d }, resetReason, rsv);
  }

  updateSeries(bars = [], context = {}) { return bars.map(bar => this.update(bar, context)); }
}

export function calculateKdjSeries(bars = [], options = {}) {
  return new CausalKdj(options).updateSeries(bars);
}
