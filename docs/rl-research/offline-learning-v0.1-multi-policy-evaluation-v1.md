# Offline Learning V0.1 Multi-Policy Evaluation V1

## Shared Replay Context

完整 DATA-07 TEST window 使用一次 shared context：

- barCount: `30,848`
- stateSequence: shared
- featureSnapshot: shared
- predictionSequence: shared
- futureReturnIndex: shared
- resolvedSamples: shared
- contextHash: `a833c5b68c73ee491d8368b738da0ca17a3e8818dbbc61e9c239f5e19180335b`

## Research Metrics

| strategy | tradeCount | winRate | grossReturn | netReturn |
|---|---:|---:|---:|---:|
| Expert | 5,622 | 0.084428 | 0.147139 | unavailable |
| Learned | 9,081 | 0.025095 | 0.394946 | unavailable |
| AlwaysWait | 0 | 0 | 0 | unavailable |
| MajorityClass | 0 | 0 | 0 | unavailable |
| SeededRandom | 5,524 | 0.084428 | 0.147139 | unavailable |

其他统一字段已生成：averageReturn、medianReturn、profitFactor、MFE、MAE、holdingTime、drawdown。该路径保持统一 future resolver 和 action selection，但 `costModelUnavailable=true`，Net Return 不做猜测。

## Gate

`OFFLINE_MODEL_READY = BLOCKED`。

共享 context 已解决五组策略重复构建导致的超时；仍需把该 context 接回正式 HistoricalReplayEngine 的账户/成本结算，完成 Gross/Net 对账、ReplaySnapshot 双跑和 reference equivalence，才能进入 Policy Replay Closure。
