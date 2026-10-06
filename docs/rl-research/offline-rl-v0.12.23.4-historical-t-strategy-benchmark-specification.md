# OFFLINE RL V0.12.23.4 — Historical T Strategy Benchmark Specification

## Gate

BACKTEST_ENGINE = SPEC_ONLY
EXECUTION_MODEL = SPEC_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
HUMAN_REVIEW_REQUIRED = TRUE

本文件只定义历史 T 策略验证框架，不执行回测、不生成模型、不生成训练数据、不修改 Reward 或 Replay。

## 1. Benchmark Objective

目标是验证双向 T 策略是否具有历史优势，而不是验证价格方向预测准确率。

核心比较：

- 做T策略是否产生相对 BUY & HOLD 的增量收益。
- 成本降低是否真实存在。
- 收益是否在不同年份、市场状态和持仓状态下稳定。
- 风险是否来自失败回补、过度换手或长期仓位下降。

历史结果只能作为 research evidence，不能自动提升为 Value-Q target、交易信号或生产策略。

## 2. Data Contract

数据源候选：

DATA-07：601899.SH，1m-like historical source，2022–2026。

规则：

- 只读现有 source/replay-compatible data。
- 不修改历史 JSONL、Replay 或 Dataset。
- 不补造 OHLC、bid、ask、mid 或未来 timestamp。
- Observed Reference Price 保持原有受限语义。
- 所有 evaluation 使用时间顺序，不随机打乱。

实际 1m bar/close 语义若未完成外部验证，报告中必须保留该限制。

## 3. Baseline Strategies

### Baseline A — BUY & HOLD

持仓不动，不执行 T。

目的：测量 T 策略是否创造相对持仓基准的增量收益，以及成本降低是否抵消交易风险。

### Baseline B — Fixed Positive T

候选规则：

- 上涨或达到固定上行阈值时卖出 10% T 仓。
- 回落达到固定回补阈值时买回。

该 baseline 必须使用真实可卖仓位、T+1、交易成本和回补可行性；阈值需要在 benchmark protocol 中预先固定。

### Baseline C — Fixed Reverse T

候选规则：

- 下跌或达到固定下行阈值时卖出 5%–10% 可允许底仓。
- 低位出现固定回补条件时买回。

禁止默认清仓，禁止把不可卖仓位当作可卖。

### Baseline D — Bidirectional T

根据以下已定义但尚未实现的研究输入选择正T、反T或等待：

- trend state。
- volatility state。
- opportunity score。
- portfolio/core/T position state。
- T+1 feasibility。

该 baseline 是规则研究候选，不是模型或 Policy training。

## 4. Execution and Cost Protocol

所有 baseline 必须使用同一执行约定：

- 相同的 PaperExecutionEngine 语义。
- 相同 commission、stamp duty 和 slippage 配置。
- 相同最小交易单位和现金约束。
- 相同 T+1 sellablePosition 规则。
- 相同 session boundary。

不得在不同 baseline 中使用不同成本模型，也不得在结果层重复扣已经进入 accounting-closed state 的费用或滑点。

## 5. Evaluation Metrics

### 收益

- Total Return。
- T Contribution。
- Annualized Return。
- 手续费后收益。
- 相对 BUY & HOLD 的增量收益。

### 成本

- Average Cost Reduction。
- Cost Basis Improvement。
- 每次成功 T 的净贡献。
- 交易成本占毛收益比例。

例如：初始 average cost 为 31.5，评价结束时需要明确报告研究性等效成本变化；不得把未实现估值变化误报为已实现降本。

### 风险

- Maximum Drawdown。
- Worst T Failure。
- Missed Rebuy Rate。
- Failed Rebuy Rate。
- Maximum Consecutive Losses。
- Long-term position reduction incidents。

### 交易质量

- T Success Rate。
- Average T Profit。
- Profit Factor。
- Trade Count。
- Turnover。
- Buyback Success Rate。

## 6. Regime and Subgroup Evaluation

结果至少按以下维度拆分：

- Uptrend。
- Downtrend。
- Range。
- 低/中/高波动。
- 持仓状态：空仓、部分持仓、长期满仓、存在 T 仓。
- 年份和连续时间段。
- 上午/下午 session window。

不得只报告全样本均值；需要报告失败集中在哪些 regime、session 或仓位状态。

## 7. T+1 and Position Safety

验证必须确认：

- 当日买入不立即进入 sellablePosition。
- blocked SELL 不计为 executed losing SELL。
- 卖出后回补机会必须是候选条件，不得伪造未来成交。
- Core position 不因短期信号默认清仓。
- T position、core position、total position 的变化可追溯。

## 8. Historical Validation Protocol

建议流程：

1. 固定数据版本和 source hash。
2. 固定成本、滑点、T+1 和交易时间规则。
3. 固定四个 baseline 的规则参数。
4. 按时间顺序划分研究区间，禁止随机切分。
5. 先报告每个 baseline，再做相对比较。
6. 报告年度、regime、持仓状态和 session 分组。
7. 报告失败回补、最大回撤和成本降低。
8. 不因为一次历史结果自动进入 Value-Q 或 RL。

## 9. Decision Criteria

只有在人工 Review 后，才可讨论是否进入下一阶段。需重点检查：

- Bidirectional T 是否稳定优于 BUY & HOLD。
- Fixed Positive T/Reverse T 是否提供可解释基准。
- Cost Basis Improvement 是否扣除全部真实成本并避免虚假未实现降本。
- Failed Rebuy/Missed Opportunity 是否可接受。
- Maximum Drawdown 是否低于预设风险边界。
- 结果是否跨年份、regime 和仓位状态稳定。

任何单一高收益样本不能证明策略具备稳定 Alpha。

## Explicit Non-goals

禁止：

- 生成模型。
- 训练 RL。
- 生成 Value-Q target。
- 修改 Reward。
- 修改 Replay 或历史数据。
- 自动生成交易信号。
- 直接进入 V0.12.24。

## Final Gate

BACKTEST_ENGINE = SPEC_ONLY
EXECUTION_MODEL = SPEC_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
