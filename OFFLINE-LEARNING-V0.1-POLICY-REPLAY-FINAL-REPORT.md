# OFFLINE LEARNING V0.1 POLICY REPLAY FINAL REPORT

执行基线：`57e1c2a`。

本次直接运行现有 `scripts/run-offline-policy-replay-v1.mjs`。运行超过限定窗口后未完成，已终止；没有产生合法的 ReplaySnapshot 或性能结果，也没有进行第二次完整运行。

固定配置：

- datasetHash: `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`
- test window: `20251009T09:30:00` 至 `20260417T15:00:00`
- target bars: `30,848`

五组策略 runner 已定义，但本次没有完整输出 Expert、Learned Policy、AlwaysWait、MajorityClass、SeededRandom 的 sampleCount、tradeCount、收益、MFE/MAE 或 drawdown。

`costModelUnavailable = true`：没有使用模拟手续费或伪造 Net Performance。

Expert Agreement、ReplaySnapshot、Run A/Run B hash 比较、reference-vs-optimized 等价性结果均未完成，不能宣称 `identical=true` 或 `mismatchCount=0`。

## Final Gate

`OFFLINE_MODEL_READY = BLOCKED`

剩余缺口：

1. 完成固定 30,848-bar TEST replay。
2. 生成五组策略完整指标。
3. 生成 Expert Agreement 和 SELL_ALL precision/recall。
4. 生成 ReplaySnapshot 并完成两次运行 hash 比较。
5. 完成 reference-vs-optimized 逐条等价性验证。
