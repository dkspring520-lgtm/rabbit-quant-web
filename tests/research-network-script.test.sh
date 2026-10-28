#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export MOCK_STATE="$tmp/state"
mkdir -p "$tmp/bin" "$MOCK_STATE"
cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$MOCK_STATE/calls"
case "$1 $2" in
 'image inspect') echo sha256:e2b39f7b64281324929257d0f8004fb6cb4bf0fdfb9aa8cedb235a766aec31da;;
 'network create') name=${@: -1}; echo "$name" | sed -E 's/-(internal|access)$//' > "$MOCK_STATE/$name";;
 'network connect') :;;
 'container inspect'|'network inspect') cat "$MOCK_STATE/${@: -1}";;
 'container rm') rm "$MOCK_STATE/${@: -1}";;
 'network rm') rm "$MOCK_STATE/${@: -1}";;
 'container ls'|'network ls') :;;
 *) case "$1" in
   create) while [[ $1 != --name ]]; do shift; done; name=$2; echo "$name" | sed -E 's/-(internal-only|dual-network)$//' > "$MOCK_STATE/$name";;
   start|exec) :;;
   port) if [[ $2 == *dual-network ]]; then echo 127.0.0.1:49152; fi;;
   *) exit 90;;
 esac;;
esac
MOCK
cat > "$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
while [[ $1 != --output ]]; do shift; done
printf rabbit-network-synthetic > "$2"
printf '%s' "${MOCK_HTTP:-200}"
MOCK
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH"
bash "$root/deploy/paperclip/accept-research-network.sh" > "$tmp/pass.log"
grep -q 'CANDIDATE_HTTP_PASS internal_only_host=false dual_network_host=true' "$tmp/pass.log"
[[ $(find "$MOCK_STATE" -type f ! -name calls | wc -l) == 0 ]]
if MOCK_HTTP=503 bash "$root/deploy/paperclip/accept-research-network.sh" > "$tmp/fail.log"; then echo 'unexpected success'; exit 1; fi
grep -q DUAL_NETWORK_FAILED "$tmp/fail.log"
[[ $(find "$MOCK_STATE" -type f ! -name calls | wc -l) == 0 ]]
! grep -Eq 'pull |prune|production|rabbit-quant-paperclip' "$MOCK_STATE/calls"
echo 'PASS: synthetic Docker orchestration success/failure and owned cleanup; not real Docker.'
