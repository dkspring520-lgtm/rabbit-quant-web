# OFFLINE RL V0.12.14.12 — Reward Contract Human Approval Checklist

## Status

本文件仅供人工审批，不批准、不实现 Reward Contract。

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

## 1. Final Candidate Contract

### Portfolio Value

候选研究估值：

```text
portfolioValue = cash + position * Observed Reference Price
```

Observed Reference Price：

- 仅为研究字段。
- 不等同于 mark price。
- 不等同于 execution price。
- 不等同于 verified close。
- 不等同于 verified 1m bar close。

```text
VALUATION_PRICE_STATUS = RESEARCH_ONLY
MARK_PRICE_READINESS = BLOCKED
```

### Accounting

候选：

```text
ACCOUNTING_CLOSED
```

已审计执行成本通过 fillPrice、fees、cash 和 position 进入账户状态。Reward 层不得再次扣 fee 或 slippage。

### Formula candidates

- `F1`: `V_end - V_start`
- `F2`: `(V_end - V_start) / abs(V_start)`
- `F3`: risk-adjusted return

三者均为候选，未批准。

### Horizon candidates

- `Next Observation`
- `Fixed Horizon`
- `Terminal`

未选择。

### Attribution candidates

- `POSITION_INTERVAL`
- `ACTION_LOCAL`
- `TERMINAL`
- `RETURN_TO_GO`

未选择。

## 2. Human Decision Table

每一项只能由人工选择：`APPROVE`、`REJECT` 或 `DEFER`。当前默认状态全部为 `DEFER`。

| Decision | APPROVE / REJECT / DEFER | Human notes | Blocking impact |
|---|---|---|---|
| Observed Reference Price acceptance | DEFER | 是否接受 `marketState.price` 作为研究估值字段；不改变其未知语义 | 阻止估值 Contract 进入 Reward |
| Reward objective | DEFER | F1/F2/F3 选择 | 阻止 Reward Formula |
| Reward formula | DEFER | 数学定义、单位、输入与 nullability | 阻止 Reward Artifact |
| Horizon | DEFER | Next Observation / Fixed Horizon / Terminal | 阻止 target 边界 |
| Attribution | DEFER | POSITION_INTERVAL / ACTION_LOCAL / TERMINAL / RETURN_TO_GO | 阻止多 action 归因 |
| Terminal handling | DEFER | SESSION_END / FORCED_FLAT / CARRY_POSITION 等 | 阻止 terminal reward |
| No-action semantics | DEFER | ZERO / observed movement / benchmark-relative | 阻止 HOLD reward 语义 |
| Blocked-action semantics | DEFER | null / zero / feasibility-aware 等 | 阻止 blocked transition 语义 |
| Nullability | DEFER | numeric / null / incomplete / censored | 阻止数据有效性规则 |

### Approval rule

- `APPROVE`：仅表示该单项获得人工同意，不自动批准整体 Reward Contract。
- `REJECT`：该候选不得进入后续 Contract。
- `DEFER`：保持阻塞，等待更多证据或人工决定。
- 任何关键项为 `DEFER`，整体仍保持 `PROPOSAL_ONLY`。

## 3. Explicit Non-goals

本阶段禁止：

- Reward Engine implementation。
- Reward Artifact generation。
- Dataset generation。
- Value-Q target generation。
- RL training。
- 修改 Replay、历史数据或 Execution Engine。

## Final Gate

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
