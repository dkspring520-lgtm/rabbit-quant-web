# Offline RL V0.11.1 Action Support Root-Cause Audit

**ACTION_SUPPORT_AUDIT = PASS**

- Source rows: 249917
- Exact joined rows: 249917
- Lineage: source -> join -> trajectory -> dataset
- WAIT: source=209714, joined=209714, trajectory=629142, dataset=629142, attempted=629142, filled=0, support=SUPPORTED_NOOP
- BUY_SMALL: source=39686, joined=39686, trajectory=119058, dataset=119058, attempted=119058, filled=13037, support=SUPPORTED
- BUY: source=0, joined=0, trajectory=0, dataset=0, attempted=0, filled=0, support=UNSEEN_IN_EXPERT_POLICY
- SELL_PART: source=0, joined=0, trajectory=0, dataset=0, attempted=0, filled=0, support=UNSEEN_IN_EXPERT_POLICY
- SELL_ALL: source=517, joined=517, trajectory=1551, dataset=1551, attempted=1551, filled=657, support=RARE_SUPPORTED

- WAIT dominance: OHLCV_T_RESEARCH_V1 initializes WAIT; only positiveT/reverseT branches change the action
- BUY and SELL_PART are UNSEEN_IN_EXPERT_POLICY when source count is zero; no counterfactual rows were used.
- SELL_ALL is rare observed support, not evidence of stable value.
- No dataset modification, execution, reward recomputation, or model training was performed.

