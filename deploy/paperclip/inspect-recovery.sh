#!/usr/bin/env bash
# Read-only metadata whitelist. Does not invoke deploy/check, print env or logs.
set -u
date -u +%FT%TZ
systemctl show rabbit-quant-deploy.timer -p ActiveState -p SubState
systemctl show rabbit-quant-deploy.service -p ActiveState -p SubState -p MainPID
for name in deployed-sha paperclip-pending-sha paperclip-deployed-sha; do
  file="/var/lib/rabbit-quant-deploy/$name"
  if [[ ! -f $file ]]; then echo "$name=MISSING"; continue; fi
  value=$(cat "$file")
  if [[ $value =~ ^[0-9a-f]{40}$ ]]; then
    echo "$name=$value"
    if git -C /opt/rabbit-quant-web cat-file -e "$value^{commit}" 2>/dev/null; then echo 'OBJECT_PRESENT=true'; else echo 'OBJECT_PRESENT=false'; fi
  else echo "$name=INVALID_REDACTED"; fi
done
for container in rabbit-quant-paperclip rabbit-quant-research-bridge; do
  echo "CONTAINER=$container"
  docker container inspect --format 'ID={{.Id}} IMAGE_ID={{.Image}} RUNNING={{.State.Running}} COMMIT={{index .Config.Labels "rabbit-quant.research.commit"}}' "$container" || continue
  docker container inspect --format '{{range .Mounts}}TYPE={{.Type}} NAME={{.Name}} SOURCE={{.Source}} DEST={{.Destination}} RW={{.RW}}{{println}}{{end}}' "$container"
  image=$(docker container inspect --format '{{.Image}}' "$container")
  docker image inspect --format 'CACHED_IMAGE={{.Id}}' "$image"
done
for file in /srv/rabbit-quant-paperclip/.env /srv/rabbit-quant-paperclip/config/dataset-catalog.json /srv/rabbit-quant-paperclip/config/tokens.json; do
  if [[ -f $file ]]; then echo "CONFIG_EXISTS=$file"; else echo "CONFIG_MISSING=$file"; fi
done
echo 'READ_ONLY_COMPLETE; backup consistency/restore NOT verified.'
