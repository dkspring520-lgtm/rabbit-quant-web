# OFFLINE RL V0.12.26 — T Feature Engine V1.0 Human Review Audit

Audit date: 2026-10-05

审查对象：docs/rl-research/offline-rl-v0.12.26-t-feature-engine-v1-spec.md

本报告只做人工验收辅助审计，不实现 Feature Engine、State Engine 或 Opportunity Engine。

## Final Status

T_FEATURE_ENGINE_AUDIT = BLOCKED_FOR_HUMAN_REVIEW
T_FEATURE_ENGINE_STATUS = SPECIFICATION_ONLY
FEATURE_IMPLEMENTATION = NOT_STARTED
T_STATE_ENGINE = SPECIFICATION_ONLY
T_OPPORTUNITY_ENGINE = SPECIFICATION_ONLY
T_DECISION_ENGINE = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

## 1. Executive Summary

规格已经正确建立了 Indicator Engine → T Feature Engine → T State Engine → T Opportunity Engine 的职责边界，并明确了 Feature/Opportunity 不等于 BUY、SELL、WAIT。

但当前规格还不能直接作为无歧义的实现 Contract。主要阻塞为：

1. 用户描述的上涨衰竭和下跌企稳路径尚未被拆成完整、可计算的 feature/state transition contract。
2. selling pressure、momentum decay、selling exhaustion 等关键中间特征没有统一定义。
3. 状态机缺少 entry、exit、hysteresis、minimum dwell 和 invalidation 语义。
4. Indicator Deep Audit 的 warmup、multi-value 和 flow semantics BLOCKED 尚未在 T Feature Contract 中形成明确传播规则。
5. T Feature Snapshot 缺少完整的 portfolio/Core-T/T+1 context，未来 Opportunity 解释可能不完整。
6. Feature Dependency Matrix 仍主要是概念映射，缺少每个 Feature 的 source version、validity propagation 和公式版本。

## 2. Positive T / Counter T Semantic Review

### 2.1 Upward Expansion → Stalling → Selling Pressure → Pullback

现有规格已经能够表达：

- price_velocity
- price_acceleration
- trend_strength
- intraday_position
- relative_volume
- upside_exhaustion_score
- HIGH_LEVEL_EXHAUSTION
- WAIT_FOR_CONFIRMATION
- COUNTER_T_CANDIDATE

并且明确 COUNTER_T_CANDIDATE 不等于 SELL。

但以下链路仍 BLOCKED：

快速上涨 → 上涨停滞 → selling_pressure 增加 → 回落风险。

缺少或未冻结：

- momentum_decay 的明确公式
- selling_pressure 的明确来源和 signed semantics
- volume/Bar-derived Flow 如何区分放量上涨与放量滞涨
- exhaustion score 的输入分解、validity 和缺失值规则
- HIGH_LEVEL_EXHAUSTION 的退出和失效条件
- WAIT_FOR_CONFIRMATION 需要哪些 confirmation feature

结论：

UPTREND → HIGH_LEVEL_EXHAUSTION → WAIT_FOR_CONFIRMATION → COUNTER_T_CANDIDATE 的概念路径存在，但尚未形成可直接实现的 Contract。

### 2.2 Downward Move → Stabilization → Selling Exhaustion → Rebound

现有规格已经能够表达：

- DOWN_ACCELERATION
- price_acceleration
- LOW_LEVEL_EXHAUSTION
- PULLBACK
- REBOUND
- POSITIVE_T_CANDIDATE

并且明确 POSITIVE_T_CANDIDATE 不等于 BUY。

但以下链路仍 BLOCKED：

快速下跌 → 下跌速度下降 → 卖压衰竭 → 低位承接 → 反弹候选。

缺少或未冻结：

- downside momentum decay 的公式
- selling exhaustion 与 buying absorption 的区分
- low-level stabilization 的最小观察窗口
- rebound confirmation 的 required evidence
- LOW_LEVEL_EXHAUSTION 与 REBOUND 的转换条件
- 失败反弹和重新加速下跌的 invalidation 条件

## 3. Opportunity Boundary Audit

通过项：

- Opportunity 不是交易指令。
- score 不是胜率、收益率或预测概率。
- 没有正式交易阈值。
- positive/counter candidate 不直接产生 BUY/SELL。

阻塞项：

- score 的组成维度尚未定义。
- reasons 的 evidence schema 尚未定义。
- confirmationRequired 的枚举尚未定义。
- riskLevel 与 T_RISK_HIGH 的关系尚未定义。
- 同时出现 positive 和 counter candidate 时的冲突规则尚未冻结。

OPPORTUNITY_CONTRACT = PROPOSAL_ONLY

## 4. State Machine Audit

候选状态集合覆盖了趋势、加速、衰竭、回调、反弹和候选机会，方向正确。

当前 BLOCKED：

- 没有明确每个状态的 entry condition。
- 没有明确每个状态的 exit condition。
- 没有 hysteresis，状态可能在相邻 bar 间抖动。
- 没有 minimum dwell 或 confirmation persistence。
- 没有 missing/warmup 时的 state fallback。
- 没有 session boundary、午休和跨日的状态重置规则。
- STATE_PRIORITY 仍是 PROPOSAL_ONLY。

建议人工未来冻结 state transition table，但本轮不实施。

STATE_MACHINE = SPECIFICATION_PARTIAL

## 5. Indicator Dependency Compatibility

Indicator Deep Audit 已确认：

- TEMPORAL_AUDIT = PASS
- ALIGNMENT_AUDIT = PASS
- warmup semantics = BLOCKED
- multi-value contract = BLOCKED
- Bar-derived Flow 与 Tick/L2 Flow 必须分层

T Feature Specification 尚未明确：

- upstream indicator WARMUP/INVALID 如何传播到 Feature validity。
- MACD、KDJ、Bollinger 多值字段缺失时 Feature 如何降级。
- ADX/Supertrend 的 Provider first-valid 差异如何影响 trend state。
- VOLUME_DELTA/CVD 在 V1 中如何标记为 Bar-derived，而不是真实 Order Flow。
- CUSTOM_CANDIDATE ATR-normalized Distance 是否允许进入 Feature Snapshot。

INDICATOR_TO_FEATURE_VALIDITY = BLOCKED_PENDING_RESOLUTION

## 6. Portfolio and Core/T Context Audit

规格定义了市场 Feature，但 Snapshot 没有完整冻结：

- corePosition
- tPosition
- totalPosition
- sellablePosition
- todayBought
- todaySold
- availableSellablePosition
- averageCost

这些字段不应由 Feature Engine 重新计算执行语义，但 Opportunity/State 未来需要读取明确的 portfolio context，才能解释：

- 当前是否有可卖 T Position。
- 当前 candidate 是否可执行。
- T+1 是否会影响候选解释。

结论：

Portfolio context 应作为只读 input/context layer，不属于 Indicator calculation，也不应改变 T+1 implementation。

PORTFOLIO_CONTEXT_CONTRACT = BLOCKED_PENDING_REVIEW

## 7. Feature Snapshot Audit

已有结构覆盖 trend、position、momentum、volume、volatility、structure、exhaustion 和 opportunity，方向正确。

仍需人工决定：

- 每个字段的 validity 是单字段还是分组字段。
- Feature source lineage 是否必须携带 indicator version。
- signed/absolute/normalized 同时存在时的命名规范。
- score 是否必须保留 raw score、normalized score、supporting evidence、opposing evidence。
- snapshot 是否必须携带 data timestamp、arrival timestamp、latency。
- 不同 timeframe 的 feature 是否允许混合进入同一 Snapshot。

FEATURE_SNAPSHOT_CONTRACT = PARTIAL

## 8. Failure Attribution Compatibility

规格保持现有 Failure Labels 不变，符合要求：

- Failed Rebuy
- Missed Trend
- T+1 Constraint
- Execution Timing Failure
- Blocked Actions

未来可关联 Feature Snapshot 和 T State，但当前还缺少：

- failure event timestamp 与 feature timestamp 的 join key。
- action timestamp 与 observation timestamp 的边界。
- failure label 是否可读取 outcome window。
- failure attribution 是否只用于诊断，不能回流 action-time feature。

FAILURE_ATTRIBUTION = COMPATIBLE_BUT_UNFROZEN

## 9. Replay / Paper Trading Compatibility

规格正确要求 Historical Replay、Paper Trading 和未来 Realtime 使用同一 Feature Contract，并保持 Feature Engine 不负责：

- T+1 enforcement
- sellablePosition
- fill
- fee/slippage
- BUY/SELL/WAIT decision

仍需人工冻结：

- replay input schema
- as-of timestamp
- session reset
- missing data behavior
- warmup state at replay start
- bar/tick/L2 source layer

REPLAY_COMPATIBILITY = PROPOSAL_ONLY

## 10. Human Review Checklist

- [ ] 批准 upward exhaustion feature chain。
- [ ] 批准 downside exhaustion / rebound feature chain。
- [ ] 冻结 momentum_decay、selling_pressure、selling_exhaustion 定义。
- [ ] 冻结 state entry/exit/hysteresis/dwell 规则。
- [ ] 冻结 State Priority。
- [ ] 冻结 Opportunity score、reasons、confirmationRequired、riskLevel contract。
- [ ] 冻结 Indicator warmup/invalid propagation。
- [ ] 冻结 Bar-derived Flow 与 Tick/L2 Flow 的边界。
- [ ] 冻结 portfolio/Core-T context 的只读输入边界。
- [ ] 冻结 Failure Attribution timestamp join 规则。
- [ ] 确认 Feature 不产生正式 BUY/SELL/WAIT。

## 11. Implementation Not Started

本轮只完成审计，没有：

- 实现 T Feature Engine
- 实现 T State Engine
- 实现 T Opportunity Engine
- 修改 Indicator Engine
- 修复 Indicator Deep Audit findings
- 修改 T+1
- 修改 Strategy / Reward / Dataset / Value-Q / RL

## Final Gate

T_FEATURE_ENGINE_AUDIT = BLOCKED_FOR_HUMAN_REVIEW
T_FEATURE_ENGINE_STATUS = SPECIFICATION_ONLY
FEATURE_IMPLEMENTATION = NOT_STARTED
T_STATE_ENGINE = SPECIFICATION_ONLY
T_OPPORTUNITY_ENGINE = SPECIFICATION_ONLY
T_DECISION_ENGINE = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
