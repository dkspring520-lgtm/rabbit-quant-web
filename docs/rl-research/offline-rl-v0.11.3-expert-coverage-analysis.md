# Offline RL V0.11.3 Expert Coverage Analysis

- Gate: OFFLINE_RL_V0.11.3_EXPERT_COVERAGE_ANALYSIS = PASS
- Records: 749751
- Source dataset hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- Source trajectory hash: 0e1e437d46e44eafc1815516ae2f5b154b0409209246be5fcec12c53bcb8c1cb
- Normalized dataset hash: d51b5155ddc3a985a5d8d8f4018f5d8c1e9c4f097fe0d6445864e9b1e92bd81b

## Findings

BUY and SELL_PART have zero source, joined, trajectory, and dataset observations in the existing support audit. The existing Expert provenance defines BUY as positiveT with score >= 70 and SELL_PART as reverseT with score < 75, but this artifact contains no such generated signals. Therefore this audit does not claim whether broader dates or symbols would produce them.

SELL_ALL remains rare observed support. WAIT dominance is retained as observed behavior. Regime labels are causal summaries of fields already present in state and do not create actions.

## Temporal Coverage

Years: 2022, 2023, 2024, 2025, 2026

## Action Counts

{
  "WAIT": 629142,
  "BUY_SMALL": 119058,
  "BUY": 0,
  "SELL_PART": 0,
  "SELL_ALL": 1551
}

- Training performed: false
- Production isolation: true
- Analysis hash: 50cdb46215644010177610db74438d3022bcca79e1f505d234ab5f3d583ec858
