# OFFLINE RL V0.12.23.1 — Direction Prediction Specification

## Gate

DIRECTION_MODEL = SPEC_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只定义未来方向预测 Contract，不生成交易信号、Dataset、训练数据或模型。

## 1. Objective

目标是预测未来短周期市场状态，而不是直接交易，也不是直接输出买卖点。

模型输出 Future Direction Probability，候选方向类别为 UP、DOWN、RANGE。

方向预测结果只能作为后续 T Policy / Q Model 的研究输入候选，不能自动转化为交易动作。

## 2. Prediction Horizon

候选 horizon：

- 5 bars：候选解释约为 5 分钟，但实际 bar frequency 和 timestamp semantics 必须先审核。
- 15 bars：候选解释约为 15 分钟，需要明确跨 session、午休和缺失 observation 规则。
- 30 bars：候选解释约为 30 分钟，需要明确 T+1、持仓区间和 terminal 边界。
- End Session：候选解释为当前交易 session 结束，需要明确 open position 和 terminal valuation。

PREDICTION_HORIZON_SELECTED = NONE
PREDICTION_HORIZON_STATUS = PROPOSAL_ONLY

## 3. Output Contract

每个 horizon 输出 UP、DOWN、RANGE 概率分布。

示例：

5 bars: UP 0.62, DOWN 0.21, RANGE 0.17。

15 bars: UP 0.58, DOWN 0.25, RANGE 0.17。

候选约束：概率为 finite numeric、处于 0 到 1，并在同一 horizon 内合计为 1。缺失输入不得用未来数据或人工默认方向补齐。

## 4. Input Features

### Market

候选：price、OHLCV、VWAP、均价偏离、成交量变化、波动率、ATR、trend_state。

当前 source semantics 未全部验证；不得创建 synthetic OHLC。Observed Reference Price 不等同于 verified close、last trade 或 executable price。

### Technical

候选：MACD、KDJ、CCI、WR、BOLL、RSI。

技术指标必须满足 action-time causality，避免未来泄漏和对同一价格信息的重复计票。缺失输入不得用未来值或伪造值替代。

### Order Flow

候选：OFI、主动买卖、盘口压力、成交方向。

当前 Replay/source 不能自动证明这些字段可用。bid/ask/mid/盘口字段禁止补造；缺失时必须标记 unavailable。

## 5. 与 T Policy 的关系

候选架构：

Market Data → Direction Prediction Model → UP/DOWN/RANGE Probability → Bidirectional T Policy / Q Model → WAIT / POSITIVE_T / REVERSE_T / BUY_BACK。

边界：Direction Model 不直接生成交易信号，不改变 Reward Contract，不替代账户状态、sellablePosition、todayBought、T+1 或 execution feasibility。Q Model 仍受 VALUE_Q_TARGET = BLOCKED 约束。

## 6. 不允许事项

当前阶段禁止：

- 生成交易信号或买卖点。
- 生成 Dataset、训练数据或模型。
- 训练方向模型、Value-Q 或 RL。
- 修改 Replay、Reward、Action Space 或生产交易逻辑。
- 创建 synthetic OHLC 或 fabricated bid/ask/mid。
- 使用未来 feature、未来 label 或 terminal outcome 作为 state input。

只定义 Prediction Contract。

## 7. Evaluation Metrics

不得只看 accuracy。候选指标：

- Directional Accuracy。
- Precision UP。
- Precision DOWN。
- Calibration Error。
- Profit-weighted Accuracy。
- False Signal Rate。

评价必须按 horizon 分开，使用时间顺序切分，检查类别不平衡、概率 calibration，以及大幅错误预测是否抵消多个小盈利。评价结果不得自动改变正式交易策略。

60% accuracy 不等于可盈利，也不等于可部署。

## 8. Human Review Gate

必须人工批准：Direction label definition、5/15/30 bars 与 End Session horizon、UP/DOWN/RANGE threshold、feature availability、OHLC/VWAP/ATR 数据语义、order-flow 来源、calibration metrics，以及与 Bidirectional T Policy 的接口。

## Explicit Non-goals

禁止 Value-Q target generation、Dataset generation、Training data generation、Model training、RL training，以及自动进入 V0.12.24。

## Final Gate

DIRECTION_MODEL = SPEC_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
