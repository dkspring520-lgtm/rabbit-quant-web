#!/usr/bin/env bash
# Execute only the actual classifier function, never source the deploy script.
set -euo pipefail
cd "$(dirname "$0")/.."
classifier=$(sed -n '/^classify_changed_path() {$/,/^}$/p' scripts/deploy-production.sh)
[[ $classifier == *'case "$path" in'* ]] || exit 1
eval "$classifier"
reset_flags() {
  paperclip_update_needed=0
  web_build_needed=0 trainer_build_needed=0 l2_build_needed=0
  web_service_needed=0 trainer_service_needed=0 l2_service_needed=0
  web_support_services_needed=0 compose_changed=0
}
# Positive control proves this catches the misplaced script regression.
reset_flags
classify_changed_path scripts/accept-research-network.sh
[[ $web_build_needed == 1 && $trainer_build_needed == 1 && $web_support_services_needed == 1 ]]
reset_flags
while IFS= read -r file; do classify_changed_path "$file"; done < <(
  { git diff --name-only ea26b78faed2e0d287151322a9e1a9e1bfa00165 --diff-filter=ACMRT; git ls-files --others --exclude-standard; } | sort -u
)
[[ $paperclip_update_needed == 1 ]]
[[ $web_build_needed == 0 && $trainer_build_needed == 0 && $l2_build_needed == 0 ]]
[[ $web_service_needed == 0 && $trainer_service_needed == 0 && $l2_service_needed == 0 ]]
[[ $web_support_services_needed == 0 && $compose_changed == 0 ]]
echo 'PASS actual classifier: research only; Web/Trainer/L2/support flags all zero.'
# Runtime missing-state/image fallbacks are intentionally not certified here.
