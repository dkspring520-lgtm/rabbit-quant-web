# OFFLINE RL V0.12.20 — Value-Q Target Generator Specification

## Status

```text
VALUE_Q_TARGET_GENERATOR = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

本文件只定义 Value-Q Target Generator 的规格与验证边界，不生成 target、Dataset、training data 或模型。

## 1. Value-Q Target Generator Contract

目标接口候选：

```text
Q(state, action)
```

Generator 未来只能消费已经验证的 Dataset Artifact transition；不得直接读取 Replay、历史价格或执行引擎。

## 2. Dataset Artifact 输入要求

输入 transition 必须包含：

- state
- action
- reward
- next_state
- done

输入来源：

```text
Dataset Artifact
  → validated transition
  → future target generator implementation
```

禁止：

- 直接读取 Replay。
- 重新生成 Dataset。
- 重新计算 reward。
- 读取历史价格补算 target。

## 3. Reward Lineage Lock

Reward lineage 必须保持：

```text
Dataset reward
  → Reward Artifact V0.12.15.1
  → Approved Reward Contract
```

Reward Formula：

```text
(V_end - V_start) / max(abs(V_start), epsilon)
```

Reward 层不重复扣 fee/slippage，Value-Q target 层也不得修改 reward。

## 4. Target Formula Candidates

### Candidate A — Monte Carlo Return

```text
G_t = Σ γ^k r_(t+k)
```

- 做T适配：可覆盖持仓区间结果，但依赖完整 episode。
- 长持仓偏差：可能把长期结果集中归因到早期 transition。
- Bootstrap风险：无 bootstrap，但方差较高。
- Dataset compatibility：需要时间有序且 reward 完整的 episode。

### Candidate B — TD(0)

```text
y = r + γ Q(next_state, next_action)
```

- 做T适配：适合 NEXT_OBSERVATION 的局部 transition。
- 长持仓偏差：可能低估延迟收益。
- Bootstrap风险：存在 Q 估计误差和 offline extrapolation bias。
- Dataset compatibility：依赖可靠 next_state、done 和 action。

### Candidate C — n-step Return

```text
y = Σ(i=0..n-1) γ^i r_(t+i) + γ^n(1-done_(t+n))Q(s_(t+n), a_(t+n))
```

- 做T适配：在短期做T与延迟持仓之间折中。
- 长持仓偏差：n、跨 session、T+1 和缺失 observation 规则会影响结果。
- Bootstrap风险：仍存在 bootstrap error，且重叠窗口会增加相关性。
- Dataset compatibility：需要连续、有序 transitions，禁止 synthetic padding。

```text
TARGET_FORMULA = PROPOSAL_ONLY
TARGET_SELECTED = NONE
```

## 5. Discount Factor Candidates

### γ = 0.90

偏重分钟级近期结果，可能忽略较长持仓收益。

### γ = 0.95

中等折扣候选，需要结合做T持仓周期和 terminal 边界验证。

### γ = 0.99

更重视长期结果，对 terminal、跨日、T+1 和数据边界更敏感。

```text
DISCOUNT_FACTOR = PROPOSAL_ONLY
DISCOUNT_FACTOR_SELECTED = NONE
```

## 6. T+1 Constraint

Value-Q target 不得：

- 修改 sellablePosition。
- 修改 todayBought。
- 把当日新买入仓位误判为可卖。
- 绕过真实 A 股 T+1 规则。
- 使用未来不可卖仓位信息污染当前 state。

## 7. Action Definitions

### BUY

必须保留 requested/executed quantity、execution status、cash、position 和 T+1 状态。

### SELL

必须受 sellablePosition 约束；blocked SELL 不得伪装为 executed SELL。

### HOLD

不得仅根据股票方向产生账户收益；应遵守账户状态与 Observed Reference Price 研究语义。

### NO_ACTION

必须与 blocked action 区分。空仓 HOLD 不因股票上涨自动获得账户收益。

## 8. Terminal Handling

- episode end 才能设置 `done = true`。
- terminal transition 的 `next_state = null`。
- `done` 不是未来收益标签。
- 不得默认 synthetic liquidation。
- 不得生成 synthetic fee 或 slippage。

SESSION_END、OPEN_POSITION、FORCED_FLAT 等 terminal 语义必须与已批准 Reward Contract 一致。

## 9. Offline Leakage Prevention

禁止：

- future feature。
- future price input。
- future volume。
- future portfolio value。
- terminal outcome 回流到 state。
- future reward 作为 feature。
- 从 Dataset 重新计算 reward。
- 随机时间切分。
- unsupported action fabrication。

只允许：

```text
state       = action-time input
reward      = target-side input
next_state  = target-side input
done        = terminal flag
```

## 10. Human Approval Gate

人工必须批准：

- Target Formula：Monte Carlo / TD(0) / n-step。
- Discount Factor：γ = 0.90 / 0.95 / 0.99。
- Bootstrap 方式。
- Episode Definition。
- Training Objective。

在人工批准前：

```text
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

## Explicit Non-goals

本阶段不创建：

- Value-Q target。
- Dataset。
- Training data。
- RL model。
- RL training code。
