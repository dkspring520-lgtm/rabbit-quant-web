# OFFLINE RL V0.12.14.9 — Reward Contract Proposal

## Status

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

本文件基于 `OBSERVED_PRICE_RESEARCH_CONTRACT_V1`，仅提出候选 Reward Contract，不实现、不批准任何公式。

## 1. Objective Definition

所有候选都依赖人工批准。

### F1 — Incremental Portfolio Value

```text
F1 = V_end - V_start
```

含义：研究区间内账户组合价值的绝对变化。

风险/待决：账户规模敏感；需要批准 start/end state、horizon、terminal 和 attribution。

### F2 — Portfolio Return

```text
F2 = (V_end - V_start) / abs(V_start)
```

含义：相对于起始组合价值的归一化变化。

风险/待决：`V_start = 0`、极小分母、归一化稳定性和缺失值规则均未批准。

### F3 — Risk-adjusted Return

候选形式：

```text
F3 = portfolio return - approved risk adjustment
```

风险/待决：risk adjustment 的输入、窗口、经济含义、可观测性和可复现性均未批准。

```text
CANDIDATE_ONLY = TRUE
```

## 2. Portfolio Value Definition

研究候选：

```text
portfolioValue = cash + position * observedReferencePrice
```

其中 `observedReferencePrice` 对应 `marketState.price`，但必须保持其研究语义边界。

它不是：

- mark price
- execution price
- verified close
- verified 1m bar close

因此：

```text
VALUATION_PRICE_STATUS = RESEARCH_ONLY
MARK_PRICE_READINESS = BLOCKED
```

该公式只是 Portfolio Valuation Research 的候选，不是最终 Reward Formula。

## 3. Accounting Contract

已审计的执行链：

```text
Execution
  → fillPrice
  → fees
  → cash / position
  → accounting-closed account state
```

Reward Proposal 应读取 accounting-closed state。

禁止：

- Reward 层再次扣 fee。
- Reward 层再次扣 slippage。
- 使用 fillPrice 作为通用 HOLD valuation price。
- 重复估算已有 execution cost。

原因：fee 已进入 cash，directional slippage 已反映在 fillPrice/accounting 中；再次扣除会产生 double counting。

```text
FEE_REDUCTION_AT_REWARD_LAYER = NOT_ALLOWED
SLIPPAGE_REDUCTION_AT_REWARD_LAYER = NOT_ALLOWED
```

## 4. Horizon Proposal

只列候选，不选择。

### H1 — Next Observation

从当前 observation 到同一 episode 的下一 observation。

待决：observation 的时间语义、跨 session、跨交易日和 T+1 边界。

### H2 — Fixed Trading Horizon

从 start state 到固定交易时间/固定 observation 数的终点。

待决：固定 bar、固定时间、跨日规则和不完整 horizon 处理。

### H3 — Terminal

从 start state 到 approved session/episode terminal。

待决：terminal 定义、持仓处理和 nullability。

```text
REWARD_HORIZON = BLOCKED
```

## 5. Attribution Proposal

候选：

### ACTION_LOCAL

将结果归因到单个 action transition。

风险：`BUY → HOLD → SELL` 中同一段经济 P&L 可能被 BUY 和 SELL 重复归因。

### POSITION_INTERVAL

将结果归因到一个独占持仓区间。

适用于比较 `BUY → HOLD → SELL`，但必须定义区间起止、部分成交、T+1 和唯一所有权。

### TERMINAL

在 horizon/terminal 统一结算。

优点是减少重复归因；缺点是 reward 稀疏、credit assignment 困难。

### RETURN_TO_GO

把未来组合结果作为 return-to-go 候选。

必须防止窗口重叠和同一 P&L 多次进入 target。

### Multi-action examples

`BUY → HOLD → SELL`：需要决定 entry、holding interval、exit 或 terminal attribution。

`BUY → BUY → SELL`：需要处理多批次 entry、不同成本、不同 T+1 release 和唯一 P&L ownership。

T+1 限制必须使用真实 `sellablePosition`、`todayBought` 和已审计的日期转换语义；不得制造 counterfactual attribution。

```text
ATTRIBUTION = NOT_APPROVED
```

## 6. No Action Proposal

### ZERO_REWARD

HOLD 不产生直接 reward。简单，但可能忽略持仓期间真实账户价值变化。

### OBSERVED_PORTFOLIO_MOVEMENT

HOLD 的结果由账户持仓、现金和 observedReferencePrice 的变化共同决定。更接近账户经济结果，但依赖 valuation/horizon 批准。

### BENCHMARK_RELATIVE

HOLD 相对于批准 benchmark 比较。当前没有已批准 benchmark。

三者均不批准。不得把 HOLD reward 简化成股票方向预测。

```text
NO_ACTION = NOT_APPROVED
```

## 7. Blocked Action Proposal

必须区分：

- invalid action / infeasible action：未产生合法 execution。
- executed losing action：实际执行成功，但后续经济结果为负。

Blocked action 候选可包括 zero、null/rejected 或 feasibility-aware，但本 Proposal 不批准任何一种。

不允许人工奖励：

- 不得随意设置 `-1`、`-0.5`、`-100`。
- 不得因为 action 被 blocked 就虚构交易损失。
- 不得把 blocked action 与 executed losing action 混合。

```text
BLOCKED_ACTION_REWARD = NOT_APPROVED
ARTIFICIAL_PENALTY = PROHIBITED
```

## 8. Terminal Proposal

### SESSION_END

在交易 session 结束处理；需要明确终值、未完成 horizon 和持仓处理。

### FORCED_FLAT

终端强制平仓；会引入 synthetic action、synthetic fee 和 synthetic slippage，不能默认采用。

### CARRY_POSITION

保留 terminal open position；需要定义 mark-to-value、跨 episode 边界和归因。

不选择任何 terminal policy。

```text
TERMINAL_CONTRACT = NOT_APPROVED
```

## 9. Final Human Approval Checklist

### Objective

- [ ] 选择 F1、F2 或 F3。
- [ ] 批准变量和单位。

### Portfolio Value

- [ ] 接受 `cash + position * observedReferencePrice` 作为研究估值候选。
- [ ] 接受该值不等同于 mark price、execution price 或 verified close。

### Accounting

- [ ] 接受 accounting-closed state。
- [ ] 接受 Reward 层不显式扣 fee。
- [ ] 接受 Reward 层不显式扣 slippage。

### Horizon

- [ ] 选择 H1、H2 或 H3。
- [ ] 批准跨日、T+1 和不完整 horizon 规则。

### Attribution

- [ ] 选择 ACTION_LOCAL、POSITION_INTERVAL、TERMINAL 或 RETURN_TO_GO。
- [ ] 批准 BUY→HOLD→SELL 的归因。
- [ ] 批准 BUY→BUY→SELL 的防重复归因。

### No Action / Blocked Action

- [ ] 选择 no-action semantics。
- [ ] 选择 blocked-action/nullability semantics。
- [ ] 禁止无经济依据的人工 penalty。

### Terminal

- [ ] 选择 SESSION_END、FORCED_FLAT 或 CARRY_POSITION。
- [ ] 批准 open position terminal 处理。

### Safety Gate

- [ ] 批准进入 Reward Contract review。
- [ ] 确认不修改 Replay/历史 Dataset。
- [ ] 确认不生成 Reward Artifact。
- [ ] 确认不训练 Value-Q/RL。

## Final Gate

```text
OBSERVED_PRICE_CONTRACT_STATUS = PROPOSAL_ONLY
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
