#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${RABBIT_QUANT_REPO:-/opt/rabbit-quant-web}"
REMOTE="${RABBIT_QUANT_REMOTE:-origin}"
BRANCH="${RABBIT_QUANT_BRANCH:-codex/vps-production-20260716}"
STATE_DIR="${RABBIT_QUANT_DEPLOY_STATE:-/var/lib/rabbit-quant-deploy}"
LOG_DIR="${RABBIT_QUANT_DEPLOY_LOG_DIR:-/var/log/rabbit-quant-deploy}"
LOCK_FILE="${RABBIT_QUANT_DEPLOY_LOCK:-/run/lock/rabbit-quant-deploy.lock}"
HEALTH_TIMEOUT="${RABBIT_QUANT_HEALTH_TIMEOUT:-300}"
IMAGE_RETENTION="${RABBIT_QUANT_IMAGE_RETENTION:-5}"
ALERT_WEBHOOK_URL="${RABBIT_QUANT_ALERT_WEBHOOK_URL:-}"
COMPOSE_PROJECT="${RABBIT_QUANT_COMPOSE_PROJECT:-rabbit-quant-web}"
WEB_CONTAINER="rabbit-quant-modern-web"
TRAINER_CONTAINER="rabbit-quant-zijin-trainer"

[[ "$IMAGE_RETENTION" =~ ^[0-9]+$ ]] || IMAGE_RETENTION=5
(( IMAGE_RETENTION >= 2 )) || IMAGE_RETENTION=2

mkdir -p "$STATE_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"
# 文件锁由外层 flock 进程持有，并用 --close 禁止部署脚本及其
# Docker、Git、tee 子进程继承锁描述符。直接子进程退出时锁必定释放。
if [[ "${RABBIT_QUANT_DEPLOY_LOCKED:-0}" != "1" ]]; then
  if RABBIT_QUANT_DEPLOY_LOCKED=1 flock --nonblock --close "$LOCK_FILE" "$0" "$@"; then
    exit 0
  fi
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

notify_ops() {
  local status="$1"
  local message="$2"
  local payload escaped_message escaped_stage
  escaped_message="${message//\\/\\\\}"; escaped_message="${escaped_message//\"/\\\"}"; escaped_message="${escaped_message//$'\n'/\\n}"
  escaped_stage="${current_stage//\\/\\\\}"; escaped_stage="${escaped_stage//\"/\\\"}"
  payload="$(printf '{"service":"rabbit-quant-deploy","status":"%s","commit":"%s","stage":"%s","message":"%s","time":"%s"}' "$status" "$target_sha" "$escaped_stage" "$escaped_message" "$(date --utc --iso-8601=seconds)")"
  printf '%s\n' "$payload" > "$STATE_DIR/last-notification.json"
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    curl --fail --silent --show-error --max-time 10 \
      -H 'content-type: application/json' \
      --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null \
      || log "运维通知发送失败；不改变本次部署结果。"
  fi
}

record_result() {
  local status="$1"
  local message="$2"
  printf '{"time":"%s","status":"%s","commit":"%s","stage":"%s","message":"%s"}\n' \
    "$(date --utc --iso-8601=seconds)" "$status" "$target_sha" "$current_stage" "$message" \
    >> "$LOG_DIR/deploy-history.jsonl"
  notify_ops "$status" "$message"
}

prune_release_images() {
  local repository image index
  for repository in rabbit-quant-web rabbit-quant-trainer; do
    index=0
    while IFS= read -r image; do
      [[ -n "$image" && "$image" != *":<none>" ]] || continue
      index=$((index + 1))
      if (( index <= IMAGE_RETENTION )); then
        continue
      fi
      if [[ "$image" == "$previous_web_image" || "$image" == "$previous_trainer_image" || "$image" == "$web_image" || "$image" == "$trainer_image" ]]; then
        continue
      fi
      docker image rm "$image" >/dev/null 2>&1 || true
    done < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}')
  done
  docker image prune --force --filter 'label=rabbit-quant.commit' >/dev/null 2>&1 || true
}

sync_operations_assets() {
  local commit="$1" temp_dir source target mode
  [[ -n "$commit" ]] || return 0
  if [[ "$(cat "$STATE_DIR/ops-assets-sha" 2>/dev/null || true)" == "$commit" ]]; then
    return 0
  fi
  temp_dir="$(mktemp -d)"
  while IFS='|' read -r source target mode; do
    git -C "$REPO_DIR" show "$commit:$source" > "$temp_dir/asset"
    install -m "$mode" "$temp_dir/asset" "$target"
  done <<'ASSETS'
scripts/backup-production.sh|/usr/local/sbin/rabbit-quant-backup|0755
deploy/systemd/rabbit-quant-deploy.service|/etc/systemd/system/rabbit-quant-deploy.service|0644
deploy/systemd/rabbit-quant-deploy.timer|/etc/systemd/system/rabbit-quant-deploy.timer|0644
deploy/systemd/rabbit-quant-backup.service|/etc/systemd/system/rabbit-quant-backup.service|0644
deploy/systemd/rabbit-quant-backup.timer|/etc/systemd/system/rabbit-quant-backup.timer|0644
deploy/logrotate/rabbit-quant-deploy|/etc/logrotate.d/rabbit-quant-deploy|0644
deploy/logrotate/rabbit-quant-backup|/etc/logrotate.d/rabbit-quant-backup|0644
ASSETS
  if [[ ! -f /etc/default/rabbit-quant-ops ]]; then
    git -C "$REPO_DIR" show "$commit:deploy/rabbit-quant-ops.env.example" > "$temp_dir/asset"
    install -m 0600 "$temp_dir/asset" /etc/default/rabbit-quant-ops
  fi
  rm -rf "$temp_dir"
  systemctl daemon-reload
  systemctl enable --now rabbit-quant-deploy.timer rabbit-quant-backup.timer >/dev/null
  printf '%s\n' "$commit" > "$STATE_DIR/ops-assets-sha"
  log "生产运维脚本、定时器和日志策略已同步。"
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
  local app_commit_sha="${4:-development}"
  local app_build_time="${5:-unknown}"
  local runtime_env
  local compose_status

  runtime_env="$(mktemp "$STATE_DIR/compose-runtime.XXXXXX")"
  chmod 600 "$runtime_env"
  printf '%s\n' \
    "RABBIT_QUANT_WEB_IMAGE=$web_image" \
    "RABBIT_QUANT_TRAINER_IMAGE=$trainer_image" \
    "APP_COMMIT_SHA=$app_commit_sha" \
    "APP_BUILD_TIME=$app_build_time" \
    > "$runtime_env"

  compose_status=0
  docker compose \
    --env-file "$runtime_env" \
    --project-name "$COMPOSE_PROJECT" \
    --project-directory "$REPO_DIR" \
    -f "$compose_file" \
    up -d --no-build --force-recreate || compose_status=$?
  rm -f "$runtime_env"
  return "$compose_status"
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
  sync_operations_assets "$deployed_sha"
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
if ! compose_up "$compose_file" "$web_image" "$trainer_image" "$target_sha" "$build_time"; then
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
  sync_operations_assets "$target_sha"
  prune_release_images
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

compose_up "$rollback_compose" "$previous_web_image" "$previous_trainer_image" "${previous_sha:-development}" "rollback"
if [[ -n "$previous_sha" ]] && wait_for_release "$previous_sha"; then
  log "已恢复旧版本 ${previous_sha:0:12}。"
  record_result "rolled_back" "新版本不健康，旧版本已恢复"
else
  log "回滚命令已执行，但旧版本健康检查未完全通过，需要人工检查。"
  record_result "rollback_warning" "旧版本健康检查未完全通过"
fi
exit 1
