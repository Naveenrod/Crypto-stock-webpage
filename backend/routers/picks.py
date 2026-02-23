"""
Top-5 Picks Router
──────────────────
Scans all 235 assets (70 crypto + 89 US stocks + 76 AU stocks) in parallel
using the ML ensemble and returns the top-5 ranked by composite score for
each category.

First response: ~60-120 s (cold scan, 32-worker ThreadPoolExecutor, interleaved).
Subsequent responses within 5 min: <1 s (TTLCache hit).
"""

import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from itertools import zip_longest
from typing import Optional

# Hard cap on the full scan so hung yfinance calls don't block indefinitely.
# Any assets not completed within 90 s are skipped; remaining results are ranked.
_SCAN_TIMEOUT_SECONDS = 180   # 3-min safety net for slow yfinance calls

from cachetools import TTLCache
from fastapi import APIRouter

from data.asset_lists import BINANCE_COINS, REVOLUT_US_STOCKS, COMMSEC_AU_STOCKS
from services.data_fetcher import get_all_binance_prices
from services.predictor import quick_predict_asset

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Asset name lookup maps (built once at import, O(1) lookups) ───────────────
_CRYPTO_NAME_MAP: dict[str, str] = {c["symbol"]: c["name"] for c in BINANCE_COINS}
_US_NAME_MAP:     dict[str, str] = {s["symbol"]: s["name"] for s in REVOLUT_US_STOCKS}
_AU_NAME_MAP:     dict[str, str] = {s["symbol"]: s["name"] for s in COMMSEC_AU_STOCKS}

# ── Symbol lists (BINANCE_COINS only for crypto — avoids Revolut duplicates) ──
_CRYPTO_SYMBOLS: list[str] = [c["symbol"] for c in BINANCE_COINS]      # 70
_US_SYMBOLS:     list[str] = [s["symbol"] for s in REVOLUT_US_STOCKS]  # 89
_AU_SYMBOLS:     list[str] = [s["symbol"] for s in COMMSEC_AU_STOCKS]  # 76
_US_SYMBOL_SET:  frozenset = frozenset(_US_SYMBOLS)

# ── Result cache: stores the entire picks result for 5 min ────────────────────
_picks_cache:    TTLCache    = TTLCache(maxsize=1, ttl=300)
_CACHE_KEY                   = "top5_picks"
_build_lock:     threading.Lock = threading.Lock()  # prevents concurrent cold-start stampede


# ─────────────────────────── helpers ─────────────────────────────────────────

def _safe_predict(symbol: str, asset_type: str, category: str) -> Optional[dict]:
    """
    Call quick_predict_asset() (no walk-forward backtest → ~6-8x faster)
    and tag the result with a `_category` field.
    Returns None on any error so callers can simply skip it.
    """
    try:
        result = quick_predict_asset(symbol, asset_type)
        if result.get("error"):
            return None
        result["_category"] = category   # "crypto" | "us" | "au"
        return result
    except Exception as exc:
        logger.warning("[picks] quick_predict_asset failed for %s (%s): %s", symbol, asset_type, exc)
        return None


def _rank_top5(predictions: list[dict]) -> list[dict]:
    """
    Sort: BUY first (by score DESC), then HOLD/SELL (by score DESC). Take top 5.
    """
    buys  = sorted([p for p in predictions if p["signal"] == "BUY"],  key=lambda x: x["score"], reverse=True)
    other = sorted([p for p in predictions if p["signal"] != "BUY"],  key=lambda x: x["score"], reverse=True)
    return (buys + other)[:5]


def _assemble_pick(pred: dict, name: str, change_24h: float) -> dict:
    """Build the lean pick dict for the frontend."""
    return {
        "symbol":            pred["symbol"],
        "name":              name,
        "asset_type":        pred["asset_type"],    # "crypto" or "stock"
        "signal":            pred["signal"],
        "score":             round(pred["score"], 1),
        "ml_probability":    round(pred["ml_probability"], 1),
        "confidence":        round(pred["confidence"], 1),
        "current_price":     pred["current_price"],
        "change_24h":        round(change_24h, 2),
        "trend":             pred.get("trend", "Sideways"),
        "backtest_accuracy": round(pred.get("backtest", {}).get("accuracy", 0), 1),
        "indicators":        pred.get("indicators", {}),
    }


def _build_all_picks() -> dict:
    """
    Run all 235 predictions in parallel, rank by category, enrich with
    change_24h, and return the completed result dict.

    Designed to run in a thread (called via run_in_executor) so it doesn't
    block the FastAPI event loop.
    """
    started_at = datetime.now(timezone.utc)

    # Build the full task list: (symbol, asset_type, category)
    # Interleave crypto/us/au so all three categories get worker slots immediately.
    # Without interleaving, all 16 workers fill with crypto first; AU stocks
    # wait in the queue until crypto + US finish, then hit the scan timeout.
    crypto_tasks = [(s, "crypto", "crypto") for s in _CRYPTO_SYMBOLS]
    us_tasks     = [(s, "stock",  "us")     for s in _US_SYMBOLS]
    au_tasks     = [(s, "stock",  "au")     for s in _AU_SYMBOLS]
    tasks: list[tuple[str, str, str]] = [
        t for group in zip_longest(crypto_tasks, us_tasks, au_tasks)
        for t in group if t is not None
    ]

    # ── Step 1: Pre-fetch crypto batch prices (1 network call → change_24h map) ──
    try:
        crypto_price_list = get_all_binance_prices(_CRYPTO_SYMBOLS)
        crypto_chg_map: dict[str, float] = {
            p["symbol"]: p.get("change_24h", 0.0) for p in crypto_price_list
        }
    except Exception as exc:
        logger.warning("[picks] Batch crypto price prefetch failed: %s", exc)
        crypto_chg_map = {}

    # ── Step 2: Run all 235 predict_asset() calls in parallel ─────────────────
    crypto_results: list[dict] = []
    us_results:     list[dict] = []
    au_results:     list[dict] = []
    total_ok = 0

    # Use explicit lifecycle (not `with`) so shutdown(wait=False) can be called
    # after a timeout — this avoids blocking on yfinance calls that hang indefinitely.
    # 32 workers: yfinance downloads release the GIL (I/O-bound),
    # so extra threads improve throughput even on a GIL-limited interpreter.
    executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="picks")
    try:
        future_to_meta = {
            executor.submit(_safe_predict, sym, atype, cat): (sym, cat)
            for sym, atype, cat in tasks
        }
        try:
            for future in as_completed(future_to_meta, timeout=_SCAN_TIMEOUT_SECONDS):
                result = future.result()   # _safe_predict never raises
                if result is None:
                    continue
                total_ok += 1
                cat = result.pop("_category")
                if cat == "crypto":
                    crypto_results.append(result)
                elif cat == "us":
                    us_results.append(result)
                else:
                    au_results.append(result)
        except FuturesTimeoutError:
            # Cancel queued (not-yet-started) futures
            for f in future_to_meta:
                f.cancel()
            logger.warning(
                "[picks] Scan hit %ds timeout; %d/%d assets completed — proceeding with partial results.",
                _SCAN_TIMEOUT_SECONDS, total_ok, len(tasks),
            )
    finally:
        # wait=False: don't block the response waiting for stuck yfinance threads.
        # Those threads will finish on their own; their results are discarded.
        executor.shutdown(wait=False)

    # ── Step 3: Rank each category ────────────────────────────────────────────
    top_crypto = _rank_top5(crypto_results)
    top_us     = _rank_top5(us_results)
    top_au     = _rank_top5(au_results)

    # ── Step 4: Enrich top picks with change_24h ──────────────────────────────
    # Crypto: use pre-fetched batch map
    crypto_picks = [
        _assemble_pick(p, _CRYPTO_NAME_MAP.get(p["symbol"], p["symbol"]),
                       crypto_chg_map.get(p["symbol"], 0.0))
        for p in top_crypto
    ]

    # US/AU stocks: reuse change_24h already computed from last 2 candles in
    # quick_predict_asset (eliminates 10 sequential get_yf_price calls that were
    # adding ~30-50 s of extra latency after the scan timeout fired).
    us_picks = [
        _assemble_pick(p, _US_NAME_MAP.get(p["symbol"], p["symbol"]),
                       p.get("change_24h", 0.0))
        for p in top_us
    ]

    au_picks = [
        _assemble_pick(p, _AU_NAME_MAP.get(p["symbol"], p["symbol"]),
                       p.get("change_24h", 0.0))
        for p in top_au
    ]

    return {
        "crypto":        crypto_picks,
        "us_stocks":     us_picks,
        "au_stocks":     au_picks,
        "computed_at":   started_at.isoformat(),
        "total_scanned": total_ok,
        "ttl_seconds":   300,
    }


def _locked_build() -> dict:
    """
    Double-checked locking: ensures only one thread runs the full scan even
    when multiple requests arrive simultaneously on a cold cache.
    """
    # First check (outside lock — fast path for most callers)
    if _CACHE_KEY in _picks_cache:
        return _picks_cache[_CACHE_KEY]

    with _build_lock:
        # Second check (inside lock — guards against stampede)
        if _CACHE_KEY in _picks_cache:
            return _picks_cache[_CACHE_KEY]

        result = _build_all_picks()
        _picks_cache[_CACHE_KEY] = result
        return result


# ─────────────────────────── endpoint ────────────────────────────────────────

@router.get("/top5")
async def get_top_picks():
    """
    Full scan of all 235 assets. Returns top 5 per category ranked by ML score.

    - First response: ~30-60 s (cold ML scan across 235 assets).
    - Cached response (within 5 min): < 1 s.
    - BUY signals appear before HOLD/SELL within each category.
    """
    # Serve from cache if available (avoids executor overhead)
    if _CACHE_KEY in _picks_cache:
        return {**_picks_cache[_CACHE_KEY], "from_cache": True}

    # Move the blocking computation off the async event loop
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _locked_build)
    return {**result, "from_cache": False}
