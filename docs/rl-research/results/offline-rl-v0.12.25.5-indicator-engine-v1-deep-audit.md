# 做T神器 — Indicator Engine V1.0 Deep Audit

Audit date: 2026-10-05

本报告只做 Registry、Provider、时间因果、warm-up、alignment、输出契约和研究隔离审计。不扩展指标，不修改策略、Reward、Canonical Schema、DATA-07、Value-Q 或 RL。

## Final Status

INDICATOR_DEEP_AUDIT = BLOCKED_FOR_HUMAN_REVIEW
TEMPORAL_AUDIT = PASS
ALIGNMENT_AUDIT = PASS
REGISTRY_AUDIT = PASS
PROVIDER_EXPORT_AUDIT = PASS
WARMUP_SEMANTICS = BLOCKED
MULTI_VALUE_CONTRACT = BLOCKED
FLOW_SEMANTICS = BLOCKED_FOR_V2_INTERPRETATION

INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Registry and Provider Audit

Provider export audit：22 个 provider-backed indicator 的 export 均存在；7 个指标明确标记为 custom-causal/custom candidate。没有发现静默替换为其他算法的情况。

| indicatorId | name | category | provider | implementationSource | parameters | warmupBars | multiValue | researchEligible | rlEligible | status |
|---|---|---|---|---|---|---:|---|---|---|---|
| EMA_5 | EMA 5 | trend | lightweight-charts-indicators | EMA | length=5 | 5 | no | true | false | PROPOSAL_ONLY |
| EMA_10 | EMA 10 | trend | lightweight-charts-indicators | EMA | length=10 | 10 | no | true | false | PROPOSAL_ONLY |
| EMA_20 | EMA 20 | trend | lightweight-charts-indicators | EMA | length=20 | 20 | no | true | false | PROPOSAL_ONLY |
| EMA_60 | EMA 60 | trend | lightweight-charts-indicators | EMA | length=60 | 60 | no | true | false | PROPOSAL_ONLY |
| VWMA_20 | VWMA 20 | trend | lightweight-charts-indicators | VWMA | length=20 | 20 | no | true | false | PROPOSAL_ONLY |
| ADX_14 | ADX 14 | trend | lightweight-charts-indicators | ADX | length=14 | 14 | no | true | false | PROPOSAL_ONLY |
| SUPERTREND_10_3 | Supertrend 10/3 | trend | lightweight-charts-indicators | Supertrend | length=10,factor=3 | 10 | yes | true | false | PROPOSAL_ONLY |
| RSI_14 | RSI 14 | momentum | lightweight-charts-indicators | RSI | length=14 | 14 | no | true | false | PROPOSAL_ONLY |
| MACD_12_26_9 | MACD 12/26/9 | momentum | lightweight-charts-indicators | MACD | fast=12,slow=26,signal=9 | 26 | yes | true | false | PROPOSAL_ONLY |
| KDJ_9 | KDJ 9 | momentum | lightweight-charts-indicators | KDJ | length=9 | 9 | yes | true | false | PROPOSAL_ONLY |
| CCI_20 | CCI 20 | momentum | lightweight-charts-indicators | CCI | length=20 | 20 | no | true | false | PROPOSAL_ONLY |
| WILLIAMS_R_14 | Williams %R 14 | momentum | lightweight-charts-indicators | WilliamsPercentRange | length=14 | 14 | no | true | false | PROPOSAL_ONLY |
| ROC_12 | ROC 12 | momentum | lightweight-charts-indicators | ROC | length=12 | 12 | no | true | false | PROPOSAL_ONLY |
| BOLLINGER_20_2 | Bollinger Bands 20/2 | volatility | lightweight-charts-indicators | BollingerBands | length=20,mult=2 | 20 | yes | true | false | PROPOSAL_ONLY |
| BOLLINGER_WIDTH_20 | Bollinger Width 20 | volatility | lightweight-charts-indicators | BBBandWidth | length=20,mult=2 | 20 | no | true | false | PROPOSAL_ONLY |
| ATR_14 | ATR 14 | volatility | lightweight-charts-indicators | ATR | length=14 | 14 | no | true | false | PROPOSAL_ONLY |
| HISTORICAL_VOLATILITY_20 | Historical Volatility 20 | volatility | lightweight-charts-indicators | HistoricalVolatility | length=20 | 20 | no | true | false | PROPOSAL_ONLY |
| VWAP_SESSION | Session VWAP | volume | custom-causal | explicit cumulative amount/volume fallback | none | 1 | no | true | false | CUSTOM_CANDIDATE |
| OBV | On Balance Volume | volume | lightweight-charts-indicators | OBV | none | 1 | no | true | false | PROPOSAL_ONLY |
| MFI_14 | MFI 14 | volume | lightweight-charts-indicators | MFI | length=14 | 14 | no | true | false | PROPOSAL_ONLY |
| CMF_20 | Chaikin Money Flow 20 | volume | lightweight-charts-indicators | ChaikinMF | length=20 | 20 | no | true | false | PROPOSAL_ONLY |
| VOLUME_DELTA | Volume Delta | volume | lightweight-charts-indicators | VolumeDelta | none | 1 | yes declared | true | false | PROPOSAL_ONLY |
| CVD | Cumulative Volume Delta | volume | lightweight-charts-indicators | CumulativeVolumeDelta | none | 1 | no | true | false | PROPOSAL_ONLY |
| RELATIVE_VOLUME_20 | Relative Volume 20 | volume | custom-causal | explicit rolling volume ratio | length=20 | 20 | no | true | false | CUSTOM_CANDIDATE |
| HIGHEST_HIGH_20 | Highest High 20 | priceStructure | custom-causal | explicit rolling high | length=20 | 20 | no | true | false | CUSTOM_CANDIDATE |
| LOWEST_LOW_20 | Lowest Low 20 | priceStructure | custom-causal | explicit rolling low | length=20 | 20 | no | true | false | CUSTOM_CANDIDATE |
| EMA20_DISTANCE | EMA20 Distance | priceStructure | custom-causal | explicit causal EMA distance | length=20 | 20 | no | true | false | CUSTOM_CANDIDATE |
| VWAP_DISTANCE | VWAP Distance | priceStructure | custom-causal | price/session VWAP distance | none | 1 | no | true | false | CUSTOM_CANDIDATE |
| ATR_NORMALIZED_DISTANCE | ATR-normalized Distance | priceStructure | custom-causal | explicit range-based candidate | atrLength=14 | 14 | no | true | false | CUSTOM_CANDIDATE |

## 2. Provider Findings

### PASS — Export Availability

All provider-backed exports used by the registry were available in the installed provider module.

### FINDING — Volume Delta / CVD Meaning

The provider can calculate Volume Delta and CVD from the supplied Bar input, but DATA-07 V1 input is OHLCV-like data and does not contain verified tick direction, Level2, active buy/sell prints or true OFI. Therefore:

- VOLUME_DELTA is a provider-derived bar calculation, not verified microstructure order flow.
- CVD is also not evidence of true Tick/L2 cumulative delta.
- These outputs must not be described as V2 Order Flow evidence.

FLOW_SEMANTICS = BLOCKED_FOR_V2_INTERPRETATION

### FINDING — Declared Multi-value Mismatch

VOLUME_DELTA is declared as multi-value in the registry, while the adapter currently exposes the provider candle close as a single normalized value. This needs human review before UI or research consumers rely on a multi-value contract.

MULTI_VALUE_CONTRACT = BLOCKED

## 3. Warm-up Audit

Temporal and alignment checks passed for all 29 indicators on the audit fixture. Actual first-valid positions were not identical to every declared warmupBars value:

- EMA/VWMA/Bollinger/CCI: first valid index commonly equals warmupBars - 1.
- ADX_14: first valid index was 27, later than declared 14.
- SUPERTREND_10_3: output contained early values before the declared warmup boundary and some subplots remained null.
- MACD_12_26_9: first valid index was 25, while declared warmupBars is 26.

This is not silently corrected. It is recorded as a metadata contract finding.

WARMUP_SEMANTICS = BLOCKED

Required human decision: whether warmupBars means minimum input count, first valid zero-based index, or provider-specific effective warm-up. No automatic metadata change was made.

## 4. Temporal Audit

Result: PASS for all 29 registered indicators on prefix/full comparisons at multiple checkpoints.

The audit compared each fixed-index prefix result with the same index in the full-session result. No future suffix changed the tested values.

TEMPORAL_AUDIT = PASS

## 5. Alignment Audit

Result: PASS.

- Input timestamps were unique and ordered.
- Output counts matched input counts.
- Output timestamps remained aligned to input timestamps.
- Duplicate and reversed timestamps were rejected by the Engine.

ALIGNMENT_AUDIT = PASS

## 6. Snapshot and RL Boundary Audit

Indicator Snapshot is marked RESEARCH_ONLY and rlEligible=false. No indicator output is connected to:

- DATA-07
- Reward
- Value-Q
- Policy
- RL Dataset
- RL Training
- Canonical Schema

RL_INTEGRATION = BLOCKED

## 7. Findings Requiring Human Review

1. Decide the canonical meaning of warmupBars versus provider first-valid index.
2. Decide whether VOLUME_DELTA/CVD may be shown only as V1 bar-derived candidates, never as V2 microstructure evidence.
3. Decide whether VOLUME_DELTA should remain single-value normalized output or receive an explicit multi-value output contract.
4. Decide whether ATR_NORMALIZED_DISTANCE remains CUSTOM_CANDIDATE until its true-range formula is separately specified.

No code, strategy threshold, Reward, Dataset, Value-Q or RL change was made for these findings.

## Final Gate

INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
INDICATOR_DEEP_AUDIT = BLOCKED_FOR_HUMAN_REVIEW
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
