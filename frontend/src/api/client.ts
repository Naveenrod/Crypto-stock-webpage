import axios from "axios";

const api = axios.create({ baseURL: "/api", timeout: 30000 });

// ── Types ───────────────────────────────────────────────────
export type Market = "crypto" | "us" | "au";

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
}

export interface Quote {
  symbol:     string;
  price:      number;
  change_24h: number;
  volume_24h: number;
  high_24h:   number;
  low_24h:    number;
  market:     string;
}

export interface OHLCVPoint {
  date:   string;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface Indicators {
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
}

export interface ScorePart { label: string; points: number; max: number }

export interface Prediction {
  symbol:             string;
  asset_type:         string;
  as_of?:             string;            // date of the candle that was scored
  signal:             "BUY" | "SELL" | "HOLD";
  signal_color:       string;
  score:              number;
  score_breakdown?:   ScorePart[];
  ml_probability:     number;
  confidence:         number;
  current_price:      number;
  change_24h?:        number;
  target_price_up:    number;
  target_price_down:  number;
  stop_loss:          number;
  trend:              string;
  prediction_horizon: string;
  indicators:         Indicators;
  backtest: {
    period_days?:    number;
    accuracy?:       number;
    precision?:      number;
    recall?:         number;
    f1_score?:       number;
    profit_factor?:  number;
    total_signals?:  number;
    correct?:        number;
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

// ── Crypto ──────────────────────────────────────────────────
export const fetchCryptoAssets = (platform = "all") =>
  api.get<{ assets: CryptoAsset[] }>(`/crypto/assets`, { params: { platform } }).then(r => r.data.assets);

// ── Stocks (US + AU share one shape) ────────────────────────
const stockBase = (market: "us" | "au") => `/stocks/${market}`;

export const fetchStocks = (market: "us" | "au", sector = "all") =>
  api.get<{ assets: StockAsset[] }>(`${stockBase(market)}/assets`, { params: { sector } }).then(r => r.data.assets);

export const fetchSectors = (market: "us" | "au") =>
  api.get<{ sectors: string[] }>(`${stockBase(market)}/sectors/list`).then(r => r.data.sectors);

export const fetchStockQuote = (market: "us" | "au", symbol: string) =>
  api.get<Quote>(`${stockBase(market)}/${encodeURIComponent(symbol)}/price`).then(r => r.data);

// ── Per-asset analysis (works for every market) ─────────────
const assetBase = (market: Market, symbol: string) =>
  market === "crypto" ? `/crypto/${encodeURIComponent(symbol)}` : `${stockBase(market)}/${encodeURIComponent(symbol)}`;

export const fetchChart = (market: Market, symbol: string, period = "1y") =>
  api.get<{ data: OHLCVPoint[] }>(`${assetBase(market, symbol)}/chart`, { params: { period } }).then(r => r.data.data);

// A full prediction trains the ensemble ~7 times; allow up to 2 min on a busy server.
export const fetchPrediction = (market: Market, symbol: string) =>
  api.get<Prediction>(`${assetBase(market, symbol)}/predict`, { timeout: 120_000 }).then(r => r.data);

export const fetchBacktest = (market: Market, symbol: string) =>
  api.get<{ signals: BacktestPoint[] }>(`${assetBase(market, symbol)}/backtest`, { timeout: 120_000 }).then(r => r.data.signals);

export const fetchAssetNews = (market: Market, symbol: string) =>
  api.get<{ news: NewsItem[] }>(`${assetBase(market, symbol)}/news`).then(r => r.data.news);

// ── News ────────────────────────────────────────────────────
export type NewsCategory = "all" | "crypto" | "us_stocks" | "au_stocks";

export const fetchNews = (category: NewsCategory = "all") =>
  api.get<{ news: NewsItem[] }>(`/news`, { params: { category } }).then(r => r.data.news);

// ── Top 5 Picks ─────────────────────────────────────────────
export interface TopPick {
  symbol:            string;
  name:              string;
  asset_type:        string;           // "crypto" | "stock"
  category:          "crypto" | "us" | "au";
  signal:            "BUY" | "SELL" | "HOLD";
  score:             number;           // 0–100 composite score
  ml_probability:    number;           // 0–100
  confidence:        number;           // 0–100
  current_price:     number;
  change_24h:        number;
  trend:             string;           // "Bullish" | "Bearish" | "Sideways"
  as_of?:            string;
  backtest_accuracy: number | null;    // null when only the fast scan ran
  indicators:        Indicators;
}

export interface TopPicksResult {
  status:        "idle" | "scanning" | "ready" | "error";
  progress:      { done: number; total: number; ok: number };
  partial:       boolean;              // lists come from a scan still in progress
  crypto:        TopPick[];
  us_stocks:     TopPick[];
  au_stocks:     TopPick[];
  computed_at:   string | null;
  total_scanned: number;
  total_assets:  number;
  ttl_seconds:   number;
  from_cache:    boolean;
  stale:         boolean;
  refresh_started:      boolean;
  refresh_available_in: number | null;
}

/** Never blocks on the server: returns progress + whatever is ranked so far. */
export const fetchTopPicks = (refresh = false): Promise<TopPicksResult> =>
  api.get<TopPicksResult>("/picks/top5", { params: refresh ? { refresh: true } : {} }).then(r => r.data);
