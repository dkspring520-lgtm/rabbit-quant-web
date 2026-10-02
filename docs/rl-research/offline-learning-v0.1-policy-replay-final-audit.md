# OFFLINE LEARNING V0.1 POLICY REPLAY CLOSURE FINAL AUDIT

审计 commit：`f328aa4b64d69610a84e9a2183a08ceba813e7d8`。

## Replay Performance

当前 runner 固定使用 V0.2 TEST split 和 `precomputeFactors=true`。代码定义了 TEST replay，但当前已保存结果明确记录 30,848-bar window 未完整运行。

- testStart / testEnd：由 `split.test[0]` / `split.test.at(-1)` 派生
- barCount：目标 `30,848` TEST bars
- sampleCount：未取得有效完成结果
- runtime：未取得

因此性能闭环不通过。

## Replay Equivalence

仓库没有已完成的 reference-vs-optimized 逐条比较结果。timestamp、sampleId、action、prediction、futureReturn、reward 的 mismatchCount 未取得，不能假设为 0。

## Five Strategy Performance

代码路径中定义了 LearnedPolicy、Expert、AlwaysWait、MajorityClass、SeededRandom 的 replay 计划，但没有完整 TEST window 的有效运行输出。因此 tradeCount、winRate、averageReturn、medianReturn、profitFactor、MFE、MAE、holdingTime、drawdown 均未认证。

## Gross / Net

成本配置在 runner 中有记录，但现有报告明确将 grossPerformance 标记为 unavailable，且没有完成的 grossReturn/netReturn 对账结果。最终审计标记：`costModelUnavailable`。

## Expert Agreement

模型模块支持 confusion metrics，但当前 final replay 没有固化 TEST window Expert-vs-Prediction confusion matrix，也没有有效 SELL_ALL precision/recall snapshot。

## Replay Snapshot / Reproducibility

优化前脚本曾定义 datasetHash、modelHash、stateVersion、featureVersion、predictionHash、actionSequenceHash、performanceHash 字段；当前 commit 的 optimized runner 未生成 ReplaySnapshot，也没有两次完整运行的 hash 比较。

## Production Isolation

模型快照契约保持：

- `affectsSmartT=false`
- `affectsShadowV2=false`
- `canPromoteAutomatically=false`

## Final Result

`OFFLINE_MODEL_READY = BLOCKED`

剩余缺口：

1. 完成 30,848-bar TEST replay 并记录 runtime/sampleCount。
2. 完成 reference-vs-optimized 逐条等价性比较，确认 mismatchCount=0。
3. 产出五组策略统一 performance metrics。
4. 产出合法 Gross/Net 与成本对账；否则保持 `costModelUnavailable`。
5. 固化 Expert Agreement、SELL_ALL metrics 和 ReplaySnapshot，并完成两次 hash 一致性比较。
