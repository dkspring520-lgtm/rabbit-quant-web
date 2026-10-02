# Offline Learning V0.8.2.6 Portfolio Context + Action Transition Contract

ResearchPortfolioContextV0.1 is independent from ValidatedStatePriceOnlyV0.1. It uses lot-level T+1 eligibility and never reads real accounts or broker interfaces.

ResearchNotionalUnitV0.1 is a fixed 10,000 research-currency notional. BUY_SMALL uses 0.5 unit; BUY uses 1.0 unit. SELL_PART sells 25% of sellablePosition; SELL_ALL sells all sellablePosition. All quantities round down to the 100-share A-share lot size and record the policy.

Execution uses price(T) with directional slippage. Cash, position, sellablePosition, lots, T+1, cost and quantity invariants pass. Fixture A rejects sells with no position; Fixture B rejects sells when sellablePosition is zero.

Action config hash: d0428e3efd09722c2cff1031efb1846ef890cb8bd347a79c8b0c3251aeb7954a

**PORTFOLIO_CONTEXT_READY**
