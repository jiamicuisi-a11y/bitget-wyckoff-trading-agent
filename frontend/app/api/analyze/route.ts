import { NextResponse } from "next/server";
import { fetchCandles, VALID_GRANULARITIES } from "../../../lib/bitget";
import { analyzeWyckoff } from "../../../lib/wyckoff";
import { generateSignals, DEFAULT_RISK } from "../../../lib/strategy";
import { generateAnomalySignals, DEFAULT_ANOMALY } from "../../../lib/anomaly";
import { runBacktest } from "../../../lib/backtest";
import {
  fetchSentiment,
  scoreSentimentAgainstSignal,
} from "../../../lib/sentiment";
import { SUPPORTED_SYMBOLS, isSupportedSymbol } from "../../../lib/symbols";
import type { AnalyzeResponse } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_SYMBOLS: string[] = [...SUPPORTED_SYMBOLS];

export async function GET() {
  return NextResponse.json({
    usage: "POST /api/analyze with JSON body { symbol, granularity, limit }",
    example: { symbol: "BTCUSDT", granularity: "1day", limit: 300 },
    validSymbols: ALLOWED_SYMBOLS,
    validGranularities: VALID_GRANULARITIES,
    note: "数据来自 Bitget 公开现货行情，仅用于研究/教育，非投资建议。",
  });
}

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const symbol = String(body.symbol || "BTCUSDT").toUpperCase();
    const granularity = String(body.granularity || "1day");
    const strategy = String(body.strategy || "wyckoff").toLowerCase();
    let limit = Number(body.limit ?? 300);

    if (!isSupportedSymbol(symbol)) {
      return NextResponse.json(
        { error: `不支持的币种：${symbol}，可选 ${ALLOWED_SYMBOLS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!VALID_GRANULARITIES.includes(granularity as any)) {
      return NextResponse.json(
        { error: `不支持的周期：${granularity}` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(limit) || limit < 50) limit = 300;
    if (limit > 300) limit = 300;

    const candles = await fetchCandles(symbol, granularity, limit);
    if (candles.length < 60) {
      return NextResponse.json(
        { error: "K线数据不足，无法进行威科夫分析（需至少 60 根）。" },
        { status: 422 }
      );
    }

    // 威科夫阶段始终计算（A档也用它做背景阶段展示），但信号来源按所选策略分流：
    // - wyckoff：结构驱动（Spring/SOS/UTAD...）
    // - anomaly（A档）：多因子异动打分驱动
    const wyckoff = analyzeWyckoff(candles, granularity);

    let signals;
    let anomalyAlerts = null;
    if (strategy === "anomaly") {
      const res = generateAnomalySignals(
        candles,
        granularity,
        DEFAULT_ANOMALY,
        DEFAULT_RISK
      );
      signals = res.signals;
      anomalyAlerts = res.latestAlerts;
    } else {
      signals = generateSignals(
        candles,
        wyckoff.structurePoints,
        DEFAULT_RISK,
        granularity
      );
    }
    const backtest = runBacktest(candles, signals, DEFAULT_RISK);

    // Sentiment enhancement layer: pull the CURRENT Bitget contract sentiment
    // snapshot (funding / OI / long-short ratio) and read it against the latest
    // signal. This is snapshot-only — it never touches the historical backtest,
    // so no look-ahead bias is introduced. Fetch is fault-tolerant: if Bitget
    // contract endpoints fail, sentiment is null and the analysis still returns.
    const sentiment = await fetchSentiment(symbol, "1H");
    const sentimentRead = scoreSentimentAgainstSignal(signals, sentiment);

    const payload: AnalyzeResponse & {
      currentPhase: string;
      strategy: string;
      anomalyAlerts: typeof anomalyAlerts;
    } = {
      symbol,
      granularity,
      candles,
      // 阶段背景始终给（两种策略都在威科夫阶段图上展示）；
      // 结构点只在威科夫策略下展示，A档不画威科夫结构点。
      phases: wyckoff.phases,
      structurePoints: strategy === "anomaly" ? [] : wyckoff.structurePoints,
      signals,
      backtest,
      riskConfig: DEFAULT_RISK,
      sentiment,
      sentimentRead,
      currentPhase: wyckoff.currentPhase,
      strategy,
      anomalyAlerts,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    const msg = err?.message || "未知错误";
    return NextResponse.json(
      { error: `分析失败：${msg}` },
      { status: 502 }
    );
  }
}
