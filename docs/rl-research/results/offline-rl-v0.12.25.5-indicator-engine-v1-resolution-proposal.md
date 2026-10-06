# Indicator Engine V1.0 — Audit Findings Resolution Proposal

Proposal date: 2026-10-05

本文件只分析 Deep Audit findings，提出候选 contract，等待人工批准。不实施任何修复，不修改现有代码、数据或研究协议。

## Final Status

RESOLUTION_STATUS = PROPOSAL_ONLY
IMPLEMENTATION_STATUS = NOT_STARTED
INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

## 1. Executive Summary

Deep Audit 没有发现未来数据泄漏或 timestamp alignment failure，但发现三个需要人工冻结的 contract 问题：

1. Registry warmupBars 与 Provider 实际首个非 null 输出不是同一个稳定语义。
2. Multi-value 指标的 provider plot、Adapter normalized output 和 Registry metadata 不完全一致。
3. Bar-derived Volume Delta/CVD 不能描述为 Tick/L2/真实订单流。

另外，ATR-normalized Distance 仍是 CUSTOM_CANDIDATE，尚未形成正式公式 contract。

## 2. Warmup Semantics Findings

以下 first-valid index 来自当前 audit fixture 的 Provider 输出，是诊断证据，不是自动修改建议：

| indicatorId | declaredWarmupBars | actualFirstValidIndex | providerBehavior | possibleReason |
|---|---:|---:|---|---|
| EMA_5 | 5 | 4 | 第 5 个输入点产生值 | zero-based index |
| EMA_10 | 10 | 9 | 第 10 个输入点产生值 | zero-based index |
| EMA_20 | 20 | 19 | 第 20 个输入点产生值 | rolling length |
| EMA_60 | 60 | 59 | 第 60 个输入点产生值 | rolling length |
| VWMA_20 | 20 | 19 | 第 20 个输入点产生值 | rolling length |
| ADX_14 | 14 | 27 | 明显晚于 length | 方向移动与多阶段平滑 |
| SUPERTREND_10_3 | 10 | 1 | plot0 很早出现，其他 plot 可能仍 null | 多 plot 稳定性不同 |
| RSI_14 | 14 | 14 | 接近 length | 涨跌变化需要前置点 |
| MACD_12_26_9 | 26 | 25 | 接近 slow length | signal/histogram 可能另有稳定期 |
| KDJ_9 | 9 | 8 | 第 9 个输入点产生值 | zero-based index |
| BOLLINGER_20_2 | 20 | 19 | rolling window 首值 | rolling length |
| ATR_14 | 14 | 13 | rolling window 首值 | true-range window |
| HISTORICAL_VOLATILITY_20 | 20 | 20 | 晚于 length | return 差分需要额外点 |
| MFI_14 | 14 | 13 | rolling window 首值 | provider 差分语义 |
| OBV | 1 | 1 | 需要方向上下文 | 首点保持 null |

可能原因包括：Provider 算法需要更长数学 warmup、Provider 输出 provisional value、Adapter 保留 null 但未区分 stable validity、以及多阶段指标没有单一 first-valid 定义。

## 3. Warmup Contract Candidates

### Candidate A — Theoretical Input Warmup

warmupBars = 理论最小输入长度；另增加 firstValidIndex、firstValidTimestamp，未来可增加 stableValidIndex。

影响：UI、Replay、Research 和 Feature Engine 可以区分 input-ready、non-null 和 stable-ready。

### Candidate B — Observed Provider First Valid

warmupBars = 当前 Provider 首个非 null 输出位置。

风险：Provider 版本变化会改变 contract；多值指标不同 plot 可能有不同边界；数学稳定性会被错误等同于 non-null。

### Candidate C — Dual Boundary Contract

同时保留：

- declaredWarmupBars：理论输入边界
- firstValidIndex：实际非 null 边界
- stableValidIndex：经人工定义的稳定边界，未定义时为 null

RECOMMENDED_WARMUP_CONTRACT = PROPOSAL_ONLY / CANDIDATE_C_DUAL_BOUNDARY

当前不实施 Candidate C。

## 4. Multi-value Contract Findings

| indicatorId | Provider output | Current normalized expectation | Finding |
|---|---|---|---|
| MACD_12_26_9 | plot0/plot1/plot2 | macd/signal/histogram | 可归一化，需固定顺序 |
| BOLLINGER_20_2 | plot0/plot1/plot2 | upper/basis/lower | 可归一化，需固定顺序 |
| KDJ_9 | plot0/plot1/plot2 | k/d/j | 可归一化，需固定顺序 |
| ADX_14 | 当前主要暴露 plot0 | adx/plusDI/minusDI | plusDI/minusDI 当前不可宣称可用 |
| SUPERTREND_10_3 | 当前暴露三个 plot | value/direction/upper/lower | Registry 四字段与 Provider 数量不一致 |
| VOLUME_DELTA | plotCandles.delta.close | Registry 声明 multi-value | Adapter 当前偏向单值 delta |
| CVD | plotCandles.cvd.close | 单值 CVD | 可作为单值 bar-derived CVD |

## 5. Multi-value Normalization Candidates

Candidate A：稳定命名对象，例如 MACD 为 macd/signal/histogram、Bollinger 为 upper/middle/lower、KDJ 为 k/d/j。

Candidate B：保留 plot0/plot1/plot2。风险是业务层泄漏 Provider 结构。

Candidate C：稳定命名对象加 availableFields、unavailableFields、providerPlotMap、providerVersion、firstValidByField。

RECOMMENDED_MULTI_VALUE_CONTRACT = PROPOSAL_ONLY / CANDIDATE_C

当前不实施任何候选。

## 6. Flow Semantics Findings

当前 V1 输入是 Bar OHLCV，因此：

- VOLUME_DELTA 只能称为 Bar-derived Volume Delta。
- CVD 只能称为 Bar-derived CVD。
- 不能称为 Tick Order Flow、L2 Order Flow、真实逐笔主动买卖或真实盘口 OFI。

FLOW_SEMANTICS = BLOCKED_FOR_V2_INTERPRETATION

## 7. Bar Flow / Tick Flow / L2 Flow Architecture

OHLCV → Bar-derived Flow Engine → Bar Volume Delta / Bar-derived CVD

Tick/Trades → Tick Flow Engine → Trade Direction / Tick Delta / Tick CVD / Speed

Level2/Order Book → L2 Flow Engine → OFI / Depth Imbalance / Spread / Queue Change

三层必须保持独立 lineage、source schema、timestamp semantics 和 missing-data semantics。V1 输出不得填充 V2/V3 字段。

## 8. ATR-normalized Distance Candidates

当前保持：

ATR_NORMALIZED_DISTANCE = CUSTOM_CANDIDATE

Candidate A：signed = (price - referencePrice) / ATR。保留方向，ATR 为零时 undefined。

Candidate B：unsigned = abs(price - referencePrice) / ATR。只表达距离大小，丢失方向。

Candidate C：signed epsilon-clamped = (price - referencePrice) / max(ATR, epsilon)。保留方向但 epsilon 会影响低波动样本尺度，必须版本化。

所有候选都必须使用 causal referencePrice 和 causal ATR，不得使用未来 high/low/close。

RECOMMENDED_ATR_DISTANCE_CONTRACT = PROPOSAL_ONLY / HUMAN_REVIEW_REQUIRED

## 9. Recommended Contract

本提案推荐但不实施：

- Warmup：Candidate C dual boundary。
- Multi-value：Candidate C named object + availability metadata。
- Flow：严格区分 Bar-derived、Tick-derived、L2-derived。
- ATR distance：继续 CUSTOM_CANDIDATE，不进入 RL 或正式策略。

## 10. Human Review Required

人工必须决定：

- warmupBars 与 firstValidIndex/stableValidIndex 的关系。
- ADX、Supertrend、MACD 的多阶段 warmup 解释。
- VOLUME_DELTA 的 single-value/multi-value contract。
- ADX plusDI/minusDI 是否在当前 Provider 可用。
- Supertrend 缺失 plot 的处理语义。
- Bar-derived Flow 是否只允许作为 V1 candidate。
- ATR-normalized Distance 的 referencePrice、signed/unsigned 和 epsilon 语义。

## 11. Implementation Not Started

本轮没有修改 Registry、Adapter、Indicator Engine、Warmup、Multi-value Contract、Flow semantics、ATR Distance、DATA-07、Canonical Schema、Reward、Policy、Expert Prior、Value-Q 或 RL Training。

## Final Gate

RESOLUTION_STATUS = PROPOSAL_ONLY
IMPLEMENTATION_STATUS = NOT_STARTED
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
