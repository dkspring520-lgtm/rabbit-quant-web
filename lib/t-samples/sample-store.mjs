import { validateSample } from "./sample-validator.mjs";

export const REJECT_DUPLICATE = "REJECT_DUPLICATE";
const keyOf = sample => `${sample.symbol}|${sample.timestamp}|${sample.provenance?.replayVersion ?? "UNKNOWN"}|${sample.provenance?.sampleVersion ?? "UNKNOWN"}`;

export class TSampleStore {
  constructor(samples = []) { this.samples = new Map(); for (const sample of samples) this.add(sample); }
  add(sample) {
    const validation = validateSample(sample);
    if (!validation.valid) throw new TypeError(validation.errors.join("; "));
    const key = keyOf(sample);
    if (this.samples.has(key)) { const error = new Error(REJECT_DUPLICATE); error.code = REJECT_DUPLICATE; throw error; }
    this.samples.set(key, structuredClone(sample));
    return structuredClone(sample);
  }
  list() { return [...this.samples.values()].map(sample => structuredClone(sample)); }
  query(filters = {}) {
    return this.list().filter(sample => {
      const state = sample.stateSnapshot?.state; const opportunity = sample.opportunitySnapshot?.type;
      return (!filters.state || state === filters.state) && (!filters.opportunity || opportunity === filters.opportunity) && (!filters.structureLabel || sample.label?.structureLabel === filters.structureLabel) && (!filters.outcomeLabel || sample.label?.outcomeLabel === filters.outcomeLabel) && (!filters.validOnly || sample.valid === true);
    });
  }
  size() { return this.samples.size; }
}
