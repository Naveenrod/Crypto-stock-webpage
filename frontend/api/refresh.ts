// GET  /api/refresh  → status of the data-refresh workflow (is a run in progress? cooldown?)
// POST /api/refresh  → start a run (workflow_dispatch), rate-limited to one per REFRESH_COOLDOWN_SECONDS
//
// Needs GITHUB_DISPATCH_TOKEN in the Vercel project: a fine-grained personal
// access token for this repository with "Actions: Read and write". Without it
// the endpoint reports {configured:false} and the UI hides the button.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchWithTimeout, send } from "./_shared.js";

const OWNER    = process.env.GITHUB_REPO_OWNER ?? "Naveenrod";
const REPO     = process.env.GITHUB_REPO_NAME  ?? "Crypto-stock-webpage";
const WORKFLOW = process.env.GITHUB_WORKFLOW_FILE ?? "data-refresh.yml";
const BRANCH   = process.env.GITHUB_WORKFLOW_REF ?? "main";
const COOLDOWN = Number(process.env.REFRESH_COOLDOWN_SECONDS ?? 600);
const TOKEN    = process.env.GITHUB_DISPATCH_TOKEN;

interface Run { id: number; status: string; conclusion: string | null; html_url: string; created_at: string; updated_at: string; event: string }

const gh = (path: string, init: RequestInit = {}) =>
  fetchWithTimeout(`https://api.github.com${path}`, 8000, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "finsight-refresh",
      ...(init.headers || {}),
    },
  });

async function latestRun(): Promise<Run | null> {
  const r = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`);
  if (!r.ok) throw new Error(`GitHub responded ${r.status}`);
  const j = (await r.json()) as any;
  const run = j?.workflow_runs?.[0];
  return run ? { id: run.id, status: run.status, conclusion: run.conclusion, html_url: run.html_url,
                 created_at: run.created_at, updated_at: run.updated_at, event: run.event } : null;
}

function status(run: Run | null) {
  const running = !!run && (run.status === "queued" || run.status === "in_progress" || run.status === "waiting");
  const ageS = run ? (Date.now() - new Date(run.created_at).getTime()) / 1000 : Number.POSITIVE_INFINITY;
  return { configured: true, running, run, cooldown_seconds_left: running ? 0 : Math.max(0, Math.ceil(COOLDOWN - ageS)) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!TOKEN) return send(res, 200, { configured: false, running: false, run: null, cooldown_seconds_left: 0 }, 300);
  try {
    const st = status(await latestRun());
    if (req.method === "GET") return send(res, 200, st, 10);
    if (req.method !== "POST") return send(res, 405, { error: "POST to start a refresh" });
    if (st.running) return send(res, 200, { ...st, started: false, reason: "already_running" });
    if (st.cooldown_seconds_left > 0) return send(res, 200, { ...st, started: false, reason: "cooldown" });
    const d = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: BRANCH }),
    });
    if (d.status !== 204) {
      let detail = (await d.text()).slice(0, 300);
      try { detail = JSON.parse(detail)?.message ?? detail; } catch { /* keep raw text */ }
      const hint = d.status === 403 || d.status === 404
        ? " The token needs repository permission Actions: Read and write for this repository."
        : "";
      return send(res, 502, { error: `GitHub refused the dispatch (${d.status})`, detail: `${detail}${hint}` });
    }
    return send(res, 202, { ...st, started: true, running: true });
  } catch (e) {
    return send(res, 502, { error: "GitHub unavailable", detail: (e as Error).message });
  }
}
