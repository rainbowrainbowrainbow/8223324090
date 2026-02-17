# Plan: Feature #1 (Backup Missing Tables) + Feature #25 (Database Migrations)

---

## Feature #1: Add Missing Tables to Backup

### Current State

**BACKUP_TABLES array** (`services/backup.js`, line 12):
```js
const BACKUP_TABLES = [
  'bookings',
  'lines_by_date',
  'users',
  'history',
  'settings',
  'afisha',
  'pending_animators',
  'telegram_known_chats',
  'telegram_known_threads',
  'booking_counter'
];
```
Total: **10 tables** are backed up.

**ALL tables defined in `db/index.js` (via CREATE TABLE IF NOT EXISTS + ALTER):**

| # | Table | Has FK? | Introduced |
|---|-------|---------|------------|
| 1 | `bookings` | No | initial |
| 2 | `lines_by_date` | No | initial |
| 3 | `history` | No | initial |
| 4 | `settings` | No | initial |
| 5 | `pending_animators` | No | initial |
| 6 | `afisha` | No | initial |
| 7 | `afisha_templates` | No | v8.0 |
| 8 | `telegram_known_chats` | No | initial |
| 9 | `telegram_known_threads` | No | initial |
| 10 | `users` | No | initial |
| 11 | `booking_counter` | No | initial |
| 12 | `products` | No | v7.0 |
| 13 | `tasks` | No (afisha_id not FK) | v7.5 |
| 14 | `task_templates` | No | v7.8 |
| 15 | `scheduled_deletions` | No | v7.10 |
| 16 | `staff` | No | v7.10 |
| 17 | `staff_schedule` | **Yes** → `staff(id) ON DELETE CASCADE` | v7.10 |
| 18 | `automation_rules` | No | v8.3 |
| 19 | `certificates` | No | v8.4 |
| 20 | `certificate_counter` | No | v8.4 |

Total: **20 tables** exist in the database.

### Missing Tables

These **10 tables** are defined in `db/index.js` but **NOT** in `BACKUP_TABLES`:

| # | Missing Table | Risk if Lost | Notes |
|---|---------------|-------------|-------|
| 1 | `afisha_templates` | High | Recurring afisha templates, user-configured |
| 2 | `products` | High | Entire product catalog (40 items, can be re-seeded but loses customizations) |
| 3 | `tasks` | Medium | Active tasks, completed tasks history |
| 4 | `task_templates` | Medium | Recurring task templates |
| 5 | `scheduled_deletions` | Low | Transient: pending Telegram message deletions, ephemeral by nature |
| 6 | `staff` | High | 30 employees, phone numbers, telegram usernames |
| 7 | `staff_schedule` | Medium | Work schedules (can be large: 30 staff x N days) |
| 8 | `automation_rules` | High | Booking automation rules, user-configured |
| 9 | `certificates` | High | Issued gift certificates with codes, statuses |
| 10 | `certificate_counter` | Medium | Sequential counter for certificate code fallback |

### Implementation Plan

#### Decision: Include `scheduled_deletions`?

**No.** This table holds transient data (Telegram messages scheduled for deletion in the near future). By the time a backup is restored, these entries are stale. Excluding it keeps backup files smaller and avoids restoring irrelevant scheduled actions.

#### Decision: Include CREATE TABLE statements?

**No.** The current pattern relies on `initDatabase()` running on server start to create all tables via `CREATE TABLE IF NOT EXISTS`. The backup only needs `DELETE` + `INSERT` statements. This is consistent with the existing design, and the restore endpoint (`routes/backup.js`, line 45-48) explicitly blocks anything other than `INSERT` and `DELETE` statements.

#### Correct Backup/Restore Order (Respecting Foreign Keys)

The only FK dependency is:
- `staff_schedule.staff_id` → `staff(id) ON DELETE CASCADE`

This means:
- **Backup (DELETE) order:** `staff_schedule` must be deleted BEFORE `staff` (or use CASCADE, but explicit ordering is safer).
- **Restore (INSERT) order:** `staff` must be inserted BEFORE `staff_schedule`.

The current backup logic iterates `BACKUP_TABLES` in array order, issuing `DELETE FROM <table>` then `INSERT INTO <table>` for each table sequentially. This means the array order determines both delete and insert order for each table in sequence:

```
DELETE FROM table_1;
INSERT INTO table_1 (...) VALUES (...);
DELETE FROM table_2;
INSERT INTO table_2 (...) VALUES (...);
...
```

**Problem:** With this pattern, `staff` rows get deleted and re-inserted, then `staff_schedule` rows get deleted and re-inserted. The FK constraint could fail during the `DELETE FROM staff` step if `staff_schedule` still has rows referencing it (since `staff_schedule` hasn't been cleaned yet). However, since the FK has `ON DELETE CASCADE`, deleting staff will automatically cascade-delete `staff_schedule` rows. Then when we reach `staff_schedule` in the loop, the `DELETE` will find nothing, and the `INSERT` will proceed.

**Conclusion:** With CASCADE, the order below works correctly. But to be safe and explicit, we should:
1. Place `staff_schedule` **before** `staff` in the array so `DELETE FROM staff_schedule` runs first (clean, no cascade needed).
2. Place `staff` before `staff_schedule` for the **insert** phase — but since the current loop does DELETE+INSERT per table, we need a different approach.

**Best approach — change the backup generation to two-phase:**
1. Phase 1: DELETE all tables in **reverse** array order (children first).
2. Phase 2: INSERT all tables in **forward** array order (parents first).

This is cleaner and future-proof for any additional FK relationships.

#### Step-by-Step Changes to `services/backup.js`

**Step 1: Update `BACKUP_TABLES` array**

Replace the current array with the full list in correct parent-first order:

```js
const BACKUP_TABLES = [
  // === Independent tables (no FK dependencies) ===
  'users',
  'settings',
  'booking_counter',
  'certificate_counter',
  'bookings',
  'lines_by_date',
  'history',
  'pending_animators',
  'telegram_known_chats',
  'telegram_known_threads',
  'afisha',
  'afisha_templates',
  'products',
  'tasks',
  'task_templates',
  'automation_rules',
  'certificates',
  // === Parent tables (referenced by FK) ===
  'staff',
  // === Child tables (have FK to parent) ===
  'staff_schedule',
];
```

**Step 2: Refactor `generateBackupSQL()` to two-phase DELETE/INSERT**

Change the loop from per-table (delete+insert) to:
1. Emit all `DELETE FROM` statements in **reverse** order (children first: `staff_schedule` before `staff`).
2. Emit all `INSERT INTO` statements in **forward** order (parents first: `staff` before `staff_schedule`).

```js
async function generateBackupSQL() {
    const lines = [];
    lines.push(`-- Backup: Park Booking System`);
    lines.push(`-- Date: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${BACKUP_TABLES.join(', ')}\n`);

    // Fetch all data first
    const tableData = {};
    for (const table of BACKUP_TABLES) {
        try {
            const result = await pool.query(`SELECT * FROM ${table}`);
            tableData[table] = result.rows;
        } catch (err) {
            lines.push(`-- ERROR reading ${table}: ${err.message}`);
            tableData[table] = null;
        }
    }

    // Phase 1: DELETE in reverse order (children before parents)
    lines.push('-- === PHASE 1: DELETE (reverse FK order) ===');
    for (const table of [...BACKUP_TABLES].reverse()) {
        if (tableData[table] === null) continue;
        lines.push(`DELETE FROM ${table};`);
    }
    lines.push('');

    // Phase 2: INSERT in forward order (parents before children)
    lines.push('-- === PHASE 2: INSERT (forward FK order) ===');
    for (const table of BACKUP_TABLES) {
        const rows = tableData[table];
        if (!rows || rows.length === 0) continue;

        lines.push(`-- ${table}: ${rows.length} rows`);
        const columns = Object.keys(rows[0]);
        for (const row of rows) {
            const values = columns.map(col => {
                const val = row[col];
                if (val === null || val === undefined) return 'NULL';
                if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                if (val instanceof Date) return `'${val.toISOString()}'`;
                if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                return `'${String(val).replace(/'/g, "''")}'`;
            });
            lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
```

**Step 3: Consider backup file size**

`staff_schedule` can be large (30 staff x 21+ days = 630+ rows). This is acceptable for SQL dump format. No action needed, but worth monitoring.

**Step 4: Update tests**

Add a test to verify that `BACKUP_TABLES` includes all expected tables and that backup SQL is generated without errors.

---

## Feature #25: Database Migrations

### Current State

Schema is managed entirely in `db/index.js` → `initDatabase()`:
- `CREATE TABLE IF NOT EXISTS` for every table (20 tables).
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for incremental column additions.
- Inline comments mark which version introduced each change (e.g., `// v7.4:`, `// v8.0:`).
- `CREATE INDEX IF NOT EXISTS` for all indexes.
- Seed logic (users, products, staff, automation rules) runs conditionally (`SELECT COUNT(*) → if 0 → seed`).

**Problems with current approach:**
1. `initDatabase()` grows linearly with every schema change (~350 lines already).
2. No way to run destructive migrations (rename column, drop table, data transforms).
3. `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` hides errors — if a migration partially fails, it's undetectable.
4. No audit trail of which migrations have been applied.
5. Ordering of ALTERs relative to table creation is fragile.

### Migration System Design

#### Principles
- **Up-only migrations** — no rollback/down. Simpler, matches the project's complexity level. If a migration is wrong, write a new corrective migration.
- **Sequential numbering** — `001_initial_schema.sql`, `002_add_products.sql`, etc.
- **Plain SQL files** — no JS migration files. SQL is transparent and reviewable.
- **Simple runner** — read `migrations/` dir, compare with `schema_migrations` table, run pending in order.
- **Transaction per migration** — each migration runs in a single transaction. If it fails, that migration rolls back cleanly.
- **Idempotent initial migration** — the first migration (`001`) uses `CREATE TABLE IF NOT EXISTS` to be safe on existing databases.

#### Schema Migrations Tracking Table

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT NOW()
);
```

#### Directory Structure

```
migrations/
  001_initial_schema.sql        -- All 20 tables as they exist today
  002_example_future.sql        -- Template for future changes
```

#### Migration File Format

Each `.sql` file is plain SQL. Comments at the top describe the change:

```sql
-- Migration: 001_initial_schema
-- Description: Baseline schema with all 20 tables, indexes, and seed data
-- Date: 2025-XX-XX

CREATE TABLE IF NOT EXISTS bookings ( ... );
-- etc.
```

#### Migration Runner

A new module `db/migrate.js` with a single exported function:

```js
async function runMigrations(pool) {
    // 1. Ensure schema_migrations table exists
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 2. Read migrations/ directory, sorted alphabetically
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    // 3. Get already-applied versions
    const applied = await pool.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map(r => r.version));

    // 4. Run pending migrations in order
    for (const file of files) {
        const version = file.replace('.sql', '');
        if (appliedSet.has(version)) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query(
                'INSERT INTO schema_migrations (version) VALUES ($1)',
                [version]
            );
            await client.query('COMMIT');
            log.info(`Migration applied: ${version}`);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            log.error(`Migration failed: ${version}`, err);
            throw err; // Stop server startup on failed migration
        } finally {
            client.release();
        }
    }
}
```

### Implementation Steps

#### Step 1: Create `migrations/` directory

Create the directory at project root.

#### Step 2: Create `migrations/001_initial_schema.sql`

This is the **baseline migration** that captures the current state of all 20 tables. It must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so it can safely run on an existing production database.

Contents: extract all `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX` statements from `db/index.js`, in the same order. Do **NOT** include seed data — seeding remains in `db/index.js` since it's conditional logic (`if count === 0`).

#### Step 3: Create `db/migrate.js`

New file with:
- `runMigrations(pool)` function as described above.
- Reads from `migrations/` directory.
- Tracks applied versions in `schema_migrations` table.
- Exported for use in `db/index.js`.

#### Step 4: Modify `db/index.js`

**Option A (recommended for transition):** Keep `initDatabase()` as-is for now, but add `runMigrations()` call at the end. The initial migration (001) is idempotent, so running both is safe. Future schema changes go ONLY into new migration files, not into `initDatabase()`.

**Option B (clean break):** Replace the schema portion of `initDatabase()` with a single call to `runMigrations()`. Keep only the seed logic in `initDatabase()`. This is cleaner but riskier for existing deployments.

**Recommendation:** Option A for the initial release. After confirming stability, refactor to Option B in a later version.

Changes to `db/index.js`:
```js
const { runMigrations } = require('./migrate');

async function initDatabase() {
    try {
        // Run pending migrations first
        await runMigrations(pool);

        // Existing CREATE TABLE / ALTER TABLE statements remain (idempotent)
        // ... (unchanged) ...

        // Seed logic remains (conditional)
        // ... (unchanged) ...

        log.info('Database initialized');
    } catch (err) {
        log.error('Database init error', err);
        throw err;
    }
}
```

#### Step 5: Create `migrations/002_add_schema_migrations.sql` (meta-migration)

Not needed — the `runMigrations()` function creates `schema_migrations` itself before reading migration files.

#### Step 6: Update `BACKUP_TABLES` to include `schema_migrations`

Add `'schema_migrations'` to the backup array so the migration state is preserved in backups. This allows restoring to a known migration state.

#### Step 7: Add `schema_migrations` to `.gitignore`?

**No.** The `schema_migrations` table is database-only, not a file. The `migrations/` directory with `.sql` files SHOULD be committed to git.

#### Step 8: Document migration workflow

Add to `PROJECT_PASSPORT.md`:
```
## Creating a New Migration
1. Create `migrations/NNN_description.sql` (next number)
2. Write plain SQL (no IF NOT EXISTS for new changes — let errors surface)
3. Test locally: restart server, check logs
4. The migration runs automatically on next server start
```

### File Summary

| File | Action | Description |
|------|--------|-------------|
| `migrations/` | **Create dir** | New directory for SQL migration files |
| `migrations/001_initial_schema.sql` | **Create** | Baseline: all 20 tables, indexes (idempotent) |
| `db/migrate.js` | **Create** | Migration runner module (~50 lines) |
| `db/index.js` | **Modify** | Add `runMigrations()` call at start of `initDatabase()` |
| `services/backup.js` | **Modify** | Update BACKUP_TABLES, refactor to two-phase DELETE/INSERT |

---

## Cross-Dependencies

### How #1 and #25 Interact

1. **Feature #25 creates a new table** (`schema_migrations`) that Feature #1 should include in backups. The `schema_migrations` table should be added to `BACKUP_TABLES` so that a restored database knows which migrations have been applied.

2. **Feature #1 changes `services/backup.js`**, which Feature #25 does not touch. No file conflicts.

3. **Feature #25 changes `db/index.js`**, which Feature #1 does not touch. No file conflicts.

4. **Backup restore + migrations interaction:** If a backup is restored from an older state, `schema_migrations` will reflect that older state. On next server restart, `runMigrations()` will detect any new migrations not in the restored `schema_migrations` and apply them. This is the correct behavior — the database catches up automatically.

### Implementation Order

**Implement Feature #1 first, then Feature #25.**

Rationale:
1. Feature #1 is smaller, self-contained, and immediately valuable (data protection).
2. Feature #25 is structural and will benefit from Feature #1 being done (the migration system's own table gets backed up).
3. After #25 is done, add `'schema_migrations'` to `BACKUP_TABLES` as part of #25's changes to `services/backup.js`.

### Sequence of Commits

```
1. feat: add missing tables to backup (Feature #1)
   - services/backup.js: update BACKUP_TABLES, refactor generateBackupSQL()
   - tests: verify all tables are backed up

2. feat: add database migration system (Feature #25)
   - db/migrate.js: new migration runner
   - migrations/001_initial_schema.sql: baseline migration
   - db/index.js: integrate runMigrations()
   - services/backup.js: add schema_migrations to BACKUP_TABLES
```

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Backup file size increase (staff_schedule) | Low | Monitor; ~630 rows adds ~50KB |
| Migration fails on prod, blocks startup | High | Wrap in try/catch, log clearly, fail fast |
| Restoring old backup skips new migrations | Low | runMigrations() auto-applies on next start |
| Two-phase DELETE breaks existing restore flow | Medium | Restore endpoint already allows DELETE+INSERT; test thoroughly |
| 001 migration conflicts with initDatabase() | Low | Both are idempotent (IF NOT EXISTS); safe to run together |
