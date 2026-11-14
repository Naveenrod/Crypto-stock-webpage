# FinSight — AI-Powered Market Analyzer

Real-time crypto & stock market analysis with ML predictions, backtesting, and news aggregation.

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
cd financial-analyzer

# One-time install
./install.sh

# Launch (backend + frontend)
./start.sh
```

Then open **http://localhost:3000** in your browser.

API docs available at **http://localhost:8000/docs**

---

## Architecture

```
financial-analyzer/
├── backend/                    # Python FastAPI
│   ├── main.py                 # App entry point
│   ├── routers/
│   │   ├── crypto.py           # /api/crypto/*
│   │   ├── stocks.py           # /api/stocks/us/* and /api/stocks/au/*
│   │   ├── picks.py            # /api/picks/top5 — background scan with live progress
│   │   └── news.py             # /api/news/*
│   ├── services/
│   │   ├── data_fetcher.py     # Binance API + yfinance (cached)
│   │   ├── predictor.py        # ML prediction engine (cached per symbol)
│   │   ├── executor.py         # Thread pools that keep ML work off the event loop
│   │   └── scraper.py          # RSS news aggregator
│   └── data/
│       └── asset_lists.py      # Binance / Revolut / CommSec asset lists
└── frontend/                   # React + TypeScript + Vite
    └── src/
        ├── App.tsx             # Main app with tabs + theme toggle
        ├── api/client.ts       # API calls
        ├── theme/              # Light/dark theme provider (CSS variables)
        ├── utils/              # Formatting helpers, media queries
        └── components/
            ├── TopPicksTab.tsx     # Live-progress Top 5 picks
            ├── CryptoTab.tsx
            ├── StockTab.tsx        # US + AU (shared)
            ├── AssetWorkspace.tsx  # Responsive list/detail layout
            ├── AssetDetail.tsx     # Chart / AI Predict / Backtest / News panels
            ├── PriceChart.tsx
            ├── PredictionCard.tsx
            ├── BacktestResults.tsx
            └── NewsSection.tsx
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

### Top 5 Picks scan
- Runs in a background thread: at startup (warm-up) and whenever results are
  older than `PICKS_TTL_SECONDS` (default 1 h)
- `/api/picks/top5` never blocks: it returns the current ranking plus
  `progress.done/total`; the UI polls and shows picks as they are ranked
- Previous results keep being served while a refresh runs; `?refresh=true`
  forces a rescan (rate-limited by `PICKS_MIN_REFRESH_SECONDS`)

### Performance / tuning (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `ML_WORKERS` | min(2, CPUs) | Threads for interactive predictions |
| `SCAN_WORKERS` | min(2, CPUs) | Threads for the background Top-5 scan |
| `ANALYSIS_TTL_SECONDS` | 3600 | Per-symbol prediction/backtest cache |
| `HISTORY_TTL_SECONDS` | 1800 | Daily OHLCV cache |
| `PICKS_TTL_SECONDS` | 3600 | How often the Top-5 scan refreshes |
| `PICKS_MIN_REFRESH_SECONDS` | 600 | Manual rescan rate limit |
| `PICKS_WARMUP` | 1 | Set `0` to skip the startup scan |
| `OMP_NUM_THREADS` | 1 (Docker) | One OpenMP thread per model fit |

ML work runs on dedicated thread pools, never on the API event loop, so health
checks, price lists and charts stay fast while a prediction or scan is running.

## Deployment

| Part | Where | How |
|---|---|---|
| Frontend | Vercel | Deploys automatically from `main`; `frontend/vercel.json` proxies `/api/*` to the Fly backend |
| Backend | Fly.io (`finsight-backend`, Sydney) | `.github/workflows/fly-deploy.yml` runs `fly deploy` on pushes to `main` that touch `backend/` once the `FLY_API_TOKEN` secret is set. Manual fallback: `cd backend && fly deploy` |

The Fly VM is `shared-cpu-1x` (6.25 % CPU baseline, bursts from a credit balance).
The hourly background scan uses about 90 s of CPU on a modern core, which fits
the baseline; if the app gets busier, `fly scale vm shared-cpu-2x` is the cheapest
way to keep predictions snappy during a scan.

> **Note**: Financial markets are inherently unpredictable. Even the best ML models
> achieve 55-65% direction accuracy. The backtested accuracy shown reflects
> historical performance — not a guarantee of future results.

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
