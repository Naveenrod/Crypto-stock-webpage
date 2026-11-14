import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Clock } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";
import { fetchNews, fetchAssetNews, NewsItem, NewsCategory, Market } from "../api/client";

interface Props {
  category?:    NewsCategory;
  maxItems?:    number;
  /** When given, shows headlines that mention this asset (falls back to the category feed). */
  symbol?:      string;
  market?:      Market;
  showFilters?: boolean;
}

const SOURCE_COLORS: Record<string, string> = {
  CoinDesk:           "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  CoinTelegraph:      "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Decrypt:            "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  "The Block":        "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  CryptoSlate:        "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "Bitcoin Magazine": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Reuters Business": "bg-red-500/15 text-red-700 dark:text-red-300",
  "Yahoo Finance":    "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  MarketWatch:        "bg-green-500/15 text-green-700 dark:text-green-300",
  Investopedia:       "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  "Seeking Alpha":    "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "ABC Business":     "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  AFR:                "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  "SMH Business":     "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
};

const CATEGORY_LABELS: Record<NewsCategory, string> = {
  all: "All news", crypto: "Crypto", us_stocks: "US markets", au_stocks: "AU markets",
};

function NewsCard({ item }: { item: NewsItem }) {
  let timeAgo = "";
  try { timeAgo = formatDistanceToNow(parseISO(item.published), { addSuffix: true }); }
  catch { timeAgo = item.published?.slice(0, 10) ?? ""; }
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group card block p-4 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={clsx("text-[11px] font-medium px-2 py-0.5 rounded-full", SOURCE_COLORS[item.source] ?? "bg-border text-muted")}>
          {item.source}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted flex-shrink-0">
          <Clock className="w-3 h-3" />{timeAgo}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-fg group-hover:text-accent transition-colors line-clamp-2 leading-snug mb-1.5">
        {item.title}
        {/* Always visible (no hover on touch screens), brighter on hover */}
        <ExternalLink className="w-3 h-3 inline ml-1 align-baseline opacity-50 group-hover:opacity-100" aria-hidden />
      </h3>
      {item.summary && <p className="text-xs text-muted line-clamp-2 leading-relaxed">{item.summary}</p>}
    </a>
  );
}

function Skeletons({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card p-4 space-y-2">
          <div className="skeleton h-3 w-20" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-3/4" /><div className="skeleton h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function NewsSection({ category = "all", maxItems = 40, symbol, market, showFilters = true }: Props) {
  const [activeCategory, setActiveCategory] = useState<NewsCategory>(category);
  const assetMode = !!symbol && !!market;

  const assetQuery = useQuery({
    queryKey: ["news", "asset", market, symbol],
    queryFn:  () => fetchAssetNews(market!, symbol!),
    enabled:  assetMode,
    staleTime: 5 * 60_000,
  });
  const usingFallback = assetMode && assetQuery.isSuccess && assetQuery.data.length === 0;
  const feedQuery = useQuery({
    queryKey: ["news", activeCategory],
    queryFn:  () => fetchNews(activeCategory),
    enabled:  !assetMode || usingFallback,
    staleTime: 5 * 60_000,
  });

  const items: NewsItem[] = assetMode && !usingFallback ? (assetQuery.data ?? []) : (feedQuery.data ?? []);
  const isLoading  = assetMode ? assetQuery.isLoading || (usingFallback && feedQuery.isLoading) : feedQuery.isLoading;
  const isFetching = assetQuery.isFetching || feedQuery.isFetching;
  const refetch = () => { if (assetMode) assetQuery.refetch(); if (!assetMode || usingFallback) feedQuery.refetch(); };
  const displaySymbol = symbol?.replace(/\.AX$/, "");
  const displayNews = items.slice(0, maxItems);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {assetMode ? (
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{displaySymbol} news</h3>
            {usingFallback && (
              <p className="text-xs text-muted">No headlines mention {displaySymbol} right now — showing the latest {CATEGORY_LABELS[activeCategory].toLowerCase()}.</p>
            )}
          </div>
        ) : showFilters ? (
          <div role="group" aria-label="News category" className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {(Object.keys(CATEGORY_LABELS) as NewsCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                aria-pressed={cat === activeCategory}
                onClick={() => setActiveCategory(cat)}
                className={clsx("px-3 min-h-[36px] rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                  cat === activeCategory ? "bg-accent text-white border-accent" : "bg-card text-muted border-border hover:text-fg")}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        ) : <span />}
        <button type="button" onClick={refetch} aria-label="Refresh news" className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface transition-colors">
          <RefreshCw className={clsx("w-4 h-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {isLoading ? (
        <Skeletons />
      ) : displayNews.length === 0 ? (
        <div className="card text-center py-12 px-4 text-sm text-muted">No news available right now. Sources may be temporarily unreachable.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {displayNews.map(item => <NewsCard key={item.url || item.title} item={item} />)}
        </div>
      )}
    </div>
  );
}
