from fastapi import APIRouter, Query
from data.asset_lists import REVOLUT_US_STOCKS, COMMSEC_AU_STOCKS
from services.data_fetcher import get_yf_price, get_chart_data
from services.predictor import predict_asset, get_backtest_chart
from services.scraper import get_news, get_asset_news

router = APIRouter()


# ─── US Stocks ────────────────────────────────────────────────

@router.get("/us/assets")
async def list_us_stocks(sector: str = Query("all")):
    """List US stocks available on Revolut."""
    assets = REVOLUT_US_STOCKS
    if sector != "all":
        assets = [s for s in assets if s["sector"].lower() == sector.lower()]
    return {"assets": assets, "total": len(assets), "platform": "Revolut"}


@router.get("/us/{symbol}/price")
async def get_us_price(symbol: str):
    return get_yf_price(symbol.upper(), market="us")


@router.get("/us/{symbol}/chart")
async def get_us_chart(symbol: str, period: str = Query("1y")):
    data = get_chart_data(symbol.upper(), asset_type="stock", period=period)
    return {"symbol": symbol.upper(), "period": period, "data": data}


@router.get("/us/{symbol}/predict")
async def predict_us_stock(symbol: str):
    return predict_asset(symbol.upper(), asset_type="stock")


@router.get("/us/{symbol}/backtest")
async def backtest_us_stock(symbol: str):
    return {"symbol": symbol.upper(), "signals": get_backtest_chart(symbol.upper(), "stock")}


@router.get("/us/{symbol}/news")
async def us_stock_news(symbol: str):
    return {"symbol": symbol.upper(), "news": get_asset_news(symbol.upper(), "us")}


@router.get("/us/news/feed")
async def us_news_feed():
    return {"news": get_news("us_stocks")}


@router.get("/us/sectors/list")
async def us_sectors():
    sectors = sorted(set(s["sector"] for s in REVOLUT_US_STOCKS))
    return {"sectors": sectors}


# ─── AU Stocks ────────────────────────────────────────────────

@router.get("/au/assets")
async def list_au_stocks(sector: str = Query("all")):
    """List AU stocks available on CommSec."""
    assets = COMMSEC_AU_STOCKS
    if sector != "all":
        assets = [s for s in assets if s["sector"].lower() == sector.lower()]
    return {"assets": assets, "total": len(assets), "platform": "CommSec"}


@router.get("/au/{symbol}/price")
async def get_au_price(symbol: str):
    # Ensure .AX suffix
    sym = symbol.upper()
    if not sym.endswith(".AX"):
        sym += ".AX"
    return get_yf_price(sym, market="au")


@router.get("/au/{symbol}/chart")
async def get_au_chart(symbol: str, period: str = Query("1y")):
    sym = symbol.upper()
    if not sym.endswith(".AX"):
        sym += ".AX"
    data = get_chart_data(sym, asset_type="stock", period=period)
    return {"symbol": sym, "period": period, "data": data}


@router.get("/au/{symbol}/predict")
async def predict_au_stock(symbol: str):
    sym = symbol.upper()
    if not sym.endswith(".AX"):
        sym += ".AX"
    return predict_asset(sym, asset_type="stock")


@router.get("/au/{symbol}/backtest")
async def backtest_au_stock(symbol: str):
    sym = symbol.upper()
    if not sym.endswith(".AX"):
        sym += ".AX"
    return {"symbol": sym, "signals": get_backtest_chart(sym, "stock")}


@router.get("/au/{symbol}/news")
async def au_stock_news(symbol: str):
    return {"symbol": symbol.upper(), "news": get_asset_news(symbol.upper(), "au")}


@router.get("/au/news/feed")
async def au_news_feed():
    return {"news": get_news("au_stocks")}


@router.get("/au/sectors/list")
async def au_sectors():
    sectors = sorted(set(s["sector"] for s in COMMSEC_AU_STOCKS))
    return {"sectors": sectors}
