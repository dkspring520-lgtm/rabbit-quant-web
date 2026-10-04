# Offline RL V0.12.6 Feature Representation

- Gate: OFFLINE_RL_V0.12.6_FEATURE_REPRESENTATION = PASS
- Dataset records: 749751
- Algorithm: CQL_INSPIRED_LINEAR_V0.12.1
- Train-only normalization: PASS
- Feature variants: E1-E5 plus single-account ablations

## Evidence

- RAW_ACCOUNT OOD: 1
- RATIO_ACCOUNT OOD: 0.4304006742738589
- RELATIVE_PORTFOLIO OOD: 0.17908167163266867
- RAW_RATIO OOD: 1
- Q-vs-Expert metrics are in the JSON artifact.
- WAIT dominance remains observed; SELL_ALL remains low-support.
- Relative denominator-invalid rows are retained as undefined and excluded from that variant's fit/inference metrics.

No variant was promoted to the V0.10 state schema. This is research evidence only.

- Feature hash: cc1acea0f050acee0bbea9ed5b143834fa4102ba25fb1e60132ed37a07d6b565
- Model hash: 4b622b1604445a051e97301763a99d292e3d02ae4f2451b6f61930a997378ed2
- Metrics hash: 87ac0b8b1987b5d31c24137177fb43b87ac275103f77935b7535aac310953b58
- Audit hash: 247f983bc6d746602b0df742d16d43a668afa59b795b115bfa7f103d52aefbfd
