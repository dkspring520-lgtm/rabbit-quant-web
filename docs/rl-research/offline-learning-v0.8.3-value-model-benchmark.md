# Offline Learning V0.8.3 Portfolio-aware Value Regression + Ranking Benchmark

The benchmark uses 249917 Price-only states and 6 portfolio scenarios. Timestamp split occurs before scenario expansion; decision contexts: 1499502.

Targets are Net Future Equity Delta at 10/30/60 observed trading bars. Train, validation and test are timestamp-disjoint. Test metrics are reported after selection and are never used for model or threshold selection. Selected models: {"10":"ridge","30":"ridge","60":"mean"}.

Models predict value, not Expert Action. Inapplicable actions are excluded from loss and policy ranking. Oracle is a future-aware offline upper bound, not a deployable model.

Threshold candidates [0,0.0001,0.0005,0.001,0.002] were scored on validation only; selected margin is 0.002.

Policy replay uses the validation-selected action margin. Results: {"AlwaysWait":{"policyName":"AlwaysWait","modelName":"ridge","tradeCount":0,"winRate":0,"averageReturn":0,"netReturn":0,"actionDistribution":{"WAIT":30788,"BUY_SMALL":0,"BUY":0,"SELL_PART":0,"SELL_ALL":0},"testOnly":true},"Oracle":{"policyName":"Oracle","modelName":"ridge","tradeCount":432,"winRate":0.7060185185185185,"averageReturn":0.0011790212759805099,"netReturn":42.068227059620405,"actionDistribution":{"WAIT":30356,"BUY_SMALL":71,"BUY":234,"SELL_PART":0,"SELL_ALL":127},"testOnly":true},"MLValue":{"policyName":"MLValue","modelName":"ridge","tradeCount":82,"winRate":0.34146341463414637,"averageReturn":0.00032030406513135646,"netReturn":4.647623545948898,"actionDistribution":{"WAIT":30706,"BUY_SMALL":45,"BUY":9,"SELL_PART":0,"SELL_ALL":28},"testOnly":true},"LegacyOHLC":{"policyName":"LegacyOHLC","modelName":"ridge","tradeCount":134,"winRate":0.41044776119402987,"averageReturn":0.00010666480221517329,"netReturn":1.136087041631134,"actionDistribution":{"WAIT":25171,"BUY_SMALL":5519,"BUY":0,"SELL_PART":0,"SELL_ALL":98},"testOnly":true}}.

Future fields are excluded from the feature matrix; production isolation remains enabled.

**VALUE_MODEL_READY**
