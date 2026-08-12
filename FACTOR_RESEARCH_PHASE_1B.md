# Factor Research Phase 1B

## Scope

Phase 1B is an offline extension of Phase 1A. It researches multi-factor T combinations, transaction-cost coverage, and same-direction signal throttling. It does not modify Smart-T, Zijin Shadow V2, live monitoring, account logic, production databases, trading adapters, or deployment.

## Predefined combinations

The engine evaluates four domain-grounded recipes instead of searching arbitrary combinations:

1. `positiveT.pullback_recovery`: VWAP pullback, momentum recovery, lower shadow, volume-price alignment, active-buy imbalance, and OFI acceleration.
2. `positiveT.vwap_reclaim`: VWAP reclaim, VWAP slope and persistence, MACD recovery, volume-price alignment, and active-buy imbalance.
3. `reverseT.high_exhaustion`: positive VWAP extension, momentum decay, upper shadow, weakening volume-price alignment, active sell pressure, and OFI deterioration.
4. `reverseT.failed_breakout`: high intraday location, positive VWAP extension, pullback from the recent high, momentum decay, OFI deterioration, and weak bid depth.

Market and sector inputs remain optional because the current Zijin replay dataset does not contain them. Missing values remain `null` and no recipe can pass when a required input is missing.

## Train-only fitting

Each `recipe x horizon` is fitted on the chronological training split only:

- Robust center and scale for every component.
- Composite score threshold.
- ATR-to-future-favorable-move calibration.

Validation and test data never refit normalization, thresholds, weights, or expected-move calibration. Rolling out-of-sample windows repeat the same rule: each window fits only on dates before its test window.

## Cost coverage

A scored candidate becomes eligible only when its training-calibrated expected favorable move covers the largest of:

- `0.08 CNY / current price`;
- `2 x` modeled round-trip cost return.

The modeled cost reuses the existing research execution model: commission, minimum commission, sell-side stamp duty, and configured slippage. The gate is evaluated before signal throttling.

## Signal throttling

Default controls are:

- Avoid the first 15 trading minutes.
- Do not open a signal that cannot finish before the final 10 minutes.
- No overlapping simulated trades for the same recipe and day.
- 20-minute same-direction cooldown.
- At most two same-direction signals per recipe and day.
- No requirement to trade every day.

Reports retain baseline signal counts, filtered signal counts, reduction rate, and rejection counts for missing factors, time window, score, cost coverage, overlap, cooldown, and daily cap.

## Run

```powershell
node scripts/run-factor-research.mjs `
  --input E:\zijin-l2\601899-replay-sessions-387.jsonl `
  --output E:\zijin-l2\factor-research\zijin-phase-1b `
  --dataset-id zijin-601899-minute-l2-387 `
  --combinations
```

Run selected recipes:

```powershell
node scripts/run-factor-research.mjs `
  --input E:\zijin-l2\601899-replay-sessions-387.jsonl `
  --output E:\zijin-l2\factor-research\zijin-phase-1b `
  --dataset-id zijin-601899-minute-l2-387 `
  --combinations `
  --recipe positiveT.pullback_recovery,reverseT.high_exhaustion
```

## Promotion boundary

Phase 1B cannot automatically promote a combination. A report is research evidence only. Production or Shadow V2 integration requires a separate human-approved phase and must preserve the existing strategy gates.
