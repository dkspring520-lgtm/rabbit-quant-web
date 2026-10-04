# Offline RL V0.11.4 Action Space Decision

- Gate: OFFLINE_RL_V0.11.4_ACTION_SPACE_DECISION = PASS
- Current observed action space: WAIT, BUY_SMALL, SELL_ALL
- Counts: WAIT 629142, BUY_SMALL 119058, SELL_ALL 1551, BUY 0, SELL_PART 0

## Evidence Matrix

| Option | Observed support | Evaluation support | Portfolio / T+1 | Future expansion |
| --- | --- | --- | --- | --- |
| 3-action | Complete current observed labels; SELL_ALL low support | Partial; SELL_ALL rare | Account state and sellablePosition required | New version with new observed data |
| 5-action | BUY and SELL_PART unseen | Blocked for those actions | Account state and sellablePosition required | Requires new observed coverage |
| Target Position | Not a logged label | Research schema only | Target cannot override todayBought | New schema and observed replay |
| Position Delta | Not a logged label | Research schema only | Negative delta clipped to sellablePosition | New schema and observed replay |

## Research Path

RESEARCH_ONLY: preserve V0.10 and study observed-support 3-action evaluation first; gather new real observed coverage before evaluating 5-action, target-position, or position-delta schemas

Dataset impact: V0.10 is unchanged. Counterfactuals are not promoted to observed data. No policy or RL training was performed.

- Source dataset hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- Source trajectory hash: 0e1e437d46e44eafc1815516ae2f5b154b0409209246be5fcec12c53bcb8c1cb
- Decision hash: e2427514dcff3011938492078280109a73e3d1411678d6e723e33b883d0d132d
- Production isolation: true
