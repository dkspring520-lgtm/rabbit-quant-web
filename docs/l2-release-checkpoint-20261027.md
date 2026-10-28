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

## Linux acceptance received 2026-10-28 (supersedes the Linux pending gate above)

The user supplied the complete 6,596-byte terminal transcript. It was read from Library and checked against the fixed script SHA256 `cdde5589bbe5ae7e5ed152c30d6aa85a606eee3292c094754296c7bb890d4a16` and verified code HEAD `83f912fc8d519e55963ad587c45d9daca3adf65a`. This is user-executed server evidence, not a locally executed Linux run.

Ubuntu 22.04.5, Linux 5.15.0-191-generic x86_64, Python 3.10.12; start UTC 2026-10-28T00:48:53Z. Process shutdown 3/3, supervisor 13/13, research scheduling 15/15 and receipt ownership 2/2 passed: 33 tests, zero failures/errors/skips. All four SUITE_EXIT values and Acceptance exit were zero. Direct POSIX SIGTERM, open control-pipe reader join, parent stop/restart, worker failure handling and writer ownership cases passed. The retained server log is `/tmp/rabbit-l2-accept.GDKHW27n/acceptance.log`.

This closes the four-suite Linux/Python 3.10 regression gate for that exact code. It does not certify production container PID1/mount behavior, power-loss durability, upstream finality, complete raw recording, profitable signals or deployment. Current production branch/image/route/mount/rollback and backup checks remain required. This update changes documentation only; tested functionality is unchanged.
