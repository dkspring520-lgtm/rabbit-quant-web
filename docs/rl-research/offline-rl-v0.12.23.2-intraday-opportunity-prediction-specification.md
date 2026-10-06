# OFFLINE RL V0.12.23.2 — Intraday Opportunity Prediction Specification

## Status

DIRECTION_MODEL = SPEC_ONLY
OPPORTUNITY_MODEL = SPEC_ONLY
ACTION_SPACE = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只定义未来盘中机会预测 Contract，不生成交易信号、Dataset、target、训练数据或模型。

## 1. Objective

目标不是预测买卖，也不是直接执行交易，而是估计：

Future T Opportunity Probability

核心问题：

当前市场和账户状态下，未来指定 horizon 是否存在足够的可交易 T 空间，足以覆盖已批准 accounting 中体现的交易成本和风险要求。

示例：当前 Observed Reference Price 为 34.00，未来 30 分钟候选输出可以包含上涨空间、下跌空间和可T概率；这些仅为研究预测，不是交易指令。

## 2. Output Design

### Direction Context

可引用 V0.12.23.1 的候选方向：

- UP
- DOWN
- RANGE

Direction Prediction 的输出不能被 Opportunity Model 重新解释为成交价格或已实现收益。

### Volatility Range

对每个候选 horizon 研究预测：

- High excursion：从 action-time observed reference price 到未来上行极值的候选幅度。
- Low excursion：从 action-time observed reference price 到未来下行极值的候选幅度。

这些未来 excursion 只能作为 label/target-side 研究结果，不得进入 action-time state feature。

### T Opportunity

候选输出：

- T_SCORE：0–100 的研究评分候选。
- opportunityProbability：未来存在足够 T 空间的概率候选。
- costCoverageStatus：是否可能覆盖已 accounting-closed 的交易成本门槛。

T_SCORE 不等于 reward，不等于 Value-Q，不等于交易信号置信度。

## 3. Horizon Candidates

候选 horizon：

- 5 bars：超短期空间候选。
- 15 bars：短期空间候选。
- 30 bars：T 周期空间候选。
- End Session：日内结束空间候选。

当前不选择最终 horizon。实际 bar frequency、trade_time 语义和 Observed Reference Price temporal semantics 仍受既有数据 Contract 限制。

OPPORTUNITY_HORIZON_SELECTED = NONE
OPPORTUNITY_HORIZON_STATUS = PROPOSAL_ONLY

## 4. Input Features

所有输入必须是 action-time causal information。

### Volatility

候选：

- ATR。
- 历史波动率。
- 真实波幅。
- 分钟收益标准差。

ATR/真实波幅需要真实 OHLC 或已批准的替代定义；不得创建 synthetic OHLC。

### Price Location

候选：

- 距离 VWAP。
- 距离均线。
- BOLL 位置。
- 日内高低点位置。

Observed Reference Price 不等同 verified close、last trade 或 executable price。

### Trading Behavior

候选：

- 成交量放大。
- 量价背离。
- 主动买卖差。
- OFI。
- 盘口失衡。

当前 Replay/source 不自动证明 OFI、bid、ask、mid 或盘口字段存在；不得补造缺失字段。

### Portfolio Context

机会预测应可读取研究所需的账户上下文：

- total_position。
- core_position。
- t_position。
- average_cost。
- available_sell_position。
- today_buy_amount。
- today_sell_amount。
- todayBought。
- sellablePosition。

这些字段不能被 Opportunity Model 修改，也不能绕过 T+1。

## 5. Opportunity Semantics

机会预测必须区分：

- 方向正确但价格空间不足。
- 方向不确定但波动空间足够。
- 价格空间足够但不可卖仓位受 T+1 限制。
- 理论空间存在但不足以覆盖风险和成本。
- 观察价格变化与真实可执行成交之间的语义差异。

避免将“方向预测正确”直接等同于“存在可盈利 T 机会”。

## 6. 与 T Policy 的连接

研究架构候选：

Market Data
  → Direction Prediction
  → Opportunity Prediction
  → Bidirectional T Policy
  → Value-Q
  → Final Action

示例：

Direction：上涨概率 65%。

Opportunity：T 空间候选评分 80。

Position：core_position 34000，存在可卖 T 仓。

Policy 候选：正T卖出 10%。

另一个示例：

Direction：下跌概率 70%。

Opportunity：波动空间候选评分 90。

Policy 候选：反T卖出 5%–10%。

这些只是架构示例，不生成真实 action 或 signal。

## 7. Policy-Level Discipline

连续 T 风险控制属于 Policy 层候选，不自动放入 Q target：

- Daily T Budget。
- Maximum T Count。
- Cooldown Period。
- Cooldown after success。
- Failed T cooldown。
- Confidence Threshold。
- Minimum cost coverage。
- Maximum position reduction without buyback。

目标是避免成功一次后在震荡中无限交易。

## 8. Evaluation Metrics

不得只看方向或机会分类准确率。候选指标：

- Opportunity Precision。
- 实际可交易机会捕获率。
- False T Signal Rate。
- Average Favorable Excursion。
- Average Adverse Excursion。
- T Opportunity Calibration Error。
- Cost Coverage Rate。
- Buyback Success Rate。
- Failed T Rate。
- Total T Profit。
- Average Cost Reduction。
- Maximum Drawdown。

评价必须使用时间顺序切分，不得把未来 excursion 回流到 feature。

## 9. Data and Leakage Boundary

允许：未来 excursion 作为独立 label/target-side diagnostic。

禁止：

- future price 进入 state feature。
- future volume 进入 state feature。
- terminal outcome 进入 action-time input。
- opportunity label 被写回 Replay/Dataset state。
- 用 future outcome 直接生成 observed action。
- 创建 synthetic OHLC、bid、ask、mid 或 timestamp。

## 10. Human Review Gate

必须人工批准：

- Opportunity semantics。
- Horizon。
- High/Low excursion 定义。
- Cost coverage 规则。
- T_SCORE 计算方式。
- Direction Model 与 Opportunity Model 的接口。
- Portfolio/T+1 feasibility 规则。
- Evaluation split 和 calibration 标准。
- 与 Bidirectional T Policy 的连接。

## Explicit Non-goals

禁止：

- 生成交易信号。
- 生成 Dataset。
- 生成 Value-Q target。
- 训练 Opportunity Model。
- RL training。
- 修改 Reward Contract。
- 修改 Action Space。
- 修改 Replay 或生产交易逻辑。

## Final Gate

DIRECTION_MODEL = SPEC_ONLY
OPPORTUNITY_MODEL = SPEC_ONLY
ACTION_SPACE = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
