# Factor Research Phase 1D

## Scope

Phase 1D supplies genuine minute OHLC and causal L2 fields to the offline factor research engine. It does not modify Smart-T, Zijin Shadow V2, live monitoring, accounts, production databases, deployment, or real trading. Research results cannot be promoted automatically.

## Source and reconstruction

The builder reads the 601899 daily ZIP archives directly and identifies GB18030 CSV members by schema:

- `逐笔成交.csv` is the authority for minute price, volume, and amount.
- `行情.csv` supplies quote snapshots and cumulative audit fields.
- `逐笔委托.csv` supplies classified buy/sell order volume when present.

For every continuous-auction minute, open is the first valid trade, high and low are the extrema, close is the last valid trade, volume is the sum of trade quantity, and amount is `sum(price / 10000 * quantity)`. The source ZIP files are never extracted permanently or modified.

The session policy is `09:30-11:29` and `13:00-14:56`. Opening and closing auctions are excluded so auction records cannot be mixed with continuous-auction bars.

## Causal alignment and null policy

Each minute may use only the latest quote snapshot whose timestamp is at or before that minute's cutoff. A quote older than five trading minutes is unavailable. A later snapshot is never backfilled into an earlier minute.

Missing quote, depth, order, market, or sector fields remain JSON `null`. They are never represented by zero. A real classified zero is retained only when the source itself proves that the field is available and the observed value is zero.

Quote cumulative volume and amount are audit references only. Their event boundary may differ from the transaction stream, so discrepancies are reported in the manifest and never used to overwrite reconstructed OHLCV/amount.

## Duplicate archives and manifest

Archives are grouped by trading date. For duplicate dates, the archive with the greatest valid continuous-auction trade-row count, then minute count, is selected deterministically. Rejected paths remain in the manifest.

The atomic JSONL output has one session per line. Its manifest records:

- Exact JSONL SHA-256 checksum.
- Selected source archive paths and checksums.
- Duplicate resolution.
- Source date range and parse statistics.
- OHLC, session, causal alignment, and null policies.
- Explicit production-isolation flags.

## Rolling out-of-sample validation

Closure validation now adds an expanding-window rolling evaluation over the development interval:

1. Fit scaler, composite model, threshold, and ATR diagnostics on the earlier training window only.
2. Evaluate the next chronological window without refitting.
3. Advance by the configured step and repeat.
4. Aggregate only genuinely out-of-sample trades.

The final chronological test split is excluded from every rolling fold and remains locked. It is not used for fitting, threshold selection, parameter tuning, or model selection.

Every closure run keeps the `2.0x` cost-coverage threshold as the conservative primary group and adds a `1.5x` shadow control group. The control can be compared only on the rolling development out-of-sample aggregate. Its locked-test result is recorded for audit but must not be used to choose, tune, or promote either group.

The previously inspected historical final interval is useful for diagnostics but is no longer a pristine one-time holdout. Future, previously unseen trading dates must be retained untouched for final confirmation before any human considers promotion.

## Build

```powershell
python scripts/build-zijin-factor-dataset.py `
  --input-root "E:\zijin-l2\601899" `
  --output "E:\zijin-l2\601899-factor-minute-ohlc-v1.jsonl" `
  --manifest "E:\zijin-l2\601899-factor-minute-ohlc-v1.manifest.json"
```

## Research run

```powershell
node scripts/run-factor-research.mjs `
  --input "E:\zijin-l2\601899-factor-minute-ohlc-v1.jsonl" `
  --dataset-manifest "E:\zijin-l2\601899-factor-minute-ohlc-v1.manifest.json" `
  --output "E:\zijin-l2\factor-research\zijin-phase-1d" `
  --dataset-id zijin-601899-tick-minute-ohlc-v1 `
  --factor price.return_5m,vwap.mean_reversion `
  --combinations `
  --closures
```

Use `--closure-control <multiple>` only for an explicitly versioned research run. The default is `1.5`; changing it changes the reproducibility config hash.

The CLI rejects a manifest whose dataset checksum does not match the exact input JSONL bytes.

## Promotion boundary

Phase 1D creates research evidence only. `affectsShadowV2`, `affectsSmartT`, and `affectsProductionStrategy` remain false; `canPromoteAutomatically` remains false and human approval remains mandatory.
