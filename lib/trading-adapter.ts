export type TradingMode = "disabled" | "paper" | "live";
export type TradeSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export interface TradingAccountSnapshot {
  broker: string;
  accountId: string;
  mode: TradingMode;
  connected: boolean;
  buyingPower: number;
  updatedAt: string;
}

export interface TradeIntent {
  intentId: string;
  symbol: string;
  side: TradeSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  strategy: "SMART_T";
  cycle: "BUY_FIRST" | "SELL_FIRST";
  signalScore: number;
  reason: string;
  createdAt: string;
  expiresAt: string;
  humanApprovalToken?: string;
}

export interface OrderReceipt {
  intentId: string;
  brokerOrderId: string;
  status: "REJECTED" | "PENDING" | "ACCEPTED" | "PARTIAL" | "FILLED" | "CANCELLED";
  filledQuantity: number;
  averagePrice?: number;
  message?: string;
  updatedAt: string;
}

export interface TradingAdapter {
  readonly name: string;
  readonly mode: TradingMode;
  health(): Promise<{ connected: boolean; latencyMs?: number; message: string }>;
  account(): Promise<TradingAccountSnapshot>;
  preview(intent: TradeIntent): Promise<{ accepted: boolean; warnings: string[] }>;
  place(intent: TradeIntent): Promise<OrderReceipt>;
  cancel(brokerOrderId: string): Promise<OrderReceipt>;
  query(brokerOrderId: string): Promise<OrderReceipt>;
}

// Intentionally empty: a future broker module must be registered explicitly.
export const tradingAdapters = new Map<string, TradingAdapter>();

