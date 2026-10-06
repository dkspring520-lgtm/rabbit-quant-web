# OFFLINE RL V0.12.23.6 — Historical T Benchmark Execution Plan

## Gate

BACKTEST_ENGINE = VERIFIED
BENCHMARK_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
NO_MODEL = TRUE
NO_TRAINING = TRUE
NO_VALUE_Q = TRUE
NO_REWARD_CHANGE = TRUE

本文件只定义历史统计执行计划，不运行回测、不生成模型、不生成 Value-Q target。

## 1. Benchmark Objectives

### Objective A — T Alpha

比较：

- BUY_HOLD。
- 固定正T。
- 固定反T。
- 双向T。

核心问题：做T是否相对长期持有产生稳定增量收益，而不是只在少数样本中获利。

### Objective B — Market Regime Fit

按以下 regime 拆分：

- UPTREND。
- DOWNTREND。
- RANGE。

研究问题：

- 上涨趋势中正T是否优于持有基准。
- 下降趋势中反T是否降低回撤。
- 震荡中双向T是否贡献更多可实现收益。

### Objective C — Position Size Fit

固定长期核心仓候选：

- Core Position：34000 股。
- T Position：3100 股。
- T Position / Core Position 约 8.4%。

测试 T 仓位比例：

- 5%。
- 10%。
- 15%。
- 20%。

比较收益、成本改善、回补失败和回撤的权衡。

## 2. Data and Execution Scope

数据候选：

- DATA-07。
- 601899.SH。
- 2022–2026 historical minute-like observations。

执行约束：

- 只读已有历史数据。
- 使用统一 PaperExecutionEngine/accounting semantics。
- 保持 T+1、sellablePosition、todayBought 和现金约束。
- 保持 Observed Reference Price 的受限语义。
- 不补造 OHLC、bid、ask、mid 或未来 timestamp。
- 不修改 Replay、Reward Artifact 或 Dataset。

## 3. Benchmark Matrix

### Baseline 0 — BUY_HOLD

长期持有，不执行 T。

用途：建立无 T 操作的收益、成本和回撤基准。

### Baseline 1 — Fixed Positive T

候选规则：

- 上涨趋势中卖出 T 仓。
- 回落并满足固定回补条件时买回。

必须记录无法回补、上涨延续和 missed rebuy。

### Baseline 2 — Fixed Reverse T

候选规则：

- 下降趋势中减仓允许比例。
- 低位满足固定回补条件时买回。

禁止默认清仓，禁止卖出不可卖仓位。

### Strategy 3 — Bidirectional T

输入候选：

- Direction Score。
- Opportunity Score。
- Position State。
- Risk State。

输出候选：

- WAIT。
- POSITIVE_T。
- NEGATIVE_T。
- BUY_BACK。

Strategy 3 仍是规则 benchmark，不是模型训练。

## 4. Evaluation Metrics

### 收益

- Total Return。
- Annualized Return。
- T Contribution。
- 手续费后收益。
- 相对 BUY_HOLD 的增量收益。

### 成本改善

- Initial Cost。
- Final Effective Cost。
- Cost Reduction %。
- Average Cost Reduction。
- Cost Basis Improvement。

示例：

Initial Cost = 31.50。

Final Effective Cost = 29.80。

Cost Reduction = 5.4%。

必须区分已实现交易收益、未实现估值变化和真实成本下降。

### 风险

- Max Drawdown。
- Worst Trade。
- Failed Rebuy Count。
- Missed Rebuy Rate。
- Maximum Consecutive Losses。
- Long-term Position Reduction Incidents。

### T Quality

- T Success Rate。
- Average T Profit。
- Median T Profit。
- Profit Factor。
- Trade Frequency。
- Turnover。
- Buyback Success Rate。

## 5. Regime and Position Slices

每个 baseline 必须按以下维度报告：

- UPTREND。
- DOWNTREND。
- RANGE。
- Core-only、T-position available、部分持仓、空仓。
- 5%、10%、15%、20% T size。
- 年份和连续时间区间。
- 上午/下午交易时段。

禁止只报告全样本平均值。

## 6. Historical Execution Protocol

1. 固定 DATA-07 source identity/hash。
2. 固定执行成本、滑点、T+1 和最小交易单位。
3. 固定四个 benchmark 的规则参数。
4. 按时间顺序执行，不随机拆分。
5. 记录每个 Order Event、Fill Event、Position State、Cash State 和 Cost State。
6. 记录失败回补、blocked execution 和 executed losing action 的区别。
7. 生成统一 benchmark report，不生成模型或训练数据。
8. 由人工 Review 结果后，决定是否进入 Value-Q 目标设计。

## 7. Planned Research Outputs

只有在执行阶段获批后，允许生成独立 benchmark report，例如：

- docs/rl-research/results/offline-rl-v0.12.23.6-benchmark-result.json
- docs/rl-research/results/offline-rl-v0.12.23.6-benchmark-report.md

本计划阶段不生成这些文件。

## 8. Decision Interpretation

如果双向T相对 BUY_HOLD 在多个年份、regime 和仓位比例下稳定改善收益并降低回撤，后续 Q 模型可研究：

在已有有效双向T策略基础上学习何时做、做多少、何时等待。

如果双向T不能稳定优于 BUY_HOLD，后续不得假设 Q 只需优化策略；需要重新审查 opportunity、成本覆盖、回补失败和 risk objective。

单次高收益、单一年份或单一 regime 的结果不足以证明稳定 Alpha。

## 9. T Opportunity Attribution Analysis

目标不只是统计一次 T 是否盈利，还要回答：什么类型的市场机会产生了 T Alpha。

### Opportunity Type A — Capital Flow Spike + Momentum Exhaustion

候选名称：MOMENTUM_EXHAUSTION。

候选条件：

- Price Velocity 快速提升。
- Abnormal Volume Spike。
- VWAP 偏离扩大。
- MACD Histogram 达到高位极值。
- 价格继续创新高但 MACD 动能下降。
- Price-MACD Divergence。

用途：验证分批反T是否有效。

统计：出现次数、胜率、平均 T 收益、最大失败幅度、最大回撤改善。

### Opportunity Type B — Technical Overbought Only

只有技术指标超买，例如 RSI 或 MACD 高位，但没有明显资金推动。

用途：比较单纯技术超买是否具有独立 T 价值，避免把资金流推动和技术指标效果混为一谈。

### Opportunity Type C — Trend Breakout

候选特征：放量上涨、动能继续增强。

用途：验证错误反T和过早卖出的风险，统计卖出后继续上涨造成的机会损失。

### Opportunity Type D — Range Reversal

震荡区间中的方向反转候选。

用途：验证双向T在 Range 环境中的价值，并统计换手、成本和失败回补风险。

所有 opportunity type 均为 benchmark classification proposal，不是交易信号。

## 10. Momentum Regime Classification

在 UPTREND、DOWNTREND、RANGE 之外，增加 Momentum Phase 研究分类：

### TREND_ACCELERATION

候选规则：价格上涨、MACD 增强、成交量增加。

研究约束：禁止过早反T，重点统计错误卖出和 missed rebuy。

### TREND_MATURE

候选规则：价格继续上涨，但动能增长放缓。

研究用途：评估是否进入减仓观察窗口，而不是自动执行。

### MOMENTUM_EXHAUSTION

候选规则：价格创新高、MACD 柱下降、成交推动下降、背离出现。

研究用途：允许评估 scale-out 反T候选。

### REVERSAL_CONFIRMED

候选规则：趋势反转得到独立因果确认。

研究用途：评估回补时机，不得使用未来确认信息污染 action-time state。

## 11. Avoided Drawdown Attribution

做T价值不仅是已实现 T Profit，还包括避免后续回撤的贡献。

新增统计：

- T Profit。
- Avoided Drawdown。
- Cost Reduction Contribution。

示例：卖出价格 35.7，回补价格 35.0，价差收益候选为 0.7 元/股；同时需要单独记录卖出后是否发生可验证的下跌，以及该部分是否满足冻结评价窗口。

不得把事后下跌自动全部归因给卖出 action；必须区分实际回补、未回补、持仓变化和 observation horizon。

## 12. Frozen T Outcome Evaluation Window

为避免卖出后短期上涨、随后下跌造成评价争议，必须预先冻结 T outcome window 候选：

- 15 bars。
- 30 bars。
- End Session。
- Next Session。

每个卖出 action 需要分类：

- 成功回补。
- 错误卖出。
- 踏空。
- 避免回撤。

当前不选择最终窗口。窗口必须与 T+1、terminal、Observed Reference Price 和缺失 observation 规则一致。

## 13. Realistic Position Scenario Benchmark

加入用户实际持仓场景候选：

- Core Position：34000 股。
- T Position：3100 股。
- Total：37100 股。

测试 T 仓位比例：

- 5%。
- 8%。
- 10%。
- 15%。
- 20%。

重点观察：收益、最大回撤、平均成本改善、失败回补、踏空和换手之间的平衡。

该场景必须保持 core position 与 T position 的策略语义，不得为了回测方便伪造历史仓位或未来回补。

## 14. Expanded Benchmark Outputs

### 收益

- Total Return。
- T Contribution。
- Annualized Return。

### 成本改善

- Initial Cost。
- Final Effective Cost。
- Cost Reduction %。
- Cost Reduction Contribution。

### 风险

- Maximum Drawdown。
- Worst Failed T。
- Failed Rebuy Rate。
- Missed Rebuy Rate。

### 交易质量

- T Success Rate。
- Average T Profit。
- Median T Profit。
- Profit Factor。
- Trade Frequency。

### 机会归因

每个 Opportunity Type 和 Momentum Phase 必须报告：

- 出现次数。
- 胜率。
- 平均收益。
- 中位收益。
- 失败幅度。
- 风险和回撤贡献。

## Explicit Non-goals

禁止：

- 生成模型。
- 训练 RL。
- 生成 Value-Q target。
- 修改 Reward。
- 修改 Replay、Dataset 或历史数据。
- 自动进入 V0.12.24。

## Final Gate

BACKTEST_ENGINE = VERIFIED
BENCHMARK_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
