from typing import Literal
from fastapi import APIRouter, Query
from services.scraper import get_news

router = APIRouter()

# Only these four values are accepted; anything else gets a 422 from FastAPI
_VALID_CATEGORIES = Literal["all", "crypto", "us_stocks", "au_stocks"]


@router.get("")
async def news_feed(
    category: _VALID_CATEGORIES = Query("all"),
):
    """Aggregated news feed from trusted financial-news sources."""
    return {"category": category, "news": get_news(category)}
