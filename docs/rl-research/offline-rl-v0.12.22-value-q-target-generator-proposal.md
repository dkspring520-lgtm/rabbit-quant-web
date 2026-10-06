# OFFLINE RL V0.12.22 — Value-Q Target Generator Proposal

Audit date: 2026-10-05

## Status

VALUE_Q_TARGET = BLOCKED
TARGET_GENERATOR = PROPOSAL_ONLY
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本文件只设计未来 Value-Q Target Generator 的技术方案，不生成 target、Dataset、parquet/jsonl artifact、模型或训练数据。

## 1. Generator Architecture Proposal

### Future interface

Input：

- validated state
- causal market features
- portfolio state
- action
- reward lineage reference
- next_state
- done

Output：

- candidate value target
- validation metadata
- target formula version
- gamma configuration
- bootstrap policy

当前只定义接口边界，不实现 target calculation。

### Required safety boundary

Generator 未来只能读取已验证 Dataset Artifact，不得直接读取 Replay、历史价格、Execution Engine 或 Reward Engine。不得在 Generator 内重新计算 reward。

## 2. Target Formula Proposal

所有选项均为：

STATUS = PROPOSAL_ONLY

### Option A — Monte Carlo Return

候选形式：G_t = Σ γ^k r_(t+k)。

- 不使用 Q bootstrap。
- 需要完整、有序 episode reward。
- 可能把长持仓结果集中归因到早期 transition。
- 对终端、缺失 observation 和 POSITION_INTERVAL ownership 敏感。

### Option B — TD(0)

候选形式：y = r + γ Q(next_state, next_action)。

- 单步目标，适配 NEXT_OBSERVATION 候选。
- 存在 bootstrap error 和 offline extrapolation bias。
- 依赖稳定 next_state、done 与 canonical action mapping。

### Option C — n-step Return

候选形式：n-step reward accumulation 加上 terminal-aware bootstrap。

- 可折中短期做T与延迟持仓收益。
- 依赖连续 transition、窗口边界、T+1 和 terminal 语义。
- 重叠窗口可能产生归因重复和样本相关性。

TARGET_FORMULA = BLOCKED
TARGET_FORMULA_SELECTED = NONE

## 3. Horizon Design

仅列候选，不选择最终值：

### 5 bars

短周期做T候选；对噪声和观察价格时间语义敏感。

### 15 bars

中短周期候选；可能覆盖部分持仓区间，但跨 session/T+1 仍需规则。

### 30 bars

较长盘中候选；更依赖完整 observation 和 attribution ownership。

### End-of-session

可覆盖 session 级持仓结果；对 terminal/open position/Observed Reference Price valuation 敏感。

HORIZON_SELECTED = NONE
HORIZON_STATUS = PROPOSAL_ONLY

## 4. Discount Factor

候选：

- gamma = 0.90
- gamma = 0.95
- gamma = 0.99

候选影响：

- 0.90：偏近期 observation，可能忽略延迟持仓收益。
- 0.95：中等折扣候选，需要结合 horizon。
- 0.99：偏长期结果，对 terminal、跨日和 T+1 更敏感。

DISCOUNT_FACTOR_STATUS = CANDIDATE_ONLY
DISCOUNT_FACTOR_SELECTED = NONE

## 5. Bootstrap Policy

候选：

- no bootstrap
- conservative bootstrap
- policy bootstrap

当前：

BOOTSTRAP_POLICY_STATUS = NOT_APPROVED
BOOTSTRAP_POLICY_SELECTED = NONE

不得在未批准前生成任何 bootstrap target。

## 6. Dataset Contract Dependency

Generator 依赖以下已验证或待批准 Contract：

- Dataset schema
- canonical action mapping
- approved Reward Contract
- ACCOUNTING_CLOSED accounting model
- next_state/done encoding
- T+1 sellablePosition/todayBought semantics
- terminal handling
- leakage prevention

当前 Dataset Artifact 尚未作为实际训练输入生成；因此 Generator 不能运行。

## 7. Approval Gate

只有以下项目全部 APPROVED，才允许将：

VALUE_Q_TARGET = ENABLED

必要批准项：

- Target Formula APPROVED
- Horizon APPROVED
- Gamma APPROVED
- Bootstrap APPROVED
- Action Mapping APPROVED

此外还必须确认：

- Training Objective APPROVED
- Episode Definition APPROVED
- Offline OOD policy APPROVED
- Unsupported action policy APPROVED

## Explicit Non-goals

禁止：

- 生成 Value-Q target。
- 生成 Dataset。
- 生成 parquet/jsonl artifact。
- 训练模型。
- 修改 Reward Contract。
- 修改 action space。
- 修改生产代码。
- 使用未来 feature。

## Final Gate

VALUE_Q_TARGET = BLOCKED
TARGET_GENERATOR = PROPOSAL_ONLY
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
HUMAN_REVIEW_REQUIRED = TRUE
