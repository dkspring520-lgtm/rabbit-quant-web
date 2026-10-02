# Replay Performance Optimization V1

真实 DATA-07 TEST window 已完成 cache 构建：

- barCount: `30,848`
- stateSequence: `30,848`
- featureSnapshot: `30,848`
- predictionSequence: `30,848`
- futureReturnIndex: `30,848`
- measured cache build time: `2356.47ms`

当前仍为 `OFFLINE_MODEL_READY = BLOCKED`。这次 cache 构建不是完整 HistoricalReplay/PerformanceAnalytics 执行；beforeRuntime、speedup、五组策略 Gross/Net 指标尚未取得。当前比较输出不能作为 reference-vs-optimized 等价性证明，必须保留为未完成，不能把 mismatch 结果解释为收益差异。

剩余缺口：完整执行五组策略、逐 sample reference equivalence、成本对账、ReplaySnapshot 双跑。
