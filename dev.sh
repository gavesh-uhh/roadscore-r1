#!/usr/bin/env bash

# ==============================================================================
# RoadScore Dev Launcher
# ==============================================================================
# Usage:
#   ./dev.sh              # Starts Web & Engine (interactively prompts for DEMO_MODE)
#   ./dev.sh --demo       # Starts Web & Engine with DEMO_MODE enabled
#   ./dev.sh --no-demo    # Starts Web & Engine in standard on-road mode
#   ./dev.sh --sim        # Starts Web, Engine, and Mixed Live Simulator
#   ./dev.sh --worst      # Starts Web, Engine, and Worst Driver Live Simulator
#   ./dev.sh --penalties  # Starts Web, Engine, and Clean Driver Penalties Simulator
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

node scripts/dev.js "$@"
