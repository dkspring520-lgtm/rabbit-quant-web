# Offline Learning V0.4 Feature / Label Study

## Dataset 保持不变

V0.2 Full Decision State Dataset 未修改：`249,917` states，`40,334` signal samples。原有时间切分、Mutation Audit 和 Leakage Audit 保持。

## Causal Feature Study

新增研究特征仅作为 V0.4 视图，不覆盖 V0.2 State：VWAP deviation、intraday position、Bollinger position、RSI14、KDJ、CCI20、WR14、volume ratio、volume anomaly。所有特征只读取当前 bar 和历史窗口，`futureFieldsUsed=[]`。

## Future Label Study

使用 10m / 30m / 60m future windows 计算 MFE、MAE，并仅对原 BUY_SMALL 信号进行研究分层：

- HIGH_CONFIDENCE_BUY：`8,948`
- LOW_CONFIDENCE_BUY：`30,944`
- WAIT：`210,025`
- mean MFE：`0.723481%`
- mean MAE：`-0.650562%`

这些是研究标签，尚未替换 V0.2 Expert Action，也未进入训练或回放。

## Leakage

V0.4 特征定义为因果特征；指定 mutation 点 `50,000 / 125,000 / 200,000` 的审计状态为 PASS。未来窗口只用于 label study，不进入 state。

## Benchmark / Gate

V0.3 的 Majority baseline Macro F1 为 `0.330403`。本轮没有增加模型复杂度，也没有用研究标签污染 V0.2；因此没有宣称新的 ML 增量。当前状态：`RESEARCH_BLOCKED`。

结论：数据管线可表达完整决策环境，但 BUY_SMALL 仍需先完成独立的 label quality 和 feature contribution 验证，不能进入 Policy Replay、RL 或交易执行。
