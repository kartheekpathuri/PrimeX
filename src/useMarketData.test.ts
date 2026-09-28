import { describe, expect, it } from "vitest";
import {
  mergeCandles,
  toAssetContext,
  toCandle,
  toOrderBook,
  toTrade,
} from "./useMarketData";
import type { Candle } from "./types";

function makeCandle(openTime: number, close = 100): Candle {
  return {
    openTime,
    closeTime: openTime + 60_000,
    symbol: "BTC",
    interval: "1m",
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 10,
    tradeCount: 5,
  };
}

describe("toOrderBook", () => {
  it("translates wire keys into full names on both sides", () => {
    const book = toOrderBook({
      coin: "BTC",
      levels: [
        [{ px: "67000.5", sz: "1.25", n: 3 }],
        [{ px: "67001", sz: "0.5", n: 1 }],
      ],
      time: 1727450000000,
    });

    expect(book).toEqual({
      symbol: "BTC",
      levels: [
        [{ price: "67000.5", size: "1.25", orderCount: 3 }],
        [{ price: "67001", size: "0.5", orderCount: 1 }],
      ],
      time: 1727450000000,
    });
  });
});

describe("toTrade", () => {
  it("translates wire keys and keeps side, hash and time untouched", () => {
    const trade = toTrade({
      coin: "ETH",
      side: "B",
      px: "3500.25",
      sz: "2",
      hash: "0xabc",
      time: 1727450001000,
      tid: 987,
    });

    expect(trade).toEqual({
      symbol: "ETH",
      side: "B",
      price: "3500.25",
      size: "2",
      hash: "0xabc",
      time: 1727450001000,
      tradeId: 987,
    });
  });
});

describe("toCandle", () => {
  it("translates wire keys and coerces numeric strings", () => {
    const candle = toCandle({
      t: 1727450000000,
      T: 1727450060000,
      s: "SOL",
      i: "1m",
      o: "150.1",
      h: "151.2",
      l: "149.8",
      c: "150.9",
      v: "1234.5",
      n: 42,
    });

    expect(candle).toEqual({
      openTime: 1727450000000,
      closeTime: 1727450060000,
      symbol: "SOL",
      interval: "1m",
      open: 150.1,
      high: 151.2,
      low: 149.8,
      close: 150.9,
      volume: 1234.5,
      tradeCount: 42,
    });
  });
});

describe("toAssetContext", () => {
  it("translates wire keys into full names and coerces numeric strings", () => {
    const context = toAssetContext({
      markPx: "67000.5",
      prevDayPx: "66000",
      dayNtlVlm: "123456789.12",
      funding: "0.0001",
    });

    expect(context).toEqual({
      markPrice: 67000.5,
      previousDayPrice: 66000,
      dayNotionalVolume: 123456789.12,
      funding: 0.0001,
    });
  });
});

describe("mergeCandles", () => {
  it("merges out-of-order candles by open time, sorted", () => {
    const merged = mergeCandles(
      [makeCandle(3000), makeCandle(1000)],
      [makeCandle(2000)],
    );

    expect(merged.map((candle) => candle.openTime)).toEqual([1000, 2000, 3000]);
  });

  it("replaces the candle at an existing open time", () => {
    const merged = mergeCandles(
      [makeCandle(1000, 100)],
      [makeCandle(1000, 105)],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].close).toBe(105);
  });

  it("keeps only the most recent 180 candles", () => {
    const existing = Array.from({ length: 150 }, (_, index) =>
      makeCandle(index * 60_000),
    );
    const incoming = Array.from({ length: 60 }, (_, index) =>
      makeCandle((150 + index) * 60_000),
    );

    const merged = mergeCandles(existing, incoming);

    expect(merged).toHaveLength(180);
    expect(merged[0].openTime).toBe(30 * 60_000);
    expect(merged[179].openTime).toBe(209 * 60_000);
  });
});
