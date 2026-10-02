# OFFLINE-LEARNING-V0.1 STATUS AUDIT REPORT

审计基线：commit `43984e52e8ead2ce4ab3054d493c9cce2df99f2f`（短 hash `43984e5`）。本报告只审计现有实现和已保存报告，不修改代码、不训练模型、不调参。

## 1. Dataset

DATA-07 元数据已记录：

- datasetHash: `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`
- symbol: `601899.SH`
- timeframe: `1m`
- bars: `249,917`
- Full State sampleCount: `249,917`
- signalSamples / resolved signal samples: `40,334`

口径已在 V0.2 报告中区分。数据来源和哈希一致，但可提交的仓库报告没有保存原始 Parquet 或完整样本快照，审计依赖本机数据路径和临时导出。

## 2. Chronological Split

V0.2 Full State split 已执行：

- train: `174,966`
- validation: `44,103`
- test: `30,848`

时间无重叠，测试集没有参与 centroid fitting、centroid calculation 或训练。实现没有独立的 normalization 或 threshold fitting。V0.1 早期 signal-only 报告另有 `27,273 / 7,439 / 5,622`，不能与 V0.2 Full State 数字混用。

## 3. Model

当前模型为 deterministic nearest-centroid：`offline-behavior-centroid-v0.1`，state version `state-v0.1`，seed `17`。特征列表由 `STATE_FEATURES` 固定。训练过程无随机采样，推理确定性测试通过。

## 4. Classification Metrics

Full State V0.2 test 已输出 Accuracy、Macro F1、Weighted F1、Confusion Matrix 和 WAIT / BUY_SMALL / SELL_ALL 的 precision、recall、F1。已单独报告 SELL_ALL recall。测试结果：Accuracy `0.584349`，Macro F1 `0.289630`，Weighted F1 `0.629018`；WAIT recall `0.697178`，BUY_SMALL recall `0.061731`，SELL_ALL recall `1.000000`。

## 5. Expert Agreement

代码具备 `agreementMetrics()`，能计算 overall 与按 action agreement。但 Full State V0.2 正式报告没有保存一份完整、独立的 Expert Action vs Model Prediction 表和 Full State agreement snapshot，因此该项只能判定为 PARTIAL。

## 6. Baseline

AlwaysWait、MajorityClass、SeededRandom、ExpertActionReplay 在 V0.1 OOS 代码中存在，并使用固定 seed。V0.2 Full State 没有保存一套与 LearnedPolicy 同一 test window 的完整 baseline 结果；不能把 signal-only 的旧结果当作 Full State 结果。判定：PARTIAL。

## 7. Policy Replay

未完成。现有报告明确写明尚未接入 HistoricalReplay + SignalSample + PerformanceAnalytics。没有合法的 tradeCount、winRate、averageReturn、profitFactor、MFE、MAE、holdingTime 或正式 drawdown 结果，也没有 Gross/Net commission/slippage 结果。判定：FAIL。

## 8. Leakage Audit

V0.2 报告记录 T=`50,000`、`125,000`、`200,000` mutation 通过，且状态、feature、signal/action 在历史前缀不变。判定：PASS（基于已保存 V0.2 审计记录）。

## 9. Reproducibility

V0.1 早期运行记录过 model/metrics/baseline hash；但该 hash 没有包含正式 policy replay，且没有保存完整 Full State model snapshot、预测序列和 replay result。判定：PARTIAL。

## 10. Production Isolation

已确认：

- `affectsSmartT = false`
- `affectsShadowV2 = false`
- `canPromoteAutomatically = false`

判定：PASS。

## Final Gate

`OFFLINE_MODEL_READY = BLOCKED`

剩余缺口：

1. 完成 Full State Dataset 上的正式 HistoricalReplay + PerformanceAnalytics policy replay。
2. 提供 commission、slippage 下的 Gross / Net Performance。
3. 保存同一 Full State test window 的 LearnedPolicy、四个 baseline 和 Expert Agreement 完整结果。
4. 将 Full State 的 model snapshot、预测序列和 replay metrics 纳入 reproducibility hash。
5. 在真实 DATA-07 输入上重复验证上述结果后，才能重新评估进入 Offline RL。

本次审计没有修改代码、没有训练新模型、没有进入 Offline RL。
