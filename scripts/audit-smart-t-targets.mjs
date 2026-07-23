import { runSmartTReplay } from "../lib/smart-t-engine.mjs";
import { resolveHistoricalPreviousClose } from "../lib/historical-session-anchor.mjs";

const baseUrl = process.argv[2] ?? "https://www.zhuandianmi.com";
const targets = process.argv.slice(3);

if (!targets.length) {
  throw new Error("请提供 code:YYYYMMDD，例如 002594:20260721");
}

function normalDate(value) {
  return String(value ?? "").replaceAll("-", "");
}

async function loadTarget(target) {
  const [code, date] = target.split(":");
  const response = await fetch(`${baseUrl}/api/market-data?code=${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  const session = (data.intradaySessions ?? []).find((item) => normalDate(item.date) === normalDate(date));
  if (!session) throw new Error(`${code}: 找不到 ${date} 的完整分时`);

  const prices = session.minutes.map((point) => Number(point.price)).filter(Number.isFinite);
  const previousClose = resolveHistoricalPreviousClose(session, data.bars ?? []);
  const referencePrice = previousClose || prices[0] || 10;
  const shares = Math.max(300, Math.floor((90_000 / referencePrice) / 100) * 100);
  const result = runSmartTReplay(session.minutes, {
    capital: 200_000,
    baseShares: shares,
    sellable: shares,
    feeRate: 0.025,
    slippage: 0.02,
    minCommission: true,
    slippageMode: "percent",
    forceCloseTime: "1450",
    previousClose,
    profile: "平衡档",
    randomValue: 0,
  });

  return {
    code,
    name: data.quote?.name ?? code,
    date: normalDate(session.date),
    previousClose,
    candidates: result.diagnostics?.candidates ?? 0,
    actions: result.actions.map((action) => ({
      time: action.time,
      side: action.side,
      price: action.price,
      phase: action.meta?.phase,
      reason: action.reason,
    })),
    cycleNets: result.cycleNets,
    net: result.net,
  };
}

const settled = await Promise.allSettled(targets.map(loadTarget));
const output = settled.map((item, index) => item.status === "fulfilled"
  ? item.value
  : { target: targets[index], error: item.reason?.message ?? String(item.reason) });

console.log(JSON.stringify(output, null, 2));
