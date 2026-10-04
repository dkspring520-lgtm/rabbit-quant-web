# OFFLINE RL V0.12.18.1 — Value-Q Contract Validation Audit

## Status

```text
VALUE_Q_CONTRACT_STATUS = VALIDATED_PROPOSAL
VALUE_Q_TARGET = BLOCKED
DATASET_STATUS = ARTIFACT_GENERATOR_COMPLETE
REWARD_ARTIFACT_STATUS = COMPLETE
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

本文件为只读 Contract Audit，不生成 Value-Q target、不训练模型。

## 1. Dataset Compatibility Audit

目标 transition：

```text
(state, action, reward, next_state, done)
```

审计结论：

- state：包含账户字段、Observed Reference Price 和因果 market context 候选。
- action：包含 action type、requested/executed quantity、execution status。
- reward：来自 Dataset Contract 规定的 Reward Artifact lineage。
- next_state：由下一有效 observation 表达；terminal 时为 null。
- done：仅表达 episode terminal。

```text
DATASET_VALUE_Q_COMPATIBILITY = PASS
```

说明：当前为 Contract/artifact-generator compatibility；没有生成实际 Value-Q target。

## 2. Reward Lineage Audit

批准 lineage：

```text
Dataset reward
  ↓
Reward Artifact V0.12.15.1
  ↓
Approved Reward Contract
```

约束：

- 不重新计算 reward。
- 不修改 reward。
- 不混入未来价格。
- 不从 future label 或 forward return 替代 reward。

```text
REWARD_LINEAGE = VERIFIED
```

## 3. Target Candidate Validation

仅比较候选，不执行。

### Candidate A — Monte Carlo Return

- 做T适配：能覆盖持仓区间和 terminal 结果。
- 长持仓偏差：较高，收益集中且依赖完整 episode。
- 数据稀疏：terminal/长区间样本不足时更明显。
- Offline stability：依赖完整、无重叠 attribution 的 reward sequence。

### Candidate B — TD(0)

- 做T适配：适合 NEXT_OBSERVATION 的局部 transition。
- 长持仓偏差：可能低估延迟收益。
- 数据稀疏：单步目标较容易形成，但受 next_state 质量影响。
- Offline stability：目标短，但对 bootstrap error 敏感。

### Candidate C — n-step Return

- 做T适配：可折中短期做T与持仓区间收益。
- 长持仓偏差：依赖 n、跨 session、T+1 和缺失 observation 规则。
- 数据稀疏：重叠窗口可能放大归因和样本相关性。
- Offline stability：需要严格时间顺序和不重叠 target ownership。

```text
TARGET_CANDIDATE_STATUS = PROPOSAL_ONLY
TARGET_SELECTED = NONE
```

## 4. Discount Factor Audit

候选：

- γ = 0.90：更重视近期做T结果，可能忽略延迟持仓收益。
- γ = 0.95：中等折扣候选，仍需 horizon/episode 证据。
- γ = 0.99：更重视长期组合结果，对 terminal 和数据边界更敏感。

```text
DISCOUNT_FACTOR_STATUS = PROPOSAL_ONLY
DISCOUNT_FACTOR_SELECTED = NONE
```

## 5. Leakage Audit

禁止输入：

- future feature
- future reward leakage
- future price input
- terminal information leakage

审计规则：

- state 仅使用 action-time 字段。
- reward 仅作为 target-side 数据。
- next_state 不回流为当前 state feature。
- done 不由未来收益数值推断。
- 不从 Dataset 重新推导 reward。

```text
VALUE_Q_LEAKAGE_AUDIT = PASS
```

该 PASS 仅表示 Contract 约束可验证，不代表 Value-Q 已训练或 target 已生成。

## 6. Human Decision Gate

以下决定仍需人工批准：

- Target Formula：Monte Carlo / TD(0) / n-step。
- Discount Factor：γ = 0.90 / 0.95 / 0.99 或其他经批准值。
- Episode Definition。
- Training Objective。

```text
VALUE_Q_TARGET = BLOCKED
```

禁止：

- 生成 Value-Q target。
- 训练 Value-Q。
- 开始 RL training。
- 修改 Dataset Artifact。
- 修改 Replay。
- 修改 Reward Artifact。

## Final Gate

```text
VALUE_Q_CONTRACT_STATUS = VALIDATED_PROPOSAL
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
