# Offline RL V0.9.3.1 — Expert Trajectory Lineage Closure

**OFFLINE_RL_TRANSITION_V0.9.3 = PASS (unchanged contract gate)**
**OFFLINE_RL_EXPERT_LINEAGE_V0.9.3.1 = PASS**
**OFFLINE_RL_TRAINING_ELIGIBILITY = BLOCKED**

- sourceDatasetHash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- trajectoryDatasetHash: f9190b68d92bfeac9615b98b65115002ca3440e83bed4c482585c40fd8f74e1f
- stateDatasetHash: 6b935f9bcd9a3e190a090c61e6af21a7215942a5d257b1122af305a2bb65f19b
- `SYNTHETIC_FIXED_SCHEDULE_BASELINE` is isolated from Observed Expert and is never counted as observed behavior.
- Existing source audited: `OHLCV_T_RESEARCH_V1 / runOHLCVTResearch / generateOHLCVResearchSignal`.
- Expert source result: EXPERT_ACTION_SOURCE_UNAVAILABLE.
- DATA-07 lacks complete open/high/low/amount fields required by the existing OHLCV expert path; no fallback values were used.
- Observed Expert action support: {"WAIT":0,"BUY_SMALL":0,"BUY":0,"SELL_PART":0,"SELL_ALL":0}
- BUY / SELL_PART / SELL_ALL remain zero observed support and are not fabricated.
- Logged state schema includes marketState plus accountState; unavailable account context remains explicit null.
- Counterfactual branches remain separate from observed Expert behavior.
- No RL model training was performed.

## Gates
- syntheticBaselineSeparated: PASS
- existingExpertSourceAudited: PASS
- expertActionSource: EXPERT_ACTION_SOURCE_UNAVAILABLE
- noSyntheticExpertLabels: PASS
- marketAccountStateSchema: PASS
- counterfactualIsolation: PASS
- tPlusOne: PASS
- rewardSemantics: PASS
- reproducibility: PASS
- futureMutationAudit: PASS
- productionIsolation: PASS
- trainingPerformed: false

## Reproducibility
- identical: true
- SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1: expertTrajectoryHash=7c25fab7a230cf4e2e21d5bddbcbbc0e14a1e1404d7995a1b89bc55df9f57f44, syntheticBaselineHash=6f78131886bafc9834dae8a48bae86049f79f1ea7ca30dabd1e60ad12981be99, counterfactualHash=f73a4afce621bb8c51ebd658e62db094e920bcf2f3f8e3bb2697ccdabfabe063, transitionHash=f08c4477a9604aab42ed32ecfcc2d73071ca2635031a5c0b8c332e973db364f3
- SYNTHETIC_RESEARCH_PORTFOLIO_B_LONG_INVENTORY_V0.1: expertTrajectoryHash=7c25fab7a230cf4e2e21d5bddbcbbc0e14a1e1404d7995a1b89bc55df9f57f44, syntheticBaselineHash=6f78131886bafc9834dae8a48bae86049f79f1ea7ca30dabd1e60ad12981be99, counterfactualHash=f73a4afce621bb8c51ebd658e62db094e920bcf2f3f8e3bb2697ccdabfabe063, transitionHash=f08c4477a9604aab42ed32ecfcc2d73071ca2635031a5c0b8c332e973db364f3
- SYNTHETIC_RESEARCH_PORTFOLIO_C_LARGER_INVENTORY_V0.1: expertTrajectoryHash=7c25fab7a230cf4e2e21d5bddbcbbc0e14a1e1404d7995a1b89bc55df9f57f44, syntheticBaselineHash=6f78131886bafc9834dae8a48bae86049f79f1ea7ca30dabd1e60ad12981be99, counterfactualHash=f73a4afce621bb8c51ebd658e62db094e920bcf2f3f8e3bb2697ccdabfabe063, transitionHash=f08c4477a9604aab42ed32ecfcc2d73071ca2635031a5c0b8c332e973db364f3

Run: `node scripts/run-offline-rl-v0.9.3.1-expert-trajectory-lineage.mjs`
