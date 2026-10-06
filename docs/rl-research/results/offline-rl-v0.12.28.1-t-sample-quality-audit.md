# OFFLINE RL V0.12.28.1 — T Sample Quality Audit

Mining Run ID: t-sample-mining-20261005152746-f92d1fd1

## Dataset

- Dataset Hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- Symbol: 601899.SH
- Replay range: 2022-01-04 → 2026-04-17
- Sample asset: .data-inspect/t-sample-mining/v0.12.28/t-sample-mining-20261005152746-f92d1fd1/t-samples.jsonl.gz

## Sample Integrity

- Total samples: 249917
- Valid: 247843
- Invalid: 2074
- Warmup: 2074
- First timestamp: 2022-01-04T09:30:00
- Last timestamp: 2026-04-17T15:00:00

## State Distribution

{
  "DOWNWARD_EXHAUSTION_CANDIDATE": 111192,
  "NO_T_ENVIRONMENT": 8657,
  "UPWARD_EXHAUSTION_CANDIDATE": 130068
}

## Opportunity Distribution

{
  "COUNTER_T_ENVIRONMENT": 130068,
  "INVALID": 2074,
  "NEUTRAL": 6583,
  "POSITIVE_T_ENVIRONMENT": 111192
}

## Structure / Outcome Distribution

{
  "NEUTRAL_STRUCTURE": {
    "count": 8657,
    "outcomeDistribution": {
      "FAVORABLE_OUTCOME": 3210,
      "MIXED_OUTCOME": 2307,
      "UNFAVORABLE_OUTCOME": 3140
    },
    "meanReturn": {
      "1bar": 0.000015752922120032,
      "3bar": 0.00013943349879653804,
      "5bar": 0.00019772434925756659,
      "10bar": 0.00030521998110982334
    }
  },
  "POSITIVE_T_STRUCTURE": {
    "count": 111192,
    "outcomeDistribution": {
      "FAVORABLE_OUTCOME": 30531,
      "INSUFFICIENT_HORIZON": 2380,
      "MIXED_OUTCOME": 47559,
      "UNFAVORABLE_OUTCOME": 30722
    },
    "meanReturn": {
      "1bar": 0.000006344555474392212,
      "3bar": 0.000018552865619686124,
      "5bar": 0.000026667821062873555,
      "10bar": 0.000041380564880385144
    }
  },
  "COUNTER_T_STRUCTURE": {
    "count": 130068,
    "outcomeDistribution": {
      "FAVORABLE_OUTCOME": 35032,
      "INSUFFICIENT_HORIZON": 2805,
      "MIXED_OUTCOME": 56299,
      "UNFAVORABLE_OUTCOME": 35932
    },
    "meanReturn": {
      "1bar": 4.5558356980476413e-7,
      "3bar": 0.000003224191279558484,
      "5bar": 0.000005435595224760473,
      "10bar": 6.935709587961899e-7
    }
  }
}

## Outcome Distribution

{
  "FAVORABLE_OUTCOME": 68773,
  "INSUFFICIENT_HORIZON": 5185,
  "MIXED_OUTCOME": 106165,
  "UNFAVORABLE_OUTCOME": 69794
}

## Outcome Metrics

{
  "1bar": {
    "count": 249917,
    "complete": 248880,
    "meanFutureReturn": 0.0000036055718612943598,
    "meanMFE": 0.0000036055718612943598,
    "meanMAE": 0.0000036055718612943598
  },
  "3bar": {
    "count": 249917,
    "complete": 246806,
    "meanFutureReturn": 0.000014762381688381715,
    "meanMFE": 0.0007381440415530619,
    "meanMAE": -0.0007184246811656278
  },
  "5bar": {
    "count": 249917,
    "complete": 244732,
    "meanFutureReturn": 0.00002154293245693561,
    "meanMFE": 0.00117415918663873,
    "meanMAE": -0.001138114043228823
  },
  "10bar": {
    "count": 249917,
    "complete": 239547,
    "meanFutureReturn": 0.00002934449650930588,
    "meanMFE": 0.0019158746192541674,
    "meanMAE": -0.0018359776129092313
  }
}

## Market Regime Distribution

{
  "DOWNWARD_EXHAUSTION": 111192,
  "NEUTRAL": 8657,
  "UPWARD_EXHAUSTION": 130068
}

## Year Distribution

{
  "2022": 58322,
  "2023": 58322,
  "2024": 58322,
  "2025": 58563,
  "2026": 16388
}

## Year × State

{
  "2022|DOWNWARD_EXHAUSTION_CANDIDATE": 27240,
  "2022|NO_T_ENVIRONMENT": 2465,
  "2022|UPWARD_EXHAUSTION_CANDIDATE": 28617,
  "2023|DOWNWARD_EXHAUSTION_CANDIDATE": 25812,
  "2023|NO_T_ENVIRONMENT": 2245,
  "2023|UPWARD_EXHAUSTION_CANDIDATE": 30265,
  "2024|DOWNWARD_EXHAUSTION_CANDIDATE": 25267,
  "2024|NO_T_ENVIRONMENT": 1622,
  "2024|UPWARD_EXHAUSTION_CANDIDATE": 31433,
  "2025|DOWNWARD_EXHAUSTION_CANDIDATE": 26031,
  "2025|NO_T_ENVIRONMENT": 1877,
  "2025|UPWARD_EXHAUSTION_CANDIDATE": 30655,
  "2026|DOWNWARD_EXHAUSTION_CANDIDATE": 6842,
  "2026|NO_T_ENVIRONMENT": 448,
  "2026|UPWARD_EXHAUSTION_CANDIDATE": 9098
}

## Year × Opportunity

{
  "2022|COUNTER_T_ENVIRONMENT": 28617,
  "2022|INVALID": 484,
  "2022|NEUTRAL": 1981,
  "2022|POSITIVE_T_ENVIRONMENT": 27240,
  "2023|COUNTER_T_ENVIRONMENT": 30265,
  "2023|INVALID": 484,
  "2023|NEUTRAL": 1761,
  "2023|POSITIVE_T_ENVIRONMENT": 25812,
  "2024|COUNTER_T_ENVIRONMENT": 31433,
  "2024|INVALID": 484,
  "2024|NEUTRAL": 1138,
  "2024|POSITIVE_T_ENVIRONMENT": 25267,
  "2025|COUNTER_T_ENVIRONMENT": 30655,
  "2025|INVALID": 486,
  "2025|NEUTRAL": 1391,
  "2025|POSITIVE_T_ENVIRONMENT": 26031,
  "2026|COUNTER_T_ENVIRONMENT": 9098,
  "2026|INVALID": 136,
  "2026|NEUTRAL": 312,
  "2026|POSITIVE_T_ENVIRONMENT": 6842
}

## Counterexample Samples

- Retained counterexample sample count (capped display list): 100
- Examples: [{"sampleId":"601899.SH:2022-01-04T09:49:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:49:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.001030951451389095},{"sampleId":"601899.SH:2022-01-04T09:50:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:50:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0010298896851234085},{"sampleId":"601899.SH:2022-01-04T09:51:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:51:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.002057660207223977},{"sampleId":"601899.SH:2022-01-04T09:52:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:52:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.002059779370246928},{"sampleId":"601899.SH:2022-01-04T09:53:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:53:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.003089570839684197},{"sampleId":"601899.SH:2022-01-04T09:54:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:54:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0020639323999397385},{"sampleId":"601899.SH:2022-01-04T09:55:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:55:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.003092756037225586},{"sampleId":"601899.SH:2022-01-04T09:56:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:56:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.003092756037225586},{"sampleId":"601899.SH:2022-01-04T09:57:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:57:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0020639323999397385},{"sampleId":"601899.SH:2022-01-04T09:58:00:1.0.0:1.0.0","timestamp":"2022-01-04T09:58:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.001033081463488017},{"sampleId":"601899.SH:2022-01-04T10:01:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:01:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0010341498245022285},{"sampleId":"601899.SH:2022-01-04T10:02:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:02:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.002068299649004457},{"sampleId":"601899.SH:2022-01-04T10:03:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:03:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.002068299649004457},{"sampleId":"601899.SH:2022-01-04T10:04:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:04:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.002068299649004457},{"sampleId":"601899.SH:2022-01-04T10:05:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:05:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.004132227333881411},{"sampleId":"601899.SH:2022-01-04T10:06:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:06:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.002070342070938369},{"sampleId":"601899.SH:2022-01-04T10:09:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:09:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0010361943629840775},{"sampleId":"601899.SH:2022-01-04T10:12:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:12:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0010361943629840775},{"sampleId":"601899.SH:2022-01-04T10:13:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:13:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0010361943629840775},{"sampleId":"601899.SH:2022-01-04T10:24:00:1.0.0:1.0.0","timestamp":"2022-01-04T10:24:00","state":"DOWNWARD_EXHAUSTION_CANDIDATE","futureReturn_5bar":-0.0010352203974945962}]
- These are descriptive boundary samples, not failure predictions.

## Quality Scorecard

{
  "SampleIntegrity": "PASS",
  "TemporalIsolation": "PASS_FROM_V0.12.28_RUN",
  "TimestampIntegrity": "PASS",
  "SampleIdUniqueness": "PASS",
  "DatasetHashConsistency": "PASS",
  "OutcomeBoundary": "PASS",
  "FeatureLeakage": "PASS",
  "StateLeakage": "PASS",
  "OpportunityLeakage": "PASS",
  "StateCoverage": "WARNING",
  "OpportunityCoverage": "PASS",
  "OutcomeCoverage": "PASS",
  "MarketRegimeCoverage": "WARNING",
  "CounterexampleCoverage": "PASS"
}

T SAMPLE QUALITY = CONDITIONAL

## Failure Taxonomy

- Existing execution failure labels were not inferred from this mining-only asset.
- Failure reason remains UNKNOWN unless proven by Replay / execution evidence.

## Limitations

- This audit reports descriptive historical sample distributions, not predictive probabilities or trading success rates.
- State coverage is conditional because the current CORE_SAFE state implementation emits only the observed state vocabulary in this asset.
- DATA-07 is 1-minute research data and cannot validate Tick/L2 or millisecond microstructure hypotheses.

## Safety Gate

T_SAMPLE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HARD_STOP = TRUE
