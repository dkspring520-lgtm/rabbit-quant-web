# OFFLINE RL V0.12.24.2 — Historical T Benchmark Engine Implementation

Implementation date: 2026-10-05

基于：

- offline-rl-v0.12.23.6.7-canonical-schema-final-approval.md
- offline-rl-v0.12.24.1-benchmark-metric-contract.md

本阶段只实现统一的 Historical T Benchmark Engine。代码可以被测试和后续研究调用，但本阶段不执行 DATA-07 历史回测、不生成 benchmark result artifact、不生成 Dataset、不生成 Value-Q target，也不进行 RL training。

## Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Implementation Entry Point

实现模块：

lib/rl-research/historical-t-benchmark-engine.mjs

导出函数：

runHistoricalTBenchmark({

- bars：DATA-07 observations
- symbol
- initialCash
- corePosition
- tPosition
- initialAverageCost
- costConfig
- strategyConfigs
- evaluationWindows

})

返回每个 strategyId 的独立 report，不写入 Dataset、Replay Dataset 或结果 artifact。

## 2. Unified Execution Environment

Benchmark Engine 复用现有 PaperExecutionEngine，统一处理：

- cash
- total position
- sellable position
- commission
- minimum commission
- stamp duty
- slippage
- A 股 100-share lot rounding
- rejected execution
- account snapshot

Engine 额外维护：

- corePosition
- tPosition
- tSellablePosition
- open T trade lots
- daily trade counters
- blocked action reasons
- Trade Ledger

Core Position 永远不被 T action 直接修改。

## 3. Causal State Construction

当前 bar t 的 policy 只读取：

- 当前 observedReferencePrice
- 当前 volume
- 当前及历史 causal returns
- 当前及历史 causal volatility/momentum
- causal trendRegime
- causal momentumPhase
- 当前 portfolio/T+1 state

禁止：

- future high/low/close/volume
- synthetic OHLC
- future evaluation window 回流到 action
- fabricated order-book fields

当前实现使用 price/volume 可追溯字段构造 V1 causal state。V2 L2/order-flow 字段保持可选扩展，不回填 V1 缺失字段。

## 4. Signal and Execution Timing

固定规则：

signal at current bar t
→ execution at next observed bar t+1

实现行为：

1. 在 t 构造 state。
2. 策略产生 action request。
3. action request 暂存，不在 t 成交。
4. 在 t+1 使用统一 PaperExecutionEngine 执行。
5. t+1 缺失时记录未执行/阻塞，不回填价格。

## 5. Strategy Implementations

已实现 strategy registry：

### BUY_HOLD

始终 WAIT，仅更新 mark-to-market equity，作为不做 T 参照。

### FIXED_POSITIVE_T

固定、可版本化的正向 T 研究策略：

- 在允许的正向状态下申请 REDUCE_T_x。
- 达到回补条件后申请 REBUILD_T_x/REBUILD_T_FULL。
- 只操作 T Position。

### FIXED_REVERSE_T

固定、可版本化的反向 T 研究策略：

- 在下降/反弹条件下申请 REDUCE_T_x。
- 价格回落后申请 REBUILD_T_x/REBUILD_T_FULL。
- 不主动减少 Core Position。

### BIDIRECTIONAL_T

- UPTREND：评估正向 T。
- DOWNTREND：评估反向 T。
- RANGE：按同一版本化配置评估机会。
- 冲突或证据不足时 WAIT。

### EXPERT_PRIOR

使用 capital flow、momentum exhaustion、trend breakout 和 range reversal 等 candidate pattern。

Expert Prior 默认只记录 candidate event；实际 action mapper 必须显式注入并版本化。candidate pattern 不自动成为生产 SELL/REBUILD 规则。

## 6. Canonical Action and Position Rules

支持：

- WAIT
- HOLD
- REDUCE_T_5
- REDUCE_T_8
- REDUCE_T_10
- REDUCE_T_15
- REDUCE_T_20
- REBUILD_T_5
- REBUILD_T_10
- REBUILD_T_FULL
- BLOCKED_ACTION

REDUCE_T_x 的比例分母固定为 action-time tPosition。REBUILD_T 只能回补此前可追溯的 T 减仓额度。

当天买入的 T shares 不增加当天 tSellablePosition；跨交易日后才可按 T+1 规则恢复可卖状态。

## 7. Trade Ledger

每个 T action 至少记录：

- trade_id
- timestamp
- signal_timestamp
- execution_timestamp
- state
- action
- sell_price
- buyback_price
- shares
- profit
- cost_change
- outcome
- failure_reason
- opportunity_type
- momentum_phase

支持 outcome：

- SUCCESSFUL_REBUY
- FAILED_REBUY
- PARTIAL_REBUY
- MISSED_REBUY
- UNRESOLVED
- BLOCKED_ACTION

未完成回补不计入已完成 T Profit，并保留 UNRESOLVED 状态。

## 8. Report Contract

每个策略 report 包含：

- initialEquity
- endingEquity
- totalReturn
- tProfit
- costReduction
- maximumDrawdown
- avoidedDrawdown
- failedRebuyRisk
- missedTrendRisk
- tSuccessRate
- profitFactor
- averageTReturn
- tradeCount
- completedTradeCount
- unresolvedTradeCount
- blockedActionCount
- candidateEvents
- tradeLedger
- equityPath

结果评价遵守 V0.12.24.1 Metric Contract。当前实现不自动选择策略 winner，不修改 Reward Contract。

## 9. Tests Added

专项测试覆盖：

- 五个 strategy report 均可建立。
- signal 与 next-bar execution 时序。
- T Position sizing 与 100-share rounding。
- Core Position 不被 T action 修改。
- T+1 下当天回补 shares 不立即进入 tSellablePosition。
- Expert Prior candidate pattern 与 action mapper 分离。

测试 fixture 不代表 DATA-07 历史结果；未执行真实历史 benchmark。

## 10. Explicit Non-goals

本阶段禁止：

- 执行 DATA-07 历史回测。
- 生成 benchmark result artifact。
- 生成 Dataset 或 replay dataset。
- 修改 Canonical Schema。
- 修改 Reward Contract。
- 生成 Value-Q target。
- RL training。
- 修改生产交易逻辑。

## Final Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
