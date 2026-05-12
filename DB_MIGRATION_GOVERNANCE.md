# Event Genix DB Migration Governance

This file defines the current database ownership model and the rules for future
schema and data changes. It is intentionally conservative: the repository has
legacy split-brain between startup bootstrap code and SQL migrations, so the
near-term goal is to stop drift before attempting a larger cleanup.

## Current Split-Brain Findings

Runtime startup currently runs:

```text
initDatabase() -> runMigrations(pool) -> initDatabase()
```

Current responsibilities are split:

- `db/index.js` creates many legacy base tables, indexes, triggers, and columns with `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`.
- `db/index.js` also still contains runtime bootstrap/seed behavior: first-user bootstrap, products, staff/demo schedule, automation rules, finance categories, contractor seed markers, and OpenClaw seed markers.
- `db/migrations/*.sql` is the durable migration history used by `db/migrate.js`.
- `db/migrate.js` applies files alphabetically and stores the filename without `.sql` in `schema_migrations`.

Known legacy migration-history issues:

- Duplicate number: `026_fix_cancel_rule_template.sql` and `026_leads_banquet_staff.sql`.
- Known gaps: `055-059`, `069-070`, `084-085`.
- Several legacy migrations are data-specific or destructive, especially staff/schedule cleanup around migrations `132-148`.

These legacy issues are documented baseline, not a pattern to repeat.

## Ownership Rules Going Forward

New durable schema changes belong in `db/migrations/`.

`initDatabase()` should only keep:

- connection pool ownership;
- `schema_migrations` bootstrap needed before migrations run;
- minimal backwards-compatible bootstrap needed for old environments that cannot start without it;
- explicit first-user bootstrap guarded by env;
- temporary compatibility shims while legacy schema creation is being migrated out.

Do not add new product tables, new columns, new indexes, or one-off data fixes to
`initDatabase()` unless the task explicitly documents why migration ownership is
impossible.

## Migration Types

Use one of these labels for every new migration from `162_*.sql` onward:

- `schema` - DDL only: tables, columns, constraints, indexes, functions, triggers.
- `seed` - deterministic reference data that is safe to re-run and not user/private data.
- `data-fix` - scoped UPDATE/INSERT for existing production data.
- `cleanup` - DELETE, deactivate, archive, or removal behavior.
- `mixed` - both schema and data changes. Prefer splitting unless the data backfill is inseparable from the schema.

## Required Header For New Migrations

Every migration numbered `162_*.sql` or higher must include:

```sql
-- MIGRATION_KIND: schema|seed|data-fix|cleanup|mixed
-- SAFETY: short explanation of idempotency and production safety
-- ROLLBACK: short rollback or operator recovery note
```

If the migration is destructive or removes/deactivates records, also include:

```sql
-- OPERATOR_APPROVAL: required
```

If the migration is date-scoped, staff-specific, environment-specific, or based
on a one-time operational assumption, also include:

```sql
-- DATA_SCOPE: exact rows/date range/business assumption
```

## Data-Fix And Cleanup Rules

- Prefer soft deactivation/archive over DELETE when product history matters.
- Scope UPDATE/DELETE by stable business keys and include comments explaining the source of truth.
- Do not use `CURRENT_DATE` in durable migrations unless the task is explicitly a time-relative operational migration and `DATA_SCOPE` explains the risk.
- Do not seed shared/default user passwords. Use user-management or explicit operator bootstrap.
- Do not change production credentials, staff identities, schedules, payroll, finance, or customer data without explicit operator approval.
- If a data fix can fail safely, make it idempotent and auditable.

## Automated Check

Run:

```bash
npm run check:migrations
npm run check:db-startup-surface
```

The migration check is static and does not connect to PostgreSQL. It verifies:

- filenames use `NNN_lowercase_slug.sql`;
- new duplicate migration numbers are blocked;
- new undocumented gaps are blocked;
- future migrations from `162_*.sql` onward include governance headers;
- destructive/date-scoped future migrations include the extra approval/scope metadata.

The DB startup surface check verifies that the legacy `initDatabase()` schema
surface and startup data hooks stay documented in `docs/DB_STARTUP_SURFACE.md`
while durable schema changes move to SQL migrations.

`npm test` includes this check through `npm run verify`.

Use verbose mode when auditing legacy risk:

```bash
node scripts/check-migrations.js --verbose
```

## Safe Transition Strategy

1. Keep the current two-phase startup flow for now; changing it directly is too risky.
2. Add all new schema changes as SQL migrations only.
3. For each future DB cleanup task, move one small `initDatabase()` table/seed responsibility into an explicit migration, verify startup on an empty local DB, then remove only that migrated startup block.
4. Add focused tests around migration parsing/governance and any route/service that depends on migrated schema.
5. Only after `initDatabase()` is reduced to pool/bootstrap/shims should the startup flow become `runMigrations(pool)` first.
