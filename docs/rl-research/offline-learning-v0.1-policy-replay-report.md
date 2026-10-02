# Offline Learning V0.1 Policy Replay Closure

## Audit Result

`OFFLINE_MODEL_READY = BLOCKED`

The closure runner is `scripts/run-offline-policy-replay.mjs`. It freezes the centroid model fitted on the train split, fixes the V0.2 test range, adapts predictions to the existing `HistoricalReplayEngine`, and uses the existing `SampleResolver` and `evaluateSignalSamples` path. No new return calculation was added.

## Fixed Test Contract

The test dataset is DATA-07 `601899.SH`, dataset hash `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`, with the V0.2 chronological test range and state version `state-v0.1`. The cost configuration is recorded as commission `0.025%` per side, slippage `0.02%` per side, stamp duty `0.05%`, minimum commission `5`, cost version `paper-execution-default-v1`.

## Replay Groups

The runner defines the same-window groups: ExpertActionReplay, LearnedPolicy, AlwaysWait, MajorityClass, and SeededRandom. Each group is routed through HistoricalReplayEngine with fixed initial cash/position and action adapter. ReplaySnapshot fields include modelHash, datasetHash, stateVersion, featureVersion, testRange, predictionHash, actionSequenceHash, and performanceHash.

## Blocking Findings

The full test replay did not complete within the available run because the current HistoricalReplayEngine recomputes the factor session prefix for every bar, producing a superlinear run for the 30,848-bar test window. Therefore no replay metrics are reported as valid. In particular, tradeCount, winRate, return, MFE/MAE, holding time, and drawdown must not be inferred from the interrupted run.

Gross and Net performance are not certified. The existing engine exposes execution costs, but a completed same-window replay and a formally reconciled Gross-versus-Net result are required before declaring PASS. Drawdown must be labeled `SIGNAL_RETURN_DRAWDOWN` unless a Paper account curve is explicitly completed.

## Gate

Remaining gaps:

1. Complete the fixed test window through the existing replay/performance pipeline without interruption.
2. Produce valid Gross and Net metrics for all five groups using the same cost model.
3. Persist Expert Agreement and all ReplaySnapshot hashes from the completed run.
4. Repeat the completed run and compare all hashes.

No Offline RL, PPO, DQN, Smart-T, Shadow V2, or real trading was started.
