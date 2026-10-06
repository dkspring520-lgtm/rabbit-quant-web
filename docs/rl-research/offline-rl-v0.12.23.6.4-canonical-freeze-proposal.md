# OFFLINE RL V0.12.23.6.4 — Canonical Freeze Proposal

## Status

本文件只提出 Canonical State、Action、Position、Fill Timing、Evaluation Window 和 Feature Tier 候选，不执行回测、不生成 Benchmark Result、Dataset、Value-Q target 或训练模型。

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

## 1. State Schema Final Candidate

### A. Market State

V1 OHLCV/causal market candidate：

- timestamp。
- open。
- high。
- low。
- close。
- volume。
- return_1m。
- return_5m。
- return_15m。
- ATR。
- MACD。
- MACD_signal。
- MACD_histogram。
- MACD_hist_change。
- VWAP。
- VWAP_distance。
- volume_ratio。
- trend_state。
- momentum_phase。

数据边界：

- 只有真实存在且通过 source semantics 审计的字段才能进入 V1。
- Observed Reference Price 不自动改名为 close、last trade 或 executable price。
- 缺失 OHLC、ATR 或任何指标时不得使用未来值、默认值或 synthetic reconstruction 补齐。
- 所有字段必须只使用当前 observation 和历史 observations。

### B. Position State

核心候选字段：

- core_position。
- t_position。
- total_position。
- average_cost。
- sellable_position。
- today_buy。
- today_sell。
- cash。

核心关系候选：

total_position = core_position + t_position

但 core/t split 若历史 Replay 没有持久化，只能作为 approved benchmark scenario metadata，不能伪造为历史账户事实。

### C. Opportunity State

Opportunity 只作为状态/证据，不直接生成 SELL_SIGNAL：

- capital_flow_score。
- momentum_exhaustion_score。
- breakout_score。
- range_reversal_score。

机会分数必须保留来源、时间、版本和缺失状态；不得自动转换为交易 action。

STATE_SCHEMA_STATUS = PROPOSAL_ONLY

## 2. Action Mapping Candidate

为避免 BUY/SELL 与长期持仓管理混淆，提出 T 仓管理动作：

- WAIT。
- REDUCE_T_5。
- REDUCE_T_10。
- REDUCE_T_15。
- REDUCE_T_20。
- REBUILD_T_5。
- REBUILD_T_10。
- REBUILD_T_FULL。

数量语义候选：

REDUCE_T_x 的实际数量 = min(available T position, approved target-size quantity)

REBUILD_T_x 的实际数量必须受现金、最小交易单位、T+1 和已卖出 T quantity 约束。

必须保留：

- requestedQuantity。
- executedQuantity。
- executionStatus。
- blockedReason。
- feasibility。

历史 WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL 与上述 T action 的 mapping 尚未批准；不得静默合并。

ACTION_MAPPING_STATUS = PROPOSAL_ONLY

## 3. Position Model Candidate

真实场景候选：

- core_position = 34000。
- t_position = 3100。
- total_position = 37100。
- initial_average_cost = 31.5。

T size candidates：

- 5%。
- 8%。
- 10%。
- 15%。
- 20%。

必须保护：

- core position 不因短期信号默认清仓。
- T position 优先用于 REDUCE_T/REBUILD_T。
- sellable_position 不能超过 total_position。
- today_buy 与 today_sell 必须保留。
- T+1 不得被 benchmark 逻辑绕过。

POSITION_MODEL_STATUS = PROPOSAL_ONLY

## 4. Fill Timing Proposal

推荐进入人工 Review 的 V1 候选：

signal_time = t observation close/reference boundary
execution_time = t+1 observed bar open

即：

发现信号于 09:35，候选执行使用 09:36 open。

该规则的前提：

- 真实 open 字段存在且语义已验证。
- t+1 observation 存在。
- 没有未来 high/low fill。
- 不使用区间极值。
- 缺失 t+1 时不补造价格。

如果 open 语义无法证明，必须降级为 NEXT_AVAILABLE_OBSERVATION_PRICE，并保持明确的语义限制。

V2 L2/tick execution 作为未来独立 Contract，不在本阶段实现。

FILL_TIMING_STATUS = PROPOSAL_ONLY

## 5. Evaluation Window Proposal

不强制只选一个窗口，建议多窗口评价：

### Short T

15 bars：评估当天短期机会。

### Intraday T

30 bars：评估半小时级机会和回补质量。

### Session Result

End Session：评估当天是否完成有效 T 和成本改善。

### Risk Result

Next Session：评估是否降低隔夜/后续回撤风险。

每个窗口必须独立记录：

- successful rebuy。
- failed rebuy。
- missed rebuy。
- avoided drawdown。
- early exit/missed trend。

EVALUATION_WINDOW_STATUS = PROPOSAL_ONLY
EVALUATION_WINDOW_SELECTED = NONE

## 6. Feature Tier Proposal

### V1 — OHLCV / Causal Technical Tier

只使用经过可用性和语义审计的：

- price/Observed Reference Price。
- volume。
- causal returns。
- causal VWAP context。
- causal volatility/momentum。
- trend and momentum phase。

OHLC、ATR、MACD 等只有在输入字段和计算版本明确后才能启用；不能因字段名称存在就自动宣称语义已验证。

### V2 — L2 / Order Flow Tier

未来候选：

- OFI。
- tick/trade direction。
- bid/ask。
- spread。
- order-book imbalance。
- depth/liquidity pressure。

V2 不得回填 V1 缺失字段，也不得在当前阶段进入 benchmark。

FEATURE_TIER_STATUS = PROPOSAL_ONLY

## 7. Expert Pattern Boundary

Expert Pattern 只能作为 candidate feature/pattern：

急拉 + 异常成交量 + MACD 动能下降

不得直接成为：

- 固定 SELL action。
- 固定 BUY_BACK action。
- 硬编码交易规则。
- 自动 reward penalty。

Expert Pattern 与 Learned Policy 必须保留独立 lineage、版本和证据。

EXPERT_PRIOR_COMPATIBILITY = PROPOSAL_ONLY

## 8. Human Approval Gate

必须人工批准：

- State Schema。
- Core/T Position Model。
- Action Mapping。
- Fill Timing。
- Evaluation Windows。
- V1/V2 Feature Tier。
- Expert Pattern 与 Learned Policy 的关系。

## Final Gate

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
