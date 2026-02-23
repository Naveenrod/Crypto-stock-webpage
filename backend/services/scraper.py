"""
News Scraper Service
────────────────────
Aggregates financial news from trusted RSS feeds:
  • Crypto:  CoinDesk, CoinTelegraph, Decrypt, The Block
  • Stocks:  Reuters Finance, Yahoo Finance, MarketWatch, Seeking Alpha
  • AU:      ABC News Business, The Australian Financial Review (RSS)
"""

import feedparser
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
import logging
from cachetools import TTLCache

logger = logging.getLogger(__name__)

_news_cache = TTLCache(maxsize=50, ttl=300)   # cache 5 min

RSS_FEEDS = {
    "crypto": [
        ("CoinDesk",        "https://www.coindesk.com/arc/outboundfeeds/rss/"),
        ("CoinTelegraph",   "https://cointelegraph.com/rss"),
        ("Decrypt",         "https://decrypt.co/feed"),
        ("The Block",       "https://www.theblock.co/rss.xml"),
        ("CryptoSlate",     "https://cryptoslate.com/feed/"),
        ("Bitcoin Magazine","https://bitcoinmagazine.com/.rss/full/"),
    ],
    "us_stocks": [
        ("Reuters Business","https://feeds.reuters.com/reuters/businessNews"),
        ("Yahoo Finance",   "https://finance.yahoo.com/news/rssindex"),
        ("MarketWatch",     "https://feeds.marketwatch.com/marketwatch/topstories/"),
        ("Investopedia",    "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline"),
        ("Seeking Alpha",   "https://seekingalpha.com/market_currents.xml"),
    ],
    "au_stocks": [
        ("ABC Business",    "https://www.abc.net.au/news/feed/2942/rss.xml"),
        ("AFR",             "https://www.afr.com/rss"),
        ("ASX News",        "https://www.asx.com.au/content/dam/asx/newsroom/rss.xml"),
        ("The Australian",  "https://www.theaustralian.com.au/feed"),
        ("SMH Business",    "https://www.smh.com.au/rss/business.xml"),
    ],
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


def _parse_date(entry) -> str:
    """Parse a date from an RSS entry into ISO format string."""
    for attr in ("published_parsed", "updated_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                return datetime(*t[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass
    return datetime.utcnow().isoformat()


def _fetch_feed(source_name: str, url: str, max_items: int = 8) -> list[dict]:
    """Fetch a single RSS feed and return a list of news items."""
    try:
        # Use requests with explicit timeout so feeds can't hang indefinitely.
        # feedparser.parse(url) has no timeout and will block forever on slow feeds.
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        feed = feedparser.parse(resp.content)
        items = []
        for entry in feed.entries[:max_items]:
            title   = entry.get("title", "").strip()
            link    = entry.get("link", "")
            summary = entry.get("summary", "") or entry.get("description", "")
            # Strip HTML from summary
            if summary:
                soup    = BeautifulSoup(summary, "lxml")
                summary = soup.get_text(separator=" ").strip()[:300]
            if title:
                items.append({
                    "source":    source_name,
                    "title":     title,
                    "summary":   summary,
                    "url":       link,
                    "published": _parse_date(entry),
                })
        return items
    except Exception as e:
        logger.warning(f"Feed error [{source_name}]: {e}")
        return []


def get_news(category: str = "crypto", max_per_source: int = 6) -> list[dict]:
    """
    Return aggregated news for a category.
    category: 'crypto' | 'us_stocks' | 'au_stocks' | 'all'
    """
    cache_key = f"news_{category}"
    if cache_key in _news_cache:
        return _news_cache[cache_key]

    feeds_to_fetch = []
    if category == "all":
        for feeds in RSS_FEEDS.values():
            feeds_to_fetch.extend(feeds)
    else:
        feeds_to_fetch = RSS_FEEDS.get(category, RSS_FEEDS["crypto"])

    # Fetch all feeds in parallel (I/O-bound) with a 25s total timeout.
    # Sequential fetching could take minutes if any feed is slow/blocked.
    all_items = []
    with ThreadPoolExecutor(max_workers=8, thread_name_prefix="news") as executor:
        futures = {
            executor.submit(_fetch_feed, name, url, max_per_source): name
            for name, url in feeds_to_fetch
        }
        try:
            for future in as_completed(futures, timeout=25):
                all_items.extend(future.result())
        except FuturesTimeoutError:
            logger.warning("[news] Feed fetch hit 25s timeout; using partial results")

    # Sort by published (newest first)
    all_items.sort(key=lambda x: x.get("published", ""), reverse=True)

    # Deduplicate by title similarity
    seen_titles = set()
    unique = []
    for item in all_items:
        key = item["title"][:50].lower()
        if key not in seen_titles:
            seen_titles.add(key)
            unique.append(item)

    result = unique[:50]
    _news_cache[cache_key] = result
    return result


def get_asset_news(symbol: str, asset_type: str = "crypto") -> list[dict]:
    """Return news items mentioning a specific asset symbol."""
    if asset_type == "crypto":
        base_news = get_news("crypto")
    elif asset_type == "au":
        base_news = get_news("au_stocks")
    else:
        base_news = get_news("us_stocks")

    clean_sym = symbol.replace(".AX", "").upper()
    relevant = [
        n for n in base_news
        if clean_sym in n["title"].upper() or clean_sym in n["summary"].upper()
    ]
    return relevant[:10]
