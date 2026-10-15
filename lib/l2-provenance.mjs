// Receipt freshness is separate from exchange time. Legacy responses remain
// readable, but do not acquire invented per-stream timestamps or sequences.
export function withL2Provenance(payload, now = Date.now()) {
  if (!payload.streams) return { ...payload, provenanceStatus: "legacy-unavailable" };
  const streams = Object.fromEntries(["snapshot", "transaction", "order"].map(name => {
    const stream = payload.streams[name] ?? {};
    const received = Date.parse(stream.receivedAt ?? "");
    const age = Number.isFinite(received) ? Math.max(0, (now - received) / 1000) : null;
    const available = payload.status?.connected === true && payload.status?.authorized !== false
      && stream.available === true && age !== null && age <= 15;
    return [name, { ...stream, ageSeconds: age, available, stale: !available }];
  }));
  return { ...payload, streams, provenanceStatus: "per-stream",
    status: { ...payload.status, stale: payload.status?.stale === true || Object.values(streams).some(s => s.stale) },
    latestTrade: payload.latestTrade ? { ...payload.latestTrade,
      available: streams.transaction.available && payload.latestTrade.generation === payload.tradeEventsMeta?.generation } : null,
    book: payload.book ? { ...payload.book, available: streams.snapshot.available } : payload.book };
}

export function shouldApplyL2Response(current, incoming) {
  if (!current) return true;
  const before = Date.parse(current.updatedAt ?? ""), after = Date.parse(incoming.updatedAt ?? "");
  if (Number.isFinite(before) && Number.isFinite(after) && after < before) return false;
  const a = current.streams?.snapshot?.exchangeTime, b = incoming.streams?.snapshot?.exchangeTime;
  return !(a && b && b < a);
}

export function l2ProvenanceText(payload) {
  if (!payload || payload.error) return "L2 数据缺失；分流来源与新鲜度待确认";
  if (!payload?.streams) return "旧版响应：分流时间与逐笔来源不可用";
  const clock = value => typeof value === "string" && /^\d{8}-\d{9}$/.test(value)
    ? `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.${value.slice(15)}` : "缺失";
  const label = (name, title) => {
    const s = payload.streams[name];
    return `${title} ${clock(s?.exchangeTime)} · ${s?.available ? "近期收到，源时效未认证" : "断线/陈旧/缺失"}`;
  };
  const t = payload.latestTrade;
  const trade = t?.available && Number.isFinite(t.price) ? `${t.price.toFixed(2)} / ${t.volume ?? "--"}原始量` : "不可用";
  return `${label("snapshot", "快照价/累计量")}；${label("transaction", "成交")}；${label("order", "委托")}；最新成交 ${trade}；序号${t?.sequence == null ? "缺失，未认证唯一逐笔" : `${t.sequence} / 通道 ${t.channel ?? "缺失"}`}；计数为解析记录数`;
}
