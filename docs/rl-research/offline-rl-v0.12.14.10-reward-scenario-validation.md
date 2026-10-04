# OFFLINE RL V0.12.14.10 — Reward Scenario Validation

## Status

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

本文件是对 V0.12.14.9 Proposal 的 synthetic scenario review。它只检查候选语义是否能解释场景，不批准 F1/F2/F3 或 H1/H2/H3，也不运行 PaperExecutionEngine。

## Common Boundary

候选估值：

```text
portfolioValue = cash + position * observedReferencePrice
```

其中 `observedReferencePrice` 仅是研究字段，不等同于 mark price、execution price、verified close 或 verified 1m close。

fee/slippage 继续遵循 accounting-closed 候选：Reward 层不得再次扣除。

## Scenario A — BUY → HOLD → SELL

### Expected economic interpretation

- 初始现金应来自 pre-action account state。
- BUY 成交后，cash 减少，position 增加，todayBought 增加，sellablePosition 遵守 T+1。
- HOLD 期间，账户组合价值候选由 cash、position 和 observedReferencePrice 共同决定。
- SELL 只有在 sellablePosition 足够时才是实际成交。
- SELL 成交后，cash 增加，position 和 sellablePosition 减少。

### Candidate reward behavior

- F1 可候选地表达 `V_end - V_start`。
- F2 可候选地表达归一化组合变化。
- F3 可候选地加入风险调整，但 riskAdjustment 尚未定义。
- attribution 可归属于 BUY、SELL、持仓区间或 terminal。

### Unresolved questions

- BUY、HOLD、SELL 的经济结果如何唯一归因。
- H1/H2/H3 终点如何选择。
- observedReferencePrice 的时间语义是否足够用于终值。
- fee/slippage 是否只通过 accounting-closed state 体现。

## Scenario B — BUY → BUY → SELL

### Expected economic interpretation

- 两次 BUY 形成不同成交批次和成本基础。
- 第二次 BUY 可能具有不同 fillPrice、fees、todayBought 和 T+1 release 时间。
- SELL 的可卖数量必须遵守真实 sellablePosition。

### Candidate reward behavior

- ACTION_LOCAL 可能把同一经济结果分摊到两个 BUY 和 SELL，存在高 double attribution 风险。
- POSITION_INTERVAL 需要为组合持仓区间建立唯一所有权。
- TERMINAL/RETURN_TO_GO 可能减少重复归因，但会增加稀疏性或 target 窗口问题。

### Unresolved questions

- 多批次成本如何归因到单个 transition。
- 同一 P&L 如何保证只被计算一次。
- 多个 T+1 release date 如何进入 attribution。
- 是否允许 partial exit 和剩余仓位继续持有。

```text
DOUBLE_ATTRIBUTION_RISK = HIGH_PENDING_ATTRIBUTION_CONTRACT
```

## Scenario C — BUY → HOLD → Episode End

### Expected economic interpretation

- episode end 时可能仍有 position > 0。
- 账户可候选地按 `cash + position * observedReferencePrice` 做研究性 terminal valuation。
- 该值代表观察价格下的组合估值，不代表真实强制平仓收益。

### Candidate reward behavior

- SESSION_END、FIXED_HORIZON、FORCED_FLAT、OPEN_POSITION、HYBRID 均为候选。
- MARK_TO_VALUE 可避免 synthetic SELL，但依赖 terminal 和 valuation contract。
- FORCED_FLAT 会引入 synthetic action、fee 和 slippage，不得默认使用。

### Unresolved questions

- open position 是否 carry。
- terminal 是否允许未实现收益。
- terminal reward 是否 numeric 或 null。
- 是否允许任何 synthetic liquidation。

## Scenario D — 空仓 HOLD

### Expected economic interpretation

- position = 0 时，股票上涨不应自动产生账户收益。
- position = 0 时，股票下跌不应自动产生账户损失。
- cash-only account 的 portfolio value 不应因没有持仓的股票方向自动变化。

### Candidate reward behavior

- ZERO_REWARD 可表达 HOLD 不产生直接 action outcome。
- OBSERVED_PORTFOLIO_MOVEMENT 可表达账户实际持仓变化；空仓时价格变化不会自动改变账户价值。
- BENCHMARK_RELATIVE 需要人工批准 benchmark。

### Unresolved questions

- 空仓 HOLD 是否允许 opportunity-cost 解释；当前没有批准 benchmark 或 counterfactual。
- no-action 是否与持仓 HOLD 使用同一语义。

## Scenario E — Blocked SELL

### Expected economic interpretation

- BUY 当日新买入数量不可自动视为 sellable。
- blocked SELL 不产生真实 fill。
- blocked SELL 不应改变 cash、position、sellablePosition、todayBought。
- blocked action 与 executed losing action 必须分开。

### Candidate reward behavior

- ZERO、NULL_REJECTED、FEASIBILITY_AWARE 等均为候选，未批准。
- 不得因为 blocked action 任意设置 `-1`、`-0.5` 或 `-100`。
- executed losing action 是实际成交后的负经济结果，不应标记为 blocked action。

### Unresolved questions

- blocked action reward 是 numeric、null 还是 rejected transition。
- T+1 constraint 是否只作为 feasibility signal。
- invalid action 与 environment constraint 是否需要不同 reason enum。

## Cross-scenario Findings

1. 组合估值候选可以描述账户现金和持仓，但不等于批准的 Reward Formula。
2. Observed Reference Price 不能解决 horizon、terminal、attribution 或 leakage 的全部问题。
3. 多 action 场景最主要风险是同一经济 P&L 被多次归因。
4. 空仓 HOLD 证明不能把 reward 简化成股票方向预测。
5. blocked action 不应被人为赋予无经济依据的 penalty。

## Human Review Required

- [ ] 批准 F1、F2 或 F3。
- [ ] 批准 H1、H2 或 H3。
- [ ] 批准 multi-action attribution。
- [ ] 批准 terminal/open-position semantics。
- [ ] 批准 no-action semantics。
- [ ] 批准 blocked-action semantics。
- [ ] 批准 nullability 和 incomplete horizon。
- [ ] 确认 accounting-closed 且 Reward 不重复扣 fee/slippage。

## Final Gate

```text
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
