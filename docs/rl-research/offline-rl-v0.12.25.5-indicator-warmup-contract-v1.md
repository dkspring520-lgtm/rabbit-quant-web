# OFFLINE RL V0.12.25.5 — Indicator Warmup Contract V1

Contract date: 2026-10-05

本文件压缩 Warmup blocker 为最小可实现 Contract。只定义 metadata 和 Feature 使用边界，不修改 Provider 计算逻辑、Indicator Engine 核心算法或任何 RL 资产。

## Status

WARMUP_CONTRACT_STATUS = PROPOSAL_ONLY
IMPLEMENTATION_STATUS = NOT_STARTED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Three Separate Concepts

### declaredWarmup

Registry 声明的理论或配置输入窗口。

它不能被解释为 Provider 必然从该 index 开始输出有效值。

### actualFirstValidIndex

在固定 Provider 版本、固定参数和固定输入 fixture 下，某个 output field 首次出现非 null、有限值的位置。

它是 audit observation，不自动改写 Registry。

### effectiveWarmup

未来 Feature 使用该 indicator 前，经过 audit 后确认安全的最早 index。

effectiveWarmup 不是简单复制 declaredWarmup，也不是无条件复制 actualFirstValidIndex。

## 2. Effective Warmup Rule

第一版 Feature Engine 只允许使用：

valid = true

且所有依赖 indicator/output field 均达到 effectiveWarmup 的数据。

如果某个依赖 indicator 尚未达到 effectiveWarmup：

- Feature validity = WARMUP
- 不产生替代数值
- 不把 null/NaN 转成 0
- 不进入 confirmed T State
- 不进入 Opportunity candidate 的 confirmed 层

## 3. Audit Metadata

每个 indicator/output field 的未来 metadata 至少包含：

- indicatorId
- outputField
- declaredWarmup
- actualFirstValidIndex
- effectiveWarmup
- firstValidTimestamp
- providerVersion
- parameterHash
- auditStatus

## 4. Minimum V1 Decision

### ADX_14

- declaredWarmup = 14
- 当前 audit fixture actualFirstValidIndex = 27
- effectiveWarmup = BLOCKED_PENDING_FORMAL_AUDIT

原因：Provider 的 ADX 可能包含方向移动和多阶段平滑，不能用 14 自动替代实际稳定边界。

### MACD_12_26_9

- declaredWarmup = 26
- 当前 audit fixture actualFirstValidIndex = 25
- effectiveWarmup = BLOCKED_PENDING_MULTI_STAGE_AUDIT

原因：MACD、signal、histogram 可能有不同 field-level validity；不能只看 plot0。

### SUPERTREND_10_3

- declaredWarmup = 10
- 当前 audit fixture 的 plot 输出在很早位置出现，但不同 plot 可能有不同 null/stability 行为。
- effectiveWarmup = BLOCKED_PENDING_MULTI_VALUE_AUDIT

原因：不能把早期 provisional plot 当作完整 Supertrend state。

## 5. Dependency Rule

Feature 的 effectiveWarmup = 所有必需依赖 output field 的 effectiveWarmup 最大值。

如果任一必需依赖为 BLOCKED：

Feature validity = BLOCKED 或 WARMUP，具体由未来 Feature Contract 决定，但不得猜测数值。

## 6. Explicit Non-goals

本 Contract 不：

- 修改 Registry warmupBars。
- 修改 Provider 算法。
- 修改 Adapter 输出。
- 修改 Multi-value Contract。
- 修改 DATA-07、Reward、Value-Q、RL Dataset 或 RL Training。

## Human Review

- [ ] 批准 declaredWarmup / actualFirstValidIndex / effectiveWarmup 三层语义。
- [ ] 批准 ADX_14 field-level effectiveWarmup。
- [ ] 批准 MACD 三个 output field 的 effectiveWarmup。
- [ ] 批准 Supertrend 多 output field 的 effectiveWarmup。
- [ ] 批准 BLOCKED effectiveWarmup 如何传播到 Feature validity。

## Final Gate

WARMUP_CONTRACT_STATUS = PROPOSAL_ONLY
IMPLEMENTATION_STATUS = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
