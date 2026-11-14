import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CheckCircle, XCircle, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { fetchBacktest, Market, BacktestPoint } from "../api/client";
import { fmtAxis, fmtPrice, fmtDate } from "../utils/format";
import { useChartColors } from "../theme/ThemeProvider";

interface Props { market: Market; symbol: string; currency?: string }

export default function BacktestResults({ market, symbol, currency = "$" }: Props) {
  const colors = useChartColors();
  const { data: signals = [], isLoading, isError, refetch } = useQuery<BacktestPoint[]>({
    queryKey: ["backtest", market, symbol],
    queryFn:  () => fetchBacktest(market, symbol),
    staleTime: 10 * 60_000,
  });

  const stats = useMemo(() => {
    const n = (f: (s: BacktestPoint) => boolean) => signals.filter(f).length;
    const total = signals.length;
    const correct = n(s => s.correct);
    return {
      correctBuys:  n(s => s.signal === "BUY"  && s.correct),
      wrongBuys:    n(s => s.signal === "BUY"  && !s.correct),
      correctSells: n(s => s.signal === "SELL" && s.correct),
      wrongSells:   n(s => s.signal === "SELL" && !s.correct),
      accuracy:     total ? Math.round((correct / total) * 100) : 0,
      total,
    };
  }, [signals]);

  if (isLoading) {
    return (
      <div className="card p-4 space-y-3" aria-busy="true">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-44 w-full" />
        <p className="text-xs text-muted text-center">Running the walk-forward backtest… this shares its work with the AI prediction, so it's quick once one of them has loaded.</p>
      </div>
    );
  }
  if (isError || !signals.length) {
    return (
      <div className="card p-6 text-center text-sm text-muted">
        <p>No backtest data available for {symbol}.</p>
        <button type="button" onClick={() => refetch()} className="mt-3 inline-flex items-center gap-2 px-4 min-h-[40px] rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  }

  const marker = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g />;
    const up = payload.signal === "BUY";
    const fill = payload.correct ? colors.success : colors.danger;
    const d = up ? `M${cx},${cy - 6} L${cx + 5.5},${cy + 4} L${cx - 5.5},${cy + 4} Z`
                 : `M${cx},${cy + 6} L${cx + 5.5},${cy - 4} L${cx - 5.5},${cy - 4} Z`;
    return <path d={d} fill={fill} stroke={colors.card} strokeWidth={1} />;
  };

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-fg text-sm">Backtest · last {stats.total} signals</h3>
          <p className="text-xs text-muted">Each marker is a 7-day call made by a model trained only on data before that date.</p>
        </div>
        <span className={clsx("text-xs font-bold px-2.5 py-1 rounded-full",
          stats.accuracy >= 55 ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
          {stats.accuracy}% correct
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={signals} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={d => fmtDate(d)} tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={["auto", "auto"]} tickFormatter={fmtAxis} tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56} orientation="right" />
          <Tooltip
            cursor={{ stroke: colors.muted, strokeDasharray: "3 3" }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const s = payload[0].payload as BacktestPoint;
              return (
                <div className="card p-2.5 text-xs shadow-xl">
                  <p className="text-muted">{fmtDate(s.date, { day: "numeric", month: "short", year: "numeric" })}</p>
                  <p className="font-mono text-fg">{fmtPrice(s.price, currency)}</p>
                  <p className={clsx("font-semibold", s.signal === "BUY" ? "text-success" : "text-danger")}>{s.signal} · {s.prob}% up</p>
                  <p className={s.correct ? "text-success" : "text-danger"}>{s.correct ? "Correct" : "Wrong"} 7 days later</p>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="price" stroke={colors.muted} strokeWidth={1.25} dot={false} isAnimationActive={false} />
          <Scatter dataKey="price" shape={marker} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted -mt-2">
        <span>▲ BUY call</span><span>▼ SELL call</span>
        <span><span className="text-success">■</span> correct</span><span><span className="text-danger">■</span> wrong</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
        {[
          { label: "Correct BUY",  value: stats.correctBuys,  color: "text-success" },
          { label: "Wrong BUY",    value: stats.wrongBuys,    color: "text-danger" },
          { label: "Correct SELL", value: stats.correctSells, color: "text-success" },
          { label: "Wrong SELL",   value: stats.wrongSells,   color: "text-danger" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-border rounded-lg p-2">
            <p className="text-muted">{label}</p>
            <p className={clsx("font-bold font-mono text-base", color)}>{value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs text-muted mb-1">Most recent calls</p>
        <ul className="max-h-56 overflow-y-auto divide-y divide-border/60">
          {signals.slice(-15).reverse().map(s => (
            <li key={s.date} className="flex items-center justify-between gap-2 py-1.5 px-1 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {s.correct
                  ? <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" aria-label="Correct" />
                  : <XCircle className="w-3.5 h-3.5 text-danger flex-shrink-0" aria-label="Wrong" />}
                <span className="text-muted">{fmtDate(s.date, { day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={clsx("font-bold", s.signal === "BUY" ? "text-success" : "text-danger")}>{s.signal}</span>
                <span className="font-mono text-fg2">{fmtPrice(s.price, currency)}</span>
                <span className="text-muted w-10 text-right">{s.prob}%</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
