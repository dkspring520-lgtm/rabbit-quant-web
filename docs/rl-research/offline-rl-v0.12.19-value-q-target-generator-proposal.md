# OFFLINE RL V0.12.19 — Value-Q Target Generator Design Proposal

## Status

本文件只设计 Target Generator Proposal，不生成真实 target、Dataset、训练数据或模型。

```text
VALUE_Q_TARGET_GENERATOR = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

## 1. Target Formula Design

### Candidate A — Monte Carlo Return

```text
G_t = Σ γ^k r_(t+k)
```

- 做T短周期适配：可覆盖持仓区间，但短周期样本仍依赖完整后续 episode。
- Reward稳定性：直接累积已批准 reward；对 terminal、缺失 horizon 和归因错误敏感。
- Offline Dataset compatibility：需要完整、有序、不重叠的 episode transitions。
- Bootstrap风险：无 bootstrap，估计方差可能较高。
- 长持仓偏差：可能把长期结果集中归因到较早 transition。

### Candidate B — TD(0)

```text
y = r + γ Q(next_state, next_action)
```

- 做T短周期适配：适合 NEXT_OBSERVATION 的局部目标。
- Reward稳定性：单步目标较稳定，但依赖 Q bootstrap。
- Offline Dataset compatibility：需要可靠 next_state、done 和 action 编码。
- Bootstrap风险：存在分布外 action、估计误差累积和 extrapolation bias。
- 长持仓偏差：可能低估延迟收益。

### Candidate C — n-step Return

```text
y = Σ(i=0..n-1) γ^i r_(t+i) + γ^n(1-done_(t+n))Q(s_(t+n), a_(t+n))
```

- 做T短周期适配：可折中短周期做T与延迟持仓收益。
- Reward稳定性：较 TD(0) 少一步偏差，但受窗口重叠影响。
- Offline Dataset compatibility：需要连续 transitions、明确 session/T+1 边界和不重叠 attribution。
- Bootstrap风险：仍有 bootstrap，n 越大越依赖未来数据完整性。
- 长持仓偏差：n 和 γ 不当会导致长持仓或 terminal 偏差。

```text
TARGET_FORMULA = PROPOSAL_ONLY
TARGET_SELECTED = NONE
```

## 2. Target Input Contract

输入必须严格来自 Dataset Artifact：

- state
- action
- reward
- next_state
- done

Reward lineage：

```text
Dataset Artifact
  → Reward Artifact V0.12.15.1
  → Approved Reward Contract
```

禁止：

- 直接读取 Replay。
- 重新读取历史价格计算 target。
- 重新计算 reward。
- 使用 forward return 替代 reward。
- 将 target 写回 Dataset Artifact 或 Replay。

## 3. Discount Factor Proposal

候选：

### γ = 0.90

更重视分钟级近期结果；可能弱化跨多个 observation 的持仓收益。

### γ = 0.95

中等折扣候选；需要结合做T持仓周期和 terminal 边界验证。

### γ = 0.99

更重视长期持仓结果；对 terminal、缺失 observation、跨日和 T+1 规则更敏感。

分钟级交易影响：γ 决定未来多个 observation 的权重。

做T持仓周期影响：较低 γ 偏近期，较高 γ 偏持仓区间后段。

terminal敏感性：较高 γ 更依赖正确 done 与 terminal handling。

```text
DISCOUNT_FACTOR = PROPOSAL_ONLY
DISCOUNT_FACTOR_SELECTED = NONE
```

## 4. Terminal Handling

必须遵守：

- episode end 才能设置 terminal。
- terminal transition 使用 `done = true`。
- `done = true` 时不 bootstrap future Q。
- terminal transition 的 next_state 必须为 null。

禁止：

- 使用未来 reward 泄漏到 state。
- 根据 reward 数值推断 done。
- 为 terminal synthetic liquidation。
- 创建 synthetic fee 或 slippage。

## 5. T+1 Constraint

Value target 不得：

- 使用不可卖仓位的未来信息作为当前 state feature。
- 修改 sellablePosition。
- 修改 todayBought。
- 绕过真实 T+1 交易规则。
- 把 blocked SELL 当作 executed losing SELL。

Value target 只读取 Dataset 中已经冻结的 T+1 状态。

## 6. Offline RL Safety

禁止：

- online interaction。
- policy improvement。
- 自动 action selection。
- reward hacking。
- future data contamination。
- random temporal split。
- unsupported action fabrication。
- oversampling 或人为平衡 action。

## 7. Human Approval Gate

必须人工批准：

- Target Formula：Monte Carlo / TD(0) / n-step。
- γ：0.90 / 0.95 / 0.99 或其他正式值。
- Bootstrap 方式。
- Training Objective。
- Episode/terminal definition。
- OOD 与 unsupported action policy。

在全部批准前：

```text
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
```

## Explicit Non-goals

本阶段不执行：

- Value-Q target generation。
- Dataset generation。
- Value-Q model training。
- RL training。
- Replay mutation。
- Reward recomputation。

## Final Gate

```text
VALUE_Q_TARGET_GENERATOR = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
