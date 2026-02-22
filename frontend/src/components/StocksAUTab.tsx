import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAUStocks, StockAsset } from "../api/client";
import PriceChart from "./PriceChart";
import PredictionCard from "./PredictionCard";
import BacktestResults from "./BacktestResults";
import NewsSection from "./NewsSection";
import { Search, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import clsx from "clsx";

const AU_SECTORS = [
  "all","Financials","Materials","Healthcare","Technology","Energy",
  "Consumer Disc.","Consumer Staples","Industrials","Real Estate",
  "Utilities","Telecom",
];

function StockRow({ asset, selected, onSelect }: {
  asset: StockAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
        selected ? "bg-accent/10 border border-accent/30" : "hover:bg-surface border border-transparent"
      )}
    >
      <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center flex-shrink-0">
        <span className="text-[9px] font-bold text-green-400">
          {asset.symbol.replace(".AX","").slice(0, 3)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">{asset.symbol.replace(".AX","")}</span>
          <span className="text-[10px] text-muted">.AX</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted truncate">{asset.name}</span>
          <span className="text-[10px] text-muted">{asset.sector}</span>
        </div>
      </div>
    </button>
  );
}

export default function StocksAUTab() {
  const [search,    setSearch]    = useState("");
  const [sector,    setSector]    = useState("all");
  const [selected,  setSelected]  = useState<StockAsset | null>(null);
  const [showPanel, setShowPanel] = useState<"chart" | "predict" | "backtest" | "news">("chart");

  const { data: assets = [], isLoading } = useQuery<StockAsset[]>({
    queryKey: ["stocks", "au", sector],
    queryFn:  () => fetchAUStocks(sector),
    staleTime: 60_000,
  });

  const filtered = assets.filter(a =>
    !search ||
    a.symbol.toLowerCase().includes(search.toLowerCase()) ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.symbol.replace(".AX","").toLowerCase().includes(search.toLowerCase())
  );

  // Display symbol without .AX for API calls
  const apiSymbol = selected?.symbol ?? "";

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 border border-green-500/30 flex items-center justify-center">
            <span className="text-lg">🇦🇺</span>
          </div>
          <div>
            <h2 className="font-semibold text-white">Australian Stock Market</h2>
            <p className="text-xs text-muted">
              ASX — Available on <span className="text-green-400 font-medium">CommSec</span>
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted">ASX Listed</p>
            <p className="text-xl font-bold text-white">{assets.length}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Left: Asset List */}
        <div className="w-72 flex-shrink-0 space-y-3">
          {/* Sector filter */}
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent/50"
          >
            {AU_SECTORS.map(s => (
              <option key={s} value={s === "all" ? "all" : s}>
                {s === "all" ? "All Sectors" : s}
              </option>
            ))}
          </select>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ASX stocks…"
              className="w-full bg-surface border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-slate-200 placeholder-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* List */}
          <div className="bg-card border border-border rounded-xl overflow-y-auto max-h-[70vh] p-1 space-y-0.5">
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)
              : filtered.map(asset => (
                <StockRow
                  key={asset.symbol}
                  asset={asset}
                  selected={selected?.symbol === asset.symbol}
                  onSelect={() => { setSelected(asset); setShowPanel("chart"); }}
                />
              ))
            }
          </div>
        </div>

        {/* Right: Detail */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="h-full flex items-center justify-center bg-card border border-border rounded-xl">
              <div className="text-center text-muted py-20">
                <ChevronRight className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select an ASX stock to view analysis</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Asset header */}
              <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selected.symbol.replace(".AX","")}
                    <span className="text-muted font-normal">.AX</span>
                    <span className="text-sm font-normal text-muted ml-2">{selected.name}</span>
                  </h2>
                  <p className="text-xs text-muted mt-1">{selected.sector} · ASX · CommSec</p>
                </div>
                <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-medium">
                  📊 CommSec
                </span>
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

              {showPanel === "chart"    && <PriceChart symbol={apiSymbol} assetType="au" />}
              {showPanel === "predict"  && <PredictionCard symbol={apiSymbol} assetType="au" />}
              {showPanel === "backtest" && <BacktestResults symbol={apiSymbol} assetType="au" />}
              {showPanel === "news"     && <NewsSection category="au_stocks" maxItems={12} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
