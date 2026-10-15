# Canonical KDJ v1

Contract/version: `kdj-ohlc-continuous-50-v1`. This is an indicator semantics change, not evidence of strategy profitability. No frozen research data, labels, reports or model outputs are regenerated.

## Mathematics

- Default `period=9`; aliases `n` and `length` are accepted only when they agree. Integer range 1-10000. Smoothing is fixed at 3 (`signal=3`); other values are rejected rather than silently ignored.
- For the last n valid completed OHLC bars, `HH=max(high)`, `LL=min(low)`, `RSV=100*(close-LL)/(HH-LL)`.
- If `HH===LL`, use neutral `RSV=50`. A genuine RSV=0 is valid and must not become missing.
- Seed `Kprev=Dprev=50`. The first n−1 bars build the window without updating either seed and output null; the nth bar performs the first update.
- `K=(2*Kprev+RSV)/3`; `D=(2*Dprev+K)/3`; `J=3*K-2*D`. Continue this recurrence, never restart it at each moving window. J is not clamped to 0-100.

## Input and observation-time contract

The shared implementation is `lib/indicators/causal-kdj.mjs`, with batch `calculateKdjSeries` and stateful `CausalKdj.update/updateSeries`. Chunking means retaining the same `CausalKdj` instance; constructing a new instance deliberately starts a new history.

Each bar needs actual numeric finite positive `open/high/low/close`, with low <= open/close <= high. Strings, booleans, null, undefined, NaN, Infinity and zero stock prices are rejected. There is no automatic `price` fallback, OHLC clamping, imputation or volume dependency. Explicit `inputKind` other than `OHLC` is rejected. Outputs identify their input kind as OHLC; a price proxy is never given a canonical value.

Completion must be explicit: `bar.isComplete===true`, or an adapter's `completedBars:true` assertion. An explicit bar `isComplete:false` always wins. A historical array, a timestamp, the last quote, or the mere presence of four prices does not prove completion.

End time must be explicit `bar.barEndTime`, or `bar.timestamp` only with `timestampRole:'end'`. Times are epoch milliseconds or ISO datetimes with an explicit timezone offset/Z; bare HHMM and naive datetimes are not accepted by the core. `availableAt` defaults to bar end; if supplied it cannot precede bar end. Both end and availability must be <= `asOf`. Live callers must supply their observation asOf; completed historical fixtures may omit it and are evaluated at each bar's end. No start-labelled timestamp is automatically shifted, and no incomplete 5-minute/day/week aggregate may be marked complete to make the indicator available.

`timeframeMinutes` defaults to 1 and describes spacing of completed bars, not the KDJ lookback. It is an integer 1-240. The contract currently targets A-share intraday bars; it does not implement daily/weekly market calendars. Other timeframes require a separately specified adapter, not a relabelled input array.

Forming/not-yet-visible/time-contract-invalid bars output null and do not enter the state, so the same bar can be submitted again once complete/visible. Duplicate or out-of-order completed end times output `NON_MONOTONIC_BAR_END` without changing state. Input arrays are neither sorted nor mutated by the KDJ core.

## Lunch, overnight and bad data

- Clock boundaries use Asia/Shanghai's UTC+8 exchange date.
- Consecutive completed intraday bars preserve the K/D recursion.
- The explicit A-share lunch jump from 11:30 to 13:00+timeframeMinutes preserves the window and state (e.g. 13:01 for 1m, 13:05 for 5m). No synthetic lunch bars are inserted.
- A new exchange date resets the window and seeds to 50. Cross-day KDJ is a different contract and is not silently enabled.
- An unexpected intraday gap resets and rewarms. Thus an unobserved/missing minute is not silently compressed into a contiguous series.
- A completed bar with missing/invalid OHLC or declared proxy input resets and rewarms. Its valid timestamp is retained to detect ordering. n new valid bars are needed before a value returns.
- Returned metadata includes reason/status, period, version, actual end/availability, window count and reset reason. `WARMUP`, `UNAVAILABLE` and `INVALID` output null, never numeric zero.

## Consumers and compatibility

| Entry | Behavior |
|---|---|
| IndicatorEngine `KDJ_9` | Uses the shared core, never external library KDJ. `context.parameters` forwards period/n/length/signal; context forwards completion, timestamp role, timeframe and asOf. Registry declares `{period:9,signal:3}`, 8 warmup bars. All other provider indicators keep their previous implementation. |
| FactorEngine `technical.kdj_j9` | Keeps the normalized interface `J/50-1`; engine and registry are versioned `1.1.0-kdj-v1`. Per-row `factorMetadata` carries the KDJ contract and validity reason. `computeSession(...,{kdj:{...}})` or `session.kdjContract` supplies the explicit input contract. Original raw OHLC is retained as `kdjInput` before the general factor normalizer synthesizes ranges; synthetic ranges cannot satisfy KDJ. |
| Research `buildKdjFeatureSeries/buildKdjFeatures` | New true K/D/J feature path with explicit `featureVersion` and metadata; point calculation consumes only the prefix through the selected index. |
| Frontend MACD/RSI/KDJ observation gate | Removes its fourth inline calculation and reads shared core output. A null KDJ cannot confirm a MACD event. Current price-sampled/unknown-completion minute feeds therefore cannot emit this KDJ-confirmed observation. Other MACD/RSI arithmetic and other chart families are unchanged. |
| Frozen V0.4 | Original `buildV04Features`, `V04_FEATURES`, `futureLabelStudy` and `featureAudit` are re-exported unchanged from `feature-label-study-legacy-v04.mjs`; `buildLegacyV04Features` and `LEGACY_V04_KDJ_CONTRACT` explicitly identify the old `kdjK=RSV14,D/J=null` contract. Existing V0.4 scripts retain old behavior. Do not mix their output with the new version or call it true KDJ. |

FactorEngine may build a full ISO timestamp from session date+HHMM only when the caller explicitly sets `timestampRole:'end'`. It never asserts completedBars on behalf of a realtime or historical loader. Source completeness/availability must be attested by that loader. A replay's `price`-only normalized rows are insufficient, even if another normalizer previously generated high/low.

Current historical replay and realtime feeds do not uniformly carry these attestations. Returning unavailable is intentional; wiring them requires actual source semantics, not changing a flag to regain old signal counts. No broker/data adapter is enabled and no historical strategy is rerun as part of this change.

## Verification

`tests/kdj-canonical.test.mjs` covers hand-calculated seeds/recurrence, warmup, rising/falling/flat paths, zero RSV, bad OHLC/proxy rejection, delayed and forming bars, future invariance, streaming chunks, lunch/overnight/gaps, parameter forwarding, original-input preservation, three canonical entry points and frozen V0.4 compatibility. Existing indicator/factor/shadow tests and the project test/build checks are run separately. Their passing does not establish an investment edge.

FactorEngine additionally rejects unsorted/duplicate HHMM or cross-date inputs for explicitly completed KDJ bars, before its general normalizer can silently repair/merge them. `computeSession` is a single-date interface; multi-day KDJ streams must use the shared core (which resets overnight) or separate factor sessions.
