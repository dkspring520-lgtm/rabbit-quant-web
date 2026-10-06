# OFFLINE RL V0.12.23.6.7 — Canonical Schema Final Approval

Approval date: 2026-10-05

基于：offline-rl-v0.12.23.6.6-canonical-trading-schema-decision.md

本文件完成 Canonical Trading Schema 的人工冻结。冻结仅适用于后续研究规格和审计边界，不代表已经执行回测、生成 Dataset 或启用 Value-Q/RL。

## Final Status

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. State Schema — FINAL

版本：Canonical Trading State V1。

### Market State

- timestamp
- observedReferencePrice
- return_1m
- return_5m
- return_15m
- volume
- volatility
- trendRegime
- momentumPhase
- causal VWAP context

### Position State

- cash
- totalPosition
- corePosition
- tPosition
- sellablePosition
- todayBought
- todaySold
- averageCost
- portfolioValueResearch

所有 feature 必须只使用当前 bar 或历史 bar。缺失字段保持 unavailable，不得使用 synthetic reconstruction、future-derived feature 或事后填充。

STATE_SCHEMA_VERSION = CANONICAL_V1
STATE_SCHEMA_STATUS = APPROVED

## 2. Core/T Position Model — FINAL

- corePosition 是长期持仓。
- corePosition 不主动交易，不被任何 T action 直接减少或增加。
- tPosition 是唯一允许执行 T 动作的机动仓位。
- totalPosition = corePosition + tPosition，仅在来源可追溯时使用。
- sellablePosition、todayBought 和 todaySold 必须遵守 A 股 T+1 约束。
- 研究场景 34000 core shares + 3100 T shares 仅是场景参数，不冒充历史账户事实。

所有 T action 的数量比例均以 action 时刻的 tPosition 为分母；不得以 totalPosition 或 corePosition 计算 T action 数量。

CORE_T_POSITION_MODEL = APPROVED
CORE_POSITION_ACTIVE_TRADING = DISALLOWED

## 3. Action Space — FINAL

Canonical Action V1：

- WAIT：不改变仓位。
- HOLD：保持当前 T 状态，不发起新的 T 交易。
- REDUCE_T_5
- REDUCE_T_8
- REDUCE_T_10
- REDUCE_T_15
- REDUCE_T_20
- REBUILD_T_5
- REBUILD_T_10
- REBUILD_T_FULL
- BLOCKED_ACTION：因 T+1、sellablePosition、数量或数据约束而不可执行。

数量定义：

- REDUCE_T_x = action-time tPosition × x%，并按适用的 A 股数量规则取整。
- REBUILD_T_x = 仅回补此前可追溯的 T 减仓额度，不得触碰 corePosition。
- REBUILD_T_FULL = 回补当前可追溯的 T 减仓额度，不得超过可执行数量。

每个 action 必须记录 requestedQuantity、executedQuantity、executionStatus、blockedReason 和 feasibility。

历史 WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL 不得静默映射为 Canonical Action；需要独立保存 legacy action lineage。

ACTION_SPACE_VERSION = CANONICAL_V1
ACTION_SPACE_STATUS = APPROVED

## 4. Fill Timing — FINAL

signal uses current bar t; execution uses next bar t+1。

规则：

- signal 只能读取当前 bar 和历史 bar。
- execution 只能使用 next bar 的可观察执行价格。
- 不得使用 signal bar 之后才知道的 high、low、close、volume 或区间极值。
- next bar 缺失时，action 记录为不可执行，不得回填价格。
- fill event 必须晚于 action request，并保留 signal timestamp 与 execution timestamp。

FILL_TIMING_RULE = CURRENT_BAR_SIGNAL_NEXT_BAR_EXECUTION
FILL_TIMING_STATUS = APPROVED

## 5. Evaluation Window — FINAL

结果评价采用预先冻结的多窗口报告，不把未来窗口数据输入 action decision：

- 15 bars：Short T opportunity window。
- 30 bars：Intraday T opportunity window。
- End Session：当日结果窗口。
- Next Session：跨日风险和 missed-rebuy 观察窗口。

每个窗口独立记录：

- successful rebuy
- failed rebuy
- missed rebuy
- avoided drawdown
- early exit / missed trend

窗口只用于 outcome evaluation。terminal/open-position、跨日边界和缺失 observation 必须按数据可用性记录，不得用未来数据补齐。

EVALUATION_WINDOW_STATUS = APPROVED
EVALUATION_PRIMARY_USE = REPORTING_ONLY

## 6. Feature Tier V1/V2 — FINAL

### V1 — Causal Market and Portfolio Tier

V1 允许使用：

- observedReferencePrice
- volume
- causal returns
- causal volatility and momentum
- causal VWAP context
- trendRegime
- momentumPhase
- portfolio state and T+1 state

V1 是后续历史 benchmark 的最低数据边界。V1 不依赖 L2；缺失字段保持 unavailable。

### V2 — L2 and Order Flow Extension

V2 可包含：

- OFI
- tick/trade direction
- bid/ask
- spread
- order-book imbalance
- depth/liquidity pressure

V2 不回填 V1 缺失字段，不改变 V1 的 state/action/fill semantics，也不得把不可用盘口字段伪造到历史数据中。

FEATURE_TIER_V1 = APPROVED
FEATURE_TIER_V2 = APPROVED_AS_OPTIONAL_EXTENSION

## Expert Pattern Boundary

Expert Pattern 只允许作为 candidate feature/pattern，必须保留独立 lineage、版本和证据。

Expert Pattern 不得直接生成 SELL、REBUILD 或其他固定交易 action，不得绕过 Canonical Action Space 和 Fill Timing。

EXPERT_PATTERN_AS_HARD_CODED_RULE = DISALLOWED

## Approval Scope and Non-goals

本次批准只冻结 schema、position semantics、action semantics、fill timing、evaluation windows 和 feature tiers。

仍然禁止：

- 回测
- Dataset 或 replay dataset 生成
- Reward Contract 修改
- Value-Q target 生成
- RL training
- 修改生产交易逻辑

## Final Gate

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
