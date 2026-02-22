import { useQuery } from "@tanstack/react-query";
import {
  fetchCryptoBacktest, fetchUSStockBacktest, fetchAUStockBacktest, BacktestPoint
} from "../api/client";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine
} from "recharts";
import { CheckCircle, XCircle } from "lucide-react";

interface Props {
  symbol:    string;
  assetType: "crypto" | "us" | "au";
}

export default function BacktestResults({ symbol, assetType }: Props) {
  const fetcher =
    assetType === "crypto" ? () => fetchCryptoBacktest(symbol) :
    assetType === "us"     ? () => fetchUSStockBacktest(symbol) :
                              () => fetchAUStockBacktest(symbol);

  const { data: signals = [], isLoading } = useQuery<BacktestPoint[]>({
    queryKey:  ["backtest", assetType, symbol],
    queryFn:   fetcher,
    staleTime: 300_000,
  });

  if (isLoading) return <div className="skeleton h-48 w-full rounded-xl" />;
  if (!signals.length) return (
    <div className="bg-card border border-border rounded-xl p-4 text-center text-sm text-muted">
      No backtest data available.
    </div>
  );

  const correctBuys  = signals.filter(s => s.signal === "BUY"  && s.correct).length;
  const wrongBuys    = signals.filter(s => s.signal === "BUY"  && !s.correct).length;
  const correctSells = signals.filter(s => s.signal === "SELL" && s.correct).length;
  const wrongSells   = signals.filter(s => s.signal === "SELL" && !s.correct).length;
  const totalCorrect = signals.filter(s => s.correct).length;
  const accuracy     = Math.round((totalCorrect / signals.length) * 100);

  // Prepare chart data: index + price coloured by correct/signal
  const chartData = signals.map((s, i) => ({ ...s, idx: i }));

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white text-sm">Backtest Results</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          accuracy >= 55 ? "bg-success/20 text-success" : "bg-warning/20 text-warning"
        }`}>
          {accuracy}% accuracy
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        {[
          { label: "Correct BUY",  value: correctBuys,  color: "text-success" },
          { label: "Wrong BUY",    value: wrongBuys,    color: "text-danger"  },
          { label: "Correct SELL", value: correctSells, color: "text-success" },
          { label: "Wrong SELL",   value: wrongSells,   color: "text-danger"  },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface rounded-lg p-2">
            <p className="text-muted">{label}</p>
            <p className={`font-bold font-mono text-base ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Signal list (last 20) */}
      <div className="space-y-0">
        <p className="text-xs text-muted mb-1">Recent Signals</p>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {signals.slice(-20).reverse().map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1 px-2 rounded hover:bg-surface transition-colors">
              <div className="flex items-center gap-2">
                {s.correct
                  ? <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" />
                  : <XCircle    className="w-3.5 h-3.5 text-danger  flex-shrink-0" />
                }
                <span className="text-[11px] text-muted">{s.date}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] font-bold ${s.signal === "BUY" ? "text-success" : "text-danger"}`}>
                  {s.signal}
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  ${s.price >= 100 ? s.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : s.price.toFixed(4)}
                </span>
                <span className="text-[11px] text-muted">{s.prob}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
