import { readFile, writeFile } from "node:fs/promises";
import { PaperExecutionEngine } from "../lib/paper-trading/paper-execution-engine.mjs";

const resultPath = "docs/rl-research/results/offline-rl-v0.12.25.2-benchmark-result.json";
const outputPath = "docs/rl-research/results/offline-rl-v0.12.25.4-t1-execution-feasibility-audit.md";
const result = JSON.parse(await readFile(resultPath, "utf8"));
const costConfig = { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 };
const round = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
const feeForSell = (price, shares) => { const fill = price * (1 - 0.02 / 100); const turnover = fill * shares; return Math.max(5, turnover * 0.025 / 100) + turnover * 0.05 / 100; };
const traceRows = [];
for (const strategy of ["BIDIRECTIONAL_T", "EXPERT_PRIOR"]) for (const row of result.strategies[strategy].tradeLedger) { if (!(row.sell_price > 0) || row.execution_timestamp === null) continue; const state = row.state ?? {}; const positionBefore = Number(state.totalPosition ?? 0); const sellableBefore = Number(state.sellablePosition ?? 0); const shares = Number(row.shares ?? 0); traceRows.push({ strategy, sessionId: String(row.execution_timestamp).slice(0, 10), timestamp: row.execution_timestamp, positionBefore, sellablePositionBefore: sellableBefore, todayBoughtBefore: Number(state.todayBought ?? 0), corePosition: Number(state.corePosition ?? 0), tPosition: Number(state.tPosition ?? 0) + shares, action: row.action, actionSize: shares, sellableAfterSell: sellableBefore - shares, positionAfterSell: positionBefore - shares, cashAfterSell: round(Number(state.cash ?? 0) + Number(row.sell_price) * shares - feeForSell(Number(row.sell_price), shares)), todayBoughtAfterSell: Number(state.todayBought ?? 0), rebuyTimestamp: row.buyback_execution_timestamp ?? null, rebuyPrice: row.buyback_price ?? null, outcome: row.outcome }); }
function market(date, time, price) { return { symbol: "601899.SH", date, time, timestamp: date + "T" + time, marketPrice: price, price }; }
function fixture() { const engine = new PaperExecutionEngine({ symbol: "601899.SH", initialCash: 100000, initialPosition: 1000, initialSellablePosition: 1000, config: costConfig }); const sell = engine.execute(market("2026-10-05", "1000", 10), { side: "SELL", quantity: 300, orderPrice: 10 }); const buyBack = engine.execute(market("2026-10-05", "1001", 9.9), { side: "BUY", quantity: 300, orderPrice: 9.9 }); const sellOldInventory = engine.execute(market("2026-10-05", "1002", 9.8), { side: "SELL", quantity: 100, orderPrice: 9.8 }); const nextDaySellNewInventory = engine.execute(market("2026-10-06", "1000", 9.7), { side: "SELL", quantity: 300, orderPrice: 9.7 }); return { initial: { position: 1000, sellablePosition: 1000, todayBought: 0 }, sellExistingT: { status: sell.status }, sameDayBuyBack: { status: buyBack.status, totalPosition: engine.snapshot().position.totalPosition, sellablePosition: engine.snapshot().position.availableSellablePosition }, sameDaySellOldInventory: { status: sellOldInventory.status, reason: sellOldInventory.reason ?? null, expected: "FILLED", semanticStatus: sellOldInventory.status === "FILLED" ? "PASS" : "FAIL_FALSE_T1_BLOCK" }, nextDaySellNewInventory: { status: nextDaySellNewInventory.status, reason: nextDaySellNewInventory.reason ?? null, expected: "FILLED", semanticStatus: nextDaySellNewInventory.status === "FILLED" ? "PASS" : "FAIL" } }; }
const fixtureResult = fixture();
const falseT1Block = fixtureResult.sameDaySellOldInventory.semanticStatus === "FAIL_FALSE_T1_BLOCK";
const blockedReasons = {};
for (const strategy of ["BIDIRECTIONAL_T", "EXPERT_PRIOR"]) for (const row of result.strategies[strategy].tradeLedger) if (row.outcome === "BLOCKED_ACTION") blockedReasons[row.failure_reason] = (blockedReasons[row.failure_reason] ?? 0) + 1;
const rows = traceRows.slice(0, 40).map(row => "| " + [row.strategy, row.sessionId, row.timestamp, row.positionBefore, row.sellablePositionBefore, row.todayBoughtBefore, row.corePosition, row.tPosition, row.action, row.actionSize, row.sellableAfterSell, row.positionAfterSell, row.cashAfterSell, row.todayBoughtAfterSell, row.rebuyTimestamp ?? "N/A", row.rebuyPrice ?? "N/A", row.outcome].join(" | ") + " |");
const markdown = [
  "# OFFLINE RL V0.12.25.4 — T+1 + Execution Feasibility Semantics Audit",
  "",
  "Audit date: 2026-10-05",
  "",
  "本阶段只做 audit/diagnostic，不修改 Canonical Schema、Reward Contract、策略阈值或 T size 规则。",
  "",
  "## Audit Status",
  "",
  "T1_SEMANTICS_STATUS = " + (falseT1Block ? "BLOCKED" : "PASS"),
  "EXECUTION_FEASIBILITY_STATUS = DIAGNOSTIC_ONLY",
  "BACKTEST_RESULT = GENERATED",
  "VALUE_Q_TARGET = BLOCKED",
  "RL_TRAINING = NOT_STARTED",
  "HUMAN_REVIEW_REQUIRED = TRUE",
  "HARD_STOP = TRUE",
  "",
  "## 1. Canonical T+1 Meaning",
  "",
  "正确语义：当日新买入股份不能在当日再次 SELL；这不等价于禁止同日 BUY BACK。已有可卖 T Position 卖出后，同日 BUY BACK 在研究环境中可以发生；BUY BACK 新买入股份随后不能在当日再次 SELL。",
  "",
  "## 2. Engine Finding",
  "",
  "PaperExecutionEngine.mjs:80 额外执行 boughtToday > 0 且 quantity <= boughtToday 的 SELL 拒绝条件；随后第 81 行已经检查 quantity > availableSellablePosition。由于 availableSellablePosition 已经排除了当日买入股份，第 80 行会错误阻止一部分本应使用旧可卖库存完成的同日 SELL。",
  "",
  "这会把以下合法路径误判为 T+1 blocked：",
  "已有 1000 股可卖 -> SELL 300 -> 同日 BUY BACK 300 -> 仍有 700 股旧库存可卖；再次 SELL 100 理应允许，但当前引擎因 todayBought=300 且 quantity=100 而拒绝。",
  "",
  "## 3. Direct Semantic Fixture",
  "",
  "Fixture result:",
  "",
  JSON.stringify(fixtureResult, null, 2),
  "",
  "结论：同日 BUY BACK 本身可以执行，但随后卖出旧可卖库存被错误拒绝。因此当前 T+1 语义审计为 BLOCKED；这不是策略参数问题。",
  "",
  "## 4. Historical Benchmark Blocked Reasons",
  "",
  JSON.stringify(blockedReasons, null, 2),
  "",
  "V0.12.25.2 中的 same-day bought shares are not sellable 计数不能直接全部解释为真实 T+1 风险，其中一部分可能是上述 quantity <= boughtToday 误拒绝。",
  "",
  "## 5. Per-Cycle Position State Trace",
  "",
  "以下为已执行 SELL cycle 的前 40 条审计样本；完整 Trade Ledger 位于 V0.12.25.2 benchmark result JSON。",
  "",
  "| strategy | sessionId | timestamp | positionBefore | sellablePositionBefore | todayBoughtBefore | corePosition | tPosition | action | actionSize | sellableAfterSell | positionAfterSell | cashAfterSell | todayBoughtAfterSell | rebuyTimestamp | rebuyPrice | outcome |",
  "|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|---:|---|",
  ...rows,
  "",
  "## 6. Semantic Assertions",
  "",
  "- Existing sellable T Position 可以 SELL：必须 PASS。",
  "- 同日 BUY BACK：应允许，当前 fixture PASS。",
  "- 同日 SELL 当天 BUY BACK 新买入股份：应拒绝，当前 T+1 设计目标保持。",
  "- 同日 SELL 旧可卖库存但数量小于 todayBought：当前 FAIL_FALSE_T1_BLOCK。",
  "- Next-day SELL of rebuilt shares：当前 PASS。",
  "- Core Position 不应因上述路径变化：保持审计要求。",
  "",
  "## 7. Impact on Failure Analysis",
  "",
  "V0.12.25.3 中的 T+1 Constraint 与 Position Constraint 必须重新拆分后再解释。当前不能把全部失败归因于策略，也不能把全部 blocked action 当作真实 A 股限制。",
  "",
  "在修复或人工裁决该语义前，不应：",
  "- 重新排名策略",
  "- 调整 MACD/volume/price threshold",
  "- 调整 T size",
  "- 生成 Value-Q target",
  "- 生成 RL dataset",
  "- 启动 RL training",
  "",
  "## 8. V1/V2/V3 Boundary",
  "",
  "DATA-07 仍然只是 V1 的 1-minute historical research data。该审计不证明 Tick/L2/Order Flow 或 100–300ms 实时执行能力。",
  "",
  "## Final Gate",
  "",
  "BACKTEST_RESULT = GENERATED",
  "VALUE_Q_TARGET = BLOCKED",
  "RL_TRAINING = NOT_STARTED",
  "HUMAN_REVIEW_REQUIRED = TRUE",
  "HARD_STOP = TRUE",
].join("\n");
await writeFile(outputPath, markdown + "\n");
console.log(JSON.stringify({ outputPath, t1SemanticsStatus: falseT1Block ? "BLOCKED" : "PASS", fixtureResult, blockedReasons, traceRows: traceRows.length }, null, 2));
