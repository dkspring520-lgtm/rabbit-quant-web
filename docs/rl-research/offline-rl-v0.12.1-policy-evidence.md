# Offline RL V0.12.1 Policy Evidence

- Gate: OFFLINE_RL_V0.12.1_POLICY_EVIDENCE_AUDIT = PASS
- MODEL_EVIDENCE = NOT_SUPPORTED
- Policy pipeline = PASS

## Root Cause Decomposition

- ACTION_SUPPORT: **CONCERN**
- WAIT_DOMINANCE: **CONCERN**
- SELL_ALL_SUPPORT: **CONCERN**
- PORTFOLIO_OOD: **CONCERN**
- TEMPORAL_STABILITY: **CONCERN**
- ACTION_RANKING: **CONCERN**
- CALIBRATION: **CONCERN**
- EXPERT_LEARNABILITY: **CONCERN**

## Findings

- WAIT dominance: 83.9135% of observed rows.
- BUY and SELL_PART remain unsupported because the Expert signal was never generated in current coverage.
- SELL_ALL is reported as low-support without replication or rebalancing.
- Portfolio-aware OOD is compared with market-only OOD and is not hidden or corrected by fabricated data.
- Raw split quantiles are not present in the existing artifact; this limitation is recorded rather than guessed.
- Policy-Q agreement and ranking are limited by persisted artifact granularity; no new training was performed.

## Feasibility

- Classification: **RESEARCH_ONLY**
- Next research path: Do not tune on test; obtain broader real observed Expert coverage or revise action/schema in a new dataset version before stronger RL.

No Dataset, trajectory, execution, reward, counterfactual, or trading artifact was modified.

Audit hash: 2f887e5bb6a31341c32a42e5c62889753e4350f05f7be3f94f5d319e4a8dc626
