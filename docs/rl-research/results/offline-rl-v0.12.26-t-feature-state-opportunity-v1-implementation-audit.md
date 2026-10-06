# OFFLINE RL V0.12.26 — T Feature / State / Opportunity V1 Implementation Audit

Audit date: 2026-10-05

## Final status

T_FEATURE_ENGINE_STATUS = IMPLEMENTED_RESEARCH_ONLY
T_STATE_ENGINE = IMPLEMENTED_RESEARCH_ONLY
T_OPPORTUNITY_ENGINE = IMPLEMENTED_RESEARCH_ONLY
T_DECISION_ENGINE = NOT_STARTED
T_FEATURE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
T1_SEMANTICS = PASS
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本审计对应 CORE_SAFE scope 的最小实现。WARMUP_CONTRACT_FINAL 和 MULTIVALUE_CONTRACT_FINAL 仍为 BLOCKED；未冻结字段没有进入核心状态转换。

## 1. Feature implementation

已实现 `lib/t-features/`：

- `feature-engine.mjs`：只使用 causal market data 与 CORE_SAFE 指标输入，生成 Trend、Position、Momentum、Volume、Volatility、Structure、Exhaustion snapshot。
- `feature-contract.mjs`：固定 `VALID/WARMUP/INVALID`、research-only 和 CORE_SAFE 依赖边界。
- `feature-audit.mjs`：检查 research boundary、有限数值和 lookahead 标记。
- `index.mjs`：公共导出。

Exhaustion 字段明确为 `STRUCTURAL_CANDIDATE`，不是交易信号。

## 2. State implementation

已实现 `lib/t-state/`：

- 使用现有 Contract 的状态命名，包括 `UPTREND`、`DOWNTREND`、`RANGE`、`TRANSITION`、加速、耗竭、`PULLBACK`、`REBOUND`、`WAIT_CONFIRMATION`、`POSITIVE_T_CANDIDATE` 和 `COUNTER_T_CANDIDATE`。
- 具备 entry/exit、invalid dependency、warmup propagation、minimum dwell 和 hysteresis hold 的研究实现。
- 状态只描述市场结构，不产生 BUY/SELL/AUTO_*。

`HIGH_LEVEL_EXHAUSTION → WAIT_CONFIRMATION → COUNTER_T_CANDIDATE` 与 `LOW_LEVEL_EXHAUSTION → REBOUND → WAIT_CONFIRMATION → POSITIVE_T_CANDIDATE` 均保留为状态链。

## 3. Opportunity implementation

已实现 `lib/t-opportunity/`。输出类型仅为：

- `POSITIVE_T_ENVIRONMENT`
- `COUNTER_T_ENVIRONMENT`
- `NEUTRAL`
- `INVALID`

`scoreMeaning = T_STRUCTURE_STRENGTH_ONLY`。该 score 不是胜率、期望收益、BUY/SELL 概率或交易许可。

## 4. Dependency Matrix

| Layer | Allowed in V1 | Boundary |
|---|---|---|
| Market | price/open/high/low/close/volume | causal prefix only |
| Indicator | VWAP, EMA, VWMA, RSI, ATR, MFI, Historical Volatility | provider output must be finite/available |
| Blocked | ADX DI, Supertrend extras, unresolved MACD/Bollinger/KDJ mappings | not used by core State |
| Research-only | Bar-derived Delta/CVD/pressure, ATR-normalized distance | not used by core State Transition |

## 5. Temporal audit

Feature, State and Opportunity consume only the current snapshot and observed prefix. Rolling windows are trailing windows. No future bar, outcome, action or reward is passed into the chain.

## 6. Leakage audit

`dependencies.temporal.lookahead = false` and `futureData = false` are emitted. Invalid or warmup dependencies are not converted to zero. No backtest outcome or post-action value is used.

## 7. Warmup boundary

The implementation does not redefine Provider warmup. A feature becomes usable only when its required CORE_SAFE values are available. Unresolved upstream warmup semantics remain visible as `WARMUP`/invalid rather than being guessed.

## 8. Multi-value boundary

No unresolved MACD, Bollinger, KDJ, ADX or Supertrend multi-value field is required by the core implementation. No pseudo-field is synthesized.

## 9. T+1 boundary

The engines accept optional portfolio context but do not calculate `sellablePosition`, `todayBought`, fills, fees or T+1. Those semantics remain exclusively in `PaperExecutionEngine` / execution semantics.

## 10. Failure Attribution boundary

`lib/t-observation.mjs` supplies a stable observation payload containing timestamped Feature, State and Opportunity snapshots. It does not create a Dataset, Reward artifact, Value-Q target or failure label.

## 11. UI data contract

The trading desk snapshot now exposes `tObservation` generated from the real `market.minutes` payload. 操盘台 V3 adds a compact `T辅助观察` panel showing trend, position, momentum, volume, volatility, state, environment and structure strength. It displays `研究层 · 不生成交易动作` and does not replace the main chart or formal signal layer.

## 12. Test result

- `npm test`: PASS, 1153/1153 tests.
- Added `tests/t-feature-state-opportunity.test.mjs` covering schema, causality, invalid propagation, state boundary, opportunity types and integration.

## 13. Build result

- `npm run build`: PASS.
- Existing Node compatibility and chunk-size warnings remain informational; no build failure occurred.

## 14. git diff --check

- `git diff --check`: PASS.

## 15. RL isolation

No Reward Contract、Canonical Schema、DATA-07、Value-Q、RL Dataset or training code was changed by this phase. The new outputs remain `researchOnly: true` and `rlEligible: false`.

## Human review required

1. Approve the CORE_SAFE formulas and threshold-free structural interpretation.
2. Resolve Provider warmup and multi-value contracts before admitting the blocked indicators.
3. Confirm the observation UI labels and state vocabulary against the final human contract.
4. Keep Decision Engine, Replay, Paper Trading promotion, Value-Q and RL Training behind the existing HARD_STOP.
