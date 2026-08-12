import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDisjointTimeSplits,
  auditFutureInvariance,
  BASE_T_FACTOR_DEFINITIONS,
  buildReproducibilityMetadata,
  buildTimeSplits,
  CausalFactorContext,
  DEFAULT_FACTOR_REGISTRY,
  FactorBacktestEngine,
  FactorClosureBacktestEngine,
  FactorCombinationBacktestEngine,
  FactorEngine,
  FactorRegistry,
  FutureLeakageError,
  DEFAULT_COMPOSITE_CONFIG,
  DEFAULT_COMPOSITE_RECIPES,
  applyCompositeSignalGates,
  auditMinuteDataSemantics,
  simulateClosureTrade,
  stableStringify,
  writeImmutableJson,
} from "../lib/factor-research/index.mjs";

function minuteTime(index) {
  const total = 9 * 60 + 30 + index;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`;
}

function session(date, phase = 0, count = 90) {
  const previousClose = 35 + phase * 0.01;
  const minutes = Array.from({ length: count }, (_, index) => {
    const trend = index * 0.002;
    const wave = Math.sin((index + phase) / 6) * 0.18;
    const price = previousClose + trend + wave;
    const prior = previousClose + Math.max(0, index - 1) * 0.002 + Math.sin((Math.max(0, index - 1) + phase) / 6) * 0.18;
    const open = index ? prior : price - 0.01;
    const volume = 10000 + (index % 12) * 850 + Math.round(Math.abs(Math.cos(index / 5)) * 3000);
    const buyRatio = 0.5 + Math.sin((index + phase) / 7) * 0.12;
    const activeBuyVolume = volume * buyRatio;
    const activeSellVolume = volume - activeBuyVolume;
    const marketPrice = 3000 + index * 0.15 + Math.sin(index / 9) * 2;
    const sectorPrice = 1000 + index * 0.08 + Math.sin(index / 8) * 1.5;
    return {
      time: minuteTime(index),
      open,
      high: Math.max(open, price) + 0.025,
      low: Math.min(open, price) - 0.025,
      close: price,
      price,
      volume,
      amount: price * volume,
      marketPrice,
      sectorPrice,
      activeBuyVolume,
      activeSellVolume,
      activeBuyNotional: activeBuyVolume * price,
      activeSellNotional: activeSellVolume * price,
      bigOrderNet: (activeBuyVolume - activeSellVolume) * price * 0.3,
      bid1Volume: 5000 * (1 + buyRatio),
      ask1Volume: 5000 * (2 - buyRatio),
    };
  });
  return { date, previousClose, marketRegime: phase % 2 ? "trend" : "range", minutes };
}

function sessions(count = 36) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, 2 + index));
    return session(date.toISOString().slice(0, 10).replaceAll("-", ""), index);
  });
}

test("registry contains 48 immutable, schema-complete T factors", () => {
  assert.equal(BASE_T_FACTOR_DEFINITIONS.length, 48);
  assert.equal(DEFAULT_FACTOR_REGISTRY.list().length, 48);
  assert.equal(new Set(BASE_T_FACTOR_DEFINITIONS.map(item => item.factorId)).size, 48);
  for (const factor of BASE_T_FACTOR_DEFINITIONS) {
    for (const field of [
      "factorId", "name", "category", "description", "formula", "inputFields",
      "timeframe", "direction", "version", "createdAt", "status",
    ]) assert.ok(field in factor, `${factor.factorId} lacks ${field}`);
    assert.ok(Object.isFrozen(factor));
  }
  assert.throws(() => DEFAULT_FACTOR_REGISTRY.register(BASE_T_FACTOR_DEFINITIONS[0]), /already registered/);
});

test("factor engine calculates every registered factor causally", () => {
  const input = session("20250102");
  const result = new FactorEngine().computeSession(input);
  assert.equal(result.rows.length, input.minutes.length);
  assert.deepEqual(Object.keys(result.rows.at(-1).factors).sort(), DEFAULT_FACTOR_REGISTRY.list().map(item => item.factorId).sort());
  assert.ok(Object.values(result.rows.at(-1).factors).filter(Number.isFinite).length >= 44);
  const audit = auditFutureInvariance(input);
  assert.equal(audit.pass, true, stableStringify(audit.mismatches));
  assert.equal(audit.factors, 48);
});

test("causal context and factor input schema reject future or label access", () => {
  const computed = new FactorEngine().computeSession(session("20250102"), { factorIds: ["price.return_5m"] });
  const context = new CausalFactorContext(computed.session, 10);
  assert.throws(() => context.point(11), FutureLeakageError);
  assert.throws(() => context.values("price", 3, 1), FutureLeakageError);

  const unsafe = {
    ...BASE_T_FACTOR_DEFINITIONS[0],
    factorId: "unsafe.future_label",
    inputFields: ["price", "futureReturn"],
  };
  const registry = new FactorRegistry([unsafe]);
  assert.throws(
    () => new FactorEngine({ registry }).computeSession(session("20250102")),
    FutureLeakageError,
  );
});

test("market and order-flow factors remain null when source fields are unavailable", () => {
  const input = session("20250102");
  input.minutes = input.minutes.map((point) => {
    const stripped = { ...point };
    for (const field of [
      "marketPrice", "sectorPrice", "activeBuyVolume", "activeSellVolume",
      "activeBuyNotional", "activeSellNotional", "bigOrderNet", "bid1Volume", "ask1Volume",
    ]) delete stripped[field];
    return stripped;
  });
  const row = new FactorEngine().computeSession(input).rows.at(-1);
  assert.equal(row.factors["market.return_5m"], null);
  assert.equal(row.factors["orderflow.active_buy_imbalance"], null);
  assert.equal(row.factors["orderflow.book_depth_imbalance"], null);
});

test("time splits are ordered and detect overlapping dates", () => {
  const dates = sessions(10).map(item => item.date);
  const split = buildTimeSplits(dates);
  assert.equal(split.train.length, 6);
  assert.equal(split.validation.length, 2);
  assert.equal(split.test.length, 2);
  assert.equal(assertDisjointTimeSplits(split), true);
  assert.throws(() => assertDisjointTimeSplits({ train: ["20250102"], test: ["20250102"] }), /Data leakage/);
});

test("backtest evaluates positive and reverse T out of sample with actual costs", () => {
  const report = new FactorBacktestEngine().run(sessions(), {
    factorIds: ["price.return_5m", "vwap.mean_reversion", "orderflow.active_buy_imbalance"],
    horizons: [5, 10],
    sampleInterval: 5,
    rolling: { minimumTrainDays: 12, testDays: 6, stepDays: 6 },
  });
  assert.equal(report.coverage.factors, 3);
  assert.equal(report.coverage.reports, 12);
  assert.equal(report.antiOverfitting.futureLeakageAudit.pass, true);
  assert.deepEqual(new Set(report.reports.map(item => item.direction)), new Set(["positiveT", "reverseT"]));
  for (const item of report.reports) {
    assert.ok(item.splitSamples.train > 0);
    assert.ok(item.test.sampleCount > 0);
    assert.ok("ic" in item.test);
    assert.ok("icStability" in item.test);
    assert.ok("winRate" in item.test);
    assert.ok("averageNetReturn" in item.test);
    assert.ok("maximumDrawdown" in item.test);
    assert.ok("profitFactor" in item.test);
    assert.equal(item.test.parameterStability.length, 3);
    assert.ok(item.test.rollingOutOfSample.length > 0);
    assert.ok(item.test.averageGrossReturn !== item.test.averageNetReturn || item.test.trades === 0);
  }
});

function compositeModel(currentRecipe, overrides = {}) {
  return {
    scoreThreshold: 0,
    atrMfeMultiplier: 1,
    scalers: Object.fromEntries(currentRecipe.components.map(component => [
      component.factorId,
      { center: 0, scale: 1, samples: 100 },
    ])),
    ...overrides,
  };
}

function compositeSample(currentRecipe, overrides = {}) {
  return {
    date: "20250102",
    time: "1000",
    index: 30,
    price: 35,
    atrRate: 0.01,
    factorValues: Object.fromEntries(currentRecipe.components.map(component => [
      component.factorId,
      component.sign,
    ])),
    directionalReturn: 0.003,
    grossReturn: 0.003,
    netReturn: 0.002,
    marketRegime: "range",
    ...overrides,
  };
}

test("Phase 1B cost coverage rejects signals whose ATR move cannot cover costs", () => {
  const currentRecipe = DEFAULT_COMPOSITE_RECIPES[0];
  const model = compositeModel(currentRecipe);
  const gated = applyCompositeSignalGates([
    compositeSample(currentRecipe, { date: "20250102", atrRate: 0.00001 }),
    compositeSample(currentRecipe, { date: "20250103", atrRate: 0.01 }),
  ], currentRecipe, model, { ...DEFAULT_COMPOSITE_CONFIG, horizonMinutes: 5 });
  assert.equal(gated.baselineTrades.length, 2);
  assert.equal(gated.filteredTrades.length, 1);
  assert.equal(gated.signalFlow.rejectionReasons.costCoverage, 1);
  assert.ok(gated.filteredTrades[0].expectedFavorableReturn >= gated.filteredTrades[0].requiredCoverageReturn);
});

test("Phase 1B same-direction cooldown and daily cap suppress duplicate signals", () => {
  const currentRecipe = DEFAULT_COMPOSITE_RECIPES[0];
  const model = compositeModel(currentRecipe);
  const points = [30, 32, 36, 50, 75].map(index => compositeSample(currentRecipe, { index }));
  const gated = applyCompositeSignalGates(points, currentRecipe, model, {
    ...DEFAULT_COMPOSITE_CONFIG,
    horizonMinutes: 5,
    minimumPriceMove: 0,
    costCoverageMultiple: 0,
    cooldownMinutes: 20,
    maximumSignalsPerDay: 2,
  });
  assert.deepEqual(gated.filteredTrades.map(item => item.index), [30, 50]);
  assert.equal(gated.signalFlow.rejectionReasons.overlappingTrade, 1);
  assert.equal(gated.signalFlow.rejectionReasons.cooldown, 1);
  assert.equal(gated.signalFlow.rejectionReasons.dailyCap, 1);
});

test("Phase 1B composite fitting is train-only and remains future invariant", () => {
  const input = sessions(36);
  const changedTest = structuredClone(input);
  for (const current of changedTest.slice(28)) {
    for (const point of current.minutes) {
      point.price *= 1.08;
      point.close = point.price;
      point.high = Math.max(point.high, point.price);
      point.amount = point.price * point.volume;
    }
  }
  const options = { horizons: [5], recipeIds: ["positiveT.pullback_recovery"] };
  const original = new FactorCombinationBacktestEngine().run(input, options);
  const mutated = new FactorCombinationBacktestEngine().run(changedTest, options);
  assert.deepEqual(original.reports[0].model, mutated.reports[0].model);
  assert.equal(original.antiOverfitting.scalingFit, "train-only");
  assert.equal(original.antiOverfitting.scoreThresholdFit, "train-only");
  assert.equal(original.antiOverfitting.futureLeakageAudit.pass, true);
});

test("Phase 1B reports baseline-versus-filtered flow and handles missing inputs", () => {
  const input = sessions(36);
  for (const current of input) {
    current.minutes = current.minutes.map((point) => {
      const stripped = { ...point };
      for (const field of [
        "activeBuyVolume", "activeSellVolume", "activeBuyNotional", "activeSellNotional",
        "bigOrderNet", "bid1Volume", "ask1Volume",
      ]) delete stripped[field];
      return stripped;
    });
  }
  const result = new FactorCombinationBacktestEngine().run(input, {
    horizons: [5],
    recipeIds: ["positiveT.pullback_recovery"],
  });
  assert.equal(result.coverage.reports, 1);
  assert.equal(result.reports[0].test.signalFlow.finalSignals, 0);
  assert.ok(result.reports[0].test.signalFlow.rejectionReasons.missingFactors > 0);
  assert.equal(result.affectsSmartT, false);
  assert.equal(result.affectsShadowV2, false);
  assert.equal(result.canPromoteAutomatically, false);
});

function closureSession(prices, overrides = {}) {
  return {
    date: "20250102",
    marketRegime: "range",
    minutes: prices.map((price, index) => ({
      time: minuteTime(index),
      open: index ? prices[index - 1] : price,
      high: price,
      low: price,
      close: price,
      price,
      volume: 10000,
      amount: price * 10000,
      activeBuyVolume: 5500,
      activeSellVolume: 4500,
      l2Available: true,
      ...(overrides[index] ?? {}),
    })),
  };
}

test("Phase 1C positive and reverse T use independent first-touch exits", () => {
  const positive = simulateClosureTrade({
    session: closureSession([35, 35.02, 35.10]),
    entryIndex: 0,
    direction: "positiveT",
    atrRate: 0,
    config: {
      maximumHoldMinutes: { positiveT: 2 },
      feeRate: 0,
      minCommission: false,
      slippage: 0,
    },
  });
  assert.equal(positive.exitReason, "takeProfit");
  assert.equal(positive.exitIndex, 2);
  assert.equal(positive.targetPrice, 35.08);
  assert.ok(positive.netPnl > 0);

  const reverse = simulateClosureTrade({
    session: closureSession([35, 35.03, 35.07]),
    entryIndex: 0,
    direction: "reverseT",
    atrRate: 0,
    config: { maximumHoldMinutes: { reverseT: 2 } },
  });
  assert.equal(reverse.exitReason, "stopLoss");
  assert.equal(reverse.exitIndex, 2);
  assert.equal(reverse.stopPrice, 35.06);
  assert.ok(reverse.netPnl < 0);
});

test("Phase 1C timeout, fees and slippage are included in net results", () => {
  const trade = simulateClosureTrade({
    session: closureSession([35, 35.01, 35.02]),
    entryIndex: 0,
    direction: "positiveT",
    atrRate: 0,
    config: { maximumHoldMinutes: { positiveT: 2 } },
  });
  assert.equal(trade.exitReason, "timeout");
  assert.equal(trade.holdingMinutes, 2);
  assert.ok(trade.fees > 0);
  assert.ok(trade.netPnl < trade.grossPnl);
  assert.ok(trade.entryPrice > trade.entryMarketPrice);
  assert.ok(trade.exitPrice < trade.exitMarketPrice);
});

test("Phase 1C handles same-minute TP and SL conflicts conservatively", () => {
  const input = closureSession([35, 35]);
  input.minutes[1].high = 35.20;
  input.minutes[1].low = 34.80;
  const trade = simulateClosureTrade({
    session: input,
    entryIndex: 0,
    direction: "positiveT",
    atrRate: 0,
    config: { maximumHoldMinutes: { positiveT: 1 } },
  });
  assert.equal(trade.sameMinuteConflict, true);
  assert.equal(trade.exitReason, "stopLoss");
  assert.equal(trade.exitMarketPrice, trade.stopPrice);
});

test("Phase 1C rejects cumulative session extrema as minute OHLC", () => {
  const input = closureSession(Array.from({ length: 30 }, (_, index) => 35 + Math.sin(index / 3) * 0.05));
  let runningHigh = -Infinity;
  let runningLow = Infinity;
  for (const point of input.minutes) {
    point.open = 35;
    runningHigh = Math.max(runningHigh, point.price);
    runningLow = Math.min(runningLow, point.price);
    point.high = runningHigh;
    point.low = runningLow;
    point.exchangeMinute = `${input.date}-${point.time}`;
  }
  const audit = auditMinuteDataSemantics([input]);
  assert.equal(audit.ohlc.classification, "cumulative-session-extrema");
  assert.equal(audit.ohlc.safeForFirstTouch, false);
  assert.throws(
    () => new FactorClosureBacktestEngine().run([input], { pricePathMode: "ohlc" }),
    /Unsafe OHLC first-touch request/,
  );
});

test("Phase 1C locks the chronological test interval and cannot promote", () => {
  const input = sessions(36);
  const report = new FactorClosureBacktestEngine().run(input, {
    recipeIds: ["positiveT.pullback_recovery", "reverseT.high_exhaustion"],
    rolling: { minimumTrainDays: 12, testDays: 6, stepDays: 6 },
  });
  assert.equal(report.coverage.reports, 2);
  assert.equal(report.pricePathMode, "ohlc-first-touch");
  assert.equal(report.factorPriceInputMode, "minute-ohlc");
  assert.equal(report.dataAudit.timestamps.continuityGaps, 0);
  assert.equal(report.lockedTestInterval.locked, true);
  assert.equal(report.lockedTestInterval.usedForFitting, false);
  assert.equal(report.lockedTestInterval.optimizationAllowed, false);
  assert.match(report.lockedTestInterval.datesChecksum, /^[a-f0-9]{64}$/);
  assert.equal(report.antiOverfitting.modelFit, "train-only");
  assert.equal(report.antiOverfitting.diagnosticThresholdFit, "train-only");
  assert.equal(report.antiOverfitting.rollingExcludesLockedTest, true);
  const lockedDates = new Set(report.timeSplits.test);
  for (const item of report.reports) {
    assert.ok(item.rollingOutOfSample.folds.length > 0);
    for (const fold of item.rollingOutOfSample.folds) {
      assert.equal(fold.timeOrdered, true);
      assert.ok(fold.trainThrough < fold.testStart);
      assert.equal([...lockedDates].some(date => date >= fold.testStart && date <= fold.testEnd), false);
    }
  }
  assert.equal(report.affectsSmartT, false);
  assert.equal(report.affectsShadowV2, false);
  assert.equal(report.affectsProductionStrategy, false);
  assert.equal(report.canPromoteAutomatically, false);
  assert.equal(report.requiresHumanApproval, true);
});

test("Phase 1D rebuilds causal minute OHLC from ticks and preserves missing L2 as null", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "factor-phase1d-"));
  const fixtureScript = path.join(directory, "fixture.py");
  const sourceRoot = path.join(directory, "source");
  const output = path.join(directory, "minute.jsonl");
  const manifest = path.join(directory, "minute.manifest.json");
  const fixture = String.raw`
import csv, io, sys, zipfile
from pathlib import Path

root = Path(sys.argv[1])
trade_header = ["万得代码", "交易所代码", "自然日", "时间", "成交编号", "成交代码", "委托代码", "BS标志", "成交价格", "成交数量", "叫卖序号", "叫买序号"]
quote_header = ["万得代码", "交易所代码", "自然日", "时间", "成交价", "成交量", "成交额", "成交笔数", "IOPV", "成交标志", "BS标志", "当日累计成交量", "当日成交额", "最高价", "最低价", "开盘价", "前收盘", "申卖价1", "申卖量1", "申买价1", "申买量1"]
order_header = ["万得代码", "交易所代码", "自然日", "时间", "委托编号", "交易所委托号", "委托类型", "委托代码", "委托价格", "委托数量"]

def encoded(rows):
    stream = io.StringIO(newline="")
    csv.writer(stream).writerows(rows)
    return stream.getvalue().encode("gb18030")

def write_archive(folder, trades, quotes=None, orders=None):
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(folder / "601899.SH.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("逐笔成交.csv", encoded([trade_header, *trades]))
        if quotes is not None:
            archive.writestr("行情.csv", encoded([quote_header, *quotes]))
        if orders is not None:
            archive.writestr("逐笔委托.csv", encoded([order_header, *orders]))

base = ["601899.SH", "SH", "20250102"]
short_trades = [[*base, "093000100", "1", "T", "B", "B", "340000", "100", "1", "1"]]
full_trades = [
    [*base, "093000100", "1", "T", "B", "B", "340000", "100", "1", "1"],
    [*base, "093010100", "2", "T", "S", "S", "342000", "200", "2", "2"],
    [*base, "093020100", "3", "T", "B", "B", "339000", "300", "3", "3"],
    [*base, "093059900", "4", "T", "S", "S", "341000", "400", "4", "4"],
    [*base, "093100100", "5", "T", "B", "B", "341500", "500", "5", "5"],
]
future_quote = [[*base, "093159900", "341500", "500", "17075", "1", "", "", "", "1500", "51125", "342000", "339000", "340000", "335000", "341600", "800", "341400", "1200"]]
orders = [[*base, "093100000", "1", "1", "A", "B", "341400", "600"]]
write_archive(root / "short" / "20250102", short_trades)
write_archive(root / "complete" / "20250102", full_trades, future_quote, orders)
`;
  await writeFile(fixtureScript, fixture, "utf8");
  const create = spawnSync("python", [fixtureScript, sourceRoot], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  const build = spawnSync("python", [
    "scripts/build-zijin-factor-dataset.py",
    "--input-root", sourceRoot,
    "--output", output,
    "--manifest", manifest,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);

  const rebuilt = JSON.parse((await readFile(output, "utf8")).trim());
  const metadata = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(rebuilt.minutes.length, 2);
  assert.deepEqual(
    Object.fromEntries(["open", "high", "low", "close", "volume", "amount"].map(key => [key, rebuilt.minutes[0][key]])),
    { open: 34, high: 34.2, low: 33.9, close: 34.1, volume: 1000, amount: 34050 },
  );
  assert.equal(rebuilt.minutes[0].activeBuyVolume, 400);
  assert.equal(rebuilt.minutes[0].activeSellVolume, 600);
  assert.equal(rebuilt.minutes[0].quotePrice, null);
  assert.equal(rebuilt.minutes[0].bidPrices, null);
  assert.equal(rebuilt.minutes[0].orderCount, null);
  assert.equal(rebuilt.minutes[1].quotePrice, 34.15);
  assert.equal(rebuilt.minutes[1].previousClose, 33.5);
  assert.equal(rebuilt.minutes[1].orderBuyVolume, 600);
  assert.equal(rebuilt.minutes[1].orderSellVolume, 0);
  assert.match(metadata.duplicateResolution[0].selected, /complete/);
  assert.equal(metadata.alignment.futureQuoteRowsUsed, 0);
  assert.equal(metadata.alignment.missingFields, "null-not-zero-filled");
  assert.equal(metadata.affectsShadowV2, false);
  assert.equal(metadata.affectsSmartT, false);
  assert.equal(metadata.canPromoteAutomatically, false);
  const audit = auditMinuteDataSemantics([rebuilt]);
  assert.equal(audit.ohlc.classification, "minute-ohlc");
  assert.equal(audit.ohlc.safeForFirstTouch, true);
  const closure = new FactorClosureBacktestEngine().run([rebuilt], {
    recipeIds: ["positiveT.pullback_recovery"],
  });
  assert.equal(closure.pricePathMode, "ohlc-first-touch");
  assert.equal(closure.factorPriceInputMode, "minute-ohlc");
});

test("reproducibility metadata and immutable artifacts are deterministic", async () => {
  const data = sessions(3);
  const options = {
    sessions: data,
    datasetId: "fixture-v1",
    engineVersion: "test-engine",
    factorVersion: "1.0.0",
    config: { horizon: 5, threshold: 0.7 },
    asOf: "2025-01-04T11:00:00+08:00",
    gitCommit: "test-commit",
  };
  const first = buildReproducibilityMetadata(options);
  const second = buildReproducibilityMetadata(options);
  assert.deepEqual(first, second);
  assert.match(first.datasetChecksum, /^[a-f0-9]{64}$/);
  assert.match(first.configHash, /^[a-f0-9]{64}$/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "factor-research-"));
  const file = path.join(directory, "factor.json");
  const created = await writeImmutableJson(file, { metadata: first, factorId: "price.return_5m" });
  const reused = await writeImmutableJson(file, { metadata: first, factorId: "price.return_5m" });
  assert.equal(created.created, true);
  assert.equal(reused.created, false);
  assert.match(await readFile(file, "utf8"), /price\.return_5m/);
  await assert.rejects(() => writeImmutableJson(file, { changed: true }), /cannot be overwritten/);
});

test("factor research CLI produces an immutable reproducible report", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "factor-research-cli-"));
  const input = path.join(directory, "sessions.jsonl");
  const output = path.join(directory, "output");
  await writeFile(input, `${sessions(8).map(item => JSON.stringify(item)).join("\n")}\n`, "utf8");
  const run = spawnSync(process.execPath, [
    "scripts/run-factor-research.mjs",
    "--input", input,
    "--output", output,
    "--dataset-id", "cli-fixture-v1",
    "--factor", "price.return_5m,vwap.mean_reversion",
    "--combinations",
    "--closures",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.factors, 2);
  assert.equal(summary.evaluations, 16);
  assert.equal(summary.combinationEvaluations, 16);
  assert.equal(summary.closureEvaluations, 4);
  assert.equal(summary.closureControlEvaluations, 4);
  assert.equal(summary.closureControlMultiple, 1.5);
  assert.equal(summary.closurePricePathMode, "ohlc-first-touch");
  assert.equal(summary.leakageAuditPassed, true);
  const files = await readdir(output);
  assert.equal(files.filter(file => /^factor-research-.*\.json$/.test(file)).length, 1);
  const report = JSON.parse(await readFile(path.join(output, files.find(file => file.endsWith(".json"))), "utf8"));
  assert.equal(report.metadata.datasetId, "cli-fixture-v1");
  assert.equal(report.backtest.affectsSmartT, false);
  assert.equal(report.backtest.affectsShadowV2, false);
  assert.equal(report.combinations.coverage.reports, 16);
  assert.equal(report.combinations.affectsSmartT, false);
  assert.equal(report.combinations.canPromoteAutomatically, false);
  assert.equal(report.closures.coverage.reports, 4);
  assert.equal(report.closures.lockedTestInterval.locked, true);
  assert.equal(report.closures.affectsSmartT, false);
  assert.equal(report.closures.canPromoteAutomatically, false);
  assert.equal(report.closures.config.costCoverageMultiple, 2);
  assert.equal(report.closureControl.role, "shadow-control-only");
  assert.equal(report.closureControl.selectionScope, "rolling-development-only-excludes-locked-test");
  assert.equal(report.closureControl.lockedTestMaySelectModel, false);
  assert.equal(report.closureControl.result.config.costCoverageMultiple, 1.5);
  assert.equal(report.closureControl.result.coverage.reports, 4);
  assert.deepEqual(report.closureControl.result.lockedTestInterval, report.closures.lockedTestInterval);
  assert.equal(report.closureControl.result.affectsShadowV2, false);
  assert.equal(report.closureControl.result.affectsProductionStrategy, false);
  assert.equal(report.closureControl.result.canPromoteAutomatically, false);
});
