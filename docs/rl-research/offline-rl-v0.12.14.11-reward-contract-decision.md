# OFFLINE RL V0.12.14.11 — Reward Contract Decision Recommendation

## Status

本文件只提供研究推荐，不批准 Reward Contract。

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

## 1. Candidate Summary

### F1 — Absolute Portfolio Delta

```text
F1 = V_end - V_start
```

优点：直接、易审计、经济单位清晰、适合账户净值研究。

缺点：对资金规模敏感；不同初始资金之间不可直接比较。

### F2 — Normalized Portfolio Return

```text
F2 = (V_end - V_start) / abs(V_start)
```

优点：跨账户规模更可比较。

缺点：需要处理零或极小分母；可能放大小账户噪声；归一化规则尚未批准。

### F3 — Risk-adjusted Return

```text
F3 = portfolioReturn - approvedRiskAdjustment
```

优点：可表达风险、波动或回撤。

缺点：riskAdjustment 尚无唯一、稳定、可复现定义；可能强化 WAIT 偏差；实现和审计复杂。

```text
CANDIDATE_ONLY = TRUE
```

## 2. Recommendation Matrix

| Candidate | 经济合理性 | 做T一致性 | 资金规模敏感性 | 长期持仓偏差 | 实现复杂度 | Recommendation |
|---|---|---|---|---|---|---|
| F1 | 高 | 高 | 高敏感 | 可能较高 | 低 | Review candidate |
| F2 | 高 | 高 | 较低敏感 | 可能较高 | 中 | Review candidate |
| F3 | 依赖风险定义 | 可能较高 | 较低敏感 | 可控制但未证实 | 高 | Evidence pending |

矩阵不是 approval，也没有 winner。

## 3. Portfolio Value Contract

候选组合估值：

```text
portfolioValue = cash + position * Observed Reference Price
```

其中 Observed Reference Price 是 `marketState.price` 的研究语义名称。

明确：

- `RESEARCH ONLY`
- 不是 mark price
- 不是 execution price
- 不是 verified close
- 不是 verified 1m bar close

```text
VALUATION_PRICE_STATUS = RESEARCH_ONLY
MARK_PRICE_READINESS = BLOCKED
```

## 4. Accounting Contract

推荐进入人工 Review 的 accounting 方向：

```text
ACCOUNTING_CLOSED
```

执行链：

```text
execution → fillPrice / fees → cash / position → account state
```

Reward 层禁止：

- double fee
- double slippage
- 重复估算 execution cost

原因：fee 已进入 cash，方向性 slippage 已反映在 fillPrice/accounting 中。

该项仍需要人工批准，不等于 Reward 已批准。

## 5. Attribution Recommendation

### ACTION_LOCAL

易于映射到 transition，但 `BUY → HOLD → SELL` 和 `BUY → BUY → SELL` 中存在重复归因风险。

### POSITION_INTERVAL

更符合做T持仓周期，可能减少同一 P&L 重复计入；需要定义唯一持仓区间和部分退出规则。

### TERMINAL

可降低重复归因，但 reward 稀疏、credit assignment 困难。

### RETURN_TO_GO

适合延迟结算，但需要不重叠窗口和严格 target ownership。

### Recommendation

`POSITION_INTERVAL` 可作为人工 Review 优先候选；不是批准结果。若无法建立唯一区间所有权，应退回 `TERMINAL` 或其他候选继续评审。

T+1 必须使用真实 `sellablePosition`、`todayBought` 和日期转换语义，不能制造 counterfactual attribution。

## 6. Horizon Recommendation

### Next Observation

优点：边界短、易审计。
缺点：观察价格时间语义未验证，跨 session/T+1 规则不完整。

### Fixed Horizon

优点：目标窗口明确、适合比较。
缺点：固定 bar/time 的定义、跨日和不完整 horizon 规则仍需批准。

### Terminal

优点：可覆盖持仓最终结果。
缺点：reward 稀疏，open position 和 terminal valuation 未定义。

Recommendation：`Next Observation` 可作为最小边界的人工 Review 候选；不代表 H1 已批准。

```text
REWARD_HORIZON = BLOCKED
```

## 7. Remaining Human Decisions

必须人工决定：

- reward formula：F1/F2/F3。
- horizon：next observation/fixed horizon/terminal。
- attribution：ACTION_LOCAL/POSITION_INTERVAL/TERMINAL/RETURN_TO_GO。
- terminal：SESSION_END/FORCED_FLAT/CARRY_POSITION 等。
- no-action：ZERO_REWARD/OBSERVED_PORTFOLIO_MOVEMENT/BENCHMARK_RELATIVE。
- blocked-action：zero/null/feasibility-aware 等。
- nullability：numeric/null/incomplete horizon/censored。

在上述决定完成前，不得进入 Reward Artifact、Dataset、Value-Q 或 RL training。

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
