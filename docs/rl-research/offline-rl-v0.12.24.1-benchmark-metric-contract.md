# OFFLINE RL V0.12.24.1 — Historical T Benchmark Metric Contract

Contract date: 2026-10-05

本文件只冻结 Historical T Benchmark 的评价指标、定义、分母、时间边界和缺失值处理。不执行回测，不生成结果，不生成 Dataset，不生成 Value-Q target，也不进行 RL training。

## Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Metric Contract Principles

- 所有 baseline 使用相同的 DATA-07 observation sequence、Core/T Position Model、T+1 约束和 next-bar execution。
- 指标只评价已发生或已明确不可执行的 execution event；不得使用未来结果生成 action。
- 每个指标必须记录 baseline、configuration、window、timestamp range 和 metric version。
- 不把 unresolved outcome 当作成功、失败或零收益。
- BUY_HOLD、Fixed Positive T、Fixed Reverse T、Bidirectional T 和 Expert Prior 必须使用同一指标定义。
- 指标是 evaluation contract，不等同于 Reward Contract，也不改变 Reward 公式。

## 2. Evaluation Unit and Windows

### 2.1 Trade Evaluation Unit

一个 T evaluation unit 至少包含：

- signal timestamp
- execution timestamp
- action
- requested quantity
- executed quantity
- entry/reference price
- exit/rebuy price（如有）
- fees and slippage（如 execution cost 可验证）
- T position before and after action
- outcome status

Core Position 的变化不得作为 T Profit 或 T Success Rate 的来源。

### 2.2 Frozen Windows

- 15 bars：Short T opportunity window
- 30 bars：Intraday T opportunity window
- End Session：当日结果窗口
- Next Session：跨日风险窗口

窗口只用于 outcome evaluation。窗口内容不得回流到 signal 或 action decision。

## 3. Return Metrics

### 3.1 Total Return

定义：

在指定 evaluation window 或完整 benchmark period 内，研究账户的净资产变化相对于初始研究账户价值的比例。

要求：

- 包含已实现和按统一 mark-to-market 规则计算的未实现变化。
- 包含可验证的交易成本。
- 不把不同 baseline 的初始资金或初始持仓差异隐藏在指标中。
- 同时记录 absolute return 和 percentage return。

字段：

- totalReturnAmount
- totalReturnRate
- initialPortfolioValue
- finalPortfolioValue

### 3.2 T Profit

定义：

由 T Position 的 REDUCE_T 与对应 REBUILD_T execution 产生的、扣除可验证交易成本后的归因收益。

要求：

- 只归因于 T Position。
- 未完成回补的减仓不得自动计为正 T Profit。
- failed rebuy、missed rebuy 和 unresolved outcome 必须单独记录。
- BUY_HOLD 的 T Profit 固定为零或 NOT_APPLICABLE，不能伪造 T 交易。

字段：

- tProfitAmount
- tProfitRate
- completedTUnits
- unresolvedTUnits

### 3.3 Cost Reduction

定义：

T 活动对 T Position 及研究账户有效成本基础的改善，必须与实际执行数量、价格和成本记录关联。

至少记录：

- initialEffectiveCost
- finalEffectiveCost
- costReductionAmount
- costReductionRate

Core Position 不因 T action 被重新估算为已交易成本。若成本基础无法由数据和账户规则可靠推导，指标状态为 UNAVAILABLE，而不是估算。

## 4. Risk Metrics

### 4.1 Maximum Drawdown

定义：

从历史峰值 portfolio value 到其后最低 portfolio value 的最大峰谷跌幅，使用统一 mark-to-market 序列。

同时记录：

- peakTimestamp
- troughTimestamp
- drawdownAmount
- drawdownRate

### 4.2 Avoided Drawdown

定义：

在可验证的 T 减仓后，相对于保持对应 T Position 不变的参考路径，因价格下行而避免的损失。

要求：

- 必须指定 comparison baseline。
- 不得把事后价格下跌自动归因于 action 的正确性而忽略 execution timing。
- 只评价 action 已执行且数量可追溯的部分。

字段：

- avoidedDrawdownAmount
- avoidedDrawdownRate
- comparisonBaseline
- attributionStatus

### 4.3 Failed Rebuy Risk

定义：

T 减仓后，在冻结 evaluation window 内未能按执行约束完成预期回补，导致 T Position 未恢复或成本/收益恶化的风险。

记录：

- failedRebuyCount
- failedRebuyRate
- failedRebuyLoss
- failureReason

失败原因必须区分：

- price moved away
- next-bar unavailable
- T+1 constraint
- insufficient sellable position
- missing required data
- other execution block

### 4.4 Missed Trend Risk

定义：

T 减仓后，价格沿原趋势继续运行，造成无法及时回补或相对保持仓位的机会损失。

要求：

- 与 Failed Rebuy Risk 分开统计。
- 不把所有未回补都标记为 missed trend。
- 必须记录 evaluation window 和 comparison path。

字段：

- missedTrendCount
- missedTrendRate
- missedTrendLoss
- trendRegime
- momentumPhase

## 5. T Quality Metrics

### 5.1 T Success Rate

定义：

在已完成且可评价的 T units 中，达到预先定义成功条件的 units 占比。

公式边界：

成功条件必须在 run configuration 中冻结，并至少考虑交易成本、回补状态和评价窗口。

分母不得包含：

- unresolved outcome
- BLOCKED_ACTION
- 缺失关键执行字段的 unit

字段：

- successfulTCount
- evaluableTCount
- tSuccessRate
- successDefinitionVersion

### 5.2 Profit Factor

定义：

可评价 T units 的总盈利除以总亏损绝对值。

边界：

- 盈利和亏损必须采用同一成本口径。
- 无亏损样本时不得输出无限值；应输出 NO_LOSS_OBSERVED 并保留原始计数。
- 无可评价 T unit 时输出 NOT_APPLICABLE。

字段：

- grossProfit
- grossLossAbsolute
- profitFactor
- evaluableTCount

### 5.3 Average T Return

定义：

每个可评价 T unit 的扣费后归因收益率的算术平均值。

要求：

- 明确以 executed quantity、投入金额或 T position notional 为分母。
- 该分母必须在 run configuration 中固定。
- 不把未完成回补的 unit 当作已完成 T Return。

字段：

- averageTReturn
- medianTReturn
- returnDenominator
- evaluableTCount

## 6. Opportunity Attribution

每个可评价 outcome 必须保留以下归因维度：

### 6.1 Opportunity Type

- Capital Flow Spike + Momentum Exhaustion
- Technical Overbought Only
- Trend Breakout
- Range Reversal
- UNAVAILABLE

Opportunity Type 是 candidate attribution label，不是自动 action signal。

### 6.2 Momentum Phase

- TREND_ACCELERATION
- TREND_MATURE
- MOMENTUM_EXHAUSTION
- REVERSAL_CONFIRMED
- UNAVAILABLE

Momentum Phase 只能使用 action time 可得的状态特征生成；不得使用 outcome window 反向标注 action。

### 6.3 Action

记录 Canonical Action V1：

- WAIT
- HOLD
- REDUCE_T_5 / REDUCE_T_8 / REDUCE_T_10 / REDUCE_T_15 / REDUCE_T_20
- REBUILD_T_5 / REBUILD_T_10 / REBUILD_T_FULL
- BLOCKED_ACTION

同时记录 requestedQuantity、executedQuantity、executionStatus 和 blockedReason。

### 6.4 Outcome

Outcome 必须从以下枚举中选择，并保留 evaluation window：

- SUCCESSFUL_REBUY
- FAILED_REBUY
- MISSED_REBUY
- AVOIDED_DRAWDOWN
- MISSED_TREND
- NO_ACTION
- UNRESOLVED
- NOT_APPLICABLE

一个 outcome 可以同时带有 primaryOutcome 和 secondaryRiskFlags，但不得重复计数为多个独立 T trades。

## 7. Aggregation Contract

结果至少按以下维度聚合：

- baseline
- T size
- trendRegime
- momentumPhase
- opportunityType
- action
- evaluation window
- calendar/session boundary

每组同时输出：

- sample count
- evaluable count
- unavailable count
- unresolved count
- metric value
- metric status

小样本不得被描述为稳定优势；不得仅依据单一指标自动选择 baseline winner。

## 8. Null, Missing and Unresolved Rules

- 缺失字段输出 UNAVAILABLE。
- 下一 bar 缺失输出 NO_EXECUTION 或 BLOCKED_ACTION。
- 评价窗口不完整输出 UNRESOLVED。
- 不得用零填充替代缺失收益、风险或交易成本。
- 所有指标必须保留原始计数和 exclusion reason。

## 9. Contract Versioning

每份未来 benchmark result 必须记录：

- metricContractVersion = V0.12.24.1
- canonicalSchemaVersion = CANONICAL_V1
- baselineVersion
- DATA-07 source identity/hash
- execution timing version
- evaluation window version
- cost/accounting configuration version

Metric Contract 的修改必须产生新版本，不得静默重写历史结果。

## 10. Explicit Non-goals

本文件不授权：

- 执行历史回测。
- 生成 benchmark result。
- 生成 Dataset 或 replay dataset。
- 修改 Reward Contract。
- 生成 Value-Q target。
- RL training。
- 修改 Canonical Schema 或生产交易逻辑。

## Final Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
