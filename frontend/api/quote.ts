// GET /api/quote?symbol=AAPL  (or CBA.AX)
// Single stock quote from Yahoo Finance's chart endpoint (no cookie/crumb needed).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchWithTimeout, send, str } from "./_shared.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const symbol = str(req.query.symbol).toUpperCase().trim();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return send(res, 400, { error: "invalid symbol" });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const r = await fetchWithTimeout(url, 8000);
    if (!r.ok) return send(res, 502, { error: `yahoo → ${r.status}` });
    const j = (await r.json()) as any;
    const result = j?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return send(res, 404, { error: "no data" });
    const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter((v: unknown) => typeof v === "number");
    const price = Number(meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0);
    const prev  = Number(meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2] ?? price);
    return send(res, 200, {
      symbol,
      price,
      change_24h: prev ? Number((((price - prev) / prev) * 100).toFixed(2)) : 0,
      high_24h:   Number(meta.regularMarketDayHigh ?? price),
      low_24h:    Number(meta.regularMarketDayLow ?? price),
      volume_24h: Number(meta.regularMarketVolume ?? 0),
      currency:   meta.currency ?? null,
      market:     symbol.endsWith(".AX") ? "au" : "us",
      at: new Date().toISOString(),
    }, 60);
  } catch (e) {
    return send(res, 502, { error: "quote unavailable", detail: (e as Error).message });
  }
}
