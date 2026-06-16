import { NextResponse } from "next/server";
import { runBacktestMatrix } from "../../../lib/matrix";
import { SUPPORTED_SYMBOLS } from "../../../lib/symbols";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS = [...SUPPORTED_SYMBOLS];
// 多币种矩阵默认只跑日线那一档，控制耗时与限流风险（10 币 × 1 周期 = 10 次串行请求）。
const GRANS = ["1day"];

/**
 * GET /api/matrix
 * 同一套确定性威科夫规则跨 10 个主流币种（日线）运行，返回回测指标矩阵，
 * 证明策略并非对单一币种过拟合。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const strategy = (url.searchParams.get("strategy") || "wyckoff").toLowerCase();
    const rows = await runBacktestMatrix(SYMBOLS, GRANS, 300, undefined, strategy);
    return NextResponse.json({
      symbols: SYMBOLS,
      granularities: GRANS,
      rows,
      generatedAt: new Date().toISOString(),
      note: "成本已计入（taker 0.06% + 滑点 0.02%，单边约 0.08%），入场价采用信号确认后下一根开盘价，无前视偏差。参数随周期自适应。",
    });
  } catch (err: any) {
    const msg = err?.message || "未知错误";
    return NextResponse.json({ error: `矩阵回测失败：${msg}` }, { status: 502 });
  }
}
