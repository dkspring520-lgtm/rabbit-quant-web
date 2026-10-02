import { FactorEngine } from "../factor-research/factor-engine.mjs";
import { createSignalSample, SampleResolver } from "./signal-sample.mjs";
import { PaperExecutionEngine } from "./paper-execution-engine.mjs";
import { MarketRegimeEngine } from "./market-regime-engine.mjs";

export class HistoricalReplayEngine {
  constructor({ symbol, startTime = "", endTime = "", dataset = {}, mode = "FAST", signalSource = () => ({ side: "WAIT" }), modelVersion = "baseline", datasetVersion = "dataset-v1", candidateId = "", initialCash = 0, initialPosition = 0, costConfig = {}, factorIds = null, precomputeFactors = false } = {}) {
    this.symbol = symbol; this.startTime = startTime; this.endTime = endTime; this.mode = mode; this.signalSource = signalSource; this.modelVersion = modelVersion; this.datasetVersion = datasetVersion; this.candidateId = candidateId; this.factorIds = factorIds;
    this.session = { ...dataset, symbol, minutes: (dataset.minutes ?? []).filter(point => (!startTime || String(point.timestamp ?? point.time) >= startTime) && (!endTime || String(point.timestamp ?? point.time) <= endTime)) };
    this.factorEngine = new FactorEngine(); this.factorCache = dataset.factorRows ?? (precomputeFactors ? this.factorEngine.computeSession(this.session, { factorIds: this.factorIds }).rows : null); this.regimeEngine = new MarketRegimeEngine(); this.paper = new PaperExecutionEngine({ symbol, initialCash, initialPosition, initialSellablePosition: initialPosition, config: costConfig }); this.resolver = new SampleResolver(); this.index = -1; this.samples = []; this.signals = []; this.fills = [];
  }
  step() {
    const next = this.index + 1; if (next >= this.session.minutes.length) return null; this.index = next; const point = this.session.minutes[next];
    const prefix = { ...this.session, minutes: this.session.minutes.slice(0, next + 1) }; const factorRow = this.factorCache?.[next] ?? this.factorEngine.computeSession(prefix, { factorIds: this.factorIds }).rows.at(-1); const market = { ...point, symbol: this.symbol, date: this.session.date, marketPrice: point.price ?? point.close, timestamp: point.timestamp ?? `${this.session.date}T${point.time}` };
    const regime = this.regimeEngine.classify({ price: market.marketPrice, factors: factorRow?.factors, volume: point.volume, averageVolume: this.session.averageVolume }); const signal = this.signalSource({ point: structuredClone(point), factors: structuredClone(factorRow?.factors ?? {}), regime, index: next, marketState: regime.marketRegime }) ?? { side: "WAIT" }; const side = String(signal.side ?? signal.signal ?? "WAIT").toUpperCase(); const signalId = signal.signalId ?? `${this.symbol}-${this.session.date}-${point.time}-${next}`;
    const execution = this.paper.execute(market, { ...signal, side, signalId, candidateId: signal.candidateId ?? this.candidateId, modelVersion: signal.modelVersion ?? this.modelVersion, datasetVersion: signal.datasetVersion ?? this.datasetVersion, orderPrice: signal.orderPrice ?? market.marketPrice, quantity: signal.quantity ?? 0 });
    const sample = createSignalSample({ sampleId: `${signalId}-sample`, signalId, candidateId: signal.candidateId ?? this.candidateId, symbol: this.symbol, timestamp: market.timestamp, entryPrice: market.marketPrice, signal: side, signalScore: signal.score, marketState: regime.marketRegime, marketRegime: regime.marketRegime, trend: regime.trend, volatility: regime.volatility, tradingMode: regime.tradingMode, factorSnapshot: factorRow?.factors ?? {}, modelVersion: signal.modelVersion ?? this.modelVersion, datasetVersion: signal.datasetVersion ?? this.datasetVersion, execution, entryIndex: next, lifecycle: "OBSERVING" });
    this.signals.push({ signal, factorSnapshot: factorRow?.factors ?? {}, timestamp: market.timestamp }); this.fills.push(execution); this.samples.push(sample); this.samples = this.resolver.advance(this.samples, this.session.minutes, next, this.fills); return this.samples.at(-1);
  }
  run() {
    if (this.mode === "STEP") this.step();
    else while (this.step()) {}
    return { symbol: this.symbol, mode: this.mode, signals: this.signals, fills: this.fills, samples: this.samples, account: this.paper.snapshot() };
  }
  resolveSamples() { this.samples = this.resolver.advance(this.samples, this.session.minutes, this.index, this.fills); return this.samples; }
}
