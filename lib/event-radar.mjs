const CRITICAL_NEGATIVE = [
  "立案", "重大违法", "退市", "破产", "违约", "停产", "暂停生产", "被调查", "刑事", "冻结", "强制执行",
];
const NEGATIVE = [
  "处罚", "警示函", "监管措施", "问询函", "风险提示", "预亏", "亏损", "巨亏", "续亏", "净亏", "下修", "减持", "终止", "诉讼", "仲裁", "事故", "异常波动", "业绩下降", "业绩预减", "大幅下滑", "净利下降", "同比下降",
];
const POSITIVE = [
  "预增", "扭亏", "同比增长", "增持", "回购", "中标", "获批", "签署战略合作", "重大合同", "利润分配", "分红", "业绩增长", "创新高",
];

export function stripEventMarkup(value = "") {
  return String(value).replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function matches(text, terms) {
  return terms.filter((term) => text.includes(term));
}

const EVENT_TYPES = [
  ["investigation", /立案|调查|监管措施|处罚|警示函|问询函/],
  ["loss", /巨亏|续亏|预亏|亏损|业绩预减|净利下降|同比下降/],
  ["earnings-growth", /预增|扭亏|业绩增长|同比增长/],
  ["strategic-cooperation", /战略合作|合作协议|深化合作|携手|优势互补|共拓/],
  ["repurchase", /回购/],
  ["holding-change", /增持|减持/],
  ["contract", /中标|重大合同|签约|签署协议/],
  ["approval", /获批|批准|许可/],
  ["production", /停产|暂停生产|复产/],
  ["litigation", /诉讼|仲裁|强制执行|冻结/],
  ["dividend", /分红|利润分配/],
];

function eventType(text) {
  return EVENT_TYPES.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

function normalizedEventText(value = "") {
  return stripEventMarkup(value).toLowerCase()
    .replace(/公告精选|最新消息|重磅|独家|快讯|今日|正式宣布|宣布|关于/g, "")
    .replace(/携手|优势互补|共拓全球市场|共拓市场|签署|签订|达成/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function characterBigrams(value) {
  const result = new Set();
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
  return result;
}

function titleSimilarity(left, right) {
  if (!left || !right) return 0;
  if (left === right || left.includes(right) || right.includes(left)) return 1;
  const leftPairs = characterBigrams(left);
  const rightPairs = characterBigrams(right);
  if (!leftPairs.size || !rightPairs.size) return 0;
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return overlap / Math.min(leftPairs.size, rightPairs.size);
}

function isRelatedEvent(left, right) {
  if (left.code !== right.code) return false;
  const leftText = normalizedEventText(left.title);
  const rightText = normalizedEventText(right.title);
  const similarity = titleSimilarity(leftText, rightText);
  if (similarity >= 0.72) return true;
  const leftType = eventType(`${left.title} ${left.summary ?? ""}`);
  const rightType = eventType(`${right.title} ${right.summary ?? ""}`);
  return leftType !== "other" && leftType === rightType && similarity >= 0.42;
}

export function dedupeRelatedEvents(items) {
  const groups = [];
  for (const item of items) {
    const group = groups.find(candidate => candidate.some(existing => isRelatedEvent(existing, item)));
    if (group) group.push(item);
    else groups.push([item]);
  }

  const sentimentPriority = { negative: 3, neutral: 2, positive: 1 };
  return groups.map(group => {
    const representative = [...group].sort((left, right) =>
      (sentimentPriority[right.sentiment] ?? 0) - (sentimentPriority[left.sentiment] ?? 0)
      || left.title.length - right.title.length
    )[0];
    const sources = [...new Set(group.map(item => item.source).filter(Boolean))];
    return {
      ...representative,
      source: sources.join(" / "),
      sources,
      relatedCount: group.length,
      relatedUrls: [...new Set(group.map(item => item.url).filter(Boolean))],
    };
  });
}

export function classifyEvent({ title, summary = "", official = false, publishedAt, now = Date.now() }) {
  const cleanTitle = stripEventMarkup(title);
  const cleanSummary = stripEventMarkup(summary);
  const text = `${cleanTitle} ${cleanSummary}`;
  const critical = matches(text, CRITICAL_NEGATIVE);
  const negative = matches(text, NEGATIVE);
  const positive = matches(text, POSITIVE);
  const ageHours = Math.max(0, (now - new Date(publishedAt).getTime()) / 3_600_000);

  if (critical.length) {
    return {
      sentiment: "negative",
      severity: official && ageHours <= 72 ? "critical" : "warning",
      reason: `命中${critical.slice(0, 2).join("、")}风险词`,
      ageHours,
    };
  }
  if (negative.length) {
    return { sentiment: "negative", severity: "warning", reason: `命中${negative.slice(0, 2).join("、")}风险词`, ageHours };
  }
  if (positive.length) {
    return { sentiment: "positive", severity: "info", reason: `命中${positive.slice(0, 2).join("、")}积极词`, ageHours };
  }
  return { sentiment: "neutral", severity: "info", reason: "未命中明确利好或利空条件", ageHours };
}

export function evaluateEventGate(items) {
  const fresh = items.filter((item) => Number.isFinite(item.ageHours) && item.ageHours <= 72);
  const criticalOfficial = fresh.filter((item) => item.official && item.severity === "critical");
  const negative = fresh.filter((item) => item.sentiment === "negative");
  const independentNegativeSources = new Set(negative.map((item) => item.source)).size;

  if (criticalOfficial.length) {
    return {
      level: "locked", hardLock: true, score: 95,
      label: "重大负面公告预警", action: "禁止新开 T，只允许恢复底仓",
      reason: criticalOfficial[0].reason,
    };
  }
  if (negative.length >= 2 && independentNegativeSources >= 2) {
    return {
      level: "restricted", hardLock: false, score: 76,
      label: "多源利空待核实", action: "暂停新开循环，人工核实原文",
      reason: `${negative.length} 条负面信息来自 ${independentNegativeSources} 个来源`,
    };
  }
  if (negative.length) {
    return {
      level: "caution", hardLock: false, score: 56,
      label: "发现负面信息", action: "降低信号置信度，先核实原文",
      reason: negative[0].reason,
    };
  }
  return {
    level: "normal", hardLock: false, score: 18,
    label: fresh.some((item) => item.sentiment === "positive") ? "发现积极信息" : "未发现明确事件风险",
    action: "消息只作辅助，不因利好自动放宽风控",
    reason: fresh.length ? `近 72 小时已核对 ${fresh.length} 条公开信息` : "近 72 小时暂无匹配信息",
  };
}
