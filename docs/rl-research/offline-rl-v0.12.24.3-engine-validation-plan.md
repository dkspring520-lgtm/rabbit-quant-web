# OFFLINE RL V0.12.24.3 — Historical T Benchmark Engine Validation Plan

Validation plan date: 2026-10-05

基于：

- offline-rl-v0.12.23.6.7-canonical-schema-final-approval.md
- offline-rl-v0.12.24.2-benchmark-engine-implementation.md

本文件定义 Historical T Benchmark Engine 的交易语义验证方案。验证使用隔离的 synthetic scenarios，不读取 DATA-07，不执行正式历史回测，不生成 benchmark result artifact。

## Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Validation Scope

验证对象：

- unified PaperExecutionEngine integration
- Canonical State V1 mapping
- Core/T Position Model
- Canonical Action V1
- current-bar signal / next-bar execution
- A-share T+1 inventory
- 100-share lot rounding
- fee, stamp duty and slippage accounting
- Trade Ledger lineage
- Opportunity Attribution fields

Synthetic validation 只证明 engine semantics。通过 synthetic scenarios 不代表 DATA-07 策略有效，也不代表允许生成 Value-Q target 或训练 RL。

## 2. Synthetic Scenario Contract

每个 scenario 必须包含：

- scenarioId
- symbol
- ordered bars
- timestamp/date/time
- observedReferencePrice or price
- volume when the scenario tests volume attribution
- initialCash
- corePosition
- tPosition
- initialAverageCost
- cost configuration
- expected signal timestamp
- expected next-bar execution timestamp
- expected action and quantity
- expected ledger outcome

约束：

- synthetic bars 只用于 engine fixture，不得写入 DATA-07。
- 不生成 synthetic OHLC 来填补 DATA-07 缺失字段。
- 所有 action decision 只能读取 scenario 当前 bar 和历史 bar。
- outcome window 只用于验证结果，不得进入 action decision。

## 3. Scenario A — Uptrend Positive T

### Purpose

验证上涨趋势下的 Fixed Positive T / Bidirectional T 是否只减少 T Position，并在 next bar 执行。

### Fixture Shape

- price 连续上升。
- return_5m 为正。
- volume 保持可用。
- corePosition 固定，例如 3400。
- tPosition 固定，例如 1000。
- 初始所有既有持仓可卖。

### Expected Flow

1. 当前 bar t 生成 REDUCE_T_10 candidate/action。
2. t 不成交。
3. next bar t+1 以 next-bar observed price 执行 SELL。
4. 执行数量为 floor(1000 × 10%) 并按 100 股取整，即 100 股。
5. corePosition 仍为 3400。
6. tPosition 变为 900，Trade Ledger 记录卖出事件。
7. 后续回落条件满足时生成 REBUILD_T_FULL。
8. 回补在再次的 next bar 执行，并完成 T cycle outcome。

### Assertions

- signal timestamp 与 execution timestamp 不相同。
- execution timestamp 等于下一个 observed bar。
- sell price 使用 next bar fill price，不使用 signal bar price。
- requestedQuantity 和 executedQuantity 均可追溯。
- corePosition 未发生变化。
- Trade Ledger 包含 opportunity_type、momentum_phase、profit 和 cost_change。

## 4. Scenario B — Capital Flow Spike + Momentum Exhaustion Reverse T

### Purpose

验证放量推动后动能减弱的 candidate pattern 是否能够被记录为 opportunity attribution，并通过 Canonical Action / execution guard 进入反向 T 研究路径。

### Fixture Shape

- 前段价格上涨并伴随正常 volume。
- 某 bar 出现 volume spike。
- 随后价格仍处高位，但 causal return/momentum 相对前段减弱。
- 不提供或伪造 MACD、bid/ask、OFI；缺失字段必须保持 unavailable。
- 使用当前 V1 可用的 price/volume/causal momentum evidence。

### Expected Flow

1. candidate event 标记 capital flow spike。
2. candidate event 标记 momentum exhaustion 或等价的 causal weakening evidence。
3. candidate event 不直接绕过 Action Mapping 生成生产 SELL。
4. 经显式、版本化的 Expert Prior action mapper 后，才可产生 REDUCE_T_x candidate。
5. 实际 execution 仍然使用 next bar。
6. attribution 记录 Opportunity Type、Momentum Phase、Action 和 Outcome。

### Assertions

- candidate feature 与 executable action 保持独立 lineage。
- 缺失 MACD/盘口字段不被填零或合成。
- 反向 T 不触碰 corePosition。
- Trade Ledger 的 failure_reason、outcome 和 evaluation window 可追溯。
- 没有 mapper 时，Expert Prior 默认只记录 candidate event，不产生交易。

## 5. Scenario C — Failed Rebuy / Missed Trend Risk

### Purpose

验证卖出后价格继续上行时，engine 不伪造回补、不把未完成交易计为盈利，并记录 missed trend risk。

### Fixture Shape

- t bar 产生 REDUCE_T_x。
- t+1 执行 SELL。
- 后续价格持续上涨，不满足 REBUILD 条件。
- session 结束前没有完成回补。

### Expected Flow

1. 卖出事件进入 open T trade lot。
2. 未完成回补保持 UNRESOLVED 或 MISSED_REBUY，不计入 completed T Profit。
3. outcome evaluation 记录 missed trend risk。
4. sell_price、buyback_price、shares 和 failure_reason 保持明确。
5. ending equity 仍按 observed price mark-to-market，不虚构 liquidation。

### Assertions

- tProfit 不包含未回补交易。
- buyback_price 保持 null。
- ledger 不把 UNRESOLVED 计为 SUCCESSFUL_REBUY。
- missedTrendRisk 与 FailedRebuyRisk 分开统计。
- 没有未来数据回流到原始 action。

## 6. Scenario D — Continuous T Risk Control

### Purpose

验证连续机会下不会无限换手，并验证 daily T budget、cooldown、重复 action 抑制和状态重置边界。

### Fixture Shape

- 一个 session 内构造多个上涨、回落和再次上涨片段。
- 每个片段都可能产生 candidate opportunity。
- 至少包含一次成功 T、一次低利润或失败 T、一次 cooldown 期间的重复机会。
- 跨 trading day 追加新的 observed bars，用于验证 T+1 和 daily counter reset。

### Expected Flow

1. 成功一次后进入 RECHECK_STATE，而不是自动连续交易。
2. cooldown 期间重复 candidate 不产生重复执行。
3. daily T count 和 daily T volume 不超过 run configuration 上限。
4. 同一方向、同一机会窗口不重复创建多个 T cycle。
5. 新交易日重新计算 daily budget，但不提前释放当天买入的 T shares。
6. 失败回补进入风险记录，不自动扩大下一次仓位。

### Assertions

- trade count 不超过 configured max_daily_T_count。
- cooldown interval 内无重复 fill。
- daily volume 不超过 configured daily_t_volume。
- T Position sizing 仍以 action-time tPosition 为分母。
- Core Position 始终不参与连续 T 调整。
- ledger 能区分 duplicate suppression、cooldown、blocked action 和真实 failed rebuy。

如果 engine 只记录 daily counters 而未实际执行限制，本 scenario 必须标记 BLOCKED，不能声称 Continuous T Risk Control 已通过。

## 7. Cross-Scenario Semantic Assertions

### Core/T Separation

- totalPosition = corePosition + tPosition 在每个 fill 后保持一致。
- corePosition 不因 REDUCE_T 或 REBUILD_T 改变。
- action quantity 不以 totalPosition 或 corePosition 为分母。

### T+1

- todayBought 不在同一交易日进入 sellablePosition。
- 同日卖出不得使用当天回补 shares。
- 跨日后才可按 T+1 规则恢复可卖状态。

### Next-Bar Execution

- signal 使用 t。
- fill 使用 t+1。
- 缺失 t+1 时不回填价格。
- fill event 必须记录两个 timestamp。

### Quantity and Cost

- executed shares 是非负整数。
- T action 数量按 100-share lot round down。
- commission、minimum commission、stamp duty 和 slippage 与 PaperExecutionEngine 一致。
- SELL 侧印花税只计算一次。
- fee/slippage 不在 metric 或 reward 层重复扣除。

### Trade Ledger

- 每个 T action 有唯一 trade_id。
- signal、execution、sell、buyback、outcome lineage 完整。
- blocked action 与 completed losing trade 分开。
- unresolved outcome 不被计入成功率或 Profit Factor 的 completed denominator。

### Opportunity Attribution

- Opportunity Type 是 attribution，不是自动交易命令。
- Momentum Phase 使用 action time 可用字段。
- Action 记录 Canonical Action。
- Outcome 使用 Metric Contract 枚举。

## 8. Validation Result Rules

每个 scenario 输出：

- PASS
- BLOCKED
- FAIL

任何以下问题都必须将 engine validation 标记为 BLOCKED 或 FAIL：

- 读取未来字段决定 action。
- corePosition 被 T action 改变。
- T+1 被绕过。
- signal bar 成交。
- 数量未按 100 股取整。
- 费用或印花税重复/遗漏。
- Trade Ledger 缺少关键 lineage。
- unresolved outcome 被计入盈利。
- Expert Prior 直接绕过 mapper 生成硬编码交易。

通过 synthetic scenarios 只表示 engine contract validation 通过，不产生正式 benchmark result。

## 9. Execution Boundary

本计划允许：

- 创建 synthetic fixtures。
- 运行 engine unit/integration validation。
- 检查内存中的 report 和 Trade Ledger。
- 运行 npm test、npm run build 和 git diff --check。

本计划禁止：

- DATA-07 正式历史回测。
- 写入 benchmark result artifact。
- 生成 Dataset 或 replay dataset。
- 修改 Reward Contract。
- 生成 Value-Q target。
- RL training。
- 修改 Canonical Schema 或生产交易逻辑。

## Final Gate

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
