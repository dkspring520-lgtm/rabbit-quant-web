import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "做T神器｜A股日内量化决策终端",
  description: "多股监控、集合竞价研判、正反T决策、模拟复盘与四智能体持续训练。",
  icons: {
    icon: "/rabbit-brand-gold.png",
    shortcut: "/rabbit-brand-gold.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
