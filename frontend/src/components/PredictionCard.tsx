import { useQuery } from "@tanstack/react-query";
import {
  fetchCryptoPrediction, fetchUSStockPrediction, fetchAUStockPrediction, Prediction
} from "../api/client";
import { TrendingUp, TrendingDown, Minus, AlertCircle, RefreshCw } from "lucide-react";
import clsx from "clsx";

interface Props {
  symbol:    string;
  assetType: "crypto" | "us" | "au";
}

function ScoreRing({ score }: { score: number }) {
  const r = 28, c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 62 ? "#22c55e" : score <= 38 ? "#ef4444" : "#f59e0b";
  return (
    <div className="relative flex items-center justify-center w-20 h-20">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#1e2a42" strokeWidth="5" />
        <circle
          cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-lg font-bold text-white leading-none">{score}</div>
        <div className="text-[9px] text-muted">/ 100</div>
      </div>
    </div>
  );
}

function IndicatorRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={clsx("text-xs font-medium font-mono",
        good === true  ? "text-success" :
        good === false ? "text-danger"  : "text-slate-300"
      )}>{value}</span>
    </div>
  );
}

export default function PredictionCard({ symbol, assetType }: Props) {
  const fetcher =
    assetType === "crypto" ? () => fetchCryptoPrediction(symbol) :
    assetType === "us"     ? () => fetchUSStockPrediction(symbol) :
                              () => fetchAUStockPrediction(symbol);

  const { data: pred, isLoading, error, refetch, isFetching } = useQuery<Prediction>({
    queryKey: ["predict", assetType, symbol],
    queryFn:  fetcher,
    staleTime: 120_000,
  });

  if (isLoading) return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-3">
      <div className="skeleton h-5 w-40" />
      <div className="skeleton h-20 w-full" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-3/4" />
      <p className="text-xs text-muted text-center pt-2">Running ML prediction (may take ~30s)…</p>
    </div>
  );

  if (error || !pred || pred.error) return (
    <div className="bg-card border border-border rounded-xl p-6 text-center">
      <AlertCircle className="w-8 h-8 text-muted mx-auto mb-2" />
      <p className="text-sm text-muted">{pred?.error || "Failed to load prediction"}</p>
    </div>
  );

  const signalIcon = pred.signal === "BUY"
    ? <TrendingUp  className="w-5 h-5" />
    : pred.signal === "SELL"
    ? <TrendingDown className="w-5 h-5" />
    : <Minus className="w-5 h-5" />;

  const signalCls = pred.signal === "BUY"
    ? "bg-success/10 border-success/30 text-success"
    : pred.signal === "SELL"
    ? "bg-danger/10 border-danger/30 text-danger"
    : "bg-warning/10 border-warning/30 text-warning";

  const fmtPrice = (n: number) =>
    n >= 100 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toFixed(4)}`;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">AI Prediction</h3>
        <button onClick={() => refetch()} className="text-muted hover:text-slate-300 transition-colors">
          <RefreshCw className={clsx("w-4 h-4", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* Score + Signal */}
      <div className="flex items-center gap-6">
        <ScoreRing score={pred.score} />
        <div>
          <div className={clsx("inline-flex items-center gap-2 px-4 py-2 rounded-full border text-base font-bold mb-2", signalCls)}>
            {signalIcon}
            {pred.signal}
          </div>
          <p className="text-xs text-muted">ML Probability: <span className="text-slate-300 font-mono">{pred.ml_probability}%</span></p>
          <p className="text-xs text-muted">Confidence: <span className="text-slate-300 font-mono">{pred.confidence}%</span></p>
          <p className="text-xs text-muted">Trend: <span className={clsx("font-medium",
            pred.trend === "Bullish" ? "text-success" : pred.trend === "Bearish" ? "text-danger" : "text-warning"
          )}>{pred.trend}</span></p>
        </div>
      </div>

      {/* Price targets */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Target ↑",   value: fmtPrice(pred.target_price_up),   cls: "text-success" },
          { label: "Current",    value: fmtPrice(pred.current_price),      cls: "text-white" },
          { label: "Stop Loss",  value: fmtPrice(pred.stop_loss),          cls: "text-danger" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-surface rounded-lg p-2">
            <p className="text-[10px] text-muted">{label}</p>
            <p className={clsx("text-xs font-bold font-mono", cls)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Technical Indicators */}
      <div>
        <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Indicators</p>
        <div className="bg-surface rounded-lg p-2">
          <IndicatorRow label="RSI (14)"         value={`${pred.indicators.rsi} — ${pred.indicators.rsi_signal}`}
            good={pred.indicators.rsi_signal === "Oversold" ? true : pred.indicators.rsi_signal === "Overbought" ? false : undefined} />
          <IndicatorRow label="MACD"             value={pred.indicators.macd_bullish ? "Bullish" : "Bearish"}
            good={pred.indicators.macd_bullish} />
          <IndicatorRow label="Bollinger Bands"  value={pred.indicators.bb_signal}
            good={pred.indicators.bb_signal.includes("support") ? true : pred.indicators.bb_signal.includes("resistance") ? false : undefined} />
          <IndicatorRow label="Golden Cross"     value={pred.indicators.golden_cross ? "Yes" : "No"}
            good={pred.indicators.golden_cross} />
          <IndicatorRow label="Volume"           value={pred.indicators.volume_surge ? "Surge" : "Normal"}
            good={pred.indicators.volume_surge} />
          <IndicatorRow label="ADX"              value={`${pred.indicators.adx} — ${pred.indicators.trend_strength}`}
            good={pred.indicators.trend_strength === "Strong"} />
          <IndicatorRow label="SMA 20/50/200"   value={`${fmt(pred.indicators.sma_20)} / ${fmt(pred.indicators.sma_50)}`} />
        </div>
      </div>

      {/* Backtest */}
      {pred.backtest?.accuracy !== undefined && (
        <div>
          <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Backtest (last {pred.backtest.period_days} days)</p>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              { label: "Accuracy",  value: `${pred.backtest.accuracy}%`, color: pred.backtest.accuracy >= 55 ? "text-success" : "text-warning" },
              { label: "Precision", value: `${pred.backtest.precision}%`, color: "text-slate-300" },
              { label: "Profit F.", value: `${pred.backtest.profit_factor}×`, color: pred.backtest.profit_factor >= 1 ? "text-success" : "text-danger" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-lg p-2">
                <p className="text-[10px] text-muted">{label}</p>
                <p className={clsx("text-sm font-bold font-mono", color)}>{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted mt-1 text-center">
            {pred.backtest.correct}/{pred.backtest.total_signals > 0 ? pred.backtest.period_days : "—"} correct signals
          </p>
        </div>
      )}

      {/* Horizon */}
      <p className="text-[10px] text-muted border-t border-border/50 pt-2">
        Horizon: <span className="text-slate-400">{pred.prediction_horizon}</span> &nbsp;·&nbsp; {pred.disclaimer}
      </p>
    </div>
  );
}

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 100) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}
