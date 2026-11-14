#!/usr/bin/env bash
# Local development: build (a subset of) the static data set, then run the UI.
#
#   ./start.sh            # 15 assets per market (~1 min), then Vite on :3000
#   LIMIT=0 ./start.sh    # every asset (~10 min)
#
# Live prices/news come from the Vercel functions in frontend/api. Locally they
# are proxied to the deployed site (see VITE_API_PROXY_TARGET in vite.config.ts)
# or run them with `npx vercel dev` inside frontend/.
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIMIT="${LIMIT:-15}"
source "$PROJECT_DIR/backend/venv/bin/activate"
echo "[1/2] Building data for $([ "$LIMIT" = "0" ] && echo all || echo "$LIMIT per market") assets → frontend/public/data"
python "$PROJECT_DIR/backend/scripts/build_static.py" --out "$PROJECT_DIR/frontend/public/data" --limit "$LIMIT"
echo "[2/2] Starting the UI on http://localhost:3000"
cd "$PROJECT_DIR/frontend" && npm run dev
