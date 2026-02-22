import re
from typing import Literal
from fastapi import APIRouter, Query, HTTPException, Path
from data.asset_lists import REVOLUT_US_STOCKS, COMMSEC_AU_STOCKS
from services.data_fetcher import get_yf_price, get_chart_data
from services.predictor import predict_asset, get_backtest_chart
from services.scraper import get_news, get_asset_news

router = APIRouter()

# ── Whitelists ─────────────────────────────────────────────────
_US_SYMBOLS   = frozenset(s["symbol"] for s in REVOLUT_US_STOCKS)
_AU_SYMBOLS   = frozenset(s["symbol"] for s in COMMSEC_AU_STOCKS)
_SYMBOL_RE    = re.compile(r"^[A-Z0-9.\-]{1,20}$")
_US_SECTORS   = frozenset(s["sector"] for s in REVOLUT_US_STOCKS) | {"all"}
_AU_SECTORS   = frozenset(s["sector"] for s in COMMSEC_AU_STOCKS) | {"all"}


def _validate_us_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if not _SYMBOL_RE.match(s):
        raise HTTPException(status_code=422, detail="Invalid symbol format")
    if s not in _US_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"'{s}' not in Revolut US stock list")
    return s


def _validate_au_symbol(symbol: str) -> str:
    s = symbol.upper().strip()
    if not s.endswith(".AX"):
        s = s + ".AX"
    if not _SYMBOL_RE.match(s):
        raise HTTPException(status_code=422, detail="Invalid AU symbol format")
    if s not in _AU_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"'{s}' not in CommSec AU stock list")
    return s


# ─── US Stocks ────────────────────────────────────────────────

@router.get("/us/news/feed")
async def us_news_feed():
    return {"news": get_news("us_stocks")}


@router.get("/us/sectors/list")
async def us_sectors():
    sectors = sorted(s["sector"] for s in REVOLUT_US_STOCKS)
    return {"sectors": list(dict.fromkeys(sectors))}


@router.get("/us/assets")
async def list_us_stocks(sector: str = Query("all", max_length=50)):
    if sector not in _US_SECTORS:
        raise HTTPException(status_code=422, detail=f"Unknown sector '{sector}'")
    assets = REVOLUT_US_STOCKS if sector == "all" else [s for s in REVOLUT_US_STOCKS if s["sector"] == sector]
    return {"assets": assets, "total": len(assets), "platform": "Revolut"}


@router.get("/us/{symbol}/price")
async def get_us_price(symbol: str = Path(..., max_length=20)):
    s = _validate_us_symbol(symbol)
    return get_yf_price(s, market="us")


@router.get("/us/{symbol}/chart")
async def get_us_chart(
    symbol: str = Path(..., max_length=20),
    period: Literal["1w", "1m", "3m", "6m", "1y", "2y"] = Query("1y"),
):
    s = _validate_us_symbol(symbol)
    return {"symbol": s, "period": period, "data": get_chart_data(s, asset_type="stock", period=period)}


@router.get("/us/{symbol}/predict")
async def predict_us_stock(symbol: str = Path(..., max_length=20)):
    s = _validate_us_symbol(symbol)
    return predict_asset(s, asset_type="stock")


@router.get("/us/{symbol}/backtest")
async def backtest_us_stock(symbol: str = Path(..., max_length=20)):
    s = _validate_us_symbol(symbol)
    return {"symbol": s, "signals": get_backtest_chart(s, "stock")}


@router.get("/us/{symbol}/news")
async def us_stock_news(symbol: str = Path(..., max_length=20)):
    s = _validate_us_symbol(symbol)
    return {"symbol": s, "news": get_asset_news(s, "us")}


# ─── AU Stocks ────────────────────────────────────────────────

@router.get("/au/news/feed")
async def au_news_feed():
    return {"news": get_news("au_stocks")}


@router.get("/au/sectors/list")
async def au_sectors():
    sectors = sorted(s["sector"] for s in COMMSEC_AU_STOCKS)
    return {"sectors": list(dict.fromkeys(sectors))}


@router.get("/au/assets")
async def list_au_stocks(sector: str = Query("all", max_length=50)):
    if sector not in _AU_SECTORS:
        raise HTTPException(status_code=422, detail=f"Unknown sector '{sector}'")
    assets = COMMSEC_AU_STOCKS if sector == "all" else [s for s in COMMSEC_AU_STOCKS if s["sector"] == sector]
    return {"assets": assets, "total": len(assets), "platform": "CommSec"}


@router.get("/au/{symbol}/price")
async def get_au_price(symbol: str = Path(..., max_length=20)):
    s = _validate_au_symbol(symbol)
    return get_yf_price(s, market="au")


@router.get("/au/{symbol}/chart")
async def get_au_chart(
    symbol: str = Path(..., max_length=20),
    period: Literal["1w", "1m", "3m", "6m", "1y", "2y"] = Query("1y"),
):
    s = _validate_au_symbol(symbol)
    return {"symbol": s, "period": period, "data": get_chart_data(s, asset_type="stock", period=period)}


@router.get("/au/{symbol}/predict")
async def predict_au_stock(symbol: str = Path(..., max_length=20)):
    s = _validate_au_symbol(symbol)
    return predict_asset(s, asset_type="stock")


@router.get("/au/{symbol}/backtest")
async def backtest_au_stock(symbol: str = Path(..., max_length=20)):
    s = _validate_au_symbol(symbol)
    return {"symbol": s, "signals": get_backtest_chart(s, "stock")}


@router.get("/au/{symbol}/news")
async def au_stock_news(symbol: str = Path(..., max_length=20)):
    s = _validate_au_symbol(symbol)
    return {"symbol": s, "news": get_asset_news(s, "au")}
