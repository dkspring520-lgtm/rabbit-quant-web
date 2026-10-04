# Offline RL V0.11.3 Action Space Research

This is a schema comparison only. The V0.10 Dataset is unchanged and no policy is trained.

- Five discrete actions: BUY and SELL_PART are currently unsupported by observed data.
- Three observed actions: WAIT, BUY_SMALL, SELL_ALL; SELL_ALL is rare.
- Target Position: expressiveness is portfolio-aware, but target intent cannot override T+1 sellable inventory.
- Position Delta: directly expresses changes, but negative deltas must be clipped by sellablePosition and positive deltas by cash.

No alternative action space is selected or applied.

- Source dataset hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- Source trajectory hash: 0e1e437d46e44eafc1815516ae2f5b154b0409209246be5fcec12c53bcb8c1cb
- Research hash: 40fbb6308cf2619481f9f3919ad67a9d167756afdcb835cc74932b4d82dd46ed
- Production isolation: true
- Training performed: false
