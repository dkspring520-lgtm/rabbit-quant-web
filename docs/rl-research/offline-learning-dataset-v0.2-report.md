# Offline Learning Dataset V0.2

## 结论

DATA-07 已重构为 Full Decision State Dataset：每个有效 1 分钟 bar 生成一个 state/action，非 WAIT 记录另作为 `signalSamples`。这代表完整的历史决策环境，而不是只包含触发信号的样本。

## 实际数据

- symbol: `601899.SH`
- period: `2022-01-04` 至 `2026-04-17`
- totalBars / totalStates: `249,917`
- signalSamples: `40,334`
- excludedSamples: `0`
- WAIT: `209,583`
- BUY_SMALL: `39,892`
- SELL_ALL: `442`
- BUY / SELL_PART: `0`，保持专家策略真实覆盖，不人工补齐

## 时间切分

| split | states | range |
|---|---:|---|
| train | 174,966 | 20220104T09:30:00 - 20241231T15:00:00 |
| validation | 44,103 | 20250102T09:30:00 - 20250930T15:00:00 |
| test | 30,848 | 20251009T09:30:00 - 20260417T15:00:00 |

时间单调、无 split 重叠、重复 sample 为 0、NaN/Infinity 为 0。各集合动作比例分别为：train WAIT 84.4124%、BUY_SMALL 15.4361%、SELL_ALL 0.1515%；validation WAIT 83.1327%、BUY_SMALL 16.6882%、SELL_ALL 0.1791%；test WAIT 81.7752%、BUY_SMALL 17.9072%、SELL_ALL 0.3177%。

## Centroid V0.1 诊断

Validation：Accuracy `0.520373`，Macro F1 `0.327095`，Weighted F1 `0.584013`；BUY_SMALL recall `0.458560`，SELL_ALL recall `0.962025`。

Test：Accuracy `0.584349`，Macro F1 `0.289630`，Weighted F1 `0.629018`；WAIT recall `0.697178`，BUY_SMALL recall `0.061731`，SELL_ALL recall `1.000000`。这说明当前 centroid 在完整状态集上没有形成稳定的 BUY_SMALL 行为复制能力，不能据此进入策略优化。

## Leakage / Mutation

T=50,000、125,000、200,000 future-only mutation 均通过：各点之前的 state、feature、signal/action 保持不变。Label 可以依赖未来窗口，但没有回流到 state。

## Gate

`RESEARCH_BLOCKED`。V0.2 已完成数据结构和审计，但暂停模型训练、PPO/DQN、policy optimization、Paper Execution 接入。下一步应先补充明确的 label future-window contract 和成本配置，再重新评估，而不是调整测试集或专家标签。
