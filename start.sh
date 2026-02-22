#!/usr/bin/env bash
# FinSight — Start backend + frontend
set -e

# Ensure node/npm are in PATH (macOS Homebrew location)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     FinSight — Market Analyzer       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"

# ── Python venv ─────────────────────────────────────────────
echo -e "\n${YELLOW}[1/4] Setting up Python environment…${NC}"
if [ ! -d "$BACKEND_DIR/venv" ]; then
  python3 -m venv "$BACKEND_DIR/venv"
fi
source "$BACKEND_DIR/venv/bin/activate"
pip install -q --upgrade pip
pip install -q -r "$BACKEND_DIR/requirements.txt"
echo -e "${GREEN}✓ Python dependencies installed${NC}"

# ── Node modules ─────────────────────────────────────────────
echo -e "\n${YELLOW}[2/4] Installing Node.js dependencies…${NC}"
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  npm install --legacy-peer-deps
fi
echo -e "${GREEN}✓ Node dependencies installed${NC}"

# ── Start backend ─────────────────────────────────────────────
echo -e "\n${YELLOW}[3/4] Starting FastAPI backend on http://localhost:9000${NC}"
cd "$BACKEND_DIR"
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 9000 --reload &
BACKEND_PID=$!
sleep 3
echo -e "${GREEN}✓ Backend running (PID $BACKEND_PID)${NC}"

# ── Start frontend ────────────────────────────────────────────
echo -e "\n${YELLOW}[4/4] Starting React frontend on http://localhost:3000${NC}"
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

echo -e "\n${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  FinSight is running!                        ║${NC}"
echo -e "${GREEN}║  Frontend: http://localhost:3000             ║${NC}"
echo -e "${GREEN}║  Backend:  http://localhost:9000             ║${NC}"
echo -e "${GREEN}║  API Docs: http://localhost:9000/docs        ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop both servers           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}\n"

# Wait and handle cleanup
trap "echo -e '\n${YELLOW}Stopping…${NC}'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait $FRONTEND_PID
