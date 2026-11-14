#!/usr/bin/env bash
# One-time local setup: Python deps for the data build + Node deps for the UI.
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Installing FinSight dependencies…"
python3 -m venv "$PROJECT_DIR/backend/venv"
source "$PROJECT_DIR/backend/venv/bin/activate"
pip install --upgrade pip
pip install -r "$PROJECT_DIR/backend/requirements.txt"
echo "✓ Python dependencies installed"
cd "$PROJECT_DIR/frontend" && npm install
echo "✓ Node dependencies installed"
echo ""
echo "Done. Run ./start.sh to build a local data set and start the UI."
