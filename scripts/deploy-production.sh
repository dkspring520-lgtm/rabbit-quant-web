#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${RABBIT_QUANT_REPO:-/opt/rabbit-quant-web}"
REMOTE="${RABBIT_QUANT_REMOTE:-origin}"
BRANCH="${RABBIT_QUANT_BRANCH:-codex/vps-production-20260716}"
STATE_DIR="${RABBIT_QUANT_DEPLOY_STATE:-/var/lib/rabbit-quant-deploy}"
LOG_DIR="${RABBIT_QUANT_DEPLOY_LOG_DIR:-/var/log/rabbit-quant-deploy}"
LOCK_FILE="${RABBIT_QUANT_DEPLOY_LOCK:-/run/lock/rabbit-quant-deploy.lock}"
HEALTH_TIMEOUT="${RABBIT_QUANT_HEALTH_TIMEOUT:-300}"
COMPOSE_PROJECT="${RABBIT_QUANT_COMPOSE_PROJECT:-rabbit-quant-web}"
WEB_CONTAINER="rabbit-quant-modern-web"
TRAINER_CONTAINER="rabbit-quant-zijin-trainer"

mkdir -p "$STATE_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '[%s] 已有部署任务运行，本轮跳过。\n' "$(date --iso-8601=seconds)"
  exit 0
fi

exec > >(tee -a "$LOG_DIR/deploy.log") 2>&1

release_dir=""
target_sha="unknown"
current_stage="初始化"
cleanup() {
  if [[ -n "$release_dir" && -d "$release_dir" ]]; then
    git -C "$REPO_DIR" worktree remove --force "$release_dir" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

record_result() {
  local status="$1"
  local message="$2"
  printf '{"time":"%s","status":"%s","commit":"%s","stage":"%s","message":"%s"}\n' \
    "$(date --utc --iso-8601=seconds)" "$status" "$target_sha" "$current_stage" "$message" \
    >> "$LOG_DIR/deploy-history.jsonl"
}

on_error() {
  local exit_code=$?
  log "部署失败：阶段=$current_stage，退出码=$exit_code；尚未成功切换的构建不会替换线上版本。"
  record_result "failed" "命令异常退出，退出码 $exit_code"
  exit "$exit_code"
}
trap on_error ERR

container_image() {
  docker inspect "$1" --format '{{.Config.Image}}' 2>/dev/null || true
}

container_is_healthy() {
  local container="$1"
  local state health
  state="$(docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null || true)"
  health="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true)"
  [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]
}

wait_for_release() {
  local expected_sha="$1"
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    if container_is_healthy "$WEB_CONTAINER" \
      && container_is_healthy "rabbit-quant-control" \
      && container_is_healthy "$TRAINER_CONTAINER" \
      && container_is_healthy "rabbit-quant-zijin-shadow"; then
      if curl --fail --silent --show-error --max-time 5 \
        http://127.0.0.1:3000/api/control/version | grep -Fq "$expected_sha"; then
        return 0
      fi
    fi
    sleep 5
  done
  return 1
}

compose_up() {
  local compose_file="$1"
  local web_image="$2"
  local trainer_image="$3"
  RABBIT_QUANT_WEB_IMAGE="$web_image" \
  RABBIT_QUANT_TRAINER_IMAGE="$trainer_image" \
    docker compose \
      --project-name "$COMPOSE_PROJECT" \
      --project-directory "$REPO_DIR" \
      -f "$compose_file" \
      up -d --no-build --force-recreate
}

if [[ ! -d "$REPO_DIR/.git" ]]; then
  log "错误：$REPO_DIR 不是 Git 仓库。"
  exit 1
fi

current_stage="拉取版本"
log "检查 $REMOTE/$BRANCH 是否有新版本。"
git -C "$REPO_DIR" fetch --quiet "$REMOTE" "$BRANCH"
target_sha="$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)"
short_sha="${target_sha:0:12}"
deployed_sha="$(cat "$STATE_DIR/deployed-sha" 2>/dev/null || true)"

if [[ "$target_sha" == "$deployed_sha" ]] \
  && curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/control/version | grep -Fq "$target_sha"; then
  log "线上已是 $short_sha，无需部署。"
  exit 0
fi

release_dir="$STATE_DIR/releases/$target_sha"
mkdir -p "$(dirname "$release_dir")"
rm -rf "$release_dir"
git -C "$REPO_DIR" worktree prune
git -C "$REPO_DIR" worktree add --detach "$release_dir" "$target_sha" >/dev/null

compose_file="$release_dir/compose.web.yml"
build_time="$(date --utc --iso-8601=seconds)"
web_image="rabbit-quant-web:$short_sha"
trainer_image="rabbit-quant-trainer:$short_sha"

current_stage="配置预检"
log "预检 Compose 配置。"
RABBIT_QUANT_WEB_IMAGE="$web_image" \
RABBIT_QUANT_TRAINER_IMAGE="$trainer_image" \
  docker compose --project-directory "$REPO_DIR" -f "$compose_file" config --quiet

current_stage="构建 Web 镜像"
log "先构建 Web 镜像 $web_image；构建失败不会触碰线上容器。"
docker build --pull \
  --build-arg APP_COMMIT_SHA="$target_sha" \
  --build-arg APP_BUILD_TIME="$build_time" \
  --label rabbit-quant.commit="$target_sha" \
  -t "$web_image" -f "$release_dir/Dockerfile.server" "$release_dir"

current_stage="构建训练镜像"
log "先构建训练镜像 $trainer_image；两个镜像都成功后才允许切换。"
docker build --pull \
  --label rabbit-quant.commit="$target_sha" \
  -t "$trainer_image" -f "$release_dir/Dockerfile.trainer" "$release_dir"

previous_web_image="$(container_image "$WEB_CONTAINER")"
previous_trainer_image="$(container_image "$TRAINER_CONTAINER")"
previous_sha="$(curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/control/version 2>/dev/null | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)"

current_stage="切换线上容器"
log "构建全部通过，开始切换到 $short_sha。"
if ! compose_up "$compose_file" "$web_image" "$trainer_image"; then
  log "容器切换命令失败，准备恢复旧镜像。"
  switch_failed=1
else
  switch_failed=0
fi

current_stage="健康验证"
if (( switch_failed == 0 )) && wait_for_release "$target_sha"; then
  printf '%s\n' "$target_sha" > "$STATE_DIR/deployed-sha"
  cp "$compose_file" "$STATE_DIR/last-good-compose.yml"
  printf '%s\n' "$web_image" > "$STATE_DIR/last-good-web-image"
  printf '%s\n' "$trainer_image" > "$STATE_DIR/last-good-trainer-image"
  install -m 0755 "$release_dir/scripts/deploy-production.sh" /usr/local/sbin/rabbit-quant-deploy
  log "部署成功：$short_sha；版本接口与四个容器健康检查均通过。"
  record_result "success" "四个容器和版本接口健康"
  exit 0
fi

current_stage="自动回滚"
log "新版本健康验证失败，线上版本不予保留，开始自动回滚。"
rollback_compose="$STATE_DIR/last-good-compose.yml"
[[ -f "$rollback_compose" ]] || rollback_compose="$REPO_DIR/compose.web.yml"
[[ -n "$previous_web_image" ]] || previous_web_image="$(cat "$STATE_DIR/last-good-web-image" 2>/dev/null || true)"
[[ -n "$previous_trainer_image" ]] || previous_trainer_image="$(cat "$STATE_DIR/last-good-trainer-image" 2>/dev/null || true)"

if [[ -z "$previous_web_image" || -z "$previous_trainer_image" ]]; then
  log "错误：找不到旧镜像，无法自动回滚；请检查 Docker 容器。"
  record_result "failed" "健康验证失败且缺少旧镜像"
  exit 1
fi

compose_up "$rollback_compose" "$previous_web_image" "$previous_trainer_image"
if [[ -n "$previous_sha" ]] && wait_for_release "$previous_sha"; then
  log "已恢复旧版本 ${previous_sha:0:12}。"
  record_result "rolled_back" "新版本不健康，旧版本已恢复"
else
  log "回滚命令已执行，但旧版本健康检查未完全通过，需要人工检查。"
  record_result "rollback_warning" "旧版本健康检查未完全通过"
fi
exit 1
