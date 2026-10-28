# Research ingress candidate (2026-10-28)

Based on production remote ea26b78faed2e0d287151322a9e1a9e1bfa00165.
Only bridge packaging and research network changes; no chart/L2/strategy changes.
The user approved adding outbound capability to these research containers.
Keep research-control internal; add research-access ordinary NAT bridge. Bind
published ports literally to 127.0.0.1, disallowing bind-host overrides.
This does not certify application authentication or outbound policy enforcement.

## Evidence and candidate

Production Docker 29.1.3: internal-only bridge, stable endpoint/container ID,
internal HTTP 200 with localhost Host, but no published port and host refused.
This identifies ingress failure, not proof of Docker root cause. The comparison
script tests the hypothesis with synthetic HTTP and no production mounts.
It requires the exact already-cached Node image ID, never pulls/builds, creates
only uniquely labelled temporary resources and retains its acceptance log.
It does not send outbound requests. Internal-only success is reported honestly;
dual-network loopback HTTP success is required. Cleanup failure makes exit nonzero.

Local validation: network invariant failed before config change, then passed.
Nine Node cases passed (one bridge case required formal outside-sandbox rerun
after Windows temporary rename EPERM). Bash syntax passed. Fake Docker/HTTP
orchestration tested baseline no port, dual HTTP success, HTTP failure, and owned
resource cleanup. These are not Linux/Docker network acceptance.

## Release gates (not executed)

1. Run deploy/paperclip/accept-research-network.sh on existing server; retain full log.
2. Validate recovery snapshot and image/config rollback, including Paperclip data.
3. Keep deploy timer paused and service inactive during approved switch. Read and
   reconcile paperclip-pending-sha with the chosen release; do not blindly delete
   pending state or let an older pending release recreate the old configuration.
4. Review this branch against actual server source before any production merge.
   Existing deploy.sh may pull/prune and force-recreate; do not invoke it as a
   read-only check or use it blindly for this constrained repair.
5. Stage exact immutable bridge image plus matching compose release; after explicit
   production approval recreate only research services, verify host health and
   commit, ordinary Web/L2 continuity, then reconcile deployed/pending state using
   the approved publisher protocol before restoring timer.

Chart commit 8f3f78d is separate and excluded. It needs a separate reviewed release:
the existing deploy classifier treats lib changes as affecting more than Web.
No production network, daemon, firewall, Web/L2 or timer operation was performed
by this branch. No claim of production deployment or strategy readiness.

Server candidate evidence supplied by user: 2026-10-28 08:56:32Z,
Docker 29.1.3, owner rabbit-network-vcpVXAeh, fixed cached Node ID matched.
Internal-only app HTTP passed but had no published port; dual network app passed
and loopback port 32768 returned HTTP 200. Both containers and networks removed,
exit 0; log /tmp/rabbit-network-candidate.vcpVXAeh/acceptance.log.
This proves synthetic ingress, not application auth, outbound policy or strategy.
The script was moved unchanged from scripts/ to deploy/paperclip/ so the existing
publisher does not classify it as a Web/Trainer/support runtime change.
Original delivered bytes: SHA256
6418aecbbc3d689492619fddec1cf30a32d5cde9fbd97cfb2bc7b187828691ea.
