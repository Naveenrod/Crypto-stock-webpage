/**
 * Data access for the UI.
 *
 * There is no application server. Two sources:
 *   /data/*  – static JSON built every 6 h by GitHub Actions (backend/scripts/build_static.py)
 *              and published to GitHub Pages; Vercel rewrites /data/* to it.
 *   /api/*   – tiny Vercel functions (frontend/api) for live quotes and news, edge-cached.
 */
import axios from "axios";

const data = axios.create({ baseURL: "/data", timeout: 20_000 });
const api  = axios.create({ baseURL: "/api",  timeout: 20_000 });

// Every /data request carries a version query: a 5-minute bucket by default,
// or the id of a just-finished refresh run so edge/CDN caches are bypassed.
let dataVersion: string | null = null;
data.interceptors.request.use(cfg => {
  cfg.params = { ...(cfg.params ?? {}), v: dataVersion ?? String(Math.floor(Date.now() / 300_000)) };
  return cfg;
});
export function setDataVersion(v: string | null) {
  dataVersion = v;
  fileCache.clear();
}

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
  currency?:  string | null;
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

export interface AssetAnalysis {
  market:      Market;
  symbol:      string;
  name:        string;
  computed_at: string;
  prediction:  Prediction;
  signals:     BacktestPoint[];
  chart:       OHLCVPoint[];     // ~2 years of daily candles
}

// ── Static files (de-duplicated, remembered for the session) ─
const fileCache = new Map<string, { at: number; p: Promise<unknown> }>();
const FILE_MAX_AGE = 30 * 60_000;     // re-read after 30 min (data refreshes every 6 h)

function loadFile<T>(path: string): Promise<T> {
  const hit = fileCache.get(path);
  if (hit && Date.now() - hit.at < FILE_MAX_AGE) return hit.p as Promise<T>;
  const p = data.get<T>(path).then(r => r.data).catch(err => { fileCache.delete(path); throw err; });
  fileCache.set(path, { at: Date.now(), p });
  return p;
}

/** One ~50 kB file per asset feeds the chart, the prediction and the backtest. */
export const fetchAnalysis = (market: Market, symbol: string) =>
  loadFile<AssetAnalysis>(`/analysis/${market}/${encodeURIComponent(symbol)}.json`);

const PERIOD_DAYS: Record<string, number> = { "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730 };

export const fetchChart = async (market: Market, symbol: string, period = "1y"): Promise<OHLCVPoint[]> => {
  const { chart } = await fetchAnalysis(market, symbol);
  const last = chart[chart.length - 1];
  if (!last) return [];
  const cutoff = new Date(last.date).getTime() - (PERIOD_DAYS[period] ?? 365) * 86_400_000;
  return chart.filter(p => new Date(p.date).getTime() >= cutoff);
};

export const fetchPrediction = (market: Market, symbol: string) => fetchAnalysis(market, symbol).then(a => a.prediction);
export const fetchBacktest   = (market: Market, symbol: string) => fetchAnalysis(market, symbol).then(a => a.signals);

// ── Asset lists ─────────────────────────────────────────────
interface CryptoListFile { assets: Omit<CryptoAsset, "price" | "change_24h" | "volume_24h" | "high_24h" | "low_24h">[] }
interface StockListFile  { platform: string; sectors: string[]; assets: StockAsset[] }

export const fetchCryptoQuotes = (symbols: string[]) =>
  api.get<{ quotes: Quote[] }>("/quotes", { params: { market: "crypto", symbols: symbols.join(",") } }).then(r => r.data.quotes);

/** Static coin list merged with live Binance tickers (prices fall back to 0 if quotes are down). */
export async function fetchCryptoAssets(platform = "all"): Promise<CryptoAsset[]> {
  const list = await loadFile<CryptoListFile>("/assets/crypto.json");
  const base = platform === "revolut" ? list.assets.filter(a => a.on_revolut) : list.assets;
  let quotes: Record<string, Quote> = {};
  try {
    quotes = Object.fromEntries((await fetchCryptoQuotes(base.map(a => a.symbol))).map(q => [q.symbol, q]));
  } catch { /* show the list without prices rather than nothing */ }
  return base.map(a => {
    const q = quotes[a.symbol];
    return { ...a, price: q?.price ?? 0, change_24h: q?.change_24h ?? 0, volume_24h: q?.volume_24h ?? 0, high_24h: q?.high_24h ?? 0, low_24h: q?.low_24h ?? 0 };
  });
}

export const fetchStocks = async (market: "us" | "au", sector = "all"): Promise<StockAsset[]> => {
  const f = await loadFile<StockListFile>(`/assets/${market}.json`);
  return sector === "all" ? f.assets : f.assets.filter(a => a.sector === sector);
};

export const fetchSectors = async (market: "us" | "au"): Promise<string[]> =>
  (await loadFile<StockListFile>(`/assets/${market}.json`)).sectors;

export const fetchStockQuote = (_market: "us" | "au", symbol: string) =>
  api.get<Quote>("/quote", { params: { symbol } }).then(r => r.data);

// ── News ────────────────────────────────────────────────────
export type NewsCategory = "all" | "crypto" | "us_stocks" | "au_stocks";

export const fetchNews = (category: NewsCategory = "all") =>
  api.get<{ news: NewsItem[] }>("/news", { params: { category } }).then(r => r.data.news);

const NEWS_CATEGORY: Record<Market, NewsCategory> = { crypto: "crypto", us: "us_stocks", au: "au_stocks" };

export const fetchAssetNews = (market: Market, symbol: string) =>
  api.get<{ news: NewsItem[] }>("/news", { params: { category: NEWS_CATEGORY[market], symbol } }).then(r => r.data.news);

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
  backtest_accuracy: number | null;
  indicators:        Indicators;
}

export interface TopPicksResult {
  status?:       "idle" | "scanning" | "ready" | "error";
  progress?:     { done: number; total: number; ok: number };
  partial?:      boolean;
  crypto:        TopPick[];
  us_stocks:     TopPick[];
  au_stocks:     TopPick[];
  computed_at:   string | null;
  next_refresh_at?: string;
  total_scanned: number;
  total_assets?: number;
  ttl_seconds:   number;
  from_cache:    boolean;
  stale?:        boolean;
}

/** Pre-computed by the data build (see setDataVersion for cache-busting after a refresh). */
export const fetchTopPicks = (): Promise<TopPicksResult> =>
  data.get<TopPicksResult>("/picks.json").then(r => r.data);

// ── On-demand refresh (starts the GitHub Actions data build) ─
export interface RefreshRun { id: number; status: string; conclusion: string | null; html_url: string; created_at: string; updated_at: string; event: string }
export interface RefreshStatus {
  configured: boolean;
  running: boolean;
  run: RefreshRun | null;
  cooldown_seconds_left: number;
  started?: boolean;
  reason?: "already_running" | "cooldown";
}
export const getRefreshStatus = () => api.get<RefreshStatus>("/refresh").then(r => r.data);
export const startRefresh     = () => api.post<RefreshStatus>("/refresh").then(r => r.data);
