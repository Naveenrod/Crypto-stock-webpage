import { useQuery } from "@tanstack/react-query";
import {
  Trophy, RefreshCw, Cpu, Clock, CheckCircle,
  TrendingUp, TrendingDown, Minus, AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import { fetchTopPicks, TopPick, TopPicksResult, TopPickIndicators } from "../api/client";

// ── Rank badge: gold / silver / bronze / muted ───────────────────────────────
const RANK_STYLES: Record<number, string> = {
  1: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
  2: "bg-slate-400/20  text-slate-300   border-slate-400/40",
  3: "bg-orange-600/20 text-orange-400  border-orange-600/40",
};

function RankBadge({ rank }: { rank: number }) {
  const cls = RANK_STYLES[rank] ?? "bg-surface text-muted border-border";
  return (
    <span
      className={clsx(
        "w-7 h-7 rounded-full border flex items-center justify-center",
        "text-xs font-bold flex-shrink-0",
        cls,
      )}
    >
      #{rank}
    </span>
  );
}

// ── Signal badge ─────────────────────────────────────────────────────────────
function SignalBadge({ signal }: { signal: "BUY" | "SELL" | "HOLD" }) {
  const cls =
    signal === "BUY"  ? "bg-success/10 text-success border-success/30" :
    signal === "SELL" ? "bg-danger/10  text-danger  border-danger/30"  :
                        "bg-warning/10 text-warning border-warning/30";
  return (
    <span className={clsx("px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wide", cls)}>
      {signal}
    </span>
  );
}

// ── Trend icon ───────────────────────────────────────────────────────────────
function TrendBadge({ trend }: { trend: string }) {
  if (trend === "Bullish")
    return <span className="flex items-center gap-0.5 text-[11px] font-bold text-success"><TrendingUp className="w-3 h-3" />Bullish</span>;
  if (trend === "Bearish")
    return <span className="flex items-center gap-0.5 text-[11px] font-bold text-danger"><TrendingDown className="w-3 h-3" />Bearish</span>;
  return <span className="flex items-center gap-0.5 text-[11px] font-bold text-warning"><Minus className="w-3 h-3" />Sideways</span>;
}

// ── Score bar ────────────────────────────────────────────────────────────────
function ScoreBar({ score, signal }: { score: number; signal: string }) {
  const color =
    signal === "BUY"  ? "bg-success" :
    signal === "SELL" ? "bg-danger"  : "bg-warning";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted">ML Score</span>
        <span className="font-mono font-bold text-slate-200">{score}/100</span>
      </div>
      <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

// ── "Why this pick?" tooltip ─────────────────────────────────────────────────
function WhyTooltip({ indicators, signal }: { indicators: TopPickIndicators; signal: string }) {
  const reasons: string[] = [];
  if (indicators.rsi_signal === "Oversold")            reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`);
  if (indicators.rsi_signal === "Overbought")          reasons.push(`RSI overbought (${indicators.rsi.toFixed(1)})`);
  if (indicators.macd_bullish && signal === "BUY")     reasons.push("MACD bullish crossover");
  if (!indicators.macd_bullish && signal === "SELL")   reasons.push("MACD bearish crossover");
  if (indicators.golden_cross)                         reasons.push("Golden cross (SMA50 > SMA200)");
  if (indicators.volume_surge)                         reasons.push("Volume surge detected");
  if (indicators.bb_signal?.includes("support"))       reasons.push("Near Bollinger support");
  if (indicators.bb_signal?.includes("resistance"))    reasons.push("Near Bollinger resistance");
  if (indicators.trend_strength === "Strong")          reasons.push(`Strong trend (ADX ${indicators.adx.toFixed(0)})`);

  const top3 = reasons.slice(0, 3);
  if (!top3.length) top3.push("Composite score from 30+ technical indicators");

  return (
    <div className="group relative inline-block">
      <button className="text-[10px] text-muted/70 hover:text-accent underline underline-offset-2 cursor-help transition-colors">
        Why this pick?
      </button>
      <div
        className={clsx(
          "absolute bottom-full left-0 mb-2 w-56 z-50",
          "bg-card border border-border rounded-xl p-3 shadow-2xl",
          "opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150",
          "text-[10px] space-y-1.5",
        )}
      >
        <p className="font-semibold text-white text-[11px] mb-1">Key signals aligned:</p>
        {top3.map((r, i) => (
          <p key={i} className="flex items-start gap-1.5 text-muted">
            <span className="text-accent mt-0.5">•</span>
            <span>{r}</span>
          </p>
        ))}
        <p className="text-muted/50 pt-1 border-t border-border text-[9px]">Not financial advice.</p>
      </div>
    </div>
  );
}

// ── Single pick card ─────────────────────────────────────────────────────────
function PickCard({ pick, rank }: { pick: TopPick; rank: number }) {
  const isUp = pick.change_24h >= 0;

  const fmtPrice = (n: number) =>
    n >= 1000
      ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : n >= 1
      ? `$${n.toFixed(2)}`
      : `$${n.toFixed(5)}`;

  return (
    <div className="bg-surface border border-border rounded-xl p-3 space-y-2.5 hover:border-accent/40 transition-colors">
      {/* Row 1: Rank · Symbol · Name · Price */}
      <div className="flex items-start gap-2">
        <RankBadge rank={rank} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-white">{pick.symbol}</span>
            <SignalBadge signal={pick.signal} />
          </div>
          <p className="text-[10px] text-muted truncate mt-0.5">{pick.name}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs font-mono text-white font-semibold">
            {fmtPrice(pick.current_price)}
          </p>
          <p className={clsx("text-[10px] font-medium", isUp ? "text-success" : "text-danger")}>
            {isUp ? "+" : ""}{pick.change_24h.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Score bar */}
      <ScoreBar score={pick.score} signal={pick.signal} />

      {/* Stats grid: ML prob · Backtest · Trend */}
      <div className="grid grid-cols-3 gap-1">
        <div className="bg-card rounded-lg p-1.5 text-center">
          <p className="text-[9px] text-muted leading-tight">ML Prob</p>
          <p className="text-[11px] font-mono font-bold text-slate-200 mt-0.5">
            {pick.ml_probability}%
          </p>
        </div>
        <div className="bg-card rounded-lg p-1.5 text-center">
          <p className="text-[9px] text-muted leading-tight">Backtest</p>
          <p className={clsx(
            "text-[11px] font-mono font-bold mt-0.5",
            pick.backtest_accuracy >= 55 ? "text-success" :
            pick.backtest_accuracy >= 45 ? "text-warning" : "text-danger",
          )}>
            {pick.backtest_accuracy}%
          </p>
        </div>
        <div className="bg-card rounded-lg p-1.5 text-center">
          <p className="text-[9px] text-muted leading-tight">Trend</p>
          <div className="mt-0.5 flex justify-center">
            <TrendBadge trend={pick.trend} />
          </div>
        </div>
      </div>

      {/* Why tooltip */}
      <WhyTooltip indicators={pick.indicators} signal={pick.signal} />
    </div>
  );
}

// ── Category section (Crypto / US / AU) ──────────────────────────────────────
interface CategorySectionProps {
  title:   string;
  emoji:   string;
  picks:   TopPick[];
  accentColor: string;
}

function CategorySection({ title, emoji, picks, accentColor }: CategorySectionProps) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className={clsx("px-4 py-3 border-b border-border flex items-center gap-2", accentColor)}>
        <span className="text-lg">{emoji}</span>
        <h3 className="font-semibold text-white flex-1">{title}</h3>
        <span className="text-[10px] text-muted bg-surface px-2 py-0.5 rounded-full border border-border">
          TOP {picks.length}
        </span>
      </div>

      {/* Pick cards */}
      <div className="p-3 space-y-2">
        {picks.length > 0 ? (
          picks.map((pick, idx) => (
            <PickCard key={pick.symbol} pick={pick} rank={idx + 1} />
          ))
        ) : (
          <div className="py-8 text-center">
            <AlertTriangle className="w-6 h-6 text-warning mx-auto mb-2" />
            <p className="text-sm text-muted">No picks available</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scanning loader (shown on first cold scan) ────────────────────────────────
function ScanningLoader() {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-6">
      {/* Icon */}
      <div className="w-16 h-16 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center">
        <Cpu className="w-8 h-8 text-accent animate-pulse" />
      </div>

      {/* Message */}
      <div className="text-center space-y-1.5">
        <p className="text-white font-semibold text-lg">Scanning 235 assets with ML...</p>
        <p className="text-sm text-muted">Running Random Forest · Gradient Boosting · XGBoost</p>
        <p className="text-xs text-muted/60">
          First scan: ~30-60 s &nbsp;·&nbsp; Results cached for 5 min
        </p>
      </div>

      {/* Animated shimmer bar */}
      <div className="w-72 h-1.5 bg-surface rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full skeleton" style={{ width: "100%" }} />
      </div>

      {/* Skeleton grid */}
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="skeleton h-4 w-28 rounded" />
            <div className="border-t border-border pt-3 space-y-2">
              {[0, 1, 2, 3, 4].map((j) => (
                <div key={j} className="skeleton h-[88px] w-full rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TopPicksTab() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<TopPicksResult>({
    queryKey:   ["picks", "top5"],
    queryFn:    fetchTopPicks,
    staleTime:  300_000,   // 5 min — matches server TTL
    retry:      1,
    retryDelay: 3000,
  });

  if (isLoading) return <ScanningLoader />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <AlertTriangle className="w-10 h-10 text-danger" />
        <p className="text-danger font-semibold text-lg">Scan failed</p>
        <p className="text-sm text-muted text-center max-w-sm">
          Could not complete the 235-asset ML scan. This can happen if the server is busy. Please try again.
        </p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30 transition-colors text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Retry Scan
        </button>
      </div>
    );
  }

  const computedAt = data ? new Date(data.computed_at) : null;
  const minsAgo    = computedAt
    ? Math.max(0, Math.round((Date.now() - computedAt.getTime()) / 60_000))
    : 0;

  return (
    <div className="space-y-4">

      {/* ── Header bar ─────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 flex-wrap">
        {/* Icon + title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center flex-shrink-0">
            <Trophy className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="font-semibold text-white leading-tight">Top 5 ML Picks</h2>
            <p className="text-xs text-muted">
              {data?.total_scanned ?? 0} of 235 assets scanned · ranked by composite score
            </p>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Cache status */}
        {data && (
          <div className="flex items-center gap-1.5 text-xs">
            {data.from_cache ? (
              <>
                <Clock className="w-3.5 h-3.5 text-muted" />
                <span className="text-muted">
                  {minsAgo === 0 ? "Just now" : `${minsAgo}m ago`}
                </span>
              </>
            ) : (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-success" />
                <span className="text-success font-medium">Fresh scan</span>
              </>
            )}
          </div>
        )}

        {/* Rescan button */}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            "bg-surface border border-border text-muted",
            "hover:border-accent/40 hover:text-slate-300",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <RefreshCw className={clsx("w-3.5 h-3.5", isFetching && "animate-spin")} />
          {isFetching ? "Scanning..." : "Rescan"}
        </button>
      </div>

      {/* ── Picks grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CategorySection
          title="Crypto"
          emoji="₿"
          picks={data?.crypto ?? []}
          accentColor="bg-orange-500/5"
        />
        <CategorySection
          title="US Stocks"
          emoji="🇺🇸"
          picks={data?.us_stocks ?? []}
          accentColor="bg-blue-500/5"
        />
        <CategorySection
          title="AU Stocks"
          emoji="🇦🇺"
          picks={data?.au_stocks ?? []}
          accentColor="bg-yellow-500/5"
        />
      </div>

      {/* ── Footer disclaimer ───────────────────────────────────── */}
      <p className="text-center text-[10px] text-muted/50 pb-2">
        Rankings are based on a composite ML score (Random Forest + Gradient Boosting + XGBoost) and 30+ technical
        indicators. Past performance does not guarantee future results. Not financial advice — always do your own research.
      </p>
    </div>
  );
}
