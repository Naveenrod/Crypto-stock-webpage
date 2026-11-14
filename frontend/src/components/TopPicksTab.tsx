import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trophy, RefreshCw, Clock, CheckCircle, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Cpu, ChevronRight, Info,
} from "lucide-react";
import clsx from "clsx";
import { fetchTopPicks, TopPick, TopPicksResult, Indicators, Market } from "../api/client";
import { fmtPrice, fmtPct, fmtDate, minutesAgo } from "../utils/format";

interface Props { onOpenAsset: (market: Market, symbol: string) => void }

const PICKS_KEY = ["picks", "top5"];

// ── Small presentational pieces ───────────────────────────────────────────────
const RANK_STYLES: Record<number, string> = {
  1: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/40",
  2: "bg-slate-400/20  text-slate-600  dark:text-slate-300  border-slate-400/40",
  3: "bg-orange-600/15 text-orange-700 dark:text-orange-300 border-orange-600/40",
};

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className={clsx("w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold flex-shrink-0",
      RANK_STYLES[rank] ?? "bg-surface text-muted border-border")}>
      {rank}
    </span>
  );
}

function SignalBadge({ signal }: { signal: TopPick["signal"] }) {
  const cls = signal === "BUY"  ? "bg-success/10 text-success border-success/30"
            : signal === "SELL" ? "bg-danger/10  text-danger  border-danger/30"
            :                     "bg-warning/10 text-warning border-warning/30";
  return <span className={clsx("px-2 py-0.5 rounded-full border text-[11px] font-bold tracking-wide", cls)}>{signal}</span>;
}

function TrendBadge({ trend }: { trend: string }) {
  const Icon = trend === "Bullish" ? TrendingUp : trend === "Bearish" ? TrendingDown : Minus;
  const cls  = trend === "Bullish" ? "text-success" : trend === "Bearish" ? "text-danger" : "text-warning";
  return <span className={clsx("inline-flex items-center gap-0.5 text-xs font-bold", cls)}><Icon className="w-3 h-3" />{trend}</span>;
}

function reasonsFor(ind: Indicators, signal: string): string[] {
  const r: string[] = [];
  if (ind.rsi_signal === "Oversold")           r.push(`RSI oversold (${ind.rsi.toFixed(1)})`);
  if (ind.rsi_signal === "Overbought")         r.push(`RSI overbought (${ind.rsi.toFixed(1)})`);
  if (ind.macd_bullish && signal === "BUY")    r.push("MACD bullish crossover");
  if (!ind.macd_bullish && signal === "SELL")  r.push("MACD bearish crossover");
  if (ind.golden_cross)                        r.push("Golden cross (SMA 50 > SMA 200)");
  if (ind.volume_surge)                        r.push("Volume surge");
  if (ind.bb_signal?.includes("support"))      r.push("Near Bollinger support");
  if (ind.bb_signal?.includes("resistance"))   r.push("Near Bollinger resistance");
  if (ind.trend_strength === "Strong")         r.push(`Strong trend (ADX ${ind.adx.toFixed(0)})`);
  return r.length ? r.slice(0, 3) : ["Composite of the ML probability and 30+ technical indicators"];
}

/** Tap/click to toggle (hover-only tooltips can't be opened on touch screens). */
function WhyPopover({ indicators, signal }: { indicators: Indicators; signal: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("touchstart", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("touchstart", close); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 min-h-[40px] text-xs text-muted hover:text-accent"
      >
        <Info className="w-3.5 h-3.5" /> Why this pick?
      </button>
      {open && (
        <div role="dialog" className="absolute bottom-full left-0 mb-1 w-60 z-30 card p-3 shadow-xl text-xs space-y-1.5">
          <p className="font-semibold text-fg">Key signals</p>
          {reasonsFor(indicators, signal).map(r => (
            <p key={r} className="flex items-start gap-1.5 text-fg2"><span className="text-accent">•</span><span>{r}</span></p>
          ))}
          <p className="text-muted pt-1 border-t border-border text-[11px]">Not financial advice.</p>
        </div>
      )}
    </div>
  );
}

function PickCard({ pick, rank, onOpen }: { pick: TopPick; rank: number; onOpen: () => void }) {
  const isUp = pick.change_24h >= 0;
  const color = pick.signal === "BUY" ? "bg-success" : pick.signal === "SELL" ? "bg-danger" : "bg-warning";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="group bg-surface border border-border rounded-xl p-3 space-y-2.5 hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer transition-colors"
    >
      <div className="flex items-start gap-2">
        <RankBadge rank={rank} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-fg">{pick.symbol.replace(/\.AX$/, "")}</span>
            <SignalBadge signal={pick.signal} />
          </div>
          <p className="text-xs text-muted truncate mt-0.5">{pick.name}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono text-fg font-semibold">{fmtPrice(pick.current_price, pick.category === "au" ? "A$" : "$")}</p>
          <p className={clsx("text-xs font-medium", isUp ? "text-success" : "text-danger")}>{fmtPct(pick.change_24h)}</p>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">Composite score</span>
          <span className="font-mono font-bold text-fg2">{pick.score}/100</span>
        </div>
        <div className="w-full bg-card border border-border rounded-full h-1.5 overflow-hidden">
          <div className={clsx("h-full rounded-full transition-all duration-700", color)} style={{ width: `${pick.score}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1">
        <div className="bg-card border border-border rounded-lg p-1.5 text-center">
          <p className="text-[11px] text-muted leading-tight">ML prob.</p>
          <p className="text-xs font-mono font-bold text-fg2 mt-0.5">{pick.ml_probability}%</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-1.5 text-center">
          <p className="text-[11px] text-muted leading-tight">{pick.backtest_accuracy != null ? "Backtest" : "Confidence"}</p>
          <p className={clsx("text-xs font-mono font-bold mt-0.5",
            pick.backtest_accuracy != null
              ? pick.backtest_accuracy >= 55 ? "text-success" : pick.backtest_accuracy >= 45 ? "text-warning" : "text-danger"
              : "text-fg2")}>
            {pick.backtest_accuracy != null ? `${pick.backtest_accuracy}%` : `${pick.confidence}%`}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-1.5 text-center">
          <p className="text-[11px] text-muted leading-tight">Trend</p>
          <div className="mt-0.5 flex justify-center"><TrendBadge trend={pick.trend} /></div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <WhyPopover indicators={pick.indicators} signal={pick.signal} />
        <span className="inline-flex items-center gap-0.5 text-xs text-accent opacity-80 group-hover:opacity-100">
          Analyse <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
}

function CategorySection({ title, emoji, picks, market, scanning, onOpen }: {
  title: string; emoji: string; picks: TopPick[]; market: Market; scanning: boolean; onOpen: (m: Market, s: string) => void;
}) {
  return (
    <section className="card overflow-hidden" aria-label={`${title} top picks`}>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <span className="text-lg" aria-hidden>{emoji}</span>
        <h3 className="font-semibold text-fg flex-1">{title}</h3>
        <span className="text-[11px] text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
          {scanning && picks.length < 5 ? "ranking…" : `top ${picks.length}`}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {picks.map((pick, idx) => <PickCard key={pick.symbol} pick={pick} rank={idx + 1} onOpen={() => onOpen(market, pick.symbol)} />)}
        {scanning && picks.length < 5 && Array.from({ length: 5 - picks.length }).map((_, i) => (
          <div key={`s${i}`} className="skeleton h-[150px] w-full rounded-xl" />
        ))}
        {!scanning && picks.length === 0 && (
          <div className="py-8 text-center">
            <AlertTriangle className="w-6 h-6 text-warning mx-auto mb-2" />
            <p className="text-sm text-muted">No picks available</p>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TopPicksTab({ onOpenAsset }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<TopPicksResult>({
    queryKey: PICKS_KEY,
    queryFn:  () => fetchTopPicks(),
    staleTime: 0,
    // Poll quickly while the server is scanning so picks stream in; otherwise check once a minute.
    refetchInterval: q => (q.state.data?.status === "scanning" ? 2500 : 60_000),
    retry: 2,
  });
  const rescan = useMutation({
    mutationFn: () => fetchTopPicks(true),
    onSuccess:  d => qc.setQueryData(PICKS_KEY, d),
  });

  if (isLoading) {
    return (
      <div className="card p-8 flex flex-col items-center gap-3 text-center" aria-busy="true">
        <Cpu className="w-8 h-8 text-accent animate-pulse" />
        <p className="text-fg font-semibold">Connecting to the ML scanner…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card p-8 flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="w-10 h-10 text-danger" />
        <p className="text-fg font-semibold">Couldn't reach the picks service</p>
        <p className="text-sm text-muted max-w-sm">The server may be restarting. Your other tabs still work; try again in a moment.</p>
        <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  const scanning = data.status === "scanning";
  const { done, total } = data.progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const mins = minutesAgo(data.computed_at);
  const asOf = [...data.crypto, ...data.us_stocks, ...data.au_stocks].find(p => p.as_of)?.as_of;
  const refreshDenied = rescan.data?.refresh_available_in ?? null;

  return (
    <div className="space-y-4">
      {/* Header / status */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <Trophy className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-fg leading-tight">Top 5 ML picks</h2>
            <p className="text-xs text-muted">
              {scanning
                ? data.partial
                  ? <>Scanning {done} of {total} assets — results appear as they're ranked</>
                  : <>Refreshing in the background ({done}/{total}) — showing the previous results meanwhile</>
                : <>{data.total_scanned} of {data.total_assets} assets ranked by composite score{asOf && <> · candles to {fmtDate(asOf)}</>}</>}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {!scanning && data.computed_at && (
              <span className="inline-flex items-center gap-1.5 text-muted">
                {data.stale ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5 text-success" />}
                {mins === 0 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}
              </span>
            )}
            <button
              type="button"
              onClick={() => rescan.mutate()}
              disabled={scanning || rescan.isPending}
              className={clsx("inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg text-xs font-medium transition-colors",
                "bg-surface border border-border text-muted hover:border-accent/40 hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed")}
            >
              <RefreshCw className={clsx("w-3.5 h-3.5", scanning && "animate-spin")} />
              {scanning ? "Scanning…" : "Rescan"}
            </button>
          </div>
        </div>

        {scanning && (
          <div className="space-y-1" aria-live="polite">
            <div className="w-full h-1.5 bg-surface border border-border rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-muted">{pct}% · training three models per asset on two years of daily candles</p>
          </div>
        )}
        {refreshDenied != null && !scanning && (
          <p className="text-[11px] text-muted">Results are fresh — a new scan can be started in {Math.ceil(refreshDenied / 60)} min.</p>
        )}
      </div>

      {/* Picks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <CategorySection title="Crypto"    emoji="₿"  picks={data.crypto}    market="crypto" scanning={scanning && data.partial} onOpen={onOpenAsset} />
        <CategorySection title="US stocks" emoji="🇺🇸" picks={data.us_stocks} market="us"     scanning={scanning && data.partial} onOpen={onOpenAsset} />
        <CategorySection title="AU stocks" emoji="🇦🇺" picks={data.au_stocks} market="au"     scanning={scanning && data.partial} onOpen={onOpenAsset} />
      </div>

      <p className="text-center text-[11px] text-muted pb-2">
        Rankings combine an ML ensemble (Random Forest + Gradient Boosting + XGBoost) with 30+ technical indicators.
        Tap a pick to open its chart, full prediction and backtest. Not financial advice.
      </p>
    </div>
  );
}
