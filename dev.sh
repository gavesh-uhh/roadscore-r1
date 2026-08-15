#!/usr/bin/env bash

# ==============================================================================
# RoadScore Dev Launcher
# ==============================================================================
# Usage:
#   ./dev.sh              # Starts Web (3000) & Engine (3001)
#   ./dev.sh --sim        # Starts Web, Engine, and Mixed Live Simulator
#   ./dev.sh --worst      # Starts Web, Engine, and Worst Driver Live Simulator
#   ./dev.sh --penalties  # Starts Web, Engine, and Clean Driver Penalties Simulator
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

node scripts/dev.js "$@"
