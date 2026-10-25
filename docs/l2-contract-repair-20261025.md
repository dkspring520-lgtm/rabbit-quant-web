# L2 observed-data contract repair — 2026-10-25

Base: production ref ea26b78faed2e0d287151322a9e1a9e1bfa00165. This branch contains no changes from the original dirty checkout or its local-only commit.

## Scope

- Forward buffering rejects backwards minutes and detaches mutable records.
- Forward rows retain per-stream clocks, book source/receipt/availability, session VWAP provenance, original quality metadata and current-bar minute. Rows explicitly remain unverified mixed-stream observations. A current-bar minute mismatch clears the misleading top-level minute high/low; the original volatility block remains available for audit.
- observedAt is only an availability lower bound. Buffer release time is distinct; persistedAt stays unknown. No source-finality or continuity certificate is invented.
- Restart fallback retains provenance and emits unknown volume/amount, not manufactured zero. Rolling 60-second recovery is explicitly unverified.
- Replay normalization never upgrades legacy causal:true. Archive quality/source markers survive normalization; absent amount/volume stay null.
- Freshness accepts the actual collector timestamp including seconds, while retaining same-day/session/lag checks.
- Observer archives only fresh eligible input. A short restart snapshot does not erase older minutes. Replaced archives are retained in .versions before the atomic replacement; unchanged minutes are not repeatedly versioned.
- Ledger parse/permission errors propagate. Only ENOENT initializes an empty ledger. Archive/current-state API read errors return 503 rather than silently masquerading as no data.

## Verification and release limits

New regression cases were run failing before implementation for buffer mutation/order, missing numeric values, legacy quality flags, ledger errors and mixed clocks. Additional restart/archive/integration cases cover stale input, retained depth/provenance, corrupt persisted data and missing files.

Build and hosting-artifact validation pass using the existing dependencies (matching package-lock SHA256); no installation. Full-project typecheck fails in untouched UI files and bundled Remotion examples; this branch does not change their code or tsconfig. Narrow route typecheck passes. Windows skips Linux-only deployment execution tests; deployment Node tests inspect the script contract, not a live VPS.

This is a draft data-quality guard patch, not completion of P0/P1/P2 or certification of new research data. Exact minute closure across all feeds, source finality, durable write receipts, downstream replay availability scheduling, paper account fees/idempotency/T+1 and UI remain outstanding. Existing archived Oct23 data is not repaired or certified. No broker connection, strategy threshold change, production deployment or profitable-result claim is included.

## Follow-up: fail-closed replay and labels

The real producer still has no certified finality/durable receipt, so its rows cannot produce strict research replay markers or new forward outcome labels. This intentionally removes unverified research markers from both historical replay and the shared live chart helper; ordinary market curves remain. No trading strategy threshold was changed. A positive synthetic fixture is not a production certificate.

The replay scheduler requires explicit source verification, minute finality and ordered observed/persisted times. It uses persistedAt for clock eligibility, rejects late/duplicate minute backfills, and attaches availableAt to any synthetic qualified marker. The labeler rejects missing receipts, outcomes preceding feature availability and outcomes not available at labeling time. Existing unverified label files are retained but excluded from readiness totals. Collector trainingReady also requires the qualified study status.

Executable tests include fsync failure (no in-memory success or shadow publication), restart with unknown amounts, unavailable/future receipt, reordered arrival, and existing uncertified labels excluded from readiness. This is safe degradation, not a new producer capable of generating qualified data.

Full baseline diagnostic comparison is in l2-typecheck-baseline-20261025.md. Before release, require an explicit decision on the unchanged baseline typecheck failures, review the deliberate loss of unverified research markers, and obtain real producer availability/finality acceptance before enabling new research. No production merge is authorized in this review phase.

## Paper and UI follow-up

Two paper engines remain distinct. The generic engine uses commission/stamp/transfer percentages; the RL engine uses commission percent and stamp/transfer fractions. Legacy research defaults remain identifiable and unchanged; the new durable adapter supplies explicit .025% commission (minimum 5), .05% sell stamp and .001% per-side transfer fee. It requires explicit account identity and order IDs, preserves engine kind/configuration, rejects conflicting retries, restores T+1 inventory, and publishes state only after synchronous storage succeeds. It is a single-writer local adapter, not a server transaction or a multi-tab locking guarantee. It is not wired into the existing manual quick-entry ledger, and does not turn research into automatic trading.

Both engines reject backwards dates; the stateful RL engine now settles forward dates. Explicit stale inputs are rejected. No partial-fill model was added.

Existing UI manual entry now saves before updating React state, reports quota/write errors, and blocks overwrite after a ledger read/parse failure. The new rendered status strip separates source time and fetch time, renders unknown source time as unknown, and explains research-unready is not no-signal. It appears on the console, reconciliation and replay surfaces. Fetch timestamps no longer substitute for source timestamps in the two existing freshness calculations. Ordinary price curves are not removed by the research eligibility gate.

Typecheck after UI wiring has 53 diagnostics versus baseline 54: no added diagnostics; one duplicate bars property removed without changing its previous effective value. The other 19 application and 34 example diagnostics remain. No config exclusions.

Chrome loaded the actual React-rendered component at http://127.0.0.1:4177 with explicitly synthetic inputs; AX text and console checks succeeded. Screenshot capture timed out. Requested 390px viewport remained 585px in measured DOM, so mobile visual acceptance is not claimed. Whole-app dev start failed loading node:async_hooks in the existing vinext Workers environment. Component inspection is not whole-app acceptance.

## Concrete remaining producer plan (not implemented/certified)

1. Preserve generation and accepted event IDs, exchange timestamp, receipt timestamp and immutable per-stream watermarks in each observation. Snapshot/transaction/order clocks must stay separate. Restart establishes a new generation; stale or late events enter a separate audit stream rather than rewriting a sealed observation.
2. Choose an explicit protocol: mixed-stream as-observed research or exchange-minute-final research. Existing vendor sequence/completeness metadata cannot certify exchange finality. A timeout only establishes policy closure and must never set exchange finality to verified. An as-observed protocol would require its own versioned acceptance criteria before the current strict gate can be changed.
3. Add an append-only commit receipt referencing row hash, byte range and generation after data fsync succeeds. Receipt failures keep rows unpublishable. Record downstream first-observed availability separately; replay uses a conservative observed upper bound, never the minute label or a pre-write timestamp. Crash tests must cover before data flush, failed fsync, partial receipt, receipt replay and clock regression.
4. Validate at least one new trading session against raw retained source evidence: cross-stream minute boundary, lunch/close, reconnect, duplicate/late events, gaps, field units and missing depth. Only then can a versioned eligibility producer be enabled. Historical Oct23 rows and labels are never recertified automatically.

No current schema writes verified finality or a durable receipt. New qualified-data research therefore remains blocked; this plan describes the concrete missing producer work rather than claiming collection is fixed.

## Type repair and independent receipt prototype checkpoint

All remaining 19 application diagnostics were repaired against actual interface semantics: nullable guidance, snapshot option declarations, polling key, informational toast declarations, undefined quote normalization, last-event narrowing, and a typed XHTML wrapper preserving the six existing foreignObject namespaces. No any/ignore/config exclusions or unrelated Remotion edits were added. Full tsc still exits 2 with exactly the 34 pre-existing bundled Remotion/example diagnostics; there are no app/lib diagnostics. Focused existing tests passed 15/15, and actual XHTML server rendering passed 1/1.

The unchanged ea26b78 baseline reproduced the same dev startup failure with `node scripts/sites-env.mjs -- vite --host 127.0.0.1 --port 4177 --strictPort`: vinext/dist/shims/internal/als-registry.js imports node:async_hooks, rejected by the SSR Workers environment. vite.config.ts supplies no nodejs_compat setting. This is a baseline runtime/configuration limitation, not evidence of a new client import. No compatibility setting was changed. The normal sandbox build failed writing the existing node_modules junction's .vite-temp; the formally approved build then passed artifact validation.

scripts/zijin_l2_persistence_receipt.py is an independently tested, NOT yet collector-wired single-writer append prototype. It writes original record bytes unchanged, fsyncs data, then appends/fsyncs a separate hash/offset receipt. Source event/received times, snapshot observedAt, receipt generation, nullable feature cutoff and data write completion remain distinct. It always keeps verified=false/minuteFinality=unverified. Three real temporary-file tests passed: hash/offset across a new invocation, data-sync failure suppressing receipts, and receipt-sync failure surfacing an error. It does not yet solve partial-tail recovery, clock rollback, receipt reader validation or collector deduplication after a receipt-only failure; do not wire it or certify data until those are tested. Existing archives are untouched. The paper durable adapter also remains independently tested but not wired into the main manual ledger.

Independent review artifact for ea26b78...9ff02f3 was saved to Library as libfile_e8dd4f0185888191bdb5a98e5e3a5b07. Windows lacks os.setxattr, so local metadata writeback failed; the Library create itself succeeded. This artifact excludes this subsequent checkpoint's changes.

The built production preview (`node scripts/sites-env.mjs -- vinext start --port 4177`) did start successfully, unlike the baseline dev command. Chrome opened the complete local demo dashboard without credentials. Actual measured desktop viewport was 1920x997; mobile was 390x844 after compensating for the browser tool's 1.5x override scaling. Screenshots showed the real status strip wrapping inside the mobile viewport (left 7.99, right 359.51), distinct quote/fetch times, visible research block explanation and ordinary chart still rendering. Captured browser error log was empty. The existing narrow navigation/watchlist still require horizontal navigation; this is scoped status-strip acceptance, not full-site responsive approval. No trade/account mutation was exercised. Viewport was reset. Market values loaded by the existing demo are not evidence that L2 finality or archive quality passed.
