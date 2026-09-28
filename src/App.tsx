import { memo, useEffect, useMemo, useState } from "react";
import MarketChart from "./MarketChart";
import { useMarketData, type FeedStatus } from "./useMarketData";
import type { PriceLevel, Trade } from "./types";

const MARKETS = ["BTC", "ETH", "SOL", "HYPE"];
const INTERVALS = ["1m", "5m", "15m", "1h"];
const VISIBLE_DEPTH = 12;

const STATUS_LABEL: Record<FeedStatus, string> = {
  connecting: "Connecting",
  live: "Connected",
  reconnecting: "Reconnecting",
  error: "Offline",
};

function formatPrice(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}k`;
  return value.toFixed(3);
}

function priceDigits(price: number) {
  return price < 1 ? 4 : 2;
}

function formatSize(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000)
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const text = value.toPrecision(4);
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function storedValue(key: string, options: string[], fallback: string) {
  const saved = localStorage.getItem(key);
  return saved && options.includes(saved) ? saved : fallback;
}

function DepthRows({
  levels,
  side,
  maxTotal,
}: {
  levels: PriceLevel[];
  side: "bid" | "ask";
  maxTotal: number;
}) {
  const rows = [];
  let runningTotal = 0;
  for (const level of levels.slice(0, VISIBLE_DEPTH)) {
    const price = Number(level.price);
    const size = Number(level.size);
    runningTotal += size;
    const fill = Math.max(2, Math.min(100, (runningTotal / maxTotal) * 100));
    rows.push(
      <div className="depth-row" key={level.price}>
        <span className="depth-fill" style={{ width: `${fill}%` }} />
        <span className="price">{formatPrice(price, priceDigits(price))}</span>
        <span>{formatSize(size)}</span>
        <span className="muted">{formatSize(runningTotal)}</span>
      </div>,
    );
  }
  return <div className={`depth-list ${side}`}>{rows}</div>;
}

const OrderBook = memo(function OrderBook({
  levels,
}: {
  levels: [PriceLevel[], PriceLevel[]] | undefined;
}) {
  const bids = levels?.[0] ?? [];
  const asks = levels?.[1] ?? [];

  const maxTotal = Math.max(
    0.0001,
    [bids, asks].reduce(
      (largest, side) =>
        Math.max(
          largest,
          side
            .slice(0, VISIBLE_DEPTH)
            .reduce((total, level) => total + Number(level.size), 0),
        ),
      0,
    ),
  );

  const bestBid = Number(bids[0]?.price);
  const bestAsk = Number(asks[0]?.price);
  const hasQuote = Number.isFinite(bestBid) && Number.isFinite(bestAsk);
  const spread = hasQuote ? bestAsk - bestBid : null;
  const mid = hasQuote ? (bestAsk + bestBid) / 2 : null;

  return (
    <section className="panel orderbook">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Order book</div>
          <div className="panel-sub">
            PRICE <span>SIZE</span>
            <span>TOTAL</span>
          </div>
        </div>
        <span className="live-pill">
          <i /> LIVE
        </span>
      </div>
      <div className="depth-labels">
        <span>PRICE (USD)</span>
        <span>SIZE</span>
        <span>TOTAL</span>
      </div>
      {asks.length ? (
        <DepthRows
          levels={[...asks].reverse()}
          side="ask"
          maxTotal={maxTotal}
        />
      ) : (
        <Empty label="Waiting for asks…" />
      )}
      <div className="spread-line">
        <span className="muted">Spread</span>
        <b>{spread !== null ? formatPrice(spread, 2) : "—"}</b>
        <span className="mid-label">
          Mid {mid !== null ? formatPrice(mid, 2) : "—"}
        </span>
      </div>
      {bids.length ? (
        <DepthRows levels={bids} side="bid" maxTotal={maxTotal} />
      ) : (
        <Empty label="Waiting for bids…" />
      )}
      <div className="book-footer">
        <span>
          <i className="dot ask-dot" /> Asks
        </span>
        <span>
          <i className="dot bid-dot" /> Bids
        </span>
        <span>{VISIBLE_DEPTH * 2} levels</span>
      </div>
    </section>
  );
});

const TradeTape = memo(function TradeTape({ trades }: { trades: Trade[] }) {
  return (
    <section className="panel tape">
      <div className="panel-heading">
        <div>
          <div className="panel-title">Recent trades</div>
          <div className="panel-sub">REAL-TIME EXECUTIONS</div>
        </div>
        <span className="trade-count">{trades.length} / 50</span>
      </div>
      <div className="depth-labels tape-labels">
        <span>SIDE</span>
        <span>PRICE (USD)</span>
        <span>SIZE</span>
        <span>TIME</span>
      </div>
      <div className="trades-list">
        {trades.length === 0 ? (
          <Empty label="Waiting for trades…" />
        ) : (
          trades.map((trade) => {
            const price = Number(trade.price);
            const isBuy = trade.side === "B";
            const toneClass = isBuy ? "bid-text" : "ask-text";
            return (
              <div className="trade-row" key={trade.tradeId}>
                <span className={toneClass}>{isBuy ? "B" : "S"}</span>
                <span className={toneClass}>
                  {formatPrice(price, priceDigits(price))}
                </span>
                <span>{formatSize(Number(trade.size))}</span>
                <span className="muted">
                  {new Date(trade.time).toLocaleTimeString("en-US", {
                    hour12: false,
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
});

function Empty({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <span className="loader" />
      {label}
    </div>
  );
}

export default function App() {
  const [coin, setCoin] = useState(() =>
    storedValue("primex.coin", MARKETS, "BTC"),
  );
  const [interval, setInterval] = useState(() =>
    storedValue("primex.interval", INTERVALS, "1m"),
  );
  const [intervalOpen, setIntervalOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("primex.coin", coin);
  }, [coin]);

  useEffect(() => {
    localStorage.setItem("primex.interval", interval);
  }, [interval]);

  useEffect(() => {
    if (!intervalOpen) return;
    const close = () => setIntervalOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [intervalOpen]);

  const {
    orderBook,
    trades,
    candles,
    midPrices,
    assetContext,
    status,
    stale,
    error,
    reconnect,
  } = useMarketData(coin, interval);

  const midPrice = useMemo(() => {
    const bestAsk = Number(orderBook?.levels[1]?.[0]?.price);
    const bestBid = Number(orderBook?.levels[0]?.[0]?.price);
    if (bestAsk && bestBid) return (bestAsk + bestBid) / 2;
    return Number(midPrices[coin]);
  }, [orderBook, midPrices, coin]);

  const change =
    assetContext?.previousDayPrice && midPrice
      ? (midPrice / assetContext.previousDayPrice - 1) * 100
      : null;

  useEffect(() => {
    document.title = midPrice
      ? `${coin}/USD $${formatPrice(midPrice, priceDigits(midPrice))} — PrimeX`
      : `${coin}/USD — PrimeX`;
  }, [coin, midPrice]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <span>
            hyper<span className="brand-light">liquid</span>
          </span>
          <span className="network-tag">TESTNET</span>
        </div>
        <div className="top-right">
          <span className={`connection ${status}`}>
            <i />
            {STATUS_LABEL[status]}
          </span>
          <span className="top-separator" />
          <span className="top-note">Perpetuals market data</span>
        </div>
      </header>

      <section className="market-bar">
        <div className="market-identity">
          <div className="coin-icon">{coin.slice(0, 1)}</div>
          <div>
            <div className="symbol-line">
              <h1>
                {coin}
                <span className="slash">/</span>USD
              </h1>
              <span className="perp-tag">PERP</span>
            </div>
            <div className="market-name">{coin} Perpetual</div>
          </div>
        </div>
        <div className="market-price">
          <strong>
            {midPrice
              ? `$${formatPrice(midPrice, priceDigits(midPrice))}`
              : "—"}
          </strong>
          <span
            className={
              change === null ? "" : change < 0 ? "negative" : "positive"
            }
          >
            {change === null
              ? "—"
              : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`}{" "}
            <small>24h</small>
          </span>
        </div>
        <div className="market-stat">
          <span>MARK PRICE</span>
          <b>
            {assetContext?.markPrice
              ? `$${formatPrice(assetContext.markPrice, priceDigits(assetContext.markPrice))}`
              : "—"}
          </b>
        </div>
        <div className="market-stat">
          <span>24H VOLUME</span>
          <b>
            {assetContext
              ? `$${formatCompact(assetContext.dayNotionalVolume)}`
              : "—"}
          </b>
        </div>
        <div className="market-stat">
          <span>FUNDING / 8H</span>
          <b
            className={
              assetContext && assetContext.funding >= 0
                ? "positive"
                : "negative"
            }
          >
            {assetContext ? `${(assetContext.funding * 100).toFixed(4)}%` : "—"}
          </b>
        </div>
      </section>

      <section className="selector-row">
        <div className="selector-label">MARKET</div>
        <div className="market-select">
          {MARKETS.map((market) => (
            <button
              key={market}
              className={coin === market ? "selected" : ""}
              onClick={() => setCoin(market)}
            >
              {market}
              <span className="market-select-usd"> / USD</span>
            </button>
          ))}
        </div>
        <div className="selector-spacer" />
        <div className="interval-label">CHART INTERVAL</div>
        <div className="interval-control">
          <button
            className="interval-pill"
            aria-haspopup="listbox"
            aria-expanded={intervalOpen}
            onClick={(event) => {
              event.stopPropagation();
              setIntervalOpen((open) => !open);
            }}
          >
            {interval} <span>⌄</span>
          </button>
          {intervalOpen && (
            <div
              className="interval-menu"
              role="listbox"
              aria-label="Chart interval"
            >
              {INTERVALS.map((option) => (
                <button
                  key={option}
                  role="option"
                  aria-selected={interval === option}
                  className={interval === option ? "active" : ""}
                  onClick={() => {
                    setInterval(option);
                    setIntervalOpen(false);
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={`feed-label ${status}${stale ? " stale" : ""}`}>
          <i />
          {status === "live"
            ? stale
              ? "Feed stale"
              : "Live feed"
            : status === "error"
              ? "Feed unavailable"
              : "Syncing feed"}
        </div>
      </section>

      {(error || stale) && (
        <div className="notice">
          <span>{error ?? "Market feed has gone quiet."}</span>
          <button onClick={reconnect}>Retry connection ↗</button>
        </div>
      )}

      <div className="workspace">
        <section className="panel chart-panel">
          <div className="panel-heading chart-heading">
            <div>
              <div className="panel-title">
                Price chart <span className="interval-chip">{interval}</span>
              </div>
              <div className="panel-sub">
                {coin}/USD · {interval.toUpperCase()} · TESTNET
              </div>
            </div>
            <div className="chart-legend">
              <span>
                <i className="dot bid-dot" /> Bullish
              </span>
              <span>
                <i className="dot ask-dot" /> Bearish
              </span>
            </div>
          </div>
          <MarketChart
            key={`${coin}-${interval}`}
            candles={candles}
            label={`${coin}/USD ${interval} candlestick chart`}
          />
          {!candles.length && (
            <div className="chart-empty">
              <Empty label="Loading candle history…" />
            </div>
          )}
        </section>
        <OrderBook levels={orderBook?.levels} />
        <TradeTape trades={trades} />
      </div>

      <footer>
        <span>HYPERLIQUID TESTNET</span>
        <span>Market data provided by Hyperliquid · For testing only</span>
        <span className="footer-meta">
          <span>BUILT BY KARTHEEK PATHURI</span>
          <span>
            WS{" "}
            <b className={status === "live" ? "positive" : ""}>
              {status.toUpperCase()}
            </b>
          </span>
        </span>
      </footer>
    </main>
  );
}
