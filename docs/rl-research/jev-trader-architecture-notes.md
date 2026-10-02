# JEV Trader Architecture Notes

参考项目：<https://github.com/jarrodwatts/jev-trader>

本文件只记录可借鉴的 Live Runtime 架构思想。它不引入 JEV 的交易策略、买卖逻辑、模型提示词、订单报价方式或链上执行方式。当前 Offline Learning V0.8.2.x 研究链路不依赖 JEV 代码。

## Hot Path / Async Path

JEV 把每个新区块的决策循环视为 hot path：读取最新 order book、生成决策，并在延迟预算内提交意图。收据、成交、费用、余额和历史状态在后续事件中异步更新。这个边界适合未来的 Live Decision Runtime：决策时只读取已经可用的当前市场状态，重型分析和结果结算放到 async path。

本项目未来应保持：

- Hot path：完成 Market State、Portfolio Context、Policy Decision 和 Decision Event。
- Async path：处理 outcome resolution、P&L 汇总、数据质量、漂移、重连、审计和 SSE 广播。
- Hot path 不等待未来 outcome、成交回执或慢速研究任务。

## Decision Event Schema

JEV 的 block event 把市场快照、decision、quote、fill、position 和 totals 组合成可追踪事件。对本项目可借鉴的最小研究事件是：

```json
{
  "eventId": "deterministic-id",
  "timestamp": "decision-time",
  "symbol": "601899.SH",
  "marketStateHash": "...",
  "portfolioContextHash": "...",
  "action": "WAIT",
  "applicable": true,
  "actionValue": null,
  "confidence": null,
  "modelVersion": "...",
  "stateVersion": "ValidatedStatePriceOnlyV0.1",
  "sourceMode": "DRY_RUN"
}
```

Outcome、Transition、P&L 和执行回执应通过关联 id 追加，不覆盖不可变的 decision-time 字段。未来实现应继续区分 `DECISION_TIME` 与 `OUTCOME_RESOLUTION_TIME`。

## 实时延迟预算

JEV README 描述了约 300 ms 的 block budget，并将 book read、model inference 和发送意图留在 hot loop；receipt、费用估算和 vault 检查异步完成。可借鉴的预算方法是记录每段耗时，而不是只记录总耗时：

- source/read latency
- state build latency
- model/policy latency
- action adapter latency
- total decision latency
- async receipt/outcome latency

未来 Live Decision Runtime 应配置预算和 `late` 状态。超出预算时生成明确的 late decision event，不偷偷使用过期市场状态。

## Position / P&L 状态

JEV 的事件包含 position、entry price、unrealized P&L、realized P&L、费用和累计统计。对本项目可借鉴的是状态分层：

- Decision Context：研究用 `ResearchPortfolioContextV0.1`，含 lots、T+1、cash 和 sellablePosition。
- Runtime Position：未来实时运行时的当前仓位和费用状态。
- Outcome/P&L：异步结算结果。

这不改变当前 Portfolio-aware Value 的单步定义，也不把 P&L 字段塞进 `ValidatedStatePriceOnlyV0.1`。

## Shadow / Dry-run

JEV 在没有私钥时使用真实市场读取和 simulated fills，仍保持 dry-run。这个模式分离思路可以借鉴，但本项目必须有更明确的模式枚举：

- `HISTORICAL_STREAM_SIMULATION`
- `DRY_RUN_LIVE_SHADOW`（未来设计）
- `REAL_EXECUTION`（当前禁止）

Dry-run 不应被报告为真实交易，也不应自动连接 Smart-T、Shadow V2 或 PaperExecutionEngine。

## Late Decision Handling

JEV 在模型错过当前 block 时产生 late/hold 结果，不发布过期报价。未来本项目应采用相同的显式处理原则：

- 决策窗口关闭后，标记 `late = true`。
- 不使用已经失效的 State 生成正式 Decision。
- 保存 late reason、source timestamp、received timestamp 和 latency。
- 不把 late decision 重写成正常 WAIT。

## 实时事件流 / SSE

JEV 提供 snapshot、history 和 `/events` SSE；连接时发送 snapshot，之后追加 block、quote、fill 事件。这个模式适合未来的只读监控面：

- 初次连接发送当前 runtime snapshot。
- 后续按顺序发送 append-only Decision、Outcome、Position 和 Health 事件。
- 客户端断线后从 sequence/event id 恢复，而不是依赖页面轮询猜测状态。
- SSE 只传播事件，不在浏览器重新计算交易结果。

## 对当前研究阶段的边界

本参考不会改变 V0.8.2.7 的 Market State、Portfolio Context、Action Value、Scenario Grid 或 single-step contract。当前不复制 JEV 的交易策略、买卖逻辑、post-only 报价、链上发送、钱包、RPC 或订单执行方式。

待 V0.8.4 Policy Replay 完成后，另行设计 `Live Decision Runtime V0.1`，届时再定义数据源、事件总线、延迟预算、dry-run 语义、断线恢复和 SSE 合约。
