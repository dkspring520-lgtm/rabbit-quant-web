# Stable backup repair: local candidate, not deployed

Scope: `scripts/backup-production.sh`, `scripts/backup_snapshot.py`, synthetic tests,
and operations documentation. This isolated directory is a file-level repair
workspace, not a branch of either the user's dirty repository or the L2 worktree.
For the approved push, these six backup files were applied to a separate clone
based on production commit ea26b78faed2e0d287151322a9e1a9e1bfa00165, on the independent
codex/backup-stable-snapshots-20261025 branch. See the latest validation record.
No source tree was modified. No server access, key access, package installation,
Git push, task registration or production-data test was performed.

## Changed behavior

The former script called tar directly on changing directories, wrote archives
under final names before verification, and coupled optional Git force-push and
retention to backup success. The candidate takes protocol-aware snapshots first,
archives only staging, checks the complete gzip stream and every tar member hash,
and treats ALL nonzero tar results (including exit 1) as failure. No remote or
retention code remains in this candidate.

SQLite retains the container's `VACUUM INTO` and `integrity_check` flow, now using
a unique destination rather than removing a prior snapshot. The Python helper
also checks the copied SQLite database with a read-only connection and closes it.
It rejects empty/short inputs, incorrect SQLite magic/page size, partial pages and
page-count/length mismatches before accepting integrity/schema checks. Integrity
alone is insufficient: SQLite accepts a zero-byte file as an empty database.

Outputs are private, uniquely named directories. `candidate-*` holds staging,
plaintext archive and either `local-verified.json` or `failed.json`. A candidate
is NEVER eligible for E-drive pulling. Only a separate `published-*` directory
containing ciphertext plus `complete.json` is eligible. Completion JSON is fsynced
under a pending name, then renamed last. Ciphertext is never published alongside
plaintext. POSIX directory fsyncs improve crash durability; target filesystem and
download-service behavior still require Linux acceptance.

## Protocol policy is mandatory, not guessed from extensions

The CLI requires an explicit JSON policy. Version 1 has `roots`, each with an
absolute `path`, unique simple ASCII `alias`, and `rules`. A rule has `pattern`
(case-sensitive fnmatch against relative paths), `protocol`, and optionally
`required` (defaults true). Every encountered regular file must match exactly one
rule. Required rules must match at least one file. Symlinks, special files,
inaccessible traversal, unknown protocols and changing inventories fail closed.
No production policy has been approved or supplied. Do not use a wildcard rule to
silence inventory failures. `exclude` rules require a reason; use only for audited
temporary/lock artifacts, never to silently omit required recovery data.

The policy MUST also declare `database.contract_id` and nonempty
`database.required_tables`, mapping table names to column-name/declared-type maps.
Preflight rejects absent/empty contracts. The copied database must contain every
declared table and column with its declared type; checks use schema metadata, not
business rows. Additional tables/columns are allowed. PK/FK/index/default/check
constraints and data completeness are not validated by this minimal contract.
Production contract approval must explicitly decide which are required.

Read-only reference: current source `server/control-store.mjs` creates `users`
(including `id TEXT`, `username TEXT`), `sessions` (`token_hash TEXT`, `user_id TEXT`),
`profiles`, `monitors`, and other tables. No production schema defaults are guessed
from this local version: deployed version compatibility must be confirmed by the
caller. The example below deliberately describes the synthetic test schema only.

`control/rabbit-control.sqlite` is a reserved logical restore target. All included
targets and aliases are checked for duplicates with NFC normalization and case
folding, including the injected database target. Duplicate targets fail before
local verification, preventing ambiguous restoration.

JSON/JSONL and policy parsing reject NaN, Infinity, -Infinity and numeric overflow
to a nonfinite float (e.g. 1e999). The overflow rejection is a conservative parser
limit even though that spelling is syntactically a JSON number. JSON output also
sets allow_nan=False.

Synthetic shape (paths must be replaced with an audited deployment inventory):

```json
{"version":1,"database":{"contract_id":"synthetic-sample-v1","required_tables":{"sample":{"value":"TEXT"}}},"roots":[{"path":"/synthetic/state","alias":"state","rules":[
  {"pattern":"raw.jsonl","protocol":"append_jsonl"},
  {"pattern":"state.json","protocol":"atomic_json"}
]}]}
```

- `append_jsonl`: only for confirmed append-only files. Open one descriptor,
  capture initial byte length, copy through the last newline inside that limit,
  parse every complete record and record omitted tail bytes. A second prefix hash,
  descriptor size and pathname identity check reject observed rewrite/truncation
  or rotation. Lines over 16 MiB fail rather than consume unbounded memory.
- `atomic_json`: only for confirmed temporary-file-plus-rename writers. Read a
  complete version from one descriptor; validate content hash and JSON. POSIX
  permits retaining the old descriptor across replacement. Do not classify an
  in-place writer this way. JSON parsing currently loads a whole JSON document;
  large daily replay files require memory sizing before approval.
- `stable_file`: for files expected stable during the read, including configuration.
  Compare descriptor metadata, pathname identity and a second content hash. This
  does not turn multiple configuration files into a transactional snapshot.

Actual reviewed local code: `zijin-l2-state-observer.mjs` appends ledgers and
`.versions/*.jsonl`, and writes state/daily replay JSON via temporary + rename.
The L2 repair tree also has receipt sidecars: server deployment identity and their
reconciliation contract are NOT established here. Do not approve those files as
independent recoverable streams without a separate contract audit. This helper
does not manufacture or reconcile receipts.

Consistency is explicitly `per-stream-cutoffs-not-system-transaction`. Each
manifest records alias-relative source, protocol, original/copy byte counts,
complete JSONL line count, omitted tail, read start/end and SHA-256. SQLite is
consistent on its own. Streams, daily replay, receipts, derived state and database
may have different cutoffs. Restore requires domain-specific reconciliation or
rebuilding derived state; that end-to-end production restore is NOT validated.
Content checks cannot establish append-only behavior for an untrusted writer or
guarantee detection of arbitrary rewrite-and-regrow races; policy approval is
essential. Snapshot readers do not pause or lock the collector.

## Space, failures and data retention

An explicit `RABBIT_QUANT_BACKUP_MAX_BYTES` is required. Reserve defaults to 4 GiB
(`RABBIT_QUANT_BACKUP_RESERVE_BYTES`). The default is a conservative proposal,
not a claim that the currently reported 14 GiB free is sufficient. Preflight
budgets four times source logical bytes plus database bytes, plus 64 MiB overhead,
and checks POSIX free inodes. The helper rechecks free space and counts bytes while
copying staging, streaming tar output and accepting ciphertext from its adapter.
Metadata and other processes' writes are not an atomic filesystem quota.

The shell preflights before VACUUM, independently checks `/data` free space using
SQLite page counts, and repeats helper preflight after copying the snapshot.
VACUUM/docker-copy themselves currently have preflight checks, not a continuous
hard byte quota. This Linux branch is untested here; acceptance must validate
peak database growth/temp-space behavior. No safe production sizing is possible
until actual source sizes and filesystem layout are known.

Failures preserve artifacts and write stage/code/time without raw exception text.
The shell also leaves a unique SQLite candidate in the container; no automatic
cleanup exists. Accumulation must be included in space checks and will eventually
block new runs. This deliberately trades disk consumption for retaining evidence.
No old archive is overwritten/deleted. Partial candidates must never be exposed
by a download directory glob. A kill/power loss can leave no failure JSON; absence
of completion still makes the run ineligible.

## Encryption is an unconfigured interface

CLI cannot publish: without an adapter it prints `LOCAL_VERIFIED_NOT_PULL_READY`.
An audited library adapter would provide `encrypt(archive, sink)`,
`verify(ciphertext, plaintext_sha256)` and `scheme`. It must perform real encryption
and authenticate/decrypt the ENTIRE ciphertext to compare plaintext SHA-256;
verification must return literal True. It must use the provided budgeted sink.
No adapter discovery, keys, passphrases, GPG execution or remote environment reads
are implemented. Tests use an explicitly labeled plaintext wrapper test double;
those tests prove gating/manifest behavior, NOT cryptographic security. A real
adapter and its key custody need separate authorization and security review.

## Run and acceptance

Synthetic tests only:

```text
python -m unittest discover -s tests -p test_backup_snapshot.py -v
```

The implementation targets Python 3.10+ and uses chunked SHA-256 instead of the
Python 3.11-only hashlib.file_digest API. Actual Linux/Python 3.10.12 acceptance
remains required. Tests create only synthetic temporary data and do not execute
backup-production.sh, read production policies/data, or require encryption keys.

CLI requires `--policy`, an existing private `--output`, standalone
`--database` snapshot, `--limit` and optional `--reserve`. `--preflight` accepts
`--database-bytes`. Do not point it at production until the following are accepted:

1. Linux Bash syntax/execution, GNU tar, flock, Docker/node:sqlite integration,
   same-inode append/truncation, POSIX rename over open descriptors, and directory
   fsync/power interruption behavior. Windows skips the POSIX rename-over-open test.
2. Production inventory/protocol policy, required files/exclusions, receipt
   reconciliation, immutable source assumptions, memory and disk sizing.
3. Real encryption/decryption validation, ciphertext-only read access and host-key
   verification; no root scheduled-task credentials.
4. Isolated restore of actual data, database checks, replay reconstruction and
   reconciliation across cutoffs. Synthetic SQLite restore is not sufficient.
5. Explicit deployment approval. Existing server timer is unchanged. E-drive
   cadence is weekly; proposed Sunday Beijing 12:00 and catch-up at next boot,
   no automatic wake or deletion. “Before important updates” remains a proposed
   additional trigger requiring confirmation. No task has been created.

The legacy server ciphertext retention of approximately 7 days is too short to
reliably cover weekly transfer plus delays. A longer window (e.g. 21 days) needs
capacity analysis and separate approval; this local candidate performs no pruning.
