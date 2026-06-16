# Bitget Wyckoff Trading Agent

A working MVP for the Bitget Hackathon: an AI-assisted trading agent workspace that turns market discovery, signal generation, risk control, paper trading, backtesting, and review into one repeatable workflow.

## Live Demo

- Public demo: http://56.155.138.109/quant
- Runtime records: [`logs/`](./logs/)

The demo is public and does not require login.

## What It Does

The project scans market signals such as open interest, trading volume, price movement, funding rate, and active buy/sell pressure. It combines these signals with Wyckoff structure, dual moving-average trend logic, and options-arbitrage logic to generate trading candidates and paper-trading records.

The goal is not to show a static trading page, but to provide a reproducible agent workflow:

1. Discover abnormal market opportunities.
2. Generate long/short candidates.
3. Apply fixed risk rules, stops, take-profit, or trailing exits.
4. Record paper-trading positions and closed trades.
5. Display equity curve, PnL, K-line replay, and strategy performance.

## Strategy Cards

- **A档 · 异动扫描（Bitget）**: market anomaly scanner using exchange market data and fixed risk rules.
- **A档 · 异动扫描（OKX）**: same strategy logic on OKX data for side-by-side comparison.
- **A档 · 趋势版（OKX 多单追踪）**: keeps short exits fast while allowing long positions to run with trailing exits.
- **B档 · 双均线（OKX 4H）**: EMA trend strategy validated with historical K-line backtesting.
- **C档 · 期权套利模拟盘（Deribit）**: scans Box Spread / Put-Call Parity opportunities and records paper arbitrage outcomes.

## Repository Structure

```text
frontend/   Next.js dashboard for strategy cards, paper trading, charts, and radar views
backend/    Node.js strategy engine, market adapters, paper trading state, backtest scripts
logs/       Live demo snapshots and paper-trading records for review
docs/       Demo notes and submission materials
```

## Run Locally

Backend requires Node.js 24+ because it uses built-in SQLite.

```bash
cd backend
npm install
npm run start
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Hackathon Review Notes

- The public demo is deployed and can be reviewed without login.
- Paper-trading logs and runtime snapshots are included under [`logs/`](./logs/).
- No real exchange trading permission is required for the demo.
- The current implementation is designed for research, simulation, and transparent strategy comparison before any real-money deployment.
