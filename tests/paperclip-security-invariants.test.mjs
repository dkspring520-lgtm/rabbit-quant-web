import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PAPERCLIP_AGENTS, PAPERCLIP_ORGANIZATION } from "../services/paperclip-bridge/agents.mjs";
import { assertAgentDefinitionsSafe, isForbiddenScope } from "../services/paperclip-bridge/scopes.mjs";

test("双兔量化研究院 defines the seven named agents exactly", () => {
  assert.equal(PAPERCLIP_ORGANIZATION.name, "双兔量化研究院");
  assert.deepEqual(PAPERCLIP_AGENTS.map(agent => agent.name), [
    "探因兔", "净源兔", "组策兔", "验真兔", "守界兔", "铸码兔", "质检兔",
  ]);
  assert.equal(PAPERCLIP_AGENTS.length, 7);
  assert.equal(PAPERCLIP_AGENTS.find(agent => agent.name === "铸码兔").enabled, false);
  assert.deepEqual(PAPERCLIP_AGENTS.filter(agent => agent.scopes.includes("backtest:run")).map(agent => agent.name), ["验真兔"]);
});

test("no agent receives trading, account, production database, deployment, push or promotion scope", () => {
  assert.equal(assertAgentDefinitionsSafe(), true);
  for (const agent of PAPERCLIP_AGENTS) {
    assert.deepEqual(agent.scopes.filter(isForbiddenScope), [], agent.name);
  }
  assert.throws(() => assertAgentDefinitionsSafe([{
    name: "unsafe",
    scopes: ["trade:execute", "git:push"],
  }]), /forbidden scopes/);
});

test("bridge source imports no trading, account, production database or deployment module", async () => {
  const directory = path.join(process.cwd(), "services", "paperclip-bridge");
  const files = (await readdir(directory)).filter(file => file.endsWith(".mjs"));
  const source = (await Promise.all(files.map(file => readFile(path.join(directory, file), "utf8")))).join("\n");
  const imports = source.match(/^import\s+.*$/gm) ?? [];
  assert.doesNotMatch(imports.join("\n"), /trading-adapter|account|production.?db|deploy/i);
  assert.doesNotMatch(source, /\/v1\/(trade|account|deploy|production)/i);
});

test("Paperclip deployment stays pinned, private and isolated from production", async () => {
  const compose = await readFile(path.join(process.cwd(), "deploy", "paperclip", "compose.yml"), "utf8");
  const dockerfile = await readFile(path.join(process.cwd(), "deploy", "paperclip", "Dockerfile.bridge"), "utf8");

  assert.match(compose, /ghcr\.io\/paperclipai\/paperclip:sha-67001ec/);
  assert.doesNotMatch(compose, /paperclipai\/paperclip:(?:latest|master)\b/);
  assert.match(compose, /PAPERCLIP_DEPLOYMENT_MODE:\s*authenticated/);
  assert.match(compose, /PAPERCLIP_DEPLOYMENT_EXPOSURE:\s*private/);
  assert.match(compose, /PAPERCLIP_TELEMETRY_DISABLED:\s*"1"/);
  assert.match(compose, /PAPERCLIP_BIND_HOST:-127\.0\.0\.1/);
  assert.match(compose, /PAPERCLIP_BRIDGE_BIND_HOST:-127\.0\.0\.1/);
  assert.match(compose, /research-control:\s*\r?\n\s+internal:\s*true/);
  assert.match(compose, /PAPERCLIP_DATASET_ROOT[^\r\n]*:\/datasets:ro/);
  assert.doesNotMatch(compose, /docker\.sock|control\.sqlite|trading-adapter|\.env:\/|OPENAI_API_KEY|ANTHROPIC_API_KEY/i);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+\.|trading-adapter|control-store|app\/api/i);
});
