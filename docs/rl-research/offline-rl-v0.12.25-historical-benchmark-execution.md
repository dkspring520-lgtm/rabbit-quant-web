# OFFLINE RL V0.12.25 — DATA-07 Historical T Benchmark Execution

Execution protocol date: 2026-10-05

基于：

- offline-rl-v0.12.24.2-benchmark-engine-implementation.md
- offline-rl-v0.12.24.3-engine-validation-plan.md

本文件定义第一阶段 DATA-07 Historical T Benchmark 的正式执行协议。当前文档创建不等于已经执行 DATA-07 回测；只有在 DATA-07 source identity、路径、hash、时间范围和初始账户配置完成 preflight 后，才允许运行。

## Gate

ENGINE_VALIDATION = PASS_SYNTHETIC_ONLY
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Execution Scope

第一阶段只运行以下三个策略：

1. BUY_HOLD
2. BIDIRECTIONAL_T
3. EXPERT_PRIOR

不运行 Fixed Positive T 和 Fixed Reverse T，除非后续任务单独批准扩展 matrix。

## 2. DATA-07 Preflight Contract

执行前必须登记：

- source path
- source dataset identity
- source SHA-256 hash
- symbol：601899.SH
- observed time range
- row/bar count
- timestamp ordering status
- duplicate timestamp count
- missing price count
- missing volume count
- DATA-07 schema version

如果 DATA-07 source path、hash 或 schema 无法确认，执行状态必须为 BLOCKED_DATA_SOURCE，不得使用临时文件、旧结果或推测路径替代。

## 3. Canonical Runtime Configuration

统一调用：

lib/rl-research/historical-t-benchmark-engine.mjs

运行时必须使用：

- Canonical Trading State V1
- PaperExecutionEngine
- current-bar signal / next-bar execution
- A-share T+1
- 100-share lot rounding
- fee、minimum commission、stamp duty、slippage
- Core/T Position Model

研究场景参数必须显式登记，例如：

- corePosition：34000
- tPosition：3100
- totalPosition：37100
- initialCash
- initialAverageCost

上述账户场景不是 DATA-07 历史账户事实，必须标记为 SYNTHETIC_RESEARCH_PORTFOLIO。

## 4. Strategy Runs

### 4.1 BUY_HOLD

- 每个 observed bar 更新 mark-to-market equity。
- 不产生 T action。
- 作为长期持有对照组。

### 4.2 BIDIRECTIONAL_T

- UPTREND：评估正向 T。
- DOWNTREND：评估反向 T。
- RANGE：按固定、版本化的机会配置评估双向 T。
- 冲突、数据不足、cooldown 或 open T cycle 时 WAIT/BLOCKED_ACTION。
- 所有 REDUCE/REBUILD 只作用于 T Position。

### 4.3 EXPERT_PRIOR

- 记录 capital flow spike、momentum exhaustion、trend breakout、range reversal 等 candidate attribution。
- 使用显式、版本化的 action mapper。
- 没有 mapper 时只记录 candidate event，不产生交易。
- 不得将 Expert Pattern 直接当作无条件 SELL 或 REBUILD 规则。

## 5. Execution Semantics

每个 bar 按以下顺序处理：

1. 读取当前 bar t 和历史 causal state。
2. 生成 signal/action request。
3. 暂存 action，不在 t 成交。
4. 在 next observed bar t+1 通过 PaperExecutionEngine 执行。
5. 更新现金、总持仓、Core/T 持仓、T+1 可卖数量和 Trade Ledger。
6. 使用 observed price 更新 equity path。

禁止：

- 使用 signal bar 后才知道的 high/low/close/volume。
- 回填缺失 next bar 的成交价格。
- 卖出 corePosition。
- 将当天回补 shares 当天重新卖出。
- 生成 synthetic OHLC 或 fabricated L2。

## 6. Required Trade Ledger

每个 T action 必须记录：

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

未完成回补必须保持 UNRESOLVED 或 MISSED_REBUY，不得计入已完成 T Profit。

## 7. Required Benchmark Metrics

每个策略独立输出：

### Return

- Total Return
- T Profit
- Cost Reduction

### Risk

- Maximum Drawdown
- Avoided Drawdown
- Failed Rebuy Risk
- Missed Trend Risk

### T Quality

- T Success Rate
- Profit Factor
- Average T Return

### Attribution

- Opportunity Type
- Momentum Phase
- Action
- Outcome
- 15 bars
- 30 bars
- End Session
- Next Session

结果必须区分 completed、unresolved、blocked 和 unavailable 样本，不得用零值掩盖缺失结果。

## 8. Output Boundary

正式执行获准后，结果应写入独立的 benchmark result 目录，并包含：

- run manifest
- source identity/hash
- strategy configuration
- benchmark metrics
- Trade Ledger
- equity path
- reproducibility hash

本阶段文档创建不生成上述结果文件。不得覆盖旧 artifact，不得修改 DATA-07，不得生成 Dataset。

## 9. Execution Acceptance Criteria

正式结果只有在以下全部满足时才可标记 GENERATED：

- DATA-07 source preflight PASS。
- Canonical State V1 unchanged。
- Engine validation remains PASS_SYNTHETIC_ONLY。
- BUY_HOLD、BIDIRECTIONAL_T、EXPERT_PRIOR 均使用同一 execution environment。
- next-bar execution verified。
- T+1 verified。
- Core/T invariants verified。
- Trade Ledger complete。
- Benchmark Metrics complete。
- No Value-Q target、Dataset 或 RL training。

任何一个关键项失败，保持：

BACKTEST_RESULT = NOT_GENERATED

## 10. Explicit Non-goals

禁止：

- Value-Q target。
- Dataset 或 replay dataset 生成。
- RL Training。
- Reward 修改。
- Canonical Schema 修改。
- 生产交易逻辑修改。
- 自动选择 benchmark winner。
- 自动解锁 Value-Q gate。

## Final Gate

ENGINE_VALIDATION = PASS_SYNTHETIC_ONLY
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
