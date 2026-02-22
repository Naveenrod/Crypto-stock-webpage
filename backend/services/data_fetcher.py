"""
Data Fetcher Service
──────────────────
Fetches OHLCV and quote data from Binance (crypto) and yfinance (stocks).
All functions return pandas DataFrames or dicts for the predictor / routers.
"""

import requests
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from cachetools import TTLCache
import logging

logger = logging.getLogger(__name__)

# In-memory cache: price quotes cached 60 s, history 300 s
_price_cache = TTLCache(maxsize=500, ttl=60)
_hist_cache  = TTLCache(maxsize=200, ttl=300)

BINANCE_BASE = "https://api.binance.com/api/v3"


# ─── Binance ──────────────────────────────────────────────────

def get_binance_price(symbol: str) -> dict:
    """Return current ticker data for a single Binance symbol."""
    cache_key = f"binance_price_{symbol}"
    if cache_key in _price_cache:
        return _price_cache[cache_key]
    try:
        ticker_r = requests.get(f"{BINANCE_BASE}/ticker/24hr", params={"symbol": f"{symbol}USDT"}, timeout=5)
        ticker_r.raise_for_status()
        d = ticker_r.json()
        result = {
            "symbol":      symbol,
            "price":       float(d["lastPrice"]),
            "change_24h":  float(d["priceChangePercent"]),
            "volume_24h":  float(d["quoteVolume"]),
            "high_24h":    float(d["highPrice"]),
            "low_24h":     float(d["lowPrice"]),
            "market":      "crypto",
        }
        _price_cache[cache_key] = result
        return result
    except Exception as e:
        logger.warning(f"Binance price error {symbol}: {e}")
        return {"symbol": symbol, "price": 0, "change_24h": 0, "volume_24h": 0,
                "high_24h": 0, "low_24h": 0, "market": "crypto"}


def get_binance_history(symbol: str, days: int = 730) -> pd.DataFrame:
    """Return daily OHLCV history from Binance (max 1000 candles = ~2.7 years)."""
    cache_key = f"binance_hist_{symbol}_{days}"
    if cache_key in _hist_cache:
        return _hist_cache[cache_key]
    try:
        end_ms   = int(datetime.utcnow().timestamp() * 1000)
        start_ms = int((datetime.utcnow() - timedelta(days=days)).timestamp() * 1000)
        r = requests.get(
            f"{BINANCE_BASE}/klines",
            params={"symbol": f"{symbol}USDT", "interval": "1d",
                    "startTime": start_ms, "endTime": end_ms, "limit": 1000},
            timeout=10,
        )
        r.raise_for_status()
        raw = r.json()
        df = pd.DataFrame(raw, columns=[
            "open_time","open","high","low","close","volume",
            "close_time","quote_vol","trades","taker_buy_base",
            "taker_buy_quote","ignore"
        ])
        df["date"]   = pd.to_datetime(df["open_time"], unit="ms")
        df = df[["date","open","high","low","close","volume"]].copy()
        for col in ["open","high","low","close","volume"]:
            df[col] = pd.to_numeric(df[col])
        df = df.sort_values("date").reset_index(drop=True)
        _hist_cache[cache_key] = df
        return df
    except Exception as e:
        logger.error(f"Binance history error {symbol}: {e}")
        return pd.DataFrame()


def get_all_binance_prices(symbols: list[str]) -> list[dict]:
    """Batch-fetch all 24h tickers from Binance in a single request."""
    cache_key = "binance_all_prices"
    if cache_key in _price_cache:
        return _price_cache[cache_key]
    try:
        r = requests.get(f"{BINANCE_BASE}/ticker/24hr", timeout=10)
        r.raise_for_status()
        data = {d["symbol"]: d for d in r.json()}
        results = []
        for sym in symbols:
            pair = f"{sym}USDT"
            if pair in data:
                d = data[pair]
                results.append({
                    "symbol":     sym,
                    "price":      float(d["lastPrice"]),
                    "change_24h": float(d["priceChangePercent"]),
                    "volume_24h": float(d["quoteVolume"]),
                    "high_24h":   float(d["highPrice"]),
                    "low_24h":    float(d["lowPrice"]),
                    "market":     "crypto",
                })
            else:
                results.append({"symbol": sym, "price": 0, "change_24h": 0,
                                 "volume_24h": 0, "high_24h": 0, "low_24h": 0, "market": "crypto"})
        _price_cache[cache_key] = results
        return results
    except Exception as e:
        logger.error(f"Batch Binance prices error: {e}")
        return [{"symbol": s, "price": 0, "change_24h": 0, "volume_24h": 0,
                 "high_24h": 0, "low_24h": 0, "market": "crypto"} for s in symbols]


# ─── yfinance (stocks + fallback for crypto) ──────────────────

def get_yf_price(symbol: str, market: str = "us") -> dict:
    """Return current quote for a stock (or crypto via Yahoo ticker)."""
    cache_key = f"yf_price_{symbol}"
    if cache_key in _price_cache:
        return _price_cache[cache_key]
    try:
        ticker = yf.Ticker(symbol)
        info   = ticker.fast_info
        hist   = ticker.history(period="2d", interval="1d")
        if len(hist) < 2:
            hist = ticker.history(period="5d", interval="1d")
        price  = float(info.last_price) if hasattr(info, "last_price") and info.last_price else 0
        prev   = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else price
        chg    = ((price - prev) / prev * 100) if prev else 0
        result = {
            "symbol":     symbol,
            "price":      price,
            "change_24h": round(chg, 2),
            "volume_24h": float(info.three_month_average_volume or 0),
            "high_24h":   float(hist["High"].iloc[-1]) if len(hist) else price,
            "low_24h":    float(hist["Low"].iloc[-1])  if len(hist) else price,
            "market":     market,
        }
        _price_cache[cache_key] = result
        return result
    except Exception as e:
        logger.warning(f"yfinance price error {symbol}: {e}")
        return {"symbol": symbol, "price": 0, "change_24h": 0, "volume_24h": 0,
                "high_24h": 0, "low_24h": 0, "market": market}


def get_yf_history(symbol: str, days: int = 730) -> pd.DataFrame:
    """Return daily OHLCV from Yahoo Finance."""
    cache_key = f"yf_hist_{symbol}_{days}"
    if cache_key in _hist_cache:
        return _hist_cache[cache_key]
    try:
        ticker = yf.Ticker(symbol)
        end    = datetime.today()
        start  = end - timedelta(days=days)
        df     = ticker.history(start=start.strftime("%Y-%m-%d"),
                                end=end.strftime("%Y-%m-%d"), interval="1d")
        df = df[["Open","High","Low","Close","Volume"]].copy()
        df.columns = ["open","high","low","close","volume"]
        df.index.name = "date"
        df = df.reset_index()
        df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
        df = df.sort_values("date").reset_index(drop=True)
        _hist_cache[cache_key] = df
        return df
    except Exception as e:
        logger.error(f"yfinance history error {symbol}: {e}")
        return pd.DataFrame()


def get_chart_data(symbol: str, asset_type: str = "crypto", period: str = "1y") -> list[dict]:
    """Return OHLCV suitable for charting (list of dicts)."""
    days_map = {"1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365, "2y": 730}
    days = days_map.get(period, 365)

    if asset_type == "crypto":
        df = get_binance_history(symbol, days)
    else:
        df = get_yf_history(symbol, days)

    if df.empty:
        return []

    return [
        {
            "date":   row["date"].strftime("%Y-%m-%d") if hasattr(row["date"], "strftime") else str(row["date"])[:10],
            "open":   round(float(row["open"]), 6),
            "high":   round(float(row["high"]), 6),
            "low":    round(float(row["low"]), 6),
            "close":  round(float(row["close"]), 6),
            "volume": float(row["volume"]),
        }
        for _, row in df.iterrows()
    ]
