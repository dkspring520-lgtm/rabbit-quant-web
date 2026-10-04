# OFFLINE RL V0.12.14.14 — Human Decision Form

## Review Status

本表单基于 V0.12.14.13 Human Decision Freeze，仅供人工填写。不得自动选择 winner，不批准或实现 Reward。

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

## A. Observed Price Contract Decision

选择：`APPROVE` / `REJECT` / `DEFER`

当前状态：`DEFER`

若 APPROVE，仅表示接受 `marketState.price` 作为研究字段，不代表它是：

- last trade
- executable price
- verified close
- verified 1m bar close

Reviewer: ____________________  Date: 2026-10-04  Decision: ____________________
Reason: ______________________________________________________________

## B. Reward Objective Decision

所有候选默认 `DEFER`。是否推荐由人工决定。

### F1 — Portfolio Value Delta

公式：`V_end - V_start`

- 优点：经济单位直接，组合感知，易审计。
- 风险：对资金规模敏感；长期持仓与 horizon 选择可能影响结果。
- 做T匹配度：较高候选。
- 是否推荐：不自动推荐，等待人工决定。

Selected: ______  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

### F2 — Normalized Portfolio Return

公式：`(V_end - V_start) / abs(V_start)`

- 优点：跨账户规模更可比较。
- 风险：零/极小分母、归一化规则和小样本噪声。
- 做T匹配度：较高候选，但依赖分母规则。
- 是否推荐：不自动推荐，等待人工决定。

Selected: ______  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

### F3 — Risk Adjusted Objective

候选：portfolio return 减去已批准的 risk adjustment。

- 优点：可能表达回撤或风险约束。
- 风险：risk adjustment 尚无唯一、稳定、可复现定义；复杂度高。
- 做T匹配度：待风险定义证据。
- 是否推荐：不自动推荐，等待人工决定。

Selected: ______  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

## C. Horizon Decision

候选：

- `Next Observation`
- `Fixed Horizon`
- `Terminal Episode`

Selected: ____________________  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

必须同时记录：跨日规则、T+1、未完成 horizon、终值和 leakage 处理。

## D. Attribution Decision

候选：

- `POSITION_INTERVAL`
- `ACTION_LOCAL`
- `TERMINAL`
- `RETURN_TO_GO`

必须说明：同一经济 P&L 可能被 BUY、HOLD、SELL 多次计入。特别是 `BUY → HOLD → SELL` 和 `BUY → BUY → SELL`，需要唯一 attribution ownership。

Selected: ____________________  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

## E. No-action Decision

候选：

- `ZERO_REWARD`
- `OBSERVED_PORTFOLIO_MOVEMENT`
- `BENCHMARK_RELATIVE`

必须区分持仓 HOLD 与空仓 HOLD；不能把股票涨跌直接当作账户收益。

Selected: ____________________  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

## F. Blocked Action Decision

必须区分：

- **Blocked execution**：不可行或未产生真实成交。
- **Executed losing action**：真实成交后经济结果为负。

候选 blocked 处理：`ZERO` / `FEASIBILITY_AWARE` / `NULL_TRANSITION`。不得无经济依据设置固定 penalty。

Selected: ____________________  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

## G. Terminal Decision

候选：

- `SESSION_END`
- `OPEN_POSITION`
- `FORCED_FLAT`
- `HYBRID`

必须明确 open position、未实现收益、synthetic liquidation、synthetic fee 和 synthetic slippage 处理。

Selected: ____________________  Status: DEFER  Reviewer: ______  Date: ______
Reason: ______________________________________________________________

## Decision Status Table

| Decision Item | Candidate | Selected | Reason | Reviewer | Date | Status |
|---|---|---|---|---|---|---|
| Observed Price Contract | APPROVE / REJECT / DEFER |  |  |  |  | DEFER |
| Accounting Closed | YES / NO / DEFER |  |  |  |  | DEFER |
| Reward Objective | F1 / F2 / F3 |  |  |  |  | DEFER |
| Horizon | Next Observation / Fixed Horizon / Terminal Episode |  |  |  |  | DEFER |
| Attribution | POSITION_INTERVAL / ACTION_LOCAL / TERMINAL / RETURN_TO_GO |  |  |  |  | DEFER |
| No-action | ZERO_REWARD / OBSERVED_PORTFOLIO_MOVEMENT / BENCHMARK_RELATIVE |  |  |  |  | DEFER |
| Blocked Action | ZERO / FEASIBILITY_AWARE / NULL_TRANSITION |  |  |  |  | DEFER |
| Terminal | SESSION_END / OPEN_POSITION / FORCED_FLAT / HYBRID |  |  |  |  | DEFER |
| Nullability | Numeric / Null / Incomplete / Censored |  |  |  |  | DEFER |

## Explicit Non-goals

禁止：

- 修改 Reward Engine。
- 修改 Replay。
- 修改 Dataset。
- 创建 Reward Artifact。
- 创建 Value-Q target。
- 开始 RL training。
- 进入 V0.12.15。

## Final Gate

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
