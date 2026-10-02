# OFFLINE LEARNING V0.1 FINAL CLOSURE AUDIT V1

The fixed DATA-07 TEST replay was executed twice from the same dataset and deterministic train-fitted model. No model, strategy, reward, or ReplayContext definitions were changed.

## ReplaySnapshot

Each of Expert, Learned, Random, AlwaysWait, and Majority has a snapshot containing `datasetHash`, `contextHash`, `modelHash`, `featureVersion`, `stateVersion`, `predictionHash`, `actionSequenceHash`, and `performanceHash`. The machine-readable values are in [offline-learning-v0.1-paper-account-report.json](./offline-learning-v0.1-paper-account-report.json).

## Reproducibility

Run A and Run B snapshot hashes were identical for all five policies: `identical=true`.

## Policy isolation

Each policy uses a distinct account ID and independently created execution engine. Account balances, positions, order ledgers, and performance objects are isolated. `independentAccounts=true`, `independentOrders=true`, and `sharedContextUnchanged=true`.

## Fixed metrics

The report records `initialCash`, `endingCash`, `netReturn`, `fees`, `slippage`, `tradeCount`, `realizedPnL`, and `maxDrawdown` for every account. Costs come from the existing Paper Execution Engine configuration: commission 0.025% with 5 CNY minimum, 0.05% sell stamp duty, and 0.02% slippage.

## Gate

`OFFLINE_MODEL_READY = PASS`

Production isolation remains `affectsSmartT=false`, `affectsShadowV2=false`, and `canPromoteAutomatically=false`. No Offline RL training or real trading was started.
