# OFFLINE RL V0.12.21.1 — Value-Q Human Review Evidence

Audit date: 2026-10-05

## Current Gate

VALUE_Q_TARGET = BLOCKED
DATASET_GENERATION = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
HUMAN_REVIEW_REQUIRED = TRUE

本阶段不产生 Value-Q target、Dataset、Training data、Model 或 RL training artifact。

## 1. Decision Scope

本阶段只决定：

- Target Formula
- Horizon
- Gamma
- Bootstrap Policy
- Canonical Action Mapping
- Training Objective

不修改 Reward Contract、action space、生产代码或历史数据。

## 2. A股 T+1 场景风险分析

### 日内 1 分钟数据

Observed Reference Price 的严格供应商语义仍受限。Value target 不得把 observation timestamp 自动解释为 verified 1m candle close，也不得引入未来区间结果。

### T+1 限制

当日买入仓位不能自动视为当日可卖。Value target 只能读取已冻结的 position、sellablePosition、todayBought 和 execution status，不能释放或修改库存。

### 卖出冻结

blocked SELL 必须与 executed losing SELL 区分。blocked action 不得被 Value target 当作普通负收益交易。

### 手续费、印花税与滑点

Approved Reward Contract 使用 ACCOUNTING_CLOSED：execution fillPrice、手续费和滑点已经进入账户现金/组合状态。Value target 不得再次扣除 fee、stamp duty 或 slippage。

### 持仓状态

现金、持仓、可卖仓位、当日买入和平均成本必须保持 transition 一致。不得用未来持仓状态污染 state，也不得在 target 计算中重放 execution。

### 对 Value Target 的影响

- Monte Carlo 依赖完整、正确归因的持仓区间。
- TD(0) 依赖可信 next_state、done 和 action mapping。
- n-step 额外依赖连续窗口、跨日边界和 T+1 一致性。
- 任何边界未批准，Value target 都必须保持 BLOCKED。

## 3. Candidate Comparison Matrix

| Formula | Bias | Variance | 长周期风险 | 短周期适配 | 数据要求 | 当前推荐状态 |
|---|---|---|---|---|---|---|
| Monte Carlo | 较低 bootstrap bias；可能有归因偏差 | 较高 | 依赖完整 episode，长持仓结果可能集中到早期 | 中等 | 完整、有序、无重叠 episode rewards | PROPOSAL_ONLY |
| TD(0) | bootstrap bias 和 extrapolation bias | 较低单步方差，但 Q 误差会传播 | 可能低估延迟持仓收益 | 较高 | next_state、done、action mapping 稳定 | PROPOSAL_ONLY |
| n-step | bias/variance 折中；窗口可能重叠 | 中等 | n、跨日、T+1 和 terminal 规则敏感 | 较高候选 | 连续 transitions、窗口边界、不重叠归因 | PROPOSAL_ONLY |

没有候选被批准或自动选为 winner。

## 4. Hard Stop Conditions

以下任意一项未批准：

- Target Formula
- Horizon
- Gamma
- Bootstrap Policy
- Canonical Action Mapping

则必须保持：

VALUE_Q_TARGET = BLOCKED
HARD_STOP = TRUE

Training Objective 未批准时不得开始 Value-Q 或 RL training。

## 5. Reviewer Decision Template

每项只能选择：APPROVED、REJECTED 或 NEEDS_REVISION。

| Decision Item | Candidate / Value | Decision | Reviewer | Date | Evidence / Reason |
|---|---|---|---|---|---|
| Target Formula | Monte Carlo / TD(0) / n-step |  |  | 2026-10-05 |  |
| Horizon | Next Observation / Fixed Horizon / Terminal |  |  | 2026-10-05 |  |
| Gamma | 0.90 / 0.95 / 0.99 |  |  | 2026-10-05 |  |
| Bootstrap Policy | No Bootstrap / Conservative / Policy |  |  | 2026-10-05 |  |
| Canonical Action Mapping | Explicit mapping proposal |  |  | 2026-10-05 |  |
| Training Objective | Human-approved objective |  |  | 2026-10-05 |  |

## Explicit Non-goals

- 不生成 Value-Q target。
- 不生成 Dataset。
- 不训练模型。
- 不修改 Reward Contract。
- 不修改 action space。
- 不修改生产代码。

## Final Gate

VALUE_Q_TARGET = BLOCKED
DATASET_GENERATION = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
