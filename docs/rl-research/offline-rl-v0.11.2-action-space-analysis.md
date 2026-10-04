# Offline RL V0.11.2 Action Space Analysis

- Gate: OFFLINE_RL_V0.11.2_ACTION_SPACE_ANALYSIS = PASS
- Dataset records: 749751
- Chronological split: true
- Random split: false

## Action Support

- Observed-support actions: WAIT, BUY_SMALL, SELL_ALL
- Unsupported/OOD actions: BUY, SELL_PART
- WAIT ratio: 83.9135%
- BUY: 0 (UNSEEN_IN_LOGGED_POLICY)
- SELL_PART: 0 (UNSEEN_IN_LOGGED_POLICY)
- SELL_ALL: 1551 (RARE_OBSERVED_SUPPORT)

## Value Benchmark

- Model evidence: NOT_SUPPORTED
- Source: existing V0.11 value/Q benchmark; no retraining performed
- Market-only and market+account results are preserved in the JSON companion.

## Interpretation

The three-action view is the only observed-support action space for this dataset. The original five-action environment remains partially unsupported because BUY and SELL_PART have zero logged observations. WAIT dominance and SELL_ALL rarity are reported as dataset properties, not corrected by resampling or synthetic actions.

Action-space redesign using target-position or delta buckets is research-only and is not applied to the dataset or production policy.

- Production isolation: true
- Training performed: false
- Analysis hash: f7c0cedafee62bac7198e204893b9762376c3d96bf4524b68cf4c122b0571afb
