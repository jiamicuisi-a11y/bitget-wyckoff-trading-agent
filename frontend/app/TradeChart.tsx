"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";

export interface KCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 一笔交易在图上的标注信息（入场/止损/止盈 + 开平仓时间点）。 */
export interface TradeOverlay {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  openTime?: number; // unix sec
  exitTime?: number; // unix sec
  exitPrice?: number;
}

interface Props {
  candles: KCandle[];
  trade?: TradeOverlay | null;
  height?: number;
}

/**
 * 通用交易 K 线图：画蜡烛 + 入场/止损/止盈三条价格线，并在开/平仓位置打标记。
 * 用于任意策略的持仓/平仓可视化（点某个标的就看它的入场与止盈止损相对价格的位置）。
 */
export default function TradeChart({ candles, trade, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const chart: IChartApi = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#5a6478",
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#eef1f6" },
        horzLines: { color: "#eef1f6" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#e2e7f0" },
      timeScale: { borderColor: "#e2e7f0", timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height,
    });

    const series: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor: "#2e9e6b",
      downColor: "#d05656",
      borderUpColor: "#2e9e6b",
      borderDownColor: "#d05656",
      wickUpColor: "#69b894",
      wickDownColor: "#cf8585",
    });

    const data: CandlestickData[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);

    if (trade) {
      // 入场/止损/止盈三条价格线
      series.createPriceLine({
        price: trade.entry,
        color: "#1f6feb",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "入场",
      });
      series.createPriceLine({
        price: trade.stop,
        color: "#c0392b",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "止损",
      });
      series.createPriceLine({
        price: trade.target,
        color: "#138a5e",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "止盈",
      });

      // 开/平仓时间点标记
      const markers: SeriesMarker<Time>[] = [];
      if (trade.openTime) {
        markers.push({
          time: trade.openTime as Time,
          position: trade.direction === "long" ? "belowBar" : "aboveBar",
          color: "#1f6feb",
          shape: trade.direction === "long" ? "arrowUp" : "arrowDown",
          text: "开仓",
        });
      }
      if (trade.exitTime) {
        markers.push({
          time: trade.exitTime as Time,
          position: trade.direction === "long" ? "aboveBar" : "belowBar",
          color: "#8a93a6",
          shape: "circle",
          text: "平仓",
        });
      }
      if (markers.length) series.setMarkers(markers);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [candles, trade, height]);

  return <div ref={containerRef} style={{ width: "100%" }} />;
}
