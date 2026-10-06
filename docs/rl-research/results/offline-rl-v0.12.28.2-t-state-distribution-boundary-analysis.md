# OFFLINE RL V0.12.28.2 — T State Distribution & Boundary Analysis

本报告只分析已生成的 T Sample Asset，不修改 Feature / State / Opportunity Engine，也不重新生成 Mining Samples。

## 1. Executive Summary

- State-space primary status: **CONDITIONAL**
- State boundary status: **REVIEW_REQUIRED**
- Exhaustion override evidence: **CONFIRMED**
- PULLBACK / REBOUND coverage: **ABSENT**
- The asset is structurally auditable, but the observed state vocabulary is highly concentrated in exhaustion candidates and neutral/warmup rows.
- Missing UPTREND / DOWNTREND / PULLBACK / REBOUND output is recorded as a research finding, not repaired.

## 2. Dataset / Mining Run

- Mining Run ID: t-sample-mining-20261005152746-f92d1fd1
- Dataset Hash: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
- Symbol: 601899.SH
- Replay range: 2022-01-04 → 2026-04-17
- Replay bars / samples: 249917
- Valid samples: 247843
- Invalid samples: 2074
- Warmup samples: 2074
- Source asset: .data-inspect/t-sample-mining/v0.12.28/t-sample-mining-20261005152746-f92d1fd1/t-samples.jsonl.gz
- Analysis did not rerun Replay or alter the asset.

## 3. State Distribution

| State | All samples | All % | Valid samples | Valid % |
| --- | --- | --- | --- | --- |
| NEUTRAL | 6583 | 2.634% | 6583 | 2.656% |
| UPTREND | 0 | 0.000% | 0 | 0.000% |
| DOWNTREND | 0 | 0.000% | 0 | 0.000% |
| PULLBACK | 0 | 0.000% | 0 | 0.000% |
| REBOUND | 0 | 0.000% | 0 | 0.000% |
| UPWARD_EXHAUSTION_CANDIDATE | 130068 | 52.044% | 130068 | 52.480% |
| DOWNWARD_EXHAUSTION_CANDIDATE | 111192 | 44.492% | 111192 | 44.864% |
| INVALID | 2074 | 0.830% | 0 | 0.000% |

State coverage notes:
- UPTREND: COUNT = 0; COVERAGE = ABSENT
- DOWNTREND: COUNT = 0; COVERAGE = ABSENT
- PULLBACK: COUNT = 0; COVERAGE = ABSENT
- REBOUND: COUNT = 0; COVERAGE = ABSENT
- Exhaustion concentration among valid samples: 241260 / 247843 = 97.344%

## 4. State Duration

| State | Episode Count | Mean | Median | P90 | Max | 1-bar Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| NEUTRAL | 775 | 8.49 | 5 | 19 | 119 | 18.06% |
| UPTREND | 0 | — | — | — | — | — |
| DOWNTREND | 0 | — | — | — | — | — |
| PULLBACK | 0 | — | — | — | — | — |
| REBOUND | 0 | — | — | — | — | — |
| UPWARD_EXHAUSTION_CANDIDATE | 1119 | 116.24 | 119 | 120 | 120 | 0.00% |
| DOWNWARD_EXHAUSTION_CANDIDATE | 952 | 116.80 | 119 | 120 | 120 | 0.00% |
| INVALID | 0 | — | — | — | — | — |

## 5. State Transition Matrix

Only contiguous observed valid bars are used for the transition matrix. Session breaks, lunch breaks and invalid/warmup gaps are not treated as ordinary transitions.

{
  "DOWNWARD_EXHAUSTION_CANDIDATE": {
    "DOWNWARD_EXHAUSTION_CANDIDATE": {
      "count": 110240,
      "percentageOfRow": "100.000%"
    }
  },
  "NEUTRAL": {
    "NEUTRAL": {
      "count": 5808,
      "percentageOfRow": "88.267%"
    },
    "DOWNWARD_EXHAUSTION_CANDIDATE": {
      "count": 340,
      "percentageOfRow": "5.167%"
    },
    "UPWARD_EXHAUSTION_CANDIDATE": {
      "count": 432,
      "percentageOfRow": "6.565%"
    }
  },
  "UPWARD_EXHAUSTION_CANDIDATE": {
    "UPWARD_EXHAUSTION_CANDIDATE": {
      "count": 128949,
      "percentageOfRow": "100.000%"
    }
  }
}

- Contiguous transitions: 245769
- Same-state holds: 244997
- Non-contiguous/session breaks: 1037

Requested transition checks:
| Previous | Current | Count | Status |
| --- | --- | --- | --- |
| NEUTRAL | UPTREND | 0 | ABSENT |
| NEUTRAL | DOWNTREND | 0 | ABSENT |
| UPTREND | PULLBACK | 0 | ABSENT |
| PULLBACK | REBOUND | 0 | ABSENT |
| REBOUND | UPTREND | 0 | ABSENT |
| DOWNTREND | PULLBACK | 0 | ABSENT |
| PULLBACK | REBOUND | 0 | ABSENT |
| UPTREND | UPWARD_EXHAUSTION_CANDIDATE | 0 | ABSENT |
| DOWNTREND | DOWNWARD_EXHAUSTION_CANDIDATE | 0 | ABSENT |

## 6. Exhaustion Override Analysis

- Upward exhaustion qualifiers (feature candidate + positive velocity): 11778
- Downward exhaustion qualifiers (feature candidate + negative velocity): 6101
- Upward override evidence: 6746
- Downward override evidence: 3164
- Qualifiers not emitted as matching exhaustion state: upward 5032; downward 2937
- Current valid UPTREND count: 0; current valid DOWNTREND count: 0
- EXHAUSTION_OVERRIDE_EVIDENCE = CONFIRMED
- Interpretation: the implementation checks exhaustion before the UPTREND/DOWNTREND branches; the observed data contains samples satisfying both the exhaustion qualifier and the downstream directional-trend condition. This is evidence of precedence/coverage interaction, not a claim that the state logic is incorrect.

## 7. PULLBACK / REBOUND Analysis

- PULLBACK count: 0
- REBOUND count: 0
- PULLBACK → REBOUND count: 0
- REBOUND → UPTREND count: 0
- REBOUND → DOWNTREND count: 0
- Feature-level potential PULLBACK fallback candidates: 33174
- Feature-level potential REBOUND fallback candidates: 34231
- PULLBACK_REBOUND_COVERAGE = ABSENT
- These feature-level counts are diagnostic only; they do not create new State labels.

## 8. State → Opportunity Matrix

[
  {
    "state": "NEUTRAL",
    "total": 6583,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 6583,
        "percentageOfState": "100.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "UPTREND",
    "total": 0,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "DOWNTREND",
    "total": 0,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "PULLBACK",
    "total": 0,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "REBOUND",
    "total": 0,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "UPWARD_EXHAUSTION_CANDIDATE",
    "total": 130068,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 130068,
        "percentageOfState": "100.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
    "total": 111192,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 111192,
        "percentageOfState": "100.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  },
  {
    "state": "INVALID",
    "total": 0,
    "opportunities": {
      "POSITIVE_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "COUNTER_T_ENVIRONMENT": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "NEUTRAL": {
        "count": 0,
        "percentageOfState": "0.000%"
      },
      "INVALID": {
        "count": 0,
        "percentageOfState": "0.000%"
      }
    }
  }
]

## 9. State Boundary Samples

Representative observed transitions:
{
  "DOWNWARD_EXHAUSTION_CANDIDATE→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "sampleId": "601899.SH:2022-01-04T09:33:00:1.0.0:1.0.0",
    "timestamp": "2022-01-04T09:33:00",
    "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
    "rawState": "LOW_LEVEL_EXHAUSTION",
    "opportunity": "POSITIVE_T_ENVIRONMENT",
    "trendDirection": "FLAT",
    "velocity": 0,
    "rangePosition": 0,
    "futureReturn_1bar": 0,
    "futureReturn_5bar": 0.0020746372797806334,
    "futureReturn_10bar": 0.004149373488428809
  },
  "NEUTRAL→NEUTRAL": {
    "sampleId": "601899.SH:2022-01-05T09:33:00:1.0.0:1.0.0",
    "timestamp": "2022-01-05T09:33:00",
    "state": "NEUTRAL",
    "rawState": "NO_T_ENVIRONMENT",
    "opportunity": "NEUTRAL",
    "trendDirection": "DOWN",
    "velocity": -0.00203660944102646,
    "rangePosition": 0,
    "futureReturn_1bar": 0,
    "futureReturn_5bar": -0.003061197182379072,
    "futureReturn_10bar": 0
  },
  "NEUTRAL→DOWNWARD_EXHAUSTION_CANDIDATE": {
    "sampleId": "601899.SH:2022-01-05T09:36:00:1.0.0:1.0.0",
    "timestamp": "2022-01-05T09:36:00",
    "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
    "rawState": "LOW_LEVEL_EXHAUSTION",
    "opportunity": "POSITIVE_T_ENVIRONMENT",
    "trendDirection": "DOWN",
    "velocity": -0.0010224208057807438,
    "rangePosition": 0,
    "futureReturn_1bar": 0.0010234672199604944,
    "futureReturn_5bar": 0,
    "futureReturn_10bar": 0.006141193769822584
  },
  "NEUTRAL→UPWARD_EXHAUSTION_CANDIDATE": {
    "sampleId": "601899.SH:2022-01-06T09:37:00:1.0.0:1.0.0",
    "timestamp": "2022-01-06T09:37:00",
    "state": "UPWARD_EXHAUSTION_CANDIDATE",
    "rawState": "HIGH_LEVEL_EXHAUSTION",
    "opportunity": "COUNTER_T_ENVIRONMENT",
    "trendDirection": "UP",
    "velocity": 0.002051329001402147,
    "rangePosition": 1,
    "futureReturn_1bar": 0.0010234672199604944,
    "futureReturn_5bar": -0.003070694497426363,
    "futureReturn_10bar": -0.0051177265498622004
  },
  "UPWARD_EXHAUSTION_CANDIDATE→UPWARD_EXHAUSTION_CANDIDATE": {
    "sampleId": "601899.SH:2022-01-06T09:38:00:1.0.0:1.0.0",
    "timestamp": "2022-01-06T09:38:00",
    "state": "UPWARD_EXHAUSTION_CANDIDATE",
    "rawState": "HIGH_LEVEL_EXHAUSTION",
    "opportunity": "COUNTER_T_ENVIRONMENT",
    "trendDirection": "UP",
    "velocity": 0.0010234672199604944,
    "rangePosition": 1,
    "futureReturn_1bar": -0.0010224208057807438,
    "futureReturn_5bar": -0.005112494079759333,
    "futureReturn_10bar": -0.005112494079759333
  }
}

Potential boundary cases (no ground-truth misclassification claim):
{
  "positive": [
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-04T10:23:00",
      "endTimestamp": "2022-01-04T10:25:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.649999618530273,
        9.65999984741211,
        9.670000076293945
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-04T10:23:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T10:23:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010372691754565455,
          "rangePosition": 0.24998211858951433,
          "futureReturn_1bar": 0.0010362931893419525,
          "futureReturn_5bar": 0.0010362931893419525,
          "futureReturn_10bar": -0.0010361943629840775
        },
        {
          "sampleId": "601899.SH:2022-01-04T10:24:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T10:24:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010362931893419525,
          "rangePosition": 0.49998807905967624,
          "futureReturn_1bar": 0.0010352203974945962,
          "futureReturn_5bar": -0.0010352203974945962,
          "futureReturn_10bar": -0.0010352203974945962
        },
        {
          "sampleId": "601899.SH:2022-01-04T10:25:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T10:25:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010352203974945962,
          "rangePosition": 1,
          "futureReturn_1bar": -0.0010341498245022285,
          "futureReturn_5bar": -0.002068299649004457,
          "futureReturn_10bar": -0.0031023508515513054
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-04T11:23:00",
      "endTimestamp": "2022-01-04T11:25:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.670000076293945,
        9.680000305175781,
        9.6899995803833
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-04T11:23:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T11:23:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.002072586378684127,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010341498245023395,
          "futureReturn_5bar": 0.002068201027048966,
          "futureReturn_10bar": 0.0010341498245023395
        },
        {
          "sampleId": "601899.SH:2022-01-04T11:24:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T11:24:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010341498245023395,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010329829434172488,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-04T11:25:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T11:25:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010329829434172488,
          "rangePosition": 1,
          "futureReturn_1bar": -0.001031916990766657,
          "futureReturn_5bar": -0.0020639323999397385,
          "futureReturn_10bar": -0.0020639323999397385
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-04T13:06:00",
      "endTimestamp": "2022-01-04T13:08:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.6899995803833,
        9.720000267028809,
        9.729999542236328
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-04T13:06:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T13:06:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.002068201027048966,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0030960462275191336,
          "futureReturn_5bar": 0.0030960462275191336,
          "futureReturn_10bar": 0.002064030818346163
        },
        {
          "sampleId": "601899.SH:2022-01-04T13:07:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T13:07:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0030960462275191336,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010287319889730195,
          "futureReturn_5bar": -0.0010288301036119885,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-04T13:08:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T13:08:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010287319889730195,
          "rangePosition": 1,
          "futureReturn_1bar": -0.0010276747870453518,
          "futureReturn_5bar": -0.0020554475878997724,
          "futureReturn_10bar": -0.0010276747870453518
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-04T13:46:00",
      "endTimestamp": "2022-01-04T13:48:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.770000457763672,
        9.779999732971191,
        9.789999961853027
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-04T13:46:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T13:46:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.002051329001402147,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010234672199604944,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0.0010234672199604944
        },
        {
          "sampleId": "601899.SH:2022-01-04T13:47:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T13:47:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010234672199604944,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010225183184946474,
          "futureReturn_5bar": -0.0010224208057807438,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-04T13:48:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T13:48:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010225183184946474,
          "rangePosition": 1,
          "futureReturn_1bar": -0.002042850272449881,
          "futureReturn_5bar": -0.0010214738427785086,
          "futureReturn_10bar": -0.0010214738427785086
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-05T09:42:00",
      "endTimestamp": "2022-01-05T09:44:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.779999732971191,
        9.800000190734863,
        9.84000015258789
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-05T09:42:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T09:42:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010234672199604944,
          "rangePosition": 0.1999885557335775,
          "futureReturn_1bar": 0.0020450366369892947,
          "futureReturn_5bar": 0.004089975761264686,
          "futureReturn_10bar": 0.003067554955483942
        },
        {
          "sampleId": "601899.SH:2022-01-05T09:43:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T09:43:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0020450366369892947,
          "rangePosition": 0.6000038147554742,
          "futureReturn_1bar": 0.004081628681073202,
          "futureReturn_5bar": 0.00204076568368472,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-05T09:44:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T09:44:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.004081628681073202,
          "rangePosition": 1,
          "futureReturn_1bar": -0.0010162834071913984,
          "futureReturn_5bar": -0.002032566814382797,
          "futureReturn_10bar": -0.004065036710645509
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-05T10:22:00",
      "endTimestamp": "2022-01-05T10:24:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.800000190734863,
        9.8100004196167,
        9.819999694824219
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-05T10:22:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T10:22:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010214738427785086,
          "rangePosition": 1,
          "futureReturn_1bar": 0.001020431498694352,
          "futureReturn_5bar": 0.001020431498694352,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-05T10:23:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T10:23:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.001020431498694352,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010192940652198335,
          "futureReturn_5bar": -0.0010193912797229476,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-05T10:24:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T10:24:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010192940652198335,
          "rangePosition": 1,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0010182561627563036
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-05T10:41:00",
      "endTimestamp": "2022-01-05T10:43:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.819999694824219,
        9.829999923706055,
        9.84000015258789
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-05T10:41:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T10:41:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010192940652198335,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010183532782701565,
          "futureReturn_5bar": 0.0030550598348104696,
          "futureReturn_10bar": 0.002036706556540313
        },
        {
          "sampleId": "601899.SH:2022-01-05T10:42:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T10:42:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010183532782701565,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010173172898728655,
          "futureReturn_5bar": 0.0030518548529023803,
          "futureReturn_10bar": 0.0010173172898728655
        },
        {
          "sampleId": "601899.SH:2022-01-05T10:43:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T10:43:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010173172898728655,
          "rangePosition": 1,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.0010162834071913984,
          "futureReturn_10bar": 0
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-05T14:08:00",
      "endTimestamp": "2022-01-05T14:10:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.779999732971191,
        9.789999961853027,
        9.800000190734863
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-05T14:08:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T14:08:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010234672199604944,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010225183184946474,
          "futureReturn_5bar": 0.0010225183184946474,
          "futureReturn_10bar": 0.0010225183184946474
        },
        {
          "sampleId": "601899.SH:2022-01-05T14:09:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T14:09:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010225183184946474,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010214738427785086,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0.0010214738427785086
        },
        {
          "sampleId": "601899.SH:2022-01-05T14:10:00:1.0.0:1.0.0",
          "timestamp": "2022-01-05T14:10:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010214738427785086,
          "rangePosition": 1,
          "futureReturn_1bar": -0.0010204314986942409,
          "futureReturn_5bar": -0.0010204314986942409,
          "futureReturn_10bar": -0.0010204314986942409
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-06T09:36:00",
      "endTimestamp": "2022-01-06T09:38:00",
      "states": [
        "NEUTRAL",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.75,
        9.770000457763672,
        9.779999732971191
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-06T09:36:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T09:36:00",
          "state": "NEUTRAL",
          "rawState": "NO_T_ENVIRONMENT",
          "opportunity": "NEUTRAL",
          "trendDirection": "UP",
          "velocity": 0.0020555456017088414,
          "rangePosition": 1,
          "futureReturn_1bar": 0.002051329001402147,
          "futureReturn_5bar": 0.0010256645007011844,
          "futureReturn_10bar": -0.0030768956893529875
        },
        {
          "sampleId": "601899.SH:2022-01-06T09:37:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T09:37:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.002051329001402147,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010234672199604944,
          "futureReturn_5bar": -0.003070694497426363,
          "futureReturn_10bar": -0.0051177265498622004
        },
        {
          "sampleId": "601899.SH:2022-01-06T09:38:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T09:38:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010234672199604944,
          "rangePosition": 1,
          "futureReturn_1bar": -0.0010224208057807438,
          "futureReturn_5bar": -0.005112494079759333,
          "futureReturn_10bar": -0.005112494079759333
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-06T10:33:00",
      "endTimestamp": "2022-01-06T10:35:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.670000076293945,
        9.680000305175781,
        9.6899995803833
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-06T10:33:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T10:33:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010352203974945962,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010341498245023395,
          "futureReturn_5bar": 0.0031023508515513054,
          "futureReturn_10bar": 0.004136500676053423
        },
        {
          "sampleId": "601899.SH:2022-01-06T10:34:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T10:34:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010341498245023395,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010329829434172488,
          "futureReturn_5bar": 0.002066064406905266,
          "futureReturn_10bar": 0.002066064406905266
        },
        {
          "sampleId": "601899.SH:2022-01-06T10:35:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T10:35:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010329829434172488,
          "rangePosition": 1,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.002064030818346163,
          "futureReturn_10bar": 0.0010320154091729705
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-07T10:15:00",
      "endTimestamp": "2022-01-07T10:17:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.449999809265137,
        9.460000038146973,
        9.479999542236328
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T10:15:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:15:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.001059346326944377,
          "rangePosition": 0.07692476983457433,
          "futureReturn_1bar": 0.001058225299859883,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0.002116450599719766
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:16:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:16:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.001058225299859883,
          "rangePosition": 0.15384953966914866,
          "futureReturn_1bar": 0.002114112474493446,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0.001057106642865735
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:17:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:17:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.002114112474493446,
          "rangePosition": 0.3076917433884752,
          "futureReturn_1bar": -0.0010547759167044424,
          "futureReturn_5bar": -0.0021096524319702548,
          "futureReturn_10bar": -0.0010547759167044424
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-12T09:33:00",
      "endTimestamp": "2022-01-12T09:35:00",
      "states": [
        "NEUTRAL",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.619999885559082,
        9.649999618530273,
        9.720000267028809
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-12T09:33:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T09:33:00",
          "state": "NEUTRAL",
          "rawState": "NO_T_ENVIRONMENT",
          "opportunity": "NEUTRAL",
          "trendDirection": "UP",
          "velocity": 0.009443877765968223,
          "rangePosition": 1,
          "futureReturn_1bar": 0.003118475397928533,
          "futureReturn_5bar": 0.010395050172489206,
          "futureReturn_10bar": 0.01351352557041774
        },
        {
          "sampleId": "601899.SH:2022-01-12T09:34:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T09:34:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.003118475397928533,
          "rangePosition": 1,
          "futureReturn_1bar": 0.007253953499036125,
          "futureReturn_5bar": 0.0051813671203522205,
          "futureReturn_10bar": 0.011399027430046171
        },
        {
          "sampleId": "601899.SH:2022-01-12T09:35:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T09:35:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.007253953499036125,
          "rangePosition": 1,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.002057562092585119,
          "futureReturn_10bar": 0.002057562092585119
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-12T09:40:00",
      "endTimestamp": "2022-01-12T09:42:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.739999771118164,
        9.75,
        9.760000228881836
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-12T09:40:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T09:40:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.004123707488614681,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010267175684632868,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0.0051334899291402
        },
        {
          "sampleId": "601899.SH:2022-01-12T09:41:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T09:41:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010267175684632868,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010256645007011844,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0.008205120380108122
        },
        {
          "sampleId": "601899.SH:2022-01-12T09:42:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T09:42:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010256645007011844,
          "rangePosition": 1,
          "futureReturn_1bar": -0.001024613590913992,
          "futureReturn_5bar": -0.001024613590913992,
          "futureReturn_10bar": 0.007172099711337587
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-12T13:45:00",
      "endTimestamp": "2022-01-12T13:47:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.960000038146973,
        9.979999542236328,
        9.989999771118164
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-12T13:45:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T13:45:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0020121185722323798,
          "rangePosition": 1,
          "futureReturn_1bar": 0.002007982330598068,
          "futureReturn_5bar": 0.004016060411629274,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-12T13:46:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T13:46:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.002007982330598068,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010020269880288701,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.003005985405533318
        },
        {
          "sampleId": "601899.SH:2022-01-12T13:47:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T13:47:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0010020269880288701,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0010010239350302097,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0020019524071637207
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-12T14:15:00",
      "endTimestamp": "2022-01-12T14:17:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.029999732971191,
        10.039999961853027,
        10.050000190734863
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-12T14:15:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T14:15:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.001997952410795145,
          "rangePosition": 1,
          "futureReturn_1bar": 0.0009970318193490701,
          "futureReturn_5bar": 0.004985064014558116,
          "futureReturn_10bar": -0.0009969367371615023
        },
        {
          "sampleId": "601899.SH:2022-01-12T14:16:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T14:16:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009970318193490701,
          "rangePosition": 1,
          "futureReturn_1bar": 0.000996038737035132,
          "futureReturn_5bar": 0.002988021223623072,
          "futureReturn_10bar": -0.001991982486588051
        },
        {
          "sampleId": "601899.SH:2022-01-12T14:17:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T14:17:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.000996038737035132,
          "rangePosition": 1,
          "futureReturn_1bar": 0.000995047631049406,
          "futureReturn_5bar": 0.001990000369133549,
          "futureReturn_10bar": -0.00398009563123225
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-13T09:54:00",
      "endTimestamp": "2022-01-13T09:56:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.279999732971191,
        10.289999961853027,
        10.300000190734863
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T09:54:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:54:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009736392173147479,
          "rangePosition": 0.05555172907074699,
          "futureReturn_1bar": 0.0009727849359530971,
          "futureReturn_5bar": -0.0019454771020286366,
          "futureReturn_10bar": -0.0019454771020286366
        },
        {
          "sampleId": "601899.SH:2022-01-13T09:55:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:55:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009727849359530971,
          "rangePosition": 0.11110875635122892,
          "futureReturn_1bar": 0.0009718395450835082,
          "futureReturn_5bar": -0.005830944590780596,
          "futureReturn_10bar": -0.002915425955530182
        },
        {
          "sampleId": "601899.SH:2022-01-13T09:56:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:56:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009718395450835082,
          "rangePosition": 0.16666578363171083,
          "futureReturn_1bar": 0.0009708959899661362,
          "futureReturn_5bar": -0.006796179340025854,
          "futureReturn_10bar": -0.0038834913701272233
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-13T11:05:00",
      "endTimestamp": "2022-01-13T11:07:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.130000114440918,
        10.140000343322754,
        10.149999618530273
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T11:05:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:05:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009881649204468435,
          "rangePosition": 0.14286103542234332,
          "futureReturn_1bar": 0.0009871894144977134,
          "futureReturn_5bar": 0.001974284685431149,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-13T11:06:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:06:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009871894144977134,
          "rangePosition": 0.28572207084468665,
          "futureReturn_1bar": 0.000986121781948901,
          "futureReturn_5bar": -0.0009862158326672255,
          "futureReturn_10bar": -0.0009862158326672255
        },
        {
          "sampleId": "601899.SH:2022-01-13T11:07:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:07:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.000986121781948901,
          "rangePosition": 0.42856948228882835,
          "futureReturn_1bar": -0.0009851503037757725,
          "futureReturn_5bar": -0.0009851503037757725,
          "futureReturn_10bar": -0.001970394565615874
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-13T11:21:00",
      "endTimestamp": "2022-01-13T11:23:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.119999885559082,
        10.130000114440918,
        10.140000343322754
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T11:21:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:21:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009891423562247148,
          "rangePosition": 0.2500059604701619,
          "futureReturn_1bar": 0.0009881649204468435,
          "futureReturn_5bar": 0.0009881649204468435,
          "futureReturn_10bar": 0.0009881649204468435
        },
        {
          "sampleId": "601899.SH:2022-01-13T11:22:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:22:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009881649204468435,
          "rangePosition": 0.5000119209403238,
          "futureReturn_1bar": 0.0009871894144977134,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0009871894144976023
        },
        {
          "sampleId": "601899.SH:2022-01-13T11:23:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:23:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009871894144977134,
          "rangePosition": 0.7500178814104856,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": -0.001972431665334451,
          "futureReturn_10bar": -0.0029586474980016764
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-13T13:51:00",
      "endTimestamp": "2022-01-13T13:53:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.079999923706055,
        10.09000015258789,
        10.100000381469727
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T13:51:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T13:51:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009930714185597544,
          "rangePosition": 0.20000381468271378,
          "futureReturn_1bar": 0.0009920862061036928,
          "futureReturn_5bar": 0.0009920862061036928,
          "futureReturn_10bar": 0.0009920862061036928
        },
        {
          "sampleId": "601899.SH:2022-01-13T13:52:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T13:52:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009920862061036928,
          "rangePosition": 0.40000762936542755,
          "futureReturn_1bar": 0.0009911029465416998,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0009911029465416998
        },
        {
          "sampleId": "601899.SH:2022-01-13T13:53:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T13:53:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009911029465416998,
          "rangePosition": 0.6000114440481413,
          "futureReturn_1bar": -0.0009901216340727492,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0019802432681454984
        }
      ]
    },
    {
      "direction": "CONTINUOUS_UP",
      "startTimestamp": "2022-01-13T14:10:00",
      "endTimestamp": "2022-01-13T14:12:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.0600004196167,
        10.069999694824219,
        10.079999923706055
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T14:10:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T14:10:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.000995047631049406,
          "rangePosition": 0.20000381468271378,
          "futureReturn_1bar": 0.0009939636968623322,
          "futureReturn_5bar": 0.0009939636968623322,
          "futureReturn_10bar": 0.0009939636968623322
        },
        {
          "sampleId": "601899.SH:2022-01-13T14:11:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T14:11:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009939636968623322,
          "rangePosition": 0.3999885559518587,
          "futureReturn_1bar": 0.0009930714185597544,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.000992976714056848
        },
        {
          "sampleId": "601899.SH:2022-01-13T14:12:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T14:12:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "UP",
          "velocity": 0.0009930714185597544,
          "rangePosition": 0.5999923706345724,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": -0.0009920862061038038,
          "futureReturn_10bar": -0.0009920862061038038
        }
      ]
    }
  ],
  "negative": [
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-04T09:57:00",
      "endTimestamp": "2022-01-04T09:59:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.6899995803833,
        9.680000305175781,
        9.670000076293945
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-04T09:57:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T09:57:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001030951451389095,
          "rangePosition": 0.6249910592947572,
          "futureReturn_1bar": -0.001031916990766657,
          "futureReturn_5bar": -0.0020639323999397385,
          "futureReturn_10bar": -0.004127963218285791
        },
        {
          "sampleId": "601899.SH:2022-01-04T09:58:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T09:58:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001031916990766657,
          "rangePosition": 0.5,
          "futureReturn_1bar": -0.001033081463488017,
          "futureReturn_5bar": -0.001033081463488017,
          "futureReturn_10bar": -0.003099244390464162
        },
        {
          "sampleId": "601899.SH:2022-01-04T09:59:00:1.0.0:1.0.0",
          "timestamp": "2022-01-04T09:59:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001033081463488017,
          "rangePosition": 0.37499701976491906,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.002068299649004457
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-06T10:08:00",
      "endTimestamp": "2022-01-06T10:10:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.6899995803833,
        9.680000305175781,
        9.670000076293945
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-06T10:08:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T10:08:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001030951451389095,
          "rangePosition": 0,
          "futureReturn_1bar": -0.001031916990766657,
          "futureReturn_5bar": -0.001031916990766657,
          "futureReturn_10bar": -0.0020639323999397385
        },
        {
          "sampleId": "601899.SH:2022-01-06T10:09:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T10:09:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001031916990766657,
          "rangePosition": 0,
          "futureReturn_1bar": -0.001033081463488017,
          "futureReturn_5bar": -0.001033081463488017,
          "futureReturn_10bar": -0.001033081463488017
        },
        {
          "sampleId": "601899.SH:2022-01-06T10:10:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T10:10:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001033081463488017,
          "rangePosition": 0,
          "futureReturn_1bar": 0.0010341498245023395,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-06T13:03:00",
      "endTimestamp": "2022-01-06T13:05:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.720000267028809,
        9.710000038146973,
        9.699999809265137
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-06T13:03:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:03:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010276747870453518,
          "rangePosition": 0.6666878596178911,
          "futureReturn_1bar": -0.0010288301036119885,
          "futureReturn_5bar": -0.002057660207223977,
          "futureReturn_10bar": -0.002057660207223977
        },
        {
          "sampleId": "601899.SH:2022-01-06T13:04:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:04:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010288301036119885,
          "rangePosition": 0.33334392980894556,
          "futureReturn_1bar": -0.0010298896851234085,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0010298896851234085
        },
        {
          "sampleId": "601899.SH:2022-01-06T13:05:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:05:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010298896851234085,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.001030951451389095,
          "futureReturn_10bar": 0.001030951451389095
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-06T13:38:00",
      "endTimestamp": "2022-01-06T13:40:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.710000038146973,
        9.699999809265137,
        9.6899995803833
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-06T13:38:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:38:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010288301036119885,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010298896851234085,
          "futureReturn_5bar": -0.002059779370246928,
          "futureReturn_10bar": -0.0010298896851234085
        },
        {
          "sampleId": "601899.SH:2022-01-06T13:39:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:39:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010298896851234085,
          "rangePosition": 0,
          "futureReturn_1bar": -0.001030951451389095,
          "futureReturn_5bar": -0.001030951451389095,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-06T13:40:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:40:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001030951451389095,
          "rangePosition": 0,
          "futureReturn_1bar": 0.0010320154091729705,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-06T13:54:00",
      "endTimestamp": "2022-01-06T13:56:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.680000305175781,
        9.670000076293945,
        9.65999984741211
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-06T13:54:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:54:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001031916990766657,
          "rangePosition": 0,
          "futureReturn_1bar": -0.001033081463488017,
          "futureReturn_5bar": -0.001033081463488017,
          "futureReturn_10bar": -0.001033081463488017
        },
        {
          "sampleId": "601899.SH:2022-01-06T13:55:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:55:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001033081463488017,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010341498245022285,
          "futureReturn_5bar": 0.0010341498245023395,
          "futureReturn_10bar": -0.0010341498245022285
        },
        {
          "sampleId": "601899.SH:2022-01-06T13:56:00:1.0.0:1.0.0",
          "timestamp": "2022-01-06T13:56:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010341498245022285,
          "rangePosition": 0,
          "futureReturn_1bar": 0.0010352203974945962,
          "futureReturn_5bar": 0.0020704407949891923,
          "futureReturn_10bar": 0.0010352203974945962
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-07T09:41:00",
      "endTimestamp": "2022-01-07T09:43:00",
      "states": [
        "NEUTRAL",
        "NEUTRAL",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.640000343322754,
        9.619999885559082,
        9.609999656677246
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T09:41:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T09:41:00",
          "state": "NEUTRAL",
          "rawState": "NO_T_ENVIRONMENT",
          "opportunity": "NEUTRAL",
          "trendDirection": "DOWN",
          "velocity": -0.0010361943629840775,
          "rangePosition": 0.6666878596178911,
          "futureReturn_1bar": -0.0020747362086480647,
          "futureReturn_5bar": -0.007261477801400851,
          "futureReturn_10bar": -0.006224109697076874
        },
        {
          "sampleId": "601899.SH:2022-01-07T09:42:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T09:42:00",
          "state": "NEUTRAL",
          "rawState": "NO_T_ENVIRONMENT",
          "opportunity": "NEUTRAL",
          "trendDirection": "DOWN",
          "velocity": -0.0020747362086480647,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010395248441580351,
          "futureReturn_5bar": -0.007276475640015101,
          "futureReturn_10bar": -0.004158000242086568
        },
        {
          "sampleId": "601899.SH:2022-01-07T09:43:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T09:43:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010395248441580351,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010405073428458866,
          "futureReturn_5bar": -0.004162327084500372,
          "futureReturn_10bar": -0.003121720503948877
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-07T10:07:00",
      "endTimestamp": "2022-01-07T10:09:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.510000228881836,
        9.489999771118164,
        9.449999809265137
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T10:07:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:07:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0020985839086817837,
          "rangePosition": 0,
          "futureReturn_1bar": -0.002103097506026441,
          "futureReturn_5bar": -0.006309192236870653,
          "futureReturn_10bar": -0.0031546462590396063
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:08:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:08:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.002103097506026441,
          "rangePosition": 0,
          "futureReturn_1bar": -0.004214959201027879,
          "futureReturn_5bar": -0.005268724124423474,
          "futureReturn_10bar": -0.0021074293542369116
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:09:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:09:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.004214959201027879,
          "rangePosition": 0,
          "futureReturn_1bar": 0.0031745749816607383,
          "futureReturn_5bar": -0.001058225299859883,
          "futureReturn_10bar": 0.002116450599719766
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-07T10:11:00",
      "endTimestamp": "2022-01-07T10:13:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.470000267028809,
        9.449999809265137,
        9.4399995803833
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T10:11:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:11:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010547759167044424,
          "rangePosition": 0.15384953966914866,
          "futureReturn_1bar": -0.002111980696907323,
          "futureReturn_5bar": -0.001055990348453606,
          "futureReturn_10bar": -0.001055990348453606
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:12:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:12:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.002111980696907323,
          "rangePosition": 0,
          "futureReturn_1bar": -0.001058225299859883,
          "futureReturn_5bar": 0.0031745749816607383,
          "futureReturn_10bar": 0.001058225299859883
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:13:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:13:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001058225299859883,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.003178038980833353,
          "futureReturn_10bar": 0.003178038980833353
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-07T10:31:00",
      "endTimestamp": "2022-01-07T10:33:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.470000267028809,
        9.460000038146973,
        9.449999809265137
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T10:31:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:31:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010547759167044424,
          "rangePosition": 0.7500178814104856,
          "futureReturn_1bar": -0.001055990348453606,
          "futureReturn_5bar": -0.002111980696907323,
          "futureReturn_10bar": -0.003167971045360929
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:32:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:32:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001055990348453606,
          "rangePosition": 0.5000119209403238,
          "futureReturn_1bar": -0.001057106642865846,
          "futureReturn_5bar": -0.001057106642865846,
          "futureReturn_10bar": -0.001057106642865846
        },
        {
          "sampleId": "601899.SH:2022-01-07T10:33:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T10:33:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001057106642865846,
          "rangePosition": 0.2500059604701619,
          "futureReturn_1bar": 0.001058225299859883,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-07T14:07:00",
      "endTimestamp": "2022-01-07T14:09:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.390000343322754,
        9.380000114440918,
        9.369999885559082
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T14:07:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T14:07:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010637527248200662,
          "rangePosition": 0.33334392980894556,
          "futureReturn_1bar": -0.001064987062428302,
          "futureReturn_5bar": -0.003194961187284906,
          "futureReturn_10bar": -0.005324833749385194
        },
        {
          "sampleId": "601899.SH:2022-01-07T14:08:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T14:08:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001064987062428302,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010661224690647897,
          "futureReturn_5bar": -0.0031982657361597777,
          "futureReturn_10bar": -0.0031982657361597777
        },
        {
          "sampleId": "601899.SH:2022-01-07T14:09:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T14:09:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010661224690647897,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": -0.0032016791182064575,
          "futureReturn_10bar": -0.002134418818956263
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-07T14:12:00",
      "endTimestamp": "2022-01-07T14:14:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.359999656677246,
        9.350000381469727,
        9.34000015258789
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-07T14:12:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T14:12:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010672602992501945,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010682986724669385,
          "futureReturn_5bar": -0.0021366992332193524,
          "futureReturn_10bar": -0.0010682986724669385
        },
        {
          "sampleId": "601899.SH:2022-01-07T14:13:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T14:13:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010682986724669385,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010695431522821375,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-07T14:14:00:1.0.0:1.0.0",
          "timestamp": "2022-01-07T14:14:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010695431522821375,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.001070688299621203,
          "futureReturn_10bar": 0.001070688299621203
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-10T09:48:00",
      "endTimestamp": "2022-01-10T09:50:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.40999984741211,
        9.399999618530273,
        9.390000343322754
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-10T09:48:00:1.0.0:1.0.0",
          "timestamp": "2022-01-10T09:48:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010615954141022232,
          "rangePosition": 0.8999980926586432,
          "futureReturn_1bar": -0.001062723596598758,
          "futureReturn_5bar": -0.001062723596598758,
          "futureReturn_10bar": -0.0031880694428960688
        },
        {
          "sampleId": "601899.SH:2022-01-10T09:49:00:1.0.0:1.0.0",
          "timestamp": "2022-01-10T09:49:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001062723596598758,
          "rangePosition": 0.7999961853172862,
          "futureReturn_1bar": -0.0010637527248200662,
          "futureReturn_5bar": -0.0010637527248200662,
          "futureReturn_10bar": -0.003191461083897562
        },
        {
          "sampleId": "601899.SH:2022-01-10T09:50:00:1.0.0:1.0.0",
          "timestamp": "2022-01-10T09:50:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010637527248200662,
          "rangePosition": 0.7000038146827138,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": -0.002129974124856604,
          "futureReturn_10bar": -0.001064987062428302
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-11T09:37:00",
      "endTimestamp": "2022-01-11T09:39:00",
      "states": [
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE",
        "DOWNWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.40999984741211,
        9.399999618530273,
        9.390000343322754
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-11T09:37:00:1.0.0:1.0.0",
          "timestamp": "2022-01-11T09:37:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.002120939248824283,
          "rangePosition": 0.5999923706345724,
          "futureReturn_1bar": -0.001062723596598758,
          "futureReturn_5bar": -0.0021253458462973107,
          "futureReturn_10bar": -0.001062723596598758
        },
        {
          "sampleId": "601899.SH:2022-01-11T09:38:00:1.0.0:1.0.0",
          "timestamp": "2022-01-11T09:38:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001062723596598758,
          "rangePosition": 0.3999885559518587,
          "futureReturn_1bar": -0.0010637527248200662,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-11T09:39:00:1.0.0:1.0.0",
          "timestamp": "2022-01-11T09:39:00",
          "state": "DOWNWARD_EXHAUSTION_CANDIDATE",
          "rawState": "LOW_LEVEL_EXHAUSTION",
          "opportunity": "POSITIVE_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010637527248200662,
          "rangePosition": 0.20000381468271378,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.0010648854996719859,
          "futureReturn_10bar": 0.002129872562100399
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-12T10:11:00",
      "endTimestamp": "2022-01-12T10:13:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        9.800000190734863,
        9.789999961853027,
        9.779999732971191
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-12T10:11:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T10:11:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010193912797229476,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010204314986942409,
          "futureReturn_5bar": -0.004081628681073313,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-12T10:12:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T10:12:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010204314986942409,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010214738427785086,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0010214738427785086
        },
        {
          "sampleId": "601899.SH:2022-01-12T10:13:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T10:13:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010214738427785086,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0010224208057807438,
          "futureReturn_5bar": 0.0010225183184946474,
          "futureReturn_10bar": 0.0020450366369892947
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-12T14:27:00",
      "endTimestamp": "2022-01-12T14:29:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.010000228881836,
        10,
        9.989999771118164
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-12T14:27:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T14:27:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009980267889196925,
          "rangePosition": 0.22222693171703473,
          "futureReturn_1bar": -0.0009990238414763208,
          "futureReturn_5bar": -0.0009990238414763208,
          "futureReturn_10bar": 0.001997952410795145
        },
        {
          "sampleId": "601899.SH:2022-01-12T14:28:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T14:28:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009990238414763208,
          "rangePosition": 0.11111346585851736,
          "futureReturn_1bar": -0.0010000228881835715,
          "futureReturn_5bar": 0.002000045776367143,
          "futureReturn_10bar": 0.002000045776367143
        },
        {
          "sampleId": "601899.SH:2022-01-12T14:29:00:1.0.0:1.0.0",
          "timestamp": "2022-01-12T14:29:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0010000228881835715,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.003003071805090629,
          "futureReturn_10bar": 0.0010010239350302097
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-13T09:38:00",
      "endTimestamp": "2022-01-13T09:40:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.4399995803833,
        10.430000305175781,
        10.399999618530273
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T09:38:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:38:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009569597190776102,
          "rangePosition": 0.9545444693459103,
          "futureReturn_1bar": -0.0009577850200596094,
          "futureReturn_5bar": -0.007662828249186293,
          "futureReturn_10bar": -0.009578489637423804
        },
        {
          "sampleId": "601899.SH:2022-01-13T09:39:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:39:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009577850200596094,
          "rangePosition": 0.9090932735698154,
          "futureReturn_1bar": -0.0028763840621002235,
          "futureReturn_5bar": -0.006711471375873135,
          "futureReturn_10bar": -0.01246405662868555
        },
        {
          "sampleId": "601899.SH:2022-01-13T09:40:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:40:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0028763840621002235,
          "rangePosition": 0.7727266816075462,
          "futureReturn_1bar": 0.0028846815140313176,
          "futureReturn_5bar": -0.0038461503192516178,
          "futureReturn_10bar": -0.008653769443723536
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-13T09:58:00",
      "endTimestamp": "2022-01-13T10:00:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.279999732971191,
        10.260000228881836,
        10.229999542236328
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T09:58:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:58:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0029098627957789835,
          "rangePosition": 0.06249552964737858,
          "futureReturn_1bar": -0.0019454771020286366,
          "futureReturn_5bar": -0.0038910469739347198,
          "futureReturn_10bar": -0.0019454771020286366
        },
        {
          "sampleId": "601899.SH:2022-01-13T09:59:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T09:59:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0019454771020286366,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0029240434674705496,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0009746811558235535
        },
        {
          "sampleId": "601899.SH:2022-01-13T10:00:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:00:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0029240434674705496,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.002932618571647616,
          "futureReturn_10bar": 0.0019550790477649294
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-13T10:19:00",
      "endTimestamp": "2022-01-13T10:21:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.229999542236328,
        10.180000305175781,
        10.149999618530273
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T10:19:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:19:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0029240434674705496,
          "rangePosition": 0,
          "futureReturn_1bar": -0.004887511172812498,
          "futureReturn_5bar": -0.004887511172812498,
          "futureReturn_10bar": -0.005865050696694962
        },
        {
          "sampleId": "601899.SH:2022-01-13T10:20:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:20:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.004887511172812498,
          "rangePosition": 0,
          "futureReturn_1bar": -0.002947022175456615,
          "futureReturn_5bar": 0.00196458776913655,
          "futureReturn_10bar": -0.001964681450304373
        },
        {
          "sampleId": "601899.SH:2022-01-13T10:21:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:21:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.002947022175456615,
          "rangePosition": 0,
          "futureReturn_1bar": 0.0009852442618401014,
          "futureReturn_5bar": 0.003940883089295966,
          "futureReturn_10bar": 0.0019704885236802028
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-13T10:33:00",
      "endTimestamp": "2022-01-13T10:35:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.1899995803833,
        10.180000305175781,
        10.15999984741211
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T10:33:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:33:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009804146145916404,
          "rangePosition": 0.3333306842565366,
          "futureReturn_1bar": -0.0009812831814801637,
          "futureReturn_5bar": -0.0009812831814801637,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-13T10:34:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:34:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009812831814801637,
          "rangePosition": 0.27273200166458594,
          "futureReturn_1bar": -0.001964681450304373,
          "futureReturn_5bar": 0.0009822470439844189,
          "futureReturn_10bar": 0
        },
        {
          "sampleId": "601899.SH:2022-01-13T10:35:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T10:35:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.001964681450304373,
          "rangePosition": 0.09091066722152864,
          "futureReturn_1bar": 0.0009842745110260065,
          "futureReturn_5bar": 0.0029527296674942693,
          "futureReturn_10bar": 0.0029527296674942693
        }
      ]
    },
    {
      "direction": "CONTINUOUS_DOWN",
      "startTimestamp": "2022-01-13T11:01:00",
      "endTimestamp": "2022-01-13T11:03:00",
      "states": [
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE",
        "UPWARD_EXHAUSTION_CANDIDATE"
      ],
      "prices": [
        10.140000343322754,
        10.130000114440918,
        10.119999885559082
      ],
      "samples": [
        {
          "sampleId": "601899.SH:2022-01-13T11:01:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:01:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009851503037757725,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0009862158326672255,
          "futureReturn_5bar": 0,
          "futureReturn_10bar": -0.0009862158326672255
        },
        {
          "sampleId": "601899.SH:2022-01-13T11:02:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:02:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009862158326672255,
          "rangePosition": 0,
          "futureReturn_1bar": -0.0009871894144976023,
          "futureReturn_5bar": 0.001974284685431149,
          "futureReturn_10bar": 0.0009871894144977134
        },
        {
          "sampleId": "601899.SH:2022-01-13T11:03:00:1.0.0:1.0.0",
          "timestamp": "2022-01-13T11:03:00",
          "state": "UPWARD_EXHAUSTION_CANDIDATE",
          "rawState": "HIGH_LEVEL_EXHAUSTION",
          "opportunity": "COUNTER_T_ENVIRONMENT",
          "trendDirection": "DOWN",
          "velocity": -0.0009871894144976023,
          "rangePosition": 0,
          "futureReturn_1bar": 0,
          "futureReturn_5bar": 0.001976329840893687,
          "futureReturn_10bar": 0.001976329840893687
        }
      ]
    }
  ]
}

## 10. Counterexample Analysis

Counterexample definition: upward exhaustion candidate followed by positive future return, or downward exhaustion candidate followed by negative future return. These are descriptive historical outcomes, not predictive probabilities.

{
  "upward": {
    "1": {
      "count": 130068,
      "positiveCount": 44754,
      "negativeCount": 46191,
      "zeroCount": 39123,
      "meanReturn": 4.5558356980476413e-7,
      "medianReturn": 0,
      "meanMFE": 4.5558356980476413e-7,
      "meanMAE": 4.5558356980476413e-7
    },
    "3": {
      "count": 130068,
      "positiveCount": 50503,
      "negativeCount": 52490,
      "zeroCount": 27075,
      "meanReturn": 0.000003224191279558484,
      "medianReturn": 0,
      "meanMFE": 0.0007002876184842548,
      "meanMAE": -0.000694738383531744
    },
    "5": {
      "count": 130068,
      "positiveCount": 52333,
      "negativeCount": 54508,
      "zeroCount": 23227,
      "meanReturn": 0.000005435595224760473,
      "medianReturn": 0,
      "meanMFE": 0.0011175510996611457,
      "meanMAE": -0.0011019344107023562
    },
    "10": {
      "count": 130068,
      "positiveCount": 53574,
      "negativeCount": 56096,
      "zeroCount": 20398,
      "meanReturn": 6.935709587961899e-7,
      "medianReturn": 0,
      "meanMFE": 0.0018267165636554224,
      "meanMAE": -0.0017830722564525794
    }
  },
  "downward": {
    "1": {
      "count": 111192,
      "positiveCount": 38433,
      "negativeCount": 39311,
      "zeroCount": 33448,
      "meanReturn": 0.000006344555474392212,
      "medianReturn": 0,
      "meanMFE": 0.000006344555474392212,
      "meanMAE": 0.000006344555474392212
    },
    "3": {
      "count": 111192,
      "positiveCount": 43411,
      "negativeCount": 44600,
      "zeroCount": 23181,
      "meanReturn": 0.000018552865619686124,
      "medianReturn": 0,
      "meanMFE": 0.0007212157789861909,
      "meanMAE": -0.0006952155101144149
    },
    "5": {
      "count": 111192,
      "positiveCount": 44976,
      "negativeCount": 46283,
      "zeroCount": 19933,
      "meanReturn": 0.000026667821062873555,
      "medianReturn": 0,
      "meanMFE": 0.0011503533349916987,
      "meanMAE": -0.0011052448892505022
    },
    "10": {
      "count": 111192,
      "positiveCount": 46008,
      "negativeCount": 47915,
      "zeroCount": 17269,
      "meanReturn": 0.000041380564880385144,
      "medianReturn": 0,
      "meanMFE": 0.001887132988206973,
      "meanMAE": -0.0017878730784106377
    }
  }
}

- Upward exhaustion 5-bar counterexamples: 52333
- Downward exhaustion 5-bar counterexamples: 46283
- Counterexample samples are retained and not reweighted or removed.

## 11. Year / Regime Distribution

Year × State:
{
  "2022": {
    "DOWNWARD_EXHAUSTION_CANDIDATE": 27240,
    "NEUTRAL": 1981,
    "UPWARD_EXHAUSTION_CANDIDATE": 28617
  },
  "2023": {
    "NEUTRAL": 1761,
    "UPWARD_EXHAUSTION_CANDIDATE": 30265,
    "DOWNWARD_EXHAUSTION_CANDIDATE": 25812
  },
  "2024": {
    "NEUTRAL": 1138,
    "DOWNWARD_EXHAUSTION_CANDIDATE": 25267,
    "UPWARD_EXHAUSTION_CANDIDATE": 31433
  },
  "2025": {
    "NEUTRAL": 1391,
    "UPWARD_EXHAUSTION_CANDIDATE": 30655,
    "DOWNWARD_EXHAUSTION_CANDIDATE": 26031
  },
  "2026": {
    "DOWNWARD_EXHAUSTION_CANDIDATE": 6842,
    "NEUTRAL": 312,
    "UPWARD_EXHAUSTION_CANDIDATE": 9098
  }
}

Year × Opportunity:
{
  "2022": {
    "POSITIVE_T_ENVIRONMENT": 27240,
    "NEUTRAL": 1981,
    "COUNTER_T_ENVIRONMENT": 28617
  },
  "2023": {
    "NEUTRAL": 1761,
    "COUNTER_T_ENVIRONMENT": 30265,
    "POSITIVE_T_ENVIRONMENT": 25812
  },
  "2024": {
    "NEUTRAL": 1138,
    "POSITIVE_T_ENVIRONMENT": 25267,
    "COUNTER_T_ENVIRONMENT": 31433
  },
  "2025": {
    "NEUTRAL": 1391,
    "COUNTER_T_ENVIRONMENT": 30655,
    "POSITIVE_T_ENVIRONMENT": 26031
  },
  "2026": {
    "POSITIVE_T_ENVIRONMENT": 6842,
    "NEUTRAL": 312,
    "COUNTER_T_ENVIRONMENT": 9098
  }
}

Year × Exhaustion:
{
  "2022": {
    "DOWNWARD_EXHAUSTION_CANDIDATE": 27240,
    "UPWARD_EXHAUSTION_CANDIDATE": 28617
  },
  "2023": {
    "UPWARD_EXHAUSTION_CANDIDATE": 30265,
    "DOWNWARD_EXHAUSTION_CANDIDATE": 25812
  },
  "2024": {
    "DOWNWARD_EXHAUSTION_CANDIDATE": 25267,
    "UPWARD_EXHAUSTION_CANDIDATE": 31433
  },
  "2025": {
    "UPWARD_EXHAUSTION_CANDIDATE": 30655,
    "DOWNWARD_EXHAUSTION_CANDIDATE": 26031
  },
  "2026": {
    "DOWNWARD_EXHAUSTION_CANDIDATE": 6842,
    "UPWARD_EXHAUSTION_CANDIDATE": 9098
  }
}

## 12. Research Findings

1. The valid state space observed in this asset is concentrated in UPWARD_EXHAUSTION_CANDIDATE, DOWNWARD_EXHAUSTION_CANDIDATE and NEUTRAL.
2. UPTREND, DOWNTREND, PULLBACK and REBOUND have no emitted valid samples; the absence is not repaired in this analysis.
3. Exhaustion precedence is supported by implementation inspection and feature/state co-occurrence evidence.
4. The transition matrix should be reviewed as a coverage/priority diagnostic, not treated as a proof of strategy quality.
5. Counterexamples exist on both exhaustion directions and remain important boundary assets.

## 13. Risks / Limitations

- No human ground-truth state labels are available; potential boundary cases cannot be called misclassifications.
- This report uses historical outcome fields only for post-hoc counterexample analysis; they do not enter State or Opportunity.
- DATA-07 is 1-minute OHLCV research data and cannot validate Tick/L2 or millisecond microstructure hypotheses.
- No Feature, State, Opportunity, Indicator, Reward, T+1, Dataset or sample asset was modified.

## 14. Final Gate

STATE_SPACE_STATUS = CONDITIONAL
STATE_BOUNDARY_STATUS = REVIEW_REQUIRED
EXHAUSTION_OVERRIDE_STATUS = CONFIRMED
PULLBACK_REBOUND_COVERAGE = ABSENT
MODEL_CHANGE = NOT_PROPOSED

T_SAMPLE_RL_ELIGIBLE = FALSE
RL_INTEGRATION = BLOCKED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
PAPER_TRADING = NOT_STARTED
T_DECISION_ENGINE = NOT_STARTED
HARD_STOP = TRUE
