# KDJ OHLC candidate feed — policy v2

The opt-in API is `GET /api/market-data?code=601899&mode=kdj-ohlc`. It preserves
actual upstream OHLC and does not add polling to existing display consumers.
The canonical KDJ math and strategy rules are unchanged.

## Source facts and unresolved contracts

The official Eastmoney chart HTML imports `fullscreen_h5chart.js` and emcharts
3.18.1. Those files establish the kline endpoint, f51..f57 column order
(time, open, close, high, low, volume, amount), direct numeric price parsing,
and fa/ba/empty -> fqt 1/2/0. The local request uses klt=1, fqt=0, secid=1.601899.
Evidence was captured on 2026-10-13 in the task's `kdj-readonly-supplement`.

The official UI exposes 5/15/30/60 minute bars, not one-minute contract details.
The klt=1 interval, label role/timezone declaration, auction coverage, completion
and correction rules remain unverified. The candidate label is parsed under an
explicit Asia/Shanghai assumption; it is never assigned as a canonical bar end.

## Four separate states

1. **Candidate observed:** valid OHLC fields, raw label, actual receipt.
2. **Repeated price observations:** at least two identical OHLC observations
   spaced at least 60 seconds. This could be cached data and proves no closure.
3. **System availability:** `systemAvailableAt` is the first receipt of the current
   price version. `stableSystemAvailableAt` is the receipt that qualified repeated
   observations. Neither means historical market availability or tradability.
4. **Provider completion/finality:** unsupported for this endpoint. Every candidate
   has `isComplete=false`, `providerComplete=false`, `providerFinal=null`, canonical
   `availableAt=null`, and null bar boundaries. `acceptedBars=[]`, `kdj=null`.

There is no elapsed-time, later-label, 11:30 or 15:00 completion fallback. Setting
`verified=true` or passing claimed contract metadata cannot activate a completion
adapter. Supporting one requires real provider evidence and a new policy version.

## Price and quantity are independent

Price quality validates finite positive O/H/L/C and their ordering. Missing,
invalid or unknown volume/amount units produce quantity diagnostics; valid price
rows remain. Price fingerprints and revisions exclude quantities. Quantity-only
changes never restart repeated-price observations or change the price version.

KDJ uses H/L/C; the adapter additionally validates O. One common positive price
scale leaves RSV unchanged. Mixing price scales or adjustment bases is invalid.
Volume/VWAP/flow/PnL work requires separate quantity and execution validation.

## Observation history and causality

Price versions preserve values and their actual first receipt. Revisions are
classified as latest-label or earlier-label updates, without labeling either as a
confirmed closed bar. Earlier emitted snapshots are detached copies and do not
change. Next-label sightings and label advancement are observation events only.
After disconnection, repeated-observation qualification restarts; original price
version availability stays intact. A new trading date resets active observation
state; saved raw events remain the replay evidence.

The ordinary API cache is in-memory. Durable evidence is written by the dedicated
observer. Actual canonical consumers are not enabled by this candidate channel.

## Bounded opening observer

`scripts/observe-kdj-feed.mjs` collects raw payloads, receipt times, snapshots,
price/quantity revisions and label events independently of the blocked canonical
gate. Files are appended after every response. The output directory must be new.
Event replay is checked separately from numeric KDJ replay; null/null equality
cannot pass numeric/live acceptance.

The frozen window remains 2026-10-14 09:31–09:50 Asia/Shanghai. Maximum 20 requests,
at least 60 seconds between request starts; a 60-second local observer pause is
inserted before request 12. No production collector is disconnected. Outside the
window it exits immediately without requests. The parent task will trigger the
window; this change neither starts nor schedules it and needs no user manual run.

Observation collection can be `COLLECTED_UNCERTIFIED` while formal source/live
acceptance remains blocked. Nine completed bars, five new completed bars and
numeric as-of replay remain future acceptance requirements, not observed results.
Lunch and closing boundary acceptance need separate evidence and remain pending.
Source/live/deployment gates must pass before a separately authorized push.
