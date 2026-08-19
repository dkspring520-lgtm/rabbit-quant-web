import { createHash } from "node:crypto";

export const ZIJIN_DAILY_ASSIGNMENT_SCHEMA_VERSION = 1;
export const ZIJIN_DAILY_ASSIGNMENT_VERSION = "2026.08.19-online-shadow";

const HORIZONS = Object.freeze([
  { id: "5m", label: "5分钟" },
  { id: "15m", label: "15分钟" },
  { id: "30m", label: "30分钟" },
  { id: "60m", label: "60分钟" },
  { id: "nextDay", label: "次日" },
]);

const FACTOR_GROUPS = Object.freeze([
  { id: "gold", label: "黄金", detail: "商品联动" },
  { id: "copper", label: "铜", detail: "商品联动" },
  { id: "peer", label: "板块/同业", detail: "相对强弱" },
  { id: "vwap", label: "VWAP", detail: "成本位置" },
  { id: "volume", label: "成交量", detail: "量价确认" },
  { id: "momentum", label: "动量", detail: "MACD/方向" },
  { id: "ofi", label: "OFI/L2", detail: "盘口确认" },
]);

const DIRECTION_STATES = new Set(["up", "down", "range", "pending"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDirection(value) {
  if (!value || typeof value !== "object") return null;
  const state = DIRECTION_STATES.has(value.state) ? value.state : null;
  if (!state) return null;
  const probabilities = value.probabilities && typeof value.probabilities === "object"
    ? Object.fromEntries(Object.entries(value.probabilities)
      .map(([key, item]) => [key, asFiniteNumber(item)])
      .filter(([, item]) => item !== null && item >= 0 && item <= 1))
    : null;
  return {
    state,
    label: typeof value.label === "string" ? value.label : state === "up" ? "偏强" : state === "down" ? "偏弱" : state === "range" ? "震荡" : "待验证",
    confidence: asFiniteNumber(value.confidence),
    probabilities: probabilities && Object.keys(probabilities).length ? probabilities : null,
    reason: typeof value.reason === "string" ? value.reason : "由当日可验证样本决定。",
    invalidatedBy: asArray(value.invalidatedBy).filter(item => typeof item === "string").slice(0, 4),
  };
}

function defaultDirection() {
  return {
    state: "pending",
    label: "待验证",
    confidence: null,
    probabilities: null,
    reason: "尚未收到当日合规行情、商品和盘口样本，暂不下方向结论。",
    invalidatedBy: ["数据不足", "L2/量价未确认"],
  };
}

function buildHorizonEvidence(observations) {
  const source = observations?.horizons && typeof observations.horizons === "object" ? observations.horizons : {};
  return HORIZONS.map(({ id, label }) => {
    const item = source[id] && typeof source[id] === "object" ? source[id] : {};
    const direction = normalizeDirection(item);
    return {
      id,
      label,
      state: direction?.state || "pending",
      direction: direction?.label || "待验证",
      probability: direction?.probabilities?.up ?? null,
      confidence: direction?.confidence ?? null,
      evidence: typeof item.evidence === "string" ? item.evidence : "等待样本外证据",
    };
  });
}

function buildFactorResonance(observations) {
  const source = observations?.factors && typeof observations.factors === "object" ? observations.factors : {};
  return FACTOR_GROUPS.map(group => {
    const item = source[group.id] && typeof source[group.id] === "object" ? source[group.id] : {};
    const state = item.state === "confirmed" || item.state === "否决" || item.state === "pending" ? item.state : "pending";
    return {
      ...group,
      state,
      score: asFiniteNumber(item.score),
      note: typeof item.note === "string" ? item.note : "待读取当日证据",
    };
  });
}

function countShadowEvents(shadowState) {
  const models = shadowState?.models && typeof shadowState.models === "object" ? Object.values(shadowState.models) : [];
  const totals = models.map(model => Number(model?.total?.resolvedTrades)).filter(Number.isFinite);
  const events = Number(shadowState?.integrity?.eventCount);
  return totals.length ? totals.reduce((sum, item) => sum + item, 0) : Number.isFinite(events) ? events : 0;
}

function buildCandidateRules(registry, shadowState, observations) {
  const external = asArray(observations?.candidateRules).filter(item => item && typeof item === "object");
  if (external.length) {
    return external.slice(0, 5).map(item => ({
      title: typeof item.title === "string" ? item.title : "未命名候选",
      direction: typeof item.direction === "string" ? item.direction : "正T/反T待分流",
      status: "待验证",
      source: typeof item.source === "string" ? item.source : "公开线索",
      rule: typeof item.rule === "string" ? item.rule : "等待可计算定义",
    }));
  }
  const factors = asArray(registry?.factors).filter(factor => factor?.pool === "shadow");
  const factorNames = factors.map(factor => factor.displayName || factor.id).join(" + ") || "现有影子因子";
  return [{
    title: "多因子共振候选",
    direction: "正T/反T分开验证",
    status: "待验证",
    source: "现有影子注册表",
    rule: `${factorNames}；必须经过成本、方向和样本外校验。`,
    shadowOnly: true,
    eventCount: countShadowEvents(shadowState),
  }];
}

function buildEvidence(shadowState, dailyRun, observations) {
  const eventCount = countShadowEvents(shadowState);
  const observed = observations?.evidence && typeof observations.evidence === "object" ? observations.evidence : {};
  return {
    status: eventCount > 0 ? "shadow-observation" : "insufficient",
    sampleCount: Number.isFinite(Number(observed.sampleCount)) ? Number(observed.sampleCount) : eventCount,
    supportSamples: Number.isFinite(Number(observed.supportSamples)) ? Number(observed.supportSamples) : 0,
    failedSamples: Number.isFinite(Number(observed.failedSamples)) ? Number(observed.failedSamples) : 0,
    postFeeReturnPct: asFiniteNumber(observed.postFeeReturnPct),
    profitFactor: asFiniteNumber(observed.profitFactor),
    maxDrawdownPct: asFiniteNumber(observed.maxDrawdownPct),
    dailyRunStatus: dailyRun?.status || "unavailable",
    note: eventCount > 0 ? "已有影子事件，仍需按方向、成本和样本外窗口继续验证。" : "当前没有可用于晋级的影子闭环，不能把观点当成预测。",
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashZijinDailyAssignment(value) {
  return createHash("sha256").update(stableValue(value)).digest("hex");
}

export function createZijinDailyAssignment({
  marketDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
  generatedAt = new Date().toISOString(),
  registry = null,
  dailyRun = null,
  shadowState = null,
  observations = null,
} = {}) {
  const direction = normalizeDirection(observations?.direction) || defaultDirection();
  const assignment = {
    schemaVersion: ZIJIN_DAILY_ASSIGNMENT_SCHEMA_VERSION,
    assignmentVersion: ZIJIN_DAILY_ASSIGNMENT_VERSION,
    assignmentId: `zijin-research-${marketDate}`,
    marketDate,
    generatedAt,
    asOf: generatedAt,
    status: "shadow-only",
    stock: { code: "601899", name: "紫金矿业" },
    direction,
    horizons: buildHorizonEvidence(observations),
    factorResonance: buildFactorResonance(observations),
    findings: asArray(observations?.findings).filter(item => typeof item === "string").slice(0, 6),
    candidateRules: buildCandidateRules(registry, shadowState, observations),
    evidence: buildEvidence(shadowState, dailyRun, observations),
    onlineLearning: observations?.onlineLearning && typeof observations.onlineLearning === "object"
      ? clone(observations.onlineLearning)
      : {
          status: "unavailable",
          readySources: 0,
          totalSources: 4,
          officialEvents: 0,
          leadEvents: 0,
          errors: ["联网学习观测尚未生成"],
          affectsFormalStrategy: false,
          canTrade: false,
        },
    promotion: {
      state: "人工审核前",
      nextAction: "继续V1影子；满足样本外、扣费收益和回撤门槛后再人工评审。",
      affectsFormalStrategy: false,
      canTrade: false,
    },
    sourcePolicy: {
      accepted: ["紫金官网", "上交所", "港交所", "政府及交易所数据"],
      licensed: ["路透", "彭博", "财新", "SMM", "Mysteel"],
      leadsOnly: ["雪球", "东方财富", "社交媒体"],
      note: "公开线索只转成待验证假设，不直接改变正式策略。",
    },
    safety: {
      formalStrategyWriteEnabled: false,
      realTradingEnabled: false,
      agentMayPromote: false,
    },
  };
  assignment.integrity = {
    source: observations?.integrity?.source
      ? `registry+factor-daily+shadow-state+${observations.integrity.source}`
      : "registry+factor-daily+shadow-state",
    evidenceHash: observations?.integrity?.evidenceHash || null,
    reportHash: hashZijinDailyAssignment(assignment),
  };
  return clone(assignment);
}

export function normalizeZijinDailyAssignment(value) {
  if (!value || typeof value !== "object") return createZijinDailyAssignment();
  const fallback = createZijinDailyAssignment({ marketDate: value.marketDate, generatedAt: value.generatedAt });
  const assignment = { ...fallback, ...value };
  assignment.stock = { code: "601899", name: "紫金矿业" };
  assignment.status = "shadow-only";
  assignment.promotion = { ...fallback.promotion, ...(value.promotion || {}), affectsFormalStrategy: false, canTrade: false };
  assignment.safety = { ...fallback.safety, ...(value.safety || {}), formalStrategyWriteEnabled: false, realTradingEnabled: false, agentMayPromote: false };
  assignment.onlineLearning = {
    ...fallback.onlineLearning,
    ...(value.onlineLearning || {}),
    affectsFormalStrategy: false,
    canTrade: false,
  };
  assignment.integrity = { ...fallback.integrity, ...(value.integrity || {}) };
  return assignment;
}
