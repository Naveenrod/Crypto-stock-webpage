import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import clsx from "clsx";
import { fetchStocks, fetchSectors, fetchStockQuote, StockAsset, NewsCategory } from "../api/client";
import AssetWorkspace, { EmptyDetail } from "./AssetWorkspace";
import AssetDetail from "./AssetDetail";
import { fmtPrice, fmtPct } from "../utils/format";
import { useIsDesktop } from "../utils/useMediaQuery";
import type { JumpTarget } from "../App";

type StockMarket = "us" | "au";

const META: Record<StockMarket, {
  title: string; exchange: string; platform: string; flag: string; news: NewsCategory; currency: string; badge: string; avatar: string;
}> = {
  us: { title: "US Stocks", exchange: "NYSE · NASDAQ", platform: "Revolut", flag: "🇺🇸", news: "us_stocks", currency: "$",
        badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30", avatar: "text-indigo-600 dark:text-indigo-300" },
  au: { title: "AU Stocks", exchange: "ASX",           platform: "CommSec", flag: "🇦🇺", news: "au_stocks", currency: "A$",
        badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", avatar: "text-emerald-600 dark:text-emerald-300" },
};

const displaySymbol = (market: StockMarket, symbol: string) => (market === "au" ? symbol.replace(/\.AX$/, "") : symbol);

function StockRow({ market, asset, selected, onSelect }: { market: StockMarket; asset: StockAsset; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2 min-h-[52px] rounded-lg text-left transition-colors border",
        selected ? "bg-accent/10 border-accent/30" : "border-transparent hover:bg-surface",
      )}
    >
      <div className="w-9 h-9 rounded-lg bg-surface border border-border flex items-center justify-center flex-shrink-0">
        <span className={clsx("text-[10px] font-bold", META[market].avatar)}>{displaySymbol(market, asset.symbol).slice(0, 4)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-fg">
            {displaySymbol(market, asset.symbol)}
            {market === "au" && <span className="text-xs font-normal text-muted">.AX</span>}
          </span>
          <span className="text-[11px] text-muted truncate max-w-[45%] text-right">{asset.sector}</span>
        </div>
        <span className="block text-xs text-muted truncate">{asset.name}</span>
      </div>
    </button>
  );
}

function StockHeader({ market, asset }: { market: StockMarket; asset: StockAsset }) {
  const meta = META[market];
  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote", market, asset.symbol],
    queryFn:  () => fetchStockQuote(market, asset.symbol),
    staleTime: 60_000,
  });
  const hasPrice = !!quote && quote.price > 0;
  return (
    <div className="card p-4 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-fg flex items-baseline gap-2 flex-wrap">
          {displaySymbol(market, asset.symbol)}
          {market === "au" && <span className="text-sm font-normal text-muted -ml-1">.AX</span>}
          <span className="text-sm font-normal text-muted">{asset.name}</span>
        </h2>
        <div className="flex items-center gap-3 mt-1 min-h-[28px]">
          {isLoading ? (
            <span className="skeleton h-6 w-32 rounded" />
          ) : hasPrice ? (
            <>
              <span className="font-mono text-fg text-lg">{fmtPrice(quote.price, meta.currency)}</span>
              <span className={clsx("text-sm font-medium", quote.change_24h >= 0 ? "text-success" : "text-danger")}>
                {fmtPct(quote.change_24h)} <span className="text-muted font-normal">today</span>
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">Live quote unavailable</span>
          )}
        </div>
        <p className="text-xs text-muted mt-1">{asset.sector} · {meta.exchange}</p>
      </div>
      <span className={clsx("px-2.5 py-1 rounded-full border text-xs font-medium", meta.badge)}>{meta.platform}</span>
    </div>
  );
}

export default function StockTab({ market, jumpTo }: { market: StockMarket; jumpTo: JumpTarget | null }) {
  const meta = META[market];
  const [sector, setSector] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  const { data: sectors = [] } = useQuery({ queryKey: ["sectors", market], queryFn: () => fetchSectors(market), staleTime: Infinity });
  const { data: assets = [], isLoading, isError } = useQuery({
    queryKey: ["stocks", market, sector], queryFn: () => fetchStocks(market, sector), staleTime: 5 * 60_000,
  });
  // Full list (shared cache key with sector="all") so a pick can be opened whatever the filter.
  const { data: allAssets = [] } = useQuery({
    queryKey: ["stocks", market, "all"], queryFn: () => fetchStocks(market, "all"), staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (jumpTo) { setSector("all"); setSearch(""); setSelectedSymbol(jumpTo.symbol); }
  }, [jumpTo?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isDesktop && selectedSymbol === null && assets.length) setSelectedSymbol(assets[0].symbol);
  }, [isDesktop, assets, selectedSymbol]);

  const selected = useMemo(
    () => allAssets.find(a => a.symbol === selectedSymbol) ?? assets.find(a => a.symbol === selectedSymbol) ?? null,
    [allAssets, assets, selectedSymbol],
  );

  const q = search.trim().toLowerCase();
  const filtered = q
    ? assets.filter(a => a.symbol.toLowerCase().includes(q) || displaySymbol(market, a.symbol).toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    : assets;

  const sidebar = (
    <>
      <label className="block">
        <span className="sr-only">Sector</span>
        <select
          value={sector}
          onChange={e => setSector(e.target.value)}
          className="w-full bg-card border border-border rounded-lg px-3 min-h-[44px] text-sm text-fg focus:outline-none focus:border-accent/60"
        >
          <option value="all">All sectors</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className="relative block">
        <span className="sr-only">Search stocks</span>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={market === "au" ? "Search ASX stocks…" : "Search stocks…"}
          inputMode="search"
          className="w-full bg-card border border-border rounded-lg pl-9 pr-3 min-h-[44px] text-sm text-fg placeholder:text-muted focus:outline-none focus:border-accent/60"
        />
      </label>

      <div className="card p-1 space-y-0.5 lg:max-h-[calc(100vh-300px)] lg:overflow-y-auto">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-[52px] w-full rounded-lg" />)
          : isError
          ? <p className="p-4 text-sm text-danger">Couldn't load the stock list. Retrying automatically…</p>
          : filtered.length === 0
          ? <p className="p-4 text-sm text-muted">No stocks match “{search}”.</p>
          : filtered.map(a => (
              <StockRow key={a.symbol} market={market} asset={a} selected={a.symbol === selectedSymbol} onSelect={() => setSelectedSymbol(a.symbol)} />
            ))}
      </div>
    </>
  );

  const detail = selected
    ? <AssetDetail market={market} symbol={selected.symbol} header={<StockHeader market={market} asset={selected} />} newsCategory={meta.news} currency={meta.currency} />
    : <EmptyDetail message="Select a stock to see its chart, AI prediction and backtest" />;

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="card px-4 py-2.5 flex items-center gap-3">
        <span className="text-xl" aria-hidden>{meta.flag}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-fg leading-tight">{meta.title}</h2>
          <p className="text-xs text-muted truncate">{meta.exchange} · available on <span className="text-fg2 font-medium">{meta.platform}</span></p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-fg leading-none">{allAssets.length || assets.length || "—"}</p>
          <p className="text-[11px] text-muted">stocks</p>
        </div>
      </div>
      <AssetWorkspace
        sidebar={sidebar}
        detail={detail}
        hasSelection={!!selected}
        onBack={() => setSelectedSymbol(null)}
        backLabel="All stocks"
      />
    </div>
  );
}
