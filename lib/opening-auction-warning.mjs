// Auction pressure is a warning, never a continuous-session confirmation.
export function openingAuctionWarning({ phase, exchangeTime, date, time, connected, stale, imbalance, open, previousClose } = {}) {
  if (!["preauction", "auction", "auction-result"].includes(phase)) return null;
  const pending = { label: "盘前预警 · 等待有效竞价数据", gapText: "开盘方向待确认", session: "等待昨收" };
  const match = String(exchangeTime ?? "").match(/^(\d{8})-(\d{2})(\d{2})/);
  const minute = match ? `${match[2]}${match[3]}` : "";
  const ordinal = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(2, 4));
  if (!match || match[1] !== date || !/^\d{4}$/.test(time ?? "") || minute < "0920" || minute > time || ordinal(time) - ordinal(minute) > 1 || !connected || stale) return pending;
  if (phase === "auction-result") {
    if (minute < "0925" || !(open > 0) || !(previousClose > 0)) return pending;
    const gap = (open / previousClose - 1) * 100;
    const session = gap >= 0.1 ? "高开" : gap <= -0.1 ? "低开" : "平开";
    return { session, gapText: `${session} ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%`, label: `${session}已确认 · 等待开盘走势确认` };
  }
  if (typeof imbalance !== "number" || !Number.isFinite(imbalance) || Math.abs(imbalance) > 1) return pending;
  return { ...pending, label: imbalance <= -0.2 ? "竞价卖压预警 · 待开盘确认" : imbalance >= 0.2 ? "竞价承接偏强 · 待开盘确认" : "竞价多空未明 · 待开盘确认" };
}
