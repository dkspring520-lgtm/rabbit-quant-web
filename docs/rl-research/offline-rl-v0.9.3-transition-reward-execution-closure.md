# Offline RL V0.9.3 — Transition / Reward / Execution Closure

**OFFLINE_RL_TRANSITION_V0.9.3 = PASS**
**OFFLINE_RL_TRAINING_ELIGIBILITY = PARTIAL_SUPPORT**

- sourceDatasetHash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- trajectoryDatasetHash: f9190b68d92bfeac9615b98b65115002ca3440e83bed4c482585c40fd8f74e1f
- stateDatasetHash: 6b935f9bcd9a3e190a090c61e6af21a7215942a5d257b1122af305a2bb65f19b
- The trajectory hash is transformed metadata and never replaces the DATA-07 source hash.
- State → Action → PaperExecutionEngine → Execution Result → rate-v2 Reward → Next State is audited.
- Counterfactual branches clone the same pre-action account; results are never observed behavior.
- INVALID_ACTION, INPUT_UNAVAILABLE and OUTCOME_UNRESOLVED preserve null reward fields; no zero reward is fabricated.
- Observed support: {"WAIT":746640,"BUY_SMALL":3111,"BUY":0,"SELL_PART":0,"SELL_ALL":0}
- BUY / SELL_PART / SELL_ALL with zero observed support remain UNSEEN_IN_LOGGED_POLICY.
- Execution context remains INPUT_UNAVAILABLE because DATA-07 cannot causally verify trading status, suspension, limitUp or limitDown.
- No PPO, DQN, SAC, CQL, IQL, online learning or RL model training was performed.

## Gates
- transitionContract: PASS
- paperExecutionIntegrated: PASS
- rewardContract: PASS
- tPlusOne: PASS
- executionContext: INPUT_UNAVAILABLE
- observedSupportHonest: PASS
- leakage: PASS
- reproducibility: PASS
- productionIsolation: PASS
- trainingPerformed: false

## Scenario hashes
- SYNTHETIC_RESEARCH_PORTFOLIO_C_10000_V0.1: identical=true, trajectoryHash=ccde9061b83bce9e6dfcb59377f6ad98ad7301358e1822d6e92507276775f042, counterfactualHash=f73a4afce621bb8c51ebd658e62db094e920bcf2f3f8e3bb2697ccdabfabe063, transitionHash=f08c4477a9604aab42ed32ecfcc2d73071ca2635031a5c0b8c332e973db364f3
- SYNTHETIC_RESEARCH_PORTFOLIO_B_LONG_INVENTORY_V0.1: identical=true, trajectoryHash=a3968bc500acada0557b37af19e2ebeb40b36ada263a3ac1d52f60245b26a543, counterfactualHash=15ff1ab707824aab5676cfe7b4d6fff07b337b7d367e50f9f50ebe8e0def5d4e, transitionHash=13a1b04b8aa6f105dd97cf2247153d8ea50d4a37dde55868d6045f66a71566fa
- SYNTHETIC_RESEARCH_PORTFOLIO_C_LARGER_INVENTORY_V0.1: identical=true, trajectoryHash=3706b83d87b3af8ea2f357e8b0cb6a114eee51d71158db77c23d38357573a730, counterfactualHash=576d5eb172c568381b2173b6134137fefa74560a6b63e28bbaf6fa8945a94bdd, transitionHash=7e6345963c9129955c63496c4e1434a61e014cae3b66e004fdf211580ad1dfa1

Run: `node scripts/run-offline-rl-v0.9.3-transition-reward-execution-closure.mjs`
