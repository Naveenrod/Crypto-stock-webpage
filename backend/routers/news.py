from fastapi import APIRouter, Query
from services.scraper import get_news

router = APIRouter()


@router.get("/")
async def news_feed(category: str = Query("all", description="all | crypto | us_stocks | au_stocks")):
    """Aggregated news feed from trusted sources."""
    return {"category": category, "news": get_news(category)}
