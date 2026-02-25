---
name: db-status
description: Check PostgreSQL database status, tables, and row counts
user_invocable: true
---

# Database Status

Check the current state of the park_booking PostgreSQL database.

1. Verify PostgreSQL is running:
   ```bash
   pg_isready
   ```

2. List all tables with row counts:
   ```bash
   psql -U postgres -d park_booking -c "
     SELECT schemaname, tablename,
            (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count
     FROM (
       SELECT schemaname, tablename,
              query_to_xml('SELECT count(*) as cnt FROM ' || schemaname || '.' || tablename, false, true, '') as xml_count
       FROM pg_tables
       WHERE schemaname = 'public'
     ) t
     ORDER BY tablename;
   "
   ```

3. Show database size:
   ```bash
   psql -U postgres -d park_booking -c "SELECT pg_size_pretty(pg_database_size('park_booking'));"
   ```

4. Report the results in a clean table format.
