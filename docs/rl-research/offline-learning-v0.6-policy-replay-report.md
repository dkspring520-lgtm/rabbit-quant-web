# Offline Learning V0.6 Policy Replay Validation

Fixed DATA-07 TEST replay compares Expert, Counterfactual, and Always WAIT. The counterfactual selector uses only V0.5 action ranking probabilities; future returns are used for evaluation only.

Bars: 30848. Action distribution and metrics are in the JSON report. Replay applies commission, slippage, T+1, cash/position limits, lot size, and limit checks without connecting PaperExecutionEngine.

Reproducibility: **identical=true**. Production isolation: **PASS**.

**POLICY_REPLAY_READY**
