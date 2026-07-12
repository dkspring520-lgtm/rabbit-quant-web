import { tradingAdapters } from "../../../lib/trading-adapter";

const contract = {
  version: "2026-07-12",
  status: "reserved",
  mode: "disabled",
  liveTradingEnabled: false,
  capabilities: ["health", "account", "preview", "place", "cancel", "query"],
  safeguards: [
    "human_approval_required",
    "idempotency_key_required",
    "position_and_sellable_quantity_check",
    "price_deviation_guard",
    "daily_loss_circuit_breaker",
    "market_hours_guard",
    "duplicate_order_guard",
    "full_audit_log",
  ],
};

export async function GET() {
  return Response.json({ ...contract, registeredAdapters: [...tradingAdapters.keys()] });
}

export async function POST() {
  return Response.json(
    { ...contract, ok: false, code: "AUTO_TRADING_DISABLED", message: "自动交易接口已预留，但尚未绑定券商且真实报单保持关闭。" },
    { status: 423 },
  );
}
