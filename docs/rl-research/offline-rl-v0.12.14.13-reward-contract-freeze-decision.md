# OFFLINE RL V0.12.14.13 — Reward Contract Human Decision Freeze

## Freeze Status

本文件冻结当前人工决策状态，不自动选择 winner，不批准、不实现 Reward Contract。

## A. Current Approved State

```text
OBSERVED_PRICE_CONTRACT = NOT_APPROVED
REWARD_CONTRACT = NOT_APPROVED
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

## B. Decision Matrix

所有项目初始状态均为 `DEFER`。`APPROVE` 或 `REJECT` 只能由人工填写；本矩阵没有自动 winner。

### Objective

| Candidate | STATUS | Human decision note |
|---|---|---|
| F1 Portfolio Value Delta | DEFER | `V_end - V_start`；绝对账户价值变化 |
| F2 Normalized Portfolio Return | DEFER | 归一化账户收益；需分母规则 |
| F3 Risk Adjusted Return | DEFER | 需批准 risk adjustment 定义 |

### Horizon

| Candidate | STATUS | Human decision note |
|---|---|---|
| Next Observation | DEFER | 观察边界和时间语义未批准 |
| Fixed Horizon | DEFER | 固定 bar/time 与跨日规则未批准 |
| Terminal | DEFER | terminal/open-position 规则未批准 |

### Attribution

| Candidate | STATUS | Human decision note |
|---|---|---|
| POSITION_INTERVAL | DEFER | 需唯一持仓区间所有权 |
| ACTION_LOCAL | DEFER | 可能产生重复归因 |
| TERMINAL | DEFER | 稀疏但可能减少重复归因 |
| RETURN_TO_GO | DEFER | 需不重叠 target ownership |

### No-action

| Candidate | STATUS | Human decision note |
|---|---|---|
| ZERO_REWARD | DEFER | HOLD 直接 reward 规则未批准 |
| OBSERVED_PORTFOLIO_MOVEMENT | DEFER | 依赖账户估值和 horizon |
| BENCHMARK_RELATIVE | DEFER | benchmark 未批准 |

### Blocked Action

| Candidate | STATUS | Human decision note |
|---|---|---|
| ZERO | DEFER | 不得自动解释为经济损失 |
| FEASIBILITY_AWARE | DEFER | 需明确 feasibility 语义 |
| NULL_TRANSITION | DEFER | 需 nullability/数据规则 |

### Terminal

| Candidate | STATUS | Human decision note |
|---|---|---|
| SESSION_END | DEFER | session end 语义未批准 |
| FIXED_HORIZON | DEFER | 依赖 horizon 决策 |
| OPEN_POSITION | DEFER | terminal open position 处理未批准 |
| FORCED_FLAT | DEFER | 可能引入 synthetic liquidation |

## C. Mandatory Human Decisions

### 1. Observed Reference Price Contract

```text
是否批准 Observed Reference Price Contract？
选择：YES / NO
当前：DEFER
```

### 2. Accounting Contract

```text
是否批准 ACCOUNTING_CLOSED？
选择：YES / NO
当前：DEFER
```

### 3. Reward Objective

```text
选择：F1 / F2 / F3
当前：DEFER
```

### 4. Reward Horizon

```text
选择：Next Observation / Fixed Horizon / Terminal
当前：DEFER
```

### 5. Multi-action Attribution

```text
选择：POSITION_INTERVAL / ACTION_LOCAL / TERMINAL / RETURN_TO_GO
当前：DEFER
```

### 6. Terminal Handling

```text
选择：SESSION_END / OPEN_POSITION / FORCED_FLAT
当前：DEFER
```

## D. Hard Stop

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
```

直到人工批准：

- 禁止自动选择 winner。
- 禁止根据推荐方案直接实现。
- 禁止生成 Reward Artifact。
- 禁止生成 Dataset。
- 禁止生成 Value-Q target。
- 禁止训练 RL。

## E. Final Gate

```text
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
