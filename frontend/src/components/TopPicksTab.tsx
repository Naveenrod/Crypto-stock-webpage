import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trophy, RefreshCw, Clock, CheckCircle, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Cpu, ChevronRight, Info, CalendarClock,
} from "lucide-react";
import clsx from "clsx";
import { fetchTopPicks, fetchCryptoQuotes, getRefreshStatus, startRefresh, setDataVersion, RefreshStatus, TopPick, TopPicksResult, Indicators, Market } from "../api/client";
import { fmtPrice, fmtPct, fmtDate, minutesAgo } from "../utils/format";

interface Props { onOpenAsset: (market: Market, symbol: string) => void }

const PICKS_KEY = ["picks", "top5"];
const STALE_AFTER_MS = 2 * 60 * 60_000;   // auto-refresh when the data set is older than this

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
    // The whole card is clickable for pointer users; the "Analyse" button is the
    // accessible (keyboard / screen-reader) path, so no nested-interactive ARIA.
    <div
      data-pick={pick.symbol}
      onClick={onOpen}
      className="group bg-surface border border-border rounded-xl p-3 space-y-2.5 hover:border-accent/50 cursor-pointer transition-colors"
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
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onOpen(); }}
          aria-label={`Analyse ${pick.symbol.replace(/\.AX$/, "")}`}
          className="inline-flex items-center gap-0.5 min-h-[40px] px-1 text-xs font-medium text-accent opacity-80 group-hover:opacity-100 rounded-md"
        >
          Analyse <ChevronRight className="w-3.5 h-3.5" />
        </button>
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
function RefreshButton({ refresh }: { refresh: ReturnType<typeof useOnDemandRefresh> }) {
  const cooldown = refresh.status?.cooldown_seconds_left ?? 0;
  const unavailable = refresh.statusError ? "Refresh unavailable" : refresh.status && !refresh.status.configured ? "Refresh not set up" : null;
  const disabled = !!unavailable || refresh.running || refresh.start.isPending || cooldown > 0;
  const label = unavailable ?? (refresh.running ? "Retraining…" : refresh.start.isPending ? "Starting…"
              : cooldown > 0 ? `Refresh in ${Math.ceil(cooldown / 60)} min` : "Refresh now");
  const title = refresh.statusError ? `The refresh service returned an error: ${refresh.statusError}`
              : unavailable ? "Add GITHUB_DISPATCH_TOKEN to the Vercel project to enable on-demand refreshes"
              : cooldown > 0 && !refresh.running ? "The data set was refreshed recently" : "Retrain every asset now (takes a few minutes)";
  return (
    <button
      type="button"
      onClick={() => refresh.start.mutate()}
      disabled={disabled}
      title={title}
      className={clsx("inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg text-xs font-medium transition-colors",
        "bg-surface border border-border text-fg2 hover:border-accent/40 hover:text-fg disabled:opacity-60 disabled:cursor-not-allowed")}
    >
      <RefreshCw className={clsx("w-3.5 h-3.5", (refresh.running || refresh.start.isPending) && "animate-spin")} />
      {label}
    </button>
  );
}

/** "Refresh now": starts the GitHub Actions data build and swaps in the result when it lands. */
function useOnDemandRefresh(currentComputedAt: string | null | undefined) {
  const qc = useQueryClient();
  const [kickedAt, setKickedAt] = useState<number | null>(null);
  const [landing, setLanding] = useState(false);          // run finished, waiting for new data to appear
  const prevRunRef = useRef<{ id: number; running: boolean } | null>(null);

  const statusQ = useQuery<RefreshStatus>({
    queryKey: ["refresh-status"],
    queryFn:  getRefreshStatus,
    staleTime: 10_000,
    retry: 1,
    refetchInterval: q => {
      const st = q.state.data;
      if (!st?.configured) return false;
      const recentlyKicked = kickedAt !== null && Date.now() - kickedAt < 60_000;
      return st.running || recentlyKicked || landing ? 10_000 : 60_000;
    },
  });
  const start = useMutation({
    mutationFn: startRefresh,
    onSuccess: st => { if (st.started) setKickedAt(Date.now()); qc.setQueryData(["refresh-status"], st); },
  });

  // Detect "was running → finished successfully" and pull the fresh data set.
  const st = statusQ.data;
  useEffect(() => {
    const run = st?.run;
    if (!run) return;
    const prev = prevRunRef.current;
    if (prev && prev.id === run.id && prev.running && !st.running && run.conclusion === "success") {
      setLanding(true);
      setDataVersion(`r${run.id}`);
      qc.invalidateQueries({ queryKey: PICKS_KEY });
    }
    prevRunRef.current = { id: run.id, running: !!st?.running };
  }, [st?.run?.id, st?.running, st?.run?.conclusion]); // eslint-disable-line react-hooks/exhaustive-deps

  // While "landing", re-read the data with new cache-busters until computed_at changes (CDN lag).
  const landingSinceRef = useRef<number | null>(null);
  const landedFromRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!landing) { landingSinceRef.current = null; landedFromRef.current = undefined; return; }
    if (landingSinceRef.current === null) { landingSinceRef.current = Date.now(); landedFromRef.current = currentComputedAt; }
    if (currentComputedAt !== landedFromRef.current || Date.now() - landingSinceRef.current > 120_000) { setLanding(false); setKickedAt(null); return; }
    const t = setTimeout(() => { setDataVersion(`r${st?.run?.id ?? 0}-${Date.now()}`); qc.invalidateQueries({ queryKey: PICKS_KEY }); }, 10_000);
    return () => clearTimeout(t);
  }, [landing, currentComputedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = !!st?.running || (kickedAt !== null && Date.now() - kickedAt < 60_000 && !st?.run?.conclusion) || landing;

  // Self-healing cadence: if the published data is older than STALE_AFTER and
  // nothing is running, the first visitor triggers a rebuild (server-side
  // cooldown prevents a stampede). Covers GitHub silently skipping cron runs.
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!st?.configured || st.running || autoTriedRef.current || start.isPending || !currentComputedAt) return;
    const ageMs = Date.now() - new Date(currentComputedAt).getTime();
    if (ageMs > STALE_AFTER_MS && st.cooldown_seconds_left === 0) { autoTriedRef.current = true; start.mutate(); }
  }, [st?.configured, st?.running, st?.cooldown_seconds_left, currentComputedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusError = statusQ.error ? ((statusQ.error as any)?.response?.data?.error ?? (statusQ.error as Error).message) : null;
  return { status: st, statusError, running, landing, start, kickedAt };
}

export default function TopPicksTab({ onOpenAsset }: Props) {
  const { data, isLoading, error, refetch } = useQuery<TopPicksResult>({
    queryKey: PICKS_KEY,
    queryFn:  () => fetchTopPicks(),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,     // the data set is rebuilt every 6 h
    retry: 2,
  });

  // Overlay live Binance prices on the crypto picks (the file's prices are from build time).
  const cryptoSymbols = (data?.crypto ?? []).map(p => p.symbol);
  const { data: liveQuotes } = useQuery({
    queryKey: ["quotes", "crypto", cryptoSymbols.join(",")],
    queryFn:  () => fetchCryptoQuotes(cryptoSymbols),
    enabled:  cryptoSymbols.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const refresh = useOnDemandRefresh(data?.computed_at);

  if (isLoading) {
    return (
      <div className="card p-8 flex flex-col items-center gap-3 text-center" aria-busy="true">
        <Cpu className="w-8 h-8 text-accent animate-pulse" />
        <p className="text-fg font-semibold">Loading the latest picks…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card p-8 flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="w-10 h-10 text-danger" />
        <p className="text-fg font-semibold">Couldn't load the picks</p>
        <p className="text-sm text-muted max-w-sm">The data set may still be publishing after an update. Your other tabs still work; try again in a moment.</p>
        <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  const live = Object.fromEntries((liveQuotes ?? []).map(q => [q.symbol, q]));
  const picks = {
    crypto: (data.crypto ?? []).map(p => live[p.symbol] ? { ...p, current_price: live[p.symbol].price, change_24h: live[p.symbol].change_24h } : p),
    us:     data.us_stocks ?? [],
    au:     data.au_stocks ?? [],
  };
  const totalAssets = data.total_assets ?? data.total_scanned ?? 0;
  const mins = minutesAgo(data.computed_at);
  const asOf = [...picks.crypto, ...picks.us, ...picks.au].find(p => p.as_of)?.as_of;
  const nextRefresh = data.next_refresh_at ? new Date(data.next_refresh_at) : null;
  const stale = nextRefresh ? Date.now() > nextRefresh.getTime() + 60 * 60_000 : false;

  return (
    <div className="space-y-4">
      {/* Header / status */}
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center flex-shrink-0">
          <Trophy className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="font-semibold text-fg leading-tight">Top 5 ML picks</h2>
          <p className="text-xs text-muted">
            {data.total_scanned} of {totalAssets} assets ranked by composite score{asOf && <> · candles to {fmtDate(asOf)}</>}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted flex-wrap w-full sm:w-auto">
          <span className="inline-flex items-center gap-1.5" title={data.computed_at ?? undefined}>
            {stale ? <Clock className="w-3.5 h-3.5 text-warning" /> : <CheckCircle className="w-3.5 h-3.5 text-success" />}
            models retrained {mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago
          </span>
          {nextRefresh && !stale && !refresh.running && (
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" />
              next refresh {nextRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {(refresh.status?.configured || refresh.statusError) && (
            <RefreshButton refresh={refresh} />
          )}
        </div>
      </div>
      {refresh.running && (
        <div className="card px-4 py-2.5 flex items-center gap-3 text-xs" aria-live="polite">
          <RefreshCw className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
          <span className="text-fg2">
            {refresh.landing
              ? "Retraining finished — loading the new picks…"
              : "Retraining every asset on GitHub Actions — usually 2–4 minutes. Only assets whose candles changed are recomputed."}
          </span>
          {refresh.status?.run?.html_url && refresh.status.running && (
            <a href={refresh.status.run.html_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-accent whitespace-nowrap">view run</a>
          )}
        </div>
      )}

      {/* Picks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <CategorySection title="Crypto"    emoji="₿"  picks={picks.crypto} market="crypto" scanning={false} onOpen={onOpenAsset} />
        <CategorySection title="US stocks" emoji="🇺🇸" picks={picks.us}     market="us"     scanning={false} onOpen={onOpenAsset} />
        <CategorySection title="AU stocks" emoji="🇦🇺" picks={picks.au}     market="au"     scanning={false} onOpen={onOpenAsset} />
      </div>

      <p className="text-center text-[11px] text-muted pb-2">
        Rankings combine an ML ensemble (Random Forest + Gradient Boosting + XGBoost) with 30+ technical indicators,
        retrained hourly. Tap a pick to open its chart, full prediction and backtest. Not financial advice.
      </p>
    </div>
  );
}
