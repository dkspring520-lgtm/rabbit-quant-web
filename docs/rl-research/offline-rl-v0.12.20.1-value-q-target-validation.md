# OFFLINE RL V0.12.20.1 — Value-Q Target Validation Audit

Audit date: 2026-10-05

## STATUS

```text
STATUS = BLOCKED
VALUE_Q_TARGET_STATUS = BLOCKED
REWARD_DEPENDENCY_STATUS = VERIFIED_FOR_LINEAGE
DATASET_COMPATIBILITY = PASS_AT_SCHEMA_LEVEL / BLOCKED_FOR_MATERIALIZED_ARTIFACT
LEAKAGE_CHECK = PASS_FOR_SPEC_AND_VALIDATORS
HORIZON_STATUS = BLOCKED_PENDING_TARGET_POLICY
DISCOUNT_STATUS = PROPOSAL_ONLY
ACTION_SPACE_STATUS = BLOCKED_PENDING_CANONICAL_MAPPING
T1_STATUS = PASS_AT_SCHEMA_LEVEL / BLOCKED_FOR_MATERIALIZED_ARTIFACT
ACCOUNTING_DOUBLE_COUNTING = PASS_FOR_REWARD_ARTIFACT_CONTRACT
```

当前未生成 Value-Q target、training dataset、模型或训练结果。

## 1. Value Target Definition

当前 specification 只定义候选：

- Monte Carlo Return
- TD(0)
- n-step Return

未选择：

- target formula
- bootstrap policy
- discount factor
- training objective
- OOD/unsupported-action policy

因此无法生成可审计的唯一 target。

```text
VALUE_Q_TARGET_STATUS = BLOCKED
```

## 2. Dataset Compatibility Audit

Contract-level transition 结构为：

```text
(state, action, reward, next_state, done)
```

已存在的 schema/validator 能表达：

- state account fields
- observedReferencePrice / portfolio value research fields
- action type and execution status
- Reward Artifact lineage
- next_state / done

但当前实际 Dataset Artifact 尚未生成：

```text
DATASET_ARTIFACT_GENERATED = FALSE
```

因此：

```text
DATASET_COMPATIBILITY = PASS_AT_SCHEMA_LEVEL
DATASET_ARTIFACT_AVAILABILITY = BLOCKED
```

## 3. Reward Dependency / Lineage Audit

预期 lineage：

```text
Dataset reward
  → Reward Artifact V0.12.15.1
  → Approved F2 Reward Contract
```

当前 Reward Artifact module 和 approved contract 记录了：

- F2 normalized portfolio return
- ACCOUNTING_CLOSED
- POSITION_INTERVAL
- NEXT_OBSERVATION
- no fee/slippage re-deduction

Dataset builder proposal 使用 Reward Artifact reward，不重新计算 reward。

```text
REWARD_DEPENDENCY_STATUS = VERIFIED_FOR_LINEAGE
```

这不代表实际 Value-Q target 已生成。

## 4. Horizon Audit

Reward Contract 已批准：

```text
HORIZON = NEXT_OBSERVATION
```

Value-Q target specification 仍未决定：

- MC 的 episode/terminal accumulation boundary
- TD(0) bootstrap boundary
- n-step 的 n、跨 session、跨日与不完整窗口规则

因此：

```text
HORIZON_STATUS = BLOCKED_PENDING_TARGET_POLICY
```

## 5. Discount Audit

候选仍为：

- γ = 0.90
- γ = 0.95
- γ = 0.99

当前没有人工批准的 gamma。

```text
DISCOUNT_STATUS = PROPOSAL_ONLY
DISCOUNT_FACTOR_SELECTED = NONE
```

## 6. Reward Accounting / Double Counting Audit

Reward Artifact contract 已明确：

```text
execution → fillPrice / fees → cash / position → portfolio value → reward
```

Reward 层不重复扣：

- fee
- slippage

Value-Q target 也不得修改 reward 或再次扣成本。

```text
ACCOUNTING_DOUBLE_COUNTING = PASS_FOR_REWARD_ARTIFACT_CONTRACT
```

## 7. Action Space Audit

Value-Q specification 用抽象 action 定义：

- BUY
- SELL
- HOLD
- NO_ACTION

现有 Dataset builder 实际保留的 action 来源是 Replay 的 `expertAction`，其值可能为：

- WAIT
- BUY_SMALL
- BUY
- SELL_PART
- SELL_ALL

尚未有正式、不可歧义的 canonical mapping，例如：

```text
WAIT → HOLD 或 NO_ACTION？
BUY_SMALL → BUY？
SELL_PART / SELL_ALL → SELL？
```

若未经批准直接合并，可能改变 action support 和 Q action semantics。

```text
ACTION_SPACE_STATUS = BLOCKED_PENDING_CANONICAL_MAPPING
```

## 8. T+1 Constraint Audit

Contract/schema 保留：

- cash
- position
- sellablePosition
- todayBought
- averageCost

validator 检查 `sellablePosition <= position`，并保留 blocked execution status。

但实际 Dataset Artifact 尚未生成，因此只能确认 schema-level safety：

```text
T1_STATUS = PASS_AT_SCHEMA_LEVEL / BLOCKED_FOR_MATERIALIZED_ARTIFACT
```

Value-Q 不得修改或推导新的 sellablePosition。

## 9. Leakage Check

Specification 和 validator 禁止：

- future feature
- future price/volume
- future portfolio value
- terminal outcome 回流到 state
- future reward 作为 state feature
- 从 Replay 或历史价格重新计算 target inputs

当前没有 Value-Q target 计算代码，也没有训练代码。

```text
LEAKAGE_CHECK = PASS_FOR_SPEC_AND_VALIDATORS
```

这是规格/验证层 PASS，不是已训练模型的实证证明。

## 10. Terminal / Done Audit

当前 contract 约束：

- `done = true` 仅表示 episode terminal。
- terminal transition 的 next_state 为 null。
- done 不由 reward 数值推断。
- 不生成 synthetic liquidation、fee 或 slippage。

Terminal 编码在 schema/validator 层有定义，但实际 Dataset Artifact 未生成。

```text
TERMINAL_STATUS = PASS_AT_SCHEMA_LEVEL / BLOCKED_FOR_MATERIALIZED_ARTIFACT
```

## 11. Completed

- V0.12.18 Value-Q Contract specification。
- V0.12.18.1 Contract validation audit。
- V0.12.19 Target Generator proposal。
- V0.12.20 Target Generator specification。
- Reward Artifact contract and validation。
- Dataset Contract and validation framework。
- Leakage rules。
- T+1 and terminal schema constraints。

## 12. Blocked

- Target formula selection。
- Discount factor selection。
- Bootstrap policy。
- Training objective。
- Canonical action mapping。
- Materialized Dataset Artifact。
- Value-Q target generation。
- RL training。

## Next Recommended Step

人工批准以下项目后，才可进入下一实现阶段：

1. Target formula：Monte Carlo / TD(0) / n-step。
2. Gamma：0.90 / 0.95 / 0.99。
3. Bootstrap policy。
4. Canonical action mapping。
5. Episode/terminal training objective。
6. 是否先生成并独立审计实际 Dataset Artifact。

在此之前保持：

```text
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
