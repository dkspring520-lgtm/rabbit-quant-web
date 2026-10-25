#!/usr/bin/env bash
# Local repair candidate. NOT deployed. No credentials, remote push or retention.
set -Eeuo pipefail
umask 077
BACKUP_DIR="${RABBIT_QUANT_BACKUP_DIR:-/opt/rabbit-quant-backups}"
CONTROL_CONTAINER="${RABBIT_QUANT_CONTROL_CONTAINER:-rabbit-quant-control}"
CONTROL_DB_PATH="${RABBIT_QUANT_CONTROL_DB_PATH:-/data/rabbit-control.sqlite}"
LOCK_FILE="${RABBIT_QUANT_BACKUP_LOCK:-/run/lock/rabbit-quant-backup.lock}"
HELPER="${RABBIT_QUANT_BACKUP_HELPER:-/opt/rabbit-quant-web/scripts/backup_snapshot.py}"
: "${RABBIT_QUANT_BACKUP_POLICY:?audited protocol policy required}"
: "${RABBIT_QUANT_BACKUP_MAX_BYTES:?explicit write budget required}"
RESERVE="${RABBIT_QUANT_BACKUP_RESERVE_BYTES:-4294967296}"
[[ "$RABBIT_QUANT_BACKUP_MAX_BYTES" =~ ^[1-9][0-9]*$ && "$RESERVE" =~ ^[0-9]+$ ]] || exit 1
[[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || exit 1
exec 9>"$LOCK_FILE"
flock --nonblock 9 || exit 1
run_id="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
run_dir="$BACKUP_DIR/sqlite-candidate-$run_id"
mkdir -m 700 "$run_dir"
stage=preflight
failed() {
  code=$?
  printf '{"stage":"%s","exit_code":%s,"pull_ready":false}\n' "$stage" "$code" > "$run_dir/failed.json"
  printf 'BACKUP_FAILED stage=%s code=%s\n' "$stage" "$code"
  exit "$code"
}
trap failed ERR
docker exec "$CONTROL_CONTAINER" test -r "$CONTROL_DB_PATH" 2>/dev/null
db_bytes="$(docker exec -e CONTROL_DB_PATH="$CONTROL_DB_PATH" "$CONTROL_CONTAINER" node --input-type=module -e '
import fs from "node:fs";
let total=fs.statSync(process.env.CONTROL_DB_PATH).size;
for (const suffix of ["-wal","-shm"]) {
  try { total+=fs.statSync(process.env.CONTROL_DB_PATH+suffix).size; }
  catch(e) { if(e.code!=="ENOENT") throw e; }
}
console.log(total);' 2>/dev/null)"
[[ "$db_bytes" =~ ^[0-9]+$ ]]
python3 "$HELPER" --preflight --policy "$RABBIT_QUANT_BACKUP_POLICY" \
  --output "$BACKUP_DIR" --database-bytes "$db_bytes" \
  --limit "$RABBIT_QUANT_BACKUP_MAX_BYTES" --reserve "$RESERVE"
stage=sqlite_snapshot
db_snapshot="/data/.rabbit-control-backup-$run_id.sqlite"
docker exec -e CONTROL_DB_PATH="$CONTROL_DB_PATH" -e BACKUP_OUTPUT="$db_snapshot" \
  -e BACKUP_RESERVE="$RESERVE" "$CONTROL_CONTAINER" node --input-type=module -e '
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const p=process.env.CONTROL_DB_PATH;
const size=fs.statSync(p).size;
const space=fs.statfsSync("/data");
const db=new DatabaseSync(p);
const pages=Number(Object.values(db.prepare("PRAGMA page_count").get())[0]);
const pageSize=Number(Object.values(db.prepare("PRAGMA page_size").get())[0]);
if(space.bavail*space.bsize < Math.max(size,pages*pageSize)*2+Number(process.env.BACKUP_RESERVE)) process.exit(2);
const quote=String.fromCharCode(39);
const out=process.env.BACKUP_OUTPUT.replaceAll(quote,quote+quote);
db.exec("VACUUM INTO "+quote+out+quote); db.close();
const check=new DatabaseSync(process.env.BACKUP_OUTPUT,{readOnly:true});
if(Object.values(check.prepare("PRAGMA integrity_check").get())[0]!=="ok") process.exit(3);
check.close();' >/dev/null 2>&1
docker cp "$CONTROL_CONTAINER:$db_snapshot" "$run_dir/rabbit-control.sqlite" >/dev/null 2>&1
stage=stable_snapshot_and_archive
python3 "$HELPER" --policy "$RABBIT_QUANT_BACKUP_POLICY" \
  --output "$BACKUP_DIR" --database "$run_dir/rabbit-control.sqlite" \
  --limit "$RABBIT_QUANT_BACKUP_MAX_BYTES" --reserve "$RESERVE"
printf 'LOCAL_VERIFIED_NOT_PULL_READY\n'
printf '{"status":"local_verified","pull_ready":false}\n' > "$run_dir/result.json"
# Encryption unconfigured. Preserve staging/unique DB snapshot. No deletion/push.
