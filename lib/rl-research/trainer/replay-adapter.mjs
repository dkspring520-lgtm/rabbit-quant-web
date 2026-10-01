import { HistoricalReplayEngine } from "../../paper-trading/historical-replay-engine.mjs";
import { buildOfflineRLDataset, buildRLDatasetReport } from "./offline-dataset.mjs";

export function replayToRLDataset(config = {}, options = {}) {
  const replay = config instanceof HistoricalReplayEngine ? config.run() : new HistoricalReplayEngine(config).run();
  const rows = (replay.samples ?? []).map(sample => { const fill = sample.execution ?? {}; const quantity = Number(fill.quantity); const notional = Number(fill.fillPrice) * quantity; return { ...sample, rawFutureReturnRate: sample.future5mReturn, expertAction: sample.signal, marketRegime: { trend: sample.trend, volatility: sample.volatility }, factorSnapshot: sample.factorSnapshot, positionState: { position: fill.positionAfter ?? null }, cashState: { cash: fill.cashAfter ?? null }, feeRate: Number.isFinite(notional) && notional > 0 && Number.isFinite(Number(fill.fees)) ? Number(fill.fees) / notional : null, slippageRate: Number.isFinite(notional) && notional > 0 && Number.isFinite(Number(fill.slippage)) ? Number(fill.slippage) / notional : null }; });
  const dataset = buildOfflineRLDataset(rows, options);
  return { replay, dataset, report: buildRLDatasetReport(dataset) };
}
