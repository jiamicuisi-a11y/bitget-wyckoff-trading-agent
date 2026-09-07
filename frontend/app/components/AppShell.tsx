"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/overview", label: "总览", icon: "▦" },
  { href: "/agent", label: "Agent 对话", icon: "✦" },
  { href: "/intelligence", label: "市场情报", icon: "◌" },
  { href: "/radar/anomaly", label: "A档异动扫描", icon: "◉" },
  { href: "/radar/dualma", label: "双均线 4H", icon: "⌁" },
  { href: "/radar/box-breakout", label: "30m 箱体突破", icon: "↥" },
  { href: "/risk", label: "风险闸门", icon: "◈" },
  { href: "/runs", label: "运行记录", icon: "▤" },
  { href: "/connections", label: "权限与连接", icon: "⚙" },
];

export default function AppShell({ children, title, eyebrow }: { children: ReactNode; title: string; eyebrow: string }) {
  const pathname = usePathname();
  return (
    <div className="product-shell">
      <aside className="product-sidebar">
        <Link className="product-brand" href="/overview" aria-label="回到总览">
          <span className="brand-mark">✦</span>
          <span><strong>Agent OS</strong><small>Strategy Copilot</small></span>
        </Link>
        <div className="sidebar-label">工作区</div>
        <nav className="product-nav">
          {links.slice(0, 6).map((link) => <Link key={link.href} href={link.href} className={`product-nav-item ${pathname === link.href ? "selected" : ""}`}><span>{link.icon}</span>{link.label}</Link>)}
        </nav>
        <div className="sidebar-label">控制中心</div>
        <nav className="product-nav">
          {links.slice(6).map((link) => <Link key={link.href} href={link.href} className={`product-nav-item ${pathname === link.href ? "selected" : ""}`}><span>{link.icon}</span>{link.label}</Link>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="safe-card"><span className="status-dot" /> <strong>模拟模式</strong><p>只读行情 · 本地模拟执行</p><small>不广播真实交易</small></div>
      </aside>
      <main className="product-main">
        <header className="product-topbar"><div className="crumb">Strategy Copilot <span>/</span> <strong>{title}</strong></div><div className="topbar-status"><span className="status-dot" />币安合约公开数据</div></header>
        <div className="page-wrap"><div className="page-intro"><div><span className="page-eyebrow">{eyebrow}</span><h1>{title}</h1></div><div className="boundary-badge">仅模拟 <span>•</span> 不支持提现</div></div>{children}</div>
      </main>
    </div>
  );
}
