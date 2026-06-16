import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wyckoff Agent · 威科夫交易 Agent",
  description:
    "基于威科夫方法的交易 Agent：感知市场阶段、识别关键结构、生成信号并回测验证。数据来自 Bitget 公开行情。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
