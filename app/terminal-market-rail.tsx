"use client";

import { useState, type CSSProperties } from "react";

type TerminalL2 = {
  lastExchangeTime?: string;
  status?: { connected?: boolean; stale?: boolean };
  meta?: { stale?: boolean };
  book?: { bidPrices?: number[]; askPrices?: number[]; bidVolumes?: number[]; askVolumes?: number[]; spreadBps?: number | null; nearTouchImbalance?: number | null };
  recentTransactions?: { receivedAt: number; side: string; price: number; volume: number }[];
  flow?: { activeBuyNotional60s?: number; activeSellNotional60s?: number; netActiveNotional60s?: number };
};

const priceText = (value?: number | null) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toFixed(2) : "—";
const numberText = (value?: number | null) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : "—";

/** A view of the existing collector payload; missing depth is never synthesized. */
export function TerminalMarketRail({ code, name, price, changePercent, l2 }: {
  code: string; name: string; price?: number | null; changePercent?: number | null; l2: TerminalL2 | null;
}) {
  const [view, setView] = useState<"depth" | "trades">("depth");
  const book = l2?.book;
  const stale = Boolean(l2?.status?.stale || l2?.meta?.stale);
  const depthCount = Math.max(book?.bidPrices?.length ?? 0, book?.askPrices?.length ?? 0);
  const maxVolume = Math.max(1, ...(book?.bidVolumes ?? []), ...(book?.askVolumes ?? []));
  const trades = l2?.recentTransactions?.slice(-80).reverse() ?? [];
  const down = (changePercent ?? 0) < 0;
  const depthRow = (side: "ask" | "bid", index: number) => {
    const prices = side === "ask" ? book?.askPrices : book?.bidPrices;
    const volumes = side === "ask" ? book?.askVolumes : book?.bidVolumes;
    const volume = volumes?.[index];
    return <div className={`terminal-depth-row ${side}`} key={`${side}-${index}`} style={{ "--depth-fill": `${Math.max(0, (volume ?? 0) / maxVolume * 100)}%` } as CSSProperties}>
      <span>{side === "ask" ? "卖" : "买"}{index + 1}</span><b>{priceText(prices?.[index])}</b><span>{numberText(volume)}</span>
    </div>;
  };
  return <section className="terminal-market" aria-label={`${name}行情盘口`}>
    <header className="terminal-instrument"><div><strong>{name}</strong><span>{code} · A股</span></div><em className={l2?.status?.connected && !stale ? "online" : ""}>{stale ? "L2 延迟" : l2?.status?.connected ? "L2 已连接" : "L2 待连接"}</em></header>
    <div className={`terminal-price ${down ? "down" : "up"}`}><strong>{priceText(price)}</strong><span>{changePercent == null ? "—" : `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`}</span></div>
    <div className="terminal-market-meta"><span>行情时间</span><time>{l2?.lastExchangeTime ?? "等待 L2 快照"}</time></div>
    <div className="terminal-book-tabs" role="tablist" aria-label="盘口明细"><button role="tab" aria-selected={view === "depth"} onClick={() => setView("depth")}>十档盘口</button><button role="tab" aria-selected={view === "trades"} onClick={() => setView("trades")}>逐笔成交</button><span>{view === "depth" ? `${Math.min(depthCount, 10)} / 10 档` : `${trades.length} 笔`}</span></div>
    {view === "depth" ? <div className="terminal-depth" aria-label="十档买卖报价">
      <div className="terminal-table-head"><span>档位</span><span>价格</span><span>数量 / 股</span></div>
      {Array.from({ length: 10 }, (_, i) => depthRow("ask", 9 - i))}
      <div className="terminal-spread"><span>买卖价差</span><b>{book?.spreadBps == null ? "—" : `${book.spreadBps.toFixed(2)} bps`}</b></div>
      {Array.from({ length: 10 }, (_, i) => depthRow("bid", i))}
      {!depthCount && <p className="terminal-empty">等待真实十档快照{code !== "601899" ? " · 当前股票尚未接入 L2" : ""}</p>}
    </div> : <div className="terminal-trades" aria-label="逐笔成交列表">
      <div className="terminal-table-head"><span>时间</span><span>成交价</span><span>数量 / 股</span></div>
      {trades.map((trade, i) => <div className={`terminal-depth-row ${trade.side === "B" ? "bid" : trade.side === "S" ? "ask" : ""}`} key={`${trade.receivedAt}-${i}`}><time title="采集接收时间">{new Date(trade.receivedAt * 1000).toLocaleTimeString("zh-CN", { hour12: false })}</time><b>{priceText(trade.price)}</b><span>{numberText(trade.volume)} {trade.side === "B" ? "B" : trade.side === "S" ? "S" : ""}</span></div>)}
      {!trades.length && <p className="terminal-empty">等待真实逐笔成交<br/>分钟汇总不替代逐笔数据</p>}
    </div>}
    <div className="terminal-flow-summary"><h3>主动成交 <small>近 60 秒</small></h3><dl><div><dt>主动买入</dt><dd className="up">{numberText(l2?.flow?.activeBuyNotional60s)}</dd></div><div><dt>主动卖出</dt><dd className="down">{numberText(l2?.flow?.activeSellNotional60s)}</dd></div><div><dt>主动净额 / 元</dt><dd>{numberText(l2?.flow?.netActiveNotional60s)}</dd></div><div><dt>盘口失衡 OBI</dt><dd>{l2?.book?.nearTouchImbalance == null ? "—" : `${(l2.book.nearTouchImbalance * 100).toFixed(1)}%`}</dd></div></dl></div>
    <footer className="terminal-market-footer">{stale ? "延迟快照 · 不作为当前可成交报价" : "L2 原始行情 · 缺失档位显示 —"}</footer>
  </section>;
}
