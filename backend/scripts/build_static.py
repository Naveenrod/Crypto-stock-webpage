#!/usr/bin/env python3
"""
Build the static data set that powers the FinSight frontend.

Runs the full ML analysis (prediction + purged walk-forward backtest) for every
supported asset and writes plain JSON files that are published to GitHub Pages
by .github/workflows/data-refresh.yml. There is no server at runtime: the
frontend reads these files directly.

Output layout (relative to --out):
  manifest.json                     run metadata
  picks.json                        Top-5 per category (same shape the UI used from the API)
  assets/crypto.json                coin list (+ Binance/Revolut flags)
  assets/us.json, assets/au.json    stock lists with sectors
  analysis/<market>/<SYMBOL>.json   {prediction, signals, chart} per asset

Usage:
  python backend/scripts/build_static.py --out site/data [--limit 20] [--workers 2]
"""
from __future__ import annotations

import os

# One BLAS/OpenMP thread per process: the work is parallelised across worker
# processes, and multi-threaded BLAS pools inherited through fork() spin instead
# of computing. Must be set before numpy is imported anywhere in this process.
for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

import argparse
import json
import logging
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from data.asset_lists import BINANCE_COINS, REVOLUT_CRYPTO, REVOLUT_US_STOCKS, COMMSEC_AU_STOCKS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("build_static")

REFRESH_HOURS = int(os.getenv("REFRESH_HOURS", "6"))
MARKETS = {
    "crypto": [(c["symbol"], "crypto", c["name"]) for c in BINANCE_COINS],
    "us":     [(s["symbol"], "stock",  s["name"]) for s in REVOLUT_US_STOCKS],
    "au":     [(s["symbol"], "stock",  s["name"]) for s in COMMSEC_AU_STOCKS],
}


# ─── per-asset work (runs in worker processes) ───────────────────────────────

REUSE_BASE_URL = os.getenv("REUSE_BASE_URL", "").rstrip("/")


def _previous(market: str, symbol: str) -> dict | None:
    """Previously published analysis for this asset (None if unavailable)."""
    if not REUSE_BASE_URL:
        return None
    try:
        import requests
        r = requests.get(f"{REUSE_BASE_URL}/analysis/{market}/{symbol}.json", timeout=8)
        return r.json() if r.ok else None
    except Exception:
        return None


def analyse_one(task: tuple[str, str, str]) -> dict:
    """
    Full analysis + chart for one asset. Returns a serialisable dict.

    Efficiency: the model only depends on the daily candles, so if the latest
    candle is identical to the one in the previously published file (true for
    stocks on 3 of 4 daily runs, and for every asset on weekends) the previous
    result is reused instead of retraining.
    """
    market, symbol, asset_type = task
    from services.predictor import analyze_asset, HISTORY_DAYS          # imported in the worker
    from services.data_fetcher import get_binance_history, get_yf_history
    t0 = time.perf_counter()
    try:
        df = get_binance_history(symbol, HISTORY_DAYS) if asset_type == "crypto" else get_yf_history(symbol, HISTORY_DAYS)
        if not df.empty:
            prev = _previous(market, symbol)
            last = prev["chart"][-1] if prev and prev.get("chart") else None
            if (last and prev.get("prediction") and not prev["prediction"].get("error")
                    and last["date"] == df["date"].iloc[-1].strftime("%Y-%m-%d")
                    # published closes are rounded to 6 dp; compare at that precision
                    and abs(float(last["close"]) - round(float(df["close"].iloc[-1]), 6)) <= 1e-6
                    and len(prev["chart"]) >= len(df) - 1):
                return {"market": market, "symbol": symbol, "ok": True, "reused": True,
                        "prediction": prev["prediction"], "signals": prev.get("signals", []),
                        "chart": prev["chart"], "seconds": round(time.perf_counter() - t0, 2)}
        result = analyze_asset(symbol, asset_type)
        chart = [] if df.empty else [
            {
                "date":   row.date.strftime("%Y-%m-%d"),
                "open":   round(float(row.open), 6),
                "high":   round(float(row.high), 6),
                "low":    round(float(row.low), 6),
                "close":  round(float(row.close), 6),
                "volume": float(row.volume),
            }
            for row in df.itertuples(index=False)
        ]
        return {"market": market, "symbol": symbol, "ok": not result["prediction"].get("error"),
                "prediction": result["prediction"], "signals": result["signals"], "chart": chart,
                "seconds": round(time.perf_counter() - t0, 2)}
    except Exception as exc:                                               # never kill the batch
        log.warning("%s %s failed: %s", market, symbol, exc)
        return {"market": market, "symbol": symbol, "ok": False, "error": str(exc),
                "prediction": None, "signals": [], "chart": [], "seconds": round(time.perf_counter() - t0, 2)}


# ─── ranking (same rules the API used) ───────────────────────────────────────

def rank_top5(preds: list[dict]) -> list[dict]:
    buys  = sorted([p for p in preds if p["signal"] == "BUY"], key=lambda x: x["score"], reverse=True)
    other = sorted([p for p in preds if p["signal"] != "BUY"], key=lambda x: x["score"], reverse=True)
    return (buys + other)[:5]


def assemble_pick(pred: dict, market: str, name: str) -> dict:
    acc = pred.get("backtest", {}).get("accuracy")
    return {
        "symbol":            pred["symbol"],
        "name":              name,
        "asset_type":        pred["asset_type"],
        "category":          market,
        "signal":            pred["signal"],
        "score":             round(pred["score"], 1),
        "ml_probability":    round(pred["ml_probability"], 1),
        "confidence":        round(pred["confidence"], 1),
        "current_price":     pred["current_price"],
        "change_24h":        round(float(pred.get("change_24h", 0.0)), 2),
        "trend":             pred.get("trend", "Sideways"),
        "as_of":             pred.get("as_of"),
        "backtest_accuracy": round(acc, 1) if acc is not None else None,
        "indicators":        pred.get("indicators", {}),
    }


# ─── main ────────────────────────────────────────────────────────────────────

def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data")
    ap.add_argument("--limit", type=int, default=0, help="only the first N assets per market (for quick local runs)")
    ap.add_argument("--workers", type=int, default=max(1, min(4, os.cpu_count() or 1)))
    ap.add_argument("--timeout", type=int, default=1800, help="overall seconds before giving up on stragglers")
    args = ap.parse_args()

    out = Path(args.out)
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()

    tasks: list[tuple[str, str, str]] = []
    names: dict[tuple[str, str], str] = {}
    for market, items in MARKETS.items():
        for symbol, asset_type, name in (items[: args.limit] if args.limit else items):
            tasks.append((market, symbol, asset_type))
            names[(market, symbol)] = name
    log.info("analysing %d assets with %d worker(s) → %s", len(tasks), args.workers, out)

    results: dict[tuple[str, str], dict] = {}
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(analyse_one, t): t for t in tasks}
        try:
            for i, fut in enumerate(as_completed(futures, timeout=args.timeout), 1):
                r = fut.result()
                results[(r["market"], r["symbol"])] = r
                if i % 10 == 0 or i == len(tasks):
                    log.info("  %d/%d done (%.0fs elapsed)", i, len(tasks), time.perf_counter() - t0)
        except TimeoutError:
            log.warning("timeout after %ss — %d/%d assets finished", args.timeout, len(results), len(tasks))

    # ── per-asset files ──
    ok_by_market: dict[str, list[dict]] = {m: [] for m in MARKETS}
    for (market, symbol), r in results.items():
        if r["ok"] and r["prediction"]:
            write_json(out / "analysis" / market / f"{symbol}.json", {
                "market": market, "symbol": symbol, "name": names[(market, symbol)],
                "computed_at": started.isoformat(), "prediction": r["prediction"],
                "signals": r["signals"], "chart": r["chart"],
            })
            ok_by_market[market].append(r["prediction"])

    # ── picks.json ──
    total_ok = sum(len(v) for v in ok_by_market.values())
    picks = {
        "status": "ready", "partial": False,
        "progress": {"done": len(results), "total": len(tasks), "ok": total_ok},
        "crypto":    [assemble_pick(p, "crypto", names[("crypto", p["symbol"])]) for p in rank_top5(ok_by_market["crypto"])],
        "us_stocks": [assemble_pick(p, "us",     names[("us", p["symbol"])])     for p in rank_top5(ok_by_market["us"])],
        "au_stocks": [assemble_pick(p, "au",     names[("au", p["symbol"])])     for p in rank_top5(ok_by_market["au"])],
        "computed_at": started.isoformat(),
        "next_refresh_at": (started + timedelta(hours=REFRESH_HOURS)).isoformat(),
        "total_scanned": total_ok, "total_assets": len(tasks),
        "ttl_seconds": REFRESH_HOURS * 3600, "from_cache": True, "stale": False,
        "refresh_started": False, "refresh_available_in": None,
    }
    write_json(out / "picks.json", picks)

    # ── asset lists (static, but served from the same place for one source of truth) ──
    revolut = set(REVOLUT_CRYPTO)
    write_json(out / "assets" / "crypto.json", {
        "assets": [{**c, "on_binance": True, "on_revolut": c["symbol"] in revolut} for c in BINANCE_COINS]})
    write_json(out / "assets" / "us.json", {
        "platform": "Revolut", "sectors": sorted({s["sector"] for s in REVOLUT_US_STOCKS}), "assets": REVOLUT_US_STOCKS})
    write_json(out / "assets" / "au.json", {
        "platform": "CommSec", "sectors": sorted({s["sector"] for s in COMMSEC_AU_STOCKS}), "assets": COMMSEC_AU_STOCKS})

    reused = sum(1 for r in results.values() if r.get("reused"))
    failed = [f"{m}:{s}" for (m, s), r in results.items() if not r["ok"]]
    missing = [f"{m}:{s}" for (m, s, _) in tasks if (m, s) not in results]
    manifest = {
        "computed_at": started.isoformat(), "duration_seconds": round(time.perf_counter() - t0),
        "assets_total": len(tasks), "assets_ok": total_ok, "failed": failed, "missing": missing,
        "reused": reused, "recomputed": total_ok - reused, "refresh_hours": REFRESH_HOURS,
    }
    write_json(out / "manifest.json", manifest)
    log.info("done: %d/%d assets ok (%d reused, %d recomputed) in %ds; failed=%s",
             total_ok, len(tasks), reused, total_ok - reused, manifest["duration_seconds"], failed[:10])
    return 0 if total_ok >= max(1, len(tasks) // 2) else 1       # fail the job if most assets failed


if __name__ == "__main__":
    sys.exit(main())
