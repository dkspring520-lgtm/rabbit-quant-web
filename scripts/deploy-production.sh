#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${RABBIT_QUANT_REPO:-/opt/rabbit-quant-web}"
REMOTE="${RABBIT_QUANT_REMOTE:-origin}"
BRANCH="${RABBIT_QUANT_BRANCH:-codex/vps-production-20260716}"
STATE_DIR="${RABBIT_QUANT_DEPLOY_STATE:-/var/lib/rabbit-quant-deploy}"
LOG_DIR="${RABBIT_QUANT_DEPLOY_LOG_DIR:-/var/log/rabbit-quant-deploy}"
LOCK_FILE="${RABBIT_QUANT_DEPLOY_LOCK:-/run/lock/rabbit-quant-deploy.lock}"
OPS_ASSETS_STATE_FILE="$STATE_DIR/ops-assets-v2-sha"
HEALTH_TIMEOUT="${RABBIT_QUANT_HEALTH_TIMEOUT:-300}"
IMAGE_RETENTION="${RABBIT_QUANT_IMAGE_RETENTION:-2}"
MIN_FREE_DISK_GB="${RABBIT_QUANT_MIN_FREE_DISK_GB:-8}"
BUILD_CACHE_MAX_AGE="${RABBIT_QUANT_BUILD_CACHE_MAX_AGE:-24h}"
ALERT_WEBHOOK_URL="${RABBIT_QUANT_ALERT_WEBHOOK_URL:-}"
COMPOSE_PROJECT="${RABBIT_QUANT_COMPOSE_PROJECT:-rabbit-quant-web}"
WEB_BLUE_CONTAINER="rabbit-quant-modern-web"
WEB_GREEN_CONTAINER="rabbit-quant-modern-web-green"
TRAINER_CONTAINER="rabbit-quant-zijin-trainer"
L2_CONTAINER="rabbit-quant-zijin-l2"
L2_AUDIT_CONTAINER="rabbit-quant-zijin-l2-audit"
NGINX_UPSTREAM_FILE="${RABBIT_QUANT_NGINX_UPSTREAM_FILE:-/etc/nginx/conf.d/rabbit-quant-active-upstream.conf}"
NGINX_SITE_FILE="${RABBIT_QUANT_NGINX_SITE_FILE:-/etc/nginx/sites-available/rabbit-quant}"
NGINX_COMPRESSION_FILE="${RABBIT_QUANT_NGINX_COMPRESSION_FILE:-/etc/nginx/conf.d/rabbit-quant-compression.conf}"

[[ "$IMAGE_RETENTION" =~ ^[0-9]+$ ]] || IMAGE_RETENTION=2
(( IMAGE_RETENTION >= 2 )) || IMAGE_RETENTION=2
(( IMAGE_RETENTION <= 2 )) || IMAGE_RETENTION=2
[[ "$MIN_FREE_DISK_GB" =~ ^[0-9]+$ ]] || MIN_FREE_DISK_GB=8
(( MIN_FREE_DISK_GB >= 2 )) || MIN_FREE_DISK_GB=2

mkdir -p "$STATE_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"
# 文件锁由外层 flock 进程持有，并用 --close 禁止部署脚本及其
# Docker、Git、tee 子进程继承锁描述符。直接子进程退出时锁必定释放。
if [[ "${RABBIT_QUANT_DEPLOY_LOCKED:-0}" != "1" ]]; then
  set +e
  RABBIT_QUANT_DEPLOY_LOCKED=1 flock \
    --nonblock \
    --close \
    --conflict-exit-code 75 \
    "$LOCK_FILE" "$0" "$@"
  deploy_status=$?
  set -e
  if (( deploy_status == 75 )); then
    printf '[%s] 已有部署任务运行，本轮跳过。\n' "$(date --iso-8601=seconds)"
    exit 0
  fi
  exit "$deploy_status"
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
  for repository in rabbit-quant-web rabbit-quant-trainer rabbit-quant-l2; do
    index=0
    while IFS= read -r image; do
      [[ -n "$image" && "$image" != *":<none>" ]] || continue
      index=$((index + 1))
      if (( index <= IMAGE_RETENTION )); then
        continue
      fi
      if [[ "$image" == "$previous_web_image" || "$image" == "$previous_trainer_image" || "$image" == "$previous_l2_image" || "$image" == "$web_image" || "$image" == "$trainer_image" || "$image" == "$l2_image" ]]; then
        continue
      fi
      docker image rm "$image" >/dev/null 2>&1 || true
    done < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}')
  done
  docker image prune --force --filter 'label=rabbit-quant.commit' >/dev/null 2>&1 || true
}

prune_dangling_images_and_all_build_cache() {
  docker image prune --force >/dev/null 2>&1 || true
  docker builder prune --all --force >/dev/null 2>&1 || true
}

docker_build_image() {
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build --load "$@"
  else
    DOCKER_BUILDKIT=1 docker build "$@"
  fi
}

ensure_build_space() {
  local docker_root available_kb required_kb
  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  docker_root="${docker_root:-/var/lib/docker}"
  available_kb="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')"
  required_kb=$((MIN_FREE_DISK_GB * 1024 * 1024))

  if [[ "$available_kb" =~ ^[0-9]+$ ]] && (( available_kb >= required_kb )); then
    return 0
  fi

  log "Docker build space is below ${MIN_FREE_DISK_GB}GB; pruning dangling images and old build cache."
  prune_dangling_images_and_all_build_cache
  available_kb="$(df -Pk "$docker_root" | awk 'NR == 2 { print $4 }')"
  if [[ ! "$available_kb" =~ ^[0-9]+$ ]] || (( available_kb < required_kb )); then
    log "Docker build aborted: less than ${MIN_FREE_DISK_GB}GB remains after safe cleanup."
    return 1
  fi
}

cleanup_failed_build_artifacts() {
  local image
  for image in \
    "${web_image:-}" \
    "${trainer_image:-}" \
    "${l2_image:-}"; do
    [[ -n "$image" ]] || continue
    if [[ "$image" == "${previous_web_image:-}" || "$image" == "${previous_trainer_image:-}" || "$image" == "${previous_l2_image:-}" ]]; then
      continue
    fi
    docker image rm "$image" >/dev/null 2>&1 || true
  done
  prune_dangling_images_and_all_build_cache
}

sync_operations_assets() {
  local commit="$1" temp_dir source target mode
  [[ -n "$commit" ]] || return 0
  if [[ "$(cat "$OPS_ASSETS_STATE_FILE" 2>/dev/null || true)" == "$commit" ]]; then
    return 0
  fi
  temp_dir="$(mktemp -d)"
  while IFS='|' read -r source target mode; do
    git -C "$REPO_DIR" show "$commit:$source" > "$temp_dir/asset"
    install -m "$mode" "$temp_dir/asset" "$target"
  done <<'ASSETS'
scripts/backup-production.sh|/usr/local/sbin/rabbit-quant-backup|0755
deploy/cleanup-docker-artifacts.sh|/usr/local/sbin/rabbit-quant-docker-cleanup|0755
deploy/systemd/rabbit-quant-deploy.service|/etc/systemd/system/rabbit-quant-deploy.service|0644
deploy/systemd/rabbit-quant-deploy.timer|/etc/systemd/system/rabbit-quant-deploy.timer|0644
deploy/systemd/rabbit-quant-docker-cleanup.service|/etc/systemd/system/rabbit-quant-docker-cleanup.service|0644
deploy/systemd/rabbit-quant-docker-cleanup.timer|/etc/systemd/system/rabbit-quant-docker-cleanup.timer|0644
deploy/systemd/rabbit-quant-backup.service|/etc/systemd/system/rabbit-quant-backup.service|0644
deploy/systemd/rabbit-quant-backup.timer|/etc/systemd/system/rabbit-quant-backup.timer|0644
deploy/systemd/rabbit-quant-growth.service|/etc/systemd/system/rabbit-quant-growth.service|0644
deploy/systemd/rabbit-quant-growth.timer|/etc/systemd/system/rabbit-quant-growth.timer|0644
deploy/logrotate/rabbit-quant-deploy|/etc/logrotate.d/rabbit-quant-deploy|0644
deploy/logrotate/rabbit-quant-backup|/etc/logrotate.d/rabbit-quant-backup|0644
ASSETS
  if [[ ! -f /etc/default/rabbit-quant-ops ]]; then
    git -C "$REPO_DIR" show "$commit:deploy/rabbit-quant-ops.env.example" > "$temp_dir/asset"
    install -m 0600 "$temp_dir/asset" /etc/default/rabbit-quant-ops
  fi
  rm -rf "$temp_dir"
  systemctl daemon-reload
  systemctl enable --now rabbit-quant-deploy.timer rabbit-quant-backup.timer rabbit-quant-growth.timer rabbit-quant-docker-cleanup.timer >/dev/null
  printf '%s\n' "$commit" > "$OPS_ASSETS_STATE_FILE"
  log "生产运维脚本、定时器和日志策略已同步。"
}

classify_changed_path() {
  local path="$1"
  case "$path" in
    Dockerfile.l2|requirements.l2.txt|scripts/zijin_l2_collector.py|scripts/zijin_l2_forward_labels.py|scripts/zijin_l2_second_state.py)
      l2_build_needed=1
      l2_service_needed=1
      ;;
    Dockerfile.trainer|requirements.trainer.txt)
      trainer_build_needed=1
      trainer_service_needed=1
      ;;
    .dockerignore|scripts/deploy-production.sh|scripts/install-production-deployer.sh|scripts/backup-production.sh|deploy/*|.github/*|README*|docs/*|tests/*)
      ;;
    scripts/*|lib/*|public/research/*)
      web_build_needed=1
      trainer_build_needed=1
      web_service_needed=1
      trainer_service_needed=1
      web_support_services_needed=1
      ;;
    server/*|Dockerfile.server)
      web_build_needed=1
      web_service_needed=1
      web_support_services_needed=1
      ;;
    app/*|components/*|hooks/*|styles/*|public/*|package.json|package-lock.json|tsconfig.json|next.config.*|vite.config.*|postcss.config.*|tailwind.config.*)
      web_build_needed=1
      web_service_needed=1
      ;;
    compose.web.yml)
      compose_changed=1
      ;;
    *)
      web_build_needed=1
      trainer_build_needed=1
      web_service_needed=1
      trainer_service_needed=1
      ;;
  esac
}

on_error() {
  local exit_code=$?
  if [[ "${build_started:-0}" == "1" && "${deployment_succeeded:-0}" != "1" ]]; then
    cleanup_failed_build_artifacts
  fi
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

wait_for_container_health() {
  local container="$1"
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    if container_is_healthy "$container"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

slot_port() {
  [[ "$1" == "green" ]] && printf '3001' || printf '3000'
}

slot_container() {
  [[ "$1" == "green" ]] && printf '%s' "$WEB_GREEN_CONTAINER" || printf '%s' "$WEB_BLUE_CONTAINER"
}

slot_service() {
  [[ "$1" == "green" ]] && printf 'web-green' || printf 'web-blue'
}

other_slot() {
  [[ "$1" == "green" ]] && printf 'blue' || printf 'green'
}

prepare_candidate_slot() {
  local active_slot="$1" candidate_slot="$2"
  local active_container candidate_container
  active_container="$(slot_container "$active_slot")"
  candidate_container="$(slot_container "$candidate_slot")"

  if [[ "$active_container" == "$candidate_container" ]]; then
    log "拒绝准备候选槽：活动容器与候选容器相同。"
    return 1
  fi
  if ! container_is_healthy "$active_container"; then
    log "活动槽 $active_slot 不健康，拒绝清理任何备用容器。"
    return 1
  fi
  if docker container inspect "$candidate_container" >/dev/null 2>&1; then
    log "清理非活动候选槽 $candidate_slot 的旧容器 $candidate_container。"
    docker container rm --force "$candidate_container" >/dev/null
  fi
}

write_nginx_upstream() {
  local port="$1" previous temp
  mkdir -p "$(dirname "$NGINX_UPSTREAM_FILE")"
  previous="$(cat "$NGINX_UPSTREAM_FILE" 2>/dev/null || true)"
  temp="${NGINX_UPSTREAM_FILE}.tmp"
  printf 'upstream rabbit_quant_active {\n    server 127.0.0.1:%s;\n    keepalive 32;\n}\n' "$port" > "$temp"
  mv "$temp" "$NGINX_UPSTREAM_FILE"
  if ! nginx -t >/dev/null 2>&1; then
    if [[ -n "$previous" ]]; then printf '%s\n' "$previous" > "$NGINX_UPSTREAM_FILE"; else rm -f "$NGINX_UPSTREAM_FILE"; fi
    nginx -t >/dev/null 2>&1 || true
    return 1
  fi
  systemctl reload nginx
}

ensure_nginx_compression() {
  local temp previous
  if nginx -T 2>/dev/null | grep -Eq '^[[:space:]]*gzip[[:space:]]+on;'; then
    return 0
  fi
  mkdir -p "$(dirname "$NGINX_COMPRESSION_FILE")"
  previous="$(cat "$NGINX_COMPRESSION_FILE" 2>/dev/null || true)"
  temp="${NGINX_COMPRESSION_FILE}.tmp"
  cat > "$temp" <<'EOF'
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml;
EOF
  mv "$temp" "$NGINX_COMPRESSION_FILE"
  if ! nginx -t >/dev/null 2>&1; then
    if [[ -n "$previous" ]]; then printf '%s\n' "$previous" > "$NGINX_COMPRESSION_FILE"; else rm -f "$NGINX_COMPRESSION_FILE"; fi
    nginx -t >/dev/null 2>&1 || true
    log "Nginx 压缩配置校验失败，已撤销本次修改。"
    return 1
  fi
  systemctl reload nginx
  log "已启用 Nginx 静态资源 gzip 压缩。"
}

ensure_nginx_zero_downtime() {
  local active_slot="$1" active_port site backup
  active_port="$(slot_port "$active_slot")"
  site="$(readlink -f "$NGINX_SITE_FILE" 2>/dev/null || true)"
  if [[ -z "$site" || ! -f "$site" ]]; then
    site="$(grep -rl --include='*' 'proxy_pass http://127\.0\.0\.1:3000;' /etc/nginx/sites-enabled 2>/dev/null | head -n 1 || true)"
    site="$(readlink -f "$site" 2>/dev/null || true)"
  fi
  if [[ -z "$site" || ! -f "$site" ]]; then
    log "找不到 Rabbit Quant 的 Nginx 站点配置，无法启用零停机切换。"
    return 1
  fi
  backup="${site}.before-blue-green"
  if grep -q 'proxy_pass http://127\.0\.0\.1:3000;' "$site"; then
    cp "$site" "$backup"
    sed -i 's#proxy_pass http://127\.0\.0\.1:3000;#proxy_pass http://rabbit_quant_active;#' "$site"
  elif ! grep -q 'proxy_pass http://rabbit_quant_active;' "$site"; then
    log "Nginx 站点既未指向旧端口，也未指向 rabbit_quant_active，拒绝自动改写。"
    return 1
  fi
  if ! write_nginx_upstream "$active_port"; then
    [[ -f "$backup" ]] && cp "$backup" "$site"
    log "Nginx 零停机配置校验失败，已恢复原配置。"
    return 1
  fi
}

wait_for_web_slot() {
  local slot="$1" expected_sha="$2" port container deadline
  port="$(slot_port "$slot")"
  container="$(slot_container "$slot")"
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    if container_is_healthy "$container" \
      && curl --fail --silent --show-error --max-time 5 \
        "http://127.0.0.1:${port}/api/control/version" | grep -Fq "$expected_sha"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

wait_for_release() {
  local expected_sha="$1" active_slot="${2:-blue}" require_l2_audit="${3:-1}" require_trainer="${4:-1}" require_l2="${5:-1}" require_control="${6:-1}" require_shadow="${7:-1}" require_factor_daily="${8:-0}" active_container active_port
  active_container="$(slot_container "$active_slot")"
  active_port="$(slot_port "$active_slot")"
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    local l2_audit_ready=1
    local trainer_ready=1
    local l2_ready=1
    local control_ready=1
    local shadow_ready=1
    local factor_daily_ready=1
    if [[ "$require_l2_audit" == "1" ]] && ! container_is_healthy "$L2_AUDIT_CONTAINER"; then
      l2_audit_ready=0
    fi
    if [[ "$require_trainer" == "1" ]] && ! container_is_healthy "$TRAINER_CONTAINER"; then
      trainer_ready=0
    fi
    if [[ "$require_l2" == "1" ]] && ! container_is_healthy "$L2_CONTAINER"; then
      l2_ready=0
    fi
    if [[ "$require_control" == "1" ]] && ! container_is_healthy "rabbit-quant-control"; then
      control_ready=0
    fi
    if [[ "$require_shadow" == "1" ]] && ! container_is_healthy "rabbit-quant-zijin-shadow"; then
      shadow_ready=0
    fi
    if [[ "$require_factor_daily" == "1" ]] && ! container_is_healthy "rabbit-quant-zijin-factor-daily"; then
      factor_daily_ready=0
    fi
    if (( l2_audit_ready == 1 )) \
      && (( trainer_ready == 1 )) \
      && (( l2_ready == 1 )) \
      && (( control_ready == 1 )) \
      && (( shadow_ready == 1 )) \
      && (( factor_daily_ready == 1 )) \
      && container_is_healthy "$active_container" \
      ; then
      if curl --fail --silent --show-error --max-time 5 \
        "http://127.0.0.1:${active_port}/api/control/version" | grep -Fq "$expected_sha"; then
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
  local l2_image="$4"
  local app_commit_sha="${5:-development}"
  local app_build_time="${6:-unknown}"
  local active_web_origin="${7:-http://web-blue:3000}"
  shift 7 || true
  local services=("$@") runtime_env
  local compose_status

  runtime_env="$(mktemp "$STATE_DIR/compose-runtime.XXXXXX")"
  chmod 600 "$runtime_env"
  printf '%s\n' \
    "RABBIT_QUANT_WEB_IMAGE=$web_image" \
    "RABBIT_QUANT_TRAINER_IMAGE=$trainer_image" \
    "RABBIT_QUANT_L2_IMAGE=$l2_image" \
    "APP_COMMIT_SHA=$app_commit_sha" \
    "APP_BUILD_TIME=$app_build_time" \
    "RABBIT_QUANT_ACTIVE_WEB_ORIGIN=$active_web_origin" \
    "OPENAI_API_KEY=${OPENAI_API_KEY:-}" \
    "OPENAI_MODEL=${OPENAI_MODEL:-gpt-4o-mini}" \
    "BAIDU_SUBMIT_SITE=${BAIDU_SUBMIT_SITE:-https://www.zhuandianmi.com}" \
    "BAIDU_SUBMIT_TOKEN=${BAIDU_SUBMIT_TOKEN:-}" \
    "BAIDU_SUBMIT_ENDPOINT=${BAIDU_SUBMIT_ENDPOINT:-http://data.zz.baidu.com/urls}" \
    > "$runtime_env"

  compose_status=0
  docker compose \
    --env-file "$runtime_env" \
    --project-name "$COMPOSE_PROJECT" \
    --project-directory "$REPO_DIR" \
    -f "$compose_file" \
    up -d --no-build --force-recreate --no-deps "${services[@]}" || compose_status=$?
  rm -f "$runtime_env"
  return "$compose_status"
}

append_unique_service() {
  local service="$1" existing
  for existing in "${support_services[@]}"; do
    [[ "$existing" == "$service" ]] && return 0
  done
  support_services+=("$service")
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
active_slot="$(cat "$STATE_DIR/active-web-slot" 2>/dev/null || true)"
[[ "$active_slot" == "blue" || "$active_slot" == "green" ]] || active_slot="blue"
active_port="$(slot_port "$active_slot")"
active_container="$(slot_container "$active_slot")"
previous_web_image="$(container_image "$active_container")"
previous_trainer_image="$(container_image "$TRAINER_CONTAINER")"
previous_l2_image="$(container_image "$L2_CONTAINER")"
previous_sha="$(curl --fail --silent --max-time 5 "http://127.0.0.1:${active_port}/api/control/version" 2>/dev/null | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)"
previous_sha="${previous_sha:-$deployed_sha}"
expected_active_web_sha="$(cat "$STATE_DIR/last-good-web-sha" 2>/dev/null || true)"
expected_active_web_sha="${expected_active_web_sha:-$previous_sha}"

current_stage="configure zero-downtime entry"
ensure_nginx_zero_downtime "$active_slot"
ensure_nginx_compression || log "保留现有 Nginx 压缩设置，继续部署。"

if [[ "$target_sha" == "$deployed_sha" && -n "$previous_sha" && "$previous_sha" == "$expected_active_web_sha" ]]; then
  printf '%s\n' "$previous_sha" > "$STATE_DIR/last-good-web-sha"
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
web_build_needed=0
trainer_build_needed=0
l2_build_needed=0
web_service_needed=0
trainer_service_needed=0
l2_service_needed=0
compose_changed=0
web_support_services_needed=0

if [[ -z "$deployed_sha" ]] || ! git -C "$REPO_DIR" cat-file -e "$deployed_sha^{commit}" 2>/dev/null; then
  force_full_release=1
elif [[ "$target_sha" == "$deployed_sha" ]]; then
  force_full_release=1
else
  force_full_release=0
fi

if (( force_full_release == 1 )); then
  web_build_needed=1
  trainer_build_needed=1
  l2_build_needed=1
  web_service_needed=1
  trainer_service_needed=1
  l2_service_needed=1
  web_support_services_needed=1
else
  while IFS= read -r changed_path; do
    [[ -n "$changed_path" ]] || continue
    classify_changed_path "$changed_path"
  done < <(git -C "$REPO_DIR" diff --name-only "$deployed_sha" "$target_sha")
fi

if (( compose_changed == 1 )); then
  # Compose is shared by all runtime containers. Recreate services, but only
  # rebuild images whose own source inputs changed.
  web_service_needed=1
  trainer_service_needed=1
  l2_service_needed=1
  web_support_services_needed=1
fi

if [[ -z "$previous_web_image" ]] || ! docker image inspect "$previous_web_image" >/dev/null 2>&1; then
  web_build_needed=1
  web_service_needed=1
fi
if [[ -z "$previous_trainer_image" ]] || ! docker image inspect "$previous_trainer_image" >/dev/null 2>&1; then
  trainer_build_needed=1
  trainer_service_needed=1
fi
if [[ -z "$previous_l2_image" ]] || ! docker image inspect "$previous_l2_image" >/dev/null 2>&1; then
  l2_build_needed=1
  l2_service_needed=1
fi
if [[ -z "$previous_sha" ]]; then
  # Without a known active Web commit we cannot safely validate a support-only
  # update, so make the Web image/version explicit again.
  web_build_needed=1
  web_service_needed=1
fi

web_image="$previous_web_image"
trainer_image="$previous_trainer_image"
l2_image="$previous_l2_image"
if (( web_build_needed == 1 )); then web_image="rabbit-quant-web:$short_sha"; fi
if (( trainer_build_needed == 1 )); then trainer_image="rabbit-quant-trainer:$short_sha"; fi
if (( l2_build_needed == 1 )); then l2_image="rabbit-quant-l2:$short_sha"; fi
web_runtime_sha="$previous_sha"
if (( web_build_needed == 1 )); then web_runtime_sha="$target_sha"; fi

log "变更范围：Web 构建=$web_build_needed，Trainer 构建=$trainer_build_needed，L2 构建=$l2_build_needed；Web 服务=$web_service_needed，Trainer 服务=$trainer_service_needed，L2 服务=$l2_service_needed，Compose=$compose_changed。"

if (( web_service_needed == 1 || trainer_service_needed == 1 || l2_service_needed == 1 )); then
  :
else
  printf '%s\n' "$target_sha" > "$STATE_DIR/deployed-sha"
  printf '%s\n' "$web_image" > "$STATE_DIR/last-good-web-image"
  printf '%s\n' "$trainer_image" > "$STATE_DIR/last-good-trainer-image"
  printf '%s\n' "$l2_image" > "$STATE_DIR/last-good-l2-image"
  printf '%s\n' "$previous_sha" > "$STATE_DIR/last-good-web-sha"
  cp "$compose_file" "$STATE_DIR/last-good-compose.yml"
  install -m 0755 "$release_dir/scripts/deploy-production.sh" /usr/local/sbin/rabbit-quant-deploy
  sync_operations_assets "$target_sha"
  log "本次提交没有运行时文件变化，跳过容器更新。"
  record_result "success" "无运行时变化，复用现有镜像"
  exit 0
fi

build_started=0
deployment_succeeded=0
if (( web_build_needed == 1 || trainer_build_needed == 1 || l2_build_needed == 1 )); then
  current_stage="Docker build space preflight"
  ensure_build_space
  build_started=1
fi

current_stage="配置预检"
log "预检 Compose 配置。"
RABBIT_QUANT_WEB_IMAGE="$web_image" \
RABBIT_QUANT_TRAINER_IMAGE="$trainer_image" \
RABBIT_QUANT_L2_IMAGE="$l2_image" \
  docker compose --project-directory "$REPO_DIR" -f "$compose_file" config --quiet

if (( web_build_needed == 1 )); then
  current_stage="构建 Web 镜像"
  log "先构建 Web 镜像 $web_image；构建失败不会触碰线上容器。"
  docker_build_image --pull \
    --build-arg APP_COMMIT_SHA="$target_sha" \
    --build-arg APP_BUILD_TIME="$build_time" \
    --label rabbit-quant.commit="$target_sha" \
    -t "$web_image" -f "$release_dir/Dockerfile.server" "$release_dir"
else
  log "Web 无相关改动，复用 $web_image。"
fi

if (( trainer_build_needed == 1 )); then
  current_stage="构建训练镜像"
  log "先构建训练镜像 $trainer_image；两个镜像都成功后才允许切换。"
  docker_build_image --pull \
    --label rabbit-quant.commit="$target_sha" \
    -t "$trainer_image" -f "$release_dir/Dockerfile.trainer" "$release_dir"
else
  log "Trainer 无相关改动，复用 $trainer_image。"
fi

if (( l2_build_needed == 1 )); then
  current_stage="build L2 collector image"
  log "Building L2 collector image $l2_image."
  docker_build_image --pull \
    --label rabbit-quant.commit="$target_sha" \
    -t "$l2_image" -f "$release_dir/Dockerfile.l2" "$release_dir"
else
  log "L2 无相关改动，复用 $l2_image。"
fi

active_origin="http://$(slot_service "$active_slot"):3000"
candidate_slot="$active_slot"
candidate_port="$active_port"
candidate_service="$(slot_service "$active_slot")"
candidate_origin="$active_origin"
expected_web_sha="$previous_sha"
support_services=()
required_l2_audit=0
required_trainer=0
required_l2=0
required_control=0
required_shadow=0
required_factor_daily=0

if (( web_service_needed == 1 )); then
  candidate_slot="$(other_slot "$active_slot")"
  candidate_port="$(slot_port "$candidate_slot")"
  candidate_service="$(slot_service "$candidate_slot")"
  candidate_origin="http://${candidate_service}:3000"
  expected_web_sha="$web_runtime_sha"
fi
if (( web_service_needed == 1 && web_support_services_needed == 1 )); then
  append_unique_service control
  append_unique_service shadow
  append_unique_service l2-audit
  required_control=1
  required_shadow=1
  required_l2_audit=1
fi
if (( trainer_service_needed == 1 )); then
  append_unique_service trainer
  append_unique_service factor-daily
  required_trainer=1
  required_factor_daily=1
fi
if (( l2_service_needed == 1 )); then
  append_unique_service l2
  append_unique_service l2-audit
  required_l2=1
  required_l2_audit=1
fi

current_stage="切换线上容器"
log "按变更范围切换版本 $short_sha。"
switch_failed=0
if (( web_service_needed == 1 )); then
  prepare_candidate_slot "$active_slot" "$candidate_slot"
  if ! compose_up "$compose_file" "$web_image" "$trainer_image" "$l2_image" "$web_runtime_sha" "$build_time" "$active_origin" "$candidate_service"; then
    log "Web 容器切换命令失败，准备恢复旧镜像。"
    switch_failed=1
  fi
else
  log "Web 无需更新，继续复用当前活动槽 $active_slot。"
fi

current_stage="健康验证"
if (( switch_failed == 0 )); then
  if (( web_service_needed == 1 )); then
    current_stage="candidate Web health check"
    if ! wait_for_web_slot "$candidate_slot" "$web_runtime_sha"; then
      log "Candidate Web failed health checks; live traffic was not switched."
      switch_failed=1
    elif ! write_nginx_upstream "$candidate_port"; then
      log "Nginx traffic switch failed; old Web remains active."
      switch_failed=1
    fi
  fi
  if (( switch_failed == 0 )) && (( ${#support_services[@]} > 0 )); then
    current_stage="update changed support services"
    if (( l2_service_needed == 1 )); then
      current_stage="start L2 collector"
      if ! compose_up "$compose_file" "$web_image" "$trainer_image" "$l2_image" "$web_runtime_sha" "$build_time" "$candidate_origin" l2; then
        log "L2 collector failed to start; traffic will be restored to the old Web."
        switch_failed=1
      elif ! wait_for_container_health "$L2_CONTAINER"; then
        log "L2 collector did not become healthy within ${HEALTH_TIMEOUT}s; traffic will be restored to the old Web."
        switch_failed=1
      fi
    fi

    if (( switch_failed == 0 )); then
      remaining_support_services=()
      for support_service in "${support_services[@]}"; do
        [[ "$support_service" == "l2" ]] && continue
        remaining_support_services+=("$support_service")
      done
      if (( ${#remaining_support_services[@]} > 0 )) && ! compose_up \
        "$compose_file" "$web_image" "$trainer_image" "$l2_image" "$web_runtime_sha" "$build_time" "$candidate_origin" \
        "${remaining_support_services[@]}"; then
        log "Changed support services failed to update; traffic will be restored to the old Web."
        switch_failed=1
      fi
    fi
  fi
fi

if (( switch_failed == 0 )) && wait_for_release "$expected_web_sha" "$candidate_slot" "$required_l2_audit" "$required_trainer" "$required_l2" "$required_control" "$required_shadow" "$required_factor_daily"; then
  deployment_succeeded=1
  printf '%s\n' "$candidate_slot" > "$STATE_DIR/active-web-slot"
  printf '%s\n' "$target_sha" > "$STATE_DIR/deployed-sha"
  cp "$compose_file" "$STATE_DIR/last-good-compose.yml"
  printf '%s\n' "$web_image" > "$STATE_DIR/last-good-web-image"
  printf '%s\n' "$trainer_image" > "$STATE_DIR/last-good-trainer-image"
  printf '%s\n' "$l2_image" > "$STATE_DIR/last-good-l2-image"
  printf '%s\n' "$web_runtime_sha" > "$STATE_DIR/last-good-web-sha"
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
write_nginx_upstream "$active_port" || true
[[ -f "$rollback_compose" ]] || rollback_compose="$REPO_DIR/compose.web.yml"
[[ -n "$previous_web_image" ]] || previous_web_image="$(cat "$STATE_DIR/last-good-web-image" 2>/dev/null || true)"
[[ -n "$previous_trainer_image" ]] || previous_trainer_image="$(cat "$STATE_DIR/last-good-trainer-image" 2>/dev/null || true)"
[[ -n "$previous_l2_image" ]] || previous_l2_image="$(cat "$STATE_DIR/last-good-l2-image" 2>/dev/null || true)"

if [[ -z "$previous_web_image" || -z "$previous_trainer_image" || -z "$previous_l2_image" ]]; then
  log "错误：找不到旧镜像，无法自动回滚；请检查 Docker 容器。"
  record_result "failed" "健康验证失败且缺少旧镜像"
  exit 1
fi

rollback_available_services="$(docker compose \
  --project-name "$COMPOSE_PROJECT" \
  --project-directory "$REPO_DIR" \
  -f "$rollback_compose" \
  config --services 2>/dev/null || true)"
rollback_services=()
rollback_require_l2_audit=0
rollback_require_trainer=0
rollback_require_l2=0
rollback_require_control=0
rollback_require_shadow=0
rollback_require_factor_daily=0
for rollback_service in l2 trainer factor-daily control shadow l2-audit; do
  if printf '%s\n' "$rollback_available_services" | grep -Fxq "$rollback_service"; then
    rollback_services+=("$rollback_service")
    case "$rollback_service" in
      l2-audit) rollback_require_l2_audit=1 ;;
      trainer) rollback_require_trainer=1 ;;
      l2) rollback_require_l2=1 ;;
      control) rollback_require_control=1 ;;
      shadow) rollback_require_shadow=1 ;;
      factor-daily) rollback_require_factor_daily=1 ;;
    esac
  else
    log "回滚 Compose 未定义服务 $rollback_service，跳过。"
  fi
done
if (( ${#rollback_services[@]} == 0 )); then
  log "错误：回滚 Compose 没有可恢复的支持服务。"
  record_result "failed" "回滚 Compose 缺少支持服务"
  exit 1
fi

compose_up "$rollback_compose" "$previous_web_image" "$previous_trainer_image" "$previous_l2_image" "${previous_sha:-development}" "rollback" "$active_origin" "${rollback_services[@]}"
if [[ -n "$previous_sha" ]] && wait_for_release "$previous_sha" "$active_slot" "$rollback_require_l2_audit" "$rollback_require_trainer" "$rollback_require_l2" "$rollback_require_control" "$rollback_require_shadow" "$rollback_require_factor_daily"; then
  log "已恢复旧版本 ${previous_sha:0:12}。"
  record_result "rolled_back" "新版本不健康，旧版本已恢复"
else
  log "回滚命令已执行，但旧版本健康检查未完全通过，需要人工检查。"
  record_result "rollback_warning" "旧版本健康检查未完全通过"
fi
cleanup_failed_build_artifacts
exit 1
