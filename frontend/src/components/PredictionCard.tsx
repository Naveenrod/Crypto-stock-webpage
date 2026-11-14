import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, AlertCircle, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { fetchPrediction, Market, Prediction } from "../api/client";
import { fmtPrice, fmtDate } from "../utils/format";
import { useChartColors } from "../theme/ThemeProvider";

interface Props { market: Market; symbol: string; currency?: string }

function ScoreRing({ score }: { score: number }) {
  const colors = useChartColors();
  const r = 28, c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = score >= 62 ? colors.success : score <= 38 ? colors.danger : colors.warning;
  return (
    <div className="relative flex items-center justify-center w-20 h-20 flex-shrink-0" role="img" aria-label={`Composite score ${score} out of 100`}>
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke={colors.grid} strokeWidth="5" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div className="absolute text-center">
        <div className="text-lg font-bold text-fg leading-none">{score}</div>
        <div className="text-[10px] text-muted">/ 100</div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={clsx("text-xs font-medium font-mono text-right",
        tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-fg2")}>{value}</span>
    </div>
  );
}

function Loading({ symbol }: { symbol: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => { const id = setInterval(() => setSec(s => s + 1), 1000); return () => clearInterval(id); }, []);
  return (
    <div className="card p-5 space-y-3" aria-busy="true" aria-live="polite">
      <div className="skeleton h-5 w-40" />
      <div className="flex gap-6 items-center"><div className="skeleton h-20 w-20 rounded-full" /><div className="space-y-2 flex-1"><div className="skeleton h-8 w-28" /><div className="skeleton h-3 w-40" /><div className="skeleton h-3 w-32" /></div></div>
      <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
      <p className="text-xs text-muted text-center pt-1">
        Training three models on two years of {symbol} data… usually 5–15 s the first time{sec > 0 && ` · ${sec}s`}
      </p>
    </div>
  );
}

export default function PredictionCard({ market, symbol, currency = "$" }: Props) {
  const { data: pred, isLoading, isError, refetch, isFetching } = useQuery<Prediction>({
    queryKey: ["predict", market, symbol],
    queryFn:  () => fetchPrediction(market, symbol),
    staleTime: 10 * 60_000,   // the server caches the analysis for an hour
    retry: 1,
  });

  if (isLoading) return <Loading symbol={symbol} />;

  if (isError || !pred || pred.error) {
    return (
      <div className="card p-6 text-center">
        <AlertCircle className="w-8 h-8 text-muted mx-auto mb-2" />
        <p className="text-sm text-fg2">{pred?.error || "The prediction could not be loaded."}</p>
        <p className="text-xs text-muted mt-1">The server may be busy with a background scan — it is safe to try again.</p>
        <button type="button" onClick={() => refetch()} className="mt-3 inline-flex items-center gap-2 px-4 min-h-[40px] rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  }

  const SignalIcon = pred.signal === "BUY" ? TrendingUp : pred.signal === "SELL" ? TrendingDown : Minus;
  const signalCls = pred.signal === "BUY" ? "bg-success/10 border-success/30 text-success"
                  : pred.signal === "SELL" ? "bg-danger/10 border-danger/30 text-danger"
                  : "bg-warning/10 border-warning/30 text-warning";
  const ind = pred.indicators;
  const bt  = pred.backtest ?? {};
  const hasBacktest = typeof bt.accuracy === "number" && (bt.period_days ?? 0) > 0;
  const breakdown = pred.score_breakdown ?? [];
  const fp = (n: number) => fmtPrice(n, currency);

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-fg">AI prediction</h3>
          <p className="text-xs text-muted mt-0.5">
            {pred.as_of ? <>Based on the candle closing {fmtDate(pred.as_of, { day: "numeric", month: "short" })} · </> : null}
            {pred.prediction_horizon} horizon
          </p>
        </div>
        <button type="button" onClick={() => refetch()} aria-label="Refresh prediction" className="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-fg hover:bg-surface transition-colors">
          <RefreshCw className={clsx("w-4 h-4", isFetching && "animate-spin")} />
        </button>
      </div>

      <div className="flex items-center gap-5">
        <ScoreRing score={pred.score} />
        <div className="min-w-0">
          <div className={clsx("inline-flex items-center gap-2 px-4 py-1.5 rounded-full border text-base font-bold mb-2", signalCls)}>
            <SignalIcon className="w-5 h-5" />{pred.signal}
          </div>
          <p className="text-xs text-muted">ML probability of a rise: <span className="text-fg2 font-mono">{pred.ml_probability}%</span></p>
          <p className="text-xs text-muted">Model confidence: <span className="text-fg2 font-mono">{pred.confidence}%</span></p>
          <p className="text-xs text-muted">Trend: <span className={clsx("font-medium",
            pred.trend === "Bullish" ? "text-success" : pred.trend === "Bearish" ? "text-danger" : "text-warning")}>{pred.trend}</span></p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Target ↑",  value: fp(pred.target_price_up), cls: "text-success" },
          { label: "Current",   value: fp(pred.current_price),   cls: "text-fg" },
          { label: "Stop loss", value: fp(pred.stop_loss),       cls: "text-danger" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-surface border border-border rounded-lg p-2">
            <p className="text-[11px] text-muted">{label}</p>
            <p className={clsx("text-xs sm:text-sm font-bold font-mono", cls)}>{value}</p>
          </div>
        ))}
      </div>

      {breakdown.length > 0 && (
        <div>
          <p className="text-xs text-muted mb-2 font-medium uppercase tracking-wide">How the score is built</p>
          <div className="space-y-1.5">
            {breakdown.map(part => {
              const pct = Math.max(0, Math.min(100, (part.points / part.max) * 100));
              const neg = part.points < 0;
              return (
                <div key={part.label} className="grid grid-cols-[7rem_1fr_3.5rem] sm:grid-cols-[9rem_1fr_3.5rem] items-center gap-2 text-xs">
                  <span className="text-muted truncate">{part.label}</span>
                  <div className="h-1.5 bg-surface border border-border rounded-full overflow-hidden">
                    <div className={clsx("h-full rounded-full", neg ? "bg-danger" : "bg-accent")} style={{ width: `${neg ? Math.min(100, (Math.abs(part.points) / part.max) * 100) : pct}%` }} />
                  </div>
                  <span className={clsx("font-mono text-right", neg ? "text-danger" : "text-fg2")}>{part.points > 0 ? "+" : ""}{part.points}/{part.max}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted mt-1.5">≥ 62 = BUY · ≤ 38 = SELL · otherwise HOLD. The ML model contributes half; technical indicators the rest.</p>
        </div>
      )}

      <div>
        <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Indicators</p>
        <div className="bg-surface border border-border rounded-lg px-3 grid sm:grid-cols-2 sm:gap-x-6">
          <Stat label="RSI (14)" value={`${ind.rsi} · ${ind.rsi_signal}`} tone={ind.rsi_signal === "Oversold" ? "good" : ind.rsi_signal === "Overbought" ? "bad" : undefined} />
          <Stat label="MACD" value={ind.macd_bullish ? "Bullish" : "Bearish"} tone={ind.macd_bullish ? "good" : "bad"} />
          <Stat label="Bollinger bands" value={ind.bb_signal} tone={ind.bb_signal.includes("support") ? "good" : ind.bb_signal.includes("resistance") ? "bad" : undefined} />
          <Stat label="Golden cross" value={ind.golden_cross ? "Yes" : "No"} tone={ind.golden_cross ? "good" : undefined} />
          <Stat label="Volume" value={ind.volume_surge ? "Surge" : "Normal"} tone={ind.volume_surge ? "good" : undefined} />
          <Stat label="ADX" value={`${ind.adx} · ${ind.trend_strength}`} tone={ind.trend_strength === "Strong" ? "good" : undefined} />
          <Stat label="SMA 20" value={fp(ind.sma_20)} />
          <Stat label="SMA 50" value={fp(ind.sma_50)} />
          <Stat label="SMA 200" value={fp(ind.sma_200)} />
        </div>
      </div>

      {hasBacktest && (
        <div>
          <p className="text-xs text-muted mb-1 font-medium uppercase tracking-wide">Out-of-sample backtest · last {bt.period_days} days</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Accuracy",      value: `${bt.accuracy}%`,        color: (bt.accuracy ?? 0) >= 55 ? "text-success" : "text-warning" },
              { label: "Precision",     value: `${bt.precision}%`,       color: "text-fg2" },
              { label: "Profit factor", value: `${bt.profit_factor}×`,   color: (bt.profit_factor ?? 0) >= 1 ? "text-success" : "text-danger" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface border border-border rounded-lg p-2">
                <p className="text-[11px] text-muted">{label}</p>
                <p className={clsx("text-sm font-bold font-mono", color)}>{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-1 text-center">
            {bt.correct}/{bt.total_signals} correct 7-day calls, each made by a model that had not seen that period.
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted border-t border-border/60 pt-2">{pred.disclaimer}</p>
    </div>
  );
}
