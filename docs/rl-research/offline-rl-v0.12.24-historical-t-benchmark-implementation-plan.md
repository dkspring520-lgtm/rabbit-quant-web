# OFFLINE RL V0.12.24 — Historical T Benchmark Implementation Plan

Plan date: 2026-10-05

基于：offline-rl-v0.12.23.6.7-canonical-schema-final-approval.md

本文件定义 Historical T Benchmark 的实现范围、基准策略、执行约束和评价输出。当前只创建 implementation plan，不执行历史回测，不生成结果文件、Dataset 或 Value-Q target。

## Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Implementation Objective

使用 DATA-07 对以下五个研究基准进行同口径比较：

1. BUY_HOLD baseline
2. Fixed Positive T baseline
3. Fixed Reverse T baseline
4. Bidirectional T baseline
5. Expert Prior baseline

目标是测量双向 T 是否相对长期持有和单向规则产生可解释的增量收益、成本改善或回撤改善，而不是训练模型或批准交易策略。

## 2. DATA-07 Input Contract

### Source

- Dataset：DATA-07
- Symbol：601899.SH
- Granularity：1 minute-like historical observations
- Source identity、时间范围和 hash 必须从现有 DATA-07 contract 读取并写入 benchmark run manifest。

### Allowed V1 Inputs

- timestamp
- observedReferencePrice
- volume
- causal returns
- causal volatility and momentum
- causal VWAP context（仅在来源和语义已验证时）
- trendRegime
- momentumPhase
- synthetic research portfolio state

DATA-07 缺失的 OHLC、盘口或成交字段不得通过 current price 复制、合成或未来数据回填。若所需字段 unavailable，baseline 必须显式记录不可用原因。

### Data Split and Ordering

- 按 timestamp 严格升序处理。
- 每个 baseline 使用相同的 DATA-07 observation sequence。
- 不允许随机打乱、跨窗口泄漏或把 evaluation window 反向注入 action decision。
- 每个 baseline 使用独立的 research account，避免状态互相污染。

## 3. Canonical State and Portfolio Setup

所有 baseline 使用 Canonical Trading State V1：

- market state
- cash
- totalPosition
- corePosition
- tPosition
- sellablePosition
- todayBought
- todaySold
- averageCost
- portfolioValueResearch

### Core/T Rules

- corePosition 是长期持仓，不主动交易。
- 所有 T action 只能作用于 tPosition。
- REDUCE_T_x 和 REBUILD_T_x 的比例分母固定为 action-time tPosition。
- totalPosition 只用于账户一致性检查，不作为 T sizing denominator。
- 34000 core shares + 3100 T shares 是可复现的 research scenario metadata，不是 DATA-07 历史账户事实。

### T+1 Rules

- 当日买入数量进入 todayBought。
- todayBought 在当日不能成为 sellablePosition。
- SELL/REDUCE 只能使用 sellablePosition 中属于可执行 T 仓的数量。
- 回补动作只能回补此前可追溯的 T 减仓额度。
- 不允许通过 baseline 隐式降低长期 core position。

## 4. Execution Contract

### Signal and Fill Timing

- signal 读取当前 bar t 及其以前的数据。
- action request 在 t 产生。
- execution 使用 next bar t+1 的可观察执行价格。
- next bar 不存在时记录 BLOCKED_ACTION 或 NO_EXECUTION，不回填价格。
- 禁止 future high、future low、future close、区间极值或不可观察价格成交。

### Action Set

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

每个 action event 必须记录 signal timestamp、execution timestamp、requestedQuantity、executedQuantity、executionStatus、blockedReason 和 source baseline。

## 5. Baseline Definitions

### 5.1 BUY_HOLD Baseline

目的：提供不做 T 的长期持有参照。

规则：

- 初始化 approved research portfolio。
- 后续不产生 REDUCE 或 REBUILD action。
- 只按 observation 更新 mark-to-market、portfolio value 和风险指标。
- 不把 BUY_HOLD 伪装成历史真实账户。

该 baseline 用于回答：T 策略是否产生相对持有的增量价值。

### 5.2 Fixed Positive T Baseline

目的：测量仅在上涨/正向机会环境下管理 T 仓的固定规则基线。

规则边界：

- 只允许 REDUCE_T_x 和对应的 REBUILD_T_x。
- 不交易 corePosition。
- 触发条件、T size、回补条件必须写入 immutable run config。
- 不在本计划中选择最优阈值；每个阈值作为独立 configuration variant。
- 所有变体使用相同 next-bar execution 和 T+1 约束。

推荐配置矩阵：T size = 5%、8%、10%、15%、20%。

### 5.3 Fixed Reverse T Baseline

目的：测量仅在下降/反转风险环境下管理 T 仓的固定规则基线。

规则边界：

- 只允许 REDUCE_T_x 和对应的 REBUILD_T_x。
- 只能减少 T position，不得卖出 corePosition。
- 触发条件、T size、回补条件必须版本化记录。
- 不把“下跌预测正确”直接等同于交易成功；结果必须通过 fill 和 outcome window 统计。

推荐配置矩阵：T size = 5%、8%、10%、15%、20%。

### 5.4 Bidirectional T Baseline

目的：测量上涨、下降和震荡环境下的双向 T 规则组合。

规则边界：

- UPTREND / momentum phase 允许评估正向 T 候选。
- DOWNTREND / reversal phase 允许评估反向 T 候选。
- RANGE 允许按同一版本化配置评估正向或反向 T，但不得同时重复发出冲突 action。
- 冲突、低置信度、数据不足或执行不可行时优先 WAIT。
- 成功一次后不得自动连续交易；cooldown、daily T budget 和最大 T 次数必须在 run config 中显式记录。

该 baseline 仍是确定性 benchmark，不使用 Value-Q、RL policy 或未来结果。

### 5.5 Expert Prior Baseline

目的：评估用户经验模式作为研究先验时的基线价值。

候选 pattern 可包括：

- capital flow spike
- momentum exhaustion
- price-MACD divergence
- trend acceleration
- range reversal

边界：

- Expert Pattern 只能作为 candidate feature/pattern，并保留 lineage、版本和证据。
- 不得把 pattern 直接硬编码成无条件 SELL 或 REBUILD action。
- Expert Prior 必须经过 Canonical State、Canonical Action、T+1 和 next-bar execution guard。
- pattern 不可计算时必须标记 unavailable，不得使用 synthetic indicator。
- 该 baseline 与 learned policy、未来 Value-Q target 保持独立。

## 6. Benchmark Matrix

每个 baseline 至少运行以下独立配置：

| Baseline | T size variants | Regime scope | T action |
|---|---|---|---|
| BUY_HOLD | N/A | all observations | none |
| Fixed Positive T | 5/8/10/15/20% | positive/uptrend | REDUCE_T + REBUILD_T |
| Fixed Reverse T | 5/8/10/15/20% | negative/downtrend | REDUCE_T + REBUILD_T |
| Bidirectional T | 5/8/10/15/20% | up/down/range | positive or reverse T |
| Expert Prior | versioned config | pattern availability | guarded canonical actions |

不根据单个结果自动选择 winner，不自动修改 Canonical Schema、Reward Contract 或生产逻辑。

## 7. Required Evaluation Outputs

实现完成后，每个 baseline 和 configuration variant 必须输出同一组指标。

### Return and Cost

- Total Return
- Annualized Return
- T Contribution
- Initial Cost
- Final Effective Cost
- Cost Reduction
- Cost Reduction %

### Risk

- Maximum Drawdown
- Peak-to-Trough
- Worst Failed T
- Avoided Drawdown
- Failed Rebuy Count
- Failed Rebuy Rate
- Missed Rebuy Count
- Missed Rebuy Rate
- Missed Trend Risk

### Trade Quality

- T Success Rate
- Win Rate
- Average T Profit
- Median T Profit
- Profit Factor
- Trade Count
- Trade Frequency
- Average Holding/Recovery Time

### Attribution

- result by UPTREND / DOWNTREND / RANGE
- result by momentum phase
- result by opportunity type
- result by T size
- result by 15 bars / 30 bars / End Session / Next Session window

指标必须区分观察结果、执行结果、失败回补和不可用输入；不得把 unresolved outcome 计为零收益或成功交易。

## 8. Reproducibility and Audit Records

implementation runner 必须记录：

- DATA-07 source identity/hash
- baseline name and version
- configuration hash
- Canonical Schema version
- action and fill timing version
- portfolio scenario metadata
- execution counts and blocked reasons
- evaluation window definitions
- output report hash

每个 baseline 使用独立状态副本。相同输入、配置和版本必须产生相同摘要 hash；任何配置变化必须生成新的 run identity。

## 9. Implementation Sequence

1. 建立 DATA-07 read-only adapter。
2. 建立 Canonical State V1 adapter。
3. 建立独立 research account 和 Core/T accounting。
4. 建立 next-bar execution adapter 和 T+1 validator。
5. 先实现 BUY_HOLD，再实现 Fixed Positive T、Fixed Reverse T。
6. 实现 Bidirectional T 的冲突、cooldown 和 daily budget guard。
7. 最后接入 Expert Prior candidate pattern adapter。
8. 对五个 baseline 运行 schema、leakage、T+1 和 deterministic replay checks。
9. 通过人工检查后，才允许进入单独的 Historical Benchmark Execution 阶段。

本计划结束时不产生 benchmark result；实现和执行必须由后续明确任务单独授权。

## 10. Hard Stop and Non-goals

禁止：

- 生成 Value-Q target。
- RL training。
- Dataset 或 replay dataset 生成。
- 修改 Canonical Schema。
- 修改 Reward Contract。
- 修改生产交易逻辑。
- 使用未来数据生成 action。
- 把 Expert Prior 变成无条件交易规则。

## Final Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
