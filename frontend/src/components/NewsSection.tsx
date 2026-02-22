import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNews, NewsItem } from "../api/client";
import { ExternalLink, RefreshCw, Clock } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import clsx from "clsx";

type CategoryType = "all" | "crypto" | "us_stocks" | "au_stocks";

interface Props {
  category?: CategoryType;
  maxItems?: number;
}

const SOURCE_COLORS: Record<string, string> = {
  CoinDesk:         "bg-orange-500/20 text-orange-400",
  CoinTelegraph:    "bg-blue-500/20 text-blue-400",
  Decrypt:          "bg-purple-500/20 text-purple-400",
  "The Block":      "bg-cyan-500/20 text-cyan-400",
  CryptoSlate:      "bg-teal-500/20 text-teal-400",
  "Reuters Business": "bg-red-500/20 text-red-400",
  "Yahoo Finance":  "bg-indigo-500/20 text-indigo-400",
  MarketWatch:      "bg-green-500/20 text-green-400",
  "ABC Business":   "bg-yellow-500/20 text-yellow-400",
  AFR:              "bg-pink-500/20 text-pink-400",
};

function NewsCard({ item }: { item: NewsItem }) {
  let timeAgo = "";
  try {
    timeAgo = formatDistanceToNow(parseISO(item.published), { addSuffix: true });
  } catch {
    timeAgo = item.published?.slice(0, 10) ?? "";
  }

  const badgeCls = SOURCE_COLORS[item.source] ?? "bg-border text-muted";

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-card border border-border rounded-xl p-4 hover:border-accent/50 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={clsx("text-[10px] font-medium px-2 py-0.5 rounded-full", badgeCls)}>
          {item.source}
        </span>
        <div className="flex items-center gap-1 text-[10px] text-muted flex-shrink-0">
          <Clock className="w-3 h-3" />
          {timeAgo}
        </div>
      </div>

      <h3 className="text-sm font-semibold text-slate-200 group-hover:text-accent transition-colors line-clamp-2 leading-snug mb-1.5">
        {item.title}
        <ExternalLink className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </h3>

      {item.summary && (
        <p className="text-[11px] text-muted line-clamp-2 leading-relaxed">{item.summary}</p>
      )}
    </a>
  );
}

const CATEGORY_LABELS = {
  all:       "All News",
  crypto:    "Crypto",
  us_stocks: "US Markets",
  au_stocks: "AU Markets",
};

export default function NewsSection({ category = "all", maxItems = 40 }: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryType>(category);

  const { data: news = [], isLoading, refetch, isFetching } = useQuery<NewsItem[]>({
    queryKey:  ["news", activeCategory],
    queryFn:   () => fetchNews(activeCategory),
    staleTime: 300_000,
  });

  const displayNews = news.slice(0, maxItems);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(Object.entries(CATEGORY_LABELS) as [CategoryType, string][]).map(([cat, label]) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={clsx(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                cat === activeCategory
                  ? "bg-accent text-white"
                  : "bg-surface text-muted hover:text-slate-300 border border-border"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => refetch()} className="text-muted hover:text-slate-300 transition-colors">
          <RefreshCw className={clsx("w-4 h-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-2">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-full" />
            </div>
          ))}
        </div>
      ) : displayNews.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <p>No news available. Sources may be temporarily unavailable.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {displayNews.map((item, i) => <NewsCard key={i} item={item} />)}
        </div>
      )}
    </div>
  );
}
