# Offline RL V0.12 Policy Research

- Gate: OFFLINE_RL_V0.12_POLICY_RESEARCH = PASS
- Policy pipeline: PASS
- Action space: WAIT / BUY_SMALL / SELL_ALL
- Train records: 524898
- Validation and test use chronological splits only.

## Baselines

Always-WAIT, deterministic behavior cloning, and supported-action value-derived policy are reported in the JSON artifact. Metrics include overall accuracy, non-WAIT accuracy, macro F1, balanced accuracy, per-action precision/recall/F1, Brier score, ECE, OOD rate, and policy-Q agreement.

## Support and limitations

BUY and SELL_PART are excluded from policy targets because they are UNSEEN_IN_LOGGED_POLICY. SELL_ALL remains low-support and is reported without duplication or rebalancing. This is not a profitability or trading-readiness claim.

## Leakage and isolation

Features use state_t only. nextState and future reward are targets/evaluation data and are excluded from inputs. No execution, reward regeneration, trajectory regeneration, paper trading, real trading, or broker API was used.

- MODEL_EVIDENCE = NOT_SUPPORTED
- Research hash: 667f8457d7f78e98f2b9dca99ce4c76cc7fb92a04c535e785a33491ebbad4de0
