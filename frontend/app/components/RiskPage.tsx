"use client";

import { useEffect, useState } from "react";
import AppShell from "./AppShell";
import { loadStrategyState, money, percentage, shortSymbol, formatTime } from "../lib/data";
import type { StrategyState } from "../lib/strategy-types";

export default function RiskPage() {
  const [states, setStates] = useState<StrategyState[]>([]);
  useEffect(() => { Promise.all([loadStrategyState("anomaly-binance"), loadStrategyState("dualma4h-binance")]).then((items) => setStates(items.map((item) => item.state))).catch(() => undefined); }, []);
  return <AppShell title="风险闸门" eyebrow="CONTROL PLANE"><div className="risk-intro"><div><span className="page-eyebrow">HUMAN-IN-THE-LOOP SAFETY</span><h2>每一个计划，<em>先过闸门。</em></h2><p>Paper worker 可以自动管理模拟仓，但任何计划都必须满足阈值、止损、并发和冷却规则。真实广播永远关闭。</p></div><div className="big-safety">PAPER<br /><strong>LOCKED</strong><small>broadcast=false</small></div></div><div className="gate-flow"><div className="done">01<span>感知行情</span><small>读取 Binance public data</small></div><i>→</i><div className="done">02<span>策略判断</span><small>独立策略输出候选</small></div><i>→</i><div className="done">03<span>风险检查</span><small>止损 · 并发 · 冷却</small></div><i>→</i><div className="wait">04<span>Paper 执行</span><small>后台自动处理</small></div></div><section className="risk-plans"><div className="section-title"><div><span className="table-kicker">RISK DECISIONS</span><h2>当前风险上下文</h2></div></div>{states.map((state) => <div className="risk-strategy" key={state.strategy}><div><span className="strategy-tag">{state.strategy === "anomaly-binance" ? "A档异动扫描" : "双均线 4H"}</span><h3>{state.latestScan?.candidateCount || 0} 个候选等待判断</h3><p>最近扫描：{formatTime(state.latestScan?.scannedAt)}</p></div><div className="risk-checks"><span>阈值 <b>PASS</b></span><span>止损 <b>3%</b></span><span>杠杆 <b>{state.config.paper.leverage || 3}x</b></span><span>并发 <b>{state.positions.length}/{state.config.paper.maxConcurrent || 4}</b></span></div></div>)}</section><div className="safety-note">✓ 当前权限：Market data · Paper execution　　✓ 不读取 API key　　✓ 不签名　　✓ 不广播　　✓ 不提现</div></AppShell>;
}
