#!/usr/bin/env bash
set -e

# ==============================================================================
# RoadScore — Engine VPS PM2 Runner
# Starts or restarts the Fastify Ingestion & Scoring Engine under PM2 supervision.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================="
echo " 🚀 RoadScore Engine — VPS Production PM2 Launcher"
echo "======================================================="

# 1. Create logs directory
mkdir -p logs

# 2. Build the engine bundle
echo "📦 Building RoadScore Engine (tsup ESM)..."
npm run build --workspace=engine

# 3. Check for PM2 availability
PM2_CMD="pm2"
if ! command -v pm2 &> /dev/null; then
  echo "⚠️  pm2 not found in PATH, falling back to npx pm2..."
  PM2_CMD="npx pm2"
fi

# 4. Start or restart roadscore-engine in PM2
echo "⚡ Starting 'roadscore-engine' instance under PM2..."
$PM2_CMD startOrRestart ecosystem.config.cjs --only roadscore-engine

# 5. Save PM2 process list for auto-boot on VPS restart
if command -v pm2 &> /dev/null; then
  pm2 save || true
fi

echo ""
echo "======================================================="
echo " ✅ RoadScore Engine is running under PM2!"
echo " -----------------------------------------------------"
echo " • Status:       $PM2_CMD status roadscore-engine"
echo " • Live Logs:    $PM2_CMD logs roadscore-engine"
echo " • Monitor:      $PM2_CMD monit"
echo " • Stop:         $PM2_CMD stop roadscore-engine"
echo " • Restart:      $PM2_CMD restart roadscore-engine"
echo "======================================================="
$PM2_CMD status roadscore-engine
