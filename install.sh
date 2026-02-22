#!/usr/bin/env bash
# One-time installation script
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "Installing FinSight dependencies…"

# Backend
python3 -m venv "$BACKEND_DIR/venv"
source "$BACKEND_DIR/venv/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"
echo "✓ Backend dependencies installed"

# Frontend
cd "$FRONTEND_DIR"
npm install --legacy-peer-deps
echo "✓ Frontend dependencies installed"

echo ""
echo "Installation complete! Run ./start.sh to launch FinSight."
