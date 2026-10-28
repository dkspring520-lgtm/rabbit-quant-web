# Recovery gates, prepared only

Run inspect-recovery.sh for mount metadata, cached current images, deploy state
and exact pending/deployed object availability. It never outputs config contents,
environment, credentials or full logs. Missing expected config paths need checking
against installed deployment overrides, not automatic creation.

Before any switch, record immutable old image IDs and exact old compose release,
project name, named volume names and bind paths. Protect both previous and candidate
images from pruning. A restarting old bridge is a rollback of configuration, not
a promise to restore a healthy bridge. Keep Web/L2 outside all stop/up commands.

For read-write named volumes (Paperclip home, bridge state and artifacts): obtain
separate approval for a short research-only quiescence window. Stop only these
research writers gracefully, verify stopped, then copy the complete volume trees
with ownership/modes preserved using existing host tools. Do not copy a live DB
or silently drop WAL/journal files. If other writers share a mount, they must be
identified before claiming a consistent snapshot. No docker daemon stop required.

For configuration bind mounts: copy existing files without printing contents into
a root-only snapshot directory, preserving permissions. For read-only datasets:
record catalog/version/checksum and confirm their backing storage is recoverable;
read-only in the bridge does not prove no other process changes them. If datasets
are mutable, identify/version or quiesce their actual writer before taking a copy.

Produce a manifest and SHA256 sidecars, check archive integrity, then extract into
a separate temporary restore directory and compare inventory/checksums. Database
consistency requires its actual supported integrity/recovery check after identifying
format; file checksum alone does not establish semantic integrity. Use only already
available tools. Report absent tooling rather than install or bypass checks.

After candidate network success and verified recovery, an explicitly approved
switch should use exact staged compose/image and --no-deps --no-build --pull never
for only paperclip and research-bridge. Do not use the whole deploy.sh blindly:
it can pull, prune, chown configuration, initialize missing config and rebuild.
This plan is not an executable production command until mount/config metadata and
image availability have been checked. New network gives outbound capability, as
approved; it is not an outbound allowlist.

Pending reconciliation: preserve old state values; require candidate object locally
present and reject fallback to another SHA. Write the approved target only under
the existing publisher's exclusive execution discipline while timer/service idle.
On successful exact-image/commit and host-health verification, record matching
research-deployed target and clear only the matching pending request. If rollback
is required, restore configuration/images and, if writes occurred, verified data
snapshot with research writers stopped; retain failure evidence and keep timer
paused until pending/deployed/remote target cannot reapply the failed release.
Do not mark overall Web deployed-sha as changed by a manual research-only switch.

Classifier tests certify path flags only. The overall publisher can still force
full release for missing state/objects/images or unknown active Web SHA. Therefore
research-only path classification does not authorize running the full publisher.
