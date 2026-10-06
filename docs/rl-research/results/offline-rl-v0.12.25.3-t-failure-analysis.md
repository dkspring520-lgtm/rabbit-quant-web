# OFFLINE RL V0.12.25.3 — Historical T Failure Analysis & Opportunity Diagnostics

Analysis date: 2026-10-05

Source: V0.12.25.2 DATA-07 benchmark result; no strategy thresholds were changed.

## Gate

BACKTEST_RESULT = GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE
## 1. T Failure Decomposition

DATA-07 source SHA-256: ed2a01e126ff09cadd03b8a0a21c8f1dabdd72c9d1bcda4e421591bebf339472
Bar count: 249917

### BIDIRECTIONAL_T

Diagnostic JSON: {"Failed Rebuy":29,"Missed Trend":39,"Rebuy Too Expensive":29,"Rebuy Opportunity Absent":1,"Execution Timing Failure":0,"End-of-Session Unresolved":1,"T+1 Constraint":0,"Position Constraint":0,"Other Blocked":0}

### EXPERT_PRIOR

Diagnostic JSON: {"Failed Rebuy":48,"Missed Trend":59,"Rebuy Too Expensive":48,"Rebuy Opportunity Absent":1,"Execution Timing Failure":0,"End-of-Session Unresolved":1,"T+1 Constraint":0,"Position Constraint":2395,"Other Blocked":0}

## 2. Sell-to-Rebuy Path Analysis

每次可执行 T cycle 的路径明细如下。lowest/highest、rebuy timestamp、先跌/先涨、MFE 和 MAE 均按当前 DATA-07 observation path 计算。

### BIDIRECTIONAL_T

- executable sell cycles: 39
- DOWN_FIRST: 14
- UP_FIRST: 25
- average MFE: 0.45%
- average MAE: 2.06%

| trade_id | sell timestamp | sell price | lowest | highest | rebuy timestamp | rebuy price | first move | MFE | MAE | outcome |
|---|---|---:|---:|---:|---|---:|---|---:|---:|---|
| trade-1 | 2022-01-04T09:38:00 | 9.658068 | 9.62 | 9.86 | 2022-01-07T09:32:00 | 9.631926 | UP_FIRST | 0.39% | 2.09% | FAILED_REBUY |
| trade-2 | 2022-01-07T09:33:00 | 9.638072 | 9.6 | 9.65 | 2022-01-07T09:44:00 | 9.60192 | UP_FIRST | 0.40% | 0.12% | FAILED_REBUY |
| trade-3 | 2022-01-07T09:49:00 | 9.578084 | 9.52 | 9.58 | 2022-01-07T10:03:00 | 9.521904 | UP_FIRST | 0.61% | 0.02% | SUCCESSFUL_REBUY |
| trade-4 | 2022-01-07T10:06:00 | 9.528094 | 9.45 | 9.51 | 2022-01-07T10:09:00 | 9.45189 | DOWN_FIRST | 0.82% | -0.19% | SUCCESSFUL_REBUY |
| trade-56 | 2022-01-10T09:33:00 | 9.328134 | 9.29 | 12.9 | 2022-05-10T09:46:00 | 9.30186 | UP_FIRST | 0.41% | 38.29% | FAILED_REBUY |
| trade-57 | 2022-05-10T09:47:00 | 9.318136 | 9.28 | 10.46 | 2022-06-22T14:23:00 | 9.281856 | DOWN_FIRST | 0.41% | 12.25% | FAILED_REBUY |
| trade-58 | 2022-06-22T14:28:00 | 9.258148 | 9.23 | 9.28 | 2022-06-22T14:39:00 | 9.231846 | UP_FIRST | 0.30% | 0.24% | FAILED_REBUY |
| trade-59 | 2022-06-22T14:43:00 | 9.228154 | 9.19 | 9.26 | 2022-06-23T09:31:00 | 9.191838 | DOWN_FIRST | 0.41% | 0.35% | FAILED_REBUY |
| trade-60 | 2022-06-23T09:35:00 | 9.208158 | 9.18 | 9.3 | 2022-06-23T10:01:00 | 9.191838 | UP_FIRST | 0.31% | 1.00% | FAILED_REBUY |
| trade-61 | 2022-06-23T10:02:00 | 9.168166 | 9.13 | 9.3 | 2022-06-24T09:34:00 | 9.131826 | UP_FIRST | 0.42% | 1.44% | FAILED_REBUY |
| trade-62 | 2022-06-24T09:37:00 | 9.138172 | 9.11 | 9.13 | 2022-06-24T09:44:00 | 9.121824 | DOWN_FIRST | 0.31% | -0.09% | FAILED_REBUY |
| trade-63 | 2022-06-24T09:45:00 | 9.118176 | 9.04 | 9.53 | 2022-07-06T09:38:00 | 9.041808 | UP_FIRST | 0.86% | 4.52% | SUCCESSFUL_REBUY |
| trade-64 | 2022-07-06T09:41:00 | 9.04819 | 9.03 | 9.13 | 2022-07-06T10:54:00 | 9.031806 | UP_FIRST | 0.20% | 0.90% | FAILED_REBUY |
| trade-65 | 2022-07-06T10:57:00 | 9.028194 | 9.01 | 9.05 | 2022-07-06T13:38:00 | 9.011802 | DOWN_FIRST | 0.20% | 0.24% | FAILED_REBUY |
| trade-66 | 2022-07-06T13:40:00 | 9.018196 | 9 | 9.03 | 2022-07-06T14:01:00 | 9.011802 | DOWN_FIRST | 0.20% | 0.13% | FAILED_REBUY |
| trade-82 | 2022-07-07T09:33:00 | 8.968206 | 8.93 | 8.97 | 2022-07-07T09:36:00 | 8.941788 | UP_FIRST | 0.43% | 0.02% | FAILED_REBUY |
| trade-83 | 2022-07-07T09:37:00 | 8.928214 | 8.81 | 9.17 | 2022-07-13T09:31:00 | 8.811762 | DOWN_FIRST | 1.32% | 2.71% | SUCCESSFUL_REBUY |
| trade-84 | 2022-07-13T09:35:00 | 8.788242 | 8.76 | 8.77 | 2022-07-13T09:37:00 | 8.761752 | DOWN_FIRST | 0.32% | -0.21% | FAILED_REBUY |
| trade-85 | 2022-07-13T09:40:00 | 8.768246 | 8.75 | 8.77 | 2022-07-13T09:51:00 | 8.761752 | UP_FIRST | 0.21% | 0.02% | FAILED_REBUY |
| trade-86 | 2022-07-13T09:52:00 | 8.758248 | 8.74 | 8.76 | 2022-07-13T09:55:00 | 8.741748 | UP_FIRST | 0.21% | 0.02% | FAILED_REBUY |
| trade-139 | 2022-07-14T09:36:00 | 8.658268 | 8.64 | 8.68 | 2022-07-14T09:46:00 | 8.65173 | UP_FIRST | 0.21% | 0.25% | FAILED_REBUY |
| trade-140 | 2022-07-14T09:47:00 | 8.658268 | 8.64 | 8.68 | 2022-07-14T09:58:00 | 8.65173 | UP_FIRST | 0.21% | 0.25% | FAILED_REBUY |
| trade-141 | 2022-07-14T09:59:00 | 8.658268 | 8.64 | 8.66 | 2022-07-14T10:07:00 | 8.641728 | UP_FIRST | 0.21% | 0.02% | FAILED_REBUY |
| trade-192 | 2022-07-15T09:34:00 | 8.488302 | 8.47 | 8.47 | 2022-07-15T09:36:00 | 8.471694 | DOWN_FIRST | 0.22% | -0.22% | FAILED_REBUY |
| trade-193 | 2022-07-15T09:40:00 | 8.468306 | 8.45 | 8.62 | 2022-07-15T14:04:00 | 8.461692 | UP_FIRST | 0.22% | 1.79% | FAILED_REBUY |
| trade-194 | 2022-07-15T14:05:00 | 8.458308 | 8.44 | 8.46 | 2022-07-15T14:10:00 | 8.45169 | DOWN_FIRST | 0.22% | 0.02% | FAILED_REBUY |
| trade-205 | 2022-07-18T09:31:00 | 8.458308 | 8.41 | 8.44 | 2022-07-18T09:33:00 | 8.411682 | DOWN_FIRST | 0.57% | -0.22% | SUCCESSFUL_REBUY |
| trade-206 | 2022-07-18T09:35:00 | 8.438312 | 8.22 | 9.37 | 2022-09-26T09:31:00 | 8.221644 | UP_FIRST | 2.59% | 11.04% | SUCCESSFUL_REBUY |
| trade-207 | 2022-09-26T09:34:00 | 8.208358 | 8.14 | 8.24 | 2022-09-26T09:43:00 | 8.141628 | UP_FIRST | 0.83% | 0.39% | SUCCESSFUL_REBUY |
| trade-208 | 2022-09-26T09:46:00 | 8.19836 | 8.14 | 8.2 | 2022-09-26T09:49:00 | 8.141628 | UP_FIRST | 0.71% | 0.02% | SUCCESSFUL_REBUY |
| trade-209 | 2022-09-26T09:51:00 | 8.158368 | 8.14 | 8.18 | 2022-09-26T09:57:00 | 8.141628 | UP_FIRST | 0.23% | 0.27% | FAILED_REBUY |
| trade-266 | 2022-09-27T09:32:00 | 7.758448 | 7.73 | 7.8 | 2022-09-27T09:38:00 | 7.731546 | UP_FIRST | 0.37% | 0.54% | FAILED_REBUY |
| trade-267 | 2022-09-27T09:40:00 | 7.74845 | 7.68 | 7.72 | 2022-09-27T09:42:00 | 7.681536 | DOWN_FIRST | 0.88% | -0.37% | SUCCESSFUL_REBUY |
| trade-268 | 2022-09-27T09:47:00 | 7.658468 | 7.64 | 7.67 | 2022-09-27T09:50:00 | 7.671534 | UP_FIRST | 0.24% | 0.15% | FAILED_REBUY |
| trade-337 | 2022-09-28T09:34:00 | 7.718456 | 7.7 | 7.72 | 2022-09-28T09:37:00 | 7.711542 | UP_FIRST | 0.24% | 0.02% | FAILED_REBUY |
| trade-338 | 2022-09-28T09:38:00 | 7.688462 | 7.66 | 7.68 | 2022-09-28T09:42:00 | 7.661532 | DOWN_FIRST | 0.37% | -0.11% | FAILED_REBUY |
| trade-339 | 2022-09-28T09:45:00 | 7.678464 | 7.66 | 7.67 | 2022-09-28T09:49:00 | 7.661532 | DOWN_FIRST | 0.24% | -0.11% | FAILED_REBUY |
| trade-397 | 2022-09-29T09:31:00 | 7.688462 | 7.67 | 7.81 | 2022-09-29T10:09:00 | 7.671534 | UP_FIRST | 0.24% | 1.58% | FAILED_REBUY |
| trade-398 | 2022-09-29T10:12:00 | 7.668466 | 7.66 | 7.77 | N/A | 0 | UP_FIRST | 0.11% | 1.32% | UNRESOLVED |

### EXPERT_PRIOR

- executable sell cycles: 62
- DOWN_FIRST: 22
- UP_FIRST: 40
- average MFE: 0.51%
- average MAE: 1.86%

| trade_id | sell timestamp | sell price | lowest | highest | rebuy timestamp | rebuy price | first move | MFE | MAE | outcome |
|---|---|---:|---:|---:|---|---:|---|---:|---:|---|
| trade-1 | 2022-01-04T11:25:00 | 9.688062 | 9.66 | 9.86 | 2022-01-06T10:17:00 | 9.661932 | DOWN_FIRST | 0.29% | 1.77% | FAILED_REBUY |
| trade-8 | 2022-01-07T13:17:00 | 9.478104 | 9.44 | 9.49 | 2022-01-07T13:27:00 | 9.441888 | UP_FIRST | 0.40% | 0.13% | FAILED_REBUY |
| trade-9 | 2022-01-10T10:40:00 | 9.408118 | 9.38 | 9.42 | 2022-01-10T10:59:00 | 9.391878 | UP_FIRST | 0.30% | 0.13% | FAILED_REBUY |
| trade-10 | 2022-01-11T10:23:00 | 9.428114 | 9.4 | 12.12 | 2022-03-16T09:39:00 | 9.45189 | UP_FIRST | 0.30% | 28.55% | FAILED_REBUY |
| trade-123 | 2022-03-17T09:33:00 | 10.287942 | 10.26 | 10.27 | 2022-03-17T09:35:00 | 10.272054 | DOWN_FIRST | 0.27% | -0.17% | FAILED_REBUY |
| trade-124 | 2022-03-17T10:17:00 | 10.257948 | 10.22 | 12.9 | 2022-04-26T09:48:00 | 10.222044 | UP_FIRST | 0.37% | 25.76% | FAILED_REBUY |
| trade-205 | 2022-04-26T10:33:00 | 10.417916 | 10.37 | 10.42 | 2022-04-26T10:36:00 | 10.40208 | UP_FIRST | 0.46% | 0.02% | FAILED_REBUY |
| trade-206 | 2022-04-27T11:28:00 | 10.607878 | 10.58 | 10.97 | 2022-04-28T13:34:00 | 10.592118 | UP_FIRST | 0.26% | 3.41% | FAILED_REBUY |
| trade-210 | 2022-04-28T13:51:00 | 10.637872 | 10.6 | 11.07 | 2022-05-05T10:38:00 | 10.622124 | DOWN_FIRST | 0.36% | 4.06% | FAILED_REBUY |
| trade-216 | 2022-05-05T13:02:00 | 10.737852 | 10.7 | 10.73 | 2022-05-05T13:06:00 | 10.70214 | DOWN_FIRST | 0.35% | -0.07% | FAILED_REBUY |
| trade-217 | 2022-05-05T13:31:00 | 10.777844 | 10.38 | 10.88 | 2022-05-06T09:31:00 | 10.382076 | DOWN_FIRST | 3.69% | 0.95% | SUCCESSFUL_REBUY |
| trade-221 | 2022-05-09T14:24:00 | 9.718056 | 9.43 | 9.81 | 2022-05-10T09:31:00 | 9.431886 | UP_FIRST | 2.96% | 0.95% | SUCCESSFUL_REBUY |
| trade-222 | 2022-05-10T13:21:00 | 9.468106 | 9.44 | 9.65 | 2022-05-11T09:35:00 | 9.45189 | UP_FIRST | 0.30% | 1.92% | FAILED_REBUY |
| trade-227 | 2022-05-11T10:12:00 | 9.638072 | 9.6 | 9.94 | 2022-05-12T09:31:00 | 9.631926 | UP_FIRST | 0.40% | 3.13% | FAILED_REBUY |
| trade-230 | 2022-05-12T14:45:00 | 9.518096 | 9.47 | 9.55 | 2022-05-13T09:31:00 | 9.471894 | UP_FIRST | 0.51% | 0.34% | SUCCESSFUL_REBUY |
| trade-231 | 2022-05-13T13:42:00 | 9.488102 | 9.44 | 10.46 | 2022-06-21T09:50:00 | 9.441888 | UP_FIRST | 0.51% | 10.24% | SUCCESSFUL_REBUY |
| trade-301 | 2022-06-23T13:33:00 | 9.278144 | 9.25 | 9.28 | 2022-06-23T13:50:00 | 9.261852 | DOWN_FIRST | 0.30% | 0.02% | FAILED_REBUY |
| trade-303 | 2022-06-28T10:58:00 | 9.268146 | 9.24 | 9.28 | 2022-06-28T11:24:00 | 9.25185 | DOWN_FIRST | 0.30% | 0.13% | FAILED_REBUY |
| trade-304 | 2022-06-30T09:33:00 | 9.29814 | 9.27 | 9.37 | 2022-06-30T10:21:00 | 9.271854 | UP_FIRST | 0.30% | 0.77% | FAILED_REBUY |
| trade-306 | 2022-06-30T10:33:00 | 9.328134 | 9.3 | 9.32 | 2022-06-30T10:38:00 | 9.321864 | DOWN_FIRST | 0.30% | -0.09% | FAILED_REBUY |
| trade-307 | 2022-06-30T10:59:00 | 9.328134 | 9.3 | 9.34 | 2022-06-30T14:37:00 | 9.30186 | UP_FIRST | 0.30% | 0.13% | FAILED_REBUY |
| trade-308 | 2022-07-01T10:33:00 | 9.338132 | 9.31 | 9.34 | 2022-07-01T10:39:00 | 9.321864 | UP_FIRST | 0.30% | 0.02% | FAILED_REBUY |
| trade-309 | 2022-07-01T11:08:00 | 9.318136 | 9.14 | 9.53 | 2022-07-06T09:31:00 | 9.141828 | UP_FIRST | 1.91% | 2.27% | SUCCESSFUL_REBUY |
| trade-317 | 2022-07-06T11:05:00 | 9.038192 | 9.02 | 9.05 | 2022-07-06T13:09:00 | 9.021804 | UP_FIRST | 0.20% | 0.13% | FAILED_REBUY |
| trade-318 | 2022-07-07T09:30:00 | 8.988202 | 8.91 | 8.92 | 2022-07-07T09:32:00 | 8.921784 | DOWN_FIRST | 0.87% | -0.76% | SUCCESSFUL_REBUY |
| trade-319 | 2022-07-07T11:04:00 | 9.058188 | 9.04 | 9.14 | 2022-07-07T14:15:00 | 9.041808 | DOWN_FIRST | 0.20% | 0.90% | FAILED_REBUY |
| trade-321 | 2022-07-08T09:32:00 | 9.118176 | 9.07 | 9.11 | 2022-07-08T09:38:00 | 9.071814 | DOWN_FIRST | 0.53% | -0.09% | SUCCESSFUL_REBUY |
| trade-322 | 2022-07-08T10:31:00 | 9.108178 | 9.08 | 9.14 | 2022-07-08T13:31:00 | 9.091818 | UP_FIRST | 0.31% | 0.35% | FAILED_REBUY |
| trade-326 | 2022-07-08T13:52:00 | 9.068186 | 9.05 | 9.15 | 2022-07-11T09:32:00 | 9.131826 | UP_FIRST | 0.20% | 0.90% | FAILED_REBUY |
| trade-327 | 2022-07-11T14:36:00 | 9.038192 | 8.98 | 9.05 | 2022-07-12T09:31:00 | 8.981796 | DOWN_FIRST | 0.64% | 0.13% | SUCCESSFUL_REBUY |
| trade-328 | 2022-07-13T10:51:00 | 8.74825 | 8.73 | 8.75 | 2022-07-13T11:22:00 | 8.741748 | UP_FIRST | 0.21% | 0.02% | FAILED_REBUY |
| trade-329 | 2022-07-14T13:12:00 | 8.74825 | 8.72 | 8.75 | 2022-07-14T13:16:00 | 8.721744 | UP_FIRST | 0.32% | 0.02% | FAILED_REBUY |
| trade-330 | 2022-07-15T09:30:00 | 8.518296 | 8.46 | 8.5 | 2022-07-15T09:32:00 | 8.461692 | DOWN_FIRST | 0.68% | -0.21% | SUCCESSFUL_REBUY |
| trade-331 | 2022-07-18T09:33:00 | 8.408318 | 8.22 | 9.37 | 2022-09-26T09:31:00 | 8.221644 | UP_FIRST | 2.24% | 11.44% | SUCCESSFUL_REBUY |
| trade-439 | 2022-09-27T11:29:00 | 7.668466 | 7.65 | 7.88 | 2022-09-28T09:44:00 | 7.671534 | UP_FIRST | 0.24% | 2.76% | FAILED_REBUY |
| trade-446 | 2022-09-28T13:28:00 | 7.578484 | 7.56 | 7.59 | 2022-09-28T13:33:00 | 7.561512 | UP_FIRST | 0.24% | 0.15% | FAILED_REBUY |
| trade-447 | 2022-09-28T14:39:00 | 7.518496 | 7.49 | 7.52 | 2022-09-28T14:49:00 | 7.491498 | DOWN_FIRST | 0.38% | 0.02% | FAILED_REBUY |
| trade-448 | 2022-09-29T11:26:00 | 7.69846 | 7.68 | 7.77 | 2022-09-29T13:56:00 | 7.691538 | UP_FIRST | 0.24% | 0.93% | FAILED_REBUY |
| trade-450 | 2022-09-29T14:02:00 | 7.688462 | 7.67 | 7.7 | 2022-09-29T14:14:00 | 7.671534 | UP_FIRST | 0.24% | 0.15% | FAILED_REBUY |
| trade-451 | 2022-09-30T09:32:00 | 7.768446 | 7.75 | 7.91 | 2022-10-11T09:57:00 | 7.771554 | UP_FIRST | 0.24% | 1.82% | FAILED_REBUY |
| trade-458 | 2022-10-11T10:21:00 | 7.738452 | 7.72 | 7.73 | 2022-10-11T10:24:00 | 7.721544 | DOWN_FIRST | 0.24% | -0.11% | FAILED_REBUY |
| trade-459 | 2022-10-11T11:12:00 | 7.778444 | 7.75 | 7.96 | 2022-10-12T13:07:00 | 7.75155 | UP_FIRST | 0.37% | 2.33% | FAILED_REBUY |
| trade-464 | 2022-10-12T13:51:00 | 7.878424 | 7.86 | 8 | 2022-10-13T10:14:00 | 7.871574 | UP_FIRST | 0.23% | 1.54% | FAILED_REBUY |
| trade-467 | 2022-10-13T11:25:00 | 7.858428 | 7.84 | 7.87 | 2022-10-13T13:03:00 | 7.841568 | UP_FIRST | 0.23% | 0.15% | FAILED_REBUY |
| trade-468 | 2022-10-13T13:42:00 | 7.868426 | 7.85 | 7.88 | 2022-10-13T13:51:00 | 7.85157 | UP_FIRST | 0.23% | 0.15% | FAILED_REBUY |
| trade-470 | 2022-10-14T09:32:00 | 7.89842 | 7.86 | 7.9 | 2022-10-14T09:36:00 | 7.861572 | UP_FIRST | 0.49% | 0.02% | FAILED_REBUY |
| trade-471 | 2022-10-14T10:25:00 | 7.918416 | 7.9 | 7.91 | 2022-10-14T10:27:00 | 7.911582 | DOWN_FIRST | 0.23% | -0.11% | FAILED_REBUY |
| trade-472 | 2022-10-14T13:07:00 | 7.928414 | 7.87 | 8.01 | 2022-10-17T09:31:00 | 7.871574 | UP_FIRST | 0.74% | 1.03% | SUCCESSFUL_REBUY |
| trade-473 | 2022-10-17T11:16:00 | 7.968406 | 7.95 | 8.11 | 2022-10-19T13:24:00 | 7.961592 | UP_FIRST | 0.23% | 1.78% | FAILED_REBUY |
| trade-476 | 2022-10-20T10:36:00 | 7.828434 | 7.81 | 7.83 | 2022-10-20T10:41:00 | 7.811562 | DOWN_FIRST | 0.24% | 0.02% | FAILED_REBUY |
| trade-477 | 2022-10-21T09:33:00 | 7.988402 | 7.96 | 7.99 | 2022-10-21T09:37:00 | 7.961592 | UP_FIRST | 0.36% | 0.02% | FAILED_REBUY |
| trade-478 | 2022-10-21T10:06:00 | 7.988402 | 7.97 | 7.98 | 2022-10-21T10:10:00 | 7.981596 | DOWN_FIRST | 0.23% | -0.11% | FAILED_REBUY |
| trade-479 | 2022-10-21T11:10:00 | 8.018396 | 8 | 8.02 | 2022-10-21T11:18:00 | 8.011602 | DOWN_FIRST | 0.23% | 0.02% | FAILED_REBUY |
| trade-481 | 2022-10-25T11:26:00 | 7.94841 | 7.92 | 7.99 | 2022-10-25T13:02:00 | 7.931586 | UP_FIRST | 0.36% | 0.52% | FAILED_REBUY |
| trade-483 | 2022-10-27T09:35:00 | 8.178364 | 8.11 | 8.36 | 2022-10-28T09:31:00 | 8.111622 | DOWN_FIRST | 0.84% | 2.22% | SUCCESSFUL_REBUY |
| trade-484 | 2022-10-28T10:59:00 | 8.178364 | 8.16 | 8.29 | 2022-10-28T13:24:00 | 8.161632 | UP_FIRST | 0.22% | 1.36% | FAILED_REBUY |
| trade-485 | 2022-11-01T09:30:00 | 7.94841 | 7.92 | 7.97 | 2022-11-01T09:37:00 | 7.921584 | UP_FIRST | 0.36% | 0.27% | FAILED_REBUY |
| trade-486 | 2022-11-01T10:31:00 | 8.088382 | 8.06 | 8.12 | 2022-11-01T11:08:00 | 8.061612 | UP_FIRST | 0.35% | 0.39% | FAILED_REBUY |
| trade-488 | 2022-11-01T13:48:00 | 8.09838 | 8.08 | 8.09 | 2022-11-01T13:51:00 | 8.091618 | DOWN_FIRST | 0.23% | -0.10% | FAILED_REBUY |
| trade-489 | 2022-11-02T13:03:00 | 8.238352 | 8.12 | 8.32 | 2022-11-03T09:31:00 | 8.141628 | UP_FIRST | 1.44% | 0.99% | SUCCESSFUL_REBUY |
| trade-493 | 2022-11-03T13:09:00 | 8.088382 | 8.07 | 8.09 | 2022-11-03T13:12:00 | 8.091618 | DOWN_FIRST | 0.23% | 0.02% | FAILED_REBUY |
| trade-494 | 2022-11-03T14:45:00 | 8.128374 | 8.12 | 8.14 | N/A | 0 | UP_FIRST | 0.10% | 0.14% | UNRESOLVED |

## 3. Missed Trend Analysis
### BIDIRECTIONAL_T

- samples with later upside: 31
- average continued upside: 2.65%
- maximum continued upside: 38.29%
- 15 bars theoretical opportunity rate: 92.31%
- 30 bars theoretical opportunity rate: 92.31%
- End Session theoretical opportunity rate: 92.31%
- Next Session theoretical opportunity rate: 92.31%

### EXPERT_PRIOR

- samples with later upside: 52
- average continued upside: 2.26%
- maximum continued upside: 28.55%
- 15 bars theoretical opportunity rate: 83.87%
- 30 bars theoretical opportunity rate: 83.87%
- End Session theoretical opportunity rate: 83.87%
- Next Session theoretical opportunity rate: 95.16%

## 4. Successful Rebuy Analysis

说明：Opportunity Type 和 Momentum Phase 分组统计基于可执行 T cycle；average T return 为扣费后 cycle profit / sell notional。

### BIDIRECTIONAL_T

- successful cycles: 9
- cycles with recorded rebuy timestamp: 9
- average rebuy price advantage: 1.00%
- opportunity attribution: {"RANGE_REVERSAL":{"sampleCount":21,"successRate":0.2,"averageTReturn":-0.00014099845688507804,"failedRebuyRate":0.8,"missedTrendRate":1},"TREND_BREAKOUT":{"sampleCount":3,"successRate":0.3333333333333333,"averageTReturn":-0.0009356005552050399,"failedRebuyRate":0.6666666666666666,"missedTrendRate":1},"UNAVAILABLE":{"sampleCount":15,"successRate":0.26666666666666666,"averageTReturn":-0.0006494551995236131,"failedRebuyRate":0.7333333333333333,"missedTrendRate":1}}
- momentum phase attribution: {"REVERSAL_CONFIRMED":{"sampleCount":23,"successRate":0.3181818181818182,"averageTReturn":0.00014387032957758388,"failedRebuyRate":0.6818181818181818,"missedTrendRate":1},"TREND_ACCELERATION":{"sampleCount":2,"successRate":0.5,"averageTReturn":-0.0007811041857624847,"failedRebuyRate":0.5,"missedTrendRate":1},"TREND_MATURE":{"sampleCount":14,"successRate":0.07142857142857142,"averageTReturn":-0.0012122526910966248,"failedRebuyRate":0.9285714285714286,"missedTrendRate":1}}

### EXPERT_PRIOR

- successful cycles: 13
- cycles with recorded rebuy timestamp: 13
- average rebuy price advantage: 1.30%
- opportunity attribution: {"CAPITAL_FLOW_SPIKE_MOMENTUM_EXHAUSTION":{"sampleCount":62,"successRate":0.21311475409836064,"averageTReturn":-0.00027011744185913235,"failedRebuyRate":0.7868852459016393,"missedTrendRate":0.9516129032258065}}
- momentum phase attribution: {"MOMENTUM_EXHAUSTION":{"sampleCount":16,"successRate":0.1875,"averageTReturn":-0.001187759261313444,"failedRebuyRate":0.8125,"missedTrendRate":1},"REVERSAL_CONFIRMED":{"sampleCount":13,"successRate":0.3076923076923077,"averageTReturn":0.0035899187521077074,"failedRebuyRate":0.6923076923076923,"missedTrendRate":1},"TREND_ACCELERATION":{"sampleCount":14,"successRate":0,"averageTReturn":-0.0026723053892090468,"failedRebuyRate":1,"missedTrendRate":1},"TREND_MATURE":{"sampleCount":19,"successRate":0.3333333333333333,"averageTReturn":-0.0003738713389369738,"failedRebuyRate":0.6666666666666666,"missedTrendRate":0.8421052631578947}}

## 5. Opportunity Attribution

A/B/C/D Opportunity Type 与四类 Momentum Phase 均保持 candidate attribution，不转化为硬规则。

### BIDIRECTIONAL_T

Opportunity Type: {"RANGE_REVERSAL":{"sampleCount":21,"successRate":0.2,"averageTReturn":-0.00014099845688507804,"failedRebuyRate":0.8,"missedTrendRate":1},"TREND_BREAKOUT":{"sampleCount":3,"successRate":0.3333333333333333,"averageTReturn":-0.0009356005552050399,"failedRebuyRate":0.6666666666666666,"missedTrendRate":1},"UNAVAILABLE":{"sampleCount":15,"successRate":0.26666666666666666,"averageTReturn":-0.0006494551995236131,"failedRebuyRate":0.7333333333333333,"missedTrendRate":1}}
Momentum Phase: {"REVERSAL_CONFIRMED":{"sampleCount":23,"successRate":0.3181818181818182,"averageTReturn":0.00014387032957758388,"failedRebuyRate":0.6818181818181818,"missedTrendRate":1},"TREND_ACCELERATION":{"sampleCount":2,"successRate":0.5,"averageTReturn":-0.0007811041857624847,"failedRebuyRate":0.5,"missedTrendRate":1},"TREND_MATURE":{"sampleCount":14,"successRate":0.07142857142857142,"averageTReturn":-0.0012122526910966248,"failedRebuyRate":0.9285714285714286,"missedTrendRate":1}}

### EXPERT_PRIOR

Opportunity Type: {"CAPITAL_FLOW_SPIKE_MOMENTUM_EXHAUSTION":{"sampleCount":62,"successRate":0.21311475409836064,"averageTReturn":-0.00027011744185913235,"failedRebuyRate":0.7868852459016393,"missedTrendRate":0.9516129032258065}}
Momentum Phase: {"MOMENTUM_EXHAUSTION":{"sampleCount":16,"successRate":0.1875,"averageTReturn":-0.001187759261313444,"failedRebuyRate":0.8125,"missedTrendRate":1},"REVERSAL_CONFIRMED":{"sampleCount":13,"successRate":0.3076923076923077,"averageTReturn":0.0035899187521077074,"failedRebuyRate":0.6923076923076923,"missedTrendRate":1},"TREND_ACCELERATION":{"sampleCount":14,"successRate":0,"averageTReturn":-0.0026723053892090468,"failedRebuyRate":1,"missedTrendRate":1},"TREND_MATURE":{"sampleCount":19,"successRate":0.3333333333333333,"averageTReturn":-0.0003738713389369738,"failedRebuyRate":0.6666666666666666,"missedTrendRate":0.8421052631578947}}

## 6. Position Size Diagnostics

固定 corePosition=34000；T Position 按目标总仓比例换算并向下取整到 100 股。仅作历史诊断，不选择最优参数。

[
  {
    "strategy": "BIDIRECTIONAL_T",
    "targetRatio": 0.05,
    "tPosition": 1700,
    "tProfit": -265.697594,
    "maximumDrawdown": 0.204385,
    "failedRebuyRate": 0.947368,
    "missedTrendRisk": 7.980308,
    "successRate": 0.052632
  },
  {
    "strategy": "EXPERT_PRIOR",
    "targetRatio": 0.05,
    "tPosition": 1700,
    "tProfit": -410.185939,
    "maximumDrawdown": 0.204393,
    "failedRebuyRate": 0.934426,
    "missedTrendRisk": 9.085019,
    "successRate": 0.065574
  },
  {
    "strategy": "BIDIRECTIONAL_T",
    "targetRatio": 0.08,
    "tPosition": 2900,
    "tProfit": -151.395195,
    "maximumDrawdown": 0.206708,
    "failedRebuyRate": 0.789474,
    "missedTrendRisk": 15.960616,
    "successRate": 0.210526
  },
  {
    "strategy": "EXPERT_PRIOR",
    "targetRatio": 0.08,
    "tPosition": 2900,
    "tProfit": -210.371879,
    "maximumDrawdown": 0.206706,
    "failedRebuyRate": 0.836066,
    "missedTrendRisk": 18.170037,
    "successRate": 0.163934
  },
  {
    "strategy": "BIDIRECTIONAL_T",
    "targetRatio": 0.1,
    "tPosition": 3700,
    "tProfit": -37.092787,
    "maximumDrawdown": 0.208117,
    "failedRebuyRate": 0.763158,
    "missedTrendRisk": 23.940924,
    "successRate": 0.236842
  },
  {
    "strategy": "EXPERT_PRIOR",
    "targetRatio": 0.1,
    "tPosition": 3700,
    "tProfit": -10.557819,
    "maximumDrawdown": 0.208104,
    "failedRebuyRate": 0.786885,
    "missedTrendRisk": 27.255056,
    "successRate": 0.213115
  },
  {
    "strategy": "BIDIRECTIONAL_T",
    "targetRatio": 0.15,
    "tPosition": 6000,
    "tProfit": 305.814422,
    "maximumDrawdown": 0.211951,
    "failedRebuyRate": 0.473684,
    "missedTrendRisk": 47.881849,
    "successRate": 0.526316
  },
  {
    "strategy": "EXPERT_PRIOR",
    "targetRatio": 0.15,
    "tPosition": 6000,
    "tProfit": 588.884356,
    "maximumDrawdown": 0.211908,
    "failedRebuyRate": 0.57377,
    "missedTrendRisk": 54.510112,
    "successRate": 0.42623
  },
  {
    "strategy": "BIDIRECTIONAL_T",
    "targetRatio": 0.2,
    "tPosition": 8500,
    "tProfit": 534.419228,
    "maximumDrawdown": 0.216152,
    "failedRebuyRate": 0.394737,
    "missedTrendRisk": 63.842465,
    "successRate": 0.605263
  },
  {
    "strategy": "EXPERT_PRIOR",
    "targetRatio": 0.2,
    "tPosition": 8500,
    "tProfit": 988.51248,
    "maximumDrawdown": 0.21609,
    "failedRebuyRate": 0.442623,
    "missedTrendRisk": 72.68015,
    "successRate": 0.557377
  }
]


## 7. Evaluation Window Sensitivity

理论机会表示窗口内存在扣除估算成本后有利的最低价；actual successful rebuy 仍要求真实 ledger 回补。

{
  "BIDIRECTIONAL_T": {
    "15 bars": {
      "evaluable": 39,
      "theoreticalOpportunity": 13,
      "theoreticalRate": 0.3333333333333333,
      "actualSuccessfulRebuy": 6,
      "actualRate": 0.15384615384615385
    },
    "30 bars": {
      "evaluable": 39,
      "theoreticalOpportunity": 17,
      "theoreticalRate": 0.4358974358974359,
      "actualSuccessfulRebuy": 6,
      "actualRate": 0.15384615384615385
    },
    "End Session": {
      "evaluable": 39,
      "theoreticalOpportunity": 27,
      "theoreticalRate": 0.6923076923076923,
      "actualSuccessfulRebuy": 6,
      "actualRate": 0.15384615384615385
    },
    "Next Session": {
      "evaluable": 39,
      "theoreticalOpportunity": 30,
      "theoreticalRate": 0.7692307692307693,
      "actualSuccessfulRebuy": 6,
      "actualRate": 0.15384615384615385
    }
  },
  "EXPERT_PRIOR": {
    "15 bars": {
      "evaluable": 62,
      "theoreticalOpportunity": 10,
      "theoreticalRate": 0.16129032258064516,
      "actualSuccessfulRebuy": 3,
      "actualRate": 0.04838709677419355
    },
    "30 bars": {
      "evaluable": 62,
      "theoreticalOpportunity": 12,
      "theoreticalRate": 0.1935483870967742,
      "actualSuccessfulRebuy": 3,
      "actualRate": 0.04838709677419355
    },
    "End Session": {
      "evaluable": 62,
      "theoreticalOpportunity": 18,
      "theoreticalRate": 0.2903225806451613,
      "actualSuccessfulRebuy": 3,
      "actualRate": 0.04838709677419355
    },
    "Next Session": {
      "evaluable": 62,
      "theoreticalOpportunity": 38,
      "theoreticalRate": 0.6129032258064516,
      "actualSuccessfulRebuy": 10,
      "actualRate": 0.16129032258064516
    }
  }
}


## 8. DATA Granularity Limit

DATA-07 是 1-minute historical research data，只能验证 coarse-grained T hypothesis，不能证明 second-level 或 millisecond-level microstructure hypothesis。

- V1：1m historical validation
- V2：Tick/L2/Order Flow research
- V3：100–300ms real-time simulation

## 9. Expert Prior Principle

Expert Pattern = Candidate Feature / Prior
Learned Policy = Future Model
本次诊断不修改 MACD threshold、volume threshold、price threshold 或 T size threshold。

## 10. Conclusions

- 当前失败由 failed rebuy、missed trend、T+1/position blocking 和窗口内真实回补不足共同构成。
- 理论窗口机会率高于实际成功率时，execution/accounting/evaluation definition 与策略本身需要分开审查。
- BUY_HOLD 仍是当前历史结果基准；本报告不自动批准任何策略或参数。
- V1 结果不能外推为 V2/V3 微观结构优势。

## Final Gate

BACKTEST_RESULT = GENERATED
VALUE_Q_TARGET = BLOCKED
RL_TRAINING = NOT_STARTED
HUMAN_REVIEW_REQUIRED = TRUE
HARD_STOP = TRUE`n