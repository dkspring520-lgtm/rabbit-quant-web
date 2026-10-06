# OFFLINE RL V0.12.22.1 — Trading Objective Specification

## Status

VALUE_Q_TARGET = BLOCKED
TARGET_GENERATOR = PROPOSAL_ONLY
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

本文件只定义 Offline RL 做T任务的优化目标，不生成 Value-Q target、Dataset 或训练模型。

## 1. Problem Definition

系统目标不是预测股票价格，也不是预测涨跌方向。

目标是：

在当前状态下选择交易动作，使单次做T交易获得最佳风险调整收益。

当前状态应包含账户、持仓、可卖仓位、当日买入、成本和 Observed Reference Price 研究字段；未来结果只能作为 target-side 信息，不能进入 state feature。

## 2. Primary Objective

候选主目标：Single Trade Return。

候选交易收益包含：

- entry price
- exit price
- transaction cost
- fee
- slippage

示例形式：

Trade Return = (exit price - entry price) - fee - slippage

但当前系统已批准 ACCOUNTING_CLOSED：实际 fee/slippage 已进入 execution/accounting 状态，因此不能在 Reward 或 Q target 层再次扣除。上式仅为经济目标解释候选，不是新的 Reward Formula。

STATUS = PROPOSAL_ONLY

## 3. Risk Objective

候选风险目标：Drawdown Control。

考虑：

- Maximum Adverse Excursion。
- 持仓期间最大浮亏。
- 错误交易风险。
- 最大连续亏损。
- T+1 导致的退出受限风险。

风险指标的窗口、归因、归一化和 penalty 仍未批准，不得直接写入 Reward Artifact 或 Value-Q target。

## 4. Q Objective Proposal

候选：

Q(s,a) = Expected Single-T Return - Risk Penalty - Transaction Cost

在 ACCOUNTING_CLOSED 下，Transaction Cost 不得被重复扣除；更准确的候选解释是：Q 读取已经反映实际成本的 Reward/portfolio outcome，并可在人工批准后加入独立、可审计的风险项。

Q_OBJECTIVE_STATUS = PROPOSAL_ONLY
Q_OBJECTIVE_SELECTED = NONE

## 5. Horizon Definition

候选 horizon：

### H1 — 5 bars

短周期做T候选；对分钟噪声和观察价格语义敏感。

### H2 — 15 bars

中短周期候选；可能覆盖部分持仓区间，但需处理跨 session/T+1。

### H3 — 30 bars

较长盘中候选；长持仓 attribution、数据完整性和 terminal 规则更重要。

### H4 — End of Session

session 级候选；需要处理 open position、Observed Reference Price valuation 和 Hybrid terminal。

不选择最终方案：

HORIZON_SELECTED = NONE
HORIZON_STATUS = PROPOSAL_ONLY

## 6. Risk Preference

参数候选：lambda_risk。

风险偏好候选：

- 低风险：较高风险惩罚。
- 中风险：中等风险惩罚。
- 高风险：较低风险惩罚。

风险参数的数值、校准数据、训练目标和与交易成本的关系尚未批准。

RISK_PREFERENCE_STATUS = NOT_APPROVED
LAMBDA_RISK_SELECTED = NONE

## 7. Success Metrics

未来评价必须至少包含：

- 单次T收益率。
- 胜率。
- Profit Factor。
- 最大回撤。
- 最大连续亏损。
- 手续费后收益。

这些是评价指标，不得自动回写为 Reward、Value-Q target 或 policy objective。

## 8. Hard Stop

以下项目未批准前：

- Trading Objective。
- Horizon。
- Risk Penalty。
- Reward Contract 的实现性扩展。

禁止：

- Value-Q target generation。
- Dataset generation。
- RL training。
- 自动 policy improvement。

## Final Gate

VALUE_Q_TARGET = BLOCKED
TARGET_GENERATOR = PROPOSAL_ONLY
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
