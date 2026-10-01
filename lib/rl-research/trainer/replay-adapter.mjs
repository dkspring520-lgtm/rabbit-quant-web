import { HistoricalReplayEngine } from "../../paper-trading/historical-replay-engine.mjs";
import { buildOfflineRLDataset, buildRLDatasetReport } from "./offline-dataset.mjs";

export function replayToRLDataset(config = {}, options = {}) {
  const replay = config instanceof HistoricalReplayEngine ? config.run() : new HistoricalReplayEngine(config).run();
  const rows = (replay.samples ?? []).map(sample => ({ ...sample, futureReturn: sample.future5mReturn, expertAction: sample.signal, marketRegime: { trend: sample.trend, volatility: sample.volatility }, factorSnapshot: sample.factorSnapshot, positionState: { position: sample.execution?.positionAfter ?? null }, cashState: { cash: sample.execution?.cashAfter ?? null }, feeRate: sample.entryPrice ? (sample.fees ?? 0) / sample.entryPrice : 0, slippageRate: sample.entryPrice ? (sample.slippage ?? 0) / sample.entryPrice : 0 }));
  const dataset = buildOfflineRLDataset(rows, options);
  return { replay, dataset, report: buildRLDatasetReport(dataset) };
}
