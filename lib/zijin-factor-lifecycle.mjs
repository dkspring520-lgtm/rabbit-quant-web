import { createHash } from "node:crypto";

export const ZIJIN_FACTOR_LIFECYCLE_SCHEMA_VERSION = 1;
export const ZIJIN_FACTOR_REGISTRY_VERSION = "2026.08.04";

const PROMOTION_GATE = Object.freeze({
  minimumOutOfSampleTrades: 80,
  minimumWinRate: 0.55,
  minimumPositiveWindowRatio: 0.65,
  maximumCorrelationWithFormal: 0.85,
  minimumShadowDays: 20,
  minimumL2ShadowDays: 30,
});

const FACTOR_DEFINITIONS = Object.freeze([
  {
    id: "zijin_peer_momentum",
    version: "0.1.0",
    displayName: "紫金专属：同业动量",
    scope: "zijin",
    stockCodes: ["601899"],
    pool: "shadow",
    status: "shadow",
    executionMode: "observe-only",
    enabled: true,
    affectsFormalStrategy: false,
    sendsAlerts: false,
    formula: "z(return_5m) + 0.8*z(peer_relative_strength) + 0.4*z(peer_breadth - 0.5) + 0.4*z(volume_ratio)",
    inputs: ["601899 5m return", "peer relative strength", "peer breadth", "volume ratio"],
    evidence: {
      source: "five-year A-share replay",
      researchStatus: "negative-after-cost",
      costModelPct: 0.14,
      note: "已完成回放，但扣费后没有形成晋级证据；继续影子观察。",
    },
    gate: PROMOTION_GATE,
  },
  {
    id: "ashare_vwap_volume",
    version: "0.1.0",
    displayName: "A股通用：VWAP量能",
    scope: "a-share",
    stockCodes: ["*"],
    pool: "shadow",
    status: "shadow",
    executionMode: "observe-only",
    enabled: true,
    affectsFormalStrategy: false,
    sendsAlerts: false,
    formula: "-z(vwap_bias) + 0.8*z(return_3m) + 0.5*z(volume_ratio)",
    inputs: ["VWAP bias", "3m return", "volume ratio"],
    evidence: {
      source: "five-year A-share replay",
      researchStatus: "negative-after-cost",
      costModelPct: 0.14,
      note: "已完成回放，但扣费后没有形成晋级证据；继续影子观察。",
    },
    gate: PROMOTION_GATE,
  },
]);

const clone = value => JSON.parse(JSON.stringify(value));

export function createZijinFactorRegistry({ generatedAt = new Date().toISOString() } = {}) {
  const factors = FACTOR_DEFINITIONS.map(factor => clone(factor));
  return {
    schemaVersion: ZIJIN_FACTOR_LIFECYCLE_SCHEMA_VERSION,
    registryVersion: ZIJIN_FACTOR_REGISTRY_VERSION,
    stock: { code: "601899", name: "紫金矿业" },
    updatedAt: generatedAt,
    formalStrategy: {
      id: "zijin-v4",
      version: "v4",
      writeEnabled: false,
      factorWritesAllowed: false,
      note: "因子只有通过影子运行、人工评审和版本发布后才能进入正式策略。",
    },
    scheduler: {
      enabled: true,
      mode: "daily-after-close",
      timezone: "Asia/Shanghai",
      window: "15:20-16:00",
      runCommand: "npm run research:factor-daily",
      shadowOnly: true,
    },
    pools: {
      formal: [],
      shadow: factors.map(factor => factor.id),
      observe: [],
      rejected: [],
      retired: [],
    },
    factors,
  };
}
export function normalizeZijinFactorRegistry(value) {
  if (!value || typeof value !== "object") return createZijinFactorRegistry();
  const fallback = createZijinFactorRegistry();
  const source = value;
  const factors = Array.isArray(source.factors) ? source.factors : fallback.factors;
  const safeFactors = factors
    .filter(factor => factor && typeof factor === "object" && typeof factor.id === "string")
    .map(factor => ({
      ...factor,
      pool: typeof factor.pool === "string" ? factor.pool : "shadow",
      status: typeof factor.status === "string" ? factor.status : "shadow",
      enabled: factor.enabled !== false,
      affectsFormalStrategy: false,
      sendsAlerts: false,
    }));
  const pools = source.pools && typeof source.pools === "object" ? source.pools : {};
  return {
    ...fallback,
    ...source,
    schemaVersion: Number(source.schemaVersion) || fallback.schemaVersion,
    registryVersion: typeof source.registryVersion === "string" ? source.registryVersion : fallback.registryVersion,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : fallback.updatedAt,
    formalStrategy: {
      ...fallback.formalStrategy,
      ...(source.formalStrategy && typeof source.formalStrategy === "object" ? source.formalStrategy : {}),
      writeEnabled: false,
      factorWritesAllowed: false,
    },
    scheduler: {
      ...fallback.scheduler,
      ...(source.scheduler && typeof source.scheduler === "object" ? source.scheduler : {}),
      enabled: source.scheduler?.enabled !== false,
      shadowOnly: true,
    },
    pools: {
      ...fallback.pools,
      ...pools,
      formal: Array.isArray(pools.formal) ? pools.formal : [],
      shadow: Array.isArray(pools.shadow) ? pools.shadow : safeFactors.filter(factor => factor.pool === "shadow").map(factor => factor.id),
      observe: Array.isArray(pools.observe) ? pools.observe : [],
      rejected: Array.isArray(pools.rejected) ? pools.rejected : [],
      retired: Array.isArray(pools.retired) ? pools.retired : [],
    },
    factors: safeFactors.length ? safeFactors : fallback.factors,
  };
}

export function buildZijinFactorDailyRun({
  registry = createZijinFactorRegistry(),
  shadowState = null,
  marketDate,
  scheduledAt = new Date().toISOString(),
} = {}) {
  const normalized = normalizeZijinFactorRegistry(registry);
  const factors = normalized.factors.map(factor => ({
    id: factor.id,
    version: factor.version,
    pool: factor.pool,
    status: factor.status,
    executionMode: factor.executionMode,
    decision: "continue-shadow",
    eligibleForFormal: false,
    affectsFormalStrategy: false,
    shadowEvents: Number(shadowState?.integrity?.eventCount) || 0,
    reason: factor.evidence?.note || "尚未满足正式晋级门槛。",
  }));
  const shadowEvents = Number(shadowState?.integrity?.eventCount) || 0;
  return {
    schemaVersion: ZIJIN_FACTOR_LIFECYCLE_SCHEMA_VERSION,
    runId: "zijin-factor-daily-" + marketDate,
    marketDate,
    scheduledAt,
    completedAt: scheduledAt,
    status: "completed",
    mode: "shadow-only",
    registryVersion: normalized.registryVersion,
    summary: {
      total: factors.length,
      formal: normalized.pools.formal.length,
      shadow: factors.filter(factor => factor.pool === "shadow").length,
      observe: factors.filter(factor => factor.status === "observe").length,
      rejected: normalized.pools.rejected.length,
      insufficient: factors.filter(factor => factor.status === "insufficient").length,
      promoted: 0,
      shadowEvents,
    },
    factors,
    scheduler: {
      window: normalized.scheduler.window,
      timezone: normalized.scheduler.timezone,
      nextAction: "继续影子运行；达到门槛后提交人工评审。",
    },
    integrity: {
      sourceShadowState: shadowState?.meta?.source || "bundled",
      shadowEventCount: shadowEvents,
      formalStrategyWriteEnabled: false,
    },
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return "[" + value.map(stableValue).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableValue(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function hashZijinFactorLedgerRecord(record, previousHash = "GENESIS") {
  return createHash("sha256")
    .update(previousHash + "\n" + stableValue(record))
    .digest("hex");
}
