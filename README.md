# FinSight — AI-Powered Market Analyzer

Real-time crypto & stock market analysis with ML predictions, backtesting, and news aggregation.

**Live:** https://www.crypto-fininsight.xyz

## Features

| Feature | Details |
|---|---|
| **Crypto Tab** | 70+ coins — Binance & Revolut filter |
| **US Stocks Tab** | 85+ stocks — Available on Revolut |
| **AU Stocks Tab** | 70+ stocks — Available on CommSec (ASX) |
| **Top 5 Picks** | Background ML scan of every asset, results stream in live; refreshed hourly |
| **AI Predictions** | Ensemble: Random Forest + Hist. Gradient Boosting + XGBoost |
| **Technical Indicators** | 30+ indicators (RSI, MACD, BB, ADX, ATR, OBV, Stochastic…) |
| **Backtesting** | Purged walk-forward validation over the last 90 labelled days |
| **Live News** | CoinDesk, CoinTelegraph, Reuters, AFR, ABC Business & more |
| **Charts** | Interactive OHLCV charts with volume and SMA 20/50 overlays (1W → 2Y) |
| **Themes** | Light by default, dark mode toggle (remembered per browser) |
| **Mobile** | Responsive list → detail flow, 44px tap targets, no horizontal scrolling |

## Quick Start

### Requirements
- Python 3.11+
- Node.js 18+
- npm

### Install & Run

```bash
# One-time install (Python venv + npm)
./install.sh

# Build a small local data set (15 assets per market) and start the UI
./start.sh            # LIMIT=0 ./start.sh analyses every asset (~10 min)
```

Then open **http://localhost:3000**. Live quotes and news are served by the
Vercel functions; in development they are proxied to the deployed site
(`VITE_API_PROXY_TARGET`), or run `npx vercel dev` inside `frontend/`.

---

## Architecture — no servers

```
GitHub Actions (every 6 h)            `data` branch (static JSON)       Vercel (free)
┌──────────────────────────┐          ┌──────────────────────────┐      ┌──────────────────────────┐
│ build_static.py          │ publish  │ /data/picks.json         │      │ React UI  (Vite)         │
│  • 232 assets            │ ───────► │ /data/assets/*.json      │ ◄─── │   /data/* rewrite        │
│  • prediction + backtest │          │ /data/analysis/<m>/<s>   │      │ api/quotes  (Binance)    │
│  • 2-year chart          │          │ /data/manifest.json      │      │ api/quote   (Yahoo)      │
└──────────────────────────┘          └──────────────────────────┘      │ api/news    (RSS)        │
                                                                        └──────────────────────────┘
```

* **Models are trained on a schedule, never while a user waits.** The build runs
  the full analysis for every asset and publishes plain JSON to the `data`
  branch (one force-pushed commit per run, so history never grows); the UI
  reads one ~50 kB file per asset that contains its prediction, backtest
  signals and chart.
* **Unchanged candles are not recomputed.** The build compares each asset's
  latest daily candle with the previously published file and reuses it when
  identical, so most runs retrain only what moved.
* **Live prices and news** come from three small Vercel functions
  (`frontend/api/`), cached at the edge for 60 s / 5 min so a thousand visitors
  cost a handful of upstream calls.
* Nothing to host, patch or pay for: GitHub Actions is free for public
  repositories; Vercel's Hobby plan covers the UI and functions.

```
financial-analyzer/
├── backend/                    # Python — batch data build only
│   ├── scripts/build_static.py # Produces the static data set
│   ├── services/
│   │   ├── data_fetcher.py     # Binance (mirror + fallback) and yfinance, cached
│   │   └── predictor.py        # ML ensemble, purged walk-forward backtest
│   └── data/asset_lists.py     # Binance / Revolut / CommSec asset lists
├── .github/workflows/
│   └── data-refresh.yml        # Cron + manual + on backend change → data branch
└── frontend/                   # React + TypeScript + Vite, deployed on Vercel
    ├── api/                    # Vercel functions: quotes, quote, news
    ├── vercel.json             # /data/* → data branch rewrite + cache headers
    └── src/
        ├── App.tsx             # Tabs, theme toggle
        ├── api/client.ts       # Reads /data (static) and /api (functions)
        ├── theme/              # Light/dark theme provider (CSS variables)
        ├── utils/              # Formatting helpers, media queries
        └── components/
            ├── TopPicksTab.tsx     # Top 5 picks with live crypto prices
            ├── CryptoTab.tsx / StockTab.tsx
            ├── AssetWorkspace.tsx  # Responsive list/detail layout
            ├── AssetDetail.tsx     # Chart / AI Predict / Backtest / News (charts lazy-loaded)
            └── PriceChart.tsx, PredictionCard.tsx, BacktestResults.tsx, NewsSection.tsx
```

## Prediction Algorithm

The ML prediction uses a 3-model ensemble:

1. **Random Forest** (35% weight) — 100 trees, max depth 8
2. **Histogram Gradient Boosting** (30% weight) — 150 iterations, learning rate 0.05
3. **XGBoost** (35% weight) — 150 estimators, max depth 5, `hist` tree method

The model is trained on every candle whose 7-day outcome is already known and
then scores the **latest** candle, so the price, indicators and targets shown
are today's. One analysis produces both the prediction and the backtest signal
history; it is cached per symbol for an hour (`ANALYSIS_TTL_SECONDS`) because
the inputs are daily candles.

### Features (30+)
- Returns: 1d, 3d, 5d, 10d, 20d
- Moving Averages: SMA/EMA (10, 20, 50, 100, 200)
- MA Crossovers: Golden cross, EMA cross
- RSI (7, 14, 21 periods)
- MACD + signal + histogram
- Bollinger Bands (width, position, squeeze)
- Stochastic Oscillator (K, D)
- ATR, volatility (20d, ratio)
- Volume ratio, OBV trend
- ADX (trend strength proxy)
- Williams %R
- Price z-score

### Backtesting
- **Purged walk-forward** over the last 90 labelled days, re-training every 15 days
- The 7 days whose labels overlap a test fold are excluded from its training set,
  so no future prices leak into the backtest
- **Metrics**: Accuracy, Precision, Recall, F1, Profit Factor (7-day forward returns)

### Data refresh

* `.github/workflows/data-refresh.yml` runs hourly, on demand (the **Refresh now**
  button, or Actions → "Refresh market data" → Run workflow) and whenever
  `backend/` changes on `main`.
* Each run writes `manifest.json` (counts, duration, failures, how many assets
  were reused vs retrained) and the step summary shows the same numbers.
* `REFRESH_HOURS` (default 6) controls the advertised refresh cadence,
  `REUSE_BASE_URL` points the reuse check at the published data set (the data branch).

## Deployment

| Part | Where | How |
|---|---|---|
| Data | `data` branch of this repo | Force-pushed by the workflow; served raw at `https://raw.githubusercontent.com/Naveenrod/Crypto-stock-webpage/data/data/` |
| Frontend + functions | Vercel (project root `frontend/`), served at `www.crypto-fininsight.xyz` | Deploys automatically from `main`; `vercel.json` rewrites `/data/*` to the data branch and tells Vercel not to build that branch |

One optional setting enables the **Refresh now** button: add a Vercel
environment variable `GITHUB_DISPATCH_TOKEN` holding a fine-grained GitHub
personal access token scoped to this repository with *Actions: Read and write*
(Vercel → Project → Settings → Environment Variables, then redeploy). The
button is hidden until the token exists, and refreshes are limited to one per
10 minutes (`REFRESH_COOLDOWN_SECONDS`).

## Data Sources

| Source | Used For |
|---|---|
| Binance API (public) | Crypto OHLCV, real-time prices |
| Yahoo Finance (yfinance) | US & AU stock OHLCV |
| CoinDesk RSS | Crypto news |
| CoinTelegraph RSS | Crypto news |
| Reuters Finance RSS | US market news |
| ABC Business RSS | AU market news |
| AFR RSS | AU financial news |
| MarketWatch RSS | US market news |

## Disclaimer

This tool is for **educational and informational purposes only**. It does not constitute
financial advice. Always do your own research before making investment decisions.
Past performance does not guarantee future results.
