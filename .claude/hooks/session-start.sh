#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) environment
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --- Install Node.js dependencies ---
npm install

# --- Start PostgreSQL ---
pg_ctlcluster 16 main start 2>/dev/null || true

# --- Configure PostgreSQL: trust auth for local connections ---
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file;" 2>/dev/null | tr -d ' ')
if [ -n "$PG_HBA" ] && grep -q 'local.*all.*postgres.*peer' "$PG_HBA"; then
  sudo sed -i 's/^local\s\+all\s\+postgres\s\+peer$/local   all             postgres                                trust/' "$PG_HBA"
  sudo pg_ctlcluster 16 main reload
fi

# --- Create park_booking database if it doesn't exist ---
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'park_booking'" | grep -q 1 \
  || psql -U postgres -c "CREATE DATABASE park_booking"

# --- Export environment variables for the session ---
cat >> "$CLAUDE_ENV_FILE" <<'ENVEOF'
export PGUSER=postgres
export PGDATABASE=park_booking
export PGHOST=/var/run/postgresql
export RATE_LIMIT_MAX=5000
ENVEOF
