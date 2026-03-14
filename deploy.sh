#!/bin/bash
# PixelRelay v4 deploy script
set -e

echo "=== PixelRelay v4 Deploy ==="
cd "$(dirname "$0")"

# Backend
echo "[1/4] Installing backend dependencies..."
cd backend
npm install --omit=dev
cd ..

# Frontend
echo "[2/4] Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Copy frontend dist into backend-served path
echo "[3/4] Copying frontend build..."
cp -r frontend/dist backend/dist 2>/dev/null || true

# PM2
echo "[4/4] Starting with PM2..."
cd backend

if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi

pm2 stop pixelrelay 2>/dev/null || true
pm2 start server.js --name pixelrelay --no-autorestart 2>/dev/null || true
pm2 start server.js --name pixelrelay
pm2 save

echo ""
echo "=== Deploy complete ==="
echo "App running on port ${PORT:-3001}"
echo ""
echo "First time setup:"
echo "  1. Copy .env.example to .env and fill in your values"
echo "  2. If migrating from JSON files: node migrate-json-to-sqlite.js"
echo "  3. pm2 restart pixelrelay"
