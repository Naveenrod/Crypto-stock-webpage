import re
from typing import Literal
from fastapi import APIRouter, Query, HTTPException, Path
from data.asset_lists import BINANCE_COINS, REVOLUT_CRYPTO
from services.data_fetcher import get_all_binance_prices, get_binance_price, get_chart_data
from services.predictor import predict_asset, get_backtest_chart
from services.scraper import get_news, get_asset_news

router = APIRouter()

# ── Whitelists ────────────────────────────────────────────────
_BINANCE_SYMBOLS = frozenset(c["symbol"] for c in BINANCE_COINS)
_REVOLUT_SYMBOLS = frozenset(REVOLUT_CRYPTO)
_ALL_CRYPTO      = _BINANCE_SYMBOLS | _REVOLUT_SYMBOLS
_SYMBOL_RE       = re.compile(r"^[A-Z0-9]{1,20}$")


def _validate_crypto_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if not _SYMBOL_RE.match(s):
        raise HTTPException(status_code=422, detail="Invalid symbol format")
    if s not in _ALL_CRYPTO:
        raise HTTPException(status_code=404, detail=f"Symbol '{s}' not in supported crypto list")
    return s


@router.get("/news/feed")
async def crypto_news_feed():
    return {"news": get_news("crypto")}


@router.get("/assets")
async def list_crypto_assets(
    platform: Literal["all", "binance", "revolut"] = Query("all"),
):
    """List all crypto assets with live prices."""
    if platform == "binance":
        asset_list = BINANCE_COINS
    elif platform == "revolut":
        asset_list = [c for c in BINANCE_COINS if c["symbol"] in _REVOLUT_SYMBOLS]
    else:
        asset_list = BINANCE_COINS

    symbols   = [a["symbol"] for a in asset_list]
    prices    = get_all_binance_prices(symbols)
    price_map = {p["symbol"]: p for p in prices}

    results = []
    for asset in asset_list:
        p = price_map.get(asset["symbol"], {})
        results.append({
            **asset,
            "price":      p.get("price", 0),
            "change_24h": p.get("change_24h", 0),
            "volume_24h": p.get("volume_24h", 0),
            "high_24h":   p.get("high_24h", 0),
            "low_24h":    p.get("low_24h", 0),
            "on_binance": asset["symbol"] in _BINANCE_SYMBOLS,
            "on_revolut": asset["symbol"] in _REVOLUT_SYMBOLS,
        })
    return {"assets": results, "total": len(results)}


@router.get("/{symbol}/price")
async def get_crypto_price(symbol: str = Path(..., max_length=20)):
    s = _validate_crypto_symbol(symbol)
    return get_binance_price(s)


@router.get("/{symbol}/chart")
async def get_crypto_chart(
    symbol: str = Path(..., max_length=20),
    period: Literal["1w", "1m", "3m", "6m", "1y", "2y"] = Query("1y"),
):
    s = _validate_crypto_symbol(symbol)
    return {"symbol": s, "period": period, "data": get_chart_data(s, asset_type="crypto", period=period)}


@router.get("/{symbol}/predict")
async def predict_crypto(symbol: str = Path(..., max_length=20)):
    s = _validate_crypto_symbol(symbol)
    return predict_asset(s, asset_type="crypto")


@router.get("/{symbol}/backtest")
async def backtest_crypto(symbol: str = Path(..., max_length=20)):
    s = _validate_crypto_symbol(symbol)
    return {"symbol": s, "signals": get_backtest_chart(s, "crypto")}


@router.get("/{symbol}/news")
async def crypto_asset_news(symbol: str = Path(..., max_length=20)):
    s = _validate_crypto_symbol(symbol)
    return {"symbol": s, "news": get_asset_news(s, "crypto")}
