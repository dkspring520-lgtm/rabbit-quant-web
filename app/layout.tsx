import type { Metadata } from "next";
import "./globals.css";
import "./backtest.css";
import "./holdings.css";
import "./modules.css";
import "./typography.css";
import "./home.css";
import "./auth.css";
import "./onboarding.css";
import "./watchlist.css";
import "./marketplace.css";
import "./public-landing.css";
import "./legal.css";

export const metadata: Metadata = {
  title: "双兔助手｜做T神器｜A股日内量化决策终端",
  description: "多股监控、集合竞价研判、正反T决策、模拟复盘与四智能体持续训练。",
  icons: {
    icon: "/rabbit-logo-compact.png",
    shortcut: "/rabbit-logo-compact.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
