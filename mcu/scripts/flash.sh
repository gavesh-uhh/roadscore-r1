#!/usr/bin/env bash
# ==============================================================================
# RoadScore MCU - Build, Flash & Monitor Script for ESP32
# ==============================================================================

set -e

# ANSI Color Codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default Configuration
DEFAULT_FQBN="esp32:esp32:esp32"
DEFAULT_BAUD="115200"
SKETCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Variables
PORT=""
FQBN="${FQBN:-$DEFAULT_FQBN}"
BAUD="$DEFAULT_BAUD"
COMPILE_ONLY=false
FLASH_ONLY=false
MONITOR_AFTER_FLASH=false
CLEAN_BUILD=false

# ------------------------------------------------------------------------------
# Helper Functions
# ------------------------------------------------------------------------------

log_info() {
    echo -e "${CYAN}${BOLD}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}${BOLD}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}${BOLD}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
RoadScore MCU ESP32 Flashing Script

Usage:
  ./flash.sh [options]

Options:
  -p, --port <PORT>      Specify serial port (e.g., /dev/ttyUSB0, /dev/ttyACM0).
  -b, --board <FQBN>     Specify board FQBN (Default: esp32:esp32:esp32).
  -m, --monitor          Open serial monitor after flashing.
  --baud <BAUD>          Set serial monitor baud rate (Default: 115200).
  --compile-only         Compile the sketch without flashing.
  --flash-only           Flash existing binary without recompiling.
  --clean                Clean build artifacts before compiling.
  -h, --help             Show this help message.

Examples:
  ./flash.sh                             # Auto-detect port, compile and flash
  ./flash.sh -p /dev/ttyUSB0 --monitor  # Compile, flash to ttyUSB0, and monitor
  ./flash.sh --compile-only              # Build check only
EOF
}

# ------------------------------------------------------------------------------
# Parse Arguments
# ------------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -b|--board)
            FQBN="$2"
            shift 2
            ;;
        -m|--monitor)
            MONITOR_AFTER_FLASH=true
            shift
            ;;
        --baud)
            BAUD="$2"
            shift 2
            ;;
        --compile-only)
            COMPILE_ONLY=true
            shift
            ;;
        --flash-only)
            FLASH_ONLY=true
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# ------------------------------------------------------------------------------
# Locate arduino-cli
# ------------------------------------------------------------------------------

find_arduino_cli() {
    if [[ -n "$ARDUINO_CLI" ]] && command -v "$ARDUINO_CLI" &>/dev/null; then
        echo "$ARDUINO_CLI"
        return 0
    fi

    local candidates=(
        "arduino-cli"
        "$HOME/bin/arduino-cli"
        "/usr/local/bin/arduino-cli"
        "/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli"
        "$HOME/.local/bin/arduino-cli"
    )

    for cmd in "${candidates[@]}"; do
        if command -v "$cmd" &>/dev/null; then
            echo "$cmd"
            return 0
        fi
    done

    return 1
}

CLI_CMD=$(find_arduino_cli) || {
    log_error "arduino-cli was not found on your system."
    log_info "Please install arduino-cli or add it to PATH."
    exit 1
}

log_info "Using Arduino CLI: $CLI_CMD ($("$CLI_CMD" version | head -n 1))"

# ------------------------------------------------------------------------------
# Check Secrets File
# ------------------------------------------------------------------------------

if [[ ! -f "$SKETCH_DIR/secrets.h" ]]; then
    if [[ -f "$SKETCH_DIR/secrets.h.example" ]]; then
        log_warn "secrets.h not found! Creating secrets.h from secrets.h.example..."
        cp "$SKETCH_DIR/secrets.h.example" "$SKETCH_DIR/secrets.h"
        log_info "Created secrets.h. Please verify WiFi and Supabase credentials in secrets.h."
    else
        log_error "Neither secrets.h nor secrets.h.example was found!"
        exit 1
    fi
fi

# ------------------------------------------------------------------------------
# Auto-detect Serial Port (if not provided)
# ------------------------------------------------------------------------------

detect_serial_port() {
    if [[ -n "$PORT" ]]; then
        return 0
    fi

    log_info "Searching for connected ESP32 serial ports..."
    local ports=()

    for p in /dev/ttyUSB* /dev/ttyACM*; do
        if [[ -e "$p" ]]; then
            ports+=("$p")
        fi
    done

    if [[ ${#ports[@]} -eq 0 ]]; then
        log_error "No serial ports found (/dev/ttyUSB* or /dev/ttyACM*)."
        log_info "Please plug in your ESP32 board and check permissions (e.g., sudo usermod -a -G dialout $USER)."
        return 1
    elif [[ ${#ports[@]} -eq 1 ]]; then
        PORT="${ports[0]}"
        log_info "Auto-detected serial port: ${BOLD}$PORT${NC}"
    else
        log_warn "Multiple serial ports found: ${ports[*]}"
        PORT="${ports[0]}"
        log_info "Selected first available port: ${BOLD}$PORT${NC} (Use -p <port> to select a specific port)"
    fi
}

# ------------------------------------------------------------------------------
# Compilation Stage
# ------------------------------------------------------------------------------

if [[ "$FLASH_ONLY" == false ]]; then
    log_info "Compiling sketch for board ${BOLD}$FQBN${NC}..."

    BUILD_ARGS=("--fqbn" "$FQBN")
    if [[ "$CLEAN_BUILD" == true ]]; then
        BUILD_ARGS+=("--clean")
    fi

    if "$CLI_CMD" compile "${BUILD_ARGS[@]}" "$SKETCH_DIR"; then
        log_success "Compilation completed successfully!"
    else
        log_error "Compilation failed."
        exit 1
    fi
fi

if [[ "$COMPILE_ONLY" == true ]]; then
    log_success "Compile-only flag set. Skipping flash stage."
    exit 0
fi

# ------------------------------------------------------------------------------
# Flashing Stage
# ------------------------------------------------------------------------------

detect_serial_port || exit 1

log_info "Flashing firmware to ESP32 on port ${BOLD}$PORT${NC}..."

if "$CLI_CMD" upload --fqbn "$FQBN" -p "$PORT" "$SKETCH_DIR"; then
    log_success "Successfully flashed ESP32 on port $PORT!"
else
    log_error "Flashing failed on port $PORT."
    log_info "Tips: Ensure the device is connected, check read/write permissions on $PORT, or hold the BOOT button when flashing starts."
    exit 1
fi

# ------------------------------------------------------------------------------
# Serial Monitor Stage
# ------------------------------------------------------------------------------

if [[ "$MONITOR_AFTER_FLASH" == true ]]; then
    log_info "Starting Serial Monitor on $PORT at $BAUD baud (Press Ctrl+C to exit)..."
    "$CLI_CMD" monitor -p "$PORT" -c "baudrate=$BAUD"
fi

exit 0
