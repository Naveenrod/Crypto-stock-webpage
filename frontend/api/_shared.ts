// Helpers shared by the Vercel serverless functions (files prefixed with "_"
// are not exposed as routes).
import type { VercelResponse } from "@vercel/node";

export const UA = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "*/*",
};

export async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** JSON response; `cacheSeconds` sets edge caching (shared by every visitor). */
export function send(res: VercelResponse, status: number, body: unknown, cacheSeconds = 0): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cacheSeconds > 0
    ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 3}`
    : "no-store");
  res.status(status).send(JSON.stringify(body));
}

export const str = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));
