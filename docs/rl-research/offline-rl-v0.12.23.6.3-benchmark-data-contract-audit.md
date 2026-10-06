# OFFLINE RL V0.12.23.6.3 — Benchmark Data Contract Audit

Audit date: 2026-10-05

## Gate

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只审计 V0.12.23.6.2 Canonical Trading Schema 与 DATA-07 的映射，不执行回测、不生成 Dataset、Value-Q target 或训练数据。

## Overall Status

DATA_CONTRACT_STATUS = BLOCKED

原因：部分字段可由当前 price/volume source 和 PaperExecutionEngine 支持，但 Canonical State、action mapping、fill timing、feature availability 和 evaluation window 尚未全部冻结。

## 1. State Fields Availability

| Canonical field | DATA-07 / current evidence | Status | Notes |
|---|---|---|---|
| observedReferencePrice | source price → marketState.price | PARTIAL | 字段 lineage 可追踪，价格语义仍受限 |
| cash | 不属于 DATA-07；来自 execution/account scenario | DERIVABLE | 需要 replay/account initialization |
| position | 不属于 DATA-07；来自 execution/account state | DERIVABLE | 可由 execution path 维护 |
| sellablePosition | 不属于 DATA-07；来自 T+1 execution state | DERIVABLE | 需要真实日期转换 |
| todayBought | 不属于 DATA-07；来自 execution state | DERIVABLE | 需要保留当日买入状态 |
| averageCost | 不属于 DATA-07；来自 portfolio accounting | DERIVABLE | 需要批次/成本规则 |
| corePosition | DATA-07 不包含 | MISSING | 只能作为 approved scenario metadata |
| tPosition | DATA-07 不包含 | MISSING | 不能伪造为历史事实 |
| trendRegime | 不是原始字段 | DERIVABLE_CANDIDATE | 分类规则未冻结 |
| momentumPhase | 不是原始字段 | DERIVABLE_CANDIDATE | 阈值/窗口未冻结 |
| portfolioValueResearch | 非原始字段 | DERIVABLE_CANDIDATE | cash + position × observedReferencePrice |

结论：

STATE_SCHEMA = BLOCKED

## 2. Derived Feature Availability

### 可候选派生

- returns：可由当前和历史 price 派生。
- rolling volatility：可由历史 price 派生。
- volume change：可由 volume 派生。
- moving-average/momentum context：可由历史 price 派生。
- VWAP context：依赖可用 volume/amount 和既有计算规则。

### 条件可用

- MACD、RSI、KDJ、CCI、WR、BOLL：需要固定版本、窗口和输入规则；不能自动视为已批准 feature。
- ATR：需要真实 OHLC 或明确批准的替代定义；当前不得由缺失 OHLC 伪造。

### 当前缺失或未确认

- OFI。
- bid。
- ask。
- mid。
- spread。
- order-book imbalance。
- reliable trade direction。
- verified tick/event timestamp。

DERIVED_FEATURE_STATUS = PARTIAL

## 3. Missing Feature List

当前无法从 DATA-07/核心 Replay 直接确认：

- verified OHLC semantics。
- verified 1m bar close semantics。
- bid/ask/mid/spread。
- OFI/order-flow depth。
- provider-level timestamp semantics。
- corePosition/tPosition historical split。
- canonical momentum thresholds。
- opportunity classification thresholds。

缺失字段不得使用默认值、未来值或 synthetic reconstruction 填补。

## 4. Action Execution Feasibility

现有 execution/replay 生态可表达 WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL；Canonical T schema 还提出 WAIT、HOLD、SELL_T_5/8/10/15/20、BUY_BACK_5/10/FULL 等策略动作。

当前风险：

- 历史 action 与 canonical T action 没有批准的 mapping table。
- BUY_SMALL/BUY 与 T position allocation 的关系未冻结。
- SELL_PART/SELL_ALL 与 SELL_T 比例的关系未冻结。
- BUY_BACK action 的 observed support 未确认。
- blocked action、requested quantity 和 execution status 必须保留。

ACTION_EXECUTION_FEASIBILITY = BLOCKED_PENDING_CANONICAL_MAPPING

## 5. A-share Rounding Rules

已有 execution 代码/审计支持研究层的 100-share lot rounding 候选和 quantity rule，但 Benchmark Contract 仍需明确：

- requested quantity rounding。
- executed quantity rounding。
- SELL_T 百分比到整数手的转换。
- BUY_BACK_FULL 的剩余数量处理。
- cash constraint rounding。
- zero-quantity action 的处理。

不得为了满足比例而制造不可成交数量。

ROUNDING_STATUS = PARTIAL_PENDING_BENCHMARK_FREEZE

## 6. T+1 Constraints

现有 PaperExecutionEngine 审计已支持：

- BUY 增加 position。
- BUY 增加 todayBought。
- BUY 当日不立即增加 sellablePosition。
- next trading date 释放符合规则的库存。
- SELL 不得超过 sellablePosition。
- blocked execution 不改变现金/仓位/可卖仓位。

Canonical schema 能表达这些字段，但实际 benchmark implementation 尚未运行。

T1_SCHEMA_STATUS = PASS_AT_ENGINE_AUDIT_LEVEL
T1_BENCHMARK_STATUS = BLOCKED_PENDING_IMPLEMENTATION

## 7. Fill Timing

当前候选：

- NEXT_AVAILABLE_OBSERVATION_PRICE。
- NEXT_OBSERVATION_OPEN（只有真实 open 语义和字段通过审计时）。

禁止：

- 使用 future high/low。
- 使用区间极值成交。
- 使用不可观测价格回填 fill。

当前没有最终批准的 benchmark fill timing。

FILL_TIMING_STATUS = BLOCKED

## 8. Evaluation Window

候选：

- 15 bars。
- 30 bars。
- End Session。
- Next Session。

当前未选择最终窗口。每个窗口仍需定义：

- session boundary。
- T+1 release。
- terminal/open position。
- failed rebuy。
- missed rebuy。
- avoided drawdown。

EVALUATION_WINDOW_STATUS = BLOCKED

## 9. Expert Pattern Boundary

Expert Pattern 只能作为 candidate feature/pattern，例如急拉、异常成交量和 MACD 动能下降组合。

不得直接成为：

- 固定 SELL action。
- 固定 BUY_BACK action。
- 硬编码交易规则。
- 自动 reward penalty。

EXPERT_PRIOR_COMPATIBILITY = READY_FOR_REVIEW

## 10. Audit Summary

| Audit item | Status |
|---|---|
| State schema | BLOCKED |
| Derived features | PARTIAL |
| Action feasibility | BLOCKED |
| A-share rounding | PARTIAL |
| T+1 engine semantics | PASS at audit level |
| Fill timing | BLOCKED |
| Evaluation window | BLOCKED |
| Expert pattern separation | READY_FOR_REVIEW |

## Missing Items

1. Canonical State Schema freeze。
2. Canonical action mapping freeze。
3. Feature availability and missing-value policy。
4. Quantity/lot rounding freeze。
5. Fill timing freeze。
6. Evaluation window freeze。
7. Opportunity classification thresholds and windows。

## Recommended Next Step

不要执行 V0.12.23.6 benchmark。先完成人工批准的 Benchmark Implementation Contract，随后增加 synthetic/manual engine validation cases，最后再执行历史统计。

## Final Gate

BACKTEST_ENGINE = VALIDATION_ONLY
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
