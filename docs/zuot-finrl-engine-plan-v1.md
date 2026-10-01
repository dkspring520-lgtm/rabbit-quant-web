# 做T神器 × FinRL AI交易引擎技术方案 V1.0

## 1. 结论

FinRL / FinRL-X 适合作为离线强化学习研究与模拟执行的架构参考，不直接进入盘中正式信号链，也不替换现有 V2.9/Smart-T 逻辑。第一阶段只建立可关闭、可回放、可审计的研究层。

硬约束：A 股 T+1、只使用已观测数据、时间顺序切分、模拟资金、禁止真实下单；RL 输出只能标记为 experimental，不能升级为 BUY/SELL 正式信号。

## 2. 当前项目架构扫描

### 数据流

- 行情/盘口入口：`app/api/market-data/route.ts`、`app/api/trading-desk-snapshot/route.ts`、`app/api/zijin-hk-minute/route.ts`，客户端主页面在 `app/authenticated-app.tsx` 维护分钟、报价、L2 和上下文状态。
- L2 与订单流：`lib/zijin-order-flow-engine.mjs`、`lib/zijin-l2-causal-replay.mjs`、`lib/qmt-orderflow-confirmation.mjs`、`lib/zijin-main-force-track.mjs`。
- 因子研究：`lib/factor-research/factor-registry.mjs` 定义 48 个因子；`factor-engine.mjs` 使用 `CausalFactorContext` 严格禁止未来数据；`factor-backtest-engine.mjs` 已有成本、阈值、时间切分、滚动样本外和未来不变性审计。

### 信号流

- 正式盘中信号/执行约束：`lib/smart-t-engine.mjs` 的 `runSmartTReplay` 及其 `t-cycle-state-machine.mjs`。包含候选、正式闭环、成本/滑点、仓位、方向、时间窗和 T 飞/趋势风控。
- 信号融合/展示：`lib/signal-fusion.mjs`、`lib/chart-event-groups.mjs`、`lib/live-monitor-alerts.mjs`；图表展示通过 `app/authenticated-app.tsx`，正式、候选、观察和影子层需要保持分层。
- 慢速研究/影子：`lib/factor-research/zuot-v2-shadow.mjs`、`lib/shadow-research-layer.mjs`、`lib/zijin-shadow-ab.mjs`，不能回写正式评分。

### 交易与回测流

- 规则回放/回测：`runSmartTReplay`，已有 A 股交易时间、手续费、滑点、部分成本与 T 闭环模拟。
- 个人模拟训练：`lib/personal-replay-training.mjs` + `app/api/personal-replay-sessions/route.ts`，支持模拟订单、费用和动作评分，但当前是训练/个人回放接口，不是统一交易环境。
- 交易台持仓：`lib/stock-position.mjs` 区分 `openingShares`、`sellable`、计划底仓和待确认迁移；`lib/trade-ledger.mjs` 负责人工交易台账。
- 复盘闭环：`lib/strategy-closed-loop-ledger.mjs` 配对人工成交并计算扣费后闭环、胜率、净盈亏和图表标记。

## 3. FinRL → 做T神器映射

| FinRL 概念 | 本项目对应 | 约束 |
|---|---|---|
| Environment | `TTradingEnvironment`（新增研究模块） | 只接受 causal minute snapshot；显式 T+1 与现金/可卖持仓 |
| Observation | `factor-engine` 行快照 | 原始因子、数据质量、as-of 时间一起保存 |
| Action | WAIT / BUY / SELL | 第一阶段只做纸面动作，不触发正式信号或真实订单 |
| Reward | `TRewardModel` | 净收益减成本、滑点、回撤、过度交易、非法 T+1 行为 |
| Agent | `RLResearchAgent` | 仅离线/回放；输出实验动作和模型版本 |
| Execution | `PaperExecutionEngine` | 复用成本规则，记录订单/成交/拒绝原因 |
| Backtest | 现有 `runSmartTReplay` + `FactorBacktestEngine` | 不复制第二套正式回测；新增适配层 |
| Risk | `TRiskGate` | T+1、交易时间、涨跌停/停牌、资金、仓位、风险否决 |
| Evaluation | `PerformanceEngine` | 按模型、评分、因子、时间段、市场状态分组；样本外优先 |

## 4. 推荐新增目录

```text
lib/rl-research/
  schema.mjs              # observation/action/sample/model contract
  t-trading-environment.mjs
  paper-execution-engine.mjs
  signal-sample-engine.mjs
  performance-engine.mjs
  research-runner.mjs      # historical replay adapter; no UI side effects
  index.mjs
```

## 5. 第一阶段实施边界

### Phase 1A：统一契约

先定义可序列化 schema：`Observation`、`Action`、`ExecutionRecord`、`SignalSample`、`ModelVersion`。每条记录带 `symbol/date/time/asOf/modelVersion/source`。缺少成交量、L2 或盘口时保持 `null`，不补造。

### Phase 1B：TTradingEnvironment + PaperExecutionEngine

实现 `reset()`、`observe()`、`step()` 和纸面执行。明确：买入增加当日不可卖数量；卖出只能消耗昨日可卖底仓；数量按 100 股；资金、手续费、滑点和拒绝原因可审计。默认只接受 WAIT/BUY/SELL。

### Phase 1C：Sample/Performance

从现有正式/候选/观察事件生成样本，但不得把未来收益写回实时对象；只在历史回放结束后补齐 1/3/5/10 分钟标签。统计胜率、净收益、Profit Factor、最大回撤、持有时间，并区分 baseline 与 experimental。

### Phase 1D：RL 研究适配

先做 deterministic baseline adapter，再预留 Python/FinRL-X 导出格式。RL 训练进程独立运行，不加入 Vite/Worker 运行时，也不在 1 秒/5 秒行情轮询中调用模型。

## 6. 不修改的模块

- `lib/smart-t-engine.mjs` 正式信号阈值与执行门槛
- `lib/t-cycle-state-machine.mjs` T+1 闭环状态
- `app/authenticated-app.tsx` 现有操盘台布局和正式信号展示
- 现有 API 的实时轮询频率和生产告警协议

新增研究层默认关闭，仅通过离线脚本或明确的 shadow route 运行。

## 7. 验收与风险

每个阶段必须有独立 Node 测试：T+1、现金不足、卖出超可卖、手续费滑点、缺失 L2、时间顺序、未来泄漏、可重复运行和模型版本隔离。RL 结果不能进入正式 BUY/SELL、不能改变评分、不能下真实订单。

当前不建议直接安装 FinRL 作为生产依赖。仓库使用 Node/Vinext/Cloudflare Worker；FinRL 通常依赖 Python/PyTorch/Gym 环境，应通过离线导出文件或独立训练容器对接。

## 8. 下一步

确认本方案后，进入 Phase 1A，只新增 schema 和测试；完成后再进入环境与纸面执行。每个阶段单独构建、测试、审计并提交。
