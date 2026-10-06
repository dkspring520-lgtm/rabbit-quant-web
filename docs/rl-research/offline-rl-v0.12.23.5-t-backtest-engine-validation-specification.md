# OFFLINE RL V0.12.23.5 — T Backtest Engine Validation Specification

## Gate

BACKTEST_ENGINE = VALIDATION_ONLY
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件验证 Backtest Engine 的因果性、成交模型、T+1 和账户记账正确性，不验证策略是否赚钱，也不执行历史回测。

## 1. Backtest Engine Scope

### Input

- DATA-07。
- 601899.SH。
- minute-like historical observations。
- 已批准的 execution/accounting 约束候选。

### Output

Backtest Engine 必须能够产生可审计的 Trade Timeline、Order Event、Fill Event、Position State、Cash State、Cost State 和 Performance Report。

每个事件必须保留 timestamp、action、requested quantity、executed quantity、execution status、账户前后状态和成本 lineage。

## 2. Lookahead Bias Validation

每个 action 只能使用 current observation/bar、已发生的历史 observations/bars 和当前 action-time portfolio state。

禁止读取 future close、future high、future low、future volume、future portfolio value、future execution 或 future terminal outcome。

LOOKAHEAD_BIAS_CHECK = REQUIRED

验证方法候选：对 action 之后的 bars 做 mutation，确认 action、order request 和 action-time state 不变。

## 3. Execution Model Validation

成交模型必须在 benchmark protocol 中固定，候选包括 next available price 或 next bar open。

买入和卖出必须使用同一可审计的时间规则，除非 Contract 明确规定方向差异。

禁止使用未来最高点作为卖出 fill、未来最低点作为买入 fill、区间极值制造成交或不可观察价格回填成交。

fillPrice、fee、stamp duty 和 slippage 必须遵守 ACCOUNTING_CLOSED 语义，禁止重复扣成本。

## 4. A股 T+1 Constraint

每个 transition 必须保留 position、sellablePosition、todayBought、cash 和 averageCost。

规则：

- 当天买入不能当天卖出。
- SELL quantity 不得超过 sellablePosition。
- advanceTo/date transition 只能按真实交易日释放库存。
- blocked SELL 不得当作 executed losing SELL。

## 5. T Core Validation

人工案例候选组合：Core Position 34000 股，T Position 3100 股，Total Position 37100 股。

候选动作：SELL_T、BUY_BACK_T。

必须验证：

- 卖出数量来自可卖 T 仓或明确允许的底仓比例。
- 卖出后存在可审计的 same-day buyback expectation，或记录 FAILED_REBUY。
- 不能因为回测便利而伪造未来 BUY_BACK。
- 不能卖出后长期降低仓位而不触发风险记录。
- 成本变化、持仓变化和失败回补都可追溯。

## 6. Benchmark Output

### 收益

- Total Return。
- T Profit。
- T Contribution。
- 手续费后收益。

### 成本变化

- Initial Cost。
- Final Effective Cost。
- Cost Reduction。
- Cost Basis Improvement。

示例：Initial Cost = 31.5，Final Effective Cost = 30.8，Cost Reduction = 0.7。

只有在扣除真实交易成本、区分已实现/未实现结果并完成账户 lineage 后，才能报告 Cost Reduction。

### 风险

- Maximum Drawdown。
- Peak-to-Trough。
- Worst Failed T。
- Failed Rebuy Rate。
- Missed Opportunity Rate。

### 交易质量

- T Win Rate。
- Average T Profit。
- Profit Factor。
- Trade Frequency。
- Turnover。
- Buyback Success Rate。

## 7. Required Manual Cases

### Case A — Uptrend

预期研究行为：正T为主。验证不过早卖出长期 core position，卖出后回补约束明确，上涨延续时记录 missed rebuy/failed T 风险。

### Case B — Downtrend

预期研究行为：反T为主。验证只允许经过批准的底仓比例调整，不默认清仓，回补、T+1 和回撤风险可追踪。

### Case C — Range

预期研究行为：正T/反T切换候选。验证 cooldown 和 daily T budget 生效，不因短期噪声无限换手，成本覆盖和失败回补可审计。

## 8. Determinism and Boundary Checks

必须验证：同一输入重复运行结果一致；session boundary 不引入 synthetic bars；午休不被当作连续 observation；交易日边界正确触发 T+1 release；terminal/open position 不默认 synthetic liquidation；缺失 observation 不被未来数据补齐。

## 9. Explicit Non-goals

禁止生成回测结果、交易信号、模型、Value-Q target；禁止修改 Reward Contract、Replay、Dataset 或历史数据；禁止自动进入 V0.12.23.6。

## Final Gate

BACKTEST_ENGINE = VALIDATION_ONLY
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
