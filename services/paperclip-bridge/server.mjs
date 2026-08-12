import { readFile } from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { DEFAULT_FACTOR_REGISTRY } from "../../lib/factor-research/index.mjs";
import { PAPERCLIP_AGENTS, PAPERCLIP_ORGANIZATION } from "./agents.mjs";
import { BridgeError, FactorResearchJobRunner } from "./job-runner.mjs";
import { assertScope, authenticateBearer } from "./scopes.mjs";

const MAX_BODY_BYTES = 64 * 1024;

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BridgeError(413, "BODY_TOO_LARGE", "Request body exceeds 64 KiB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new BridgeError(400, "INVALID_JSON", "Request body is not valid JSON");
  }
}

function send(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}

export function createPaperclipBridgeServer({ runner, tokensByAgent, now = () => new Date() }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://paperclip-bridge.local");
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, 200, { status: "ok", service: "paperclip-research-bridge", time: now().toISOString() });
        return;
      }

      const agent = authenticateBearer(request.headers.authorization, tokensByAgent);
      if (request.method === "GET" && url.pathname === "/v1/agents") {
        send(response, 200, { organization: PAPERCLIP_ORGANIZATION, agents: PAPERCLIP_AGENTS });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/factors") {
        assertScope(agent.agentId, "factor:read");
        send(response, 200, DEFAULT_FACTOR_REGISTRY.snapshot());
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/datasets") {
        assertScope(agent.agentId, "dataset:read");
        send(response, 200, { datasets: await runner.listDatasets() });
        return;
      }
      const datasetMatch = /^\/v1\/datasets\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
      if (request.method === "GET" && datasetMatch) {
        assertScope(agent.agentId, "dataset:read");
        const dataset = await runner.resolveDataset(datasetMatch[1]);
        send(response, 200, {
          datasetId: dataset.datasetId,
          checksum: dataset.checksum,
          sourceDateRange: dataset.sourceDateRange,
          sessions: dataset.sessions,
          researchOnly: dataset.researchOnly,
          canPromoteAutomatically: dataset.canPromoteAutomatically,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/jobs/factor-research") {
        const body = await readJsonBody(request);
        if (body.agentId !== agent.agentId) throw new BridgeError(403, "AGENT_ID_MISMATCH", "Authenticated agent does not match agentId");
        send(response, 200, await runner.submit("factor-research", body));
        return;
      }
      const jobMatch = /^\/v1\/jobs\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
      if (request.method === "GET" && jobMatch) {
        assertScope(agent.agentId, "artifact:read");
        send(response, 200, await runner.getJob(jobMatch[1]));
        return;
      }
      throw new BridgeError(404, "NOT_FOUND", "Route not found");
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      send(response, statusCode, {
        error: error?.code ?? "INTERNAL_ERROR",
        message: statusCode === 500 ? "Internal bridge error" : error.message,
      });
    }
  });
}

async function loadTokens(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  return parsed.tokens ?? parsed;
}

export async function startFromEnvironment(environment = process.env) {
  const required = [
    "PAPERCLIP_BRIDGE_DATASET_ROOT", "PAPERCLIP_BRIDGE_DATASET_CATALOG",
    "PAPERCLIP_BRIDGE_ARTIFACT_ROOT", "PAPERCLIP_BRIDGE_STATE_ROOT", "PAPERCLIP_BRIDGE_TOKENS_FILE",
  ];
  for (const key of required) {
    if (!environment[key]) throw new Error(`${key} is required`);
  }
  const runner = new FactorResearchJobRunner({
    datasetRoot: environment.PAPERCLIP_BRIDGE_DATASET_ROOT,
    datasetCatalogPath: environment.PAPERCLIP_BRIDGE_DATASET_CATALOG,
    artifactRoot: environment.PAPERCLIP_BRIDGE_ARTIFACT_ROOT,
    stateRoot: environment.PAPERCLIP_BRIDGE_STATE_ROOT,
  });
  const server = createPaperclipBridgeServer({
    runner,
    tokensByAgent: await loadTokens(environment.PAPERCLIP_BRIDGE_TOKENS_FILE),
  });
  const port = Number(environment.PAPERCLIP_BRIDGE_PORT ?? 3210);
  const host = environment.PAPERCLIP_BRIDGE_HOST ?? "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`Paperclip research bridge listening on http://${host}:${port}`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startFromEnvironment();
}
