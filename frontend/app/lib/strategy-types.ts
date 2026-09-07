export type StrategyKey = "anomaly-binance" | "dualma4h-binance" | "box-breakout30m-binance";

export type StrategySummary = {
  key: string;
  name: string;
  desc: string;
  source: string;
  kind: string;
  paper: Record<string, number | string | boolean>;
  summary: {
    equity: number;
    totalReturnPct: number;
    avgDailyPnl: number;
    winRate: number;
    tradeCount: number;
    openCount: number;
  };
  latestScan?: Scan | null;
};

export type AnomalyFactors = {
  oi: number;
  activeBuy: number;
  price: number;
  volume: number;
  funding: number;
};

export type Candidate = {
  symbol: string;
  direction: "long" | "short";
  score: number;
  tag: string;
  lastPrice: number;
  factors?: AnomalyFactors;
  oiUsd?: number;
  oiChangePct?: number | null;
  change24hPct?: number;
  fundingRate?: number;
  volumeUsd?: number;
  bidAskImbalance?: number;
  fastEma?: number;
  slowEma?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signal?: "golden" | "death";
  signalCandleTime?: number | null;
  volumeRank?: number;
  granularity?: string;
  reason?: string;
  signalClose?: number;
  boxHigh?: number;
  boxLow?: number;
  boxWidthPct?: number;
  breakoutPct?: number;
  breakoutCandleTime?: number | null;
  breakoutVolume?: number;
  boxAverageVolume?: number;
  volumeRatio?: number;
};

export type Scan = {
  strategy: string;
  source: string;
  hits: Candidate[];
  allCandidates?: Candidate[];
  coverage?: {
    scannedCount: number;
    oiAvailableCount: number;
    oiEligibleCount: number;
    scoredCount: number;
    thresholdCount: number;
    signalCount: number;
    missingOiCount: number;
  };
  topCount?: number;
  scannedCount: number;
  candidateCount: number;
  openedCount: number;
  closedCount?: number;
  scannedAt: string | null;
};

export type Position = {
  id: number;
  symbol: string;
  direction: "long" | "short";
  tag: string;
  score: number;
  entry_price: number;
  stop_price: number;
  target_price: number;
  margin: number;
  leverage: number;
  status: "open" | "closed";
  open_time: number;
  open_reason?: string;
  exit_price?: number;
  exit_time?: number;
  exit_reason?: string;
  pnl_usd?: number;
  pnl_pct?: number;
  currentPrice?: number;
  floatPnlUsd?: number;
  floatPnlPct?: number;
};

export type StrategyState = {
  strategy: StrategyKey;
  source: string;
  scanStatus?: "starting" | "scanning" | "idle";
  scanStartedAt?: string | null;
  stats: Record<string, number>;
  positions: Position[];
  recentClosed: Position[];
  latestScan: Scan | null;
  config: { paper: Record<string, number | string | boolean>; scanIntervalSec: number };
};

export type EquityPoint = { ts: number; equity: number; cash: number; open_count: number };

export type AgentRun = {
  run_id: string;
  strategy: string;
  intent: string;
  started_at: number;
  completed_at: number;
  scanned_count: number;
  candidate_count: number;
  plan_count: number;
  status: string;
  broadcast: boolean;
  events?: Array<{ id: number; run_id: string; phase: string; detail: string; status: string; demo: boolean; ts: number }>;
};

export type Kline = { time: number; open: number; high: number; low: number; close: number; volume?: number; quoteVolume?: number };
