# OFFLINE RL V0.12.23.6.2 — Canonical Trading Schema Specification

Audit date: 2026-10-05

## Gate

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只冻结历史 T Benchmark 实现所需的 Canonical Schema，不执行回测、不生成 Dataset、Value-Q target 或模型。

## 1. Canonical State Schema

### Market State

必备字段：

- observedReferencePrice：来自现有 marketState.price 的研究价格字段。
- return：仅使用当前和历史 observation 计算。
- volatility：仅使用当前和历史 observation 计算。
- volume：仅使用 action-time 可用成交量字段。
- momentum：由当前/历史数据计算的动量候选。
- trendRegime：UPTREND、DOWNTREND、RANGE。
- momentumPhase：TREND_ACCELERATION、TREND_MATURE、MOMENTUM_EXHAUSTION、REVERSAL_CONFIRMED 或 UNKNOWN。

可选 context：

- VWAP 或已有因果 VWAP context。
- priceLocation。
- approved causal market context features。

限制：

- observedReferencePrice 不声明为 verified close、last trade 或 executable price。
- OHLC/ATR 只有在 source semantics 和字段可用性通过审计后才能使用。
- OFI、bid、ask、mid、盘口失衡等缺失字段保持 unavailable，不得补造。
- future price、future volume、terminal outcome、forward return 不得进入 state。

### Portfolio State

必备字段：

- cash。
- totalPosition。
- sellablePosition。
- todayBought。
- todaySold。
- averageCost。
- portfolioValueResearch。

portfolioValueResearch 候选公式：

cash + totalPosition * observedReferencePrice

该值仅为 research valuation，不是 verified market mark。

### Core/T Position Model

策略层候选拆分：

- corePosition：长期持仓，默认不因短期 T 信号清仓。
- tPosition：允许用于 T 的机动仓位。
- totalPosition = corePosition + tPosition。
- availableTPosition：在 sellablePosition 和 T 仓位规则下实际可用于 T 的数量。

约束：

- corePosition、tPosition 必须有明确来源或由 approved scenario 初始化。
- 历史 Replay 没有该拆分时，不得回填为历史事实。
- totalPosition、sellablePosition、todayBought 必须保持 PaperExecutionEngine/T+1 语义。
- core/t split 只能作为 benchmark scenario metadata 或 future approved schema，不得伪造历史账户记录。

## 2. Canonical Action Space

动作必须同时保留 actionType、requestedQuantity、executedQuantity、executionStatus、blockedReason 和 feasibility。

### WAIT

不操作，保持账户和持仓状态。

### HOLD

保持当前持仓，不新增交易请求。HOLD 与 WAIT 的映射需要在 benchmark implementation 中固定，不能在不同 baseline 间变化。

### SELL_T_5 / SELL_T_8 / SELL_T_10 / SELL_T_15 / SELL_T_20

卖出指定比例的可用 T 仓或 approved eligible position。

比例仅是 action quantity rule 候选，必须经过：

- sellablePosition 检查。
- corePosition protection 检查。
- 最小交易单位检查。
- T+1 检查。
- execution timing 检查。

### BUY_BACK_5 / BUY_BACK_10 / BUY_BACK_FULL

用于回补已卖出的 T 仓或 approved eligible position。

不得将未来回补结果提前写入当前 action，也不得把不存在的回补作为 observed action。

### BLOCKED_ACTION

保留原 actionType，同时记录 executionStatus 和 blockedReason；不得改写成普通 HOLD 或 executed losing action。

### Canonical Mapping Boundary

历史 action WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL 与本 Canonical Action Space 的映射尚未作为历史事实批准。Benchmark implementation 必须提供显式 mapping table 和 coverage report，不能静默合并。

## 3. Execution Timing

执行时间 Contract 候选必须固定为一个明确规则：

- NEXT_AVAILABLE_OBSERVATION_PRICE，或
- NEXT_OBSERVATION_OPEN（只有真实 open 字段可用且语义已验证时）。

当前推荐进入 implementation review 的边界：NEXT_AVAILABLE_OBSERVATION_PRICE。

禁止：

- 使用当前 bar 之后才知道的 high/low/close。
- 使用未来区间极值成交。
- 使用不可观测价格回填 fill。
- 对不同 baseline 使用不同 timing 规则。

事件顺序必须可审计：

current state → action request → next available execution → post-execution account state。

## 4. Evaluation Window

必须预先固定结果窗口，候选为：

- 15 bars。
- 30 bars。
- End Session。
- Next Session。

每个 SELL_T/BUY_BACK 事件必须在固定窗口内分类：

- SUCCESSFUL_REBUY。
- FAILED_REBUY。
- MISSED_REBUY。
- AVOIDED_DRAWDOWN。
- EARLY_EXIT_OR_MISSED_TREND。

当前不选择最终窗口：

EVALUATION_WINDOW_SELECTED = NONE
EVALUATION_WINDOW_STATUS = PROPOSAL_ONLY

窗口必须遵守：

- 时间顺序。
- session boundary。
- T+1。
- terminal/open position。
- 不把 evaluation outcome 送回 action-time feature。

## 5. Feature Availability

### Verified/conditionally available candidates

- observedReferencePrice：字段 lineage 可追踪，价格语义受限。
- volume：若当前 source record 有效则可用。
- return/rolling price context：可由当前及历史字段因果计算。
- trend/momentum context：需固定版本和输入窗口。

### Blocked or source-dependent candidates

- OHLC-derived ATR：source semantics/availability 必须先验证。
- bid。
- ask。
- mid。
- spread。
- OFI。
- order-book imbalance。
- trade direction from unavailable tick data。

### Feature rules

- 缺失字段标记 unavailable，不默认填零。
- 不创建 synthetic OHLC。
- 不创建 fabricated bid/ask/mid。
- 不读取未来 feature。
- 不将 Expert Pattern 直接作为 action rule。

## 6. Expert Pattern Separation

Expert Pattern 只能作为 candidate feature pattern 或 candidate opportunity classification，例如：

急拉 + 成交异常 + MACD 动能下降。

它不得直接成为：

- 固定 SELL 信号。
- 固定 BUY_BACK 信号。
- 自动交易规则。
- reward penalty。

未来架构必须允许 Expert Pattern 与 Learned Policy 并存，并分别保留：

- pattern evidence。
- learned policy output。
- action feasibility。
- execution result。

## 7. Human Review Gate

必须人工批准：

- Canonical State Schema。
- Core/T Position Model。
- Canonical Action Mapping。
- Execution Timing。
- Evaluation Window。
- Feature Availability。
- Expert Pattern 与 Learned Policy 的组合方式。

## Final Gate

BACKTEST_ENGINE = VALIDATION_ONLY
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
