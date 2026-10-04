# OFFLINE RL V0.12.18 — Value-Q Contract Design

## Status

```text
VALUE_Q_CONTRACT_STATUS = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

本文件只设计 Value-Q Contract，不生成 target、Dataset、模型或训练数据。

## 1. Value-Q Input Definition

Value-Q 输入候选：

```text
Q(state, action)
```

输入只能来自当前 transition 的 action-time state 与 action，不得读取未来 outcome。

## 2. State Schema

候选 state 包含：

- cash
- position
- sellablePosition
- todayBought
- averageCost
- observedReferencePrice
- portfolioValue research field
- approved causal market-context features

明确禁止：

- next-state price
- future volume
- terminal outcome
- future portfolio value
- forward return
- episode return
- synthetic OHLC
- fabricated bid/ask/mid

Observed Reference Price 仍不等同于 close、last trade 或 executable price。

## 3. Action Schema

Action 至少包含：

- actionType
- requestedQuantity
- executedQuantity
- executionStatus
- feasibility/blocked status

blocked action 必须保留 execution status，不能伪装成普通成交 action。

## 4. Reward Source Lineage

Reward 必须来自：

```text
Replay transition + Reward Artifact V0.12.15.1
```

Reward source 必须标记：

```text
rewardSource = REWARD_ARTIFACT
rewardFormulaVersion = F2_NORMALIZED_PORTFOLIO_RETURN_V0.12.15
accountingMode = ACCOUNTING_CLOSED
attributionType = POSITION_INTERVAL
```

不得从 future label、forward return 或 Value-Q target 反推 reward。

## 5. Next State Definition

`next_state` 是 approved NEXT_OBSERVATION 对应的下一有效 observation 状态，包含：

- next cash
- next position
- next sellablePosition
- next todayBought
- next averageCost
- next observedReferencePrice
- next portfolioValue research field
- next causal market context

不得把 next_state 字段复制回当前 state。

## 6. Done Definition

```text
done = true
```

仅表示 approved episode terminal。

`done` 不是未来收益标签，也不能由 reward 数值推断。
Terminal transition 的 `next_state` 必须为 null。

## 7. Target Formula Candidates

所有候选均为 Proposal-only。

### Candidate A — Monte Carlo Return

候选形式：

```text
G_t = r_t + γ r_{t+1} + γ² r_{t+2} + ...
```

做T适配：可覆盖持仓区间结果，但可能把较长持仓和终端结果集中到早期 action。

长周期偏差：对 horizon、terminal 和 open position 处理敏感。

Reward attribution：与 POSITION_INTERVAL 可兼容，但必须避免同一 P&L 重复进入多个 return。

Offline Dataset compatibility：需要完整、时间有序且无泄漏的 episode reward sequence；当前 Dataset Artifact 尚未生成。

### Candidate B — TD(0)

候选形式：

```text
y_t = r_t + γ (1 - done_t) Q(s_{t+1}, a_{t+1})
```

做T适配：局部 transition 目标简单，适合 NEXT_OBSERVATION 候选。

长周期偏差：可能低估延迟收益和跨日持仓价值。

Reward attribution：依赖 next_state 与 done 正确，POSITION_INTERVAL 的区间所有权仍需保持。

Offline Dataset compatibility：需要稳定 next_state/done 编码，且训练时不能使用未来 feature。

### Candidate C — n-step Return

候选形式：

```text
y_t = Σ(i=0..n-1) γ^i r_{t+i} + γ^n (1-done_{t+n}) Q(s_{t+n}, a_{t+n})
```

做T适配：可在短期做T与延迟收益之间折中。

长周期偏差：n、跨 session、T+1 和不完整窗口需要明确规则。

Reward attribution：需要确保 POSITION_INTERVAL 的收益不会在重叠 n-step 窗口中重复计数。

Offline Dataset compatibility：需要连续、有序 transitions；不能用缺失 future rows 或 synthetic padding 补齐。

## 8. Discount Factor γ Candidates

候选：

- `γ = 0`：只看即时 reward；可能忽略持仓结果。
- `0 < γ < 1`：折扣未来收益；需与 NEXT_OBSERVATION 和持仓周期匹配。
- `γ ≈ 1`：保留长期组合结果；对 terminal、数据缺口和长周期偏差更敏感。

未选择 γ。

## 9. Episode Boundary

Value-Q 必须继承已批准的 `done` 语义：

- episode terminal 才能 done=true。
- 不得因为 reward 缺失自动 terminal。
- 不得跨越未批准的 episode boundary。
- session end、open position 和 hybrid terminal 规则必须与 Reward Contract 一致。

## 10. Terminal Handling

当前 approved Hybrid terminal：

- SESSION_END：使用 Observed Reference Price research valuation。
- OPEN_POSITION：允许持仓结束。
- FORCED_FLAT：禁止默认 synthetic liquidation。

Value-Q target 不得虚构 forced sell、fee 或 slippage。

## 11. T+1 Constraint

必须保留：

- todayBought
- sellablePosition
- advanceTo/date transition semantics

当日新增买入不得被 Value-Q 误判为当日可卖。SELL action 的 feasibility 必须来自真实 sellablePosition。

## 12. Blocked Action Handling

blocked execution 与 executed losing action 必须分开：

- blocked：execution status 反映不可执行；不得自动转成交易亏损。
- executed losing：真实成交后 reward 可能为负。

Value-Q contract 不允许无经济依据的固定 penalty。

## 13. No-action Handling

继承 `OBSERVED_PORTFOLIO_MOVEMENT`：

- 持仓 HOLD 可反映账户状态变化。
- 空仓 HOLD 不因股票方向自动产生账户收益/损失。
- 不使用 counterfactual benchmark。

## 14. Offline RL Leakage Prevention

必须满足：

- state 只使用 action-time information。
- reward 只从 Reward Artifact lineage 读取。
- next_state 只作为 target-side 输入。
- future price/volume/portfolio/terminal outcome 不进入 state。
- 不从 Dataset 重新计算 reward。
- 不把 Value-Q target 写回 Dataset 或 Replay。
- 不随机拆分时间序列。

## 15. Human Review Gate

必须人工批准：

- Value Target：Monte Carlo / TD(0) / n-step。
- Discount Factor γ。
- Episode Definition。
- Training Objective。

在全部批准前：

```text
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
```

## Explicit Non-goals

禁止：

- 修改 Dataset Artifact。
- 修改 Replay。
- 修改 Reward Engine。
- 修改历史数据。
- 生成 Value-Q target。
- 开始 RL training。
- 引入 synthetic OHLC。
- 引入 bid/ask/mid。
- 使用未来 feature。

## Final Gate

```text
VALUE_Q_CONTRACT_STATUS = PROPOSAL_ONLY
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
