# OFFLINE LEARNING V0.1 POLICY REPLAY CLOSURE AUDIT

审计 commit：`3a05bfe10370b8bcc4ab765a7c639fac4cb5d804`。

## 1. Policy Replay Integration

`policyReplayIntegrated = true`（代码路径层面）。`scripts/run-offline-policy-replay.mjs` imports and constructs `HistoricalReplayEngine`, which creates `SignalSample` and advances `SampleResolver`; it evaluates samples through existing `evaluateSignalSamples` from Performance Analytics. No second return formula was added.

However, the full 30,848-bar TEST replay did not complete in the audit run because the existing engine recomputes factor prefixes per bar. Therefore integration is present but completed replay metrics are not certified.

## 2. TEST Window

The runner fits `trainCentroidClassifier(sp.train)` only and predicts `sp.test` with frozen parameters. No test fitting, centroid update, normalization, or threshold selection is present.

The V0.2 report records the Full State split as train `174,966`, validation `44,103`, test `30,848`; DATA-07 hash is `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`. The runner derives `testStart`/`testEnd` from the frozen test rows. A completed snapshot from the interrupted run was not produced.

## 3. Strategy Comparison

The runner defines the required same-window groups: ExpertActionReplay, LearnedPolicy, AlwaysWait, MajorityClass, and SeededRandom. It does not have valid completed output for tradeCount, winRate, averageReturn, medianReturn, profitFactor, MFE, MAE, holdingTime, or drawdown because execution was interrupted.

Drawdown is explicitly intended to be `SIGNAL_RETURN_DRAWDOWN`, not Account Drawdown, unless a complete account curve is produced.

## 4. Gross / Net and Costs

The runner records commission `0.025%`, slippage `0.02%`, stamp duty `0.05%`, minimum commission `5`, and cost version `paper-execution-default-v1`. It explicitly marks `grossPerformance = UNAVAILABLE`; `netPerformance` is not a certified completed result. Gross/Net closure therefore FAILS.

## 5. Expert Agreement

The existing model code has confusion and per-action metrics, but the replay closure runner does not persist a completed Expert Action vs Prediction confusion matrix or SELL_ALL recall snapshot. This item is incomplete.

## 6. Replay Reproducibility

The runner defines ReplaySnapshot fields: datasetHash, modelHash, stateVersion, featureVersion, predictionHash, actionSequenceHash, performanceHash. Because the first complete replay did not finish, no two completed runs were compared. Reproducibility is unverified.

## 7. Production Isolation

The frozen model snapshot contract records `affectsSmartT=false`, `affectsShadowV2=false`, and `canPromoteAutomatically=false`. No production execution path or real trading integration was changed.

## Final Gate

`OFFLINE_MODEL_READY = BLOCKED`

Remaining gaps only:

1. Complete the fixed TEST window through the existing HistoricalReplayEngine/SignalSample/PerformanceAnalytics path.
2. Produce valid metrics for all five groups and a completed Gross/Net reconciliation.
3. Persist Expert Agreement including SELL_ALL recall.
4. Run the completed replay twice and compare all ReplaySnapshot hashes.

No Offline RL, PPO, DQN, SAC, parameter tuning, or real trading was performed.
