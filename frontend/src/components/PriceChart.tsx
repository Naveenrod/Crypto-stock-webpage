import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar,
} from "recharts";
import clsx from "clsx";
import { fetchChart, Market, OHLCVPoint } from "../api/client";
import { fmtAxis, fmtPrice, fmtPct, fmtCompact, fmtDate, sma } from "../utils/format";
import { useChartColors } from "../theme/ThemeProvider";

const PERIODS = ["1w", "1m", "3m", "6m", "1y", "2y"] as const;
type Period = typeof PERIODS[number];
type Row = OHLCVPoint & { sma20: number | null; sma50: number | null };

interface Props { market: Market; symbol: string; currency?: string }

function ChartTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as Row;
  const isUp = d.close >= d.open;
  const cell = (k: string, v: string, cls = "") => (
    <>
      <span className="text-muted">{k}</span>
      <span className={clsx("font-mono text-right", cls)}>{v}</span>
    </>
  );
  return (
    <div className="card p-3 text-xs shadow-xl">
      <p className="text-muted mb-1.5">{fmtDate(label, { day: "numeric", month: "short", year: "numeric" })}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {cell("Open",  fmtPrice(d.open, currency))}
        {cell("High",  fmtPrice(d.high, currency), "text-success")}
        {cell("Low",   fmtPrice(d.low, currency), "text-danger")}
        {cell("Close", fmtPrice(d.close, currency), clsx("font-semibold", isUp ? "text-success" : "text-danger"))}
        {cell("Volume", fmtCompact(d.volume))}
        {d.sma20 != null && cell("SMA 20", fmtPrice(d.sma20, currency))}
        {d.sma50 != null && cell("SMA 50", fmtPrice(d.sma50, currency))}
      </div>
    </div>
  );
}

export default function PriceChart({ market, symbol, currency = "$" }: Props) {
  const [period, setPeriod]   = useState<Period>("1y");
  const [showSma, setShowSma] = useState(true);
  const colors = useChartColors();

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["chart", market, symbol, period],
    queryFn:  () => fetchChart(market, symbol, period),
    staleTime: 5 * 60_000,
  });

  const rows: Row[] = useMemo(() => {
    const closes = data.map(d => d.close);
    const s20 = sma(closes, 20), s50 = sma(closes, 50);
    return data.map((d, i) => ({ ...d, sma20: s20[i], sma50: s50[i] }));
  }, [data]);

  const first = rows[0], last = rows[rows.length - 1];
  const change = first && last ? (last.close / first.close - 1) * 100 : null;
  const color  = change !== null && change < 0 ? colors.danger : colors.success;
  const hi = rows.length ? Math.max(...rows.map(r => r.high)) : null;
  const lo = rows.length ? Math.min(...rows.map(r => r.low))  : null;
  const tickFmt = (d: string) => fmtDate(d, rows.length > 400 ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  const gradId = `grad-${market}-${symbol}`.replace(/[^a-zA-Z0-9-]/g, "");
  const hasSma = rows.length >= 20;

  if (isLoading) {
    return (
      <div className="card p-4">
        <div className="skeleton h-5 w-40 mb-4" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="card p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-fg">{symbol} price</span>
          {change !== null && (
            <span className={clsx("ml-2 text-sm font-medium", change >= 0 ? "text-success" : "text-danger")}>
              {fmtPct(change)} <span className="text-muted font-normal text-xs">over {period.toUpperCase()}</span>
            </span>
          )}
        </div>
        <div role="group" aria-label="Period" className="flex gap-0.5 bg-surface border border-border rounded-lg p-0.5">
          {PERIODS.map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={clsx("px-2 sm:px-2.5 min-h-[36px] rounded-md text-xs font-medium transition-colors",
                period === p ? "bg-accent text-white" : "text-muted hover:text-fg")}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isError || rows.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted">
          <p>No chart data available.</p>
          <button type="button" onClick={() => refetch()} className="text-accent text-xs underline min-h-[32px]">Try again</button>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={tickFmt} tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={48} />
              <YAxis domain={["auto", "auto"]} tickFormatter={fmtAxis} tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56} orientation="right" />
              <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: colors.muted, strokeDasharray: "3 3" }} />
              <Area type="monotone" dataKey="close" stroke={color} strokeWidth={1.75} fill={`url(#${gradId})`} dot={false} activeDot={{ r: 4, fill: color }} isAnimationActive={false} />
              {showSma && hasSma && <Line type="monotone" dataKey="sma20" stroke={colors.warning} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />}
              {showSma && hasSma && <Line type="monotone" dataKey="sma50" stroke={colors.accent}  strokeWidth={1} dot={false} connectNulls isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>

          <ResponsiveContainer width="100%" height={44}>
            <BarChart data={rows} margin={{ top: 2, right: 60, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <Bar dataKey="volume" fill={colors.volume} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap text-[11px] text-muted">
            <div className="flex gap-3 flex-wrap">
              <span>High <span className="text-fg2 font-mono">{fmtPrice(hi, currency)}</span></span>
              <span>Low <span className="text-fg2 font-mono">{fmtPrice(lo, currency)}</span></span>
              <span>Volume shown below the price</span>
            </div>
            {hasSma && (
              <button type="button" onClick={() => setShowSma(s => !s)} aria-pressed={showSma} className="flex items-center gap-2 min-h-[28px]">
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: colors.warning }} />SMA 20
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: colors.accent }} />SMA 50
                <span className="text-accent">{showSma ? "hide" : "show"}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
