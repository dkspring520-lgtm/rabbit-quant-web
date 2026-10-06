# 做T神器 — T Feature Engine V1.0 Specification

Specification date: 2026-10-05

本文件只定义 T Feature Engine、T State Engine 和 T Opportunity Engine 的研究规格，不实现代码，不修改现有 Indicator Engine。

## Final Gate

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

把行情和 Indicator Engine 输出转化为与做 T 相关的、可计算、可审计、可回放的研究特征。

目标链路：

Market Data → Indicator Engine → T Feature Engine → T State Engine → T Opportunity Engine → future T Decision Engine

Feature Engine 不直接产生交易动作。

## 2. Scope

本阶段只定义：

- T-specific feature taxonomy
- Feature Snapshot Contract
- Feature dependency matrix
- temporal / warm-up / normalization contract
- T state machine
- Positive T / Counter T semantics
- T opportunity contract
- Failure Attribution compatibility
- Replay、Paper Trading、Tick/L2 扩展边界

## 3. Non-goals

禁止：

- 实现 T Feature Engine
- 修改 Indicator Engine
- 修复 warmup 或 multi-value contract
- 修改 Bar Flow / Tick Flow / L2 Flow semantics
- 生成 BUY、SELL、WAIT
- 修改 T strategy、Expert Prior 或 Bidirectional T
- 修改 Reward、Dataset、Value-Q、Policy 或 Canonical Schema
- 启动 RL training

## 4. Indicator Engine vs T Feature Engine

### Indicator Engine — CALCULATE

负责计算：

- EMA、RSI、MACD、VWAP、ATR、Bollinger
- provider output
- warm-up 和原始 indicator metadata

### T Feature Engine — INTERPRET

负责把市场数据和 indicators 转成：

- 趋势
- 位置
- 动能
- 成交量和 Bar-derived Flow
- 波动
- 回调/反弹
- 上涨/下跌衰竭
- T opportunity candidate

### T State Engine — CLASSIFY

负责分类当前做 T market state。

### T Opportunity Engine — IDENTIFY

负责识别候选机会状态，不是交易命令。

### Future T Decision Engine — DECIDE

当前为 NOT_STARTED。未来才允许把候选状态映射为研究决策。

## 5. Feature Taxonomy

### Trend

- trend_state
- trend_strength
- trend_direction
- acceleration_state

### Position / Location

- intraday_position
- distance_to_vwap
- vwap_slope
- day_high_distance
- day_low_distance
- ema20_distance
- ema60_distance
- bollinger_position

### Momentum

- price_velocity
- price_acceleration
- momentum_strength
- momentum_state

### Volume / Flow

- relative_volume
- volume_acceleration
- price_volume_confirmation
- bar_flow_state

### Volatility

- atr
- normalized_move
- bollinger_width
- volatility_state

### Structure

- pullback_state
- pullback_strength
- pullback_depth
- pullback_duration
- rebound_state
- rebound_strength
- rebound_depth
- rebound_duration

### Exhaustion

- upside_exhaustion_score
- downside_exhaustion_score

### Opportunity

- positive_t_environment
- counter_t_environment
- t_opportunity_state
- t_opportunity_score

所有 Feature 初始 status = PROPOSAL_ONLY，rlEligible = false。

## 6. Feature Definitions

| Feature | Definition proposal | Type |
|---|---|---|
| distance_to_vwap | price / causal session VWAP - 1 | signed normalized |
| price_velocity | price[t] / price[t-1] - 1 | signed |
| price_acceleration | velocity[t] - velocity[t-1] | signed |
| relative_volume | current volume / causal rolling volume baseline | normalized |
| volume_acceleration | relative volume[t] - relative volume[t-1] | signed |
| intraday_position | causal position between observed session low/high | normalized |
| ema20_distance | price / causal EMA20 - 1 | signed normalized |
| ema60_distance | price / causal EMA60 - 1 | signed normalized |
| pullback_depth | distance from recent causal high toward current price | signed normalized |
| rebound_depth | distance from recent causal low toward current price | signed normalized |
| pullback_duration | observed bars since causal pullback start | integer |
| rebound_duration | observed bars since causal rebound start | integer |
| normalized_move | causal price move divided by approved volatility reference | signed candidate |
| positive_t_environment | candidate combination for pullback/rebound conditions | categorical |
| counter_t_environment | candidate combination for high-level exhaustion conditions | categorical |
| t_opportunity_score | opportunity strength, not probability or return | score |

本表只是 Proposal，不声明有效性、胜率、收益或正式阈值。

## 7. Feature Dependency Matrix

### Direct Market Data

- price / close
- open/high/low when genuinely available
- volume
- timestamp
- symbol
- timeframe
- session boundary

### Indicator Dependency

- distance_to_vwap ← VWAP + price
- vwap_slope ← VWAP[t] + VWAP[t-n]
- ema20_distance ← EMA20 + price
- ema60_distance ← EMA60 + price
- bollinger_position ← Bollinger upper/middle/lower + price
- atr ← ATR
- momentum_state ← RSI/MACD/ROC candidate values
- trend_strength ← ADX or approved trend indicator

### Derived Feature

- price_velocity ← price[t], price[t-1]
- price_acceleration ← price_velocity[t], price_velocity[t-1]
- pullback_depth ← causal high/low and price path
- rebound_depth ← causal low/high and price path
- upside_exhaustion_score ← trend + location + momentum + volume + structure
- downside_exhaustion_score ← trend + location + momentum + volume + structure

Dependency layer must remain explicit: DIRECT_MARKET_DATA, INDICATOR_DEPENDENCY, DERIVED_FEATURE。

## 8. Temporal Contract

每个 Feature 必须满足：

Feature(t) = f(MarketData[<=t])

允许窗口：[t-N+1, ..., t]

禁止：

- future high / low / close / volume
- future Tick / L2
- future indicator / feature
- centered windows
- outcome window entering action-time features

如果发现 Feature(t) 依赖 t+n 且 n > 0：

TEMPORAL_AUDIT = BLOCKED

不得进入 Research Feature Pipeline。

## 9. Warm-up Contract

Feature 不得假定 Indicator 永远有效。每个 Feature 支持：

- VALID
- WARMUP
- INVALID

不得把 null 或 NaN 转换成 0。

Feature 层候选 metadata：

- featureWarmupBars
- firstValidTimestamp
- sourceIndicator
- sourceFirstValidTimestamp
- validity

Feature warmup 可以与 Indicator warmupBars、firstValidIndex 分离；不得自动覆盖原 Indicator metadata。

## 10. Normalization Contract

每个 Feature 必须声明：

- raw
- signed
- absolute
- normalized
- categorical
- score

方向相关特征优先保留 signed 形式。例如：+0.8% 与 -0.8% 对正 T/反 T 含义不同。

score 只表示候选机会强度，不能解释为胜率、收益率或预测概率。

## 11. Feature Snapshot Contract

候选结构：

timestamp、symbol、timeframe、validity，以及：

- trend：state、strength
- position：intradayPosition、vwapDistance、dayHighDistance、dayLowDistance、ema20Distance、ema60Distance、bollingerPosition
- momentum：velocity、acceleration、strength、state
- volume：relativeVolume、acceleration、priceVolumeConfirmation、barFlowState
- volatility：atr、normalizedMove、bollingerWidth、state
- structure：pullbackState、pullbackStrength、pullbackDepth、pullbackDuration、reboundState、reboundStrength、reboundDepth、reboundDuration
- exhaustion：upsideScore、downsideScore
- opportunity：state、score、positiveTCandidate、counterTCandidate、confirmationRequired、riskLevel

Snapshot 只用于 Research、Replay、Paper Trading 未来接口和 UI 观察层。

## 12. T State Machine V1.0

候选状态：

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
- POSITIVE_T_CANDIDATE
- COUNTER_T_CANDIDATE
- WAIT_CONFIRMATION
- T_RISK_HIGH

状态转换必须由 Feature 组合决定，不得由单一 Indicator 决定。

示例：trend=UP、position=HIGH、momentum=DECELERATING、volume=ELEVATED、vwapDistance=HIGH，可以进入 HIGH_LEVEL_EXHAUSTION，但不能直接输出 SELL。

T_STATE_ENGINE = SPECIFICATION_ONLY

## 13. State Priority

候选优先级：

T_RISK_HIGH > HIGH_LEVEL_EXHAUSTION / LOW_LEVEL_EXHAUSTION > PULLBACK / REBOUND > ACCELERATION > TREND > RANGE

STATE_PRIORITY = PROPOSAL_ONLY

优先级未获人工批准前不得实施。

## 14. Positive T Semantics

Positive T：回调/相对低位 → 买入 → 反弹 → 卖出。

Feature Engine 只识别：

- LOW_LEVEL_REBOUND
- HEALTHY_PULLBACK
- DOWNSIDE_EXHAUSTION
- REBOUND_CONFIRMATION
- positive_t_environment

不得直接产生 BUY。

## 15. Counter T Semantics

Counter T：冲高/相对高位 → 卖出 → 回落 → 回补。

Feature Engine 只识别：

- HIGH_LEVEL_EXHAUSTION
- UPSIDE_EXHAUSTION
- OVEREXTENSION
- PULLBACK_CONFIRMATION
- counter_t_environment

不得直接产生 SELL。

## 16. T Opportunity Contract

T Opportunity 不是交易指令，只回答当前行情是否值得进入做 T 候选观察状态。

候选状态：

- NO_OPPORTUNITY
- POSITIVE_T_CANDIDATE
- COUNTER_T_CANDIDATE
- WAIT_FOR_CONFIRMATION
- T_RISK_HIGH

候选输出包含：

- state
- score
- positiveTCandidate
- counterTCandidate
- confirmationRequired
- riskLevel
- reasons

score 只是机会强度评分，不是胜率、收益率或预测概率；本阶段不设置正式交易阈值。

T_OPPORTUNITY_ENGINE = SPECIFICATION_ONLY

## 17. Failure Attribution

现有 Failure Label 保持不变：

- Failed Rebuy
- Missed Trend
- T+1 Constraint
- Execution Timing Failure
- Blocked Actions

未来可关联：Failure Event + Market Snapshot + Feature Snapshot + T State + Opportunity State。

当前不得修改 Failure Label，不得用 Feature 重新解释或重写历史结果。

## 18. Replay Compatibility

未来 Historical Replay 必须使用与 Realtime 相同的 Feature Contract：

Historical Replay → Feature(t)

避免 Backtest Feature 与 Realtime Feature 分叉。当前只定义接口，不实现 Replay Adapter。

## 19. Paper Trading Compatibility

未来 Paper Trading 可读取 Snapshot，但 Feature Engine 不负责：

- T+1 enforcement
- sellablePosition calculation
- order fill
- fee/slippage
- BUY/SELL/WAIT decision

这些职责继续属于 Execution / Decision 层。

## 20. Tick/L2 Extension

三层独立：

- Bar Feature
- Tick Feature
- L2 Feature

当前 Bar Volume Delta、Bar CVD 不得包装成真实 Order Flow。Tick/L2 缺失字段不得由 Bar Feature 填充。

## 21. UI Boundary

未来 UI 可以展示 Trend、Position、Momentum、Volume、Volatility、Exhaustion 和 T Opportunity，但当前不改 UI，不显示正式 BUY/SELL 信号，不把 Opportunity State 当成订单指令。

## 22. RL Isolation

T Feature Engine → Research / Replay / Diagnosis。

禁止连接：

- DATA-07
- Reward
- Value-Q
- RL Dataset
- RL Training

T_FEATURE_RL_ELIGIBLE = FALSE

未来若进入 RL，必须独立通过 Feature Audit、Temporal Audit、Leakage Audit、Redundancy Audit、Distribution Audit、OOS Validation 和 Human Review。

## 23. Future Decision Engine Boundary

Decision Engine = NOT_STARTED。

未来 Decision Engine 才能研究 WAIT、REDUCE_T、REBUY_T 等动作；Feature Engine、State Engine、Opportunity Engine 当前都不产生正式交易动作。

## 24. Human Review Items

人工需要决定：

- Feature taxonomy 是否完整。
- State priority 是否接受。
- Warm-up boundary 是否继承 Indicator 双边界 proposal。
- signed/absolute/normalized contract。
- Positive T / Counter T candidate semantics。
- T Opportunity score 的解释边界。
- Bar/Tick/L2 三层数据隔离。
- Failure Attribution 的 future linkage。

## 25. Implementation Gate

本阶段只创建规格文档。Feature Engine、State Engine、Opportunity Engine 均未实现。

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

CODE_IMPLEMENTATION = NONE
GIT_COMMIT = FORBIDDEN
GIT_PUSH = FORBIDDEN
