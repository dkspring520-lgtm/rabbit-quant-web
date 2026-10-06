# OFFLINE RL V0.12.23.6.5 — Canonical Freeze Review Report

Audit date: 2026-10-05

审查对象：offline-rl-v0.12.23.6.4-canonical-freeze-proposal.md

## Gate

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本报告只审查冻结条件，不修改 proposal、不执行回测、不生成 Dataset、Value-Q target 或训练模型。

## Review Summary

当前 proposal 已经明确主要概念，但尚未达到可直接实施的无歧义 Contract。核心阻塞集中在真实数据可用性、Core/T 历史语义、canonical action mapping、fill timing 和 evaluation window。

## 1. State Schema Review

### 可冻结的边界

- 保留 market state、portfolio state、opportunity state 三层结构。
- 保留 action-time causal feature 原则。
- 保留 cash、position、sellablePosition、todayBought、averageCost。
- 保留 Observed Reference Price 的受限语义，不改名为 close/last trade/executable price。
- 禁止 future features、synthetic OHLC、fabricated bid/ask/mid。

### BLOCKED

STATE_SCHEMA_FREEZE = BLOCKED

原因：

- open/high/low/close 的 source semantics 尚未完全确认。
- ATR/OFI/盘口字段可用性未闭合。
- corePosition/tPosition 不是现有历史 Replay 的明确 persisted state。
- portfolioValueResearch 的最终字段和时间边界未冻结。
- 缺失值、版本和 feature availability matrix 尚未定义。

## 2. Core/T Position Model Review

### 可冻结的原则

- core position 与 T position 必须概念分离。
- core position 不因短期信号默认清仓。
- T position 受 sellablePosition、todayBought 和 T+1 约束。
- total position 必须与账户状态一致。

### BLOCKED

CORE_T_POSITION_MODEL = BLOCKED

原因：

- 34000/3100 目前是研究场景，不是历史账户事实。
- core/t 拆分的来源、初始化、变更和 lineage 未定义。
- 多批次买入、部分卖出和回补后的归属未定义。

## 3. Action Mapping Review

### 可冻结的原则

- action 必须保留 requested quantity、executed quantity、execution status、blocked reason。
- blocked execution 与 executed losing action 必须分离。
- SELL 受 sellablePosition 和 T+1 约束。
- WAIT/HOLD 不得自动等同于股票方向预测。

### BLOCKED

ACTION_MAPPING = BLOCKED

原因：

- WAIT、BUY_SMALL、BUY、SELL_PART、SELL_ALL 与 REDUCE_T/REBUILD_T 的映射未批准。
- SELL_T 百分比到底相对于 corePosition、tPosition、totalPosition 还是 sellablePosition 未冻结。
- BUY_BACK_FULL 的数量边界未冻结。
- HOLD 与 WAIT 的 canonical distinction 未冻结。

## 4. Fill Timing Review

### 可冻结的原则

- 禁止 future high/low 或区间极值成交。
- 所有 baseline 必须使用同一 fill timing。
- action request、fill event、post-account state 必须保持因果顺序。

### BLOCKED

FILL_TIMING = BLOCKED

原因：

- next observation open 的真实字段和语义未充分确认。
- Observed Reference Price 的 timestamp/close 语义仍受限。
- NEXT_AVAILABLE_OBSERVATION_PRICE 与 next bar open 尚未由人工选定。
- 缺失下一 observation 的处理规则未冻结。

## 5. Evaluation Window Review

### 可冻结的原则

- 评价窗口必须预先固定。
- 结果窗口不得进入 action decision。
- 必须区分 successful rebuy、failed rebuy、missed rebuy、avoided drawdown 和 early exit。
- 必须使用时间顺序和 session-aware 边界。

### BLOCKED

EVALUATION_WINDOW = BLOCKED

原因：

- 15 bars、30 bars、End Session、Next Session 均为候选，未选择。
- T+1、跨日、terminal/open position 和缺失 observation 规则未闭合。
- 多窗口同时报告时的主指标和显著性规则未定义。

## 6. Feature Tier Review

### V1 可冻结的边界

- 优先使用可追溯的 price、volume、causal returns 和已有 causal context。
- 缺失字段保持 unavailable，不补造。
- V1 不依赖 L2 才能定义研究 baseline。

### V2 可冻结的边界

- OFI、bid/ask、spread、盘口失衡作为独立 V2 tier。
- V2 不回填 V1 缺失字段。
- V2 不得改变 V1 历史结果。

### BLOCKED

FEATURE_TIER = PARTIAL / BLOCKED_FOR_IMPLEMENTATION

原因：

- DATA-07 原始 OHLC/close/time semantics 仍有限制。
- ATR 和 OHLC-derived features 需要 source semantics 审计。
- OFI/L2 字段未在核心 DATA-07 Replay 中确认完整可用。
- feature version、窗口和缺失值编码未冻结。

## 7. Expert Pattern Boundary Review

可冻结：

- Expert Pattern 只能作为 candidate feature/pattern。
- Expert Pattern 不得直接成为固定 SELL/BUY_BACK 规则。
- Expert Pattern 与 Learned Policy 必须保留独立 lineage、版本和 evidence。

EXPERT_PRIOR_COMPATIBILITY = READY_FOR_REVIEW

## 8. Final Review Checklist

- [ ] State Schema。
- [ ] Core/T Position Model。
- [ ] Canonical Action Mapping。
- [ ] Fill Timing。
- [ ] Evaluation Window。
- [ ] V1 Feature Availability。
- [ ] V2 Feature Availability。
- [ ] Expert Pattern boundary。

## Recommended Next Step

先由人工处理所有 BLOCKED 项，再进入 V0.12.23.6 Benchmark Implementation。当前不应执行历史回测，因为 action、state 和 fill semantics 尚未形成单一 canonical Contract。

## Final Gate

BACKTEST_RESULT = NOT_GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
