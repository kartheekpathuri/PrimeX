import { memo, useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "./types";

type Props = { candles: Candle[]; label: string };

type BarPoint = {
  open: number;
  high: number;
  low: number;
  close: number;
};

function formatLegend(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

function MarketChart({ candles, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastCandleTime = useRef<number | null>(null);
  const latestCandle = useRef<Candle | null>(null);

  const paintLegend = (candle: BarPoint | null) => {
    const node = legendRef.current;
    if (!node) return;
    if (!candle) {
      node.style.visibility = "hidden";
      return;
    }
    node.style.visibility = "visible";
    node.dataset.direction = candle.close >= candle.open ? "up" : "down";
    node.textContent =
      `O ${formatLegend(candle.open)}  H ${formatLegend(candle.high)}  ` +
      `L ${formatLegend(candle.low)}  C ${formatLegend(candle.close)}`;
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0e13" },
        textColor: "#858d9b",
        fontFamily: "Inter, ui-sans-serif, system-ui",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#161b23" },
        horzLines: { color: "#161b23" },
      },
      rightPriceScale: { borderColor: "#202630" },
      timeScale: {
        borderColor: "#202630",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#525d6d", labelBackgroundColor: "#252c36" },
        horzLine: { color: "#525d6d", labelBackgroundColor: "#252c36" },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2ac997",
      downColor: "#f26770",
      borderUpColor: "#2ac997",
      borderDownColor: "#f26770",
      wickUpColor: "#2ac997",
      wickDownColor: "#f26770",
      priceLineVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const volume = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );
    chart.panes()[1].setStretchFactor(0.16);
    volumeRef.current = volume;

    const onCrosshairMove = (param: MouseEventParams) => {
      if (!param.time) {
        paintLegend(latestCandle.current);
        return;
      }
      const bar = param.seriesData.get(series) as BarPoint | undefined;
      paintLegend(bar ?? latestCandle.current);
    };
    chart.subscribeCrosshairMove(onCrosshairMove);
    paintLegend(latestCandle.current);

    const resize = new ResizeObserver(() => {
      chart.applyOptions({
        width: host.clientWidth,
        height: host.clientHeight,
      });
    });
    resize.observe(host);

    return () => {
      resize.disconnect();
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const volume = volumeRef.current;
    if (!series || candles.length === 0) return;

    if (lastCandleTime.current === null) {
      series.setData(candles.map(toBar));
      volume?.setData(candles.map(toVolumeBar));
      chartRef.current?.timeScale().fitContent();
    } else {
      for (const candle of candles) {
        if (candle.openTime >= lastCandleTime.current) {
          series.update(toBar(candle));
          volume?.update(toVolumeBar(candle));
        }
      }
    }
    lastCandleTime.current = candles[candles.length - 1].openTime;
    latestCandle.current = candles[candles.length - 1];
    paintLegend(latestCandle.current);
  }, [candles]);

  return (
    <div className="chart-host" ref={hostRef} aria-label={label}>
      <div className="ohlc-legend" ref={legendRef} />
    </div>
  );
}

function toBar(candle: Candle) {
  return {
    time: Math.floor(candle.openTime / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function toVolumeBar(candle: Candle) {
  return {
    time: Math.floor(candle.openTime / 1000) as UTCTimestamp,
    value: candle.volume,
    color: candle.close >= candle.open ? "#2ac99766" : "#f2677066",
  };
}

export default memo(MarketChart);
