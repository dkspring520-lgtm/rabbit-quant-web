# OFFLINE RL V0.12.23.6.6 — Canonical Trading Schema Decision

Decision date: 2026-10-05

## Status

本文件记录 Human Decision Freeze 的结果。由于各项尚未收到明确的人工 APPROVE/REJECT 决策，本文件冻结候选边界，但不擅自批准任何交易语义。

CANONICAL_SCHEMA_STATUS = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

## Decision Matrix

| Decision item | Frozen candidate | Decision |
|---|---|---|
| State Schema | Canonical Trading State V1 | BLOCKED pending source and lineage approval |
| Core/T Position Model | Core/T split with explicit T+1 fields | BLOCKED pending historical lineage approval |
| Action Mapping | Canonical Action V1 | BLOCKED pending legacy mapping approval |
| Fill Timing | t signal to t+1 next available observation | BLOCKED pending field semantics approval |
| Evaluation Window | 15 bars, 30 bars, End Session, Next Session | BLOCKED pending primary-window approval |
| Feature Tier | V1 causal market/portfolio boundary; V2 L2 extension | BLOCKED pending availability matrix |

## 1. State Schema Final Version

候选版本：Canonical Trading State V1。

### Market State

- timestamp。
- observedReferencePrice。
- return_1m。
- return_5m。
- return_15m。
- volume。
- volatility。
- trendRegime。
- momentumPhase。
- approved causal VWAP context。

OHLC、ATR、MACD、OFI 和盘口字段只有在真实可用性和语义通过审计后才能加入；不得 synthetic reconstruction。

### Position State

- cash。
- totalPosition。
- corePosition。
- tPosition。
- sellablePosition。
- todayBought。
- todaySold。
- averageCost。
- portfolioValueResearch。

corePosition/tPosition 若历史 Replay 未持久化，只能作为 benchmark scenario metadata，不能伪造为历史账户事实。

STATE_SCHEMA_VERSION = CANDIDATE_V1
STATE_SCHEMA_DECISION = BLOCKED

## 2. Core/T Position Final Definition

候选定义：

- corePosition：长期持仓，默认不因短期 T 信号清仓。
- tPosition：允许用于 T 的机动仓位。
- totalPosition = corePosition + tPosition。
- availableTPosition：受 sellablePosition、T+1 和数量规则约束的可用 T 仓位。

示例研究场景：corePosition 34000、tPosition 3100、totalPosition 37100。

该示例不是历史账户事实；初始化、变更、部分退出和多批次归属仍需人工批准。

CORE_T_POSITION_DECISION = BLOCKED

## 3. Action Mapping Final Definition

候选 Canonical Action V1：

- WAIT。
- HOLD。
- REDUCE_T_5。
- REDUCE_T_8。
- REDUCE_T_10。
- REDUCE_T_15。
- REDUCE_T_20。
- REBUILD_T_5。
- REBUILD_T_10。
- REBUILD_T_FULL。
- BLOCKED_ACTION。

每个 action 必须保留 requestedQuantity、executedQuantity、executionStatus、blockedReason 和 feasibility。

历史 WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL 的 mapping 不得静默合并，必须由人工批准 mapping table。

ACTION_MAPPING_VERSION = CANDIDATE_V1
ACTION_MAPPING_DECISION = BLOCKED

## 4. Fill Timing Final Rule

候选最终规则：

signal observation at t
→ execution at t+1 next available observation price

若真实、已验证的 next observation open 可用，才允许采用 next-observation-open 变体；否则使用 next available observed price，并保留语义限制。

禁止使用 future high、future low、区间极值或不可观察价格成交。

FILL_TIMING_RULE = CANDIDATE_NEXT_AVAILABLE_OBSERVATION
FILL_TIMING_DECISION = BLOCKED

## 5. Evaluation Window Final Rule

候选多窗口规则：

- Short T：15 bars。
- Intraday T：30 bars。
- Session Result：End Session。
- Risk Result：Next Session。

每个窗口独立报告 successful rebuy、failed rebuy、missed rebuy、avoided drawdown 和 early exit/missed trend。

最终主窗口、跨日规则、terminal/open-position 规则和缺失 observation 处理尚未人工批准。

EVALUATION_WINDOW_DECISION = BLOCKED

## 6. Feature Tier V1/V2

### V1 — Causal Market/Portfolio Tier

候选包含：

- observedReferencePrice。
- volume。
- causal returns。
- causal volatility/momentum。
- causal VWAP context。
- trendRegime。
- momentumPhase。
- portfolio and T+1 state。

### V2 — L2/Order Flow Tier

候选包含：

- OFI。
- tick/trade direction。
- bid/ask。
- spread。
- order-book imbalance。
- depth/liquidity pressure。

V2 不回填 V1 缺失字段，且当前核心 DATA-07 Replay 尚未证明全部可用。

FEATURE_TIER_DECISION = BLOCKED

## Human Approval Checklist

- [ ] 批准 Canonical State V1。
- [ ] 批准 Core/T Position Model。
- [ ] 批准 Canonical Action Mapping V1。
- [ ] 批准 next-observation fill timing。
- [ ] 批准 15/30 bars、End Session、Next Session 多窗口规则。
- [ ] 批准 V1 feature tier。
- [ ] 批准 V2 feature tier。
- [ ] 批准 Expert Pattern 仅作为 candidate feature，不作为硬编码 action rule。

## Explicit Non-goals

禁止：

- 执行回测。
- 生成 Dataset。
- 修改 Reward Contract。
- 生成 Value-Q target。
- 开始 RL training。
- 修改生产交易逻辑。

## Final Gate

CANONICAL_SCHEMA_STATUS = BLOCKED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
