# Offline Learning V0.8.2.7 Portfolio-aware Counterfactual Value

Market State remains ValidatedStatePriceOnlyV0.1; Portfolio Context is separate and uses the finite A-F scenario grid.
All actions share Net Future Equity Delta as the objective. State count: 249917; scenario count: 6; decision contexts: 1499502.
BUY actions obey normalized notional, cash and lot constraints. SELL actions obey sellablePosition and T+1. Inapplicable actions are excluded from bestApplicableAction and do not receive fabricated values.
Future outcomes use the next observed 10/30/60 trading bars. Single-step transitions are not recursively fed into later decisions. averageCost is retained as context and does not directly weight economic value.
Future-blind, T+1, applicability, portfolio invariants, cost and reproducibility audits pass. **PORTFOLIO_AWARE_VALUE_READY**
