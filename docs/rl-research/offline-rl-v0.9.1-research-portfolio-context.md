# Offline RL V0.9.1 — Deterministic Research Portfolio Context

**OFFLINE_RL_LOGGED_DATASET_V0.9.1 = PASS**
**OFFLINE_RL_COUNTERFACTUAL_V0.9.1 = PASS**

- Portfolio type: `SYNTHETIC_RESEARCH_PORTFOLIO`; never `REAL_HISTORICAL_ACCOUNT`.
- Scenario: SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1; initialCash=10000; initialPosition=0; lotSize=100.
- Trajectory records: 249917; counterfactual groups: 249917; counterfactual transitions: 1249585.
- Each counterfactual action clones the same pre-action account. Action A cannot affect Action B.
- Existing PaperExecutionEngine is used; no broker, real trading, Smart-T, or Expert Strategy modification.
- Missing execution context is `INPUT_UNAVAILABLE`; invalid orders are `INVALID_ACTION`; missing future reward is `OUTCOME_UNRESOLVED`; null is preserved and never replaced by zero.
- Expert regret is historical counterfactual analysis, not future prediction.

## Gates
- syntheticScenarioDeclared: PASS
- loggedTrajectory: PASS
- counterfactualDataset: PASS
- tPlusOne: PASS
- invalidSemantics: PASS
- unresolvedSemantics: PASS
- leakage: PASS
- reproducibility: PASS
- productionIsolation: PASS
- trainingPerformed: false

- datasetHash: f9190b68d92bfeac9615b98b65115002ca3440e83bed4c482585c40fd8f74e1f
- scenarioHash: f31ad816798f1eef092173e3f786cf0ec6c93bdfacdd8f7b6e22d34d634257b2
- executionHash: 81a292ae6ff068c30a20d1c717953e8e97682410fe7a8da4b2919adad7653e2a
- rewardHash: f45f31c13858a941f0e623f4b473e7147c516d0b7ad6fdb7cb1cbe4c523a7cff
- trajectoryHash: 62ed36082d7364dd727f5409d238f455ed0c1a34c85faf6ed8d5b7d2782db086
- counterfactualHash: 50ed027de3271ff8c900072b4ab01ee6741e43e04e7a85298417e72d59b12282
- reproducibility.identical: true

Run: `node scripts/run-offline-rl-v0.9.1-research-portfolio-context.mjs`
