"""
Prediction & Backtesting Engine
────────────────────────────────
Algorithm:
  1. Compute 30+ technical indicators (trend, momentum, volatility, volume)
  2. Engineer features (ratios, crossovers, z-scores)
  3. Train an Ensemble: RandomForest + GradientBoosting + XGBoost
  4. Walk-forward backtest: train on t-2yr→t-7d, test on t-7d→t
  5. Report accuracy, precision, profit factor and a composite score 0-100

Note: Financial markets are inherently uncertain. No model can guarantee
accuracy. Backtested accuracy reflects HISTORICAL performance only.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
from xgboost import XGBClassifier
import warnings
import logging
from services.data_fetcher import get_binance_history, get_yf_history

warnings.filterwarnings("ignore")
logger = logging.getLogger(__name__)

PREDICTION_HORIZON = 7   # days ahead
MIN_TRAIN_ROWS     = 200


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

    # ── Returns ──────────────────────────────────────────────
    for n in [1, 3, 5, 10, 20]:
        df[f"ret_{n}d"] = close.pct_change(n)

    # ── Moving averages ───────────────────────────────────────
    for w in [10, 20, 50, 100, 200]:
        df[f"sma_{w}"]  = close.rolling(w).mean()
        df[f"ema_{w}"]  = close.ewm(span=w, adjust=False).mean()

    # Price vs MA ratios
    for w in [10, 20, 50, 100, 200]:
        df[f"price_sma{w}_ratio"] = close / df[f"sma_{w}"]
        df[f"price_ema{w}_ratio"] = close / df[f"ema_{w}"]

    # MA crossover signals
    df["golden_cross"]    = (df["sma_50"] > df["sma_200"]).astype(int)
    df["ema_cross_12_26"] = (df["ema_10"] > df["ema_20"]).astype(int)

    # ── MACD ──────────────────────────────────────────────────
    ema12             = close.ewm(span=12, adjust=False).mean()
    ema26             = close.ewm(span=26, adjust=False).mean()
    df["macd"]        = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"]   = df["macd"] - df["macd_signal"]
    df["macd_bullish"]= (df["macd"] > df["macd_signal"]).astype(int)

    # ── RSI ───────────────────────────────────────────────────
    df["rsi_14"] = _compute_rsi(close, 14)
    df["rsi_7"]  = _compute_rsi(close, 7)
    df["rsi_21"] = _compute_rsi(close, 21)
    df["rsi_oversold"]    = (df["rsi_14"] < 30).astype(int)
    df["rsi_overbought"]  = (df["rsi_14"] > 70).astype(int)

    # ── Stochastic ────────────────────────────────────────────
    df["stoch_k"], df["stoch_d"] = _compute_stoch(high, low, close)
    df["stoch_bullish"] = (df["stoch_k"] > df["stoch_d"]).astype(int)

    # ── Bollinger Bands ───────────────────────────────────────
    bb_mid          = close.rolling(20).mean()
    bb_std          = close.rolling(20).std()
    df["bb_upper"]  = bb_mid + 2 * bb_std
    df["bb_lower"]  = bb_mid - 2 * bb_std
    df["bb_width"]  = (df["bb_upper"] - df["bb_lower"]) / bb_mid
    df["bb_pos"]    = (close - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"] + 1e-10)
    df["bb_squeeze"] = (df["bb_width"] < df["bb_width"].rolling(20).mean()).astype(int)

    # ── ATR & Volatility ──────────────────────────────────────
    df["atr_14"]    = _compute_atr(high, low, close, 14)
    df["atr_pct"]   = df["atr_14"] / close
    df["volatility_20d"] = close.pct_change().rolling(20).std()
    df["volatility_ratio"] = df["volatility_20d"] / df["volatility_20d"].rolling(50).mean()

    # ── Volume ────────────────────────────────────────────────
    vol_ma          = volume.rolling(20).mean()
    df["vol_ratio"] = volume / (vol_ma + 1e-10)
    df["vol_trend"] = (volume > vol_ma).astype(int)
    # OBV
    obv = (np.sign(close.diff()) * volume).fillna(0).cumsum()
    df["obv_trend"] = (obv > obv.rolling(20).mean()).astype(int)

    # ── Trend strength ────────────────────────────────────────
    # Simple ADX proxy using smoothed +DM/-DM
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

    # ── Williams %R ───────────────────────────────────────────
    df["williams_r"] = (high.rolling(14).max() - close) / \
                       (high.rolling(14).max() - low.rolling(14).min() + 1e-10) * -100

    # ── Pattern: consecutive up/down days ─────────────────────
    df["streak"] = close.diff().apply(np.sign).rolling(5).sum()

    # ── Z-score of price ──────────────────────────────────────
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
    rf  = RandomForestClassifier(n_estimators=200, max_depth=8, min_samples_leaf=5,
                                  random_state=42, n_jobs=-1)
    gb  = GradientBoostingClassifier(n_estimators=150, max_depth=4, learning_rate=0.05,
                                      random_state=42)
    xgb = XGBClassifier(n_estimators=150, max_depth=5, learning_rate=0.05,
                         use_label_encoder=False, eval_metric="logloss",
                         random_state=42, verbosity=0)
    rf.fit(X_train, y_train)
    gb.fit(X_train, y_train)
    xgb.fit(X_train, y_train)
    return rf, gb, xgb


def _ensemble_proba(rf, gb, xgb, X):
    p_rf  = rf.predict_proba(X)[:, 1]
    p_gb  = gb.predict_proba(X)[:, 1]
    p_xgb = xgb.predict_proba(X)[:, 1]
    return (p_rf * 0.35 + p_gb * 0.30 + p_xgb * 0.35)


# ─── Composite score (0-100) ─────────────────────────────────

def _composite_score(row, ml_prob: float) -> float:
    """
    Combine ML probability with technical indicator alignment.
    Returns a score 0-100 (>60 = bullish, <40 = bearish, 40-60 = neutral).
    """
    score = ml_prob * 50   # ML contributes up to 50 points

    # RSI (0-10 pts)
    rsi = row.get("rsi_14", 50)
    if rsi < 30:   score += 8   # oversold → likely bounce
    elif rsi < 45: score += 5
    elif rsi > 70: score -= 5   # overbought
    else:          score += 3

    # MACD (0-10 pts)
    if row.get("macd_bullish", 0): score += 7
    if row.get("macd_hist", 0) > 0: score += 3

    # BB position (0-10 pts)
    bb = row.get("bb_pos", 0.5)
    if bb < 0.2:   score += 8   # near lower band
    elif bb > 0.8: score -= 3
    else:          score += 3

    # Golden cross (0-10 pts)
    if row.get("golden_cross", 0): score += 8

    # Volume (0-5 pts)
    if row.get("vol_trend", 0): score += 3
    if row.get("obv_trend", 0): score += 2

    # Trend strength (0-5 pts)
    if row.get("trend_strong", 0): score += 3
    if row.get("streak", 0) > 0:   score += 2

    return max(0.0, min(100.0, score))


# ─── Main predict function ───────────────────────────────────

def predict_asset(symbol: str, asset_type: str = "crypto") -> dict:
    """
    Full prediction pipeline:
      • Fetch 2-year history
      • Build features
      • Walk-forward backtest (train on -2yr→-7d, test on -7d→today)
      • Predict next 7 days with the same model
      • Return structured prediction dict
    """
    # 1. Fetch data
    if asset_type == "crypto":
        df = get_binance_history(symbol, days=730)
    else:
        df = get_yf_history(symbol, days=730)

    if df.empty or len(df) < MIN_TRAIN_ROWS:
        return _no_data_result(symbol)

    # 2. Build features
    df = build_features(df)
    # IMPORTANT: shift(-N) produces NaN for last N rows; NaN > x = False in pandas,
    # which would silently corrupt the target. Explicitly mark those rows as NaN
    # and drop them so they never pollute training or backtest metrics.
    df["_future_close"] = df["close"].shift(-PREDICTION_HORIZON)
    df["target"] = np.where(df["_future_close"].isna(), np.nan,
                            (df["_future_close"] > df["close"]).astype(float))
    df = df.drop(columns=["_future_close"])
    df = df.dropna(subset=["target"] + [c for c in FEATURE_COLS if c in df.columns]).reset_index(drop=True)
    df["target"] = df["target"].astype(int)

    if len(df) < MIN_TRAIN_ROWS:
        return _no_data_result(symbol)

    feat_cols = [c for c in FEATURE_COLS if c in df.columns]

    # 3. Walk-forward backtest over last 90 rows (re-train every 15 steps)
    #    This gives ~6 mini-folds and a much more reliable accuracy estimate.
    wf_preds, wf_true = [], []
    wf_returns = []
    wf_window  = max(MIN_TRAIN_ROWS, len(df) - 90)

    step = 15
    for fold_start in range(wf_window, len(df), step):
        fold_end = min(fold_start + step, len(df))
        X_tr = df[feat_cols].iloc[:fold_start].fillna(0)
        y_tr = df["target"].iloc[:fold_start]
        X_te = df[feat_cols].iloc[fold_start:fold_end].fillna(0)
        y_te = df["target"].iloc[fold_start:fold_end].values
        if len(y_tr.unique()) < 2 or len(y_te) == 0:
            continue
        sc_ = StandardScaler()
        X_tr_s = sc_.fit_transform(X_tr)
        X_te_s = sc_.transform(X_te)
        rf_, gb_, xgb_ = _train_ensemble(X_tr_s, y_tr.values)
        proba_ = _ensemble_proba(rf_, gb_, xgb_, X_te_s)
        pred_  = (proba_ >= 0.5).astype(int)
        wf_preds.extend(pred_.tolist())
        wf_true.extend(y_te.tolist())
        # daily return when model says BUY (1) or we hold (0)
        rets_ = df["ret_1d"].iloc[fold_start:fold_end].values
        wf_returns.extend([(p, r) for p, r in zip(pred_, rets_)])

    wf_preds = np.array(wf_preds)
    wf_true  = np.array(wf_true)

    if len(wf_preds) > 0:
        acc       = float(accuracy_score(wf_true, wf_preds))
        precision = float(precision_score(wf_true, wf_preds, zero_division=0))
        recall    = float(recall_score(wf_true, wf_preds, zero_division=0))
        f1        = float(f1_score(wf_true, wf_preds, zero_division=0))
        # Profit factor: gross profit on BUY-signal wins / gross loss on BUY-signal losses
        buy_rets      = [r for p, r in wf_returns if p == 1]
        gross_profit  = sum(r for r in buy_rets if r > 0) if buy_rets else 0
        gross_loss    = abs(sum(r for r in buy_rets if r < 0)) if buy_rets else 1e-6
        profit_factor = round(gross_profit / max(gross_loss, 1e-6), 2)
        profit_factor = min(profit_factor, 20.0)   # cap at 20× for display
        test_size     = len(wf_preds)
    else:
        acc = precision = recall = f1 = 0.5
        profit_factor = 1.0
        test_size = 0

    # 4. Train final model on ALL data for the live prediction
    scaler = StandardScaler()
    X_all_s = scaler.fit_transform(df[feat_cols].fillna(0))
    y_all   = df["target"]
    rf, gb, xgb = _train_ensemble(X_all_s, y_all.values)

    # 5. Predict current
    X_current   = df[feat_cols].iloc[-1:].fillna(0)
    X_current_s = scaler.transform(X_current)
    ml_prob     = float(_ensemble_proba(rf, gb, xgb, X_current_s)[0])

    current_row = df.iloc[-1].to_dict()
    score       = _composite_score(current_row, ml_prob)

    # Signal
    if score >= 62:
        signal = "BUY"
        signal_color = "green"
    elif score <= 38:
        signal = "SELL"
        signal_color = "red"
    else:
        signal = "HOLD"
        signal_color = "yellow"

    # Price targets (based on ATR)
    current_price = float(df["close"].iloc[-1])
    atr           = float(df["atr_14"].iloc[-1]) if "atr_14" in df.columns else current_price * 0.02
    target_up     = round(current_price + 1.5 * atr, 6)
    target_down   = round(current_price - 1.0 * atr, 6)
    stop_loss     = round(current_price - 2.0 * atr, 6)

    # Trend direction
    sma20   = float(df["sma_20"].iloc[-1])  if "sma_20"  in df.columns else current_price
    sma50   = float(df["sma_50"].iloc[-1])  if "sma_50"  in df.columns else current_price
    sma200  = float(df["sma_200"].iloc[-1]) if "sma_200" in df.columns else current_price
    trend   = "Bullish" if current_price > sma50 > sma200 else (
              "Bearish" if current_price < sma50 < sma200 else "Sideways")

    # Indicator summary
    rsi_val   = round(float(current_row.get("rsi_14", 50)), 1)
    macd_bull = bool(current_row.get("macd_bullish", 0))
    bb_pos    = round(float(current_row.get("bb_pos", 0.5)), 2)
    vol_surge = float(current_row.get("vol_ratio", 1)) > 1.5

    return {
        "symbol":            symbol,
        "asset_type":        asset_type,
        "signal":            signal,
        "signal_color":      signal_color,
        "score":             round(score, 1),
        "ml_probability":    round(ml_prob * 100, 1),
        "confidence":        round(max(abs(ml_prob - 0.5) * 2 * 100, 5), 1),
        "current_price":     current_price,
        "target_price_up":   target_up,
        "target_price_down": target_down,
        "stop_loss":         stop_loss,
        "trend":             trend,
        "prediction_horizon": f"{PREDICTION_HORIZON} days",
        "indicators": {
            "rsi":              rsi_val,
            "rsi_signal":       "Oversold" if rsi_val < 30 else ("Overbought" if rsi_val > 70 else "Neutral"),
            "macd_bullish":     macd_bull,
            "bb_position":      bb_pos,
            "bb_signal":        "Near support" if bb_pos < 0.2 else ("Near resistance" if bb_pos > 0.8 else "Mid range"),
            "golden_cross":     bool(current_row.get("golden_cross", 0)),
            "volume_surge":     vol_surge,
            "trend_strength":   "Strong" if float(current_row.get("adx", 20)) > 25 else "Weak",
            "adx":              round(float(current_row.get("adx", 0)), 1),
            "sma_20":           round(sma20, 6),
            "sma_50":           round(sma50, 6),
            "sma_200":          round(sma200, 6),
        },
        "backtest": {
            "period_days":    test_size,
            "accuracy":       round(acc * 100, 1),
            "precision":      round(precision * 100, 1),
            "recall":         round(recall * 100, 1),
            "f1_score":       round(f1 * 100, 1),
            "profit_factor":  profit_factor,
            "total_signals":  int(len(wf_preds)) if len(wf_preds) > 0 else 0,
            "correct":        int((wf_preds == wf_true).sum()) if len(wf_preds) > 0 else 0,
        },
        "disclaimer": "Predictions are based on historical patterns and do not guarantee future returns. Always do your own research.",
    }


# ─── Historical backtest for UI chart ────────────────────────

def get_backtest_chart(symbol: str, asset_type: str = "crypto") -> list[dict]:
    """Return signal history + outcome for last 90 days (for backtest chart)."""
    if asset_type == "crypto":
        df = get_binance_history(symbol, days=500)
    else:
        df = get_yf_history(symbol, days=500)

    if df.empty or len(df) < MIN_TRAIN_ROWS:
        return []

    df = build_features(df)
    df["_future_close"] = df["close"].shift(-PREDICTION_HORIZON)
    df["target"] = np.where(df["_future_close"].isna(), np.nan,
                            (df["_future_close"] > df["close"]).astype(float))
    df = df.drop(columns=["_future_close"])
    df = df.dropna(subset=["target"] + [c for c in FEATURE_COLS if c in df.columns]).reset_index(drop=True)
    df["target"] = df["target"].astype(int)

    feat_cols = [c for c in FEATURE_COLS if c in df.columns]
    results   = []

    # Walk-forward: re-train every 5 steps
    window = 200
    for i in range(window, len(df), 5):
        X_tr = df[feat_cols].iloc[i - window:i].fillna(0)
        y_tr = df["target"].iloc[i - window:i]
        X_te = df[feat_cols].iloc[i:i+1].fillna(0)
        y_te = df["target"].iloc[i]

        if len(y_tr.unique()) < 2:
            continue

        sc = StandardScaler()
        X_tr_s = sc.fit_transform(X_tr)
        X_te_s = sc.transform(X_te)

        rf, gb, xgb = _train_ensemble(X_tr_s, y_tr.values)
        prob = float(_ensemble_proba(rf, gb, xgb, X_te_s)[0])
        pred = 1 if prob >= 0.5 else 0

        results.append({
            "date":     df["date"].iloc[i].strftime("%Y-%m-%d"),
            "price":    round(float(df["close"].iloc[i]), 6),
            "signal":   "BUY" if pred == 1 else "SELL",
            "correct":  bool(pred == int(y_te)),
            "prob":     round(prob * 100, 1),
        })

    return results[-60:]   # last 60 signal points


def _no_data_result(symbol: str) -> dict:
    return {
        "symbol":         symbol,
        "signal":         "HOLD",
        "signal_color":   "yellow",
        "score":          50.0,
        "ml_probability": 50.0,
        "confidence":     0.0,
        "current_price":  0,
        "error":          "Insufficient data for prediction",
        "backtest":       {},
        "indicators":     {},
        "disclaimer":     "Predictions are based on historical patterns only.",
    }
