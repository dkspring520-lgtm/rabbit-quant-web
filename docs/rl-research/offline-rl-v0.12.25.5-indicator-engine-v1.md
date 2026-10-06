# OFFLINE RL V0.12.25.5 — Indicator Engine V1.0

Implementation date: 2026-10-05

本阶段建立独立的 Indicator Engine V1.0，作为 Research Infrastructure。它不产生交易信号，不修改策略、Reward、Canonical Schema、DATA-07、Value-Q 或 RL Training。

## Gate

T1_SEMANTICS_STATUS = PASS
INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Architecture

Market Data → Lightweight Charts Indicators Provider → Provider Adapter → Indicator Engine → Indicator Registry → Indicator Snapshot → Research / UI

实现位置：

- lib/indicators/registry.mjs
- lib/indicators/lightweight-charts-indicators-adapter.mjs
- lib/indicators/indicator-engine.mjs
- lib/indicators/audit.mjs
- lib/indicators/index.mjs

Provider：lightweight-charts-indicators@0.7.1，peer dependency：oakscriptjs@0.9.6。

业务代码不直接导入第三方指标库。第三方返回结构只存在于 Adapter 内部，Engine 对外统一输出 Indicator Output。

## 2. Registry Contract

第一阶段注册 29 个核心指标。每个 definition 都包含：

- id
- name
- category
- provider
- timeframe
- parameters
- warmupBars
- lookahead
- futureData
- uiEligible
- researchEligible
- rlEligible
- status

所有指标当前：

rlEligible = false
lookahead = false
futureData = false
status = PROPOSAL_ONLY 或 CUSTOM_CANDIDATE

Registry 拒绝重复 ID、缺失 metadata、非法 category、非法 warmup 或带 future-data 标记的 definition。

## 3. Initial Indicator Set

### Trend

EMA 5/10/20/60、VWMA 20、ADX 14、Supertrend 10/3。

### Momentum

RSI 14、MACD 12/26/9、KDJ 9、CCI 20、Williams %R 14、ROC 12。

### Volatility

Bollinger Bands 20/2、Bollinger Width 20、ATR 14、Historical Volatility 20。

### Volume / Flow

Session VWAP、OBV、MFI 14、CMF 20、Volume Delta、CVD、Relative Volume 20。

### Price Structure

Highest High 20、Lowest Low 20、EMA20 Distance、VWAP Distance、ATR-normalized Distance。

缺失 provider 的指标必须保持 UNAVAILABLE/CUSTOM_CANDIDATE，不得静默替换算法。本版本的 custom-causal 指标仅限显式定义的 VWAP、relative volume 和 price-distance 计算。

## 4. Unified API

engine.calculate(indicatorId, marketData, context)
engine.calculateSeries(indicatorId, marketData, context)
engine.snapshot(marketData, { symbol, timeframe, indicatorIds, asOfIndex })

单值 output 包含 indicatorId、timestamp、value 和 metadata。多值 output 使用稳定的业务名称，例如 macd、signal、histogram，不泄漏第三方 plots 或 plotCandles 内部结构。

## 5. Temporal Audit

Engine 只接受 timestamp 唯一且递增的 market data。asOfIndex 会截断输入到当前 observation，禁止读取未来 bars。

Audit 覆盖：

- prefix/full temporal invariance
- output timestamp alignment
- timestamp uniqueness
- timestamp ordering
- warm-up null behavior
- firstValidTimestamp

当前 Indicator Snapshot 只标记为 RESEARCH_ONLY，不包含 BUY、SELL、WAIT 或其他 action。

## 6. Warm-up and Null Semantics

Provider 返回的 null 保留在 series 中。Engine 不使用 filter(Boolean) 隐藏 warm-up 或无效值。

每次结果 metadata 记录：warmupBars、firstValidTimestamp、status、provider metadata、lookahead、futureData 和 rlEligible。

## 7. Failure Analysis Integration Boundary

未来可以把以下数据关联起来：

failure timestamp + market snapshot + indicator snapshot + execution event + failure label

当前不会使用指标反向修改 Failed Rebuy、Missed Trend、T+1 Constraint、Execution Timing Failure 或 Blocked Action。

## 8. RL Isolation

当前禁止：

- Indicator → DATASET
- Indicator → Reward
- Indicator → Value-Q
- Indicator → Policy
- Indicator → Training
- Indicator → Canonical Schema

Snapshot 只能供 Research、UI、未来 Feature Engine 使用。

## 9. Tests

新增 tests/indicator-engine.test.mjs，覆盖：

- Registry metadata、duplicate ID 和 RL isolation
- Provider adapter 单值/多值输出
- warm-up 与 null 保留
- temporal future invariance
- timestamp alignment
- snapshot research-only boundary
- duplicate/unordered timestamp rejection

## 10. Explicit Non-goals

本阶段没有：

- 修改 T+1 execution semantics
- 修改 Canonical Schema
- 修改 Reward Contract
- 修改 MACD/volume/price/T size 参数
- 修改 Expert Prior 或 Bidirectional T
- 生成 Value-Q target
- 生成 RL dataset
- 启动 RL training
- 根据指标直接产生交易信号

## Final Gate

T1_SEMANTICS_STATUS = PASS
INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
