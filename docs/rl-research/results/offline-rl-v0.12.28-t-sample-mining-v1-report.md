# OFFLINE RL V0.12.28 — T Sample Mining V1 Report

Mining Run ID: t-sample-mining-20261005152746-f92d1fd1

## Dataset

- Source: DATA-07
- Symbol: 601899.SH
- Dataset Hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- Source path: .data-inspect/zijin-601899-2022-2026.jsonl
- Data loader: existing historical JSONL stream

## Replay Range

- Start: 2022-01-04
- End: 2026-04-17
- Replay bars: 249917

## Sample Count

- Total samples: 249917
- Valid samples: 247843
- Invalid samples: 2074
- Warmup samples: 2074

## State Distribution

{"HIGH_LEVEL_EXHAUSTION":130068,"LOW_LEVEL_EXHAUSTION":111192,"NO_T_ENVIRONMENT":8657}

Requested state aliases: {"NEUTRAL":8657,"UPTREND":0,"DOWNTREND":0,"PULLBACK":0,"REBOUND":0,"UPWARD_EXHAUSTION_CANDIDATE":130068,"DOWNWARD_EXHAUSTION_CANDIDATE":111192}

## Opportunity Distribution

{"COUNTER_T_ENVIRONMENT":130068,"INVALID":2074,"NEUTRAL":6583,"POSITIVE_T_ENVIRONMENT":111192}

## Structure Distribution

{"COUNTER_T_STRUCTURE":130068,"NEUTRAL_STRUCTURE":8657,"POSITIVE_T_STRUCTURE":111192}

## Outcome Distribution

{"FAVORABLE_OUTCOME":68773,"INSUFFICIENT_HORIZON":5185,"MIXED_OUTCOME":106165,"UNFAVORABLE_OUTCOME":69794}

## MFE / MAE and Future Returns

{
  "1bar": {
    "count": 249917,
    "complete": 248880,
    "returnSum": 0.9010937028591025,
    "favorableSum": 0.9010937028591025,
    "adverseSum": 0.9010937028591025
  },
  "3bar": {
    "count": 249917,
    "complete": 246806,
    "returnSum": 3.6893701444152933,
    "favorableSum": 184.47474443281658,
    "adverseSum": -179.5465410428702
  },
  "5bar": {
    "count": 249917,
    "complete": 244732,
    "returnSum": 5.383945050839977,
    "favorableSum": 293.4423414471915,
    "adverseSum": -284.43404734161777
  },
  "10bar": {
    "count": 249917,
    "complete": 239547,
    "returnSum": 7.333688534116198,
    "favorableSum": 478.80963722014377,
    "adverseSum": -458.84201708543634
  }
}

## Boundary / Failure Samples

- Boundary samples: 98616
- Counter-example samples: 98616
- Samples were retained; no rule or threshold was modified to remove them.

## Market Regime Distribution

{"DOWNWARD_EXHAUSTION":111192,"NEUTRAL":8657,"UPWARD_EXHAUSTION":130068}

## Temporal Isolation

- TEMPORAL_ISOLATION = PASS
- Four deterministic historical dates were replayed with future-price mutation; Feature, State and Opportunity were unchanged while Outcome changed.

## Data Quality

- Monotonic sample timestamps: PASS
- Unique sample IDs: PASS
- Dataset hash consistency: PASS
- Existing loader events: 0

## Provenance

- Feature / State / Opportunity / Replay / Sample versions recorded in every sample.
- datasetHash recorded from DATA-07 source bytes.

## Limitations

- These are descriptive historical sample distributions, not predictive probabilities or trading success rates.
- DATA-07 is 1-minute research data; results do not establish Tick/L2 or millisecond microstructure validity.
- The current Sample Store is in-memory; this run writes a compressed research sample asset and mining metadata, not an RL Dataset.

## Safety Gate

T_SAMPLE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
