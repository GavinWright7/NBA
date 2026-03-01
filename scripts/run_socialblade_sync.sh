#!/bin/bash
# run_socialblade_sync.sh
# Shell wrapper called by launchd / cron to run the daily SocialBlade sync.
# Activate a venv if needed, then run the Python sync script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting SocialBlade sync..."

# Use system python3 (or set PYTHON3 env var to override, e.g. a venv python)
PYTHON="${PYTHON3:-python3}"

cd "$PROJECT_ROOT"
"$PYTHON" "$SCRIPT_DIR/sync_socialblade_to_db.py"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SocialBlade sync complete."
