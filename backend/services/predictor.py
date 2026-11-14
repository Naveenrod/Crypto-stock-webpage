"""
Prediction & Backtesting Engine
────────────────────────────────
Algorithm:
  1. Compute 30+ technical indicators (trend, momentum, volatility, volume)
  2. Train an ensemble: RandomForest + HistGradientBoosting + XGBoost
  3. Purged walk-forward backtest over the last 90 labelled rows
     (re-train every 15 rows; the 7 rows whose labels overlap the test
     fold are excluded from training so no future prices leak in)
  4. Train a final model on every labelled row and score the LATEST candle
  5. Report accuracy, precision, profit factor and a composite score 0-100

Design notes
  • One analyze_asset() call produces BOTH the prediction and the backtest
    signal history. Results are cached per symbol (default 1 h — the inputs
    are daily candles, so re-training every few minutes is wasted CPU).
  • Concurrent requests for the same symbol share one computation.
  • quick_predict_asset() is the fast path used by the Top-Picks scan
    (one training pass, no walk-forward).

Note: Financial markets are inherently uncertain. No model can guarantee
accuracy. Backtested accuracy reflects HISTORICAL performance only.
"""

import os
import threading
import warnings
import logging
from typing import Callable

import numpy as np
import pandas as pd
from cachetools import TTLCache
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from xgboost import XGBClassifier

from services.data_fetcher import get_binance_history, get_yf_history

warnings.filterwarnings("ignore")
logger = logging.getLogger(__name__)

PREDICTION_HORIZON = 7      # days ahead
MIN_TRAIN_ROWS     = 200
WALK_FORWARD_ROWS  = 90     # size of the out-of-sample window
WALK_FORWARD_STEP  = 15     # re-train every N rows (→ 6 folds)
HISTORY_DAYS       = 730
ANALYSIS_TTL       = int(os.getenv("ANALYSIS_TTL_SECONDS", "3600"))

# Full analyses (prediction + signals) and quick predictions, keyed by symbol.
_analysis_cache: TTLCache = TTLCache(maxsize=600, ttl=ANALYSIS_TTL)
_quick_cache:    TTLCache = TTLCache(maxsize=600, ttl=ANALYSIS_TTL)
_cache_lock = threading.Lock()
_inflight: dict[str, threading.Event] = {}


# ─── Feature engineering ─────────────────────────────────────

def _compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _compute_stoch(high, low, close, k=14, d=3):
    low_k  = low.rolling(k).min()
    high_k = high.rolling(k).max()
    stoch_k = (close - low_k) / (high_k - low_k + 1e-10) * 100
    stoch_d = stoch_k.rolling(d).mean()
    return stoch_k, stoch_d


def _compute_atr(high, low, close, period=14):
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute all technical indicators and return a feature-enriched DataFrame."""
    df = df.copy()
    close  = df["close"]
    high   = df["high"]
    low    = df["low"]
    volume = df["volume"]

    for n in [1, 3, 5, 10, 20]:
        df[f"ret_{n}d"] = close.pct_change(n)

    for w in [10, 20, 50, 100, 200]:
        df[f"sma_{w}"] = close.rolling(w).mean()
        df[f"ema_{w}"] = close.ewm(span=w, adjust=False).mean()
    for w in [10, 20, 50, 100, 200]:
        df[f"price_sma{w}_ratio"] = close / df[f"sma_{w}"]
        df[f"price_ema{w}_ratio"] = close / df[f"ema_{w}"]

    df["golden_cross"]    = (df["sma_50"] > df["sma_200"]).astype(int)
    df["ema_cross_12_26"] = (df["ema_10"] > df["ema_20"]).astype(int)

    ema12             = close.ewm(span=12, adjust=False).mean()
    ema26             = close.ewm(span=26, adjust=False).mean()
    df["macd"]        = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]
    df["macd_bullish"]= (df["macd"] > df["macd_signal"]).astype(int)

    df["rsi_14"] = _compute_rsi(close, 14)
    df["rsi_7"]  = _compute_rsi(close, 7)
    df["rsi_21"] = _compute_rsi(close, 21)
    df["rsi_oversold"]   = (df["rsi_14"] < 30).astype(int)
    df["rsi_overbought"] = (df["rsi_14"] > 70).astype(int)

    df["stoch_k"], df["stoch_d"] = _compute_stoch(high, low, close)
    df["stoch_bullish"] = (df["stoch_k"] > df["stoch_d"]).astype(int)

    bb_mid          = close.rolling(20).mean()
    bb_std          = close.rolling(20).std()
    df["bb_upper"]  = bb_mid + 2 * bb_std
    df["bb_lower"]  = bb_mid - 2 * bb_std
    df["bb_width"]  = (df["bb_upper"] - df["bb_lower"]) / bb_mid
    df["bb_pos"]    = (close - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-10)
    df["bb_squeeze"] = (df["bb_width"] < df["bb_width"].rolling(20).mean()).astype(int)

    df["atr_14"]  = _compute_atr(high, low, close, 14)
    df["atr_pct"] = df["atr_14"] / close
    df["volatility_20d"]   = close.pct_change().rolling(20).std()
    df["volatility_ratio"] = df["volatility_20d"] / df["volatility_20d"].rolling(50).mean()

    vol_ma          = volume.rolling(20).mean()
    df["vol_ratio"] = volume / (vol_ma + 1e-10)
    df["vol_trend"] = (volume > vol_ma).astype(int)
    obv = (np.sign(close.diff()) * volume).fillna(0).cumsum()
    df["obv_trend"] = (obv > obv.rolling(20).mean()).astype(int)

    up_move   = high.diff()
    down_move = -(low.diff())
    plus_dm   = np.where((up_move > down_move) & (up_move > 0), up_move, 0)
    minus_dm  = np.where((down_move > up_move) & (down_move > 0), down_move, 0)
    atr       = df["atr_14"]
    plus_di   = pd.Series(plus_dm,  index=df.index).rolling(14).mean() / (atr + 1e-10) * 100
    minus_di  = pd.Series(minus_dm, index=df.index).rolling(14).mean() / (atr + 1e-10) * 100
    dx        = (plus_di - minus_di).abs() / (plus_di + minus_di + 1e-10) * 100
    df["adx"] = dx.rolling(14).mean()
    df["trend_strong"] = (df["adx"] > 25).astype(int)

    df["williams_r"] = (high.rolling(14).max() - close) / \
                       (high.rolling(14).max() - low.rolling(14).min() + 1e-10) * -100
    df["streak"] = close.diff().apply(np.sign).rolling(5).sum()
    df["price_zscore"] = (close - close.rolling(50).mean()) / (close.rolling(50).std() + 1e-10)
    return df


FEATURE_COLS = [
    "ret_1d","ret_3d","ret_5d","ret_10d","ret_20d",
    "price_sma10_ratio","price_sma20_ratio","price_sma50_ratio","price_sma200_ratio",
    "price_ema10_ratio","price_ema20_ratio","golden_cross","ema_cross_12_26",
    "macd","macd_signal","macd_hist","macd_bullish",
    "rsi_7","rsi_14","rsi_21","rsi_oversold","rsi_overbought",
    "stoch_k","stoch_d","stoch_bullish",
    "bb_width","bb_pos","bb_squeeze",
    "atr_pct","volatility_20d","volatility_ratio",
    "vol_ratio","vol_trend","obv_trend",
    "adx","trend_strong","williams_r","streak","price_zscore",
]


# ─── Model training ──────────────────────────────────────────

def _train_ensemble(X_train, y_train):
    """
    RF (100 trees) + HistGradientBoosting + XGBoost(hist).
    ~3x cheaper than the previous RF200 + sklearn GradientBoosting + XGB with
    the same feature set; single-threaded so concurrent fits don't oversubscribe.
    """
    rf  = RandomForestClassifier(n_estimators=100, max_depth=8, min_samples_leaf=5,
                                 random_state=42, n_jobs=1)
    hgb = HistGradientBoostingClassifier(max_iter=150, max_depth=4, learning_rate=0.05,
                                         random_state=42)
    xgb = XGBClassifier(n_estimators=150, max_depth=5, learning_rate=0.05,
                        tree_method="hist", n_jobs=1, eval_metric="logloss",
                        random_state=42, verbosity=0)
    rf.fit(X_train, y_train)
    hgb.fit(X_train, y_train)
    xgb.fit(X_train, y_train)
    return rf, hgb, xgb


def _ensemble_proba(rf, hgb, xgb, X):
    p_rf  = rf.predict_proba(X)[:, 1]
    p_gb  = hgb.predict_proba(X)[:, 1]
    p_xgb = xgb.predict_proba(X)[:, 1]
    return p_rf * 0.35 + p_gb * 0.30 + p_xgb * 0.35


# ─── Composite score (0-100) ─────────────────────────────────

def _composite_score(row, ml_prob: float) -> tuple[float, list[dict]]:
    """
    Combine ML probability with technical indicator alignment.
    Returns (score 0-100, breakdown) — >=62 BUY, <=38 SELL, otherwise HOLD.
    """
    parts: list[dict] = []

    def add(label, pts, max_pts):
        parts.append({"label": label, "points": round(pts, 1), "max": max_pts})

    add("ML probability", ml_prob * 50, 50)

    rsi = row.get("rsi_14", 50)
    if rsi < 30:   add("RSI", 8, 8)
    elif rsi < 45: add("RSI", 5, 8)
    elif rsi > 70: add("RSI", -5, 8)
    else:          add("RSI", 3, 8)

    macd_pts = (7 if row.get("macd_bullish", 0) else 0) + (3 if row.get("macd_hist", 0) > 0 else 0)
    add("MACD", macd_pts, 10)

    bb = row.get("bb_pos", 0.5)
    if bb < 0.2:   add("Bollinger position", 8, 8)
    elif bb > 0.8: add("Bollinger position", -3, 8)
    else:          add("Bollinger position", 3, 8)

    add("Golden cross", 8 if row.get("golden_cross", 0) else 0, 8)
    add("Volume", (3 if row.get("vol_trend", 0) else 0) + (2 if row.get("obv_trend", 0) else 0), 5)
    add("Trend strength", (3 if row.get("trend_strong", 0) else 0) + (2 if row.get("streak", 0) > 0 else 0), 5)

    score = sum(p["points"] for p in parts)
    return max(0.0, min(100.0, score)), parts


def _signal_for(score: float) -> tuple[str, str]:
    if score >= 62:
        return "BUY", "green"
    if score <= 38:
        return "SELL", "red"
    return "HOLD", "yellow"


# ─── Data preparation ────────────────────────────────────────

def _fetch(symbol: str, asset_type: str) -> pd.DataFrame:
    if asset_type == "crypto":
        return get_binance_history(symbol, days=HISTORY_DAYS)
    return get_yf_history(symbol, days=HISTORY_DAYS)


def _prepare(df: pd.DataFrame):
    """
    Returns (train_df, latest_row, feat_cols) or None when there isn't enough data.

    train_df   – rows whose 7-day-ahead outcome is already known (the label)
    latest_row – the most recent candle, which has NO label yet. This is the
                 row we score for the live prediction.
    """
    feat = build_features(df)
    feat_cols = [c for c in FEATURE_COLS if c in feat.columns]

    future = feat["close"].shift(-PREDICTION_HORIZON)
    feat["fwd_ret"] = future / feat["close"] - 1.0
    feat["target"]  = np.where(future.isna(), np.nan, (future > feat["close"]).astype(float))

    latest = feat.iloc[-1]
    if latest[feat_cols].isna().any():
        return None

    train = feat.dropna(subset=["target"] + feat_cols).reset_index(drop=True)
    if len(train) < MIN_TRAIN_ROWS:
        return None
    train["target"] = train["target"].astype(int)
    return train, latest, feat_cols


def _fmt_date(value) -> str:
    try:
        return pd.Timestamp(value).strftime("%Y-%m-%d")
    except Exception:
        return str(value)[:10]


def _indicators(row: pd.Series, current_price: float) -> dict:
    rsi_val = round(float(row.get("rsi_14", 50)), 1)
    bb_pos  = round(float(row.get("bb_pos", 0.5)), 2)
    sma20   = float(row.get("sma_20", current_price))
    sma50   = float(row.get("sma_50", current_price))
    sma200  = float(row.get("sma_200", current_price))
    return {
        "rsi":            rsi_val,
        "rsi_signal":     "Oversold" if rsi_val < 30 else ("Overbought" if rsi_val > 70 else "Neutral"),
        "macd_bullish":   bool(row.get("macd_bullish", 0)),
        "bb_position":    bb_pos,
        "bb_signal":      "Near support" if bb_pos < 0.2 else ("Near resistance" if bb_pos > 0.8 else "Mid range"),
        "golden_cross":   bool(row.get("golden_cross", 0)),
        "volume_surge":   float(row.get("vol_ratio", 1)) > 1.5,
        "trend_strength": "Strong" if float(row.get("adx", 20)) > 25 else "Weak",
        "adx":            round(float(row.get("adx", 0)), 1),
        "sma_20":         round(sma20, 6),
        "sma_50":         round(sma50, 6),
        "sma_200":        round(sma200, 6),
    }


def _trend(current_price: float, row: pd.Series) -> str:
    sma50  = float(row.get("sma_50", current_price))
    sma200 = float(row.get("sma_200", current_price))
    if current_price > sma50 > sma200:
        return "Bullish"
    if current_price < sma50 < sma200:
        return "Bearish"
    return "Sideways"


# ─── Caching helpers ─────────────────────────────────────────

def _cached(cache: TTLCache, key: str, compute: Callable[[], dict]) -> dict:
    """Return cache[key], computing it at most once even under concurrent requests."""
    while True:
        with _cache_lock:
            if key in cache:
                return cache[key]
            waiter = _inflight.get(key)
            if waiter is None:
                waiter = threading.Event()
                _inflight[key] = waiter
                owner = True
            else:
                owner = False
        if not owner:
            waiter.wait(timeout=600)
            continue
        try:
            result = compute()
            with _cache_lock:
                cache[key] = result
            return result
        finally:
            with _cache_lock:
                _inflight.pop(key, None)
            waiter.set()


def cached_analysis(symbol: str) -> dict | None:
    with _cache_lock:
        return _analysis_cache.get(symbol)


# ─── Full analysis (prediction + walk-forward backtest) ──────

def analyze_asset(symbol: str, asset_type: str = "crypto") -> dict:
    return _cached(_analysis_cache, f"{asset_type}:{symbol}", lambda: _analyze(symbol, asset_type))


def _analyze(symbol: str, asset_type: str) -> dict:
    df = _fetch(symbol, asset_type)
    if df.empty or len(df) < MIN_TRAIN_ROWS:
        return {"prediction": _no_data_result(symbol), "signals": []}
    prepared = _prepare(df)
    if prepared is None:
        return {"prediction": _no_data_result(symbol), "signals": []}
    train, latest, feat_cols = prepared

    # ── Purged walk-forward backtest over the last WALK_FORWARD_ROWS rows ──
    signals: list[dict] = []
    wf_preds, wf_true, wf_fwd = [], [], []
    wf_start = max(MIN_TRAIN_ROWS, len(train) - WALK_FORWARD_ROWS)
    for fold_start in range(wf_start, len(train), WALK_FORWARD_STEP):
        fold_end  = min(fold_start + WALK_FORWARD_STEP, len(train))
        train_end = fold_start - PREDICTION_HORIZON          # purge overlapping labels
        if train_end < MIN_TRAIN_ROWS // 2:
            continue
        X_tr = train[feat_cols].iloc[:train_end].fillna(0)
        y_tr = train["target"].iloc[:train_end].values
        if len(np.unique(y_tr)) < 2:
            continue
        X_te = train[feat_cols].iloc[fold_start:fold_end].fillna(0)
        y_te = train["target"].iloc[fold_start:fold_end].values
        sc = StandardScaler()
        models = _train_ensemble(sc.fit_transform(X_tr), y_tr)
        proba  = _ensemble_proba(*models, sc.transform(X_te))
        preds  = (proba >= 0.5).astype(int)
        wf_preds.extend(preds.tolist())
        wf_true.extend(y_te.tolist())
        wf_fwd.extend(train["fwd_ret"].iloc[fold_start:fold_end].tolist())
        for j, idx in enumerate(range(fold_start, fold_end)):
            signals.append({
                "date":    _fmt_date(train["date"].iloc[idx]),
                "price":   round(float(train["close"].iloc[idx]), 6),
                "signal":  "BUY" if preds[j] == 1 else "SELL",
                "correct": bool(preds[j] == y_te[j]),
                "prob":    round(float(proba[j]) * 100, 1),
            })

    wf_preds_a = np.array(wf_preds)
    wf_true_a  = np.array(wf_true)
    if len(wf_preds_a):
        acc       = float(accuracy_score(wf_true_a, wf_preds_a))
        precision = float(precision_score(wf_true_a, wf_preds_a, zero_division=0))
        recall    = float(recall_score(wf_true_a, wf_preds_a, zero_division=0))
        f1        = float(f1_score(wf_true_a, wf_preds_a, zero_division=0))
        buy_rets  = [r for p, r in zip(wf_preds, wf_fwd) if p == 1 and r == r]
        gross_profit = sum(r for r in buy_rets if r > 0)
        gross_loss   = abs(sum(r for r in buy_rets if r < 0))
        profit_factor = min(round(gross_profit / max(gross_loss, 1e-6), 2), 20.0) if buy_rets else 1.0
        test_size = len(wf_preds_a)
        correct   = int((wf_preds_a == wf_true_a).sum())
    else:
        acc = precision = recall = f1 = 0.5
        profit_factor, test_size, correct = 1.0, 0, 0

    # ── Final model on every labelled row → score the latest candle ──
    scaler = StandardScaler()
    models = _train_ensemble(scaler.fit_transform(train[feat_cols].fillna(0)), train["target"].values)
    X_latest = scaler.transform(latest[feat_cols].astype(float).to_frame().T.fillna(0))
    ml_prob  = float(_ensemble_proba(*models, X_latest)[0])

    prediction = _build_prediction(symbol, asset_type, latest, ml_prob)
    prediction["backtest"] = {
        "period_days":   test_size,
        "accuracy":      round(acc * 100, 1),
        "precision":     round(precision * 100, 1),
        "recall":        round(recall * 100, 1),
        "f1_score":      round(f1 * 100, 1),
        "profit_factor": profit_factor,
        "total_signals": test_size,
        "correct":       correct,
    }
    return {"prediction": prediction, "signals": signals[-60:]}


def _build_prediction(symbol: str, asset_type: str, latest: pd.Series, ml_prob: float) -> dict:
    row = latest.to_dict()
    score, breakdown = _composite_score(row, ml_prob)
    signal, color = _signal_for(score)
    current_price = float(latest["close"])
    atr = float(row.get("atr_14", current_price * 0.02)) or current_price * 0.02
    return {
        "symbol":             symbol,
        "asset_type":         asset_type,
        "as_of":              _fmt_date(latest["date"]),
        "signal":             signal,
        "signal_color":       color,
        "score":              round(score, 1),
        "score_breakdown":    breakdown,
        "ml_probability":     round(ml_prob * 100, 1),
        "confidence":         round(max(abs(ml_prob - 0.5) * 2 * 100, 5), 1),
        "current_price":      current_price,
        "change_24h":         round(float(row.get("ret_1d", 0.0)) * 100, 2),
        "target_price_up":    round(current_price + 1.5 * atr, 6),
        "target_price_down":  round(current_price - 1.0 * atr, 6),
        "stop_loss":          round(current_price - 2.0 * atr, 6),
        "trend":              _trend(current_price, latest),
        "prediction_horizon": f"{PREDICTION_HORIZON} days",
        "indicators":         _indicators(latest, current_price),
        "backtest":           {},
        "disclaimer": "Predictions are based on historical patterns and do not guarantee future returns. Always do your own research.",
    }


# ─── Public API used by the routers ──────────────────────────

def predict_asset(symbol: str, asset_type: str = "crypto") -> dict:
    """Full prediction (with walk-forward backtest metrics) for the detail view."""
    return analyze_asset(symbol, asset_type)["prediction"]


def get_backtest_chart(symbol: str, asset_type: str = "crypto") -> list[dict]:
    """Out-of-sample signal history from the same analysis as predict_asset()."""
    return analyze_asset(symbol, asset_type)["signals"]


def quick_predict_asset(symbol: str, asset_type: str = "crypto") -> dict:
    """
    Fast path for bulk scanning (Top-5 Picks): one training pass, no
    walk-forward. If a full analysis is already cached for the symbol it is
    reused, so the picks carry real backtest accuracy when available.
    """
    full = cached_analysis(f"{asset_type}:{symbol}")
    if full is not None:
        return full["prediction"]
    return _cached(_quick_cache, f"{asset_type}:{symbol}", lambda: _quick(symbol, asset_type))


def _quick(symbol: str, asset_type: str) -> dict:
    df = _fetch(symbol, asset_type)
    if df.empty or len(df) < MIN_TRAIN_ROWS:
        return _no_data_result(symbol)
    prepared = _prepare(df)
    if prepared is None:
        return _no_data_result(symbol)
    train, latest, feat_cols = prepared
    scaler = StandardScaler()
    models = _train_ensemble(scaler.fit_transform(train[feat_cols].fillna(0)), train["target"].values)
    X_latest = scaler.transform(latest[feat_cols].astype(float).to_frame().T.fillna(0))
    ml_prob  = float(_ensemble_proba(*models, X_latest)[0])
    pred = _build_prediction(symbol, asset_type, latest, ml_prob)
    pred["backtest"] = {}          # not computed in the fast path
    return pred


def _no_data_result(symbol: str) -> dict:
    return {
        "symbol":         symbol,
        "signal":         "HOLD",
        "signal_color":   "yellow",
        "score":          50.0,
        "score_breakdown": [],
        "ml_probability": 50.0,
        "confidence":     0.0,
        "current_price":  0,
        "error":          "Insufficient data for prediction",
        "backtest":       {},
        "indicators":     {},
        "disclaimer":     "Predictions are based on historical patterns only.",
    }
