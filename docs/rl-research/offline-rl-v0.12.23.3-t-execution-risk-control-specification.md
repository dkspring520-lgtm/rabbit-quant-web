# OFFLINE RL V0.12.23.3 — T Execution & Risk Control Specification

## Gate

EXECUTION_MODEL = SPEC_ONLY
DIRECTION_MODEL = SPEC_ONLY
OPPORTUNITY_MODEL = SPEC_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只定义做T执行与风险控制层的研究规格，不生成交易信号、Dataset、Value-Q target、训练数据或模型。

## 1. Execution Objective

目标不是最大化交易次数，也不是鼓励高频换手。

目标候选为：

- 最大化长期持仓收益。
- 降低平均成本。
- 增加可验证的 T 收益。
- 控制最大回撤和踏空风险。

长期核心仓不得因为短期 T 机会被默认清仓。执行层应优先管理库存和成本，而不是单独追求单次成交数量。

OBJECTIVE_STATUS = PROPOSAL_ONLY

## 2. Position Management

示例组合状态：

- Core Position：34000 股。
- T Position：3100 股。
- Total：37100 股。
- Average Cost：31.5。

模型必须区分：

- 哪些仓位属于长期 core position，原则上不可随意交易。
- 哪些仓位属于可用于 T 的 t position。
- 哪些仓位因 T+1 暂时不可卖。
- 哪些仓位已经 sellable。
- 当前 average cost 和交易后 cost basis improvement。

上述 core/t 仓位拆分目前是策略 Contract 候选，不得回填到历史 Replay 或伪造 Dataset 字段。

## 3. T Size Control

候选字段：T_SIZE_ACTION。

候选取值：NO_T、5%、10%、15%、20%。

示例：34000 股底仓的 10% 约为 3400 股。

实际执行数量必须经过：

- 可卖仓位检查。
- 最小交易单位检查。
- 现金约束检查。
- T+1 检查。
- 回补机会检查。

不得一次性默认执行全部反T，也不得为了平衡样本人工制造数量。

## 4. Daily T Budget

为避免无限交易，候选执行状态包括：

- daily_t_count。
- daily_t_volume。
- cooldown。
- daily_loss_limit。
- maximum_position_reduction_without_buyback。

示例约束：一天最多 3 次 T。

该数值只是候选配置，不是已批准的生产规则。预算必须与成功、失败、回补和交易成本记录保持一致。

## 5. Successful T Follow-up

当第一次 T 满足 T Profit 大于 approved threshold，系统进入 RECHECK_STATE。

重新评估：

- trend state。
- volatility state。
- opportunity score。
- direction probability。
- remaining daily T budget。
- buyback feasibility。

禁止成功后自动继续交易。每次后续 T 都必须重新通过状态、成本覆盖、冷却和 T+1 检查。

## 6. Failed T Protection

### 卖出后价格继续上涨

风险包括 missed rebuy、踏空长期仓位和 average cost improvement 未实现。

候选记录：missed_rebuy_penalty。

该字段只作为风险/评价候选，不得自动写入已批准 Reward Formula。

### 卖出后无法回补

记录：failed_T。

需要区分：

- T+1/环境约束导致的 blocked rebuy。
- 价格继续离开导致的经济失败。
- 实际成交但结果不利的 executed losing action。

不得把三者混为一个固定 penalty。

## 7. Execution Constraints

候选规则：SELL → same-day BUY_BACK expectation。

该规则表示执行前需要存在可审计的回补计划和机会评估，不是对未来成交的保证，也不是 counterfactual 数据。

A 股 T+1 必须保留：todayBought、sellablePosition、advanceTo/date transition semantics 和 blocked execution status。

禁止：

- 把当日新增买入当作当日可卖。
- 卖出后长期降低仓位而不触发风险状态。
- 修改 Replay 中的账户状态。
- 伪造未来 BUY_BACK。

## 8. Metrics

真正做T的评价至少包含：

- T Success Rate。
- Average T Profit。
- Average Cost Reduction。
- Failed Rebuy Rate。
- Missed Opportunity Rate。
- Maximum Drawdown。
- Turnover。
- 手续费后收益。
- 最大连续亏损。
- Buyback Success Rate。

评价必须时间顺序切分，不能将未来回补结果泄漏到实时 action-time state，也不能只报告 Win Rate。

## 9. Relationship With Direction and Opportunity Models

候选架构：Market Data → Direction Prediction → Opportunity Prediction → Bidirectional T Policy → Execution & Risk Control → Value-Q → Final Action。

Execution layer 读取方向概率、机会概率、持仓状态和风险预算，但不得把这些预测直接转换为交易信号而绕过人工批准的 Policy Contract。

## 10. Human Review Gate

必须人工批准：

- Core/T position definition。
- T_SIZE_ACTION 候选范围。
- Daily T Budget。
- Cooldown and follow-up rule。
- Buyback expectation。
- missed_rebuy_penalty 语义。
- failed_T 分类。
- T+1 execution constraint。
- Metrics 和历史验证协议。

## Explicit Non-goals

禁止：

- 生成交易信号。
- 生成 Dataset。
- 生成 Value-Q target。
- 训练 Direction/Opportunity/Value-Q/RL 模型。
- 修改 Reward Contract。
- 修改 Action Space。
- 修改 Replay、历史数据或生产交易逻辑。

## Final Gate

EXECUTION_MODEL = SPEC_ONLY
DIRECTION_MODEL = SPEC_ONLY
OPPORTUNITY_MODEL = SPEC_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
