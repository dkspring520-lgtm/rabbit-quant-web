# 兔兔 Alpha 实验室

## 已实现

- 基础因子自动组合：原始、标准化、变化率、跨组交互和相对强弱。
- 滚动样本外验证：训练窗口只用于形成阈值，测试窗口用于评分。
- 成本后评价：支持双边手续费与滑点合并后的 roundTripCostPct。
- 指标：IC、胜率、净收益、样本外折数、稳定度和交易样本数。
- 状态：promote、observe、reject、insufficient。
- 因子衰减监控：近期评分相对历史基线下降后自动降级。

## 数据格式

```js
{
  timestamp: "2026-08-03T01:35:00Z",
  price: 31.82,
  factorValues: {
    vwapDeviation: -0.21,
    activeFlow: 0.38,
    volumeRatio: 1.72
  }
}
```

## 使用方式

```js
import {generateAlphaCandidates,runAlphaLab} from "@/lib/alpha-lab-engine.mjs";

const candidates=generateAlphaCandidates(baseFactors,{maxCandidates:500});
const report=runAlphaLab({
  rows,
  candidates,
  options:{folds:4,horizon:5,roundTripCostPct:0.10}
});
```

候选因子不能直接进入正式买卖信号。建议先进入影子模式，连续观察至少20个交易日，再根据成本后净收益、稳定性和不同市场状态表现决定是否晋级。
