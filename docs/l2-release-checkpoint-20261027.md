# Limited release checkpoint — 2026-10-27

Implementation under review: `109b028955a28504ba03de6bae7475be7db940ee`.
No new production algorithm or strategy changes were needed in this checkpoint.
The existing patch covers timestamp parsing, visible storage errors, provenance and research gating, status display, and explicit manual simulation safeguards.

## Executed checks

- Node: 27 cases across l2-contract-repair, l2-replay-availability, paper-native-lock, manual-paper-session, paper-safety-adapter and data-state-strip. Initial sandbox run: 26 passed, one observer integration case failed with EPERM renaming its synthetic temporary state file. Formal approved rerun of the seven-case contract suite: all seven passed. Thus all 27 selected cases passed across these runs; the initial failure is retained here.
- Windows / Python 3.12: process shutdown 2 passed / 1 POSIX skip; supervisor 13 passed; scheduling 15 passed; receipt ownership 2 passed. Total 32 passed / 1 skipped under formal approval. Initial sandbox process suite timed out on child exit and failed graceful-stop recovery; the approved rerun passed both Windows cases. This does not establish Linux behavior.
- No Docker executable is available; WSL reports not installed. The final Linux/Python 3.10 rerun remains required. Do not reuse the old 6374d69 Linux failure as a result for the fixed head, or call Windows success Linux acceptance.
- Existing build/UI evidence is recorded in l2-integration-20261025.md; build/browser/typecheck were not rerun because this checkpoint changes documentation only. Full typecheck has 34 previously recorded Remotion/example diagnostics and is not green.

## Remote and production evidence

Formal approved read-only GitHub access confirmed PR #5 OPEN/DRAFT, base `codex/vps-production-20260716`, head `codex/l2-contract-repair-20261025` at the implementation SHA above. `git ls-remote` agreed. statusCheckRollup was empty: no CI success is claimed.

Public Chrome reads at approximately 20:27 Asia/Shanghai returned build 72c35219008e and release ea26b78faed2. Collector heartbeat was alive, last snapshot 20261027-152958065; audit was market-closed with zero observations/labels. After-hours stale is not an outage. Forward reported 14093 samples / 13535 labels / final minute 1457; these counters do not establish durable complete raw recording or qualified causal research data.

## Release boundary

The checked service watches the production branch, not this draft branch. Its timer is 15 seconds (the older prose says one minute). Dependencies are wired into Dockerfile.l2 and the deployment classifier; L2 stop_grace_period is 20s. The script retains a previous image and last-good Compose for health-triggered rollback, but actual server image availability, configuration, active route and rollback viability have not been verified. No server connection, installation, merge, deployment, training, real order or production data write was performed.

Before production: obtain the four-suite Linux result at the reviewed code head; verify actual audit/collector image and source plus state mounts and rollback artifacts; explicitly review removal of unverified research markers; then validate a new real trading session's clocks, receipts, gaps and field provenance. Local persistence receipts do not certify exchange finality. No new profitable strategy or automatic signal promotion is approved.
