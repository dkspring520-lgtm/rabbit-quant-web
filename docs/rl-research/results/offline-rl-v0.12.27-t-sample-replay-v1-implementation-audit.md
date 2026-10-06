# OFFLINE RL V0.12.27 — T Sample Asset + Replay Engine V1 Implementation Audit

Audit date: 2026-10-05

## Final status

T_SAMPLE_ASSET = IMPLEMENTED_RESEARCH_ONLY
REPLAY_ENGINE = IMPLEMENTED_RESEARCH_ONLY
PAPER_TRADING = NOT_STARTED
T_SAMPLE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
T1_SEMANTICS = PASS
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE

本阶段只实现历史研究 Replay 和样本资产，不生成 RL Dataset、Reward Artifact 或 Value-Q Target。

## 1. Replay boundary

`lib/t-replay/replay-engine.mjs` 按历史顺序逐 bar 构建 prefix，并通过现有 `T Observation` 链路计算当时可见的 Feature、State 和 Opportunity。Replay 不把未来结果回灌到 observation。

支持模式只有 `RESEARCH_REPLAY`。没有 LIVE、PAPER 或 AUTO_TRADING 模式。

## 2. Action-time boundary

每个样本明确区分：

- `timestamp` / `inputTimestamp`
- `outcomeStartTimestamp`
- `outcomeEndTimestamp`

future return、MFE、MAE、peak、trough 和 drawdown 只位于 `outcome`。Feature、State 和 Opportunity 不包含未来统计。

## 3. Outcome contract

已实现：

- futureReturn_1bar
- futureReturn_3bar
- futureReturn_5bar
- futureReturn_10bar
- futureMaxFavorableExcursion
- futureMaxAdverseExcursion
- futurePeakTime
- futureTroughTime
- futureDrawdown

历史末端不足 horizon 时返回不可完成状态，不用 0 或伪造值掩盖。Outcome 是 realized historical outcome，不是 prediction、confidence 或 probability。

## 4. T Sample Asset

已实现 `lib/t-samples/`：

- `sample-contract.mjs`：样本、结构标签和 outcome 标签边界。
- `sample-validator.mjs`：schema、版本、时间边界和 RL 隔离校验。
- `sample-store.mjs`：追加式内存样本存储、查询和去重。

结构标签与 outcome 标签分离：

- `POSITIVE_T_STRUCTURE` / `COUNTER_T_STRUCTURE` / `NEUTRAL_STRUCTURE`
- `FAVORABLE_OUTCOME` / `UNFAVORABLE_OUTCOME` / `MIXED_OUTCOME` / `INSUFFICIENT_HORIZON`

没有 BUY/SELL 标签。

## 5. Provenance

样本记录 dataSource、symbol、timestamp、barIndex、indicatorVersion、featureVersion、stateVersion、opportunityVersion、replayVersion、sampleVersion、replayMode 和 datasetHash。当前未提供的 datasetHash 明确记录为 `UNKNOWN`，未伪造。

## 6. T+1 boundary

样本可以保存账户与 T+1 snapshot，但 Replay Engine 不重新实现 T+1、sellablePosition、fill、fee 或 execution。执行语义仍归属于现有 PaperExecutionEngine / execution semantics。

## 7. Duplicate and validity boundary

去重键为：

`symbol + timestamp + replayVersion + sampleVersion`

重复样本返回 `REJECT_DUPLICATE`，不覆盖历史样本。Warmup、invalid dependency 或数据不足通过 `valid` / `invalidReason` 传播，不静默填充为 0。

## 8. Query boundary

Sample Store 支持按 State、Opportunity、结构标签、outcome 标签和 validOnly 查询。查询是 `DESCRIPTIVE_HISTORICAL_STATISTICS` 的基础，不生成交易建议、不输出预测概率。

## 9. Leakage audit

对固定 action-time index 修改未来价格时，Feature、State、Opportunity 保持不变，只有 Outcome 改变。该边界已由测试覆盖。

## 10. Test result

- `tests/t-replay-samples.test.mjs`：PASS。
- 新增覆盖：chronological replay、outcome isolation、future mutation、schema validation、duplicate rejection、query boundary。

## 11. Remaining human review

1. 确认样本落盘介质和保留策略；本版本只提供内存 Store，不自动写入 Dataset。
2. 确认正式历史数据源与 datasetHash 生成规则。
3. 确认 outcome label 的描述性阈值后，才能用于后续诊断；本阶段不用于训练。
4. 在 T+1、Replay 和 execution audit 未再次人工确认前，继续保持 HARD_STOP。
