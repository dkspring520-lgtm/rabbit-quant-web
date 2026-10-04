# OFFLINE RL V0.12.14.16 — Approved Reward Contract Freeze

本文件是基于人工批准结果重新记录的 Freeze 文档。
原始 Decision Input 保留于：

`docs/rl-research/offline-rl-v0.12.14.15-human-decision-record.md`

原文件未修改。

## Observed Price Contract

```text
Status: APPROVED_FOR_RESEARCH
contractId: OBSERVED_PRICE_RESEARCH_CONTRACT_V1
field: marketState.price
semanticLabel: Observed Reference Price
```

该字段不代表：

- close
- last_trade
- executable_price
- verified_1m_candle_close

## Reward Objective

```text
Status: APPROVED
Selected: F2_NORMALIZED_PORTFOLIO_RETURN
Formula: (V_end - V_start) / max(abs(V_start), epsilon)
```

## Horizon

```text
Status: APPROVED
Selected: NEXT_OBSERVATION
```

## Attribution

```text
Status: APPROVED
Selected: POSITION_INTERVAL
```

收益归属于持仓区间，必须避免同一 P&L 在 BUY/HOLD/SELL 间重复归因。

## Accounting

```text
Status: APPROVED
Selected: ACCOUNTING_CLOSED
```

Reward 层禁止重复扣除：

- fee
- slippage

## No Action

```text
Status: APPROVED
Selected: OBSERVED_PORTFOLIO_MOVEMENT
```

奖励基于账户状态变化，不把股票涨跌直接作为 HOLD reward。

## Blocked Action

```text
Status: APPROVED
Selected: FEASIBILITY_AWARE
```

必须区分 blocked execution 与 executed losing action。

## Terminal

```text
Status: APPROVED
Selected: HYBRID
SESSION_END: Observed Reference Price valuation
OPEN_POSITION: 允许持仓结束
FORCED_FLAT: 禁止默认强平
```

## Explicit Non-goals

禁止：

- 修改历史 Replay。
- 创建 synthetic OHLC。
- 构造 bid/ask/mid。
- 修改 `marketState.price` 语义。
- 自动生成未来价格 feature。
- Reward 层重复扣成本。
- 实现 Reward Engine。
- 生成 Reward Artifact。
- 生成 Dataset。
- 创建 Value-Q。
- 开始训练。

## Final Status

```text
REWARD_CONTRACT_STATUS = APPROVED
REWARD_FORMULA = APPROVED
REWARD_HORIZON = APPROVED
REWARD_ARTIFACT_STATUS = NOT_STARTED
DATASET = BLOCKED_PENDING_IMPLEMENTATION
VALUE_Q = BLOCKED_PENDING_IMPLEMENTATION
RL_TRAINING = NOT_STARTED
HARD_STOP = RELEASED_FOR_IMPLEMENTATION
```
