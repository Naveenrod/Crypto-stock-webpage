// GET /api/news?category=crypto|us_stocks|au_stocks|all[&symbol=BTC]
// Aggregates the RSS feeds the Python scraper used, in parallel, cached 5 min.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { XMLParser } from "fast-xml-parser";
import { fetchWithTimeout, send, str } from "./_shared";

export const config = { maxDuration: 20 };

const FEEDS: Record<string, [string, string][]> = {
  crypto: [
    ["CoinDesk",         "https://www.coindesk.com/arc/outboundfeeds/rss/"],
    ["CoinTelegraph",    "https://cointelegraph.com/rss"],
    ["Decrypt",          "https://decrypt.co/feed"],
    ["The Block",        "https://www.theblock.co/rss.xml"],
    ["CryptoSlate",      "https://cryptoslate.com/feed/"],
    ["Bitcoin Magazine", "https://bitcoinmagazine.com/.rss/full/"],
  ],
  us_stocks: [
    ["Reuters Business", "https://feeds.reuters.com/reuters/businessNews"],
    ["Yahoo Finance",    "https://finance.yahoo.com/news/rssindex"],
    ["MarketWatch",      "https://feeds.marketwatch.com/marketwatch/topstories/"],
    ["Investopedia",     "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline"],
    ["Seeking Alpha",    "https://seekingalpha.com/market_currents.xml"],
  ],
  au_stocks: [
    ["ABC Business",     "https://www.abc.net.au/news/feed/2942/rss.xml"],
    ["AFR",              "https://www.afr.com/rss"],
    ["ASX News",         "https://www.asx.com.au/content/dam/asx/newsroom/rss.xml"],
    ["The Australian",   "https://www.theaustralian.com.au/feed"],
    ["SMH Business",     "https://www.smh.com.au/rss/business.xml"],
  ],
};

interface Item { source: string; title: string; summary: string; url: string; published: string }

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as any)) return String((v as any)["#text"] ?? "");
  if (Array.isArray(v)) return text(v[0]);
  return String(v);
};
const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const linkOf = (e: any): string => {
  const l = e?.link;
  if (typeof l === "string") return l;
  if (Array.isArray(l)) { const alt = l.find((x: any) => x?.["@_rel"] !== "self") ?? l[0]; return typeof alt === "string" ? alt : alt?.["@_href"] ?? ""; }
  return l?.["@_href"] ?? text(l) ?? "";
};
const dateOf = (e: any): string => {
  const raw = text(e?.pubDate ?? e?.published ?? e?.updated ?? e?.["dc:date"]);
  const d = raw ? new Date(raw) : new Date();
  return (isNaN(d.getTime()) ? new Date() : d).toISOString();
};

async function fetchFeed(source: string, url: string, maxItems = 8): Promise<Item[]> {
  try {
    const r = await fetchWithTimeout(url, 7000);
    if (!r.ok) return [];
    const xml = await r.text();
    const doc = parser.parse(xml);
    const entries: any[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.["rdf:RDF"]?.item ?? [];
    return (Array.isArray(entries) ? entries : [entries]).slice(0, maxItems).map(e => ({
      source,
      title:     strip(text(e?.title)),
      summary:   strip(text(e?.description ?? e?.summary ?? e?.["content:encoded"] ?? e?.content)).slice(0, 300),
      url:       linkOf(e),
      published: dateOf(e),
    })).filter(i => i.title);
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const category = str(req.query.category) || "all";
  const symbol   = str(req.query.symbol).toUpperCase().replace(/\.AX$/, "");
  const feeds = category === "all" ? Object.values(FEEDS).flat() : FEEDS[category];
  if (!feeds) return send(res, 400, { error: "unknown category" });

  const settled = await Promise.allSettled(feeds.map(([name, url]) => fetchFeed(name, url)));
  let items: Item[] = settled.flatMap(s => (s.status === "fulfilled" ? s.value : []));
  items.sort((a, b) => (a.published < b.published ? 1 : -1));
  const seen = new Set<string>();
  items = items.filter(i => { const k = i.title.slice(0, 50).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (symbol) {
    const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    items = items.filter(i => re.test(i.title) || re.test(i.summary)).slice(0, 10);
  } else {
    items = items.slice(0, 50);
  }
  return send(res, 200, { category, symbol: symbol || null, news: items, at: new Date().toISOString() }, 300);
}
