# Offline RL V0.12.12 V2.8 Stateful Coverage Reconciliation

- Gate: OFFLINE_RL_V0.12.12_V28_RECONCILIATION = PASS
- Research simulation action counts are single-timeline; stateful replay expands across 3 scenarios.
- Unique market bars: 249917
- Stateful records: 749751

## Normalized Action Ratios

- WAIT: research=80.598%; stateful per-bar=98.249%; stateful expanded=98.249%
- BUY_SMALL: research=18.484%; stateful per-bar=1.581%; stateful expanded=1.581%
- BUY: research=0.830%; stateful per-bar=0.082%; stateful expanded=0.082%
- SELL_PART: research=0.000%; stateful per-bar=0.000%; stateful expanded=0.000%
- SELL_ALL: research=0.088%; stateful per-bar=0.088%; stateful expanded=0.088%

Exact per-bar divergence cannot be classified because V0.12.8 did not persist the research action sequence. The audit did not rerun research policy. The existing replay shows stateful execution feedback and account-dependent action decisions; aggregate evidence does not prove causal attribution.

SELL_PART remains unsupported. Any next trajectory must come only from stateful V2.8 replay, not the old research simulation. No V0.10 data was modified.

Analysis hash: 117949011e000cc48d9ab18d3c6aef92a5001aa0e0d8f54ac00358bbe8b87e2e
