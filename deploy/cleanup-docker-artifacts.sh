#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${RABBIT_QUANT_REPO:-/opt/rabbit-quant-web}"
STATE_DIR="${RABBIT_QUANT_DEPLOY_STATE:-/var/lib/rabbit-quant-deploy}"
LOCK_FILE="${RABBIT_QUANT_DEPLOY_LOCK:-/run/lock/rabbit-quant-deploy.lock}"
BUILD_CACHE_MAX_AGE="${RABBIT_QUANT_BUILD_CACHE_MAX_AGE:-24h}"

mkdir -p "$STATE_DIR/releases" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  printf '[%s] Deployment is running; Docker cleanup skipped.\n' "$(date --iso-8601=seconds)"
  exit 0
fi

printf '[%s] Pruning dangling Docker images.\n' "$(date --iso-8601=seconds)"
docker image prune --force

printf '[%s] Pruning build cache older than %s.\n' "$(date --iso-8601=seconds)" "$BUILD_CACHE_MAX_AGE"
docker builder prune --all --force --filter "until=$BUILD_CACHE_MAX_AGE"

while IFS= read -r -d '' release_dir; do
  git -C "$REPO_DIR" worktree remove --force "$release_dir" >/dev/null 2>&1 || rm -rf -- "$release_dir"
done < <(find "$STATE_DIR/releases" -mindepth 1 -maxdepth 1 -type d -mmin +120 -print0)
git -C "$REPO_DIR" worktree prune >/dev/null 2>&1 || true

printf '[%s] Docker cleanup completed.\n' "$(date --iso-8601=seconds)"
