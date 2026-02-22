import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar
} from "recharts";
import { fetchCryptoChart, fetchUSStockChart, fetchAUStockChart, OHLCVPoint } from "../api/client";

interface Props {
  symbol:     string;
  assetType:  "crypto" | "us" | "au";
}

const PERIODS = ["1w","1m","3m","6m","1y","2y"] as const;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as OHLCVPoint;
  const isUp = d.close >= d.open;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-xl">
      <p className="text-muted mb-1">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted">Open</span>  <span className="font-mono">{fmt(d.open)}</span>
        <span className="text-muted">High</span>  <span className="font-mono text-success">{fmt(d.high)}</span>
        <span className="text-muted">Low</span>   <span className="font-mono text-danger">{fmt(d.low)}</span>
        <span className={`text-muted`}>Close</span>
        <span className={`font-mono font-semibold ${isUp ? "text-success" : "text-danger"}`}>{fmt(d.close)}</span>
      </div>
    </div>
  );
};

function fmt(n: number) {
  if (n >= 1000)  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1)     return n.toFixed(4);
  return n.toFixed(6);
}

export default function PriceChart({ symbol, assetType }: Props) {
  const [period, setPeriod] = useState<typeof PERIODS[number]>("1y");

  const fetcher =
    assetType === "crypto" ? () => fetchCryptoChart(symbol, period) :
    assetType === "us"     ? () => fetchUSStockChart(symbol, period)  :
                              () => fetchAUStockChart(symbol, period);

  const { data = [], isLoading } = useQuery({
    queryKey: ["chart", assetType, symbol, period],
    queryFn: fetcher,
    staleTime: 60_000,
  });

  const isUp = data.length > 1 && data[data.length - 1].close >= data[0].close;
  const color = isUp ? "#22c55e" : "#ef4444";

  if (isLoading) {
    return <div className="skeleton h-64 w-full rounded-xl" />;
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-slate-300">{symbol} Price Chart</span>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                period === p
                  ? "bg-accent text-white"
                  : "text-muted hover:text-slate-300 hover:bg-border"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2a42" />
          <XAxis
            dataKey="date"
            tickFormatter={d => d?.slice(5)}
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={["auto","auto"]}
            tickFormatter={v => fmt(v)}
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${symbol})`}
            dot={false}
            activeDot={{ r: 4, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Volume bars */}
      {data.length > 0 && (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={40}>
            <BarChart data={data} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
              <Bar dataKey="volume" fill="#1e2a42" radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted text-center mt-0.5">Volume</p>
        </div>
      )}
    </div>
  );
}
