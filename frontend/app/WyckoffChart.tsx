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
import type { Candle, PhaseSegment, StructurePoint } from "../lib/types";

interface Props {
  candles: Candle[];
  phases: PhaseSegment[];
  structurePoints: StructurePoint[];
}

const PHASE_BG: Record<string, string> = {
  Accumulation: "rgba(46, 125, 90, 0.10)",
  Markup: "rgba(31, 111, 235, 0.10)",
  Distribution: "rgba(201, 138, 30, 0.12)",
  Markdown: "rgba(201, 58, 58, 0.10)",
  Undefined: "rgba(120, 130, 150, 0.04)",
};

const STRUCTURE_STYLE: Record<
  string,
  { color: string; position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown" | "circle"; text: string }
> = {
  Spring: { color: "#2e7d5a", position: "belowBar", shape: "arrowUp", text: "Spring" },
  SOS: { color: "#1f6feb", position: "belowBar", shape: "arrowUp", text: "SOS" },
  LPS: { color: "#0c8d6a", position: "belowBar", shape: "circle", text: "LPS" },
  UTAD: { color: "#c93a3a", position: "aboveBar", shape: "arrowDown", text: "UTAD" },
  SOW: { color: "#b03030", position: "aboveBar", shape: "arrowDown", text: "SOW" },
};

export default function WyckoffChart({ candles, phases, structurePoints }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const chart = createChart(containerRef.current, {
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
      timeScale: { borderColor: "#e2e7f0", timeVisible: false },
      width: containerRef.current.clientWidth,
      height: 380,
    });
    chartRef.current = chart;

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

    // Phase background bands as area between price extremes is complex; instead use
    // setMarkers for structures and vertical phase shading via series price lines is limited.
    // We render phase bands using the chart's "watermark"-style background via separate
    // baseline areas is not supported; so we draw phase boundaries with markers + legend.

    const markers: SeriesMarker<Time>[] = structurePoints
      .filter((p) => candles[p.index])
      .map((p) => {
        const st = STRUCTURE_STYLE[p.type];
        return {
          time: candles[p.index].time as Time,
          position: st.position,
          color: st.color,
          shape: st.shape,
          text: st.text,
        };
      });
    series.setMarkers(markers);

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
      chartRef.current = null;
    };
  }, [candles, phases, structurePoints]);

  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart-canvas" />
      <div className="phase-strip">
        {phases.map((p, idx) => {
          const span = p.endIndex - p.startIndex + 1;
          const total = candles.length || 1;
          return (
            <div
              key={idx}
              className="phase-cell"
              title={`${p.phase} · ${span} 根K线`}
              style={{
                flexGrow: span,
                flexBasis: `${(span / total) * 100}%`,
                background: PHASE_BG[p.phase] || PHASE_BG.Undefined,
              }}
            >
              <span className="phase-cell-label">{p.phase}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
