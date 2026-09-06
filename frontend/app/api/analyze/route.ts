import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Legacy compatibility endpoint.
 * The new Track A console reads the paper worker directly through /api/paper.
 * The recovered repository did not contain the old /lib analysis modules, so
 * this endpoint stays explicit instead of silently returning fabricated data.
 */
export async function GET() {
  return NextResponse.json({
    available: false,
    message: "威科夫分析旧模块未随恢复副本提供；请使用 Agent OS 策略控制台。",
  }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({
    error: "旧版分析接口不可用。当前参赛版使用 /api/paper 读取 Binance Paper 策略。",
  }, { status: 410 });
}
