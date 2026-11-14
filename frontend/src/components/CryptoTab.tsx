import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, TrendingDown } from "lucide-react";
import clsx from "clsx";
import { fetchCryptoAssets, CryptoAsset } from "../api/client";
import AssetWorkspace, { EmptyDetail } from "./AssetWorkspace";
import AssetDetail from "./AssetDetail";
import { fmtPrice, fmtPct, fmtCompact } from "../utils/format";
import { useIsDesktop } from "../utils/useMediaQuery";
import type { JumpTarget } from "../App";

type Platform = "all" | "binance" | "revolut";
const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "all", label: "All" }, { id: "binance", label: "Binance" }, { id: "revolut", label: "Revolut" },
];

function AssetRow({ asset, selected, onSelect }: { asset: CryptoAsset; selected: boolean; onSelect: () => void }) {
  const isUp = asset.change_24h >= 0;
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
      <div className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
        <span className="text-[11px] font-bold text-accent">{asset.symbol.slice(0, 4)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-fg">{asset.symbol}</span>
          <span className="text-sm font-mono text-fg2">{fmtPrice(asset.price)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted truncate">{asset.name}</span>
          <span className={clsx("text-xs font-medium flex items-center gap-0.5", isUp ? "text-success" : "text-danger")}>
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {fmtPct(asset.change_24h)}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Compact 24 h movers strip: scrolls horizontally on phones instead of two tall cards. */
function Movers({ assets, onSelect }: { assets: CryptoAsset[]; onSelect: (symbol: string) => void }) {
  const sorted = useMemo(() => [...assets].filter(a => a.price > 0).sort((a, b) => b.change_24h - a.change_24h), [assets]);
  if (sorted.length < 6) return null;
  const gainers = sorted.slice(0, 3);
  const losers  = sorted.slice(-3).reverse();
  const Chip = ({ a, up }: { a: CryptoAsset; up: boolean }) => (
    <button
      type="button"
      onClick={() => onSelect(a.symbol)}
      className={clsx(
        "flex items-center gap-1.5 px-3 min-h-[40px] rounded-full border text-xs font-medium whitespace-nowrap transition-colors",
        up ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
           : "border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
      )}
    >
      <span className="text-fg font-semibold">{a.symbol}</span>
      {fmtPct(a.change_24h)}
    </button>
  );
  return (
    <div className="card px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
      <span className="text-xs text-muted font-medium whitespace-nowrap mr-1">24h movers</span>
      {gainers.map(a => <Chip key={a.symbol} a={a} up />)}
      <span className="w-px h-5 bg-border flex-shrink-0 mx-1" aria-hidden />
      {losers.map(a => <Chip key={a.symbol} a={a} up={false} />)}
    </div>
  );
}

export default function CryptoTab({ jumpTo }: { jumpTo: JumpTarget | null }) {
  const [platform, setPlatform] = useState<Platform>("all");
  const [search,   setSearch]   = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  const lastSelected = useRef<CryptoAsset | null>(null);

  const { data: assets = [], isLoading, isError } = useQuery<CryptoAsset[]>({
    queryKey: ["crypto", "assets", platform],
    queryFn:  () => fetchCryptoAssets(platform),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Opened from Top-5 Picks
  useEffect(() => {
    if (jumpTo) { setPlatform("all"); setSearch(""); setSelectedSymbol(jumpTo.symbol); }
  }, [jumpTo?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop has room for both panes: pre-select the first coin so the detail pane isn't empty.
  useEffect(() => {
    if (isDesktop && selectedSymbol === null && assets.length) setSelectedSymbol(assets[0].symbol);
  }, [isDesktop, assets, selectedSymbol]);

  const selected = useMemo(() => {
    const found = assets.find(a => a.symbol === selectedSymbol) ?? null;
    if (found) lastSelected.current = found;
    if (found) return found;
    return selectedSymbol && lastSelected.current?.symbol === selectedSymbol ? lastSelected.current : null;
  }, [assets, selectedSymbol]);

  const q = search.trim().toLowerCase();
  const filtered = q ? assets.filter(a => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) : assets;

  const sidebar = (
    <>
      <div role="group" aria-label="Platform" className="grid grid-cols-3 gap-1 bg-surface border border-border rounded-lg p-1">
        {PLATFORMS.map(p => (
          <button
            key={p.id}
            type="button"
            aria-pressed={platform === p.id}
            onClick={() => setPlatform(p.id)}
            className={clsx("min-h-[44px] sm:min-h-[40px] rounded-md text-xs font-medium transition-colors",
              platform === p.id ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg")}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search coins</span>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search coins…"
          inputMode="search"
          className="w-full bg-card border border-border rounded-lg pl-9 pr-3 min-h-[44px] text-sm text-fg placeholder:text-muted focus:outline-none focus:border-accent/60"
        />
      </label>

      <div className="card p-1 space-y-0.5 lg:max-h-[calc(100vh-300px)] lg:overflow-y-auto">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-[52px] w-full rounded-lg" />)
          : isError
          ? <p className="p-4 text-sm text-danger">Couldn't load prices. Retrying automatically…</p>
          : filtered.length === 0
          ? <p className="p-4 text-sm text-muted">No coins match “{search}”.</p>
          : filtered.map(a => (
              <AssetRow key={a.symbol} asset={a} selected={a.symbol === selectedSymbol} onSelect={() => setSelectedSymbol(a.symbol)} />
            ))}
      </div>
    </>
  );

  const header = selected && (
    <div className="card p-4 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-fg flex items-baseline gap-2 flex-wrap">
          {selected.symbol}
          <span className="text-sm font-normal text-muted">{selected.name}</span>
        </h2>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-fg text-lg">{fmtPrice(selected.price)}</span>
          <span className={clsx("text-sm font-medium", selected.change_24h >= 0 ? "text-success" : "text-danger")}>
            {fmtPct(selected.change_24h)} <span className="text-muted font-normal">24h</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted">
          <span>H {fmtPrice(selected.high_24h)}</span>
          <span>L {fmtPrice(selected.low_24h)}</span>
          <span>Vol ${fmtCompact(selected.volume_24h)}</span>
        </div>
      </div>
      <div className="flex gap-2 text-xs">
        {selected.on_binance && (
          <span className="px-2.5 py-1 rounded-full bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30">Binance</span>
        )}
        {selected.on_revolut && (
          <span className="px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">Revolut</span>
        )}
      </div>
    </div>
  );

  const detail = selected
    ? <AssetDetail market="crypto" symbol={selected.symbol} header={header} newsCategory="crypto" />
    : <EmptyDetail message="Select a coin to see its chart, AI prediction and backtest" />;

  return (
    <div className="space-y-3 sm:space-y-4">
      {!isLoading && assets.length > 0 && <Movers assets={assets} onSelect={setSelectedSymbol} />}
      <AssetWorkspace
        sidebar={sidebar}
        detail={detail}
        hasSelection={!!selected}
        onBack={() => setSelectedSymbol(null)}
        backLabel="All coins"
      />
    </div>
  );
}
