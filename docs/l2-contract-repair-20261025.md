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
