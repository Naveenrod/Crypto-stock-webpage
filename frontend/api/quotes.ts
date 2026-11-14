// GET /api/quotes?market=crypto&symbols=BTC,ETH
// Batch 24 h tickers from Binance (public market-data mirror first: api.binance.com
// is geo-blocked from US data centres such as Vercel's default region).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchWithTimeout, send, str } from "./_shared.js";

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (str(req.query.market) !== "crypto") return send(res, 400, { error: "market must be 'crypto'" });
  const symbols = str(req.query.symbols).split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9]{1,12}$/.test(s));
  const wanted = new Set(symbols.map(s => `${s}USDT`));

  let lastError = "";
  for (const host of HOSTS) {
    try {
      const r = await fetchWithTimeout(`${host}/api/v3/ticker/24hr`, 8000);
      if (!r.ok) { lastError = `${host} → ${r.status}`; continue; }
      const rows = (await r.json()) as Array<Record<string, string>>;
      const quotes = rows
        .filter(d => d.symbol.endsWith("USDT") && (wanted.size === 0 || wanted.has(d.symbol)))
        .map(d => ({
          symbol:     d.symbol.replace(/USDT$/, ""),
          price:      Number(d.lastPrice),
          change_24h: Number(d.priceChangePercent),
          volume_24h: Number(d.quoteVolume),
          high_24h:   Number(d.highPrice),
          low_24h:    Number(d.lowPrice),
          market:     "crypto",
        }));
      return send(res, 200, { quotes, source: host.replace("https://", ""), at: new Date().toISOString() }, 60);
    } catch (e) {
      lastError = `${host} → ${(e as Error).message}`;
    }
  }
  return send(res, 502, { error: "quotes unavailable", detail: lastError });
}
