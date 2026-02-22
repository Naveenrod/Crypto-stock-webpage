# FinSight — AI-Powered Market Analyzer

Real-time crypto & stock market analysis with ML predictions, backtesting, and news aggregation.

## Features

| Feature | Details |
|---|---|
| **Crypto Tab** | 70+ coins — Binance & Revolut filter |
| **US Stocks Tab** | 85+ stocks — Available on Revolut |
| **AU Stocks Tab** | 70+ stocks — Available on CommSec (ASX) |
| **AI Predictions** | Ensemble: Random Forest + Gradient Boosting + XGBoost |
| **Technical Indicators** | 30+ indicators (RSI, MACD, BB, ADX, ATR, OBV, Stochastic…) |
| **Backtesting** | Walk-forward validation on last 30 trading days |
| **Live News** | CoinDesk, CoinTelegraph, Reuters, AFR, ABC Business & more |
| **Charts** | Interactive OHLCV charts with volume (1W → 2Y) |

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
│   │   └── news.py             # /api/news/*
│   ├── services/
│   │   ├── data_fetcher.py     # Binance API + yfinance
│   │   ├── predictor.py        # ML prediction engine
│   │   └── scraper.py          # RSS news aggregator
│   └── data/
│       └── asset_lists.py      # Binance / Revolut / CommSec asset lists
└── frontend/                   # React + TypeScript + Vite
    └── src/
        ├── App.tsx             # Main app with tabs
        ├── api/client.ts       # API calls
        └── components/
            ├── CryptoTab.tsx
            ├── StocksUSTab.tsx
            ├── StocksAUTab.tsx
            ├── PriceChart.tsx
            ├── PredictionCard.tsx
            ├── BacktestResults.tsx
            └── NewsSection.tsx
```

## Prediction Algorithm

The ML prediction uses a 3-model ensemble:

1. **Random Forest** (35% weight) — 200 trees, max depth 8
2. **Gradient Boosting** (30% weight) — 150 estimators, learning rate 0.05
3. **XGBoost** (35% weight) — 150 estimators, max depth 5

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
- **Train**: 2 years → last 30 days
- **Test**: Last 30 trading days (walk-forward)
- **Metrics**: Accuracy, Precision, F1, Profit Factor

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
