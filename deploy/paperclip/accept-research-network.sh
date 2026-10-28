#!/usr/bin/env bash
# Synthetic, no production mounts/networks, no pull/build/outbound requests.
set -Eeuo pipefail
for tool in docker curl timeout mktemp tee; do command -v "$tool" >/dev/null || exit 2; done
image=sha256:e2b39f7b64281324929257d0f8004fb6cb4bf0fdfb9aa8cedb235a766aec31da
dir=$(mktemp -d /tmp/rabbit-network-candidate.XXXXXXXX)
run=${dir##*.}
owner="rabbit-network-$run"
label=org.rabbit.candidate-run
containers=()
networks=()
exec > >(tee "$dir/acceptance.log") 2>&1
cleanup() {
  rc=$?
  trap - EXIT INT TERM
  set +e
  for kind in container network; do
    names=()
    if [[ $kind == container ]]; then names=("${containers[@]}"); else names=("${networks[@]}"); fi
    for name in "${names[@]}"; do
      if [[ $kind == container ]]; then
        actual=$(timeout 10 docker container inspect --format '{{index .Config.Labels "org.rabbit.candidate-run"}}' "$name" 2>/dev/null)
      else
        actual=$(timeout 10 docker network inspect --format '{{index .Labels "org.rabbit.candidate-run"}}' "$name" 2>/dev/null)
      fi
      if [[ $actual == "$owner" ]]; then
        if [[ $kind == container ]]; then timeout 20 docker container rm -f "$name"; else timeout 20 docker network rm "$name"; fi
        if [[ $? != 0 ]]; then echo "CLEANUP_REQUIRED $kind $name"; rc=1; fi
      else
        # Never remove an unverified or foreign resource; distinguish absent from failed inspect.
        list_rc=0
        if [[ $kind == container ]]; then
          listing=$(timeout 10 docker container ls -a --format '{{.Names}}' 2>/dev/null) || list_rc=$?
        else
          listing=$(timeout 10 docker network ls --format '{{.Name}}' 2>/dev/null) || list_rc=$?
        fi
        if [[ $list_rc != 0 ]] || [[ $'\n'"$listing"$'\n' == *$'\n'"$name"$'\n'* ]]; then
          echo "CLEANUP_UNVERIFIED $kind $name"; rc=1
        fi
      fi
    done
  done
  echo "EXIT=$rc LOG=$dir/acceptance.log"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "UTC=$(date -u +%FT%TZ) OWNER=$owner"
actual=$(timeout 10 docker image inspect --format '{{.Id}}' "$image")
[[ $actual == "$image" ]] || { echo CACHE_MISMATCH; exit 1; }
echo "CACHED_IMAGE=$actual"
internal="$owner-internal"
access="$owner-access"
networks+=("$internal")
timeout 20 docker network create --driver bridge --internal --label "$label=$owner" "$internal"
networks+=("$access")
timeout 20 docker network create --driver bridge --opt com.docker.network.bridge.gateway_mode_ipv4=nat --label "$label=$owner" "$access"
server="require('node:http').createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404);res.end('rabbit-network-synthetic');}).listen(3100,'0.0.0.0');"
probe="fetch('http://127.0.0.1:3100/health',{signal:AbortSignal.timeout(1500)}).then(async r=>{if(r.status!==200||await r.text()!=='rabbit-network-synthetic')process.exit(1)}).catch(()=>process.exit(1));"
for mode in internal-only dual-network; do
  name="$owner-$mode"
  containers+=("$name")
  network=$internal
  [[ $mode != dual-network ]] || network=$access
  timeout 20 docker create --pull=never --name "$name" --label "$label=$owner" --network "$network" \
    --user 65534:65534 --read-only --cap-drop ALL --security-opt no-new-privileges \
    --memory 128m --cpus 0.5 --pids-limit 64 -p 127.0.0.1::3100 "$image" node -e "$server"
  if [[ $mode == dual-network ]]; then timeout 20 docker network connect "$internal" "$name"; fi
  timeout 20 docker start "$name"
  ready=false
  for attempt in 1 2 3 4 5; do
    if timeout 5 docker exec "$name" node -e "$probe"; then ready=true; break; fi
    sleep 1
  done
  [[ $ready == true ]] || { echo "$mode INTERNAL_FAILED"; exit 1; }
  echo "$mode INTERNAL_HTTP_OK"
  mapping=$(timeout 10 docker port "$name" 3100/tcp 2>/dev/null || true)
  host_ok=false
  if [[ $mapping =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
    port=${BASH_REMATCH[1]}
    code=$(curl --noproxy '*' --max-time 3 --silent --output "$dir/$mode.body" --write-out '%{http_code}' "http://127.0.0.1:$port/health" || true)
    if [[ $code == 200 && $(cat "$dir/$mode.body") == rabbit-network-synthetic ]]; then host_ok=true; fi
    echo "$mode LOOPBACK_PORT=$port HTTP=$code"
  elif [[ -n $mapping ]]; then
    echo "$mode UNEXPECTED_BINDING"; exit 1
  else
    echo "$mode NO_PUBLISHED_PORT"
  fi
  if [[ $mode == dual-network && $host_ok != true ]]; then echo DUAL_NETWORK_FAILED; exit 1; fi
  if [[ $mode == internal-only ]]; then baseline=$host_ok; fi
done
echo "CANDIDATE_HTTP_PASS internal_only_host=$baseline dual_network_host=true"
echo 'Synthetic ingress only; not production deployment, application authentication, strategy or outbound validation.'
