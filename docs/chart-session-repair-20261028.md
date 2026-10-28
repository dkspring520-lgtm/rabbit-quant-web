# Current-day chart repair — local acceptance, 2026-10-28

Parent commit: cf4d3bc41947059cb94d19ba8323f33cfc3c33c8 (bridge packaging repair preserved).
Scope: display/data-session validation only; no indicator formula, strategy threshold,
broker integration, collector sampling, production configuration, push or deployment.

## Behavior

- Preserve Tencent minute-source date and Eastmoney row date. Neither quote date
  nor fetch time certifies an undated minute series.
- Both ordinary and trial minute API paths filter to Shanghai current date and
  elapsed regular-session minutes. Lunch cutoff is 11:30, preopen is empty;
  after close the current day's series remains visible. Historical session arrays
  remain intact for explicit historical review.
- Desk selection requires current date and matching stock; it no longer silently
  substitutes the nearest historical session or undated rows. An explicit dated
  historical selection remains supported; selecting today does not bypass its cutoff.
- Final public/L2 merged series and second overlays are date/time filtered.
  L2 cache keys carry the date, reject older/future packet dates and isolate days.
- Keep same-day data on request failure, expose the independent chart failure
  even when quote refresh succeeds, and display date/last-minute persistently.
  Quote date mismatch/unknown is explicit. Lunch is not labeled historical replay.

## Executed checks

Initial new tests against the old implementation: 4 failed, 1 passed (explicit
history). Failures reproduced lunch future points, preopen, old/undated fallback,
and stock/day leakage.

Final related test command (24 passed, 0 failed/skipped):

```sh
node --test tests/current-chart-session.test.mjs tests/chart-session.test.mjs tests/market-data-current-session.test.mjs tests/a-share-session.test.mjs tests/intraday-cache-reset.test.mjs tests/intraday-chart-model.test.mjs tests/market-data-lightweight-mode.test.mjs
```

The route test transpiles and executes the actual TypeScript GET handler with a
fixed lunch clock and mocked upstream fetch (no network), covering ordinary/trial
paths, Tencent/Eastmoney, lost dates, old dates and afternoon rows. Other tests
cover 11:30/11:31/12:59, preopen, afternoon, close, request-failure selection,
stock switches, next day, stale/future L2 packets and explicit historical review.

`npm run build`: passed, artifact validator confirmed ESM Worker default.fetch
and hosting manifest. Existing Workers node:async_hooks warning remains.
`tsc --noEmit --pretty false`: not a full pass: 34 existing Remotion example
diagnostics, none in app/lib. An introduced generic-inference diagnostic and an
optional Date annotation diagnostic were corrected before final verification.
`git diff --check`: passed. Impeccable detector ran once; existing global style
warnings were not used to justify unrelated redesign.

## Browser evidence and limits

User's Chrome, local built site http://127.0.0.1:4174/, guest demo; no account
login or credentials. First build observed at lunch: 121 points, lunch badge,
afternoon region empty. Final build observed after 13:00: current-day date and
last minute advanced to 13:03/13:04, no future candles.

Desktop measured 1920x913; mobile measured 390x844 (viewport tool initially
produced 585x1266, corrected and measured before capture). New status text is
visible on both; document scroll width did not exceed viewport width. Existing
mobile toolbar remains cramped; this is not comprehensive mobile acceptance.
No JS errors were captured by the browser log tool during these observations.
Viewport restored after testing. Screenshots saved outside Git in task workspace:
chart-first-pass-desktop.jpg, chart-final-desktop.jpg, chart-final-mobile.jpg.

No pre-edit browser baseline: development server failed loading node:async_hooks
in the existing Vinext/Workers setup; the successful production build was used
for visual checks instead. Local server reported ENOTFOUND control: production
control/L2 services are not present locally. This is not a production outage
finding or production integration pass. Historical browsing and fault injection
were exercised by tests, not all manually reproduced in Chrome.

This change does not certify source market finality, historical causal quality,
profitability or production readiness. It conservatively hides unknown-date
current series; provider date availability still requires production rollout
verification. Existing historical data is not rewritten.
