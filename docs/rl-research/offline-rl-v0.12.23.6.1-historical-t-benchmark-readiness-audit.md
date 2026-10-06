# OFFLINE RL V0.12.23.6.1 — Historical T Benchmark Implementation Readiness Audit

Audit date: 2026-10-05

## Overall Status

STATUS = BLOCKED

本轮只审计实施条件，不执行历史回测、不生成 benchmark result、Dataset、Value-Q target 或训练模型。

## 1. State Definition Audit

### Market State

当前规格提及或依赖：price/Observed Reference Price、return/price movement context、volatility、volume、momentum、trend regime（UPTREND/DOWNTREND/RANGE）和 momentum phase（TREND_ACCELERATION/TREND_MATURE/MOMENTUM_EXHAUSTION/REVERSAL_CONFIRMED）。

但尚未形成固定、版本化、可验证的 state schema；其中 OHLC/ATR/OFI/盘口字段的真实可用性和语义仍有限制。

### Position State

当前规格提及 cash、position、sellablePosition、todayBought、averageCost、core position 和 T position ratio。

但 core_position/t_position 的持仓拆分尚未在现有 Replay/Dataset 中形成 canonical persisted schema。

STATE_SCHEMA = BLOCKED

缺失项：固定字段名、类型、来源、时间位置、缺失值规则、core/T 拆分规则和 portfolio value 计算边界。

## 2. Action Space Audit

Benchmark 规格当前可表达 WAIT、POSITIVE_T、REVERSE_T、BUY_BACK 以及固定正T/反T比例候选。

但尚未明确表达为可执行、无歧义的 canonical action set：SELL_5%、SELL_8%、SELL_10%、SELL_15%、SELL_20%、BUY_BACK_5%、BUY_BACK_10%、BUY_BACK_FULL 和 HOLD。

当前历史 Replay 使用 WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL 等 action；与上述 T action 的映射尚未批准。

T+1 和 Core/T position 原则已写入规格，但数量、最小交易单位、requested/executed quantity 和 blocked status 的完整 action contract 尚未冻结。

ACTION_SPACE_STATUS = BLOCKED

## 3. Reward / Evaluation Audit

本轮不生成 Reward，仅检查评价字段。

规格已覆盖：

### 收益

- T Profit。
- Total Return。
- Annualized Return。
- T Contribution。

### 成本

- Initial Cost。
- Final Effective Cost。
- Cost Reduction %。
- Cost Basis Improvement。

### 风险

- Maximum Drawdown。
- Avoided Drawdown。
- Failed Rebuy Risk。
- Missed Trend Risk。
- Worst Failed T。
- Missed Rebuy Rate。

### 交易质量

- T Success Rate。
- Average T Profit。
- Median T Profit。
- Profit Factor。
- Trade Frequency。

EVALUATION_SCHEMA = READY_FOR_IMPLEMENTATION_REVIEW

限制：这些是评价指标，不是 Reward Formula；真实计算仍需统一 execution、accounting、horizon 和 attribution 实现。

## 4. Opportunity Attribution Audit

规格已列出四类机会：Type A Capital Flow Spike + Momentum Exhaustion、Type B Technical Overbought Only、Type C Trend Breakout、Type D Range Reversal。

以及四个 Momentum Phase：TREND_ACCELERATION、TREND_MATURE、MOMENTUM_EXHAUSTION、REVERSAL_CONFIRMED。

但当前无法确认所有分类都能由现有历史数据稳定计算：

- OHLC/ATR 的 source semantics 仍受限。
- OFI/盘口失衡/主动买卖字段未在核心 Replay 中确认完整可用。
- MACD、RSI 等技术指标的版本化计算规则未在本 benchmark specification 中冻结。
- 分类阈值、窗口和互斥优先级未定义。

OPPORTUNITY_SCHEMA = BLOCKED

## 5. Data Leakage Audit

规格明确要求：

- action 只能使用 current observation 和历史 observations。
- 不使用 future high/low/close/volume。
- evaluation window 只用于结果统计。
- evaluation outcome 不进入 action decision。
- 按时间顺序执行，不随机拆分。

因此规格层规则完整：

LEAKAGE_STATUS = PASS_FOR_SPECIFICATION

注意：尚未运行实际 backtest，不能把该 PASS 解读为实现后的实证 PASS。

## 6. Missing Items

进入 Implementation 前必须补齐：

1. 固定 State Schema。
2. 固定 Canonical Action Schema 和数量映射。
3. 明确 Core/T position 的数据来源和拆分规则。
4. 明确 Opportunity Type 的指标、窗口、阈值和互斥优先级。
5. 确认 OHLC/ATR/OFI/盘口字段的真实可用性。
6. 固定执行 fill timing 和成本配置。
7. 固定 T outcome evaluation window。
8. 固定 avoided drawdown 的归因边界。
9. 增加 synthetic/manual engine validation cases。
10. 明确结果 artifact schema 和 provenance。

## 7. Recommended Next Step

不要直接执行 V0.12.23.6。

建议先补充一份 Implementation Contract，冻结 State schema、Action schema、Opportunity classification schema、Fill/timing schema、T+1 transition schema、Evaluation window 和 Result provenance。

完成后再进行历史 benchmark execution；本轮不生成结果。

## Final Gate

BACKTEST_ENGINE = VALIDATION_ONLY
BENCHMARK_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
