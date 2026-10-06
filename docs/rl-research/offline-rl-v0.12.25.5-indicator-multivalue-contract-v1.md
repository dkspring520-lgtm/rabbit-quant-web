# OFFLINE RL V0.12.25.5 — Indicator Multi-value Contract V1

Contract date: 2026-10-05

本文件只定义多值 Provider output 的最小事实边界。不扩大 Provider 输出，不修改 Adapter，不修改 Indicator Engine。

## Status

MULTIVALUE_CONTRACT_STATUS = PROPOSAL_ONLY
IMPLEMENTATION_STATUS = NOT_STARTED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Source of Truth

第一版唯一事实来源是：

Provider 在当前版本、当前参数和当前输入上的实际 output fields。

不得：

- 根据指标名称猜测不存在的 field。
- 把 plot index 静默解释成业务语义。
- 为了凑齐字段而合成 plusDI、minusDI、lower band 或 direction。
- 用未来数据补齐缺失 field。

## 2. Provider Output Audit Matrix

| indicatorId | Provider observed output | V1 normalized availability |
|---|---|---|
| MACD_12_26_9 | plot0、plot1、plot2 | 三个 field 可观察，但业务命名仍需人工批准 |
| BOLLINGER_20_2 | plot0、plot1、plot2 | 三个 field 可观察，但 upper/middle/lower 顺序需批准 |
| KDJ_9 | plot0、plot1、plot2 | 三个 field 可观察，但 k/d/j 顺序需批准 |
| ADX_14 | 当前主要观察到 plot0 | 只允许 adx-like single output；plusDI/minusDI = UNAVAILABLE |
| SUPERTREND_10_3 | 当前观察到三个 plot | 第四 field 不得补造；direction/value 语义需批准 |
| VOLUME_DELTA | plotCandles.delta.close | 可作为 single bar-derived delta candidate；不能扩展为虚构多值 |
| CVD | plotCandles.cvd.close | 可作为 single bar-derived CVD candidate |

## 3. Normalized Output Candidates

### Candidate A — Named Business Object

- MACD → macd、signal、histogram
- Bollinger → upper、middle、lower
- KDJ → k、d、j
- ADX → adx、plusDI、minusDI，仅当 Provider 实际提供全部 field
- Supertrend → value、direction、upper、lower，仅当 Provider 实际提供并通过语义审计

缺失 field 必须显式为 UNAVAILABLE，不得合成。

### Candidate B — Raw Provider Field Object

保留 plot0、plot1、plot2 或 plotCandles field 名称。

优点：最忠实 Provider。

风险：Provider 内部结构泄漏到业务层，未来更换版本或 Provider 时容易产生语义漂移。

### Candidate C — Named Object + Availability Metadata

输出同时记录：

- normalized value
- availableFields
- unavailableFields
- providerPlotMap
- providerVersion
- field-level firstValidTimestamp
- field-level effectiveWarmup

## 4. Minimum Implementable Boundary

在人工批准前：

- Feature Engine 不依赖 ADX plusDI/minusDI。
- Feature Engine 不依赖 Supertrend 缺失 field。
- Feature Engine 不把 VOLUME_DELTA/CVD 解释为真实 Tick/L2 Flow。
- MACD、Bollinger、KDJ 只允许作为 PROPOSAL_ONLY dependency。
- 任意缺失 required field 会使 dependent Feature = BLOCKED/WARMUP，而不是填充默认值。

## 5. Recommended Contract

RECOMMENDED_MULTIVALUE_CONTRACT = PROPOSAL_ONLY / CANDIDATE_C

推荐 Candidate C，但当前不实施：

named object + availability metadata + providerPlotMap + field-level warmup。

## Human Review

- [ ] 批准 MACD field naming/order。
- [ ] 批准 Bollinger field naming/order。
- [ ] 批准 KDJ field naming/order。
- [ ] 决定 ADX plusDI/minusDI 是否保持 UNAVAILABLE。
- [ ] 决定 Supertrend 缺失 field 行为。
- [ ] 决定 VOLUME_DELTA 是否保持 single bar-derived candidate。
- [ ] 决定 CVD 是否保持 single bar-derived candidate。
- [ ] 批准缺失 required field 到 Feature validity 的传播。

## Explicit Non-goals

本 Contract 不修改：

- Registry
- Adapter
- Indicator Engine
- Feature Engine
- DATA-07
- Reward
- Value-Q
- RL Dataset
- RL Training

## Final Gate

MULTIVALUE_CONTRACT_STATUS = PROPOSAL_ONLY
IMPLEMENTATION_STATUS = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
