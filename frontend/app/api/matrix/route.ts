import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Legacy endpoint retained for old links; the Track A console uses the paper worker. */
export async function GET() {
  return NextResponse.json({
    rows: [],
    available: false,
    message: "旧版回测矩阵模块未随恢复副本提供；当前请使用 Agent OS 策略控制台。",
  }, { status: 410 });
}
