#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "=== Park Booking System: Session Start Hook ==="

# 1. Start PostgreSQL 16 if not already running
if ! pg_isready -q 2>/dev/null; then
  echo "[hook] Starting PostgreSQL 16..."
  pg_ctlcluster 16 main start 2>/dev/null || true
  # Wait for PG to be ready
  for i in $(seq 1 10); do
    if pg_isready -q 2>/dev/null; then
      echo "[hook] PostgreSQL is ready"
      break
    fi
    sleep 1
  done
else
  echo "[hook] PostgreSQL already running"
fi

# 2. Install Node.js dependencies
echo "[hook] Installing npm dependencies..."
cd "$CLAUDE_PROJECT_DIR"
npm install 2>&1 | tail -3

# 3. Export environment variables for the session
echo "[hook] Setting environment variables..."
cat >> "$CLAUDE_ENV_FILE" << 'ENVEOF'
export PGUSER=postgres
export PGDATABASE=park_booking
export PGHOST=/var/run/postgresql
export RATE_LIMIT_MAX=5000
export LOGIN_RATE_LIMIT_MAX=1000
export JWT_SECRET=testsecret
ENVEOF

echo "=== Session Start Hook complete ==="
