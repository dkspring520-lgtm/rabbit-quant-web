# OFFLINE RL V0.12.23 — Bidirectional T Policy Specification

## Status

VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
ACTION_SPACE = PROPOSAL_ONLY
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只定义双向 T 策略的研究规格，不生成训练数据、Value-Q target、Dataset 或模型。

## 1. Strategy Objective

核心目标：

- 长期持仓收益最大化。
- 通过 T 交易降低持仓成本。
- 控制最大回撤和错误交易风险。

禁止将目标简化为单次价格涨跌预测。

明确禁止：

- 清仓策略作为默认目标。
- 高频换手。
- 单纯预测涨跌。
- 在没有回补机会时持续卖出并长期降低仓位。

研究目标是库存管理与成本优化，而不是方向预测器。

## 2. Portfolio State

### Market State

候选字段：

- price：Observed Reference Price 研究字段，不等同 verified close、last trade 或 executable price。
- VWAP。
- volume。
- volatility。
- trend_state。
- order_flow。

所有 market features 必须是 action-time causal features；禁止 future price、future volume、terminal outcome 和 forward return 进入 state。

### Position State

必须区分：

- total_position。
- core_position。
- t_position。
- average_cost。
- available_sell_position。
- today_buy_amount。
- today_sell_amount。

模型必须知道当前是否为长期满仓持有、是否存在可卖 T 仓、哪些仓位受 T+1 限制。

当前仓位字段与既有 Replay/Dataset 字段的 canonical mapping 尚未批准；不得在本规格中修改历史 schema。

## 3. Market Regime

### Uptrend

上涨趋势候选策略：

- 正T优先。
- 只在存在合理回补条件时卖出 T 仓。

### Downtrend

下降趋势候选策略：

- 反T优先。
- 允许审慎降低部分底仓，但不得默认清仓。

### Range

震荡候选策略：

- 正T与反T均可研究。
- 需要更严格的成本覆盖、冷却和回补确认。

Regime 只是策略条件候选，不是已批准的 action label 或 reward。

## 4. Action Space

当前 action space 为 Proposal-only，不修改既有 action space。

### WAIT

不操作，保持账户和持仓状态。

### POSITIVE_T_SELL

上涨中卖出部分 T 仓，候选数量：

- SELL 5%。
- SELL 10%。
- SELL 20%。

必须满足 available_sell_position 和 T+1 约束，并保留回补机会。

### POSITIVE_T_BUYBACK

正T卖出后的当日回补候选动作：

- BUY_BACK。

不得把未发生的回补当作 observed action 或 target。

### REVERSE_T_SELL

下降趋势中卖出部分底仓，候选数量：

- SELL_CORE_5%。
- SELL_CORE_10%。

禁止一次性默认卖出全部底仓。

### REVERSE_T_BUYBACK

低位接回候选动作，用于降低持仓成本。

所有动作必须保留 requested quantity、executed quantity、execution status、blocked status 和 T+1 状态。

## 5. T+1 Constraint

规格约束：SELL must have BUY_BACK opportunity。

解释：卖出动作必须经过可行性检查，并且策略设计不能默认把卖出变成长期降仓。该规则不是 counterfactual guarantee，也不能伪造未来回补。

禁止：

- 将当日新买入仓位视为当日可卖。
- 修改 sellablePosition 或 todayBought。
- 绕过 advanceTo/date transition 语义。
- 把 blocked SELL 当作 executed losing SELL。

## 6. Position Sizing

示例底仓：core_position = 34000 shares。

候选卖出规模：

第一次：10% ≈ 3400 shares。

第二次：5%–10%。

禁止：

- 一次性全部反T。
- 无成本覆盖和回补条件的连续减仓。
- 为平衡 action distribution 人工制造动作。

数量规则、最小手数、现金约束和可卖仓约束需要后续 Contract 审批。

## 7. Reward Proposal

候选形式：

Reward = T Profit + Cost Reduction - Drawdown Penalty - Transaction Cost - Missed Buyback Penalty

重点研究字段：Cost Basis Improvement。

经济目标不是只赚一次 0.2 元，而是长期降低持仓成本，例如降低长期持仓的 average_cost，同时控制回撤和失败回补。

注意：Approved F2 Reward Contract 已使用 ACCOUNTING_CLOSED，fee/slippage 不得在 Reward 层再次扣除。本节只是双向 T 目标的研究扩展提案，不改变 approved reward formula。

REWARD_EXTENSION_STATUS = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED

## 8. Continuous-T Risk Controls

为避免一次成功后在震荡中无限继续做T，候选控制项：

- max_daily_T_count。
- cooldown_after_success。
- confidence_threshold。
- minimum_cost_coverage。
- maximum_position_reduction_without_buyback。
- failed_T_cooldown。
- daily_loss_limit。

这些参数只作为风险控制 Proposal，不写入 Replay、Dataset 或生产交易逻辑。

## 9. Evaluation Metrics

未来评价至少包含：

- Total T Profit。
- Average Cost Reduction。
- Maximum Drawdown。
- Failed T Rate。
- Buyback Success Rate。
- Annualized Return Improvement。
- Turnover。
- 手续费后收益。
- 最大连续亏损。

不得只报告 Win Rate，也不得把历史命中率、成本后收益和账户回撤混为单一分数。

## 10. Human Review Gate

需要人工批准：

- Bidirectional T objective。
- Market regime mapping。
- Canonical action mapping。
- Position sizing rules。
- T+1 and buyback constraint。
- Cost Basis Improvement definition。
- Risk controls。
- Reward extension compatibility。
- Success metrics and evaluation split。

## Explicit Non-goals

禁止：

- 生成 Value-Q target。
- 生成 training Dataset。
- 开始 RL training。
- 修改 Reward Contract。
- 修改既有 action space。
- 修改 Replay 或历史数据。
- 修改生产交易逻辑。

## Final Gate

VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
ACTION_SPACE = PROPOSAL_ONLY
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
