---
name: run-tests
description: Run the full test suite for the park booking system
user_invocable: true
---

# Run Tests

Run the project test suite. Follow these steps:

1. Ensure PostgreSQL is running:
   ```bash
   pg_ctlcluster 16 main start 2>/dev/null || true
   ```

2. Check if the server is already running on port 3000:
   ```bash
   curl -s http://localhost:3000/api/health || true
   ```

3. If the server is NOT running, start it in the background:
   ```bash
   PGUSER=postgres PGDATABASE=park_booking PGHOST=/var/run/postgresql RATE_LIMIT_MAX=5000 node server.js &
   sleep 2
   ```

4. Run all tests:
   ```bash
   node --test tests/api.test.js
   ```

5. Report the results clearly — how many passed, how many failed, and list any failures with details.
