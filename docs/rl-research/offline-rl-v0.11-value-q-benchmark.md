# Offline RL V0.11 — Value / Q Model Benchmark

**MODEL_EVIDENCE = NOT_SUPPORTED**

This is a logged-reward value benchmark only. It does not train a final policy, use counterfactual rows as logged behavior, modify the V0.10 dataset, or execute trades.
- Records: 749751; scenarios: 3; episodes: 3111.
- Action support: {"WAIT":{"observedCount":629142,"status":"OBSERVED_SUPPORT"},"BUY_SMALL":{"observedCount":119058,"status":"OBSERVED_SUPPORT"},"BUY":{"observedCount":0,"status":"UNSEEN_IN_LOGGED_POLICY"},"SELL_PART":{"observedCount":0,"status":"UNSEEN_IN_LOGGED_POLICY"},"SELL_ALL":{"observedCount":1551,"status":"OBSERVED_SUPPORT"}}.
- BUY and SELL_PART remain UNSEEN_IN_LOGGED_POLICY and are reported OOD; no reward is fabricated.
- Test is chronological and frozen; no normalization or model selection uses test rows.
- Feature modes compare market-only against market+account state using existing causal state fields.

Metrics are in the JSON artifact. No production promotion is implied.

