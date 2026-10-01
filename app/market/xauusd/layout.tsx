import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "XAUUSD 黄金行情 | 双兔市场终端",
  description: "TradingView 风格的黄金兑美元行情界面原型。",
};

export default function XauUsdLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
