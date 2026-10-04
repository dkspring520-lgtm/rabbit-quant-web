# OFFLINE RL V0.12.14.15 — Human Decision Record

## Record Status

本记录仅保存人工决策输入状态。由于当前未收到明确的 APPROVE/REJECT 或候选选择，所有项目保持 `DEFER`，不得自动推断。

记录日期：2026-10-04

## 1. Observed Price Contract

```text
Decision: DEFER
contractId: OBSERVED_PRICE_RESEARCH_CONTRACT_V1
field: marketState.price
semanticLabel: Observed Reference Price
```

若未来人工 APPROVE，仅表示接受研究字段，不代表：

- close
- last trade
- executable price
- verified 1m candle close

Reason: 当前没有明确人工批准输入。

## 2. Reward Objective

```text
Decision: DEFER
Selected: NONE
```

候选：`F1` / `F2` / `F3`。

Reason: 未收到人工选择。

### F1

- Reason: 绝对组合价值变化，经济含义直接，但受资金规模影响。
- Economic rationale: 研究账户净值变化。
- Risk: 规模敏感、依赖 horizon 和 attribution。

### F2

- Reason: 归一化组合收益，便于跨规模比较。
- Economic rationale: 相对起始组合价值的变化。
- Risk: 零/极小分母和归一化规则未批准。

### F3

- Reason: 可能纳入风险调整。
- Economic rationale: 在组合收益之外考虑风险。
- Risk: risk adjustment 尚无唯一、稳定、可复现定义。

## 3. Horizon

```text
Decision: DEFER
Selected: NONE
```

候选：`Next Observation` / `Fixed Horizon` / `Terminal`。

Reason: 未收到人工选择。

## 4. Attribution

```text
Decision: DEFER
Selected: NONE
```

候选：

- `POSITION_INTERVAL`
- `ACTION_LOCAL`
- `TERMINAL`
- `RETURN_TO_GO`

Reason: 未收到人工选择。必须防止 `BUY → HOLD → SELL` 或 `BUY → BUY → SELL` 中同一 P&L 被重复归因。

## 5. Accounting

```text
Decision: DEFER
Selected: ACCOUNTING_CLOSED
```

`ACCOUNTING_CLOSED` 作为当前 Proposal 的固定候选记录；Reward 层禁止再次扣 fee/slippage。该记录不等于人工批准。

## 6. No-action

```text
Decision: DEFER
Selected: NONE
```

候选：`ZERO_REWARD` / `OBSERVED_PORTFOLIO_MOVEMENT` / `BENCHMARK_RELATIVE`。

Reason: 未收到人工选择；必须区分持仓 HOLD 与空仓 HOLD。

## 7. Blocked Action

```text
Decision: DEFER
Selected: NONE
```

候选：`FEASIBILITY_AWARE`。

必须区分：

- blocked execution：未产生真实成交。
- executed losing action：真实成交后经济结果为负。

不得为 blocked action 设置无经济依据的固定 penalty。

## 8. Terminal

```text
Decision: DEFER
Selected: NONE
```

候选：`SESSION_END` / `OPEN_POSITION` / `FORCED_FLAT` / `HYBRID`。

Reason: 未收到人工选择；不得自动强平或生成 synthetic action。

## 9. Decision Status Table

| Decision Item | Candidate | Selected | Reason | Reviewer | Date | Status |
|---|---|---|---|---|---|---|
| Observed Price Contract | APPROVE / REJECT / DEFER | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| Accounting Closed | YES / NO / DEFER | ACCOUNTING_CLOSED candidate only | approval not received |  | 2026-10-04 | DEFER |
| Reward Objective | F1 / F2 / F3 | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| Horizon | Next Observation / Fixed Horizon / Terminal | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| Attribution | POSITION_INTERVAL / ACTION_LOCAL / TERMINAL / RETURN_TO_GO | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| No-action | ZERO_REWARD / OBSERVED_PORTFOLIO_MOVEMENT / BENCHMARK_RELATIVE | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| Blocked Action | FEASIBILITY_AWARE | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| Terminal | SESSION_END / OPEN_POSITION / FORCED_FLAT / HYBRID | NONE | no explicit human input |  | 2026-10-04 | DEFER |
| Nullability | Numeric / Null / Incomplete / Censored | NONE | no explicit human input |  | 2026-10-04 | DEFER |

## 10. Final Status

由于没有全部人工批准：

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

## Prohibited Actions

- 修改 Reward Engine。
- 创建 Reward Artifact。
- 创建 Dataset。
- 创建 Value-Q target。
- 开始 RL training。
- 进入 V0.12.15。
