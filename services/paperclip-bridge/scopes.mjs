import { timingSafeEqual } from "node:crypto";
import { findAgent, PAPERCLIP_AGENTS } from "./agents.mjs";

export const FORBIDDEN_SCOPE_PREFIXES = Object.freeze([
  "trade:",
  "account:",
  "production_db:",
  "deploy:",
]);

export const FORBIDDEN_EXACT_SCOPES = Object.freeze([
  "git:push",
  "strategy:production:write",
]);

export function isForbiddenScope(scope) {
  return FORBIDDEN_EXACT_SCOPES.includes(scope)
    || FORBIDDEN_SCOPE_PREFIXES.some(prefix => scope.startsWith(prefix));
}

export function assertAgentDefinitionsSafe(agents = PAPERCLIP_AGENTS) {
  for (const agent of agents) {
    const forbidden = agent.scopes.filter(isForbiddenScope);
    if (forbidden.length) throw new Error(`${agent.name} contains forbidden scopes: ${forbidden.join(", ")}`);
  }
  return true;
}

export function assertScope(agentId, scope) {
  const agent = findAgent(agentId);
  if (!agent) throw Object.assign(new Error("Unknown agent"), { statusCode: 401, code: "UNKNOWN_AGENT" });
  if (!agent.enabled) throw Object.assign(new Error(`${agent.name} is disabled`), { statusCode: 403, code: "AGENT_DISABLED" });
  if (isForbiddenScope(scope) || !agent.scopes.includes(scope)) {
    throw Object.assign(new Error(`${agent.name} cannot use ${scope}`), { statusCode: 403, code: "SCOPE_DENIED" });
  }
  return agent;
}

function equalSecret(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authenticateBearer(authorization, tokensByAgent) {
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization ?? ""));
  if (!match) throw Object.assign(new Error("Bearer token required"), { statusCode: 401, code: "AUTH_REQUIRED" });
  for (const [agentId, expected] of Object.entries(tokensByAgent ?? {})) {
    if (typeof expected === "string" && expected.length >= 24 && equalSecret(match[1], expected)) {
      return assertScope(agentId, "artifact:read");
    }
  }
  throw Object.assign(new Error("Invalid bearer token"), { statusCode: 401, code: "AUTH_INVALID" });
}

assertAgentDefinitionsSafe();
