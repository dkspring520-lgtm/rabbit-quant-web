# Offline Learning V0.8.2.5 Action Value Semantic Audit

WAIT is explicitly value 0; opportunity cost is not silently assigned. BUY_SMALL and BUY use declared normalized exposures of 0.5 and 1.0 notional units. SELL_PART and SELL_ALL are not applicable without position and sellable inventory context; they are not calculated by negating futureReturn.

Cost monotonicity: PASS. 30m outcomes use the next 30 observed 1m bars; the lunch break is a sequence gap and no bars are fabricated.
Hand-check fixtures: rising, falling, vReversal, fallThenRise, riseThenFall, flat. No-arbitrage: PASS.

Because SELL_PART/SELL_ALL require portfolio state and the current Price-Only State does not contain it, this semantic audit remains RESEARCH_BLOCKED. No replacement label or portfolio schema was invented.

**RESEARCH_BLOCKED**
