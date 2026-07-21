import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("production deploy builds both images before replacing containers", () => {
  const script = read("scripts/deploy-production.sh");
  const webBuild = script.indexOf("-f \"$release_dir/Dockerfile.server\"");
  const trainerBuild = script.indexOf("-f \"$release_dir/Dockerfile.trainer\"");
  const switchPosition = script.indexOf("compose_up \"$compose_file\"");

  assert.ok(webBuild > 0);
  assert.ok(trainerBuild > webBuild);
  assert.ok(switchPosition > trainerBuild);
  assert.match(script, /flock\s+\\\n\s+--nonblock\s+\\\n\s+--close/);
  assert.match(script, /--conflict-exit-code 75/);
  assert.match(script, /exit "\$deploy_status"/);
  assert.match(script, /RABBIT_QUANT_DEPLOY_LOCKED=1/);
  assert.doesNotMatch(script, /exec 9>/);
  assert.match(script, /wait_for_release/);
  assert.match(script, /自动回滚/);
  assert.doesNotMatch(script, /git reset --hard/);
});

test("production compose and image expose commit-aware health", () => {
  const compose = read("compose.web.yml");
  const dockerfile = read("Dockerfile.server");
  const route = read("app/api/control/version/route.ts");

  assert.match(compose, /RABBIT_QUANT_WEB_IMAGE/);
  assert.match(compose, /RABBIT_QUANT_TRAINER_IMAGE/);
  assert.doesNotMatch(compose, /APP_COMMIT_SHA:/);
  assert.doesNotMatch(compose, /APP_BUILD_TIME:/);
  assert.match(compose, /api\/control\/version/);
  assert.match(dockerfile, /APP_COMMIT_SHA/);
  assert.match(dockerfile, /APP_BUILD_TIME/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(route, /APP_COMMIT_SHA/);
  assert.match(route, /cache-control/);
});

test("production deploy uses blue-green Web slots and switches traffic only after candidate health", () => {
  const compose = read("compose.web.yml");
  const script = read("scripts/deploy-production.sh");
  const candidateStart = script.indexOf('"$candidate_service"');
  const candidateHealth = script.indexOf('wait_for_web_slot "$candidate_slot"');
  const trafficSwitch = script.indexOf('write_nginx_upstream "$candidate_port"');

  assert.match(compose, /web-blue:/);
  assert.match(compose, /web-green:/);
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /127\.0\.0\.1:3001:3000/);
  assert.match(compose, /RABBIT_QUANT_ACTIVE_WEB_ORIGIN/);
  assert.match(script, /rabbit_quant_active/);
  assert.match(script, /active-web-slot/);
  assert.match(script, /systemctl reload nginx/);
  assert.ok(candidateStart > 0);
  assert.ok(candidateHealth > candidateStart);
  assert.ok(trafficSwitch > candidateHealth);
});

test("production deploy replaces only the inactive Web slot", () => {
  const script = read("scripts/deploy-production.sh");
  const prepareDefinition = script.indexOf("prepare_candidate_slot() {");
  const prepareCall = script.indexOf('prepare_candidate_slot "$active_slot" "$candidate_slot"');
  const candidateStart = script.indexOf('compose_up "$compose_file"', prepareCall);

  assert.ok(prepareDefinition > 0);
  assert.ok(prepareCall > prepareDefinition);
  assert.ok(candidateStart > prepareCall);
  assert.match(script, /if \[\[ "\$active_container" == "\$candidate_container" \]\]/);
  assert.match(script, /container_is_healthy "\$active_container"/);
  assert.match(script, /docker container rm --force "\$candidate_container"/);
  assert.doesNotMatch(script, /docker container rm --force "\$active_container"/);
});

test("systemd timer and installer enable recurring safe deploys", () => {
  const service = read("deploy/systemd/rabbit-quant-deploy.service");
  const timer = read("deploy/systemd/rabbit-quant-deploy.timer");
  const installer = read("scripts/install-production-deployer.sh");

  assert.match(service, /Type=oneshot/);
  assert.match(service, /EnvironmentFile=-\/etc\/default\/rabbit-quant-ops/);
  assert.match(service, /\/usr\/local\/sbin\/rabbit-quant-deploy/);
  assert.match(timer, /OnUnitActiveSec=1min/);
  assert.match(timer, /Persistent=true/);
  assert.match(installer, /systemctl enable --now rabbit-quant-deploy\.timer/);
  assert.match(installer, /systemctl enable --now rabbit-quant-backup\.timer/);
});

test("production backup snapshots SQLite and verifies every archive", () => {
  const script = read("scripts/backup-production.sh");
  const service = read("deploy/systemd/rabbit-quant-backup.service");
  const timer = read("deploy/systemd/rabbit-quant-backup.timer");

  assert.match(script, /VACUUM INTO/);
  assert.match(script, /replaceAll\("\\u0027","\\u0027\\u0027"\)/);
  assert.match(script, /PRAGMA integrity_check/);
  assert.match(script, /gzip --test/);
  assert.match(script, /sha256sum/);
  assert.match(script, /--symmetric --cipher-algo AES256/);
  assert.match(script, /RABBIT_QUANT_BACKUP_GIT_REMOTE/);
  assert.match(script, /push --quiet --force origin/);
  assert.match(script, /rabbit-quant-state/);
  assert.match(script, /rabbit-quant-training-runtime/);
  assert.match(service, /rabbit-quant-backup/);
  assert.match(timer, /OnCalendar=.*03:30:00 Asia\/Shanghai/);
});

test("deployment keeps rollback images and emits optional webhook notifications", () => {
  const script = read("scripts/deploy-production.sh");
  assert.match(script, /"APP_COMMIT_SHA=\$app_commit_sha"/);
  assert.match(script, /--env-file "\$runtime_env"/);
  assert.match(script, /rm -f "\$runtime_env"/);
  assert.match(script, /"APP_BUILD_TIME=\$app_build_time"/);
  assert.match(script, /RABBIT_QUANT_IMAGE_RETENTION/);
  assert.match(script, /previous_web_image/);
  assert.match(script, /previous_trainer_image/);
  assert.match(script, /RABBIT_QUANT_ALERT_WEBHOOK_URL/);
  assert.match(script, /last-notification\.json/);
  assert.match(script, /sync_operations_assets/);
  assert.match(script, /rabbit-quant-backup\.timer/);
});
