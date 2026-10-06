# OFFLINE RL V0.12.25.5 — Indicator Contract Final Human Review V1

Review date: 2026-10-05

审查对象：

- offline-rl-v0.12.25.5-indicator-warmup-contract-v1.md
- offline-rl-v0.12.25.5-indicator-multivalue-contract-v1.md
- offline-rl-v0.12.25.5-indicator-engine-v1-deep-audit.md

本文件只完成 Human Review Package，不实施任何代码或 Contract 修改。

## Final Status

WARMUP_CONTRACT_FINAL = BLOCKED
MULTIVALUE_CONTRACT_FINAL = BLOCKED
CORE_FEATURE_DEPENDENCIES = PASS
IMPLEMENTATION_BLOCKER = FALSE_FOR_CORE_SAFE_SCOPE

INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
T_FEATURE_ENGINE_STATUS = SPECIFICATION_ONLY
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

## 1. Warmup Contract Review

最终确认三层关系：

- declaredWarmup：Registry 理论输入窗口，不代表 Provider 首个有效输出。
- actualFirstValidIndex：固定 Provider、参数和 fixture 下观察到的首个非 null 输出。
- effectiveWarmup：经过 audit 后，允许作为 Feature 输入的最早安全位置。

Feature 只能依赖 effectiveWarmup。不得把 declaredWarmup 自动当作有效边界，也不得因为 actualFirstValidIndex 较早就自动批准。

### Audited Indicators

| Indicator | declaredWarmup | actualFirstValidIndex | effectiveWarmup review |
|---|---:|---:|---|
| ADX_14 | 14 | 27 | BLOCKED_PENDING_FORMAL_STABILITY_RULE |
| MACD_12_26_9 | 26 | 25 | BLOCKED_PENDING_FIELD_LEVEL_WARMUP |
| SUPERTREND_10_3 | 10 | 1 for early plot output | BLOCKED_PENDING_MULTI_VALUE_STABILITY_RULE |
| EMA_5/10/20/60 | 5/10/20/60 | length-1 observed | CANDIDATE_SAFE_AFTER_AUDIT |
| VWMA_20 | 20 | 19 observed | CANDIDATE_SAFE_AFTER_AUDIT |
| RSI_14 | 14 | 14 observed | CANDIDATE_SAFE_AFTER_AUDIT |
| ATR_14 | 14 | 13 observed | CANDIDATE_SAFE_AFTER_AUDIT |
| Bollinger_20_2 | 20 | 19 observed | BLOCKED_WITH_MULTIVALUE_CONTRACT |
| KDJ_9 | 9 | 8 observed | BLOCKED_WITH_MULTIVALUE_CONTRACT |
| MFI_14 | 14 | 13 observed | CANDIDATE_SAFE_AFTER_AUDIT |
| Historical Volatility 20 | 20 | 20 observed | CANDIDATE_SAFE_AFTER_AUDIT |

结论：Warmup Proposal 的 dual-boundary 方向正确，但 ADX、MACD、Supertrend 尚未有正式 stable-validity 决策，因此 WARMUP_CONTRACT_FINAL 不能标记 PASS。

## 2. Multi-value Contract Review

Provider 实际输出优先于 Registry 推测：

| Indicator | Provider fact | Feature dependency status |
|---|---|---|
| MACD | plot0/plot1/plot2 | OPTIONAL_BLOCKED_PENDING_SEMANTIC_MAPPING |
| Bollinger | plot0/plot1/plot2 | OPTIONAL_BLOCKED_PENDING_SEMANTIC_MAPPING |
| KDJ | plot0/plot1/plot2 | OPTIONAL_BLOCKED_PENDING_SEMANTIC_MAPPING |
| ADX | 当前主要可验证 plot0 | plusDI/minusDI = NOT_AVAILABLE |
| Supertrend | 当前可验证 plot 数少于 Registry 预期字段 | extra fields = BLOCKED |
| Volume Delta | plotCandles.delta.close | RESEARCH_ONLY_BAR_DERIVED_SCALAR |
| CVD | plotCandles.cvd.close | RESEARCH_ONLY_BAR_DERIVED_SCALAR |

不得补齐伪字段，不得把 plot index 静默当作业务语义，不得把缺失字段填充为 0。

MULTIVALUE_CONTRACT_FINAL = BLOCKED。

## 3. Safe Dependency Matrix

### CORE_SAFE

以下字段可以作为 Core-Safe Feature V1 的候选依赖，前提是单条输出 valid=true 且达到 effectiveWarmup：

- price
- open/high/low/close（仅在真实字段存在时）
- volume
- timestamp / symbol / timeframe / session boundary
- Session VWAP（custom-causal，需标记 Bar-derived 和 amount fallback 语义）
- EMA_5 / EMA_10 / EMA_20 / EMA_60
- VWMA_20
- RSI_14
- ATR_14
- MFI_14
- Historical Volatility 20

这些依赖不得自动进入 DATA-07、Reward、Value-Q 或 RL。

### OPTIONAL_BLOCKED

- ADX plusDI/minusDI
- Supertrend extra fields
- MACD semantic field mapping
- Bollinger upper/middle/lower semantic mapping
- KDJ k/d/j semantic mapping
- 任何依赖未批准 effectiveWarmup 的字段

### RESEARCH_ONLY

- Bar-derived Volume Delta
- Bar-derived CVD
- Bar-derived buying/selling pressure candidate
- ATR_NORMALIZED_DISTANCE CUSTOM_CANDIDATE

RESEARCH_ONLY 不代表真实 Tick/L2 Order Flow，也不代表 RL-ready。

## 4. Blocked Dependency Matrix

| Dependency | Block reason | Allowed use |
|---|---|---|
| ADX plusDI/minusDI | Provider output not verified | 不可作为 Feature dependency |
| Supertrend direction/extra fields | output field contract incomplete | observation-only / blocked |
| MACD named fields | plot semantic mapping not finally approved | optional proposal only |
| Bollinger named fields | plot ordering contract pending | optional proposal only |
| KDJ named fields | plot ordering contract pending | optional proposal only |
| Bar-derived Volume Delta/CVD | not real Tick/L2 flow | research-only attribution |

## 5. Feature Impact

Core-Safe scope仍可支持有限的 T Feature 规格：

- price velocity / acceleration
- distance to VWAP
- EMA distance
- ATR ratio
- RSI-based momentum candidate
- relative volume candidate
- basic volatility and structure candidate

Optional blocked scope不能用于已批准的 Feature implementation。Feature Engine 必须对 blocked dependency 返回 WARMUP、INVALID 或 BLOCKED，不得伪造值。

因此，本审计不会阻塞全部 T Feature 未来实现，只限制依赖未冻结字段的分支。

## 6. Temporal Safety

现有 Indicator Deep Audit：

TEMPORAL_AUDIT = PASS

本 Review 保持：

- Feature(t) 只能使用 MarketData <= t。
- effectiveWarmup 只能由当前及历史 audit 结果确定。
- blocked dependency 不得用未来值补齐。
- outcome/action/reward 不得进入 Feature validity 或 State transition。

## 7. Leakage Safety

当前没有发现：

- future bar input
- future close/high/low/volume
- future indicator
- future action/reward
- centered window

FLOW_SEMANTICS 仍不能升级为真实 Tick/L2 语义。

## 8. Human Review Items

- [ ] 批准 ADX_14 effectiveWarmup 语义。
- [ ] 批准 MACD field-level effectiveWarmup。
- [ ] 批准 Supertrend field-level effectiveWarmup。
- [ ] 批准 MACD/Bollinger/KDJ named output mapping。
- [ ] 确认 ADX plusDI/minusDI 在当前 Provider 中保持 NOT_AVAILABLE。
- [ ] 确认 Supertrend extra fields 保持 BLOCKED。
- [ ] 确认 Volume Delta/CVD 只能标记 BAR_DERIVED_FLOW。
- [ ] 确认 Core-Safe Feature 依赖集合。
- [ ] 确认 OPTIONAL_BLOCKED 不阻塞 Core-Safe implementation。

## 9. Implementation Boundary

本轮没有：

- 修改 Indicator Engine
- 修改 Adapter
- 修改 Registry
- 修改 T Feature Engine
- 修改 T State Engine
- 修改 T Opportunity Engine
- 修改 UI
- 修改 Reward、Dataset、Value-Q 或 RL
- 修改 T+1 或 PaperExecutionEngine

CORE_FEATURE_DEPENDENCIES = PASS
OPTIONAL_DEPENDENCIES = BLOCKED
IMPLEMENTATION_BLOCKER = FALSE_FOR_CORE_SAFE_SCOPE

## Final Gate

WARMUP_CONTRACT_FINAL = BLOCKED
MULTIVALUE_CONTRACT_FINAL = BLOCKED
CORE_FEATURE_DEPENDENCIES = PASS
IMPLEMENTATION_BLOCKER = FALSE_FOR_CORE_SAFE_SCOPE
INDICATOR_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
T_FEATURE_ENGINE_STATUS = SPECIFICATION_ONLY
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
