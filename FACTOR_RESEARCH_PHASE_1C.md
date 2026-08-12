# Factor Research Phase 1C

## Scope

Phase 1C is an offline closure simulator for the Phase 1B factor recipes. It does not modify Smart-T, Zijin Shadow V2, live monitoring, account logic, production databases, trading adapters, or deployment. Every result requires human review and cannot be promoted automatically.

## Closure model

- Positive T and reverse T have independent maximum holding periods: 45 and 50 trading minutes.
- Take-profit distance is the maximum of ATR target, CNY 0.08, and two times modeled round-trip cost.
- Stop distance is ATR based with a fixed minimum distance.
- Entry and exit include configured slippage, commission, minimum commission, and sell-side stamp duty.
- The first take-profit or stop-loss touch closes the trade. If both are touched in one minute, the conservative default is stop-loss first.
- If neither level is touched, the trade closes at the timeout price.
- Reports include MFE, MAE, time to touch, holding time, exit reasons, Profit Factor, maximum drawdown, and net PnL after costs.

## OHLC and L2 audit

The engine audits timestamps, L2 coverage, chronological continuity, OHLC semantics, and cumulative-volume consistency before simulation.

The current 601899 replay file stores session-level open and cumulative session high/low on each minute. Those fields are not safe minute OHLC. In `auto` mode the engine therefore uses `close-only` paths and records that limitation in the report. Explicit `ohlc` mode refuses to run unless the audit classifies the source as true minute OHLC.

For the same reason, an unsafe source cannot feed its cumulative high/low into ATR. Phase 1C replaces those fields with close-to-close changes before factor calculation and labels the result `close-change-proxy`. This is a conservative proxy, not true minute ATR.

True first-touch OHLC simulation remains available for datasets rebuilt from timestamp-aligned transactions. Missing L2 or market fields remain `null`; they are never zero-filled.

## Locked test interval

The final chronological split is declared as a locked test interval with its start date, end date, date count, and SHA-256 date checksum. Models, score thresholds, expected moves, and diagnostic ATR buckets are fitted on training data only. Validation and locked-test results do not refit or optimize any parameter.

## Loss diagnostics

Validation and locked-test losses are grouped by:

- Positive T or reverse T.
- Session period.
- VWAP position.
- Train-fitted ATR regime.
- Recent L2 continuity.
- L2 flow and price-response alignment.
- Market regime when supplied by the dataset.

## Run

```powershell
node scripts/run-factor-research.mjs `
  --input E:\zijin-l2\601899-replay-sessions-387.jsonl `
  --output E:\zijin-l2\factor-research\zijin-phase-1c `
  --dataset-id zijin-601899-minute-l2-387 `
  --factor price.return_5m,vwap.mean_reversion `
  --closures
```

Run selected recipes:

```powershell
node scripts/run-factor-research.mjs `
  --input E:\zijin-l2\601899-replay-sessions-387.jsonl `
  --output E:\zijin-l2\factor-research\zijin-phase-1c `
  --dataset-id zijin-601899-minute-l2-387 `
  --factor price.return_5m,vwap.mean_reversion `
  --closures `
  --recipe positiveT.pullback_recovery,reverseT.high_exhaustion
```

## Promotion boundary

Phase 1C is diagnostic research evidence only. It cannot change, replace, or feed Smart-T or Zijin Shadow V2. A later human-approved phase must first rebuild true minute OHLC, rerun the locked out-of-sample evaluation, and independently approve any candidate before integration is considered.
