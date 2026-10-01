# Offline Learning V0.1 OOS 实验报告

运行入口：`scripts/run-offline-oos.mjs`。原始 Parquet 不提交 Git，运行前由 DATA_ROOT/本机数据导出临时 bars 文件。

## Dataset

- symbol: `601899.SH`
- frequency: `1m`
- range: `2022-01-04` 至 `2026-04-17`
- totalBars: `249,917`
- totalSamples: `40,334`
- datasetHash: `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`
- excludedSamples: `0`

## Chronological Split

| split | count | range |
|---|---:|---|
| train | 27,273 | 20220104T09:40:00 - 20241231T14:53:00 |
| validation | 7,439 | 20250102T10:04:00 - 20250930T14:52:00 |
| test | 5,622 | 20251009T09:31:00 - 20260417T14:45:00 |

训练、验证、测试无重叠，时间递增，重复 sample 为 0，NaN/Infinity 为 0。resolved sample 数据只包含非 WAIT 专家信号，因此三个集合中的 WAIT 数量均为 0；这不是人为平衡结果。

训练标签分布：BUY_SMALL 27,008（99.028%），SELL_ALL 265（0.972%）。验证：BUY_SMALL 7,360（98.938%），SELL_ALL 79（1.062%）。测试：BUY_SMALL 5,524（98.257%），SELL_ALL 98（1.743%）。

## Classification

Centroid V0.1（seed=17）验证集 Accuracy `0.970829`，Macro F1 `0.465656`，Weighted F1 `0.978957`；BUY_SMALL recall `0.970924`，SELL_ALL recall `0.962025`。

测试集 Accuracy `0.817325`，Macro F1 `0.352592`，Weighted F1 `0.884664`；BUY_SMALL precision/recall/F1=`1.000000/0.814084/0.897515`；SELL_ALL precision/recall/F1=`0.087111/1.000000/0.160262`。测试集没有 WAIT 标签，WAIT 指标为不可计算的零支持项。

测试基线 Macro F1：AlwaysWait `0`，MajorityClass `0.330403`，SeededRandom `0.172986`，ExpertActionReplay `0.666667`。Centroid `0.352592`，相对 MajorityClass 有小幅增量，但低于专家回放；不据此做生产选择。

## Policy Replay

本次真实 OOS 运行尚未完成正式 HistoricalReplay + SignalSample + PerformanceAnalytics 回放。现有数据没有可用的 commission/slippage 成本配置，故 Gross/Net Performance、tradeCount、MFE/MAE、drawdown 不能合法宣称为 Paper Performance，均标记为 unavailable。

## Leakage / Reproducibility

状态构造使用当前 bar 及历史窗口，基础因果检查通过：时间递增、无重叠、无 NaN/Infinity。T=50,000、125,000、200,000 的真实 future-only mutation 尚未在持久化 DATA-07 sample 源上重跑，因此 `OFFLINE_LEARNING_LEAKAGE = BLOCKED`。

同一输入的模型、指标和 baseline hash：`fd19e0bea89391d9415b81c2d0122a2fd83df34293a2d211b3eded3b28b627d6`，当前可复现检查为 PASS，但仍需把正式 replay 输出纳入 hash。

## Final Gate

`RESEARCH_BLOCKED`

阻断原因：

1. 正式 policy replay 尚未接入现有 PerformanceAnalytics。
2. commission/slippage 配置不可用，无法生成 Gross/Net Performance。
3. 三个指定 T 点 future-only mutation 尚未在真实持久化 DATA-07 sample 源完成重跑。
4. 当前 resolved sample 口径不含 WAIT，需在报告中继续保持“signal samples”与全 bar state dataset 的明确区分。

生产隔离保持：`affectsSmartT=false`、`affectsShadowV2=false`、`canPromoteAutomatically=false`。
