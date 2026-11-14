"""
Top-5 Picks Router
──────────────────
Scans every supported asset (70 crypto + 87 US + 75 AU) with the ML ensemble's
fast path and keeps the top-5 per category ranked by composite score.

The scan runs in the BACKGROUND and never blocks a request:
  • it starts at app startup (warm-up) and again whenever results are older
    than PICKS_TTL (default 1 h — the inputs are daily candles)
  • /api/picks/top5 returns immediately with whatever is ranked so far plus a
    progress counter, so the UI can show picks streaming in on a cold start
  • once a scan has completed, its results keep being served (flagged `stale`)
    while the next refresh runs
  • ?refresh=true forces a rescan, rate-limited to one per PICKS_MIN_REFRESH
"""

import logging
import os
import threading
import time
from concurrent.futures import as_completed, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from itertools import zip_longest
from typing import Optional

from fastapi import APIRouter, Query

from data.asset_lists import BINANCE_COINS, REVOLUT_US_STOCKS, COMMSEC_AU_STOCKS
from services.data_fetcher import get_all_binance_prices
from services.executor import scan_executor
from services.predictor import quick_predict_asset

router = APIRouter()
logger = logging.getLogger(__name__)

PICKS_TTL        = int(os.getenv("PICKS_TTL_SECONDS", "3600"))
MIN_REFRESH_GAP  = int(os.getenv("PICKS_MIN_REFRESH_SECONDS", "600"))
SCAN_DEADLINE    = int(os.getenv("PICKS_SCAN_DEADLINE_SECONDS", "1500"))

# ── Asset name lookup maps ────────────────────────────────────────────────────
_NAME_MAP: dict[str, dict[str, str]] = {
    "crypto": {c["symbol"]: c["name"] for c in BINANCE_COINS},
    "us":     {s["symbol"]: s["name"] for s in REVOLUT_US_STOCKS},
    "au":     {s["symbol"]: s["name"] for s in COMMSEC_AU_STOCKS},
}
_CRYPTO_SYMBOLS = [c["symbol"] for c in BINANCE_COINS]

# Interleave categories so each gets results early instead of crypto first.
_TASKS: list[tuple[str, str, str]] = [
    t for group in zip_longest(
        [(s, "crypto", "crypto") for s in _CRYPTO_SYMBOLS],
        [(s["symbol"], "stock", "us") for s in REVOLUT_US_STOCKS],
        [(s["symbol"], "stock", "au") for s in COMMSEC_AU_STOCKS],
    ) for t in group if t is not None
]
TOTAL_ASSETS = len(_TASKS)

_EMPTY = lambda: {"crypto": [], "us": [], "au": []}   # noqa: E731

_lock = threading.Lock()
_state: dict = {
    "status":      "idle",        # idle | scanning | ready | error
    "started_at":  None,
    "computed_at": None,          # ISO time the last COMPLETED scan started
    "computed_ts": None,          # same, epoch seconds
    "done":        0,
    "ok":          0,
    "results":     _EMPTY(),      # last completed scan
    "partial":     _EMPTY(),      # scan in progress
    "crypto_chg":  {},
    "last_error":  None,
}


# ─────────────────────────── helpers ─────────────────────────────────────────

def _safe_predict(symbol: str, asset_type: str, category: str) -> Optional[dict]:
    try:
        result = quick_predict_asset(symbol, asset_type)
        if result.get("error"):
            return None
        result = dict(result)
        result["_category"] = category
        return result
    except Exception as exc:
        logger.warning("[picks] prediction failed for %s (%s): %s", symbol, asset_type, exc)
        return None


def _rank_top5(predictions: list[dict]) -> list[dict]:
    """BUY first (score DESC), then HOLD/SELL (score DESC). Top 5."""
    buys  = sorted([p for p in predictions if p["signal"] == "BUY"], key=lambda x: x["score"], reverse=True)
    other = sorted([p for p in predictions if p["signal"] != "BUY"], key=lambda x: x["score"], reverse=True)
    return (buys + other)[:5]


def _assemble_pick(pred: dict, category: str, crypto_chg: dict) -> dict:
    sym = pred["symbol"]
    change = crypto_chg.get(sym) if category == "crypto" else None
    if change is None:
        change = pred.get("change_24h", 0.0)
    backtest_acc = pred.get("backtest", {}).get("accuracy")
    return {
        "symbol":            sym,
        "name":              _NAME_MAP[category].get(sym, sym),
        "asset_type":        pred["asset_type"],
        "category":          category,
        "signal":            pred["signal"],
        "score":             round(pred["score"], 1),
        "ml_probability":    round(pred["ml_probability"], 1),
        "confidence":        round(pred["confidence"], 1),
        "current_price":     pred["current_price"],
        "change_24h":        round(float(change), 2),
        "trend":             pred.get("trend", "Sideways"),
        "as_of":             pred.get("as_of"),
        "backtest_accuracy": round(backtest_acc, 1) if backtest_acc is not None else None,
        "indicators":        pred.get("indicators", {}),
    }


def _run_scan() -> None:
    """Coordinator: fan out every asset to the scan pool, record progress."""
    started = datetime.now(timezone.utc)
    with _lock:
        _state.update(status="scanning", started_at=started.isoformat(), done=0, ok=0,
                      partial=_EMPTY(), last_error=None)
    t0 = time.perf_counter()
    try:
        try:
            crypto_chg = {p["symbol"]: p.get("change_24h", 0.0) for p in get_all_binance_prices(_CRYPTO_SYMBOLS)}
        except Exception as exc:
            logger.warning("[picks] batch crypto price prefetch failed: %s", exc)
            crypto_chg = {}

        futures = {scan_executor.submit(_safe_predict, s, t, c): s for s, t, c in _TASKS}
        try:
            for fut in as_completed(futures, timeout=SCAN_DEADLINE):
                res = fut.result()
                with _lock:
                    _state["done"] += 1
                    if res is not None:
                        _state["ok"] += 1
                        _state["partial"][res.pop("_category")].append(res)
        except FuturesTimeoutError:
            for f in futures:
                f.cancel()
            logger.warning("[picks] scan deadline (%ss) reached; keeping partial results", SCAN_DEADLINE)

        with _lock:
            _state["results"]     = _state["partial"]
            _state["partial"]     = _EMPTY()
            _state["crypto_chg"]  = crypto_chg
            _state["computed_at"] = started.isoformat()
            _state["computed_ts"] = started.timestamp()
            _state["status"]      = "ready"
            ok, done = _state["ok"], _state["done"]
        logger.info("[picks] scan complete: %d/%d assets ok in %.0fs", ok, done, time.perf_counter() - t0)
    except Exception as exc:                       # keep serving old results
        logger.exception("[picks] scan failed")
        with _lock:
            _state["status"]     = "ready" if _state["computed_at"] else "error"
            _state["last_error"] = str(exc)


def start_scan(force: bool = False) -> bool:
    """Start a background scan unless one is running or results are fresh."""
    with _lock:
        if _state["status"] == "scanning":
            return False
        fresh = _state["computed_ts"] is not None and (time.time() - _state["computed_ts"]) < PICKS_TTL
        if fresh and not force:
            return False
        _state["status"] = "scanning"             # claim before the thread starts
    threading.Thread(target=_run_scan, name="picks-scan", daemon=True).start()
    return True


def get_scan_status() -> dict:
    with _lock:
        return {
            "status":      _state["status"],
            "progress":    {"done": _state["done"], "total": TOTAL_ASSETS, "ok": _state["ok"]},
            "computed_at": _state["computed_at"],
            "last_error":  _state["last_error"],
        }


def _snapshot(refresh_started: bool, refresh_available_in: Optional[int]) -> dict:
    with _lock:
        has_results = any(_state["results"].values())
        source      = _state["results"] if has_results else _state["partial"]
        is_partial  = not has_results
        crypto_chg  = _state["crypto_chg"]
        ranked = {cat: [_assemble_pick(p, cat, crypto_chg) for p in _rank_top5(lst)] for cat, lst in source.items()}
        scanned = _state["ok"] if is_partial else sum(len(v) for v in source.values())
        age = (time.time() - _state["computed_ts"]) if _state["computed_ts"] else None
        return {
            "status":        _state["status"],
            "progress":      {"done": _state["done"], "total": TOTAL_ASSETS, "ok": _state["ok"]},
            "partial":       is_partial,
            "crypto":        ranked["crypto"],
            "us_stocks":     ranked["us"],
            "au_stocks":     ranked["au"],
            "computed_at":   _state["computed_at"] or _state["started_at"],
            "total_scanned": scanned,
            "total_assets":  TOTAL_ASSETS,
            "ttl_seconds":   PICKS_TTL,
            "from_cache":    has_results,
            "stale":         bool(age is not None and age > PICKS_TTL),
            "refresh_started":      refresh_started,
            "refresh_available_in": refresh_available_in,
        }


# ─────────────────────────── endpoint ────────────────────────────────────────

@router.get("/top5")
async def get_top_picks(refresh: bool = Query(False, description="Force a rescan (rate-limited)")):
    """
    Top 5 per category ranked by ML score. Never blocks:
    - `status` is `scanning` while a scan runs; `progress.done/total` is live
    - `partial` is true when the lists come from a scan still in progress
    - results are refreshed in the background once older than `ttl_seconds`
    """
    refresh_started = False
    refresh_available_in: Optional[int] = None
    if refresh:
        with _lock:
            last = _state["computed_ts"]
        if last is None or (time.time() - last) >= MIN_REFRESH_GAP:
            refresh_started = start_scan(force=True)
        else:
            refresh_available_in = int(MIN_REFRESH_GAP - (time.time() - last))
    else:
        start_scan()
    return _snapshot(refresh_started, refresh_available_in)
