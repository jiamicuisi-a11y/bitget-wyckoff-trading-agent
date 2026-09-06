"use client";

import { useCallback, useEffect, useState } from "react";

interface BoxOpportunity {
  expiry: string;
  kLo: number;
  kHi: number;
  width: number;
  side: "long" | "short";
  boxPV: number;
  grossUsd: number;
  netUsd: number;
  netEdgePct: number;
  legs: string;
}

interface ParityOpportunity {
  expiry: string;
  strike: number;
  theoCmP: number;
  mktCmP: number;
  devUsd: number;
  edgePct: number;
  hint: string;
}

interface ArbResp {
  source: string;
  currency: string;
  spot: number;
  optionCount: number;
  quotedCount: number;
  r: number;
  thresholds: { minBoxEdgePct: number; minParityEdgePct: number };
  boxes: BoxOpportunity[];
  parity: ParityOpportunity[];
  ts: string;
  note: string;
  error?: string;
}

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export default function OptionsArbDashboard() {
  const [currency, setCurrency] = useState("BTC");
  const [data, setData] = useState<ArbResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        view: "options-arb",
        currency,
        minBoxEdgePct: "0.05",
        minParityEdgePct: "0.1",
        r: "0.05",
      });
      const res = await fetch(`/api/paper?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `请求失败 ${res.status}`);
      setData(json as ArbResp);
    } catch (e: any) {
      setError(e?.message || "期权套利雷达请求失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    load();
  }, [load]);

  const hasBoxes = (data?.boxes?.length || 0) > 0;
  const hasParity = (data?.parity?.length || 0) > 0;

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>期权套利雷达 · Deribit 实时报价</h2>
          <span className="muted">Box Spread / Put-Call Parity · 不自动下单</span>
        </div>
        <div className="seg" style={{ marginBottom: 16 }}>
          {["BTC", "ETH"].map((c) => (
            <button key={c} className={`seg-item ${currency === c ? "active" : ""}`} onClick={() => setCurrency(c)}>
              {c}
            </button>
          ))}
          <button className="seg-item" onClick={load} disabled={loading}>
            {loading ? "扫描中…" : "刷新扫描"}
          </button>
        </div>
        {error && <div className="alert-error">⚠ {error}</div>}
        <div className="metric-grid">
          <Metric label="标的指数" value={data ? `$${fmt(data.spot)}` : "—"} big />
          <Metric label="期权链数量" value={data ? `${data.optionCount}` : "—"} />
          <Metric label="双边报价" value={data ? `${data.quotedCount}` : "—"} />
          <Metric label="Box机会" value={data ? `${data.boxes.length}` : "—"} positive={hasBoxes} />
          <Metric label="Parity偏差" value={data ? `${data.parity.length}` : "—"} positive={hasParity} />
          <Metric label="更新时间" value={data ? fmtTime(data.ts) : "—"} />
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          用可成交 bid/ask 估算，并扣 Deribit taker 费用；只做机会雷达，不代表真实可无滑点成交。纯无风险机会通常很少，0 条也是有效结果。
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Box Spread 机会</h2>
          <span className="muted">四腿锁定固定收益 · 阈值净 edge ≥ 0.05%</span>
        </div>
        {!data || loading ? (
          <div className="empty-state"><div className="spinner" /><p>正在扫描期权链…</p></div>
        ) : !hasBoxes ? (
          <p className="muted">当前没有扣费后仍为正的 Box 机会。对纯套利来说，这是正常状态。</p>
        ) : (
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr>
                  <th>到期</th><th>方向</th><th>K低/K高</th><th>宽度</th><th>理论PV</th><th>净收益</th><th>净edge</th><th>四腿</th>
                </tr>
              </thead>
              <tbody>
                {data.boxes.map((b, i) => (
                  <tr key={`${b.expiry}-${b.kLo}-${b.kHi}-${i}`}>
                    <td>{b.expiry}</td>
                    <td><span className={`tag-mini ${b.side === "long" ? "tag-long" : "tag-short"}`}>{b.side === "long" ? "Long Box" : "Short Box"}</span></td>
                    <td>{fmt(b.kLo, 0)} / {fmt(b.kHi, 0)}</td>
                    <td>{fmt(b.width, 0)}</td>
                    <td>${fmt(b.boxPV)}</td>
                    <td className="pos">${fmt(b.netUsd)}</td>
                    <td className="pos">{fmt(b.netEdgePct, 3)}%</td>
                    <td className="muted">{b.legs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Put-Call Parity 偏差</h2>
          <span className="muted">同到期同 Strike · 阈值偏差 ≥ 0.1%</span>
        </div>
        {!data || loading ? (
          <p className="muted">等待扫描结果…</p>
        ) : !hasParity ? (
          <p className="muted">当前 Put-Call Parity 偏差低于阈值，没有明显 Conversion/Reversal 机会。</p>
        ) : (
          <div className="table-wrap">
            <table className="trades">
              <thead>
                <tr>
                  <th>到期</th><th>Strike</th><th>理论 C-P</th><th>市场 C-P</th><th>偏差</th><th>偏差%</th><th>提示</th>
                </tr>
              </thead>
              <tbody>
                {data.parity.map((p, i) => (
                  <tr key={`${p.expiry}-${p.strike}-${i}`}>
                    <td>{p.expiry}</td>
                    <td>{fmt(p.strike, 0)}</td>
                    <td>${fmt(p.theoCmP)}</td>
                    <td>${fmt(p.mktCmP)}</td>
                    <td className={p.devUsd >= 0 ? "pos" : "neg"}>{p.devUsd >= 0 ? "+" : ""}${fmt(p.devUsd)}</td>
                    <td>{fmt(p.edgePct, 3)}%</td>
                    <td className="muted">{p.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="disclaimer" style={{ marginTop: 16 }}>
        ⚠ 这是期权套利雷达，不是自动交易。Box/Parity 理论接近无风险，但真实执行仍有滑点、手续费、融资成本、保证金、平台风险与四腿成交失败风险。
      </div>
    </>
  );
}

function Metric({ label, value, positive, big }: { label: string; value: string; positive?: boolean; big?: boolean }) {
  return (
    <div className={`metric ${big ? "metric-big" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${positive ? "pos" : ""}`}>{value}</div>
    </div>
  );
}
