# Offline Learning V0.8.2.4 Price-Only Outcome & Counterfactual Label Contract

Input: 249917 price-only states. State schema: ValidatedStatePriceOnlyV0.1.
Outcome coverage: 10m 0.999960, 30m 0.999880, 60m 0.999760. Unresolved rows are retained and never converted to WAIT.
Action values rank WAIT, BUY_SMALL, BUY, SELL_PART, SELL_ALL using future return, MFE, MAE and the versioned cost model. 30m LOW_MARGIN: 41624 (0.166571). Cost changed the best action on 14818 resolved rows.
State(T) contains no future fields. Mutation audit T+1/T+5/T+10/T+30 keeps StateHash unchanged; outcome mutation is allowed because outcomes are future-dependent.
Old OHLC Expert Action is excluded and remains LEGACY_OHLC_EXPERT_BENCHMARK.

**PRICE_ONLY_COUNTERFACTUAL_DATASET_READY**
