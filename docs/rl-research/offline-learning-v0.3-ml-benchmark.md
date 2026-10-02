# Offline Learning V0.3 ML Benchmark

## Dataset

使用 V0.2 Full Decision State Dataset，未改变 state、label、时间切分或 test：249,917 states；train 174,966，validation 44,103，test 30,848。专家标签为 WAIT / BUY_SMALL / SELL_ALL，测试分布为 WAIT 25,226、BUY_SMALL 5,524、SELL_ALL 98。

class weight 使用 train-only 配置：`total/(3*classCount)`，并记录于运行输出；没有重采样或人工补标签。

## Models

实现并运行了标准库 deterministic Logistic Regression、Tree baseline 和小型 MLP。三者均输出 `P(WAIT)`, `P(BUY_SMALL)`, `P(SELL_ALL)`。未进入 Paper Execution、Smart-T、Shadow V2 或 RL。

## Test Results

| model | Macro F1 | PR-AUC (BUY_SMALL) |
|---|---:|---:|
| Logistic Regression | 0.006427 | 0.498491 |
| Tree baseline | 0.299913 | 0.498491 |
| MLP | 0.105762 | 0.497062 |
| Centroid V0.1 | 0.289630 | 不适用 |

V0.3 模型没有稳定超过 Majority baseline 的 Macro F1（0.330403）。因此不能声称存在可用于策略回放的稳定增量。

## BUY_SMALL Thresholds

Logistic test threshold：0.5 / 0.6 / 0.7 / 0.8 均无触发信号。MLP 在 0.5 产生 30,668 个信号，precision 0.179601、recall 0.997104；0.6、0.7、0.8 均无触发。该结果不稳定，不能作为策略阈值依据。

## Conclusion

1. Full State Dataset 已包含 WAIT、BUY_SMALL、SELL_ALL 的完整决策环境。
2. 当前轻量 ML 模型没有相对 Majority baseline 的稳定增量。
3. BUY_SMALL 不能被稳定预测；高 recall 与低 precision 并存。
4. 暂不进入 Policy Replay。

最终状态：`RESEARCH_BLOCKED`。

本阶段未修改 V0.2 Dataset、Expert Label、Test、时间切分，也未训练 PPO/DQN 或接入交易执行。
