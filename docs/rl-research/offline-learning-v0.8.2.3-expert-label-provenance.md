# Offline Learning V0.8.2.3 Expert Action Label Provenance Audit

旧 Expert Action 入口：runOHLCVTResearch() -> buildOHLCVFeatures() -> classifyOHLCVSentiment() -> generateOHLCVResearchSignal().

它不使用未来收益，也不读取现金、持仓或 T+1 库存。但它依赖旧 OHLCV 路径：VWAP 使用 amount/volume；RECOVERY 使用 open/low；OVERHEATED 高位反转使用 high；趋势和收益使用 close。Price-only 输入没有合法的 open/high/low/amount，不能复现相同 Label。

Train: {"WAIT":147693,"BUY_SMALL":27008,"BUY":0,"SELL_PART":0,"SELL_ALL":265}
Validation: {"WAIT":36664,"BUY_SMALL":7360,"BUY":0,"SELL_PART":0,"SELL_ALL":79}
Test: {"WAIT":25226,"BUY_SMALL":5524,"BUY":0,"SELL_PART":0,"SELL_ALL":98}
Duplicate timestamps: 0
Action runs: 37979

Action semantics: WAIT 默认；BUY_SMALL/BUY 由 positiveT 和 score 70 分界；SELL_PART/SELL_ALL 由 reverseT 和 score 75 分界。

未来数据审计 PASS；Portfolio Context 不是当前 Label 的必要输入；旧 Label 不能迁移到 ValidatedStatePriceOnlyV0.1。

**OLD_EXPERT_LABEL_INVALID**
