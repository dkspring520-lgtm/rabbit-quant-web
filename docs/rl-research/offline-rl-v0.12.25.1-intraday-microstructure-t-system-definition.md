# OFFLINE RL V0.12.25.1 — Intraday Microstructure T System Definition

Definition date: 2026-10-05

本文件修正项目定位：本项目不是单纯的 1 分钟级做 T 系统，而是一个由多频率数据驱动的 Intraday T Decision System。

目标是利用 Tick、Level2、逐笔成交和 Order Flow 等市场信息，识别日内资金行为变化，辅助长期持仓中的 T Position 成本优化。

## Final Project Positioning

Multi-frequency T Research System

核心不是预测股票明天涨跌，而是评估：

当前 state 下，执行一次 T action 的期望收益和风险。

当前仍保持研究和安全边界：

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE

## 1. Three-Layer Architecture

### V1 — Historical Research Layer

用途：验证做 T 思想是否具有历史统计优势。

数据：

- 1m OHLCV
- 成交量
- 波动率
- ATR
- MACD
- 技术状态

主要用途：

- BUY_HOLD baseline
- Bidirectional T baseline
- Expert Prior baseline
- Historical Benchmark Metrics
- Cost Reduction、Maximum Drawdown 和 T Quality 分析

DATA-07 的定位是 V1 策略验证数据，不是最终的毫秒级模型数据。V1 结果不能被描述为 Tick/L2 微观结构优势，也不能直接代表实时执行能力。

### V2 — Microstructure Research Layer

目标：接近真实盘中资金行为和交易逻辑。

候选数据：

- Tick
- Level2 盘口
- 逐笔成交
- 委买委卖变化
- Order Flow Imbalance（OFI）
- 主动买卖方向
- 成交速度
- 价格速度

重点研究问题：

短时间大量资金推动价格上涨，加上价格速度继续扩张、成交行为或承接结构变化，最终出现上涨动能衰竭。

典型 candidate pattern：Capital Flow Spike + Momentum Exhaustion。

V2 只允许在真实 Tick/L2/逐笔来源、时间戳和缺失值语义通过审计后启用。不得用 V1 数据合成盘口、OFI 或毫秒级成交信息。

### V3 — Real-time Execution Research Layer

目标：模拟真实盘中辅助决策，而不是自动下单。

候选能力：

- 秒级刷新
- 未来支持 100–300ms 状态更新
- 实时状态更新
- Paper/simulated execution
- 样本累计和 forward outcome 记录

V3 必须保留 current-state timestamp、数据延迟、可执行性、行情缺失和模拟成交状态。V3 不得绕过 Canonical Action、T+1 或 Hard Stop。

## 2. Trading Objective

系统不预测：

- 明天涨跌
- 单纯方向分类
- 股票价格目标

系统研究：

- WAIT
- REDUCE_T
- ADD_T
- REBUY_T

这些是研究层的决策语义。当前 Canonical Action Schema 不因此修改：

- REDUCE_T 对应现有 T 减仓语义。
- REBUY_T 对应现有 T 回补语义。
- ADD_T 仍是 proposal-only 的研究概念，不加入当前 Canonical Action V1。
- WAIT 保持为无操作。

## 3. Core/T Position Model

Core/T 语义保持不变：

- Total Position：37100
- Core Position：34000
- T Position：3100

- Core Position：长期持有，不主动交易。
- T Position：主动优化成本的机动仓位。
- 所有 T action 只作用于 T Position。
- T action sizing 继续以 action-time T Position 为分母。
- T+1、sellablePosition、todayBought 和 todaySold 继续有效。
- 研究场景账户不冒充历史真实账户。

## 4. Expert Prior

用户交易经验不是固定交易规则，而是 Expert Prior / Candidate Feature。

### Positive T Candidate Pattern

- Capital Flow Spike
- Price Rapid Expansion
- Momentum Exhaustion
- 上涨阻力增加
- 成交行为变化

候选语义：减少 T 仓，等待回补机会。

### Reverse T Candidate Pattern

- 快速下跌或恐慌释放
- 卖压衰竭
- 低位资金承接
- 价格速度下降或反转

候选语义：增加 T 仓。

上述模式只进入 attribution、candidate feature 和显式版本化 action mapper，不得直接成为无条件 SELL、BUY 或 REBUILD 规则。

## 5. Benchmark Engine Repositioning

Historical Benchmark Engine 的定位调整为 Multi-frequency T Research Engine。

### Stage 1 — DATA-07

验证：

- BUY_HOLD
- BIDIRECTIONAL_T
- EXPERT_PRIOR

目的：验证做 T 思想是否具有历史统计优势。

限制：

- 只能代表 V1 historical research。
- 不能证明 Tick/L2 微观结构 alpha。
- 不能证明毫秒级实时执行质量。

### Stage 2 — Tick/L2

验证：

- 微观结构优势
- 资金推动速度
- OFI 和主动买卖变化
- 成交速度与价格速度关系
- Momentum Exhaustion 的短周期识别

### Stage 3 — Real-time Simulation

验证：

- 秒级状态刷新
- 100–300ms 级别状态更新可行性
- 实时延迟和数据缺失
- 模拟成交
- forward outcome 与样本累计

Stage 1、Stage 2、Stage 3 的结果必须分开报告，不能把 V1 历史结果包装成 V2/V3 能力。

## 6. Value-Q Objective Revision

Value-Q 不是涨跌预测器。

目标定义为：当前市场和持仓状态下执行某个 T action 的未来期望价值。

候选 action 包含：

- WAIT
- REDUCE_T
- ADD_T（proposal-only）
- REBUY_T

未来 Q 评价至少考虑：

- T Profit
- 回补成功概率
- Cost Reduction
- Maximum Drawdown / Risk Penalty
- Failed Rebuy Risk
- Missed Trend / 卖飞风险
- Opportunity Cost

该定义只修正未来 Value-Q 的研究目标，不生成 target、不修改 Reward Contract、不解锁 RL Training。

## 7. Data and Leakage Boundary

- V1 feature 只能使用当前 bar 和历史 bar。
- V2 feature 只能使用当前已到达的 Tick/L2/逐笔数据。
- V3 必须记录 observation timestamp、arrival timestamp 和 data latency。
- outcome window 只能用于结果评价。
- 不允许使用未来 high/low/close、未来盘口或事后回补数据决定 action。
- 不允许将 V2/V3 缺失字段用 V1 或 synthetic value 填补。

## 8. Safety Constraints

本定义不授权：

- 修改 Canonical Schema。
- 修改 Reward Contract。
- 生成 Value-Q target。
- RL Training。
- DATA-07 结果自动晋级为生产策略。
- 自动下单或改变生产交易逻辑。

Historical Benchmark 完成前，继续保持：

CANONICAL_SCHEMA_STATUS = APPROVED
BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
