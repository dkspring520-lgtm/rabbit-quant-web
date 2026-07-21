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
  assert.match(script, /flock --nonblock --close/);
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
  assert.match(compose, /api\/control\/version/);
  assert.match(dockerfile, /APP_COMMIT_SHA/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(route, /APP_COMMIT_SHA/);
  assert.match(route, /cache-control/);
});

test("systemd timer and installer enable recurring safe deploys", () => {
  const service = read("deploy/systemd/rabbit-quant-deploy.service");
  const timer = read("deploy/systemd/rabbit-quant-deploy.timer");
  const installer = read("scripts/install-production-deployer.sh");

  assert.match(service, /Type=oneshot/);
  assert.match(service, /\/usr\/local\/sbin\/rabbit-quant-deploy/);
  assert.match(timer, /OnUnitActiveSec=1min/);
  assert.match(timer, /Persistent=true/);
  assert.match(installer, /systemctl enable --now rabbit-quant-deploy\.timer/);
});
