import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "股票做T知识库 | 双兔助手",
  description: "用更清楚的成本、VWAP、仓位和复盘框架理解股票做T。",
};

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
