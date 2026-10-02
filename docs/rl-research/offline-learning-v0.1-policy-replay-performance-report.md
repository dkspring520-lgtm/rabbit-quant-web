# Offline Learning V0.1 Policy Replay Performance Report

## Scope

本轮只优化 Replay 性能，不修改模型、State、Expert Strategy、Action Space、Reward、Performance 定义或 Paper Execution 规则。

## Optimization

`HistoricalReplayEngine` 新增 `precomputeFactors` 选项。开启后，因果 factor rows 在 replay 前缓存，`step()` 读取对应 index，避免每个 bar 重算 prefix。默认行为保持原路径，确保既有调用兼容。

## Test Window

使用 DATA-07 `601899.SH` Full State TEST window，dataset hash `70764e3c3fa54c14008407264915ee25704bf0070f18471539fe472a2979e825`。模型仍为 train-only frozen centroid。

## Result

本轮 optimized runner 已接入 precomputed factor path，但完整 30,848-bar run 在限定执行窗口内仍未完成。原因是一次性 `FactorEngine.computeSession()` 对完整 session 本身仍然是高复杂度，未形成可验证的完成运行。

因此以下项目没有合法数字，不能声称 speedup：

- beforeRuntime: unavailable
- afterRuntime: incomplete
- speedup: unavailable
- strategy metrics: unavailable
- replay equivalence mismatchCount: unavailable

## Gate

`OFFLINE_MODEL_READY = BLOCKED`

剩余缺口：

1. 将 FactorEngine 的因果窗口计算改为线性/增量 cache，同时逐 sample 保持 reference equivalence。
2. 完成 30,848-bar TEST window 的 reference-vs-optimized action、timestamp、sampleId、return、reward 比较。
3. 记录 before/after runtime 和 speedup。
4. 完成五组策略 replay、成本核算和 reproducibility snapshot。

本轮未进入 Offline RL、PPO、DQN、真实交易或策略调参。
