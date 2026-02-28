import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCryptoAssets, CryptoAsset } from "../api/client";
import PriceChart from "./PriceChart";
import PredictionCard from "./PredictionCard";
import BacktestResults from "./BacktestResults";
import NewsSection from "./NewsSection";
import { Search, SlidersHorizontal, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import clsx from "clsx";

type Platform = "all" | "binance" | "revolut";

function AssetRow({ asset, selected, onSelect }: {
  asset: CryptoAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  const isUp = asset.change_24h >= 0;
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
        selected ? "bg-accent/10 border border-accent/30" : "hover:bg-surface border border-transparent"
      )}
    >
      <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-bold text-accent">{asset.symbol.slice(0, 3)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">{asset.symbol}</span>
          <span className="text-sm font-mono text-slate-200">
            ${asset.price >= 1 ? asset.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : asset.price.toFixed(6)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted truncate">{asset.name}</span>
          <span className={clsx("text-[11px] font-medium flex items-center gap-0.5", isUp ? "text-success" : "text-danger")}>
            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isUp ? "+" : ""}{asset.change_24h.toFixed(2)}%
          </span>
        </div>
      </div>
    </button>
  );
}

export default function CryptoTab() {
  const [platform,  setPlatform]  = useState<Platform>("all");
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState<CryptoAsset | null>(null);
  const [showPanel, setShowPanel] = useState<"chart" | "predict" | "backtest" | "news">("chart");

  const { data: assets = [], isLoading } = useQuery<CryptoAsset[]>({
    queryKey:  ["crypto", "assets", platform],
    queryFn:   () => fetchCryptoAssets(platform),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const filtered = assets.filter(a =>
    !search ||
    a.symbol.toLowerCase().includes(search.toLowerCase()) ||
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  const gainers = [...assets].sort((a, b) => b.change_24h - a.change_24h).slice(0, 3);
  const losers  = [...assets].sort((a, b) => a.change_24h - b.change_24h).slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Top movers */}
      {!isLoading && assets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-success font-medium mb-2">🚀 Top Gainers (24h)</p>
            <div className="space-y-1">
              {gainers.map(a => (
                <button key={a.symbol} onClick={() => setSelected(a)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-surface transition-colors">
                  <span className="text-sm font-medium text-white">{a.symbol}</span>
                  <span className="text-sm font-mono text-success">+{a.change_24h.toFixed(2)}%</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-danger font-medium mb-2">📉 Top Losers (24h)</p>
            <div className="space-y-1">
              {losers.map(a => (
                <button key={a.symbol} onClick={() => setSelected(a)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-surface transition-colors">
                  <span className="text-sm font-medium text-white">{a.symbol}</span>
                  <span className="text-sm font-mono text-danger">{a.change_24h.toFixed(2)}%</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4 items-start">
        {/* Left: Asset List — sticky alongside the chart */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-3 sticky top-[120px]">
          {/* Platform filter */}
          <div className="flex gap-1 bg-surface rounded-lg p-1">
            {(["all","binance","revolut"] as Platform[]).map(p => (
              <button key={p} onClick={() => setPlatform(p)}
                className={clsx("flex-1 py-1.5 rounded text-xs font-medium capitalize transition-colors",
                  platform === p ? "bg-accent text-white" : "text-muted hover:text-slate-300"
                )}>
                {p === "all" ? "All" : p === "binance" ? "🔶 Binance" : "🔄 Revolut"}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search coins…"
              className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* List */}
          <div className="bg-card border border-border rounded-xl overflow-y-auto max-h-[460px] p-1 space-y-0.5">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)
              : filtered.map(asset => (
                <AssetRow
                  key={asset.symbol}
                  asset={asset}
                  selected={selected?.symbol === asset.symbol}
                  onSelect={() => setSelected(asset)}
                />
              ))
            }
          </div>
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="h-full flex items-center justify-center bg-card border border-border rounded-xl">
              <div className="text-center text-muted py-20">
                <ChevronRight className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select an asset to view analysis</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Asset header */}
              <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">{selected.symbol}
                    <span className="text-sm font-normal text-muted ml-2">{selected.name}</span>
                  </h2>
                  <div className="flex items-center gap-3 mt-1 text-sm">
                    <span className="font-mono text-white text-lg">
                      ${selected.price >= 1 ? selected.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : selected.price.toFixed(6)}
                    </span>
                    <span className={clsx("font-medium", selected.change_24h >= 0 ? "text-success" : "text-danger")}>
                      {selected.change_24h >= 0 ? "+" : ""}{selected.change_24h.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-muted">
                    <span>H: ${selected.high_24h >= 1 ? selected.high_24h.toLocaleString("en-US", { maximumFractionDigits: 2 }) : selected.high_24h.toFixed(4)}</span>
                    <span>L: ${selected.low_24h  >= 1 ? selected.low_24h.toLocaleString("en-US", { maximumFractionDigits: 2 }) : selected.low_24h.toFixed(4)}</span>
                    <span>Vol: ${(selected.volume_24h / 1e6).toFixed(1)}M</span>
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  {selected.on_binance && <span className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">Binance</span>}
                  {selected.on_revolut && <span className="px-2 py-0.5 rounded-full bg-blue-500/20   text-blue-400   border border-blue-500/30">Revolut</span>}
                </div>
              </div>

              {/* Panel tabs */}
              <div className="flex gap-1 bg-surface rounded-lg p-1">
                {(["chart","predict","backtest","news"] as const).map(p => (
                  <button key={p} onClick={() => setShowPanel(p)}
                    className={clsx("flex-1 py-1.5 rounded text-xs font-medium capitalize transition-colors",
                      showPanel === p ? "bg-accent text-white" : "text-muted hover:text-slate-300"
                    )}>
                    {p === "predict" ? "AI Predict" : p === "backtest" ? "Backtest" : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>

              {showPanel === "chart"    && <PriceChart symbol={selected.symbol} assetType="crypto" />}
              {showPanel === "predict"  && <PredictionCard symbol={selected.symbol} assetType="crypto" />}
              {showPanel === "backtest" && <BacktestResults symbol={selected.symbol} assetType="crypto" />}
              {showPanel === "news"     && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3">Latest {selected.symbol} News</h3>
                  <NewsSection category="crypto" maxItems={10} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
