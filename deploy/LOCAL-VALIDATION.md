# Local verification record

## Independent branch candidate (latest)

Based on production branch commit `ea26b78faed2e0d287151322a9e1a9e1bfa00165`
in a separate clone, branch `codex/backup-stable-snapshots-20261025`. The reviewed
patch SHA-256 `16b8e6d9d21551c0f6a30212d10a9c79756618f48b7c952164dffc90bd30b9a9`
was verified before application; `git apply --check` passed against this base.
No L2 branch or user working-tree changes are included.

Python 3.10 compatibility correction: replaced both Python 3.11-only
`hashlib.file_digest` calls with chunked SHA-256. Added a real archive build test
with that API unavailable and a multiple-chunk digest test.

Latest full suite on the candidate code: **34 tests, 33 passed, 1 POSIX-only test
skipped, 0 failures/errors**, 2.132 seconds, under formally approved elevated
Windows execution. Python 3.10 grammar parsing, Git Bash `bash -n`, and
`git diff --check` passed. The earlier 31-pass/1-skip result below is historical.
Python 3.10 is not installed locally: syntax/API checks do not substitute for the
server's Python 3.10.12 execution. No packages were installed. Linux acceptance
must run this final candidate's complete suite; no older independent test result
is claimed as evidence for this revision.

## Earlier local patch evidence

Date: 2026-10-25. Environment: Windows 11 (10.0.26300), Python 3.12.0,
Windows bsdtar 3.8.9/libarchive 3.8.9. Existing Git Bash used only for `bash -n`.

Final synthetic suite after independent review fixes: 32 discovered; 31 passed,
1 skipped, 0 failures/errors. This result was obtained under explicitly approved
`require_escalated` execution on the same Windows machine, NOT the restricted
sandbox. The final execution returned exit code 0, ran 32 tests in 1.710 seconds,
and also completed Python compilation and Git Bash syntax checks.
Command: `python -m unittest discover -s tests -p test_backup_snapshot.py -v`.
The skipped test is POSIX atomic replacement of a pathname while its old file
descriptor remains open; Windows file-sharing semantics differ. Replacement
before opening, JSON validation and immutable version capture passed on Windows.

Independent review reproduced three code defects: zero-byte SQLite acceptance,
duplicate logical database restore target, and permissive nonfinite JSON numbers.
All are fixed. Nine added tests cover empty/truncated SQLite, wrong business
table/column/type contracts, missing explicit schema policy, reserved/casefold
target conflicts, and NaN/Infinity/-Infinity/overflow in JSON and JSONL. The
zero-byte case additionally asserts no local-verified marker is produced.

Execution environments must not be conflated: the initial 23-test approved run
was 22 pass / 1 skip. The independent restricted-sandbox rerun was reported as
19 pass / 3 environment errors / 1 skip; its three WinError 5 rename errors were
not code assertion failures and are not counted as passes. They occurred on
source/next.tmp replacement and the two ciphertext publication renames. The
reviewer did not bypass restrictions. The final 32-test result above used formal
approval for the previously identified local rename/MSYS restrictions. Linux
behavior remains unverified despite passing the approved Windows run.

Passed: concurrent append at a deterministic interleaving, truncation, prefix
rewrite, partial final line cutoff, damaged complete JSONL/JSON, required source
absence, new/unknown source rejection, stable-file mutation, preflight budget
failure, runtime reserve failure, all tar nonzero exits (injected exit 1), gzip
truncation, no publication without verified encryption, interruption before
completion rename, mock-adapter ciphertext manifest hash/size and isolation,
preservation of old backups on success/failure, sanitized error records, damaged
SQLite rejection and isolated synthetic SQLite restore/integrity/data readback.

The crypto adapter used in two publication tests is explicitly a plaintext wrapper
test double, not encryption. No production crypto adapter or credentials exist.

`bash --noprofile --norc -n scripts/backup-production.sh`: PASS.
`python -m py_compile scripts/backup_snapshot.py tests/test_backup_snapshot.py`: PASS.
The Bash file was normalized to UTF-8 without BOM and LF endings.

Early test execution exposed unclosed SQLite connections; fixed with explicit
connection closing. Sandbox denied synthetic file rename and Git Bash MSYS object
creation. The same authorized local operations were retried through explicit
elevated review and succeeded. No current permission blocker remains.

Source repository backup script SHA-256 remained unchanged from initial survey:
`C51A2FF37ACE63F2CA587ED7CA4E4A98B8AA5BE2CDE8C1A4B1C519BE621B720F`.
This independent file-level workspace does not modify either original repository
or the L2 repair worktree. Existing task notes were not changed.

Not run: production script, Docker/Node SQLite VACUUM branch, Linux GNU tar/flock,
POSIX rename-over-open test, POSIX inode/fsync checks, real encryption/decryption,
production recovery or any server command. See BACKUP-SNAPSHOT-REPAIR.md for
required deployment acceptance and the preflight-only limits of VACUUM/docker cp.
