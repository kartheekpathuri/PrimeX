# Hyperliquid Testnet Terminal

A compact, read-only perpetuals market terminal for Hyperliquid testnet, built
with React and TypeScript. Covers BTC, ETH, SOL and HYPE with a live depth
book, recent trades and a candlestick chart with selectable intervals
(1m / 5m / 15m / 1h).

## Run locally

```bash
npm install && npm run dev
```

Open the local URL printed by Vite. Market data is read from
`https://api.hyperliquid-testnet.xyz/info` and
`wss://api.hyperliquid-testnet.xyz/ws`; no wallet or API key is needed.

## How it works

- `src/useMarketData.ts` owns the feed lifecycle. It pulls perpetual metadata
  and a 120-candle snapshot over REST, then opens a single WebSocket for the
  selected market and interval.
- The socket subscribes to `l2Book`, `trades`, `candle`, `allMids` and
  `activeAssetCtx`. A dropped connection reconnects with capped exponential
  backoff; switching markets or intervals tears down the old socket and its
  timers first.
- Incoming frames are staged and flushed to state on a 50 ms timer, so the
  book doesn't rerender on every tick. Trade history is capped at 50; candles
  are merged by open time and capped at 180; each book snapshot replaces the
  previous one atomically.
- The chart, book and tape are memoized separately, so book-only frames don't
  rerender the tape or chart. Book depth bars use cumulative size. The chart
  uses Lightweight Charts with a `ResizeObserver`, so resizing never recreates
  it; volume renders in a second pane and an OHLC legend follows the crosshair.
- If no book, trade or candle frame arrives for 10 seconds after the socket
  connects, the feed is flagged stale with a one-click resync. The resync
  button forces a fresh connection even when the socket never opened.
  Switching markets or intervals clears the previous market's panels first,
  so stale BTC data never renders under an ETH label while the new snapshot
  loads.
- The last-viewed market and interval persist across reloads via localStorage.

## Libraries

- React + TypeScript for the view and the typed feed models.
- Vite for the dev server and production bundling.
- TradingView Lightweight Charts for the candlestick chart.
- Vitest for the wire-format and candle-merge unit tests (`npm test`).

## Next steps

- Add a fallback REST refresh for mark, volume and funding if the asset context
  stream goes stale.
- Add transport-level tests with a mocked WebSocket covering subscribe,
  reconnect and resubscribe.
- Profile under sustained message load; move normalization and batching into a
  worker if React state work becomes the bottleneck.
- Sketch a paper-trading ticket against the live book as the next feature
  slice.
