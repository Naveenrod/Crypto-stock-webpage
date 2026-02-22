import axios from "axios";

const api = axios.create({ baseURL: "/api", timeout: 30000 });

// ── Types ───────────────────────────────────────────────────
export interface CryptoAsset {
  symbol:      string;
  name:        string;
  binance_pair:string;
  price:       number;
  change_24h:  number;
  volume_24h:  number;
  high_24h:    number;
  low_24h:     number;
  on_binance:  boolean;
  on_revolut:  boolean;
}

export interface StockAsset {
  symbol:  string;
  name:    string;
  sector:  string;
  price?:  number;
  change_24h?: number;
}

export interface OHLCVPoint {
  date:   string;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface Prediction {
  symbol:             string;
  asset_type:         string;
  signal:             "BUY" | "SELL" | "HOLD";
  signal_color:       string;
  score:              number;
  ml_probability:     number;
  confidence:         number;
  current_price:      number;
  target_price_up:    number;
  target_price_down:  number;
  stop_loss:          number;
  trend:              string;
  prediction_horizon: string;
  indicators: {
    rsi:             number;
    rsi_signal:      string;
    macd_bullish:    boolean;
    bb_position:     number;
    bb_signal:       string;
    golden_cross:    boolean;
    volume_surge:    boolean;
    trend_strength:  string;
    adx:             number;
    sma_20:          number;
    sma_50:          number;
    sma_200:         number;
  };
  backtest: {
    period_days:    number;
    accuracy:       number;
    precision:      number;
    recall:         number;
    f1_score:       number;
    profit_factor:  number;
    total_signals:  number;
    correct:        number;
  };
  disclaimer: string;
  error?: string;
}

export interface NewsItem {
  source:    string;
  title:     string;
  summary:   string;
  url:       string;
  published: string;
}

export interface BacktestPoint {
  date:    string;
  price:   number;
  signal:  "BUY" | "SELL";
  correct: boolean;
  prob:    number;
}

// ── API calls ───────────────────────────────────────────────
export const fetchCryptoAssets = (platform = "all") =>
  api.get<{ assets: CryptoAsset[] }>(`/crypto/assets?platform=${platform}`).then(r => r.data.assets);

export const fetchCryptoChart = (symbol: string, period = "1y") =>
  api.get<{ data: OHLCVPoint[] }>(`/crypto/${symbol}/chart?period=${period}`).then(r => r.data.data);

export const fetchCryptoPrediction = (symbol: string) =>
  api.get<Prediction>(`/crypto/${symbol}/predict`).then(r => r.data);

export const fetchCryptoBacktest = (symbol: string) =>
  api.get<{ signals: BacktestPoint[] }>(`/crypto/${symbol}/backtest`).then(r => r.data.signals);

export const fetchUSStocks = (sector = "all") =>
  api.get<{ assets: StockAsset[] }>(`/stocks/us/assets?sector=${sector}`).then(r => r.data.assets);

export const fetchUSStockPrice = (symbol: string) =>
  api.get(`/stocks/us/${symbol}/price`).then(r => r.data);

export const fetchUSStockChart = (symbol: string, period = "1y") =>
  api.get<{ data: OHLCVPoint[] }>(`/stocks/us/${symbol}/chart?period=${period}`).then(r => r.data.data);

export const fetchUSStockPrediction = (symbol: string) =>
  api.get<Prediction>(`/stocks/us/${symbol}/predict`).then(r => r.data);

export const fetchUSStockBacktest = (symbol: string) =>
  api.get<{ signals: BacktestPoint[] }>(`/stocks/us/${symbol}/backtest`).then(r => r.data.signals);

export const fetchAUStocks = (sector = "all") =>
  api.get<{ assets: StockAsset[] }>(`/stocks/au/assets?sector=${sector}`).then(r => r.data.assets);

export const fetchAUStockChart = (symbol: string, period = "1y") =>
  api.get<{ data: OHLCVPoint[] }>(`/stocks/au/${symbol}/chart?period=${period}`).then(r => r.data.data);

export const fetchAUStockPrediction = (symbol: string) =>
  api.get<Prediction>(`/stocks/au/${symbol}/predict`).then(r => r.data);

export const fetchAUStockBacktest = (symbol: string) =>
  api.get<{ signals: BacktestPoint[] }>(`/stocks/au/${symbol}/backtest`).then(r => r.data.signals);

export const fetchNews = (category = "all") =>
  api.get<{ news: NewsItem[] }>(`/news/?category=${category}`).then(r => r.data.news);

export const fetchAssetNews = (symbol: string, type: "crypto" | "us" | "au") => {
  const path = type === "crypto"
    ? `/crypto/${symbol}/news`
    : type === "us"
    ? `/stocks/us/${symbol}/news`
    : `/stocks/au/${symbol}/news`;
  return api.get<{ news: NewsItem[] }>(path).then(r => r.data.news);
};
