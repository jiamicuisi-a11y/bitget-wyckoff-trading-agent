"""Bitget A-tier anomaly scanner GetAgent Playbook."""

import math
from typing import Any

from getagent import data, runtime


WEIGHTS = {"oi": 0.30, "active_buy": 0.25, "price": 0.20, "volume": 0.15, "funding": 0.10}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _last_row(rows: Any) -> dict[str, Any]:
    if isinstance(rows, list) and rows:
        item = rows[-1]
        return item if isinstance(item, dict) else {}
    if isinstance(rows, dict):
        return rows
    return {}


def _factor_oi(change_pct: float | None) -> float:
    if change_pct is None:
        return 0.0
    return min(abs(change_pct) * 20.0, 100.0)


def _factor_active_buy(imbalance: float) -> float:
    return min(abs(imbalance) * 100.0, 100.0)


def _factor_price(change_pct: float) -> float:
    return min(abs(change_pct) * 4.0, 100.0)


def _factor_volume(volume_usd: float) -> float:
    if volume_usd <= 10000:
        return 0.0
    return min(max(((math.log10(volume_usd) - 4.0) / 5.0) * 100.0, 0.0), 100.0)


def _factor_funding(funding_rate: float) -> float:
    abs_pct = abs(funding_rate) * 100.0
    if abs_pct < 0.05:
        return 0.0
    return min(((abs_pct - 0.05) / 0.25) * 100.0, 100.0)


def _classify(oi_change_pct: float | None, change_pct: float, imbalance: float) -> tuple[str, str]:
    oi_up = oi_change_pct is not None and oi_change_pct > 0.5
    price_up = change_pct > 0
    buy_pressure = imbalance > 0.1
    sell_pressure = imbalance < -0.1
    if oi_up and price_up and buy_pressure:
        return "long", "bullish confluence"
    if oi_up and (price_up or buy_pressure):
        return "long", "large-player leading long"
    if buy_pressure and price_up:
        return "long", "active-buy leading long"
    if oi_up and (not price_up) and sell_pressure:
        return "short", "large-player leading short"
    if sell_pressure and (not price_up):
        return "short", "active-sell leading short"
    if price_up and buy_pressure:
        return "long", "active-buy leading long"
    if (not price_up) and sell_pressure:
        return "short", "active-sell leading short"
    return "watch", "mixed conditions"


def _score(factors: dict[str, float]) -> int:
    value = sum(factors[key] * weight for key, weight in WEIGHTS.items())
    return int(round(min(value, 100.0)))


def _ticker(symbol: str, exchange: str) -> dict[str, Any]:
    return _last_row(data.crypto.futures.ticker(symbol=symbol, exchange=exchange, include_market_data=True))


def _funding(symbol: str, exchange: str) -> float:
    row = _last_row(data.crypto.futures.funding_rate(symbol=symbol.replace("USDT", ""), exchange=exchange, interval="4h", limit=3))
    return _num(row.get("funding_rate") or row.get("fr_close") or row.get("rate"))


def _oi_change(symbol: str, exchange: str) -> float | None:
    rows = data.crypto.futures.open_interest(symbol=symbol, exchange=exchange, interval="1h", unit="usd", limit=4, days=1)
    if not isinstance(rows, list) or len(rows) < 2:
        return None
    prev = _num(rows[-2].get("oi_close") or rows[-2].get("close_value") or rows[-2].get("open_interest"))
    cur = _num(rows[-1].get("oi_close") or rows[-1].get("close_value") or rows[-1].get("open_interest"))
    if prev <= 0 or cur <= 0:
        return None
    return ((cur - prev) / prev) * 100.0


def _flow_imbalance(symbol: str, exchange: str) -> float:
    rows = data.crypto.futures.taker_volume(symbol=symbol, exchange=exchange, period="1h", limit=3)
    row = _last_row(rows)
    buy = _num(row.get("buy_vol"))
    sell = _num(row.get("sell_vol"))
    if buy + sell <= 0:
        return 0.0
    return (buy - sell) / (buy + sell)


def _candidate(symbol: str, exchange: str) -> dict[str, Any] | None:
    ticker = _ticker(symbol, exchange)
    last_price = _num(ticker.get("last") or ticker.get("price") or ticker.get("last_price"))
    if last_price <= 0:
        return None
    change_pct = _num(ticker.get("change_percent") or ticker.get("price_percentage_change_24h"))
    volume_usd = _num(ticker.get("quote_volume") or ticker.get("volume_24h") or ticker.get("converted_volume_usd"))
    funding_rate = _funding(symbol, exchange)
    oi_change_pct = _oi_change(symbol, exchange)
    imbalance = _flow_imbalance(symbol, exchange)
    factors = {
        "oi": _factor_oi(oi_change_pct),
        "active_buy": _factor_active_buy(imbalance),
        "price": _factor_price(change_pct),
        "volume": _factor_volume(volume_usd),
        "funding": _factor_funding(funding_rate),
    }
    score = _score(factors)
    action, tag = _classify(oi_change_pct, change_pct, imbalance)
    return {
        "symbol": symbol,
        "action": action,
        "tag": tag,
        "score": score,
        "last_price": last_price,
        "change_pct": round(change_pct, 4),
        "volume_usd": round(volume_usd, 2),
        "funding_rate": funding_rate,
        "oi_change_pct": None if oi_change_pct is None else round(oi_change_pct, 4),
        "flow_imbalance": round(imbalance, 4),
        "factors": {key: round(value, 2) for key, value in factors.items()},
    }


def run() -> None:
    cfg = runtime.manifest.get("strategy_config", {}) or {}
    symbols = list(cfg.get("trading_symbols") or runtime.manifest.get("trading_symbols") or ["BTCUSDT"])
    exchange = str(cfg.get("exchange", "bitget"))
    min_score = int(cfg.get("min_score", 48) or 48)
    max_candidates = int(cfg.get("max_candidates", 5) or 5)
    stop_pct = _num(cfg.get("stop_pct"), 3.0)
    target_r = _num(cfg.get("target_r"), 2.0)

    candidates: list[dict[str, Any]] = []
    errors: list[str] = []
    for symbol in symbols:
        try:
            item = _candidate(symbol, exchange)
        except Exception as exc:  # managed sandbox data can reject individual pairs
            errors.append(f"{symbol}: {type(exc).__name__}")
            continue
        if item is not None:
            candidates.append(item)

    ranked = sorted(candidates, key=lambda item: item["score"], reverse=True)
    actionable = [item for item in ranked if item["score"] >= min_score and item["action"] in {"long", "short"}]
    best = actionable[0] if actionable else (ranked[0] if ranked else None)

    if not best:
        runtime.emit_signal(
            action="watch",
            symbol=symbols[0] if symbols else "BTCUSDT",
            confidence=0.0,
            metrics={"scanned": len(symbols), "candidate_count": 0, "error_count": len(errors)},
            meta={"reason": "no usable market data", "errors": errors[:5]},
        )
        return

    action = best["action"] if best in actionable else "watch"
    entry = best["last_price"]
    if action == "long":
        stop = entry * (1.0 - stop_pct / 100.0)
        target = entry * (1.0 + (stop_pct * target_r) / 100.0)
    elif action == "short":
        stop = entry * (1.0 + stop_pct / 100.0)
        target = entry * (1.0 - (stop_pct * target_r) / 100.0)
    else:
        stop = None
        target = None

    runtime.emit_signal(
        action=action,
        symbol=best["symbol"],
        confidence=min(max(best["score"] / 100.0, 0.0), 1.0),
        metrics={
            "score": best["score"],
            "scanned": len(symbols),
            "candidate_count": len(ranked),
            "actionable_count": len(actionable),
            "entry_reference": round(entry, 8),
            "stop_reference": None if stop is None else round(stop, 8),
            "target_reference": None if target is None else round(target, 8),
            "error_count": len(errors),
        },
        meta={
            "tag": best["tag"],
            "exchange": exchange,
            "top_candidates": ranked[:max_candidates],
            "risk_model": "fixed stop, fixed R target, signal-only output",
            "errors": errors[:5],
        },
    )


if __name__ == "__main__":
    run()
