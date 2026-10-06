# OFFLINE RL V0.12.28.3 — T State Logic Root-Cause Audit

本报告为只读 ROOT-CAUSE AUDIT。未修改 Feature / State / Opportunity Engine，未重新生成 Samples。

## 1. Executive Summary

- ROOT_CAUSE_STATUS = MULTIPLE_INTERACTING_CAUSES
- State priority interaction = CONFIRMED
- State persistence interaction = ROOT_CAUSE_CANDIDATE
- 120-bar lifecycle cap = NOT_CONFIRMED; correlation with session/input boundary only
- MODEL_CHANGE = PROPOSAL_ONLY
The audit finds that the zero final coverage of UPTREND/DOWNTREND/PULLBACK/REBOUND is not caused by those candidate branches never firing. Candidate states are present in the asset, but final state transitions are dominated by exhaustion precedence and a minimum-dwell hysteresis hold.

## 2. Audit Scope

- Asset: .data-inspect/t-sample-mining/v0.12.28/t-sample-mining-20261005152746-f92d1fd1/t-samples.jsonl.gz
- Mining Run ID: t-sample-mining-20261005152746-f92d1fd1
- Dataset Hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- No Replay rerun; no sample mutation.

## 3. Dataset / Mining Run

- Symbol: 601899.SH
- Range: 2022-01-04 → 2026-04-17
- Total samples: 249917
- Valid samples: 247843
- Invalid samples: 2074
- Warmup samples: 2074

## 4. Current State and Candidate Distributions

Final state distribution:
{
  "DOWNWARD_EXHAUSTION_CANDIDATE": 111192,
  "NEUTRAL": 6583,
  "UPWARD_EXHAUSTION_CANDIDATE": 130068
}

Stored candidateState distribution:
{
  "LOW_LEVEL_EXHAUSTION": 3164,
  "REBOUND": 73872,
  "DOWN_ACCELERATION": 37874,
  "PULLBACK": 975,
  "NO_T_ENVIRONMENT": 1138,
  "UP_ACCELERATION": 37663,
  "HIGH_LEVEL_EXHAUSTION": 6746,
  "WAIT_CONFIRMATION": 84753,
  "UPTREND": 1040,
  "RANGE": 206,
  "DOWNTREND": 412
}

Derived condition counts:
{
  "DOWNTREND_CONDITION": 55442,
  "DOWNWARD_EXHAUSTION_CONDITION": 6101,
  "POTENTIAL_REBOUND": 34231,
  "UPTREND_CONDITION": 52118,
  "POTENTIAL_PULLBACK": 33174,
  "UPWARD_EXHAUSTION_CONDITION": 11778
}

Candidate → final state mapping:
[
  {
    "key": "WAIT_CONFIRMATION→UPWARD_EXHAUSTION_CANDIDATE",
    "count": 84753
  },
  {
    "key": "REBOUND→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 71405
  },
  {
    "key": "DOWN_ACCELERATION→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 35363
  },
  {
    "key": "UP_ACCELERATION→UPWARD_EXHAUSTION_CANDIDATE",
    "count": 35306
  },
  {
    "key": "HIGH_LEVEL_EXHAUSTION→UPWARD_EXHAUSTION_CANDIDATE",
    "count": 6746
  },
  {
    "key": "LOW_LEVEL_EXHAUSTION→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 3164
  },
  {
    "key": "DOWN_ACCELERATION→NEUTRAL",
    "count": 2511
  },
  {
    "key": "UP_ACCELERATION→NEUTRAL",
    "count": 2357
  },
  {
    "key": "REBOUND→UPWARD_EXHAUSTION_CANDIDATE",
    "count": 2316
  },
  {
    "key": "NO_T_ENVIRONMENT→NEUTRAL",
    "count": 1138
  },
  {
    "key": "UPTREND→UPWARD_EXHAUSTION_CANDIDATE",
    "count": 947
  },
  {
    "key": "PULLBACK→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 890
  },
  {
    "key": "DOWNTREND→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 370
  },
  {
    "key": "RANGE→NEUTRAL",
    "count": 206
  },
  {
    "key": "REBOUND→NEUTRAL",
    "count": 151
  },
  {
    "key": "UPTREND→NEUTRAL",
    "count": 93
  },
  {
    "key": "PULLBACK→NEUTRAL",
    "count": 85
  },
  {
    "key": "DOWNTREND→NEUTRAL",
    "count": 42
  }
]

Key fact: candidateState contains UPTREND=1040, DOWNTREND=412, PULLBACK=975 and REBOUND=73872, while final states for all four are zero.

## 5. State Engine Execution Path

1. Feature snapshot enters `TStateEngine.calculate`.
2. `classifyCandidate(featureSnapshot, previousState)` evaluates previous-state hooks first.
3. Exhaustion conditions are evaluated before acceleration, trend, directional fallback, range and neutral branches.
4. `transitionState(previous, candidate, { dwell })` applies minimum dwell / hysteresis.
5. Final state is written to the state snapshot and pushed into history.

Code evidence:
{
  "priority": [
    "12: const upExhaustion = snapshot.exhaustion?.upwardExhaustionCandidate === true;",
    "13: const downExhaustion = snapshot.exhaustion?.downwardExhaustionCandidate === true;",
    "20: if (upExhaustion && velocity > 0) return { state: \"HIGH_LEVEL_EXHAUSTION\", reasons: [\"positive momentum with negative acceleration at high range position\"] };",
    "21: if (downExhaustion && velocity < 0) return { state: \"LOW_LEVEL_EXHAUSTION\", reasons: [\"negative momentum with improving acceleration at low range position\"] };",
    "22: if (velocity > 0 && acceleration > 0) return { state: \"UP_ACCELERATION\", reasons: [\"positive momentum is accelerating\"] };",
    "23: if (velocity < 0 && acceleration < 0) return { state: \"DOWN_ACCELERATION\", reasons: [\"negative momentum is accelerating\"] };",
    "24: if (velocity > 0 && (position ?? 0.5) >= 0.55) return { state: \"UPTREND\", reasons: [\"positive causal momentum and upper-range location\"] };",
    "25: if (velocity < 0 && (position ?? 0.5) <= 0.45) return { state: \"DOWNTREND\", reasons: [\"negative causal momentum and lower-range location\"] };",
    "26: if (velocity > 0) return { state: \"REBOUND\", reasons: [\"positive momentum after lower-range observation\"] };",
    "27: if (velocity < 0) return { state: \"PULLBACK\", reasons: [\"negative momentum after upper-range observation\"] };"
  ],
  "hysteresis": [
    "1: export const DEFAULT_STATE_OPTIONS = Object.freeze({ minimumDwell: 2, confirmationDwell: 2, invalidationDwell: 2 });",
    "38: const minimum = Number(context.minimumDwell ?? DEFAULT_STATE_OPTIONS.minimumDwell);",
    "39: if (dwell < minimum && ![\"INVALID\", \"HIGH_LEVEL_EXHAUSTION\", \"LOW_LEVEL_EXHAUSTION\"].includes(candidateState)) return { state: previous, event: \"HYSTERESIS_HOLD\", confirmed: false, dwell };"
  ],
  "history": [
    "8: const previous = this.history.at(-1);",
    "9: const candidate = classifyCandidate(featureSnapshot, previous?.state);",
    "10: const sameCount = previous?.state === candidate.state ? (previous.dwell ?? 0) + 1 : 1;",
    "11: const transition = transitionState(previous, candidate, { ...this.options, dwell: sameCount });",
    "15: result.confirmed = transition.confirmed; result.dwell = sameCount; result.candidateState = candidate.state; result.researchOnly = true; result.rlEligible = false;",
    "16: this.history.push({ state, dwell: sameCount });",
    "19: calculateSeries(features) { this.reset(); return (features ?? []).map(item => this.calculate(item)); }"
  ],
  "replay": [
    "48: const features = new TFeatureEngine().calculateSeries(points, { symbol, timeframe: \"1m\" });",
    "49: const states = new TStateEngine().calculateSeries(features);",
    "50: const opportunities = new TOpportunityEngine().calculateSeries(features, states);"
  ],
  "mining": [
    "36: for (const [date, dayRows] of rowsByDate) {",
    "37: const result = replay.replay(dayRows, { symbol, dataSource: \"DATA-07\", collectSamples: false, onSample: sample => {"
  ]
}

## 6. Exhaustion Lifecycle

{
  "UPWARD_EXHAUSTION_CANDIDATE": {
    "duration": {
      "count": 1119,
      "mean": 116.23592493297588,
      "median": 119,
      "p90": 120,
      "max": 120,
      "oneBarRatio": 0
    },
    "transitionLabels": {
      "CONFIRMATION_REQUIRED": 561,
      "HOLD": 6185,
      "HYSTERESIS_HOLD": 123322
    },
    "episodeCount": 1119,
    "maxEpisodeExamples": [
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-06T13:01:00",
        "endTimestamp": "2022-01-06T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-10T13:01:00",
        "endTimestamp": "2022-01-10T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-12T13:01:00",
        "endTimestamp": "2022-01-12T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-13T13:01:00",
        "endTimestamp": "2022-01-13T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-20T13:01:00",
        "endTimestamp": "2022-01-20T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-26T13:01:00",
        "endTimestamp": "2022-01-26T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-02-07T13:01:00",
        "endTimestamp": "2022-02-07T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "UPWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-02-09T13:01:00",
        "endTimestamp": "2022-02-09T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      }
    ],
    "explicitMaxDuration": false,
    "persistence": "NOT_PRESENT",
    "cooldown": "NOT_PRESENT",
    "expiry": "NOT_PRESENT"
  },
  "DOWNWARD_EXHAUSTION_CANDIDATE": {
    "duration": {
      "count": 952,
      "mean": 116.7983193277311,
      "median": 119,
      "p90": 120,
      "max": 120,
      "oneBarRatio": 0
    },
    "transitionLabels": {
      "CONFIRMATION_REQUIRED": 476,
      "HYSTERESIS_HOLD": 108028,
      "HOLD": 2688
    },
    "episodeCount": 952,
    "maxEpisodeExamples": [
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-04T13:01:00",
        "endTimestamp": "2022-01-04T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-05T13:01:00",
        "endTimestamp": "2022-01-05T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-07T13:01:00",
        "endTimestamp": "2022-01-07T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-11T13:01:00",
        "endTimestamp": "2022-01-11T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-14T13:01:00",
        "endTimestamp": "2022-01-14T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-17T13:01:00",
        "endTimestamp": "2022-01-17T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-18T13:01:00",
        "endTimestamp": "2022-01-18T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      },
      {
        "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
        "startTimestamp": "2022-01-19T13:01:00",
        "endTimestamp": "2022-01-19T15:00:00",
        "duration": 120,
        "startTransition": "HYSTERESIS_HOLD",
        "endTransition": "HYSTERESIS_HOLD"
      }
    ],
    "explicitMaxDuration": false,
    "persistence": "NOT_PRESENT",
    "cooldown": "NOT_PRESENT",
    "expiry": "NOT_PRESENT"
  }
}

Lifecycle boundary evidence:
- Upward exhaustion non-exhaustion exit attempts: 123322; held by HYSTERESIS_HOLD: 123322; observed exits: 0
- Downward exhaustion non-exhaustion exit attempts: 108028; held by HYSTERESIS_HOLD: 108028; observed exits: 0
- ENTRY: exhaustion candidate is exempt from the minimum-dwell hold and can become final.
- HOLD: same candidate produces HOLD; changed non-exhaustion candidate produces HYSTERESIS_HOLD.
- EXIT: no non-exhaustion exit was observed after an exhaustion final state; the current transition code keeps dwell at 1 because the previous final state remains exhaustion.
- RE-ENTRY / RESET: State history resets at each per-day calculateSeries call; no exhaustion cooldown or expiry was found.
- Representative held-exit traces:
{
  "upward": [
    {
      "sampleId": "601899.SH:2022-01-06T09:39:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:39:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "WAIT_CONFIRMATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
      "trendDirection": "DOWN",
      "velocity": -0.0010224208057807438,
      "acceleration": -0.002045888025741238,
      "rangePosition": 0.8571525885558583,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004094259329901817
    },
    {
      "sampleId": "601899.SH:2022-01-06T09:40:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:40:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "WAIT_CONFIRMATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
      "trendDirection": "DOWN",
      "velocity": -0.0010235648324754543,
      "acceleration": -0.000001144026694710476,
      "rangePosition": 0.714291553133515,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.00409835665112579
    },
    {
      "sampleId": "601899.SH:2022-01-06T09:41:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:41:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "WAIT_CONFIRMATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0.0010235648324754543,
      "rangePosition": 0.714291553133515,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.00409835665112579
    },
    {
      "sampleId": "601899.SH:2022-01-06T09:42:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:42:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "WAIT_CONFIRMATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
      "trendDirection": "DOWN",
      "velocity": -0.002049227181827984,
      "acceleration": -0.002049227181827984,
      "rangePosition": 0.42856948228882835,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.002053337223750229
    }
  ],
  "downward": [
    {
      "sampleId": "601899.SH:2022-01-04T09:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:33:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0.0010361943629840775,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0020746372797806334
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:34:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:34:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0020746372797806334
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:35:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:35:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:36:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:36:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010372691754565455
    }
  ]
}

Lifecycle interpretation:
- ENTRY: produced when the candidate is accepted as a new final state.
- HOLD: produced when previous and candidate states match.
- HYSTERESIS_HOLD: produced when a changed candidate has dwell=1 and is not INVALID/HIGH_LEVEL_EXHAUSTION/LOW_LEVEL_EXHAUSTION.
- No exhaustion-specific cooldown, expiry, max duration, or state-age exit was found.
- `confirmationDwell` and `invalidationDwell` are declared in defaults but are not used by the transition calculation.

## 7. 120-Bar Duration Investigation

- Relevant source literal 120 matches: {
  "transition": [],
  "engine": [],
  "replay": [],
  "mining": [],
  "feature": []
}
- Relevant lifecycle tokens: {
  "transition": {
    "maxDuration": [],
    "confirmationDwellUses": 1,
    "invalidationDwellUses": 1,
    "minimumDwellUses": 3
  },
  "engine": {
    "maxDuration": [],
    "confirmationDwellUses": 0,
    "invalidationDwellUses": 0,
    "minimumDwellUses": 0
  },
  "replay": {
    "maxDuration": [],
    "confirmationDwellUses": 0,
    "invalidationDwellUses": 0,
    "minimumDwellUses": 0
  },
  "mining": {
    "maxDuration": [],
    "confirmationDwellUses": 0,
    "invalidationDwellUses": 0,
    "minimumDwellUses": 0
  }
}
- Maximum exhaustion episodes observed: upward 120; downward 120
- Max-duration examples: {
  "upward": [
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-06T13:01:00",
      "endTimestamp": "2022-01-06T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-10T13:01:00",
      "endTimestamp": "2022-01-10T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-12T13:01:00",
      "endTimestamp": "2022-01-12T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-13T13:01:00",
      "endTimestamp": "2022-01-13T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-20T13:01:00",
      "endTimestamp": "2022-01-20T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-26T13:01:00",
      "endTimestamp": "2022-01-26T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-02-07T13:01:00",
      "endTimestamp": "2022-02-07T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "UPWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-02-09T13:01:00",
      "endTimestamp": "2022-02-09T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    }
  ],
  "downward": [
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-04T13:01:00",
      "endTimestamp": "2022-01-04T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-05T13:01:00",
      "endTimestamp": "2022-01-05T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-07T13:01:00",
      "endTimestamp": "2022-01-07T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-11T13:01:00",
      "endTimestamp": "2022-01-11T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-14T13:01:00",
      "endTimestamp": "2022-01-14T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-17T13:01:00",
      "endTimestamp": "2022-01-17T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-18T13:01:00",
      "endTimestamp": "2022-01-18T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    },
    {
      "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
      "startTimestamp": "2022-01-19T13:01:00",
      "endTimestamp": "2022-01-19T15:00:00",
      "duration": 120,
      "startTransition": "HYSTERESIS_HOLD",
      "endTransition": "HYSTERESIS_HOLD"
    }
  ]
}
- Root-cause conclusion: no explicit 120-bar max duration is present in State Engine code. The 120-bar maximum is consistent with the 13:01–15:00 contiguous afternoon segment and the mining implementation calling Replay separately for each date.
- 120-BAR ROOT CAUSE = CORRELATION_ONLY_WITH_SESSION_PARTITION; not a confirmed hard-coded duration limit.

## 8. State Priority / Override Analysis

Actual priority graph from code:
PREVIOUS_STATE_HOOK > EXHAUSTION > ACCELERATION > TREND > DIRECTIONAL_FALLBACK > RANGE > NEUTRAL

Specific precedence:
- UPWARD_EXHAUSTION > UP_ACCELERATION > UPTREND > REBOUND
- DOWNWARD_EXHAUSTION > DOWN_ACCELERATION > DOWNTREND > PULLBACK
- Previous-state hooks run before all of the above.
- Exhaustion override evidence: CONFIRMED_INTERACTION

## 9. UPTREND / DOWNTREND Zero-Coverage Analysis

- Stored UPTREND candidateState count: 1040
- Stored DOWNTREND candidateState count: 412
- Derived UPTREND condition count: 52118
- Derived DOWNTREND condition count: 55442
- Final UPTREND count: 0
- Final DOWNTREND count: 0
Conclusion: TREND_CONDITION_NEVER_TRIGGERED is refuted. Trend candidates do occur, but do not survive to final state output.
Primary evidence indicates exhaustion precedence plus hysteresis retention, not absence of trend observations.

## 10. PULLBACK Zero-Coverage Analysis

- Stored PULLBACK candidateState count: 975
- Feature-level potential PULLBACK count: 33174
- Final PULLBACK count: 0
- Candidate → final examples: [
  {
    "key": "PULLBACK→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 890
  },
  {
    "key": "PULLBACK→NEUTRAL",
    "count": 85
  }
]
- Classification: candidate branch exists, but Feature-level potential PULLBACK is broader than the exact classifier branch; final-state retention can replace a candidate with the previous exhaustion/neutral state.

## 11. REBOUND Zero-Coverage Analysis

- Stored REBOUND candidateState count: 73872
- Feature-level potential REBOUND count: 34231
- Final REBOUND count: 0
- Candidate → final examples: [
  {
    "key": "REBOUND→DOWNWARD_EXHAUSTION_CANDIDATE",
    "count": 71405
  },
  {
    "key": "REBOUND→UPWARD_EXHAUSTION_CANDIDATE",
    "count": 2316
  },
  {
    "key": "REBOUND→NEUTRAL",
    "count": 151
  }
]
- Classification: REBOUND candidate branch exists, but previous-state hooks and minimum-dwell hysteresis can retain an exhaustion final state instead of accepting REBOUND.

## 12. State Priority Graph

```text
PREVIOUS_STATE_HOOK
        ↓
EXHAUSTION
        ↓
ACCELERATION
        ↓
TREND
        ↓
DIRECTIONAL_FALLBACK
        ↓
RANGE
        ↓
NEUTRAL
```
Blocked states:
- UPTREND blocked by prior exhaustion/acceleration precedence and subsequent hysteresis retention.
- DOWNTREND blocked by prior exhaustion/acceleration precedence and subsequent hysteresis retention.
- PULLBACK blocked by prior-state hooks, exhaustion/acceleration/trend branches, and hysteresis retention.
- REBOUND blocked by prior-state hooks, exhaustion/acceleration/trend branches, and hysteresis retention.

## 13. State Decision Trace Examples

Each trace includes timestamp, current Feature Snapshot, condition evaluation, candidate state, priority order, overridden states, transition, dwell and final state.
Representative complete traces:
{
  "LOW_LEVEL_EXHAUSTION→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "branch": "DOWNWARD_EXHAUSTION",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": true,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": true,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [
        "DOWNTREND"
      ],
      "overrideReason": "candidate accepted",
      "transition": "CONFIRMATION_REQUIRED",
      "dwell": 1,
      "candidateStateStored": "LOW_LEVEL_EXHAUSTION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-04T09:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:32:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010361943629840775,
      "acceleration": 0.004118464577019698,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.0020746372797806334,
      "featureSnapshot": {
        "timestamp": "2022-01-04T09:32:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.0010361943629840775,
          "priceVsVWAP": -0.0014902507113632169,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0,
          "distanceFromVWAP": -0.0014902507113632169,
          "distanceFromRecentHigh": -0.0061855120744510605,
          "distanceFromRecentLow": 0
        },
        "momentum": {
          "shortMomentum": -0.0010361943629840775,
          "mediumMomentum": -0.0061855120744510605,
          "momentumAcceleration": 0.004118464577019698,
          "momentumDecay": 0.004118464577019698
        },
        "volume": {
          "volumeRatio": 0.7337930532559451,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": true,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": true,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-04T09:32:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-04T09:32:00",
        "symbol": "601899.SH",
        "state": "LOW_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "CONFIRMATION_REQUIRED",
        "reasons": [
          "negative momentum with improving acceleration at low range position"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "LOW_LEVEL_EXHAUSTION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-04T09:32:00",
        "symbol": "601899.SH",
        "type": "POSITIVE_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "low-level stabilization with downside exhaustion candidate"
        ],
        "confirmations": [
          "causal low-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "REBOUND→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": true,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": false,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "REBOUND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-04T09:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:33:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0.0010361943629840775,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0020746372797806334,
      "featureSnapshot": {
        "timestamp": "2022-01-04T09:33:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "FLAT",
          "trendSlope": 0,
          "priceVsVWAP": -0.0012212931455254372,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0,
          "distanceFromVWAP": -0.0012212931455254372,
          "distanceFromRecentHigh": -0.0061855120744510605,
          "distanceFromRecentLow": 0
        },
        "momentum": {
          "shortMomentum": 0,
          "mediumMomentum": -0.0061855120744510605,
          "momentumAcceleration": 0.0010361943629840775,
          "momentumDecay": 0.0010361943629840775
        },
        "volume": {
          "volumeRatio": 0.6616568165481991,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": true
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-04T09:33:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-04T09:33:00",
        "symbol": "601899.SH",
        "state": "LOW_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "LOW_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "low-level exhaustion followed by causal rebound observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "REBOUND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-04T09:33:00",
        "symbol": "601899.SH",
        "type": "POSITIVE_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "low-level stabilization with downside exhaustion candidate"
        ],
        "confirmations": [
          "causal low-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "DOWN_ACCELERATION→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "branch": "DOWN_ACCELERATION",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": true,
        "uptrend": false,
        "downtrend": true,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [
        "DOWNTREND"
      ],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "DOWN_ACCELERATION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-04T09:40:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:40:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.002070342070938369,
      "acceleration": -0.002070342070938369,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0031120053841047213,
      "featureSnapshot": {
        "timestamp": "2022-01-04T09:40:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.002070342070938369,
          "priceVsVWAP": -0.0010097433941963496,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0,
          "distanceFromVWAP": -0.0010097433941963496,
          "distanceFromRecentHigh": -0.0061855120744510605,
          "distanceFromRecentLow": 0
        },
        "momentum": {
          "shortMomentum": -0.002070342070938369,
          "mediumMomentum": 0,
          "momentumAcceleration": -0.002070342070938369,
          "momentumDecay": 0
        },
        "volume": {
          "volumeRatio": 1.394068778587159,
          "volumeExpansion": true,
          "volumeContraction": false,
          "volumeTrend": "EXPANDING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-04T09:40:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-04T09:40:00",
        "symbol": "601899.SH",
        "state": "LOW_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "LOW_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "negative momentum is accelerating"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "DOWN_ACCELERATION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-04T09:40:00",
        "symbol": "601899.SH",
        "type": "POSITIVE_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "low-level stabilization with downside exhaustion candidate"
        ],
        "confirmations": [
          "causal low-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "PULLBACK→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "PULLBACK",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "branch": "PULLBACK_FALLBACK",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": true,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "PULLBACK"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-04T13:50:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:50:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "PULLBACK",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PULLBACK_FALLBACK",
      "trendDirection": "DOWN",
      "velocity": -0.0010235648324754543,
      "acceleration": 0.0010192854399744267,
      "rangePosition": 0.5714305177111717,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0030737430602119087,
      "featureSnapshot": {
        "timestamp": "2022-01-04T13:50:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.0010235648324754543,
          "priceVsVWAP": 0.007809133895473108,
          "priceVsEMA": 0.0014469994907957417,
          "priceVsVWMA": 0.0005351505631465692
        },
        "position": {
          "rangePosition": 0.5714305177111717,
          "distanceFromVWAP": 0.007809133895473108,
          "distanceFromRecentHigh": -0.0030643241152283895,
          "distanceFromRecentLow": 0.004115222299809096
        },
        "momentum": {
          "shortMomentum": -0.0010235648324754543,
          "mediumMomentum": 0.0010256645007011844,
          "momentumAcceleration": 0.0010192854399744267,
          "momentumDecay": 0.0010192854399744267
        },
        "volume": {
          "volumeRatio": 0.8517354225002092,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0.009366879033691286,
          "ATRRatio": 0.0009597211899619404,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 2.2229146828685415
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": true,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-04T13:50:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-04T13:50:00",
        "symbol": "601899.SH",
        "state": "LOW_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "LOW_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "negative momentum after upper-range observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "PULLBACK"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-04T13:50:00",
        "symbol": "601899.SH",
        "type": "POSITIVE_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "low-level stabilization with downside exhaustion candidate"
        ],
        "confirmations": [
          "causal low-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "NO_T_ENVIRONMENT→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "NO_T_ENVIRONMENT",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "NO_T_ENVIRONMENT",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": false,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "candidate accepted",
      "transition": "HOLD",
      "dwell": 2,
      "candidateStateStored": "NO_T_ENVIRONMENT"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-05T09:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-05T09:32:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "NO_T_ENVIRONMENT",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HOLD",
      "branch": "NO_T_ENVIRONMENT",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": -0.00204076568368472,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004073315997566662,
      "featureSnapshot": {
        "timestamp": "2022-01-05T09:32:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "FLAT",
          "trendSlope": 0,
          "priceVsVWAP": 0.00034896375149484626,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 1,
          "distanceFromVWAP": 0.00034896375149484626,
          "distanceFromRecentHigh": 0,
          "distanceFromRecentLow": 0.00204076568368472
        },
        "momentum": {
          "shortMomentum": 0,
          "mediumMomentum": 0.00204076568368472,
          "momentumAcceleration": -0.00204076568368472,
          "momentumDecay": 0.00204076568368472
        },
        "volume": {
          "volumeRatio": 0.632429021875091,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": true
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-05T09:32:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-05T09:32:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HOLD",
        "reasons": [
          "no multi-dimensional T structure candidate"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": true,
        "dwell": 2,
        "candidateState": "NO_T_ENVIRONMENT"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-05T09:32:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "DOWN_ACCELERATION→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "DOWN_ACCELERATION",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": true,
        "uptrend": false,
        "downtrend": true,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [
        "DOWNTREND"
      ],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "DOWN_ACCELERATION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-05T09:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-05T09:33:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.00203660944102646,
      "acceleration": -0.00203660944102646,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.003061197182379072,
      "featureSnapshot": {
        "timestamp": "2022-01-05T09:33:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.00203660944102646,
          "priceVsVWAP": -0.00130249580254993,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0,
          "distanceFromVWAP": -0.00130249580254993,
          "distanceFromRecentHigh": -0.00203660944102646,
          "distanceFromRecentLow": 0
        },
        "momentum": {
          "shortMomentum": -0.00203660944102646,
          "mediumMomentum": 0,
          "momentumAcceleration": -0.00203660944102646,
          "momentumDecay": 0
        },
        "volume": {
          "volumeRatio": 0.8902443164810602,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-05T09:33:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-05T09:33:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "negative momentum is accelerating"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "DOWN_ACCELERATION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-05T09:33:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "UP_ACCELERATION→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "UP_ACCELERATION",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "UP_ACCELERATION",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": true,
        "downwardAcceleration": false,
        "uptrend": true,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [
        "UPTREND"
      ],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "UP_ACCELERATION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-06T09:34:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:34:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "UP_ACCELERATION",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UP_ACCELERATION",
      "trendDirection": "UP",
      "velocity": 0.002057562092585119,
      "acceleration": 0.002057562092585119,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0030801527053900823,
      "featureSnapshot": {
        "timestamp": "2022-01-06T09:34:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.002057562092585119,
          "priceVsVWAP": 0.0019012161550380213,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 1,
          "distanceFromVWAP": 0.0019012161550380213,
          "distanceFromRecentHigh": 0,
          "distanceFromRecentLow": 0.003089570839684308
        },
        "momentum": {
          "shortMomentum": 0.002057562092585119,
          "mediumMomentum": 0.003089570839684308,
          "momentumAcceleration": 0.002057562092585119,
          "momentumDecay": 0
        },
        "volume": {
          "volumeRatio": 0.6760967763909039,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": true,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-06T09:34:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-06T09:34:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "positive momentum is accelerating"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "UP_ACCELERATION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-06T09:34:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "HIGH_LEVEL_EXHAUSTION→UPWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "branch": "UPWARD_EXHAUSTION",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": true,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": true,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [
        "UPTREND"
      ],
      "overrideReason": "candidate accepted",
      "transition": "CONFIRMATION_REQUIRED",
      "dwell": 1,
      "candidateStateStored": "HIGH_LEVEL_EXHAUSTION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-06T09:37:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:37:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.002051329001402147,
      "acceleration": -0.000004216600306694573,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.003070694497426363,
      "featureSnapshot": {
        "timestamp": "2022-01-06T09:37:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.002051329001402147,
          "priceVsVWAP": 0.004160445321137463,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 1,
          "distanceFromVWAP": 0.004160445321137463,
          "distanceFromRecentHigh": 0,
          "distanceFromRecentLow": 0.0061792398950546445
        },
        "momentum": {
          "shortMomentum": 0.002051329001402147,
          "mediumMomentum": 0.005144052403421195,
          "momentumAcceleration": -0.000004216600306694573,
          "momentumDecay": 0.000004216600306694573
        },
        "volume": {
          "volumeRatio": 0.8275215753095045,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": true,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": true,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-06T09:37:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-06T09:37:00",
        "symbol": "601899.SH",
        "state": "HIGH_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "CONFIRMATION_REQUIRED",
        "reasons": [
          "positive momentum with negative acceleration at high range position"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "HIGH_LEVEL_EXHAUSTION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-06T09:37:00",
        "symbol": "601899.SH",
        "type": "COUNTER_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "high-level extension with momentum decay candidate"
        ],
        "confirmations": [
          "causal high-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "WAIT_CONFIRMATION→UPWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "WAIT_CONFIRMATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": true,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": true,
        "uptrend": false,
        "downtrend": false,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": true,
        "range": false
      },
      "overriddenStates": [
        "PULLBACK"
      ],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "WAIT_CONFIRMATION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-06T09:39:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:39:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "WAIT_CONFIRMATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
      "trendDirection": "DOWN",
      "velocity": -0.0010224208057807438,
      "acceleration": -0.002045888025741238,
      "rangePosition": 0.8571525885558583,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004094259329901817,
      "featureSnapshot": {
        "timestamp": "2022-01-06T09:39:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.0010224208057807438,
          "priceVsVWAP": 0.002933830799844772,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.8571525885558583,
          "distanceFromVWAP": 0.002933830799844772,
          "distanceFromRecentHigh": -0.0010224208057807438,
          "distanceFromRecentLow": 0.0061792398950546445
        },
        "momentum": {
          "shortMomentum": -0.0010224208057807438,
          "mediumMomentum": 0.0030801527053900823,
          "momentumAcceleration": -0.002045888025741238,
          "momentumDecay": 0.0000010464141797505988
        },
        "volume": {
          "volumeRatio": 0.41861003172055666,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-06T09:39:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-06T09:39:00",
        "symbol": "601899.SH",
        "state": "HIGH_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "HIGH_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "high-level exhaustion followed by causal pullback observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "WAIT_CONFIRMATION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-06T09:39:00",
        "symbol": "601899.SH",
        "type": "COUNTER_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "high-level extension with momentum decay candidate"
        ],
        "confirmations": [
          "causal high-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "UP_ACCELERATION→UPWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UP_ACCELERATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "branch": "UP_ACCELERATION",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": true,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": true,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [
        "REBOUND"
      ],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "UP_ACCELERATION"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-06T09:48:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:48:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UP_ACCELERATION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UP_ACCELERATION",
      "trendDirection": "UP",
      "velocity": 0.0010287319889730195,
      "acceleration": 0.0010287319889730195,
      "rangePosition": 0.285708446866485,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0,
      "featureSnapshot": {
        "timestamp": "2022-01-06T09:48:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.0010287319889730195,
          "priceVsVWAP": -0.0007762800913249102,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.285708446866485,
          "distanceFromVWAP": -0.0007762800913249102,
          "distanceFromRecentHigh": -0.005112494079759333,
          "distanceFromRecentLow": 0.0020596811545607885
        },
        "momentum": {
          "shortMomentum": 0.0010287319889730195,
          "mediumMomentum": 0,
          "momentumAcceleration": 0.0010287319889730195,
          "momentumDecay": 0
        },
        "volume": {
          "volumeRatio": 0.8456825768887766,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0.008189721857788403,
          "ATRRatio": 0.0008416980722597331,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-06T09:48:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-06T09:48:00",
        "symbol": "601899.SH",
        "state": "HIGH_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "HIGH_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "positive momentum is accelerating"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "UP_ACCELERATION"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-06T09:48:00",
        "symbol": "601899.SH",
        "type": "COUNTER_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "high-level extension with momentum decay candidate"
        ],
        "confirmations": [
          "causal high-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "UPTREND→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "UPTREND",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "UPTREND",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": true,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "UPTREND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-07T09:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-07T09:33:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "UPTREND",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0010384453544127759,
      "acceleration": -0.0000010794897451482655,
      "rangePosition": 0.6666878596178911,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010372691754565455,
      "featureSnapshot": {
        "timestamp": "2022-01-07T09:33:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.0010384453544127759,
          "priceVsVWAP": 0.0011030784776611124,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.6666878596178911,
          "distanceFromVWAP": 0.0011030784776611124,
          "distanceFromRecentHigh": -0.0010361943629840775,
          "distanceFromRecentLow": 0.0020790496883160703
        },
        "momentum": {
          "shortMomentum": 0.0010384453544127759,
          "mediumMomentum": -0.0010361943629840775,
          "momentumAcceleration": -0.0000010794897451482655,
          "momentumDecay": 0.0000010794897451482655
        },
        "volume": {
          "volumeRatio": 0.5247457872349465,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-07T09:33:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-07T09:33:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "positive causal momentum and upper-range location"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "UPTREND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-07T09:33:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "RANGE→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "RANGE",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "RANGE",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": false,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": true
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "RANGE"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-10T09:41:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T09:41:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "RANGE",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "RANGE",
      "trendDirection": "FLAT",
      "velocity": 0,
      "acceleration": 0.0010672602992501945,
      "rangePosition": 0.6666613685130732,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.004273500354724069,
      "featureSnapshot": {
        "timestamp": "2022-01-10T09:41:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "FLAT",
          "trendSlope": 0,
          "priceVsVWAP": 0.0007980208404505529,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.6666613685130732,
          "distanceFromVWAP": 0.0007980208404505529,
          "distanceFromRecentHigh": -0.0021322449381295794,
          "distanceFromRecentLow": 0.0042918415410722055
        },
        "momentum": {
          "shortMomentum": 0,
          "mediumMomentum": -0.0010672602992501945,
          "momentumAcceleration": 0.0010672602992501945,
          "momentumDecay": 0.0010672602992501945
        },
        "volume": {
          "volumeRatio": 1.895823206960751,
          "volumeExpansion": true,
          "volumeContraction": false,
          "volumeTrend": "EXPANDING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": true
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-10T09:41:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-10T09:41:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "causal consolidation with volume observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "RANGE"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-10T09:41:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "REBOUND→UPWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "branch": "REBOUND_FALLBACK",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": true,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "REBOUND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-10T10:10:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T10:10:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "REBOUND_FALLBACK",
      "trendDirection": "UP",
      "velocity": 0.0010672602992500835,
      "acceleration": -0.0000011402615023303753,
      "rangePosition": 0.5000119209403238,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0021322449381295794,
      "featureSnapshot": {
        "timestamp": "2022-01-10T10:10:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.0010672602992500835,
          "priceVsVWAP": 0.0009789164250399995,
          "priceVsEMA": 0.0003227427059786514,
          "priceVsVWMA": 0.0002296768180714004
        },
        "position": {
          "rangePosition": 0.5000119209403238,
          "distanceFromVWAP": 0.0009789164250399995,
          "distanceFromRecentHigh": -0.0021276069043588697,
          "distanceFromRecentLow": 0.0021368011215048277
        },
        "momentum": {
          "shortMomentum": 0.0010672602992500835,
          "mediumMomentum": 0,
          "momentumAcceleration": -0.0000011402615023303753,
          "momentumDecay": 0.0000011402615023303753
        },
        "volume": {
          "volumeRatio": 0.4289094075510137,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0.009078340478007664,
          "ATRRatio": 0.0009678401244399949,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 2.1820054267888715
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-10T10:10:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-10T10:10:00",
        "symbol": "601899.SH",
        "state": "HIGH_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "HIGH_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "positive momentum after lower-range observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "REBOUND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-10T10:10:00",
        "symbol": "601899.SH",
        "type": "COUNTER_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "high-level extension with momentum decay candidate"
        ],
        "confirmations": [
          "causal high-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "UPTREND→UPWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "branch": "UPTREND",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": true,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "UPTREND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-10T10:23:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T10:23:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0010684005607524139,
      "acceleration": -0.0000010405942807434343,
      "rangePosition": 0.6666560701910544,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0,
      "featureSnapshot": {
        "timestamp": "2022-01-10T10:23:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.0010684005607524139,
          "priceVsVWAP": 0.000024083306258138037,
          "priceVsEMA": 0.0004252426459188108,
          "priceVsVWMA": 0.00024958758785431634
        },
        "position": {
          "rangePosition": 0.6666560701910544,
          "distanceFromVWAP": 0.000024083306258138037,
          "distanceFromRecentHigh": -0.0010661224690647897,
          "distanceFromRecentLow": 0.0021389843073151837
        },
        "momentum": {
          "shortMomentum": 0.0010684005607524139,
          "mediumMomentum": 0.0021389843073151837,
          "momentumAcceleration": -0.0000010405942807434343,
          "momentumDecay": 0.0000010405942807434343
        },
        "volume": {
          "volumeRatio": 1.0873744951696966,
          "volumeExpansion": true,
          "volumeContraction": false,
          "volumeTrend": "EXPANDING"
        },
        "volatility": {
          "ATR": 0.009252754507255653,
          "ATRRatio": 0.0009874871526429658,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 2.225350524394266
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": true,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-10T10:23:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-10T10:23:00",
        "symbol": "601899.SH",
        "state": "HIGH_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "HIGH_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "positive causal momentum and upper-range location"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "UPTREND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-10T10:23:00",
        "symbol": "601899.SH",
        "type": "COUNTER_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "high-level extension with momentum decay candidate"
        ],
        "confirmations": [
          "causal high-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "DOWNTREND→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "trace": {
      "valid": true,
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "branch": "DOWNTREND",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": true,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change; exhaustion final state remained above later candidate",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "DOWNTREND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-11T09:38:00:1.0.0:1.0.0",
      "timestamp": "2022-01-11T09:38:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.001062723596598758,
      "acceleration": 0.0010582156522255248,
      "rangePosition": 0.3999885559518587,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0,
      "featureSnapshot": {
        "timestamp": "2022-01-11T09:38:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.001062723596598758,
          "priceVsVWAP": -0.0001488475660605948,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.3999885559518587,
          "distanceFromVWAP": -0.0001488475660605948,
          "distanceFromRecentHigh": -0.003181408873236369,
          "distanceFromRecentLow": 0.002132143267095099
        },
        "momentum": {
          "shortMomentum": -0.001062723596598758,
          "mediumMomentum": 0.002132143267095099,
          "momentumAcceleration": 0.0010582156522255248,
          "momentumDecay": 0.0010582156522255248
        },
        "volume": {
          "volumeRatio": 0.6647965610429591,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": false
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-11T09:38:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-11T09:38:00",
        "symbol": "601899.SH",
        "state": "LOW_LEVEL_EXHAUSTION",
        "validity": "STATE_VALID",
        "previousState": "LOW_LEVEL_EXHAUSTION",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "negative causal momentum and lower-range location"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "DOWNTREND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-11T09:38:00",
        "symbol": "601899.SH",
        "type": "POSITIVE_T_ENVIRONMENT",
        "score": 60,
        "reasons": [
          "low-level stabilization with downside exhaustion candidate"
        ],
        "confirmations": [
          "causal low-level exhaustion structure"
        ],
        "missingConfirmations": [],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "PULLBACK→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "PULLBACK",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "PULLBACK_FALLBACK",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": true,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "PULLBACK"
    },
    "sample": {
      "sampleId": "601899.SH:2022-01-24T09:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-24T09:33:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "PULLBACK",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PULLBACK_FALLBACK",
      "trendDirection": "DOWN",
      "velocity": -0.0009784959511300872,
      "acceleration": 0.0009745806637506682,
      "rangePosition": 0.7272743035988313,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004897178310289019,
      "featureSnapshot": {
        "timestamp": "2022-01-24T09:33:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.0009784959511300872,
          "priceVsVWAP": -0.0006023327729773875,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.7272743035988313,
          "distanceFromVWAP": -0.0006023327729773875,
          "distanceFromRecentHigh": -0.002929661488450974,
          "distanceFromRecentLow": 0.007897327028852708
        },
        "momentum": {
          "shortMomentum": -0.0009784959511300872,
          "mediumMomentum": 0.007897327028852708,
          "momentumAcceleration": 0.0009745806637506682,
          "momentumDecay": 0.0009745806637506682
        },
        "volume": {
          "volumeRatio": 0.9285511899378338,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": true
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-01-24T09:33:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-01-24T09:33:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "negative momentum after upper-range observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "PULLBACK"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-01-24T09:33:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "REBOUND→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "REBOUND",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "REBOUND_FALLBACK",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": false,
        "rebound": true,
        "pullback": false,
        "potentialRebound": true,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "REBOUND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-02-18T09:38:00:1.0.0:1.0.0",
      "timestamp": "2022-02-18T09:38:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "REBOUND",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "REBOUND_FALLBACK",
      "trendDirection": "UP",
      "velocity": 0.0008904923677177656,
      "acceleration": -0.0008935847082232051,
      "rangePosition": 0.23076697355390088,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004448415636390091,
      "featureSnapshot": {
        "timestamp": "2022-02-18T09:38:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "UP",
          "trendSlope": 0.0008904923677177656,
          "priceVsVWAP": -0.0012699043902895113,
          "priceVsEMA": null,
          "priceVsVWMA": null
        },
        "position": {
          "rangePosition": 0.23076697355390088,
          "distanceFromVWAP": -0.0012699043902895113,
          "distanceFromRecentHigh": -0.008818375672323575,
          "distanceFromRecentLow": 0.0026761581506782317
        },
        "momentum": {
          "shortMomentum": 0.0008904923677177656,
          "mediumMomentum": -0.002661995157670183,
          "momentumAcceleration": -0.0008935847082232051,
          "momentumDecay": 0.0008935847082232051
        },
        "volume": {
          "volumeRatio": 0.4335786887170323,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0,
          "ATRRatio": 0,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 0
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": false,
          "lowerLow": false,
          "consolidationCandidate": true
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-02-18T09:38:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-02-18T09:38:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "positive momentum after lower-range observation"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "REBOUND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-02-18T09:38:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  },
  "DOWNTREND→NEUTRAL": {
    "trace": {
      "valid": true,
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "DOWNTREND",
      "actualState": "NO_T_ENVIRONMENT",
      "branch": "DOWNTREND",
      "priorityOrder": [
        "PREVIOUS_STATE_HOOK",
        "EXHAUSTION",
        "ACCELERATION",
        "TREND",
        "DIRECTIONAL_FALLBACK",
        "RANGE",
        "NEUTRAL"
      ],
      "conditions": {
        "previousHighExhaustionPullback": false,
        "previousHighConfirmation": false,
        "previousLowExhaustionRebound": false,
        "previousReboundConfirmation": false,
        "previousLowConfirmation": false,
        "upwardExhaustion": false,
        "downwardExhaustion": false,
        "upwardAcceleration": false,
        "downwardAcceleration": false,
        "uptrend": false,
        "downtrend": true,
        "rebound": false,
        "pullback": true,
        "potentialRebound": false,
        "potentialPullback": false,
        "range": false
      },
      "overriddenStates": [],
      "overrideReason": "minimumDwell=2 retained previous final state on first candidate change",
      "transition": "HYSTERESIS_HOLD",
      "dwell": 1,
      "candidateStateStored": "DOWNTREND"
    },
    "sample": {
      "sampleId": "601899.SH:2022-05-24T09:51:00:1.0.0:1.0.0",
      "timestamp": "2022-05-24T09:51:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "DOWNTREND",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.000992976714056848,
      "acceleration": 0.0019773881881612887,
      "rangePosition": 0.3333333333333333,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0009940584954982734,
      "featureSnapshot": {
        "timestamp": "2022-05-24T09:51:00",
        "symbol": "601899.SH",
        "timeframe": "1m",
        "valid": true,
        "validity": "VALID",
        "reason": null,
        "researchOnly": true,
        "rlEligible": false,
        "trend": {
          "trendDirection": "DOWN",
          "trendSlope": -0.000992976714056848,
          "priceVsVWAP": -0.0022424465361106094,
          "priceVsEMA": -0.0009797398590176698,
          "priceVsVWMA": -0.002853435345808175
        },
        "position": {
          "rangePosition": 0.3333333333333333,
          "distanceFromVWAP": -0.0022424465361106094,
          "distanceFromRecentHigh": -0.007889538559901044,
          "distanceFromRecentLow": 0.0039920119786056585
        },
        "momentum": {
          "shortMomentum": -0.000992976714056848,
          "mediumMomentum": -0.007889538559901044,
          "momentumAcceleration": 0.0019773881881612887,
          "momentumDecay": 0.0019773881881612887
        },
        "volume": {
          "volumeRatio": 0.6427807939963502,
          "volumeExpansion": false,
          "volumeContraction": true,
          "volumeTrend": "CONTRACTING"
        },
        "volatility": {
          "ATR": 0.02181912963398819,
          "ATRRatio": 0.0021688994755349653,
          "volatilityExpansion": true,
          "volatilityContraction": false,
          "historicalVolatility": 6.045344299474592
        },
        "structure": {
          "higherHigh": false,
          "lowerHigh": false,
          "higherLow": true,
          "lowerLow": false,
          "consolidationCandidate": true
        },
        "exhaustion": {
          "upwardExhaustionCandidate": false,
          "downwardExhaustionCandidate": false,
          "classification": "STRUCTURAL_CANDIDATE"
        },
        "dependencies": {
          "coreSafe": [
            "price",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "VWAP",
            "EMA",
            "VWMA",
            "RSI",
            "ATR",
            "MFI",
            "HISTORICAL_VOLATILITY"
          ],
          "source": {
            "marketData": [
              "timestamp",
              "open",
              "high",
              "low",
              "close/price",
              "volume"
            ],
            "indicators": [
              "VWAP_SESSION",
              "EMA_20",
              "VWMA_20",
              "RSI_14",
              "ATR_14",
              "MFI_14",
              "HISTORICAL_VOLATILITY_20"
            ]
          },
          "temporal": {
            "lookahead": false,
            "futureData": false
          }
        },
        "dataQuality": {
          "status": "VALID",
          "reasons": [],
          "observedThrough": "2022-05-24T09:51:00"
        }
      },
      "stateSnapshot": {
        "timestamp": "2022-05-24T09:51:00",
        "symbol": "601899.SH",
        "state": "NO_T_ENVIRONMENT",
        "validity": "STATE_VALID",
        "previousState": "NO_T_ENVIRONMENT",
        "transition": "HYSTERESIS_HOLD",
        "reasons": [
          "negative causal momentum and lower-range location"
        ],
        "missingDependencies": [],
        "researchOnly": true,
        "rlEligible": false,
        "confirmed": false,
        "dwell": 1,
        "candidateState": "DOWNTREND"
      },
      "opportunitySnapshot": {
        "timestamp": "2022-05-24T09:51:00",
        "symbol": "601899.SH",
        "type": "NEUTRAL",
        "score": 0,
        "reasons": [],
        "confirmations": [],
        "missingConfirmations": [
          "directional T structure"
        ],
        "invalidations": [
          "feature invalidation",
          "opposite acceleration"
        ],
        "valid": true,
        "scoreMeaning": "T_STRUCTURE_STRENGTH_ONLY",
        "researchOnly": true,
        "rlEligible": false
      }
    }
  }
}

Compact candidate examples:
{
  "uptrendCandidate": [
    {
      "sampleId": "601899.SH:2022-01-07T09:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-07T09:33:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "UPTREND",
      "actualState": "NO_T_ENVIRONMENT",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0010384453544127759,
      "acceleration": -0.0000010794897451482655,
      "rangePosition": 0.6666878596178911,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010372691754565455
    },
    {
      "sampleId": "601899.SH:2022-01-10T10:23:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T10:23:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0010684005607524139,
      "acceleration": -0.0000010405942807434343,
      "rangePosition": 0.6666560701910544,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-10T10:50:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T10:50:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.001062723596598758,
      "acceleration": -0.0000011305829399343992,
      "rangePosition": 0.6666666666666666,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010615954141022232
    },
    {
      "sampleId": "601899.SH:2022-01-10T11:06:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T11:06:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0010648854996719859,
      "acceleration": -0.000001236969392914844,
      "rangePosition": 0.5999923706345724,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0021276069043588697
    },
    {
      "sampleId": "601899.SH:2022-01-12T10:20:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T10:20:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.001020431498694352,
      "acceleration": -0.00000104234408415671,
      "rangePosition": 0.6250029802350809,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010192940652198335
    },
    {
      "sampleId": "601899.SH:2022-01-12T10:45:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T10:45:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0010192940652198335,
      "acceleration": -0.0010236536203371838,
      "rangePosition": 0.5999923706345724,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-13T13:05:00:1.0.0:1.0.0",
      "timestamp": "2022-01-13T13:05:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009881649204468435,
      "acceleration": -9.774357778713494e-7,
      "rangePosition": 0.6666666666666666,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0029614740999286404
    },
    {
      "sampleId": "601899.SH:2022-01-13T13:23:00:1.0.0:1.0.0",
      "timestamp": "2022-01-13T13:23:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.001976329840893687,
      "acceleration": -0.000003819004055660713,
      "rangePosition": 0.6666719649044728,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0029586474980016764
    },
    {
      "sampleId": "601899.SH:2022-01-13T13:53:00:1.0.0:1.0.0",
      "timestamp": "2022-01-13T13:53:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009911029465416998,
      "acceleration": -9.832595619929663e-7,
      "rangePosition": 0.6000114440481413,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-13T14:12:00:1.0.0:1.0.0",
      "timestamp": "2022-01-13T14:12:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009930714185597544,
      "acceleration": -8.922783025777647e-7,
      "rangePosition": 0.5999923706345724,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0009920862061038038
    },
    {
      "sampleId": "601899.SH:2022-01-20T10:54:00:1.0.0:1.0.0",
      "timestamp": "2022-01-20T10:54:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009911029465416998,
      "acceleration": -9.832595619929663e-7,
      "rangePosition": 0.6000114440481413,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-26T10:03:00:1.0.0:1.0.0",
      "timestamp": "2022-01-26T10:03:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0019723376146161264,
      "acceleration": -0.000995089454057796,
      "rangePosition": 0.6250029802350809,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0029527296674942693
    },
    {
      "sampleId": "601899.SH:2022-01-26T14:34:00:1.0.0:1.0.0",
      "timestamp": "2022-01-26T14:34:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.000983306667336814,
      "acceleration": -9.678436891924491e-7,
      "rangePosition": 0.5714305177111717,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0009822470439844189
    },
    {
      "sampleId": "601899.SH:2022-02-07T10:09:00:1.0.0:1.0.0",
      "timestamp": "2022-02-07T10:09:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009881649204468435,
      "acceleration": -9.774357778713494e-7,
      "rangePosition": 0.666670198787776,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-02-07T10:32:00:1.0.0:1.0.0",
      "timestamp": "2022-02-07T10:32:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009852442618401014,
      "acceleration": -8.77520108799601e-7,
      "rangePosition": 0.6666613685130732,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0009842745110260065
    },
    {
      "sampleId": "601899.SH:2022-02-07T14:35:00:1.0.0:1.0.0",
      "timestamp": "2022-02-07T14:35:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0009804146145917514,
      "acceleration": -9.621561283257307e-7,
      "rangePosition": 0.6666666666666666,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0009794543432393166
    },
    {
      "sampleId": "601899.SH:2022-02-09T10:22:00:1.0.0:1.0.0",
      "timestamp": "2022-02-09T10:22:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0018656253349980112,
      "acceleration": -0.0000035763584780301727,
      "rangePosition": 0.6666596024244479,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0009311200274628728
    },
    {
      "sampleId": "601899.SH:2022-02-10T10:02:00:1.0.0:1.0.0",
      "timestamp": "2022-02-10T10:02:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0008872470986132086,
      "acceleration": -0.0008905713692688444,
      "rangePosition": 0.6666645473850183,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.004432641127527059
    },
    {
      "sampleId": "601899.SH:2022-02-10T13:37:00:1.0.0:1.0.0",
      "timestamp": "2022-02-10T13:37:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0017904658865490752,
      "acceleration": -0.0000032972029520017543,
      "rangePosition": 0.6666613685130732,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.002680941384822111
    },
    {
      "sampleId": "601899.SH:2022-02-14T09:39:00:1.0.0:1.0.0",
      "timestamp": "2022-02-14T09:39:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "UPTREND",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "UPTREND",
      "trendDirection": "UP",
      "velocity": 0.0008976009783978611,
      "acceleration": -0.0009010013569892283,
      "rangePosition": 0.6428542234332425,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0017936775581693931
    }
  ],
  "downtrendCandidate": [
    {
      "sampleId": "601899.SH:2022-01-11T09:38:00:1.0.0:1.0.0",
      "timestamp": "2022-01-11T09:38:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.001062723596598758,
      "acceleration": 0.0010582156522255248,
      "rangePosition": 0.3999885559518587,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-19T09:55:00:1.0.0:1.0.0",
      "timestamp": "2022-01-19T09:55:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.001010027837658023,
      "acceleration": 0.0010061473246252284,
      "rangePosition": 0.3333333333333333,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0020221944787754964
    },
    {
      "sampleId": "601899.SH:2022-01-28T10:03:00:1.0.0:1.0.0",
      "timestamp": "2022-01-28T10:03:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0010235648324754543,
      "acceleration": 0.0010192854399744267,
      "rangePosition": 0.36363715179941564,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.005122970242039782
    },
    {
      "sampleId": "601899.SH:2022-01-28T10:06:00:1.0.0:1.0.0",
      "timestamp": "2022-01-28T10:06:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.001024613590913992,
      "acceleration": 0.0010203255333613992,
      "rangePosition": 0.37499701976491906,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.005128224690755245
    },
    {
      "sampleId": "601899.SH:2022-01-28T11:06:00:1.0.0:1.0.0",
      "timestamp": "2022-01-28T11:06:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0010193912797229476,
      "acceleration": 0.0010151462833063452,
      "rangePosition": 0.41666865349005394,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.00204076568368472
    },
    {
      "sampleId": "601899.SH:2022-02-18T09:57:00:1.0.0:1.0.0",
      "timestamp": "2022-02-18T09:57:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0008960778690472182,
      "acceleration": 0.0008928717926457441,
      "rangePosition": 0.3076917433884752,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0026905591029200426
    },
    {
      "sampleId": "601899.SH:2022-02-22T09:55:00:1.0.0:1.0.0",
      "timestamp": "2022-02-22T09:55:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0017920702834053337,
      "acceleration": 0.0035555605712049854,
      "rangePosition": 0.4444456218243855,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0017953731730053768
    },
    {
      "sampleId": "601899.SH:2022-03-07T13:32:00:1.0.0:1.0.0",
      "timestamp": "2022-03-07T13:32:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0008446139149458354,
      "acceleration": 0.0008416849609648169,
      "rangePosition": 0.39999618524452585,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-03-11T13:30:00:1.0.0:1.0.0",
      "timestamp": "2022-03-11T13:30:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0009311200274629838,
      "acceleration": 0.0009276585355696421,
      "rangePosition": 0.38460917727322746,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.010251688261361913
    },
    {
      "sampleId": "601899.SH:2022-03-16T10:45:00:1.0.0:1.0.0",
      "timestamp": "2022-03-16T10:45:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.002081113923397382,
      "acceleration": 0.0010309903895747707,
      "rangePosition": 0.3333333333333333,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.005213784143827116
    },
    {
      "sampleId": "601899.SH:2022-03-18T10:50:00:1.0.0:1.0.0",
      "timestamp": "2022-03-18T10:50:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0009680763751882537,
      "acceleration": 0.0009643349317214334,
      "rangePosition": 0.36363399916770706,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0019379365000743443
    },
    {
      "sampleId": "601899.SH:2022-03-21T13:14:00:1.0.0:1.0.0",
      "timestamp": "2022-03-21T13:14:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0009233821747262061,
      "acceleration": 0.0009199779230144589,
      "rangePosition": 0.44444326707074133,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.007393708499300877
    },
    {
      "sampleId": "601899.SH:2022-03-23T09:38:00:1.0.0:1.0.0",
      "timestamp": "2022-03-23T09:38:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0026432322147308396,
      "acceleration": 0.0008686168324447685,
      "rangePosition": 0.3333333333333333,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-03-28T09:42:00:1.0.0:1.0.0",
      "timestamp": "2022-03-28T09:42:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.001749821279936059,
      "acceleration": 0.0008679564575273524,
      "rangePosition": 0.33333181956485214,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.006134942660853349
    },
    {
      "sampleId": "601899.SH:2022-04-01T10:34:00:1.0.0:1.0.0",
      "timestamp": "2022-04-01T10:34:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0017452406367448603,
      "acceleration": 0.001733016915692276,
      "rangePosition": 0.3999980926586431,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-04-12T10:53:00:1.0.0:1.0.0",
      "timestamp": "2022-04-12T10:53:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.000862088668359906,
      "acceleration": 0.0008590390671240344,
      "rangePosition": 0.40000762936542755,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.003451247741709018
    },
    {
      "sampleId": "601899.SH:2022-04-12T11:06:00:1.0.0:1.0.0",
      "timestamp": "2022-04-12T11:06:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0017152233577253373,
      "acceleration": 0.0034042662540193502,
      "rangePosition": 0.38461651322304957,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0034364227382495116
    },
    {
      "sampleId": "601899.SH:2022-04-14T13:38:00:1.0.0:1.0.0",
      "timestamp": "2022-04-14T13:38:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0007788340158095819,
      "acceleration": 0.0007763374167939485,
      "rangePosition": 0.36363715179941564,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0031176899525243718
    },
    {
      "sampleId": "601899.SH:2022-04-18T09:42:00:1.0.0:1.0.0",
      "timestamp": "2022-04-18T09:42:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0008311949650434691,
      "acceleration": 0.0008285940347152465,
      "rangePosition": 0.4230788981403367,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0024958179557983406
    },
    {
      "sampleId": "601899.SH:2022-04-18T09:55:00:1.0.0:1.0.0",
      "timestamp": "2022-04-18T09:55:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWNTREND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWNTREND",
      "trendDirection": "DOWN",
      "velocity": -0.0008333524068196985,
      "acceleration": 0.0008305791241274285,
      "rangePosition": 0.44444326707074133,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.005004205234534709
    }
  ],
  "potentialPullback": [
    {
      "sampleId": "601899.SH:2022-01-04T09:44:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:44:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001033081463488017,
      "acceleration": -0.001033081463488017,
      "rangePosition": 0.5,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0031023508515513054
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:52:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:52:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010288301036119885,
      "acceleration": -0.002058719788735508,
      "rangePosition": 0.8749970197649191,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.002059779370246928
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:54:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:54:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.002059779370246928,
      "acceleration": -0.002059779370246928,
      "rangePosition": 0.6249910592947572,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0020639323999397385
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:57:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:57:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001030951451389095,
      "acceleration": -0.001030951451389095,
      "rangePosition": 0.6249910592947572,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0020639323999397385
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:58:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:58:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001031916990766657,
      "acceleration": -9.655393775620524e-7,
      "rangePosition": 0.5,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.001033081463488017
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:26:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:26:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010341498245022285,
      "acceleration": -0.0020693702219968246,
      "rangePosition": 0.6666560701910544,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010352203974945962
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:22:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:22:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010352203974945962,
      "acceleration": -0.0010352203974945962,
      "rangePosition": 0.49997615755090363,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0031088795680260795
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:26:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:26:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001031916990766657,
      "acceleration": -0.002064899934183906,
      "rangePosition": 0.8000114442664226,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:29:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:29:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001031916990766657,
      "acceleration": -0.002064899934183906,
      "rangePosition": 0.8000114442664226,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:30:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:30:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001033081463488017,
      "acceleration": -0.0000011644727213599992,
      "rangePosition": 0.6000038147554742,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:05:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:05:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001033081463488017,
      "acceleration": -0.001033081463488017,
      "rangePosition": 0.6000038147554742,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.004136500676053423
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:09:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:09:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010276747870453518,
      "acceleration": -0.0020564067760183713,
      "rangePosition": 0.8750089407052428,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010288301036119885
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:10:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:10:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010288301036119885,
      "acceleration": -0.0000011553165666366993,
      "rangePosition": 0.7500059604701619,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:12:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:12:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010288301036119885,
      "acceleration": -0.002058719788735508,
      "rangePosition": 0.6666719649044728,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010298896851235195
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:19:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:19:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010288301036119885,
      "acceleration": -0.0010288301036119885,
      "rangePosition": 0.6666719649044728,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010298896851235195
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:26:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:26:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010276747870453518,
      "acceleration": -0.0020564067760183713,
      "rangePosition": 0.5000238424490964,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:29:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:29:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010276747870453518,
      "acceleration": -0.0020564067760183713,
      "rangePosition": 0.5000238424490964,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:36:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:36:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010276747870453518,
      "acceleration": -0.0020564067760183713,
      "rangePosition": 0.5000238424490964,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:41:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:41:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.0010276747870453518,
      "acceleration": -0.0010276747870453518,
      "rangePosition": 0.5000238424490964,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.005144052403421195
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:45:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:45:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "DOWN_ACCELERATION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "DOWN_ACCELERATION",
      "trendDirection": "DOWN",
      "velocity": -0.001024613590913992,
      "acceleration": -0.004107931993477143,
      "rangePosition": 0.7999961853172862,
      "potentialPullback": true,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010256645007011844
    }
  ],
  "potentialRebound": [
    {
      "sampleId": "601899.SH:2022-01-04T09:37:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:37:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0020746372797806334,
      "acceleration": 0.0020746372797806334,
      "rangePosition": 0.3333280350955272,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0020704407949891923
    },
    {
      "sampleId": "601899.SH:2022-01-04T09:41:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:41:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0031076112463949146,
      "rangePosition": 0.16665607019105447,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0031088795680260795
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:05:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:05:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010341498245023395,
      "acceleration": 0.0010341498245023395,
      "rangePosition": 0.20000381468271378,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004132227333881411
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:12:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:12:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.1428474114441417,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010361943629840775
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:19:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:19:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.24998211858951433,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010362931893419525
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:23:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:23:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.24998211858951433,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010362931893419525
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:24:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:24:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010362931893419525,
      "acceleration": -9.759861145930415e-7,
      "rangePosition": 0.49998807905967624,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010352203974945962
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:34:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:34:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010361943629840775
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:37:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:37:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:40:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:40:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:44:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:44:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.002073463538440623,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010361943629840775
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:03:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:03:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.004139620027007851,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010362931893419525
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:10:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:10:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0031076112463949146,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010361943629840775
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:16:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:16:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.0010372691754565455,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010362931893419525
    },
    {
      "sampleId": "601899.SH:2022-01-04T11:19:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T11:19:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010372691754565455,
      "acceleration": 0.002073463538440623,
      "rangePosition": 0.33331214038210893,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0031088795680260795
    },
    {
      "sampleId": "601899.SH:2022-01-04T13:31:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T13:31:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010298896851235195,
      "acceleration": 0.002058719788735508,
      "rangePosition": 0.5000238424490964,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T14:09:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T14:09:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010214738427785086,
      "acceleration": 0.003060256402224404,
      "rangePosition": 0.5,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0020408629973885928
    },
    {
      "sampleId": "601899.SH:2022-01-04T14:15:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T14:15:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010225183184946474,
      "acceleration": 0.0010225183184946474,
      "rangePosition": 0.16666931574346341,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010214738427785086
    },
    {
      "sampleId": "601899.SH:2022-01-04T14:16:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T14:16:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010214738427785086,
      "acceleration": -0.0000010444757161387486,
      "rangePosition": 0.33333863148692683,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-04T14:20:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T14:20:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "REBOUND",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HYSTERESIS_HOLD",
      "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
      "trendDirection": "UP",
      "velocity": 0.0010214738427785086,
      "acceleration": 0.0010214738427785086,
      "rangePosition": 0.33333863148692683,
      "potentialPullback": false,
      "potentialRebound": true,
      "upwardExhaustion": false,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    }
  ],
  "upwardExhaustion": [
    {
      "sampleId": "601899.SH:2022-01-06T09:37:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:37:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.002051329001402147,
      "acceleration": -0.000004216600306694573,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.003070694497426363
    },
    {
      "sampleId": "601899.SH:2022-01-06T09:38:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T09:38:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010234672199604944,
      "acceleration": -0.0010278617814416524,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.005112494079759333
    },
    {
      "sampleId": "601899.SH:2022-01-06T10:34:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T10:34:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010341498245023395,
      "acceleration": -0.0000010705729922566576,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.002066064406905266
    },
    {
      "sampleId": "601899.SH:2022-01-06T10:35:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T10:35:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010329829434172488,
      "acceleration": -0.0000011668810850906652,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.002064030818346163
    },
    {
      "sampleId": "601899.SH:2022-01-06T11:30:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T11:30:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010287319889730195,
      "acceleration": -0.0000011576961504999872,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.003083220388754082
    },
    {
      "sampleId": "601899.SH:2022-01-06T14:39:00:1.0.0:1.0.0",
      "timestamp": "2022-01-06T14:39:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010341498245023395,
      "acceleration": -0.0000010705729922566576,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-10T09:43:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T09:43:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010672602992500835,
      "acceleration": -0.0000011402615023303753,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0031982657361597777
    },
    {
      "sampleId": "601899.SH:2022-01-10T09:47:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T09:47:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.002127708359077385,
      "acceleration": -0.0010739707591289616,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.004246280417097847
    },
    {
      "sampleId": "601899.SH:2022-01-10T10:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T10:32:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010638541795386924,
      "acceleration": -0.0010682890875564066,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.002125447193197516
    },
    {
      "sampleId": "601899.SH:2022-01-10T13:33:00:1.0.0:1.0.0",
      "timestamp": "2022-01-10T13:33:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010648854996719859,
      "acceleration": -0.000001236969392914844,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-12T09:34:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T09:34:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.003118475397928533,
      "acceleration": -0.00632540236803969,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0051813671203522205
    },
    {
      "sampleId": "601899.SH:2022-01-12T09:41:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T09:41:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010267175684632868,
      "acceleration": -0.003096989920151394,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-12T09:42:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T09:42:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010256645007011844,
      "acceleration": -0.0000010530677621023443,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.001024613590913992
    },
    {
      "sampleId": "601899.SH:2022-01-12T09:58:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T09:58:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010183532782701565,
      "acceleration": -9.407869496769194e-7,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.0010173172898728655
    },
    {
      "sampleId": "601899.SH:2022-01-12T10:24:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T10:24:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.00204076568368472,
      "acceleration": -0.000004270953304574832,
      "rangePosition": 0.8571389645776567,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-12T10:56:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T10:56:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010173172898728655,
      "acceleration": -0.000001035988397291021,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.0010162834071913984
    },
    {
      "sampleId": "601899.SH:2022-01-12T11:04:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T11:04:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010162834071913984,
      "acceleration": -0.000001033882681467091,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-12T13:12:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T13:12:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.001013194427333941,
      "acceleration": -0.000001027604110470648,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-12T13:26:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T13:26:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.00101012416840085,
      "acceleration": -9.248569179387545e-7,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": -0.001009104847206177
    },
    {
      "sampleId": "601899.SH:2022-01-12T13:41:00:1.0.0:1.0.0",
      "timestamp": "2022-01-12T13:41:00",
      "previousState": "HIGH_LEVEL_EXHAUSTION",
      "candidateState": "HIGH_LEVEL_EXHAUSTION",
      "actualState": "HIGH_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "UPWARD_EXHAUSTION",
      "trendDirection": "UP",
      "velocity": 0.0010080875811415702,
      "acceleration": -0.0000010172660644958142,
      "rangePosition": 1,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": true,
      "downwardExhaustion": false,
      "futureReturn_5bar": 0.005035169740577494
    }
  ],
  "downwardExhaustion": [
    {
      "sampleId": "601899.SH:2022-01-04T09:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T09:32:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010361943629840775,
      "acceleration": 0.004118464577019698,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.0020746372797806334
    },
    {
      "sampleId": "601899.SH:2022-01-04T10:07:00:1.0.0:1.0.0",
      "timestamp": "2022-01-04T10:07:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010352203974945962,
      "acceleration": 0.0010309425294815489,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-05T09:36:00:1.0.0:1.0.0",
      "timestamp": "2022-01-05T09:36:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010224208057807438,
      "acceleration": 0.001018442191607849,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-05T13:03:00:1.0.0:1.0.0",
      "timestamp": "2022-01-05T13:03:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010193912797229476,
      "acceleration": 0.0010151462833063452,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-07T09:43:00:1.0.0:1.0.0",
      "timestamp": "2022-01-07T09:43:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010395248441580351,
      "acceleration": 0.0010352113644900296,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.004162327084500372
    },
    {
      "sampleId": "601899.SH:2022-01-07T09:46:00:1.0.0:1.0.0",
      "timestamp": "2022-01-07T09:46:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.001043865236062258,
      "acceleration": 0.0010395156982008213,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.0010449560293344096
    },
    {
      "sampleId": "601899.SH:2022-01-07T10:03:00:1.0.0:1.0.0",
      "timestamp": "2022-01-07T10:03:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010492419189609414,
      "acceleration": 0.003130482545885216,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.0031513324793006614
    },
    {
      "sampleId": "601899.SH:2022-01-07T10:13:00:1.0.0:1.0.0",
      "timestamp": "2022-01-07T10:13:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.001058225299859883,
      "acceleration": 0.00105375539704744,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.003178038980833353
    },
    {
      "sampleId": "601899.SH:2022-01-11T09:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-11T09:32:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.001064987062428302,
      "acceleration": 0.002119697940567322,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.0031982657361597777
    },
    {
      "sampleId": "601899.SH:2022-01-14T09:38:00:1.0.0:1.0.0",
      "timestamp": "2022-01-14T09:38:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.001010027837658023,
      "acceleration": 0.0020111892543365206,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-14T09:50:00:1.0.0:1.0.0",
      "timestamp": "2022-01-14T09:50:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010162834071913984,
      "acceleration": 0.0010120639341608673,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.002034537563029293
    },
    {
      "sampleId": "601899.SH:2022-01-17T09:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-17T09:32:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0020387825594458953,
      "acceleration": 0.0020221271160782983,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.007150122073235399
    },
    {
      "sampleId": "601899.SH:2022-01-17T09:49:00:1.0.0:1.0.0",
      "timestamp": "2022-01-17T09:49:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010341498245022285,
      "acceleration": 0.0020586062127233573,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.004140782865927561
    },
    {
      "sampleId": "601899.SH:2022-01-17T09:52:00:1.0.0:1.0.0",
      "timestamp": "2022-01-17T09:52:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.002072487552326141,
      "acceleration": 0.001026756838138021,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.00311523703163874
    },
    {
      "sampleId": "601899.SH:2022-01-17T09:53:00:1.0.0:1.0.0",
      "timestamp": "2022-01-17T09:53:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010384453544127759,
      "acceleration": 0.0010340421979133652,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.0020789505537704978
    },
    {
      "sampleId": "601899.SH:2022-01-17T13:38:00:1.0.0:1.0.0",
      "timestamp": "2022-01-17T13:38:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010298896851234085,
      "acceleration": 0.001025557902776364,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": -0.002061804585836491
    },
    {
      "sampleId": "601899.SH:2022-01-17T14:12:00:1.0.0:1.0.0",
      "timestamp": "2022-01-17T14:12:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.001030951451389095,
      "acceleration": 0.001026708755834882,
      "rangePosition": 0.24998211858951433,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-18T09:32:00:1.0.0:1.0.0",
      "timestamp": "2022-01-18T09:32:00",
      "previousState": "NO_T_ENVIRONMENT",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "CONFIRMATION_REQUIRED",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0010298896851234085,
      "acceleration": 0.0030726705049306524,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.00206190290277819
    },
    {
      "sampleId": "601899.SH:2022-01-18T11:25:00:1.0.0:1.0.0",
      "timestamp": "2022-01-18T11:25:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.0009969367371615023,
      "acceleration": 0.0009931585249370878,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0
    },
    {
      "sampleId": "601899.SH:2022-01-18T13:02:00:1.0.0:1.0.0",
      "timestamp": "2022-01-18T13:02:00",
      "previousState": "LOW_LEVEL_EXHAUSTION",
      "candidateState": "LOW_LEVEL_EXHAUSTION",
      "actualState": "LOW_LEVEL_EXHAUSTION",
      "transition": "HOLD",
      "branch": "DOWNWARD_EXHAUSTION",
      "trendDirection": "DOWN",
      "velocity": -0.002003958417504448,
      "acceleration": 0.0019881487381744334,
      "rangePosition": 0,
      "potentialPullback": false,
      "potentialRebound": false,
      "upwardExhaustion": false,
      "downwardExhaustion": true,
      "futureReturn_5bar": 0.002007982330598068
    }
  ]
}

## 14. Representative Cases

- Case A UPTREND candidate: {
  "sampleId": "601899.SH:2022-01-07T09:33:00:1.0.0:1.0.0",
  "timestamp": "2022-01-07T09:33:00",
  "previousState": "NO_T_ENVIRONMENT",
  "candidateState": "UPTREND",
  "actualState": "NO_T_ENVIRONMENT",
  "transition": "HYSTERESIS_HOLD",
  "branch": "UPTREND",
  "trendDirection": "UP",
  "velocity": 0.0010384453544127759,
  "acceleration": -0.0000010794897451482655,
  "rangePosition": 0.6666878596178911,
  "potentialPullback": false,
  "potentialRebound": false,
  "upwardExhaustion": false,
  "downwardExhaustion": false,
  "futureReturn_5bar": 0.0010372691754565455
}
- Case B DOWNTREND candidate: {
  "sampleId": "601899.SH:2022-01-11T09:38:00:1.0.0:1.0.0",
  "timestamp": "2022-01-11T09:38:00",
  "previousState": "LOW_LEVEL_EXHAUSTION",
  "candidateState": "DOWNTREND",
  "actualState": "LOW_LEVEL_EXHAUSTION",
  "transition": "HYSTERESIS_HOLD",
  "branch": "DOWNTREND",
  "trendDirection": "DOWN",
  "velocity": -0.001062723596598758,
  "acceleration": 0.0010582156522255248,
  "rangePosition": 0.3999885559518587,
  "potentialPullback": false,
  "potentialRebound": false,
  "upwardExhaustion": false,
  "downwardExhaustion": false,
  "futureReturn_5bar": 0
}
- Case C Potential PULLBACK: {
  "sampleId": "601899.SH:2022-01-04T09:44:00:1.0.0:1.0.0",
  "timestamp": "2022-01-04T09:44:00",
  "previousState": "LOW_LEVEL_EXHAUSTION",
  "candidateState": "DOWN_ACCELERATION",
  "actualState": "LOW_LEVEL_EXHAUSTION",
  "transition": "HYSTERESIS_HOLD",
  "branch": "DOWN_ACCELERATION",
  "trendDirection": "DOWN",
  "velocity": -0.001033081463488017,
  "acceleration": -0.001033081463488017,
  "rangePosition": 0.5,
  "potentialPullback": true,
  "potentialRebound": false,
  "upwardExhaustion": false,
  "downwardExhaustion": false,
  "futureReturn_5bar": 0.0031023508515513054
}
- Case D Potential REBOUND: {
  "sampleId": "601899.SH:2022-01-04T09:37:00:1.0.0:1.0.0",
  "timestamp": "2022-01-04T09:37:00",
  "previousState": "LOW_LEVEL_EXHAUSTION",
  "candidateState": "REBOUND",
  "actualState": "LOW_LEVEL_EXHAUSTION",
  "transition": "HYSTERESIS_HOLD",
  "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
  "trendDirection": "UP",
  "velocity": 0.0020746372797806334,
  "acceleration": 0.0020746372797806334,
  "rangePosition": 0.3333280350955272,
  "potentialPullback": false,
  "potentialRebound": true,
  "upwardExhaustion": false,
  "downwardExhaustion": false,
  "futureReturn_5bar": 0.0020704407949891923
}
- Case E UPWARD_EXHAUSTION continued rise: {
  "sampleId": "601899.SH:2022-01-06T09:47:00:1.0.0:1.0.0",
  "timestamp": "2022-01-06T09:47:00",
  "previousState": "HIGH_LEVEL_EXHAUSTION",
  "candidateState": "WAIT_CONFIRMATION",
  "actualState": "HIGH_LEVEL_EXHAUSTION",
  "transition": "HYSTERESIS_HOLD",
  "branch": "PREVIOUS_HIGH_EXHAUSTION_PULLBACK",
  "trendDirection": "FLAT",
  "velocity": 0,
  "acceleration": 0,
  "rangePosition": 0.14286103542234332,
  "potentialPullback": false,
  "potentialRebound": false,
  "upwardExhaustion": false,
  "downwardExhaustion": false,
  "futureReturn_5bar": 0.0010287319889730195
}
- Case F DOWNWARD_EXHAUSTION continued decline: {
  "sampleId": "601899.SH:2022-01-04T09:49:00:1.0.0:1.0.0",
  "timestamp": "2022-01-04T09:49:00",
  "previousState": "LOW_LEVEL_EXHAUSTION",
  "candidateState": "REBOUND",
  "actualState": "LOW_LEVEL_EXHAUSTION",
  "transition": "HYSTERESIS_HOLD",
  "branch": "PREVIOUS_LOW_EXHAUSTION_REBOUND",
  "trendDirection": "FLAT",
  "velocity": 0,
  "acceleration": -0.002066064406905266,
  "rangePosition": 1,
  "potentialPullback": false,
  "potentialRebound": false,
  "upwardExhaustion": false,
  "downwardExhaustion": false,
  "futureReturn_5bar": -0.001030951451389095
}

## 15. Counterexample Integrity

- UPWARD_EXHAUSTION + 5-bar continued rise samples retained in asset: at least 20 sampled
- DOWNWARD_EXHAUSTION + 5-bar continued decline samples retained in asset: at least 20 sampled
- Samples were not deleted, relabeled, reweighted, or fed back into State logic.

## 16. Root Cause Classification

{
  "STATE_PRIORITY_PROBLEM": {
    "status": "CONFIRMED_INTERACTION",
    "evidence": "Exhaustion branches precede acceleration/trend/fallback branches in classifyCandidate; UPTREND/DOWNTREND conditions exist but final states are absent."
  },
  "STATE_PERSISTENCE_PROBLEM": {
    "status": "CONFIRMED_INTERACTION",
    "evidence": "For a prior exhaustion final state, every observed non-exhaustion candidate change resets dwell to 1; HYSTERESIS_HOLD retains the exhaustion state. The audit observed 123322 upward and 108028 downward non-exhaustion exit attempts, all held and none exited. confirmationDwell/invalidationDwell are declared but not used."
  },
  "STATE_DURATION_PROBLEM": {
    "status": "NOT_CONFIRMED",
    "evidence": "No max duration/expiry token exists in relevant State/Replay code; 120 aligns with observed contiguous afternoon session span and daily replay partition."
  },
  "EXHAUSTION_CONDITION_PROBLEM": {
    "status": "INSUFFICIENT_EVIDENCE",
    "evidence": "Audit confirms broad exhaustion coverage but does not judge the feature condition as semantically correct or incorrect."
  },
  "TREND_CONDITION_NOT_TRIGGERING": {
    "status": "REFUTED",
    "evidence": "Stored candidateState contains UPTREND=1040 and DOWNTREND=412; derived trend conditions are also present."
  },
  "PULLBACK_CONDITION_NOT_TRIGGERING": {
    "status": "REFUTED_FOR_CANDIDATE_LAYER",
    "evidence": "Stored candidateState contains PULLBACK=975; final PULLBACK state is zero."
  },
  "REBOUND_CONDITION_NOT_TRIGGERING": {
    "status": "REFUTED_FOR_CANDIDATE_LAYER",
    "evidence": "Stored candidateState contains REBOUND=73872; final REBOUND state is zero."
  },
  "FEATURE_TO_STATE_SEMANTIC_MISMATCH": {
    "status": "CONFIRMED_INTERACTION",
    "evidence": "Feature-layer potential pullback/rebound predicates are broader than classifier branches and do not encode prior-state hooks, acceleration, exhaustion precedence or transition hysteresis."
  },
  "MULTIPLE_INTERACTING_CAUSES": {
    "status": "CONFIRMED",
    "evidence": "Observed zero final coverage is jointly explained by priority ordering, sticky hysteresis transition behavior, and broader Feature-vs-State candidate semantics."
  },
  "INSUFFICIENT_EVIDENCE": {
    "status": "NOT_PRIMARY",
    "evidence": "Static code plus complete sample trace provides sufficient evidence for the above interactions, while not proving any threshold is wrong."
  }
}

## 17. Research Findings

1. The State Engine does generate non-exhaustion candidate states; final-state zero coverage is therefore a transition/precedence problem candidate, not a trigger-absence fact.
2. Exhaustion branches run before trend and directional fallback branches.
3. `minimumDwell=2` is the only active dwell control; candidate changes reset the local dwell calculation to 1, producing HYSTERESIS_HOLD.
4. `confirmationDwell` and `invalidationDwell` are not active controls in the current implementation.
5. No cooldown, expiry, max duration, or state-age reset exists in the relevant State Engine code.
6. The 120-bar maximum is explained more plausibly by the observed contiguous session/input partition than by a hard-coded 120-bar lifecycle limit.
7. Feature potential PULLBACK/REBOUND and State candidate PULLBACK/REBOUND are different semantic layers; they must not be treated as equivalent without a contract decision.

## 18. Risks / Limitations

- This audit has no human ground-truth state labels and does not declare misclassification.
- Outcome fields are used only for post-hoc counterexample reporting.
- DATA-07 is 1-minute OHLCV research data, not Tick/L2/millisecond microstructure data.
- The audit does not test an alternative State implementation and makes no performance claim.

## 19. Model Change Candidates — Proposal Only

- Review exhaustion precedence against trend/pullback/rebound classification.
- Review whether hysteresis should retain a prior exhaustion state when candidate changes.
- Review separate confirmation/invalidation dwell semantics.
- Review Feature potential vs State candidate semantic contract.
- No candidate is implemented in this audit.

## 20. Final Gate

ROOT_CAUSE_STATUS = MULTIPLE_INTERACTING_CAUSES
MODEL_CHANGE = PROPOSAL_ONLY
T_SAMPLE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
PAPER_TRADING = NOT_STARTED
T_DECISION_ENGINE = NOT_STARTED
HARD_STOP = TRUE
