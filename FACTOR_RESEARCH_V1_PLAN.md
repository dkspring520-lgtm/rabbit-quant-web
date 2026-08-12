# AI 做T因子研究引擎 Phase 1A

## 1. 目标与结论

Phase 1A 只建立一个可复现、可回测、可验证的离线做T因子研究闭环。它不负责预测中长期涨跌，不进入实时信号链路，也不自动修改策略。

本阶段交付：

1. 统一 Factor Schema 和 Factor Registry。
2. 48 个基础做T因子。
3. 因果 Factor Engine。
4. 正T/反T分离的 5、10、15、30 分钟 Factor Backtest Engine。
5. 统一 Evaluation、Factor Score 和不可变 Factor Library。
6. 时间切分、样本外、Rolling OOS、参数敏感性及未来数据泄漏审计。
7. CLI、可复现元数据和自动测试。

这套研究层与“紫金矿业影子 V2”不冲突：

- 影子 V2 是盘中影子监控和候选验证层。
- Phase 1A 是离线因子实验室，只产出研究报告和不可变候选因子版本。
- Phase 1A 的结果不会改变影子 V2、Smart-T 或正式闭环阈值。
- 将来如需复用研究因子，必须经人工审核后，由影子 V2 显式引用具体 `factorId@version`。

## 2. 安全边界

本阶段没有修改或连接：

- `lib/smart-t-engine.mjs`
- trading adapter
- 实时监控核心
- 账户和会员逻辑
- 生产数据库
- 生产策略参数
- 真实交易
- 部署脚本和自动部署
- Paperclip 运行实例

研究引擎只读取调用方传入的历史会话。L2、大盘或板块数据不存在时，相关因子返回 `null`，不会用 0 或假数据填充。

## 3. 复用现有能力

### 3.1 数据契约

复用现有个人回放归档的会话结构：

```json
{
  "date": "20250812",
  "previousClose": 34.95,
  "marketRegime": "range",
  "minutes": [
    {
      "time": "0930",
      "price": 35.02,
      "volume": 12000
    }
  ]
}
```

最低字段为 `date`、`minutes[].time`、`minutes[].price`、`minutes[].volume`。如存在 `open/high/low/close/amount`，引擎会用于真实分钟结构计算；否则只做保守的兼容归一化。

可选字段：

- 市场环境：`marketPrice`、`sectorPrice`、`marketRegime`
- L2/订单流：现有 QMT 归一化模块支持的 active buy/sell、notional、big order、bid/ask depth 等字段

### 3.2 费用与滑点

复用 `lib/personal-replay-training.mjs`：

- 买卖执行价格滑点
- 佣金费率
- 最低佣金 5 元
- 卖出印花税 0.05%

正T按“先买后卖”计算费用；反T按“先卖后买”计算费用。

## 4. 架构

```text
历史会话 JSON / JSONL
        |
        v
Factor Registry ---- Factor Schema
        |
        v
Causal Factor Engine
        |
        v
正T / 反T标签（未来5/10/15/30分钟，仅评估可见）
        |
        v
Train -> Validation -> Test
        |
        +--> Rolling Out-of-Sample
        +--> 参数敏感性
        +--> Future Leakage Audit
        |
        v
Factor Evaluation + Factor Score
        |
        v
不可变研究报告 / 通过门槛的Factor Library版本
```

核心模块：

- `factor-registry.mjs`：schema、48 个定义、不可变注册。
- `factor-engine.mjs`：归一化数据、因果上下文、指标计算、未来不变性审计。
- `factor-backtest-engine.mjs`：标签、费用、时间切分、训练阈值、滚动样本外。
- `factor-evaluation.mjs`：IC、稳定性、胜率、收益、回撤、Profit Factor、分组表现和 Factor Score。
- `factor-library.mjs`：验证门槛和不可变版本存储。
- `reproducibility.mjs`：稳定序列化、SHA-256、Git commit 和制品写入。

## 5. Factor Schema

每个因子必须且已经包含：

| 字段 | 说明 |
| --- | --- |
| `factorId` | 稳定、可引用的唯一编号 |
| `name` | 因子名称 |
| `category` | 价格、VWAP、订单流等分类 |
| `description` | 业务含义 |
| `formula` | 可审计公式说明 |
| `inputFields` | 明确输入字段白名单 |
| `timeframe` | 观察周期 |
| `direction` | 高值对正T/反T的支持方向或上下文属性 |
| `version` | 不可变因子版本 |
| `createdAt` | 版本创建时间 |
| `status` | 当前状态，首批均为 `research` |

同一 `factorId@version` 不能重复注册。已保存的 Factor Library 文件若内容不同，系统拒绝覆盖。

## 6. 首批 48 个做T因子

| 分类 | 数量 | 因子 |
| --- | ---: | --- |
| 价格/动量 | 9 | 1/3/5/10/15/30分钟收益、开盘缺口、日内收益、日内位置 |
| VWAP | 7 | 偏离、3/5/15分钟斜率、穿越、5分钟持续性、均值回归 |
| 成交量 | 5 | 5/20量比、3/15量能动量、20分钟Z分数、量价协同、缩量 |
| 波动率 | 5 | 真实波幅、ATR14、10分钟实现波动、区间扩张、布林带宽 |
| 技术指标 | 5 | RSI14、MACD柱、MACD柱变化、KDJ J、布林位置 |
| 分时结构 | 5 | 3分钟反转、上影、下影、20分钟突破、距10分钟高点回撤 |
| 市场环境 | 4 | 大盘5分钟、板块5分钟、相对强弱、市场Regime |
| 资金/订单流 | 4 | 主动买卖失衡、OFI三分钟变化、大单净额比、盘口深度失衡 |
| 时间 | 4 | 开盘以来分钟、开盘窗口、午后窗口、尾盘窗口 |

这些因子是独立研究变量，不是 48 条交易信号。单因子验证通过后也只能进入候选库，不能绕过成本、趋势、VWAP、持仓和风控硬约束。

## 7. 因果与反泄漏设计

### 7.1 因果访问

因子在索引 `t` 只能读取 `[0..t]`。`CausalFactorContext` 对任何未来索引或正向 offset 直接抛出 `FutureLeakageError`。

未来 5、10、15、30 分钟价格只在 Backtest Engine 生成标签，不会传入 Factor Engine。

### 7.2 Future Leakage 审计

每次研究运行都会选择同一会话的多个检查点：

1. 使用完整会话计算检查点因子。
2. 将输入截断到检查点重新计算。
3. 对每个因子逐值比较。
4. 任一因子变化则审计失败。

`futureReturn`、`label`、`target`、`outcome`、`pnl` 等字段禁止声明为因子输入。

### 7.3 时间样本外

默认按交易日顺序切分：

- Train：60%
- Validation：20%
- Test：20%

三个日期集合必须互斥。阈值分位数只在 Train 拟合，Validation 和 Test 不允许重新拟合。

### 7.4 Rolling Out-of-Sample

默认使用扩展训练窗口：至少 20 个交易日训练，随后 10 日样本外测试，每 10 日向前滚动。数据不足时仍返回明确的空窗口，而不是混入样本内结果。

### 7.5 参数敏感性

默认比较训练集分位阈值 65%、70%、75%，并分别输出样本外交易数、胜率、扣费后平均收益和 Profit Factor。单个阈值表现异常但邻域崩溃的因子不得进入候选库。

## 8. 正T与反T回测

每个因子分别生成：

- `positiveT`：当前买入、未来卖出，未来上涨为正方向。
- `reverseT`：当前卖出、未来买回，未来下跌为正方向。

每个方向分别测试 5、10、15、30 分钟。默认每 5 分钟抽样一次，减少高度重叠分钟被误当作独立交易的问题。

本阶段是单因子预测能力研究，不模拟持仓额度、同日多信号互斥或完整闭环状态机。这些属于下一阶段组合候选和影子接入评审。

## 9. Evaluation 输出

每个 `factorId × direction × horizon` 输出：

- 样本数量
- Pearson IC
- Spearman Rank IC
- 按交易日 IC 均值、标准差、IR、正 IC 日比例
- 胜率
- 平均毛收益
- 平均扣费后收益和扣费后收益合计
- 盈亏比
- 最大回撤
- Profit Factor
- 交易次数
- 不同年份表现
- 不同市场环境表现
- 参数稳定性
- Rolling Out-of-Sample 窗口表现
- Factor Score

Factor Score 为 0–100 的研究排序分，综合 IC、IC稳定性、胜率、扣费收益、Profit Factor、回撤和样本量。它不是交易置信度，也不具备晋级决定权。

## 10. Factor Library

默认候选保存门槛：

- Test 样本不少于 100
- 扣费交易不少于 30
- Factor Score 不低于 60
- Profit Factor 不低于 1.2
- 最大回撤不高于 10%
- 至少两个有效 Rolling OOS 窗口

达到门槛的结果保存为独立不可变 JSON。未达到门槛不保存为“已验证因子”，但完整研究报告仍保留。

因子库是研究证据库，不是正式策略库。

## 11. 可复现元数据

每份报告记录：

- `datasetId`
- `datasetChecksum`（SHA-256）
- `engineVersion`
- `factorVersion`
- `configHash`（SHA-256）
- `asOf`
- `gitCommit`

对象使用稳定键排序后计算校验和。报告文件名同时包含数据集校验和与配置校验和，且相同路径内容不一致时拒绝覆盖。

## 12. 如何运行

使用现有紫金 JSONL 归档：

```powershell
node scripts/run-factor-research.mjs `
  --input .data-inspect/zijin-601899-sessions.jsonl `
  --output .factor-research/zijin-v1 `
  --dataset-id zijin-601899-minute-v1
```

只运行指定因子：

```powershell
node scripts/run-factor-research.mjs `
  --input <sessions.jsonl> `
  --output <output-directory> `
  --factor price.return_5m,vwap.mean_reversion,orderflow.active_buy_imbalance
```

输入也可以是：

- JSON 会话数组
- `{ "sessions": [...] }`
- `{ "session": {...} }`
- 每行一个会话的 JSONL

CLI 不会生成假行情，不调用实时接口，不写生产数据库，也不触发部署。

## 13. Paperclip 后续编排契约

本阶段不部署 Paperclip。将来 Paperclip 只编排一个确定性研究任务：

```json
{
  "taskType": "factor-research-v1",
  "datasetId": "zijin-601899-minute-v1",
  "datasetChecksum": "sha256",
  "factorIds": ["vwap.mean_reversion"],
  "directions": ["positiveT", "reverseT"],
  "horizons": [5, 10, 15, 30],
  "asOf": "2026-08-12T00:00:00Z"
}
```

建议调用边界：

```text
Paperclip Issue
  -> Research Bridge（只校验任务、权限、预算和dataset manifest）
  -> 隔离 Factor Research Worker
  -> 不可变报告存储
  -> Paperclip Activity 只保存URI、checksum和摘要
  -> 人工研究审核
```

Paperclip 和 Agent 不接收生产数据库凭证，不访问 trading adapter，不允许把 Factor Library 直接写入 Smart-T 或影子 V2。

## 14. 文件范围

新增文件：

- `FACTOR_RESEARCH_V1_PLAN.md`
- `lib/factor-research/factor-registry.mjs`
- `lib/factor-research/factor-engine.mjs`
- `lib/factor-research/factor-backtest-engine.mjs`
- `lib/factor-research/factor-evaluation.mjs`
- `lib/factor-research/factor-library.mjs`
- `lib/factor-research/reproducibility.mjs`
- `lib/factor-research/index.mjs`
- `scripts/run-factor-research.mjs`
- `tests/factor-research.test.mjs`

现有文件不需要修改。

## 15. 当前未实现

Phase 1A 有意不实现：

- Paperclip 服务和七 Agent 部署
- Bridge、消息队列、任务数据库和 Web UI
- 因子组合搜索、特征正交化和组合策略优化
- 影子 V2 接入和实时因子面板
- 多信号互斥、持仓状态机和完整闭环执行模拟
- Tick/逐笔到分钟的离线聚合器
- 复权、停牌、涨跌停等数据清洗流水线
- 大盘、板块、商品和 L2 历史数据的自动对齐
- 自动晋级正式策略
- 生产数据库、真实交易及部署

下一阶段应先用真实版本化数据集跑足样本，审阅各方向和周期的样本外结果，再决定是否设计因子组合。不能仅凭一次高胜率或 Factor Score 将因子接入影子 V2。
