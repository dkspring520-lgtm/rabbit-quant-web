# OFFLINE RL V0.12.14.8.7 — Observed Price Decision Review

## Review Status

```text
OBSERVED_PRICE_CONTRACT_STATUS = PROPOSAL_ONLY
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```

本文件仅用于人工决策准备，不批准 Reward、Dataset、Value-Q 或 RL Training。

## 1. 当前已验证事实

- `marketState.price` 的字段 lineage 已确认：Parquet `close` → JSONL `minutes[].price` → `marketState.price`。
- Replay 已持久化 `marketState.price`。
- Replay 未确认持久化 bid、ask、mid 或 spread。
- execution accounting 已通过既有审计：fee 已进入 cash，directional slippage 已进入 fillPrice/accounting。
- 代码级因果性审计通过；未发现直接读取未来记录的代码路径。
- `marketState.price` 可作为研究中的 Observed Reference Price 候选。

## 2. 当前未知语义

- Parquet provider 身份和官方字段字典。
- Parquet `close` 是否为分钟 candle close、last trade、snapshot price 或供应商计算值。
- `trade_time` 是 bar start、bar end、event timestamp、snapshot timestamp 还是 bucket label。
- 独立 decision timestamp、execution timestamp 和 bar-close timestamp。
- 严格 1m K 线语义。
- 真实 bid/ask/mid 数据。
- mark price 的最终 Contract。

因此：

```text
PRICE_FIELD_LINEAGE = VERIFIED
PRICE_SEMANTICS = UNVERIFIED
MARK_PRICE_READINESS = BLOCKED
```

## 3. 接受 Observed Reference Price 后允许做什么

在人工批准前仅作为 Proposal。若批准，可考虑：

- Replay state observation。
- Portfolio state valuation research。
- Factor research。
- 明确标注语义限制的 Offline policy experiment。
- 使用账户状态和 observed reference price 进行研究性组合估值。

上述允许项不等于批准 Reward Formula 或 Dataset。

## 4. 禁止做什么

- 不得把 Observed Reference Price 改名为 `close`、`last_trade` 或 `execution_price`。
- 不得宣称严格 1m K 线 close。
- 不得模拟真实盘口成交。
- 不得构造 OHLC、bid、ask、mid 或 spread。
- 不得补造或回填 timestamp。
- 不得修改 Replay、历史 JSONL 或 `marketState.price`。
- 不得生成 Reward Artifact、Dataset、Value-Q target 或训练模型。
- 不得把未来 price、portfolio value 或 execution 放入 state feature。

## 5. 与 Strict Market Data Contract 的差异

| 项目 | Strict Market Data Contract | Observed Price Research Contract |
|---|---|---|
| Provider/原始证据 | 必须完整 | 当前不完整 |
| close 语义 | 必须官方确认 | 保持未知 |
| trade_time 语义 | 必须官方确认 | 保持未知 |
| Mark price | 可正式批准 | 仅研究候选 |
| 研究速度 | 较慢 | 较快 |
| 结论外推 | 语义严谨 | 必须受限 |
| 当前状态 | `BLOCKED` | `PROPOSAL_ONLY` |

Observed Price Contract 不能被描述为 Strict Contract 的等价替代。

## 6. 对 Offline RL 后续阶段的影响

即使人工接受 Observed Reference Price，以下仍需单独批准：

- Reward objective 和 formula。
- accounting-closed fee/slippage semantics。
- H1/H2 horizon。
- terminal/nullability。
- no-action 和 blocked-action。
- T+1 attribution。
- multi-action attribution 和防重复归因。
- future leakage contract。

在这些决定完成前：

```text
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
RL_TRAINING = NOT_STARTED
```

## 7. Human Decision Checklist

### DATA CONTRACT

- [ ] 是否接受 `marketState.price` 作为研究估值字段。
- [ ] 是否接受它不等同于 close、last trade 或 execution price。

### REWARD CONTRACT

- [ ] Reward 是否允许基于账户净值变化。
- [ ] 是否接受 accounting-closed。
- [ ] 是否接受不显式扣 fee/slippage。

### HORIZON

- [ ] H1 尚未选择。
- [ ] H2 尚未选择。

### ATTRIBUTION

- [ ] multi-action attribution 尚未选择。

### TERMINAL

- [ ] terminal contract 尚未选择。

### Additional required decisions

- [ ] mark-price research usage boundary。
- [ ] no-action semantics。
- [ ] blocked-action semantics。
- [ ] T+1 attribution。
- [ ] nullability and incomplete horizon。
- [ ] normalization/risk adjustment。
- [ ] leakage policy。

## 8. Final Review Gate

```text
OBSERVED_PRICE_CONTRACT_STATUS = PROPOSAL_ONLY
PRICE_FIELD_LINEAGE = VERIFIED
PRICE_SEMANTICS = UNVERIFIED
VALUATION_PRICE_STATUS = RESEARCH_ONLY
MARK_PRICE_READINESS = BLOCKED
REWARD_CONTRACT_STATUS = PROPOSAL_ONLY
REWARD_FORMULA = BLOCKED
REWARD_HORIZON = BLOCKED
REWARD_ARTIFACT_STATUS = BLOCKED
DATASET = BLOCKED
VALUE_Q = BLOCKED
V0.12.15 = BLOCKED
V0.13 = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
```
