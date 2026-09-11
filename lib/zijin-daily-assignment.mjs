import { createHash } from "node:crypto";

export const ZIJIN_DAILY_ASSIGNMENT_SCHEMA_VERSION = 2;
export const ZIJIN_DAILY_ASSIGNMENT_VERSION = "2026.08.26-trend-digest-shadow";

const HORIZONS = Object.freeze([
  { id: "5m", label: "5分钟" },
  { id: "15m", label: "15分钟" },
  { id: "30m", label: "30分钟" },
  { id: "60m", label: "60分钟" },
  { id: "nextDay", label: "次日" },
  { id: "5d", label: "1周" },
  { id: "20d", label: "1个月" },
  { id: "60d", label: "1季度" },
]);

const OUTLOOK_HORIZONS = Object.freeze([
  { id: "short", label: "短线", period: "盘中至3日" },
  { id: "medium", label: "中线", period: "1至4周" },
  { id: "long", label: "长线", period: "1至3个月" },
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

function directionLabel(state) {
  return state === "up" ? "偏强" : state === "down" ? "偏弱" : state === "range" ? "震荡" : "待观察";
}

function firstAvailableDirection(items) {
  return items.find(item => item && item.state !== "pending") || null;
}

function factorBackground(factors) {
  const background = factors.filter(item => ["gold", "copper", "peer"].includes(item.id));
  const score = background.reduce((sum, item) => sum + (item.state === "confirmed" ? 1 : item.state === "否决" ? -1 : 0), 0);
  const available = background.filter(item => item.state !== "pending").length;
  if (available < 2 || Math.abs(score) < 2) return null;
  const state = score > 0 ? "up" : "down";
  return {
    state,
    direction: directionLabel(state),
    confidence: Math.min(0.62, 0.48 + available * 0.04),
    evidence: "黄金、铜与板块同业的当日联动背景",
  };
}

function normalizeOutlookItem(value, definition) {
  const normalized = normalizeDirection(value);
  if (!normalized) return null;
  return {
    ...definition,
    state: normalized.state,
    direction: normalized.label,
    confidence: normalized.confidence,
    evidenceStatus: typeof value.evidenceStatus === "string" ? value.evidenceStatus : "待样本外验证",
    summary: typeof value.summary === "string" ? value.summary : normalized.reason,
  };
}

function buildResearchOutlook(observations, direction, horizons, factors) {
  const source = observations?.researchOutlook && typeof observations.researchOutlook === "object" ? observations.researchOutlook : {};
  const explicit = source.horizons && typeof source.horizons === "object"
    ? source.horizons
    : source;
  const horizonById = Object.fromEntries(horizons.map(item => [item.id, item]));
  const shortEvidence = firstAvailableDirection([horizonById.nextDay, horizonById["60m"], horizonById["30m"], direction]);
  const mediumEvidence = firstAvailableDirection([horizonById["20d"], horizonById["5d"], factorBackground(factors)]);
  const longEvidence = firstAvailableDirection([horizonById["60d"]]);
  const fallbackById = {
    short: shortEvidence ? {
      state: shortEvidence.state,
      direction: directionLabel(shortEvidence.state),
      confidence: shortEvidence.confidence === null ? null : Math.min(0.68, shortEvidence.confidence),
      evidenceStatus: "观察推演",
      summary: shortEvidence.state === "up" ? "收市证据偏强，短线先看承接，不追高。" : shortEvidence.state === "down" ? "收市证据偏弱，短线先看止跌，不抢反弹。" : "收市证据分歧，短线等待方向确认。",
    } : null,
    medium: mediumEvidence ? {
      state: mediumEvidence.state,
      direction: directionLabel(mediumEvidence.state),
      confidence: mediumEvidence.confidence,
      evidenceStatus: "背景观察",
      summary: mediumEvidence.state === "up" ? "商品与同业背景偏强，仍需连续日线确认。" : "商品与同业背景偏弱，反弹持续性需要复核。",
    } : null,
    long: longEvidence ? {
      state: longEvidence.state,
      direction: directionLabel(longEvidence.state),
      confidence: longEvidence.confidence,
      evidenceStatus: "长期样本",
      summary: longEvidence.evidence || "按长期样本继续跟踪。",
    } : null,
  };
  const outlookHorizons = OUTLOOK_HORIZONS.map(definition => {
    const explicitItem = normalizeOutlookItem(explicit?.[definition.id], definition);
    const fallback = fallbackById[definition.id];
    return explicitItem || (fallback ? { ...definition, ...fallback } : {
      ...definition,
      state: "pending",
      direction: "待观察",
      confidence: null,
      evidenceStatus: "证据不足",
      summary: definition.id === "long" ? "长期基本面与跨周期样本不足，不强行判断。" : "有效跨周期样本不足，继续积累。",
    });
  });
  const short = outlookHorizons[0];
  const medium = outlookHorizons[1];
  const coreThesis = typeof source.coreThesis === "string" ? source.coreThesis : (
    short.state !== "pending" && short.state === medium.state
      ? `短线与中线背景同向${short.direction}，但必须等量价和盘口继续确认。`
      : short.state !== "pending" && medium.state !== "pending"
        ? `短线${short.direction}、中线${medium.direction}，周期分歧时降低结论强度。`
        : short.state !== "pending"
          ? `当前只能确认短线${short.direction}，中长期证据尚不够。`
          : "当前证据不足，先补数据，不为了交作业强行给方向。"
  );
  const rejectedFactors = factors.filter(item => item.state === "否决").map(item => item.note);
  const risks = asArray(source.risks).filter(item => typeof item === "string").slice(0, 4);
  const invalidationConditions = asArray(source.invalidationConditions).filter(item => typeof item === "string").slice(0, 4);
  return {
    summary: typeof source.summary === "string" ? source.summary : coreThesis,
    coreThesis,
    horizons: outlookHorizons,
    risks: risks.length ? risks : [...direction.invalidatedBy, ...rejectedFactors, "中长期基本面与历史样本仍不足"].filter(Boolean).slice(0, 4),
    invalidationConditions: invalidationConditions.length ? invalidationConditions : (
      short.state === "up"
        ? ["跌破VWAP且主动卖盘持续增强", "铜价与板块同业由强转弱"]
        : short.state === "down"
          ? ["重新站稳VWAP且主动买盘持续增强", "铜价与板块同业重新共振"]
          : ["价格、成交量与L2形成同向确认后，重新判断"]
    ),
  };
}

function buildSourceDigest(observations, candidateRules) {
  const onlineLearning = observations?.onlineLearning && typeof observations.onlineLearning === "object" ? observations.onlineLearning : {};
  const sources = asArray(onlineLearning.sources);
  const availableMarketSources = sources.filter(item => item?.available && ["market-data", "market-context", "l2"].includes(item.id)).length;
  const officialEvents = Number.isFinite(Number(onlineLearning.officialEvents)) ? Number(onlineLearning.officialEvents) : 0;
  const professionalRules = candidateRules.filter(item => /路透|彭博|财新|SMM|Mysteel/i.test(item.source));
  const socialRules = candidateRules.filter(item => /雪球|抖音|小红书|东方财富|社交|三级线索/i.test(item.source));
  const platformNames = [...new Set(socialRules.map(item => ["雪球", "抖音", "小红书", "东方财富"].find(name => item.source.includes(name))).filter(Boolean))];
  return {
    groups: [
      { id: "official", label: "公告/官网", tier: "一级可靠", state: officialEvents > 0 ? "ready" : "quiet", count: officialEvents, note: officialEvents > 0 ? "已进入事件核验" : "今日无新增高可信事件" },
      { id: "market", label: "行情/商品/L2", tier: "一级数据", state: availableMarketSources >= 2 ? "ready" : "missing", count: availableMarketSources, note: `${availableMarketSources}/3 个实时证据可用` },
      { id: "professional", label: "专业媒体", tier: "二级授权", state: professionalRules.length ? "ready" : "missing", count: professionalRules.length, note: professionalRules.length ? "仅使用合规来源" : "暂未接入授权内容" },
      { id: "social", label: "雪球/抖音/小红书", tier: "三级线索", state: socialRules.length ? "clue" : "quiet", count: socialRules.length, note: socialRules.length ? `${platformNames.join("、") || "社交平台"}线索，全部待验证` : "今日暂无可核验线索" },
    ],
    highlights: candidateRules.slice(0, 4).map(item => ({
      title: item.title,
      source: item.source,
      status: /一级/.test(item.source) ? "待量价确认" : "待验证线索",
    })),
    note: "一级来源可形成事件证据；二级来源须合规授权；社交内容只提炼假设，不能直接改策略。",
  };
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
  const horizons = buildHorizonEvidence(observations);
  const factorResonance = buildFactorResonance(observations);
  const candidateRules = buildCandidateRules(registry, shadowState, observations);
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
    horizons,
    factorResonance,
    researchOutlook: buildResearchOutlook(observations, direction, horizons, factorResonance),
    sourceDigest: buildSourceDigest(observations, candidateRules),
    findings: asArray(observations?.findings).filter(item => typeof item === "string").slice(0, 6),
    candidateRules,
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
  const fallback = createZijinDailyAssignment({
    marketDate: value.marketDate,
    generatedAt: value.generatedAt,
    observations: {
      direction: value.direction,
      horizons: Object.fromEntries(asArray(value.horizons).filter(item => item?.id).map(item => [item.id, item])),
      factors: Object.fromEntries(asArray(value.factorResonance).filter(item => item?.id).map(item => [item.id, item])),
      findings: value.findings,
      candidateRules: value.candidateRules,
      onlineLearning: value.onlineLearning,
      researchOutlook: value.researchOutlook,
      integrity: value.integrity,
    },
  });
  const assignment = { ...fallback, ...value };
  const existingHorizons = new Map(asArray(value.horizons).filter(item => item?.id).map(item => [item.id, item]));
  assignment.horizons = fallback.horizons.map(item => existingHorizons.has(item.id) ? { ...item, ...existingHorizons.get(item.id) } : item);
  assignment.researchOutlook = fallback.researchOutlook;
  assignment.sourceDigest = fallback.sourceDigest;
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
