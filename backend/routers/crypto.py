from fastapi import APIRouter, Query
from data.asset_lists import BINANCE_COINS, REVOLUT_CRYPTO
from services.data_fetcher import get_all_binance_prices, get_binance_price, get_chart_data
from services.predictor import predict_asset, get_backtest_chart
from services.scraper import get_news, get_asset_news

router = APIRouter()


@router.get("/assets")
async def list_crypto_assets(platform: str = Query("all", description="all | binance | revolut")):
    """List all crypto assets with live prices."""
    if platform == "binance":
        asset_list = BINANCE_COINS
    elif platform == "revolut":
        revolut_set = set(REVOLUT_CRYPTO)
        asset_list  = [c for c in BINANCE_COINS if c["symbol"] in revolut_set]
    else:
        asset_list = BINANCE_COINS

    symbols = [a["symbol"] for a in asset_list]
    prices  = get_all_binance_prices(symbols)
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
            "on_binance":  asset["symbol"] in {c["symbol"] for c in BINANCE_COINS},
            "on_revolut":  asset["symbol"] in set(REVOLUT_CRYPTO),
        })
    return {"assets": results, "total": len(results)}


@router.get("/{symbol}/price")
async def get_crypto_price(symbol: str):
    return get_binance_price(symbol.upper())


@router.get("/{symbol}/chart")
async def get_crypto_chart(symbol: str, period: str = Query("1y", description="1w|1m|3m|6m|1y|2y")):
    data = get_chart_data(symbol.upper(), asset_type="crypto", period=period)
    return {"symbol": symbol.upper(), "period": period, "data": data}


@router.get("/{symbol}/predict")
async def predict_crypto(symbol: str):
    return predict_asset(symbol.upper(), asset_type="crypto")


@router.get("/{symbol}/backtest")
async def backtest_crypto(symbol: str):
    return {"symbol": symbol.upper(), "signals": get_backtest_chart(symbol.upper(), "crypto")}


@router.get("/{symbol}/news")
async def crypto_news(symbol: str):
    return {"symbol": symbol.upper(), "news": get_asset_news(symbol.upper(), "crypto")}


@router.get("/news/feed")
async def crypto_news_feed():
    return {"news": get_news("crypto")}
