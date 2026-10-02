# Offline RL V0.9.2 — Portfolio State & Behavior Coverage Audit

**OFFLINE_RL_BEHAVIOR_SUPPORT = PASS**
**OFFLINE_RL_DATASET_V0.9.2 = PASS**

- sourceDatasetHash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- trajectoryDatasetHash: f9190b68d92bfeac9615b98b65115002ca3440e83bed4c482585c40fd8f74e1f
- stateDatasetHash: 6b935f9bcd9a3e190a090c61e6af21a7215942a5d257b1122af305a2bb65f19b
- V0.9.1 trajectoryDatasetHash is transformed metadata derived from DATA-07 sourceHash plus scenario/config; it does not replace the DATA-07 source hash.
- All accounts are explicitly `SYNTHETIC_RESEARCH_PORTFOLIO`; none are real historical accounts.
- Scenarios: SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1, SYNTHETIC_RESEARCH_PORTFOLIO_B_LONG_INVENTORY_V0.1, SYNTHETIC_RESEARCH_PORTFOLIO_C_LARGER_INVENTORY_V0.1
- Observed action coverage: {"WAIT":746640,"BUY_SMALL":3111,"BUY":0,"SELL_PART":0,"SELL_ALL":0}
- Observed Behavior, Counterfactual Action, INVALID_ACTION and INPUT_UNAVAILABLE remain separate.
- BUY / SELL_PART / SELL_ALL absent from logged policy remain UNSEEN_IN_LOGGED_POLICY; no labels were fabricated.
- DATA-07 execution context is unavailable; no suspension or price-limit status was guessed.
- PaperExecutionEngine T+1 audit: same-day BUY shares remain unsellable; next trading day sells are fillable.
- Dataset PASS is not RL model ready; no RL training was performed.

## Gates
- lineage: PASS
- scenarios: PASS
- behaviorDefinitions: PASS
- tPlusOne: PASS
- executionContextAudit: PASS
- transitionIntegrity: PASS
- reproducibility: PASS
- productionIsolation: PASS
- noRLTraining: PASS

## Scenario hashes
- SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1: identical=true, scenarioHash=4654043b505407096a105f13a9f04328859ffd486acbfd4960e91cf21458ca81, trajectoryHash=7685fd4ee8db6d03b5773bb658dbeb75befed1e3552980520530808ecdd6a2ef, counterfactualHash=eff63386aac989b6ae9dfe6b0e26c1c8ce59b3082bbeafe125470ba5b162ee80, transitionHash=5568294002a2164c32456396dc092ce2bb964b89446851c7a34bd7cafb031a4d
- SYNTHETIC_RESEARCH_PORTFOLIO_B_LONG_INVENTORY_V0.1: identical=true, scenarioHash=903d38b4f4d2acd26d0266ba5a1e3557af9aa0c550a1bb82f4d197ed784f06c9, trajectoryHash=dca1faed0b27a08927607c5a29e2859abaf84c26dd616ada0de2b979c0891541, counterfactualHash=4c264bae5946127adc3c0617ce72f00f947a09876365d596e1714913871061e8, transitionHash=11477b084bb1809a67432b4a9f4e00c8fceb9521a965246c12f4d9dcdfcdf674
- SYNTHETIC_RESEARCH_PORTFOLIO_C_LARGER_INVENTORY_V0.1: identical=true, scenarioHash=f9c3dfcfc3b22f1e588db9984be4a07a5a4fd0611c75d9ddf8bd621b5a648b29, trajectoryHash=5080e879362805ca2fa9c8807f6f0b79af724a46d1abe8c550e88cf9ab246624, counterfactualHash=c10e7a12768fed8af375cacc7541d187fef5ab10d82762c606717d640284115f, transitionHash=bd6b5ed834c6f6d122b2386b3591c3c31282f856dacb40d592e8f85ae325834d

Run: `node scripts/run-offline-rl-v0.9.2-portfolio-behavior-support.mjs`
