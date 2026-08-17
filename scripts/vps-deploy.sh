#!/usr/bin/env bash
set -e

echo "=== [1/5] Checking Prerequisites ==="
if ! command -v node &> /dev/null; then
  echo "Error: Node.js (>= 22) is not installed."
  exit 1
fi

if ! command -v pm2 &> /dev/null; then
  echo "PM2 not found. Installing PM2 globally..."
  npm install -g pm2
fi

echo "=== [2/5] Checking Environment Files ==="
if [ ! -f "engine/.env" ]; then
  echo "WARNING: engine/.env not found! Creating template from engine/.env.example..."
  if [ -f "engine/.env.example" ]; then
    cp engine/.env.example engine/.env
  fi
fi

if [ ! -f "web/.env.local" ] && [ ! -f "web/.env" ]; then
  echo "WARNING: web/.env.local or web/.env not found! Ensure Supabase and Next.js env vars are set."
fi

echo "=== [3/5] Installing Dependencies across Workspaces ==="
npm install

echo "=== [4/5] Building Engine & Web ==="
echo "Building Engine..."
npm run build --workspace=engine

echo "Building Next.js Web..."
npm run build --workspace=web

echo "=== [5/5] Starting / Reloading Services via PM2 ==="
if pm2 describe roadscore-engine &> /dev/null; then
  echo "Reloading existing PM2 processes..."
  pm2 reload ecosystem.config.cjs --update-env
else
  echo "Starting PM2 processes..."
  pm2 start ecosystem.config.cjs
fi

pm2 save
echo ""
echo "=== Deployment Succeeded! ==="
pm2 status
