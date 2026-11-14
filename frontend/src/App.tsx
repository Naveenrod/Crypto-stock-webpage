import { useCallback, useState } from "react";
import { Bitcoin, TrendingUp, BarChart2, Newspaper, Activity, Trophy, Sun, Moon } from "lucide-react";
import clsx from "clsx";
import CryptoTab from "./components/CryptoTab";
import StockTab from "./components/StockTab";
import NewsSection from "./components/NewsSection";
import TopPicksTab from "./components/TopPicksTab";
import { useTheme } from "./theme/ThemeProvider";
import type { Market } from "./api/client";

export type Tab = "picks" | "crypto" | "us" | "au" | "news";
export interface JumpTarget { market: Market; symbol: string; nonce: number }

const TABS: { id: Tab; label: string; short: string; icon: React.FC<{ className?: string }>; desc: string }[] = [
  { id: "picks",  label: "Top 5 Picks",   short: "Picks",  icon: Trophy,     desc: "AI ranked" },
  { id: "crypto", label: "Crypto",        short: "Crypto", icon: Bitcoin,    desc: "Binance & Revolut" },
  { id: "us",     label: "US Stocks",     short: "US",     icon: TrendingUp, desc: "Revolut" },
  { id: "au",     label: "AU Stocks",     short: "AU",     icon: BarChart2,  desc: "CommSec" },
  { id: "news",   label: "News & Trends", short: "News",   icon: Newspaper,  desc: "Live feed" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("picks");
  // Tabs stay mounted once visited so switching back keeps the selected asset
  // and in-flight queries (and avoids re-measuring charts from scratch).
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["picks"]));
  // An asset requested from another view (a Top-5 pick) — consumed by that market's tab.
  const [jump, setJump] = useState<JumpTarget | null>(null);
  const { theme, toggle } = useTheme();

  const go = useCallback((tab: Tab) => {
    setVisited(prev => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    setActiveTab(tab);
    window.scrollTo({ top: 0 });
  }, []);

  const openAsset = useCallback((market: Market, symbol: string) => {
    setJump({ market, symbol, nonce: Date.now() });
    go(market);
  }, [go]);

  const show = (tab: Tab) => visited.has(tab);
  const pane = (tab: Tab) => clsx(activeTab !== tab && "hidden");

  return (
    <div className="min-h-screen bg-bg text-fg2">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-screen-2xl px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 flex-shrink-0">
              <Activity className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-fg leading-none">FinSight</h1>
              <p className="text-xs text-muted leading-none mt-1 truncate">AI-powered market analyzer</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden xs:flex items-center gap-2 text-xs text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 live-dot" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Live data
            </div>
            <button
              type="button"
              onClick={toggle}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              className="w-11 h-11 rounded-lg border border-border bg-surface text-muted hover:text-fg hover:border-accent/40 flex items-center justify-center transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Section tabs — compact labels on phones, full labels + descriptions on larger screens */}
        <nav aria-label="Sections" className="mx-auto max-w-screen-2xl px-1 sm:px-4 flex overflow-x-auto no-scrollbar">
          {TABS.map(({ id, label, short, icon: Icon, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={activeTab === id ? "page" : undefined}
              className={clsx(
                "flex-1 sm:flex-none flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 min-h-[44px]",
                "text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                activeTab === id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-fg hover:border-border",
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
              <span className={clsx("text-xs hidden md:inline", activeTab === id ? "text-accent/70" : "text-muted/70")}>{desc}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Disclaimer */}
      <div className="bg-warning/10 border-b border-warning/20 px-4 py-1.5 text-center">
        <p className="text-[11px] sm:text-xs text-warning">
          <span className="sm:hidden">Not financial advice — always do your own research.</span>
          <span className="hidden sm:inline">
            Financial predictions are for informational purposes only. Always do your own research. Past performance does not guarantee future results.
          </span>
        </p>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-screen-2xl w-full px-4 py-4 sm:py-6">
        {show("picks")  && <div className={pane("picks")}><TopPicksTab onOpenAsset={openAsset} /></div>}
        {show("crypto") && <div className={pane("crypto")}><CryptoTab jumpTo={jump?.market === "crypto" ? jump : null} /></div>}
        {show("us")     && <div className={pane("us")}><StockTab market="us" jumpTo={jump?.market === "us" ? jump : null} /></div>}
        {show("au")     && <div className={pane("au")}><StockTab market="au" jumpTo={jump?.market === "au" ? jump : null} /></div>}
        {show("news")   && <div className={pane("news")}><NewsSection category="all" /></div>}
      </main>

      <footer className="border-t border-border mt-10 py-4 px-4 text-center text-xs text-muted">
        FinSight — data from Binance · Yahoo Finance · trusted news RSS feeds · ML ensemble (Random Forest + Gradient Boosting + XGBoost)
      </footer>
    </div>
  );
}
