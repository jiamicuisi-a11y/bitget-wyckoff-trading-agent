import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent OS · Strategy Copilot",
  description:
    "Binance Agent OS 交易智能体控制台：异动扫描、双均线模拟盘与风险闸门。",
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
