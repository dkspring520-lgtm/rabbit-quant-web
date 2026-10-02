import { PaperExecutionEngine } from "../../paper-trading/paper-execution-engine.mjs";

const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const round = v => Number(finite(v).toFixed(6));

function marketForBar(bar) {
  const timestamp = String(bar.timestamp ?? "");
  const match = timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2}:\d{2})/);
  return {
    symbol: bar.symbol,
    timestamp,
    date: match ? `${match[1]}-${match[2]}-${match[3]}` : timestamp.slice(0, 10),
    time: match?.[4] ?? timestamp.slice(11, 16),
    marketPrice: finite(bar.close ?? bar.price),
    price: finite(bar.close ?? bar.price),
    suspended: bar.suspended === true,
    limitUp: bar.limitUp === true,
    limitDown: bar.limitDown === true,
  };
}

export function evaluatePaperAccount({ strategyId, bars = [], actionSequence = [], symbol = "", initialCash = 1_000_000, initialPosition = 1_000, costConfig = { commission: 0.025, minimumCommission: 5, stampDuty: 0.05, slippage: 0.02 } } = {}) {
  const engine = new PaperExecutionEngine({ accountId: `${strategyId}-account`, symbol, initialCash, initialPosition, initialSellablePosition: initialPosition, config: costConfig });
  let realizedPnL = 0;
  let fees = 0;
  let slippage = 0;
  let maxEquity = initialCash + initialPosition * finite(bars[0]?.close ?? bars[0]?.price);
  let maxDrawdown = 0;
  const costBasis = { average: finite(bars[0]?.close ?? bars[0]?.price), quantity: initialPosition };
  const fills = [];
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const action = String(actionSequence[i] ?? "WAIT").toUpperCase();
    if (action !== "WAIT") {
      const side = action === "BUY" || action === "BUY_SMALL" ? "BUY" : action === "SELL" || action === "SELL_PART" || action === "SELL_ALL" ? "SELL" : "WAIT";
      const quantity = action === "SELL_ALL" ? Math.max(100, engine.position.availableSellablePosition - (engine.position.availableSellablePosition % 100)) : 100;
      const before = engine.position;
      const order = engine.execute(marketForBar(bar), { side, quantity, orderPrice: finite(bar.close ?? bar.price), timestamp: bar.timestamp });
      if (order.status === "FILLED") {
        fills.push(order);
        fees += finite(order.fees);
        slippage += finite(order.slippage);
        if (side === "SELL") realizedPnL += (finite(order.fillPrice) - costBasis.average) * order.quantity - finite(order.fees);
        if (side === "BUY") {
          const total = before.totalPosition + order.quantity;
          costBasis.average = ((costBasis.average * before.totalPosition) + finite(order.fillPrice) * order.quantity + finite(order.fees)) / Math.max(1, total);
          costBasis.quantity = total;
        } else costBasis.quantity = Math.max(0, before.totalPosition - order.quantity);
      }
    }
    const equity = engine.cash + engine.position.totalPosition * finite(bar.close ?? bar.price);
    maxEquity = Math.max(maxEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, maxEquity ? (maxEquity - equity) / maxEquity : 0);
  }
  const lastPrice = finite(bars.at(-1)?.close ?? bars.at(-1)?.price);
  const endingCash = engine.cash;
  const endingEquity = endingCash + engine.position.totalPosition * lastPrice;
  return Object.freeze({ strategyId, accountId: engine.accountId, initialCash: round(initialCash), endingCash: round(endingCash), position: engine.position.totalPosition, sellablePosition: engine.position.availableSellablePosition, tradeCount: fills.length, realizedPnL: round(realizedPnL), fees: round(fees), slippage: round(slippage), netReturn: round((endingEquity - (initialCash + initialPosition * finite(bars[0]?.close ?? bars[0]?.price))) / Math.max(1, initialCash + initialPosition * finite(bars[0]?.close ?? bars[0]?.price))), maxDrawdown: round(maxDrawdown), costModelUnavailable: false });
}

export function evaluatePaperAccounts({ policies = {}, bars = [], symbol = "", ...options } = {}) {
  return Object.fromEntries(Object.entries(policies).map(([strategyId, actionSequence]) => [strategyId, evaluatePaperAccount({ ...options, strategyId, bars, actionSequence, symbol })]));
}
