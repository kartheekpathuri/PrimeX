import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssetContext,
  Book,
  Candle,
  PriceLevel,
  Trade,
  WsMessage,
} from "./types";

type WirePriceLevel = { px: string; sz: string; n: number };

type WireOrderBook = {
  coin: string;
  levels: [WirePriceLevel[], WirePriceLevel[]];
  time: number;
};

type WireTrade = {
  coin: string;
  side: string;
  px: string;
  sz: string;
  hash: string;
  time: number;
  tid: number;
};

type WireCandle = {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
};

type WireAssetContext = {
  markPx: string;
  prevDayPx: string;
  dayNtlVlm: string;
  funding: string;
};

const WS_URL = "wss://api.hyperliquid-testnet.xyz/ws";
const INFO_URL = "https://api.hyperliquid-testnet.xyz/info";

const MAX_TRADES = 50;
const FLUSH_EVERY_MS = 50;
const RETRY_CAP_MS = 15_000;
const STALE_AFTER_MS = 10_000;
const CANDLE_HISTORY = 120;
const CANDLE_LIMIT = 180;

export type FeedStatus = "connecting" | "live" | "reconnecting" | "error";

type MarketState = {
  orderBook: Book | null;
  trades: Trade[];
  candles: Candle[];
  midPrices: Record<string, string>;
  assetContext: AssetContext | null;
  status: FeedStatus;
  stale: boolean;
  error: string | null;
};

const initialState: MarketState = {
  orderBook: null,
  trades: [],
  candles: [],
  midPrices: {},
  assetContext: null,
  status: "connecting",
  stale: false,
  error: null,
};

async function postInfo<T>(body: object): Promise<T> {
  const response = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Market data request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function toPriceLevel(level: WirePriceLevel): PriceLevel {
  const { px: price, sz: size, n: orderCount } = level;
  return { price, size, orderCount };
}

export function toOrderBook(book: WireOrderBook): Book {
  const { coin: symbol, levels, time } = book;
  return {
    symbol,
    levels: [levels[0].map(toPriceLevel), levels[1].map(toPriceLevel)],
    time,
  };
}

export function toTrade(trade: WireTrade): Trade {
  const {
    coin: symbol,
    side,
    px: price,
    sz: size,
    hash,
    time,
    tid: tradeId,
  } = trade;
  return { symbol, side, price, size, hash, time, tradeId };
}

export function toCandle(candle: WireCandle): Candle {
  const {
    t: openTime,
    T: closeTime,
    s: symbol,
    i: interval,
    o: open,
    h: high,
    l: low,
    c: close,
    v: volume,
    n: tradeCount,
  } = candle;
  return {
    openTime,
    closeTime,
    symbol,
    interval,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    tradeCount,
  };
}

export function toAssetContext(context: WireAssetContext): AssetContext {
  const {
    markPx: markPrice,
    prevDayPx: previousDayPrice,
    dayNtlVlm: dayNotionalVolume,
    funding,
  } = context;
  return {
    markPrice: Number(markPrice),
    previousDayPrice: Number(previousDayPrice),
    dayNotionalVolume: Number(dayNotionalVolume),
    funding: Number(funding),
  };
}

export function useMarketData(coin: string, interval: string) {
  const [state, setState] = useState<MarketState>(initialState);
  const [retrySignal, setRetrySignal] = useState(0);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let retry = 0;
    let retryTimer: number | undefined;
    let flushTimer = 0;
    let lastFrameAt = 0;
    let activeSocket: WebSocket | null = null;

    let pending = freshBatch();

    function applyPending() {
      flushTimer = 0;
      const { orderBook, trades, candles, midPrices, assetContext } = pending;
      pending = freshBatch();
      if (!alive) return;
      if (orderBook || trades.length || candles.length)
        lastFrameAt = Date.now();
      setState((prev) => {
        const next = { ...prev };
        if (orderBook) next.orderBook = orderBook;
        if (midPrices) next.midPrices = { ...prev.midPrices, ...midPrices };
        if (assetContext) next.assetContext = assetContext;
        if (trades.length) {
          next.trades = [...trades, ...prev.trades].slice(0, MAX_TRADES);
        }
        if (candles.length) {
          next.candles = mergeCandles(prev.candles, candles);
        }
        return next;
      });
    }

    function flushSoon() {
      if (!flushTimer)
        flushTimer = window.setTimeout(applyPending, FLUSH_EVERY_MS);
    }

    function scheduleRetry() {
      const wait = Math.min(1000 * 2 ** retry++, RETRY_CAP_MS);
      retryTimer = window.setTimeout(connect, wait);
    }

    const staleTimer = window.setInterval(() => {
      if (!alive) return;
      setState((prev) => {
        const stale =
          prev.status === "live" &&
          lastFrameAt > 0 &&
          Date.now() - lastFrameAt > STALE_AFTER_MS;
        return prev.stale === stale ? prev : { ...prev, stale };
      });
    }, 5_000);

    async function connect() {
      try {
        const [meta, history] = await Promise.all([
          postInfo<{ universe: { name: string }[] }>({ type: "meta" }),
          postInfo<WireCandle[]>({
            type: "candleSnapshot",
            req: {
              coin,
              interval,
              startTime: Date.now() - CANDLE_HISTORY * intervalMillis(interval),
              endTime: Date.now(),
            },
          }),
        ]);
        if (!alive) return;

        const symbols = meta.universe.map((asset) => asset.name);
        if (!symbols.includes(coin)) {
          throw new Error(`${coin} is not available on testnet`);
        }

        setState((prev) => ({
          ...prev,
          candles: history.map(toCandle).slice(-CANDLE_HISTORY),
          error: null,
        }));

        const websocket = new WebSocket(WS_URL);
        activeSocket = websocket;
        socket.current = websocket;

        websocket.onopen = () => {
          if (!alive) return;
          retry = 0;
          lastFrameAt = Date.now();
          setState((prev) => ({ ...prev, status: "live", error: null }));
          const subscriptions = [
            { type: "l2Book", coin },
            { type: "trades", coin },
            { type: "candle", coin, interval },
            { type: "allMids" },
            { type: "activeAssetCtx", coin },
          ];
          for (const subscription of subscriptions) {
            websocket.send(
              JSON.stringify({ method: "subscribe", subscription }),
            );
          }
        };

        websocket.onmessage = (event) => {
          let message: WsMessage;
          try {
            message = JSON.parse(event.data) as WsMessage;
          } catch {
            return;
          }
          if (message.channel === "l2Book") {
            pending.orderBook = toOrderBook(message.data as WireOrderBook);
          } else if (message.channel === "trades") {
            const trades = (message.data as WireTrade[]).map(toTrade);
            pending.trades.push(...trades);
          } else if (message.channel === "candle") {
            const payload = message.data as WireCandle | WireCandle[];
            const candles = (Array.isArray(payload) ? payload : [payload]).map(
              toCandle,
            );
            pending.candles.push(...candles);
          } else if (message.channel === "allMids") {
            pending.midPrices = (
              message.data as { mids: Record<string, string> }
            ).mids;
          } else if (message.channel === "activeAssetCtx") {
            pending.assetContext = toAssetContext(
              (message.data as { ctx: WireAssetContext }).ctx,
            );
          } else {
            return;
          }
          flushSoon();
        };

        websocket.onerror = () => {
          if (!alive) return;
          setState((prev) => ({
            ...prev,
            error: "WebSocket connection interrupted.",
          }));
        };

        websocket.onclose = () => {
          if (!alive) return;
          setState((prev) => ({ ...prev, status: "reconnecting" }));
          scheduleRetry();
        };
      } catch (error) {
        if (!alive) return;
        const message =
          error instanceof Error
            ? error.message
            : "Unable to load market data.";
        setState((prev) => ({ ...prev, status: "error", error: message }));
        scheduleRetry();
      }
    }

    setState((prev) => ({
      ...prev,
      orderBook: null,
      trades: [],
      candles: [],
      assetContext: null,
      status: "connecting",
      stale: false,
      error: null,
    }));
    void connect();

    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
      window.clearTimeout(flushTimer);
      window.clearInterval(staleTimer);
      activeSocket?.close();
      if (socket.current === activeSocket) socket.current = null;
    };
  }, [coin, interval, retrySignal]);

  const reconnect = useCallback(() => {
    setRetrySignal((signal) => signal + 1);
  }, []);

  return { ...state, reconnect };
}

function freshBatch() {
  return {
    orderBook: null as Book | null,
    trades: [] as Trade[],
    candles: [] as Candle[],
    midPrices: null as Record<string, string> | null,
    assetContext: null as AssetContext | null,
  };
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function intervalMillis(interval: string) {
  const amount = Number(interval.slice(0, -1));
  switch (interval.slice(-1)) {
    case "h":
      return amount * HOUR;
    case "d":
      return amount * DAY;
    default:
      return amount * MINUTE;
  }
}

export function mergeCandles(existing: Candle[], incoming: Candle[]) {
  const candlesByTime = new Map(
    existing.map((candle) => [candle.openTime, candle]),
  );
  for (const candle of incoming) candlesByTime.set(candle.openTime, candle);
  return [...candlesByTime.values()]
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-CANDLE_LIMIT);
}
