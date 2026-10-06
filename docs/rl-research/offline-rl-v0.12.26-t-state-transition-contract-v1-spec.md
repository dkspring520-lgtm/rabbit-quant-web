# OFFLINE RL V0.12.26 — T State Transition Contract V1.0

Specification date: 2026-10-05

本文件只冻结 T State Transition 的研究规格候选，不实现 Feature Engine、State Engine、Opportunity Engine 或 Decision Engine。

## Final Gate

T_STATE_TRANSITION_STATUS = SPECIFICATION_ONLY
T_FEATURE_ENGINE_STATUS = SPECIFICATION_ONLY
FEATURE_IMPLEMENTATION = NOT_STARTED
T_STATE_ENGINE = SPECIFICATION_ONLY
T_OPPORTUNITY_ENGINE = SPECIFICATION_ONLY
T_DECISION_ENGINE = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
DATASET_MUTATION = FALSE
REWARD_MUTATION = FALSE
VALUE_Q_MUTATION = FALSE
POLICY_MUTATION = FALSE
T1_SEMANTICS = PASS
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

## 1. Purpose

把 Feature 转换为结构化 T State，并定义 State 何时允许切换、保持、确认或失效。

职责边界：

- Feature：可计算的市场描述。
- State：对 Feature 的结构化分类。
- Transition：State 切换条件。
- Opportunity：State 组合形成的候选环境。
- Decision：未来才负责 BUY、SELL、WAIT。

本 Contract 不产生交易动作。

## 2. Scope

覆盖：

- State taxonomy
- entry / exit / confirmation / invalidation
- hysteresis
- dwell
- momentum decay
- Bar-derived selling pressure
- Positive T / Counter T transition
- warmup/invalid propagation
- multi-value dependency boundary
- pre-action snapshot 和 failure attribution join

## 3. State Taxonomy

候选 State：

- NO_T_ENVIRONMENT
- UPTREND
- DOWNTREND
- RANGE
- TRANSITION
- UP_ACCELERATION
- DOWN_ACCELERATION
- HIGH_LEVEL_EXHAUSTION
- LOW_LEVEL_EXHAUSTION
- PULLBACK
- REBOUND
- WAIT_CONFIRMATION
- POSITIVE_T_CANDIDATE
- COUNTER_T_CANDIDATE
- T_RISK_HIGH

State 仅描述市场与 T 环境，不是订单状态。

## 4. State Entry Contract

每个 State 必须有候选 entry 条件，至少记录：

- required features
- feature direction
- observation window
- validity requirement
- optional confirmation requirement
- source indicator/feature versions

单一指标不得独立触发关键 State。关键 State 至少需要 trend、position、momentum、volume 或 structure 中的多维组合。

## 5. State Exit Contract

每个 State 必须定义：

- normal exit
- transition exit
- invalidation exit
- missing-data exit
- session-boundary behavior

状态退出不代表产生 BUY、SELL 或 WAIT。

## 6. Confirmation Contract

候选 Confirmation 层级：

1. Feature observation：仅满足候选条件。
2. WAIT_CONFIRMATION：等待独立或持续证据。
3. T opportunity candidate：达到候选环境条件，但仍非交易动作。

HIGH_LEVEL_EXHAUSTION 只有在候选回落、动能衰减持续或结构失守等条件下，才可进入 WAIT_CONFIRMATION。WAIT_CONFIRMATION 只有在 confirmation evidence 满足时，才可进入 COUNTER_T_CANDIDATE。

LOW_LEVEL_EXHAUSTION 到 POSITIVE_T_CANDIDATE 采用对称原则：必须存在企稳或反弹确认，不得由单一低位指标触发。

## 7. Invalidation Contract

### HIGH_LEVEL_EXHAUSTION

候选失效：

- price acceleration 恢复并持续。
- trend strength 重新增强。
- 价格有效突破原高位结构。
- volume/flow 不再支持衰竭解释。
- 关键 Feature 进入 WARMUP/INVALID。

### LOW_LEVEL_EXHAUSTION

候选失效：

- downside acceleration 恢复。
- 低位结构继续破坏。
- 企稳/承接证据消失。
- 关键 Feature 进入 WARMUP/INVALID。

### WAIT_CONFIRMATION

候选失效：

- 反向证据消失。
- 另一方向 acceleration 持续。
- session boundary 或数据质量不满足。

### POSITIVE_T_CANDIDATE / COUNTER_T_CANDIDATE

候选失效时回到 WAIT_CONFIRMATION、TRANSITION 或 NO_T_ENVIRONMENT，不产生反向交易动作。

## 8. Hysteresis Contract

为防止相邻 bar 抖动，进入和退出应使用不同的候选边界：

- entry threshold：较严格。
- exit threshold：较宽松。
- exit threshold 不得高于 entry threshold 对应的确认强度。

示例仅为 Proposal：

exhaustionScore >= A 才进入 HIGH_LEVEL_EXHAUSTION；exhaustionScore <= B 才退出，其中 B < A。

最终 A/B 数值不在本阶段冻结。

STATE_HYSTERESIS = PROPOSAL_ONLY

## 9. Dwell Contract

候选 Dwell 类型：

- minimum dwell：进入 State 后至少保持的 observed bars。
- confirmation dwell：确认条件连续满足的 bars。
- invalidation dwell：失效条件连续满足的 bars。

重点 State：

- HIGH_LEVEL_EXHAUSTION
- LOW_LEVEL_EXHAUSTION
- WAIT_CONFIRMATION
- POSITIVE_T_CANDIDATE
- COUNTER_T_CANDIDATE

最终 dwell 数值不在本阶段冻结。缺失 bar 不得自动补齐 dwell。

STATE_DWELL = PROPOSAL_ONLY

## 10. Momentum Decay Contract

momentum_decay 不能使用“涨不动”等主观语言，候选由以下 Feature 构成：

- price_velocity
- price_acceleration
- trend_strength
- distance_to_vwap
- vwap_slope
- momentum indicator state
- relative_volume
- volume_acceleration
- pullback_depth
- price_range_efficiency

候选方向：

- price_velocity 仍为正但下降。
- price_acceleration 转负或低于近期基线。
- trend_strength 仍高但边际下降。
- price expansion 与成交量/结构响应不匹配。

每个候选公式必须记录 window、normalization、warmup、validity 和未来数据检查。最终公式和阈值不冻结。

MOMENTUM_DECAY = PROPOSAL_ONLY

## 11. Selling Pressure Contract

当前只允许定义 Bar-derived selling pressure candidate：

- 上涨推进效率下降。
- 高位成交量相对增加。
- 回撤幅度扩大。
- 价格创新高能力下降。
- momentum decay 持续。
- Bar-derived flow 与价格表现不一致。

当前禁止把这些字段描述为真实 Tick/L2 Order Flow、真实逐笔主动卖出或真实 OFI。

SELLING_PRESSURE = BAR_DERIVED_CANDIDATE_ONLY

## 12. Counter T Transition

候选链：

UPTREND → UP_ACCELERATION → MOMENTUM_DECAY → HIGH_LEVEL_EXHAUSTION → WAIT_CONFIRMATION → COUNTER_T_CANDIDATE

要求：

- HIGH_LEVEL_EXHAUSTION 不等于 SELL。
- WAIT_CONFIRMATION 不等于 SELL。
- COUNTER_T_CANDIDATE 不等于 SELL。
- 恢复强 acceleration 时进入 invalidation 或回到 UPTREND/UP_ACCELERATION。

## 13. Positive T Transition

候选链：

DOWNTREND → DOWN_ACCELERATION → DOWNSIDE_EXHAUSTION → LOW_LEVEL_EXHAUSTION → REBOUND → WAIT_CONFIRMATION → POSITIVE_T_CANDIDATE

要求：

- LOW_LEVEL_EXHAUSTION 不等于 BUY。
- REBOUND 不等于 BUY。
- POSITIVE_T_CANDIDATE 不等于 BUY。
- 下跌重新加速时进入 invalidation 或回到 DOWNTREND/DOWN_ACCELERATION。

## 14. Warmup / Invalid Propagation

Feature validity：

- VALID
- WARMUP
- INVALID

State validity：

- STATE_VALID
- STATE_WARMUP
- STATE_INVALID

传播规则候选：

- 关键依赖为 WARMUP：State 不得升级为 confirmed candidate。
- 关键依赖为 INVALID：State 进入 STATE_INVALID 或降级为 NO_T_ENVIRONMENT。
- 非关键依赖缺失：可以保留 observation，但必须列入 missing evidence。
- null/NaN 不得转成 0。

Feature warmup 必须同时保留 sourceIndicator、sourceFirstValidTimestamp 和 featureWarmupBars。Indicator Resolution Proposal 尚未批准，因此依赖字段为 PROPOSAL_ONLY。

## 15. Multi-value Dependency

当前 Multi-value Contract = BLOCKED。

State 可能依赖以下候选字段：

- MACD：macd、signal、histogram
- Bollinger：upper、middle、lower
- KDJ：k、d、j
- ADX：adx、plusDI、minusDI
- Supertrend：direction、value 和可用边界字段

在 Multi-value Contract 未批准前：

DEPENDENCY_STATUS = PROPOSAL_ONLY

不得假设缺失 plot 已经存在，不得把 plot index 静默当作业务语义。

## 16. Snapshot Contract

State Transition 所需最小 Snapshot 候选包含：

- timestamp
- symbol
- timeframe
- market state
- trend
- position/location
- momentum
- volume/Bar-derived flow
- volatility
- structure
- exhaustion
- T State
- T State validity
- opportunity state
- portfolio context
- position
- sellablePosition
- availableSellablePosition
- todayBought
- feature validity
- warmup state

Portfolio context 只读现有账户状态，不重新实现 T+1。

## 17. Failure Attribution Join

未来 Join Contract：

Market Snapshot + Feature Snapshot + T State Snapshot + Opportunity Snapshot + Action Event + Failure Event

时间字段必须分离：

- observation timestamp
- feature timestamp
- pre-action decision timestamp
- action timestamp
- execution timestamp
- outcome timestamp

action-time 只能读取 pre-action Feature Snapshot。Post-action Outcome 和 evaluation window 不得反向进入 action-time State。

## 18. Temporal Boundary

State(t) 和 Transition(t) 只能依赖 Feature(t) 及历史 Feature。禁止使用：

- future Feature
- future State
- future high/low/close/volume
- future Order Flow
- post-action outcome

Transition 的输入窗口必须明确为 observed bars，不得使用中心窗口或未来确认结果。

## 19. Candidate Formulas

本阶段只提出候选，不冻结阈值：

- momentum_decay：velocity slope、acceleration change、trend strength change、price expansion efficiency 的组合。
- selling_pressure_candidate：高位 relative volume、price range efficiency 下降、回撤扩大、new-high failure 和 momentum decay 的组合。
- upside_exhaustion_score：position/location + momentum decay + volume anomaly + structure weakness。
- downside_exhaustion_score：downside acceleration decay + low-level position + selling exhaustion + rebound evidence。

所有 Candidate Formula 必须标记 PROPOSAL_ONLY。

## 20. Human Review Items

- [ ] 批准 momentum_decay 的 Feature 组成和窗口。
- [ ] 批准 selling_pressure 的 Bar-derived 语义。
- [ ] 批准 HIGH_LEVEL_EXHAUSTION 的 entry/exit/invalidation。
- [ ] 批准 LOW_LEVEL_EXHAUSTION 的 entry/exit/invalidation。
- [ ] 批准 WAIT_CONFIRMATION 的 confirmation evidence。
- [ ] 批准 hysteresis 方案。
- [ ] 批准 dwell 方案。
- [ ] 批准 Feature warmup/invalid 到 State 的传播。
- [ ] 批准 Multi-value dependency 是否可用。
- [ ] 批准 portfolio/Core-T/T+1 context 的只读边界。
- [ ] 批准 Failure Attribution 的时间 join。

## 21. Implementation Gate

本文件只创建规格。禁止实现 Feature Engine、State Engine、Opportunity Engine 或 Decision Engine。

## 22. Final Gate

T_STATE_TRANSITION_STATUS = SPECIFICATION_ONLY
T_FEATURE_ENGINE_STATUS = SPECIFICATION_ONLY
FEATURE_IMPLEMENTATION = NOT_STARTED
T_STATE_ENGINE = SPECIFICATION_ONLY
T_OPPORTUNITY_ENGINE = SPECIFICATION_ONLY
T_DECISION_ENGINE = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
DATASET_MUTATION = FALSE
REWARD_MUTATION = FALSE
VALUE_Q_MUTATION = FALSE
POLICY_MUTATION = FALSE
T1_SEMANTICS = PASS
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
