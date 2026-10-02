# Offline Learning V0.8.2.1 Feature Provenance Audit

Input contains price and volume only. Direct price, volume, returns, rolling volume/price statistics, and causal sentiment/regime inputs are traceable.

The existing feature builder falls back to current price when open/high/low are absent. That affects open/high/low and wick/body ratios, so these fields are marked **SYNTHETIC_OHLC**. No approved DATA-07 price-to-OHLC conversion rule was found.

Future-blind mutation audit: PASS. Because synthetic OHLC was detected, the final provenance gate is **RESEARCH_BLOCKED**.
