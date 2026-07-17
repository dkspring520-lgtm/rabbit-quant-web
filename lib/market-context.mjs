/**
 * Convert a collection of external market observations into a conservative
 * risk gate. This module is intentionally deterministic: news summaries and
 * language models never sit in the one-second decision path.
 */
export function evaluateMarketContext(items, stockChangePercent = null) {
  const available = items.filter((item) => Number.isFinite(item.changePercent));
  if (!available.length) {
    return {
      score: 45,
      level: "degraded",
      label: "外部数据不可用",
      action: "仅使用个股信号，暂停激进档",
      positionFraction: 1 / 6,
      hardLock: false,
      reasons: ["指数、行业与关联品种均未取得有效报价"],
    };
  }

  let score = 14;
  const reasons = [];
  const weights = { market: 18, sector: 26, related: 18, cross: 20, currency: 8 };

  for (const item of available) {
    const change = item.changePercent;
    const adverse = item.inverse ? change > 0 : change < 0;
    const magnitude = Math.abs(change);
    if (adverse && magnitude >= 1) {
      score += (weights[item.group] ?? 12) * Math.min(1.35, magnitude / 2);
      reasons.push(`${item.label}${change >= 0 ? "+" : ""}${change.toFixed(2)}%`);
    }
    if (magnitude >= 3) score += item.group === "market" ? 10 : 6;
  }

  const sector = available.find((item) => item.group === "sector");
  if (Number.isFinite(stockChangePercent) && sector) {
    const divergence = stockChangePercent - sector.changePercent;
    if (stockChangePercent < -1 && sector.changePercent > 1) {
      score += 14;
      reasons.push(`个股弱于行业 ${Math.abs(divergence).toFixed(2)} 个百分点`);
    } else if (stockChangePercent > 1 && sector.changePercent < -1) {
      score += 9;
      reasons.push("个股与行业出现明显背离");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  // Index/sector moves are context, not proof that the monitored stock itself
  // has become untradable. Keep them as an amber restriction and reserve the
  // red hard lock for direct-stock extreme states or verified critical news.
  if (score >= 85) return { score, level: "restricted", label: "外部市场剧烈波动", action: "暂停新开循环，恢复底仓优先；不触发全局红色锁定", positionFraction: 1 / 6, hardLock: false, reasons: reasons.slice(0, 3) };
  if (score >= 65) return { score, level: "restricted", label: "外部风险偏高", action: "暂停新开循环，等待个股与 VWAP 重新确认", positionFraction: 1 / 6, hardLock: false, reasons: reasons.slice(0, 3) };
  if (score >= 40) return { score, level: "caution", label: "外部环境谨慎", action: "允许 T，仓位降至 1/6", positionFraction: 1 / 6, hardLock: false, reasons: reasons.slice(0, 3) };
  return { score, level: "normal", label: "外部环境正常", action: "允许 T，单次最多 1/3 底仓", positionFraction: 1 / 3, hardLock: false, reasons: reasons.length ? reasons.slice(0, 3) : ["指数、行业和关联品种未触发风险阈值"] };
}
