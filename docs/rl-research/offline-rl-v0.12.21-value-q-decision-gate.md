# OFFLINE RL V0.12.21 — Value-Q Decision Gate Preparation

## Current Gate

- VALUE_Q_TARGET = BLOCKED
- DATASET_GENERATION = BLOCKED
- RL_TRAINING = NOT_STARTED
- HARD_STOP = TRUE
- HUMAN_REVIEW_REQUIRED = TRUE

本文件只用于人工审核，不生成 Value-Q target、Dataset、Replay dataset、模型或训练数据。

## 1. Current Status

VALUE_Q_TARGET 保持 BLOCKED，原因：

- Target Formula 未批准。
- Horizon 未批准。
- Gamma 未批准。
- Bootstrap Policy 未批准。
- Canonical Action Mapping 未批准。

## 2. Target Formula Candidates

所有候选均为 PROPOSAL_ONLY，不执行、不选择 winner。

### A — Monte Carlo Return

候选公式：G_t = Σ γ^k r_(t+k)。

- 优点：不依赖 Q bootstrap，可覆盖持仓区间和 terminal 结果。
- 风险：需要完整 episode；长持仓可能集中归因到早期 transition；对 terminal 和 attribution ownership 敏感。
- A 股 T+1：可保留 todayBought/sellablePosition，但不能重新推导跨日释放或 blocked SELL。

### B — TD(0)

候选公式：y = r + γ Q(next_state, next_action)。

- 优点：接近 NEXT_OBSERVATION，单步目标简单，适合短周期做T候选。
- 风险：存在 bootstrap error 和 offline extrapolation bias；依赖稳定 next_state、done、action mapping。
- A 股 T+1：只能读取冻结的 sellablePosition/todayBought，不得修改或释放库存。

### C — n-step Return

候选公式：y = Σ(i=0..n-1) γ^i r_(t+i) + γ^n(1-done_(t+n))Q(s_(t+n),a_(t+n))。

- 优点：折中短期做T与延迟持仓收益。
- 风险：n、跨日、T+1、terminal 和缺失 observation 规则复杂；重叠窗口可能造成 attribution 重复；仍有 bootstrap 风险。
- A 股 T+1：只能使用 Dataset 中已有连续 transition，禁止 synthetic padding 或未来价格补齐。

TARGET_FORMULA_STATUS = PROPOSAL_ONLY
TARGET_FORMULA_SELECTED = NONE

## 3. Discount Factor Candidates

候选：gamma = 0.90、gamma = 0.95、gamma = 0.99。

- 0.90：偏近期分钟级结果，可能忽略较长持仓收益。
- 0.95：中等折扣，需结合持仓周期和 terminal 边界。
- 0.99：偏长期结果，对 terminal、跨日和 T+1 更敏感。

DISCOUNT_FACTOR_STATUS = PROPOSAL_ONLY
DISCOUNT_FACTOR_SELECTED = NONE

## 4. Bootstrap Policy

候选：

- NO_BOOTSTRAP：不使用 future Q，方差可能较高。
- CONSERVATIVE_BOOTSTRAP：限制 OOD/action support 风险，具体方法未批准。
- POLICY_BOOTSTRAP：使用 policy action，可能引入 policy bias。

BOOTSTRAP_POLICY_STATUS = NOT_APPROVED
BOOTSTRAP_POLICY_SELECTED = NONE

## 5. Canonical Action Mapping Risk

现有/历史 action 可能包括 WAIT、BUY_SMALL、SELL_ALL、BUY_PART、SELL_PART；Value-Q 抽象还涉及 BUY、SELL、HOLD、NO_ACTION。

必须人工决定：

- WAIT 是否映射为 HOLD 或 NO_ACTION。
- BUY_SMALL 是否合并为 BUY，以及是否丢失数量语义。
- BUY_PART/SELL_PART 的数量和方向语义是否对称。
- SELL_ALL 是独立 action 还是 SELL 的 quantity variant。
- blocked action 是否保留独立 feasibility state。

合并 action 可能改变 observed support 和 Q action ranking。

CANONICAL_ACTION_MAPPING_STATUS = NOT_APPROVED

## 6. Approval Checklist

- [ ] Target Formula：Monte Carlo / TD(0) / n-step。
- [ ] Horizon。
- [ ] Gamma：0.90 / 0.95 / 0.99 或其他正式值。
- [ ] Bootstrap Policy。
- [ ] Canonical Action Mapping。
- [ ] Training Objective。

每项必须记录 reviewer、decision、reason 和 date。

## Explicit Non-goals

禁止：

- 生成 Value-Q target。
- 生成 Dataset。
- 生成 Replay dataset。
- 训练 Value-Q。
- RL training。
- 修改 Reward Formula。
- 修改 action space。
- 修改生产交易逻辑。

## Final Gate

VALUE_Q_TARGET = BLOCKED
DATASET_GENERATION = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
HUMAN_REVIEW_REQUIRED = TRUE
