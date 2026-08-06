import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "增长中心 | 双兔助手",
  description: "股票做T知识库的关键词、文章审核与增长数据工作台。",
};

export default function GrowthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
