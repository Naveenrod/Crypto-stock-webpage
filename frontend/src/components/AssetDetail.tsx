import { ReactNode, useState } from "react";
import { LineChart, Sparkles, History, Newspaper } from "lucide-react";
import clsx from "clsx";
import PriceChart from "./PriceChart";
import PredictionCard from "./PredictionCard";
import BacktestResults from "./BacktestResults";
import NewsSection from "./NewsSection";
import type { Market, NewsCategory } from "../api/client";

type Panel = "chart" | "predict" | "backtest" | "news";

const PANELS: { id: Panel; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "chart",    label: "Chart",      icon: LineChart },
  { id: "predict",  label: "AI Predict", icon: Sparkles },
  { id: "backtest", label: "Backtest",   icon: History },
  { id: "news",     label: "News",       icon: Newspaper },
];

interface Props {
  market:       Market;
  symbol:       string;
  header:       ReactNode;
  newsCategory: NewsCategory;
  currency?:    string;
}

/** Shared detail view (header + Chart / AI Predict / Backtest / News) for every market. */
export default function AssetDetail({ market, symbol, header, newsCategory, currency = "$" }: Props) {
  // The chosen panel is kept when the user switches asset, so it's easy to
  // compare predictions across several assets.
  const [panel, setPanel] = useState<Panel>("chart");

  return (
    <div className="space-y-3 sm:space-y-4">
      {header}

      <div role="tablist" aria-label="Analysis" className="grid grid-cols-4 gap-1 bg-surface border border-border rounded-lg p-1">
        {PANELS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            onClick={() => setPanel(id)}
            className={clsx(
              "flex items-center justify-center gap-1.5 min-h-[40px] rounded-md text-xs sm:text-sm font-medium transition-colors",
              panel === id ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="w-4 h-4 hidden xs:block" />
            {label}
          </button>
        ))}
      </div>

      {panel === "chart"    && <PriceChart market={market} symbol={symbol} currency={currency} />}
      {panel === "predict"  && <PredictionCard market={market} symbol={symbol} currency={currency} />}
      {panel === "backtest" && <BacktestResults market={market} symbol={symbol} currency={currency} />}
      {panel === "news"     && (
        <NewsSection category={newsCategory} symbol={symbol} market={market} maxItems={12} showFilters={false} />
      )}
    </div>
  );
}
