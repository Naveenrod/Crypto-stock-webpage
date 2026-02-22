import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Bitcoin, TrendingUp, BarChart2, Newspaper, Activity } from "lucide-react";
import CryptoTab from "./components/CryptoTab";
import StocksUSTab from "./components/StocksUSTab";
import StocksAUTab from "./components/StocksAUTab";
import NewsSection from "./components/NewsSection";
import clsx from "clsx";

type Tab = "crypto" | "us" | "au" | "news";

const TABS: { id: Tab; label: string; icon: React.FC<any>; desc: string }[] = [
  { id: "crypto", label: "Crypto",          icon: Bitcoin,     desc: "Binance & Revolut" },
  { id: "us",     label: "US Stocks",        icon: TrendingUp,  desc: "Revolut" },
  { id: "au",     label: "AU Stocks",        icon: BarChart2,   desc: "CommSec" },
  { id: "news",   label: "News & Trends",    icon: Newspaper,   desc: "Live Feed" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("crypto");

  return (
    <div className="min-h-screen flex flex-col bg-bg text-slate-200" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-screen-2xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent/20 border border-accent/30">
              <Activity className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">FinSight</h1>
              <p className="text-xs text-muted leading-none mt-0.5">AI-Powered Market Analyzer</p>
            </div>
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 live-dot" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            Live Data
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-screen-2xl px-4">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map(({ id, label, icon: Icon, desc }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  activeTab === id
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-slate-300 hover:border-border"
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                <span className={clsx("text-xs hidden sm:inline", activeTab === id ? "text-accent/70" : "text-muted/60")}>
                  {desc}
                </span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Disclaimer banner */}
      <div className="bg-warning/10 border-b border-warning/20 px-4 py-1.5 text-center">
        <p className="text-xs text-warning/90">
          ⚠ Financial predictions are for informational purposes only. Always do your own research. Past performance does not guarantee future results.
        </p>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-screen-2xl w-full px-4 py-6 flex flex-col flex-1 min-h-0">
        {activeTab === "crypto" && <CryptoTab />}
        {activeTab === "us"     && <StocksUSTab />}
        {activeTab === "au"     && <StocksAUTab />}
        {activeTab === "news"   && <NewsSection category="all" />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-4 text-center text-xs text-muted">
        FinSight — Data from Binance API · Yahoo Finance · Trusted News RSS feeds &nbsp;|&nbsp; Powered by ML Ensemble (RF + GB + XGBoost)
      </footer>
    </div>
  );
}
