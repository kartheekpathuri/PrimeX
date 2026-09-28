export type WsMessage = { channel: string; data: unknown };

export type PriceLevel = {
  price: string;
  size: string;
  orderCount: number;
};

export type Book = {
  symbol: string;
  levels: [PriceLevel[], PriceLevel[]];
  time: number;
};

export type Trade = {
  symbol: string;
  side: string;
  price: string;
  size: string;
  hash: string;
  time: number;
  tradeId: number;
};

export type Candle = {
  openTime: number;
  closeTime: number;
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
};

export type AssetContext = {
  markPrice: number;
  previousDayPrice: number;
  dayNotionalVolume: number;
  funding: number;
};
