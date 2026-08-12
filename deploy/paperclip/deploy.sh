#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-deploy}"
RELEASE_ROOT="${2:-}"
EXPECTED_COMMIT="${3:-}"
RUNTIME_ROOT="${PAPERCLIP_RUNTIME_ROOT:-/srv/rabbit-quant-paperclip}"
DATASET_ROOT="${PAPERCLIP_DATASET_ROOT:-/srv/rabbit-quant-research/datasets}"
STATUS_FILE="${PAPERCLIP_STATUS_FILE:-/opt/rabbit-quant-state/paperclip-status.json}"
ENV_FILE="$RUNTIME_ROOT/.env"
CONFIG_ROOT="$RUNTIME_ROOT/config"
PROJECT_NAME="rabbit-quant-paperclip-research"

[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'Paperclip deployment requires a full Git commit.\n' >&2
  exit 2
}

write_status() {
  local status="$1" paperclip="$2" bridge="$3" message="$4" temp_file
  mkdir -p "$(dirname "$STATUS_FILE")"
  temp_file="$(mktemp "$(dirname "$STATUS_FILE")/.paperclip-status.XXXXXX")"
  printf '{"status":"%s","services":{"paperclip":"%s","bridge":"%s"},"commit":"%s","checkedAt":"%s","message":"%s"}\n' \
    "$status" "$paperclip" "$bridge" "$EXPECTED_COMMIT" "$(date --utc --iso-8601=seconds)" "$message" > "$temp_file"
  chmod 0644 "$temp_file"
  mv -f "$temp_file" "$STATUS_FILE"
}

service_healthy() {
  local container="$1" url="$2" commit
  commit="$(docker inspect "$container" --format '{{index .Config.Labels "rabbit-quant.research.commit"}}' 2>/dev/null || true)"
  [[ "$commit" == "$EXPECTED_COMMIT" ]] \
    && [[ "$(docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null || true)" == "running" ]] \
    && curl --fail --silent --show-error --max-time 5 "$url" >/dev/null
}

check_runtime() {
  local paperclip="unavailable" bridge="unavailable"
  service_healthy rabbit-quant-paperclip http://127.0.0.1:3100/health && paperclip="healthy"
  service_healthy rabbit-quant-research-bridge http://127.0.0.1:3210/health && bridge="healthy"
  if [[ "$paperclip" == "healthy" && "$bridge" == "healthy" ]]; then
    write_status "running" "$paperclip" "$bridge" "研究控制面运行正常"
    return 0
  fi
  write_status "degraded" "$paperclip" "$bridge" "研究控制面等待恢复"
  return 1
}

if [[ "$MODE" == "check" ]]; then
  check_runtime
  exit $?
fi

[[ "$MODE" == "deploy" && -n "$RELEASE_ROOT" && -f "$RELEASE_ROOT/deploy/paperclip/compose.yml" ]] || {
  printf 'Paperclip release root is invalid.\n' >&2
  exit 2
}

mkdir -p "$RUNTIME_ROOT" "$CONFIG_ROOT" "$DATASET_ROOT"
chmod 0700 "$RUNTIME_ROOT" "$CONFIG_ROOT"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
PAPERCLIP_BIND_HOST=127.0.0.1
PAPERCLIP_PORT=3100
PAPERCLIP_PUBLIC_URL=http://127.0.0.1:3100
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
PAPERCLIP_TOOL_ACTION_SIGNING_SECRET=$(openssl rand -hex 32)
PAPERCLIP_BRIDGE_BIND_HOST=127.0.0.1
PAPERCLIP_BRIDGE_PORT=3210
PAPERCLIP_BRIDGE_CONFIG_ROOT=$CONFIG_ROOT
PAPERCLIP_DATASET_ROOT=$DATASET_ROOT
EOF
fi
if [[ ! -f "$CONFIG_ROOT/dataset-catalog.json" ]]; then
  printf '{"version":1,"datasets":[]}\n' > "$CONFIG_ROOT/dataset-catalog.json"
fi
if [[ ! -f "$CONFIG_ROOT/tokens.json" ]]; then
  printf '{"tokens":{"quant-research":"","data":"","strategy":"","backtest":"","risk":"","code":"","qa":""}}\n' > "$CONFIG_ROOT/tokens.json"
fi
chown -R 10001:10001 "$CONFIG_ROOT"
chmod 0700 "$CONFIG_ROOT"
chmod 0600 "$ENV_FILE" "$CONFIG_ROOT/dataset-catalog.json" "$CONFIG_ROOT/tokens.json"

compose=(docker compose --env-file "$ENV_FILE" --project-name "$PROJECT_NAME" --project-directory "$RELEASE_ROOT" -f "$RELEASE_ROOT/deploy/paperclip/compose.yml")
APP_COMMIT_SHA="$EXPECTED_COMMIT" "${compose[@]}" config --quiet
APP_COMMIT_SHA="$EXPECTED_COMMIT" "${compose[@]}" pull paperclip
APP_COMMIT_SHA="$EXPECTED_COMMIT" "${compose[@]}" build research-bridge
APP_COMMIT_SHA="$EXPECTED_COMMIT" "${compose[@]}" up -d --no-deps paperclip research-bridge

deadline=$((SECONDS + 180))
until check_runtime; do
  if (( SECONDS >= deadline )); then
    write_status "degraded" "unavailable" "unavailable" "研究控制面启动超时"
    exit 1
  fi
  sleep 3
done
