# Offline RL V0.9 — Counterfactual Transition Dataset

**OFFLINE_RL_DATASET_V0.9 = BLOCKED**

## 结论与缺口
- DATA-07 market history does not contain causal pre-action account snapshots; A-F scenarios are not real account histories.
- Old OHLC expert labels are invalid for price-only states. Missing expert is null, never WAIT.
- Source lacks verified suspension and price-limit flags; paper fills on diagnostic fixtures are not historical fill evidence.
- Rate-v2 is action-conditioned market return minus executed-notional cost rates, not portfolio Net Future Equity Delta. No change to either existing objective was made.
- One observed intraday bar per transition. Session/split/dataset boundaries retain unresolved reward and null nextState; no fabricated zero reward or future padding.
- Paper price/cost rounding is preserved. Research rates 0.025% / 0.02%, zero minimum commission/stamp duty are explicit research assumptions, not real-world fee claims.
- HistoricalReplayEngine's factor/legacy-label path and TTradingEnvironment's cumulative monetary reward are not substituted for validated price-only State or normalized rate-v2.
- PerformanceAnalytics/SignalSample aggregate signal-return metrics are not substituted for missing transition rewards or regret observations.

## 全量真实行情审计（不是可训练数据集通过声明）
- States: 249917; five-action records: 1249585; resolved transitions: 0.
- Valid: 0; invalid: 0; unknown: 1249585.
- Split counts: {"train":174966,"validation":44103,"test":30848}. No fitting, threshold selection or balancing.
- 缺账户输入：INPUT_UNAVAILABLE / validAction=null；引擎实际拒单：INVALID_ACTION / validAction=false；未来不足：OUTCOME_UNRESOLVED。三者不能混算。
- Expert regret: {"count":0,"agreementRate":null,"meanRegret":null,"medianRegret":null,"P90":null,"P95":null,"interpretation":"historical simulation, not prediction accuracy"}. Null means unavailable, not zero regret.

## Gate
- realHistoricalDataset: PASS
- fiveActionCounterfactualEvaluation: BLOCKED
- validInvalidSemantics: PASS
- paperExecutionEngineIntegrated: PASS
- rewardContractUnchanged: PASS
- costContractUnchanged: PASS
- nextStateGenerated: BLOCKED
- leakage: PASS
- reproducibility: PASS
- transitionHashGenerated: PASS
- productionIsolation: PASS
- historicalAccountEvidence: BLOCKED
- expertEvidence: BLOCKED
- marketExecutionFlags: BLOCKED

## 实现与口径
- Five fresh PaperExecutionEngine branches share the same state, timestamp and path hash; no branch contaminates another.
- BUY_SMALL/BUY retain 0.5/1 units of ResearchNotionalUnitV0.1 (10,000); SELL_PART/SELL_ALL retain 25%/100% sellable shares; 100-share floor.
- rewardGross = existing rate-v2(actionDelta × futureReturn); rewardNet subtracts engine fees/notional and slippage/notional exactly as replay-adapter. Invalid/unresolved never enter ranking.
- Market state remains unchanged. Account context is separate. Dataset identity is kept outside causal state/input hashes; changing future data changes dataset identity, not state(T).
- One observed bar is not always one wall-clock minute (e.g. lunch break). Episode ends are truncations, not a terminal zero-return assumption.
- Scenario A-F diagnostics at one predeclared 10:00 state in each split exercise the adapter only; they do not fill historical accounts or alter primary counts.

## 可复现性与泄漏
- Two complete independent reconstructions: identical=true.
- transitionHash: d26db39f9f447c8572e44f56077aba65dd63bf24fb81fb7cb7cdee57b8706a7a
- counterfactualHash: 04e9010a7bf042f7a0fe8af74c48a56d1851d2b783ae37a95630502282c9ee6d
- datasetHash: ebc1b9bf960f659aa0560feee502beb90d147791a51ca5c6a5dc9adb136ec0d0
- {"barIndex":30,"split":"train","allPrefixInputsIdentical":true,"transitionInputIdentical":true,"expertActionIdentical":true,"diagnosticOutcomeChanged":true}
- {"barIndex":174996,"split":"validation","allPrefixInputsIdentical":true,"transitionInputIdentical":true,"expertActionIdentical":true,"diagnosticOutcomeChanged":true}
- {"barIndex":219099,"split":"test","allPrefixInputsIdentical":true,"transitionInputIdentical":true,"expertActionIdentical":true,"diagnosticOutcomeChanged":true}

## 输出与复跑
- Full group JSONL (five records per state): `.data-inspect/offline-rl-v0.9/action-outcome-matrix.jsonl.gz`.
- Full transition CSV: `.data-inspect/offline-rl-v0.9/transitions.csv.gz` (compressed local artifacts, excluded from Git).
- Adjacent JSON report, sample JSON, diagnostics JSON, snapshot JSON and action-count CSV are review artifacts.
- Run: `node scripts/run-offline-rl-v0.9-counterfactual-transitions.mjs`.
- Optional `--accounts=<causal-ledger.jsonl>`: one entry per symbol/timestamp with asOf<=timestamp, source, account {cash, position, sellablePosition, averageCost}, expertAction/expertSource, marketFlags/marketFlagsSource. These must be causally sourced evidence, not scenarios or hindsight labels.
- 解锁前需要逐时点账户证据、合法 Expert 来源及执行状态字段。不得用随机/固定持仓补齐，也不得将情景测试 PASS 宣称为全量数据 PASS。
