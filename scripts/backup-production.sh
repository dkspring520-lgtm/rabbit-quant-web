#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="${RABBIT_QUANT_BACKUP_DIR:-/opt/rabbit-quant-backups}"
RETENTION_DAYS="${RABBIT_QUANT_BACKUP_RETENTION_DAYS:-14}"
CONTROL_CONTAINER="${RABBIT_QUANT_CONTROL_CONTAINER:-rabbit-quant-control}"
STATE_DIR="${RABBIT_QUANT_DEPLOY_STATE:-/var/lib/rabbit-quant-deploy}"
LOG_DIR="${RABBIT_QUANT_DEPLOY_LOG_DIR:-/var/log/rabbit-quant-deploy}"
LOCK_FILE="${RABBIT_QUANT_BACKUP_LOCK:-/run/lock/rabbit-quant-backup.lock}"
ALERT_WEBHOOK_URL="${RABBIT_QUANT_ALERT_WEBHOOK_URL:-}"

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || RETENTION_DAYS=14
(( RETENTION_DAYS >= 1 )) || RETENTION_DAYS=1

mkdir -p "$BACKUP_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")" "$STATE_DIR"
exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  printf '[%s] 已有备份任务运行，本轮跳过。\n' "$(date --iso-8601=seconds)"
  exit 0
fi

exec > >(tee -a "$LOG_DIR/backup.log") 2>&1
timestamp="$(date +%Y%m%d-%H%M%S)"
work_dir="$(mktemp -d)"
archive="$BACKUP_DIR/rabbit-quant-$timestamp.tar.gz"
current_stage="初始化"

log() { printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"; }

notify_ops() {
  local status="$1" message="$2" payload escaped_message escaped_stage
  escaped_message="${message//\\/\\\\}"; escaped_message="${escaped_message//\"/\\\"}"; escaped_message="${escaped_message//$'\n'/\\n}"
  escaped_stage="${current_stage//\\/\\\\}"; escaped_stage="${escaped_stage//\"/\\\"}"
  payload="$(printf '{"service":"rabbit-quant-backup","status":"%s","stage":"%s","message":"%s","time":"%s"}' "$status" "$escaped_stage" "$escaped_message" "$(date --utc --iso-8601=seconds)")"
  printf '%s\n' "$payload" > "$STATE_DIR/last-backup-notification.json"
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    curl --fail --silent --show-error --max-time 10 -H 'content-type: application/json' --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null \
      || log "运维通知发送失败；不改变备份结果。"
  fi
}

cleanup() {
  rm -rf "$work_dir"
  docker exec "$CONTROL_CONTAINER" rm -f /data/.rabbit-control-backup.sqlite >/dev/null 2>&1 || true
}

on_error() {
  local exit_code=$?
  log "备份失败：阶段=$current_stage，退出码=$exit_code。"
  notify_ops failed "备份失败，退出码 $exit_code"
  exit "$exit_code"
}
trap cleanup EXIT
trap on_error ERR

current_stage="账户数据库快照"
log "创建一致性 SQLite 快照。"
docker exec "$CONTROL_CONTAINER" rm -f /data/.rabbit-control-backup.sqlite
docker exec -e BACKUP_OUTPUT=/data/.rabbit-control-backup.sqlite "$CONTROL_CONTAINER" \
  node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(process.env.CONTROL_DB_PATH||"/data/rabbit-control.sqlite"); const output=process.env.BACKUP_OUTPUT.replaceAll("\u0027","\u0027\u0027"); db.exec(`VACUUM INTO \u0027${output}\u0027`); db.close();'
docker exec -e BACKUP_INPUT=/data/.rabbit-control-backup.sqlite "$CONTROL_CONTAINER" \
  node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(process.env.BACKUP_INPUT,{readOnly:true}); const result=db.prepare("PRAGMA integrity_check").get(); db.close(); if(Object.values(result)[0]!=="ok") process.exit(1);'
docker cp "$CONTROL_CONTAINER:/data/.rabbit-control-backup.sqlite" "$work_dir/rabbit-control.sqlite" >/dev/null

current_stage="训练状态与配置归档"
tar_items=(-C "$work_dir" rabbit-control.sqlite)
for path in opt/rabbit-quant-state opt/rabbit-quant-training-runtime var/lib/rabbit-quant-deploy opt/rabbit-quant-web/compose.web.yml opt/rabbit-quant-web/.env; do
  [[ -e "/$path" ]] && tar_items+=(-C / "$path")
done
tar --create --gzip --file "$archive" "${tar_items[@]}"
chmod 600 "$archive"

current_stage="归档校验"
gzip --test "$archive"
tar --list --gzip --file "$archive" >/dev/null
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive.sha256"

current_stage="保留策略"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'rabbit-quant-*.tar.gz' -o -name 'rabbit-quant-*.tar.gz.sha256' \) -mtime "+$RETENTION_DAYS" -delete

size="$(du -h "$archive" | awk '{print $1}')"
log "备份完成：$archive（$size），保留 $RETENTION_DAYS 天。"
notify_ops success "备份完成：$(basename "$archive")，大小 $size"
