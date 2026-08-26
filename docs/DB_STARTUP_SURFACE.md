# Event Genix DB Startup Surface Map

This document records the legacy database responsibilities that still run from
`db/index.js` and `server.js` startup. The machine-readable source is
`config/dbStartupSurface.js`; `npm run check:db-startup-surface` runs
`scripts/check-db-startup-surface.js`.

## Why This Exists

The current startup flow is still split:

```text
initDatabase() -> runMigrations(pool) -> initDatabase()
```

`server.js` holds the exclusive Event Genix schema-maintenance advisory lock
around this complete flow. Backup export and structured restore use the
matching shared transaction lock.

`DB_MIGRATION_GOVERNANCE.md` remains the authority for migration rules.
`db/migrations/` is the durable schema history. `db/index.js` now keeps only
the minimum compatibility schema needed before old migrations and startup
data hooks can run.

The rule going forward: do not add product tables, columns, indexes, triggers,
or one-off data fixes to `db/index.js`. Add durable schema work to
`db/migrations/`, with the required migration headers, and run `npm run
check:migrations`.

## Current Startup Schema Tables

`initDatabase()` currently creates these compatibility tables:

Current count: 14 tables.

`automation_rules`, `bookings`, `certificates`, `contractors`, `customers`,
`finance_categories`, `finance_transactions`, `products`, `schema_migrations`,
`settings`, `staff`, `staff_schedule`, `tasks`, `users`.

`schema_migrations` is intentionally present in both `db/index.js` and
`db/migrate.js` while the two-phase startup flow remains.

## Current Startup Compatibility Columns

`initDatabase()` currently keeps these `ADD COLUMN IF NOT EXISTS` shims:

Current count: 7 columns.

`bookings.payment_method`, `certificates.customer_id`,
`staff.telegram_username`, `tasks.deadline`, `tasks.dependency_ids`,
`tasks.source_id`, `tasks.source_type`.

These columns remain only because historical migrations read them before the
new Task 22 ownership migration can run:

- `bookings.payment_method`: `071_sales_funnel.sql` creates
  `idx_bookings_payment`.
- `certificates.customer_id`: `018_backend_hardening.sql` creates
  `idx_certificates_customer_id`.
- `tasks.source_type` and `tasks.source_id`: migrations `171`, `185`, `203`,
  and `237` create indexes or data-fix queries that read them.
- `tasks.deadline`: migration `243` uses it in workload indexes.
- `tasks.dependency_ids`: migration `313` reads it for the canonical task
  dependency backfill.
- `staff.telegram_username`: `seedStaff()` inserts it during the first
  startup pass before migrations.

## Current Startup Indexes, Functions And Triggers

No startup indexes remain. No startup functions or triggers remain.

The old startup trigger/function pair `update_updated_at_column` and
`trg_bookings_updated_at` is owned by `002_add_updated_at.sql` and no longer
belongs in `initDatabase()`.

Do not add a new startup index as a convenience shortcut. New durable indexes
belong in SQL migrations.

## Task 22 Ownership Matrix

Before Task 22, the post-wave-1 startup surface still contained 39 tables,
50 columns, 82 indexes, 1 function, and 1 trigger. The full machine-readable
matrix for those objects is `DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX` in
`config/dbStartupSurface.js`.

Each object has one of these verdicts:

- `REMOVE_DUPLICATE`: removed from startup because an existing durable
  migration fully owns it.
- `KEEP_PRE_MIGRATION_DEPENDENCY`: kept in startup because an old migration or
  first-pass startup hook needs it before later migrations can run.
- `ADD_ADDITIVE_OWNERSHIP_MIGRATION`: removed from startup and now owned by
  the additive/idempotent migration `340_db_startup_schema_ownership.sql`.
- `BLOCKED_WITH_EVIDENCE`: reserved for future waves; Task 22 leaves no object
  in this state.

`340_db_startup_schema_ownership.sql` owns the remaining legacy objects that
previously had no durable migration owner and no pre-migration dependency:

- tables: `contractor_notifications`, `design_tags`, `kleshnya_messages`,
  `point_transactions`, `task_logs`, `user_action_log`, `user_points`,
  `user_streaks`;
- task/user/booking/certificate columns: `bookings.skip_notification`,
  `certificates.value_uah`, `tasks.control_policy`,
  `tasks.escalation_level`, `tasks.last_reminded_at`, `tasks.owner`,
  `tasks.task_type`, `tasks.time_window_end`, `tasks.time_window_start`,
  `users.telegram_chat_id`, `users.telegram_username`;
- indexes: `idx_contractor_notif_contractor`,
  `idx_contractor_notif_status`, `idx_contractors_active`,
  `idx_contractors_invite`, `idx_customers_child_name`,
  `idx_design_tags_tag`, `idx_designs_collection`, `idx_designs_pinned`,
  `idx_designs_publish_date`, `idx_finance_categories_type`,
  `idx_finance_transactions_type`, `idx_kleshnya_messages_expires`,
  `idx_kleshnya_messages_scope`, `idx_point_transactions_username`,
  `idx_task_logs_created_at`, `idx_task_logs_task_id`,
  `idx_tasks_deadline`, `idx_tasks_escalation`, `idx_tasks_owner`,
  `idx_tasks_task_type`, `idx_user_action_log_created_at`,
  `idx_user_action_log_username`, `idx_user_points_username`.

Retained `KEEP_PRE_MIGRATION_DEPENDENCY` objects are not a template for new
startup schema. They are compatibility bootstraps for the historical migration
order. Removing them requires either a separately approved migration-order
strategy or a proven historical dependency cleanup.

## Wave 1 Ownership Removed From Startup

On 2026-08-26, the first startup-surface reduction removed only compatibility
SQL whose complete durable schema already exists in migrations:

- `244_user_action_permission_overrides.sql` owns `users.action_allowlist`,
  `users.action_denylist`, `idx_users_action_allowlist_gin`, and
  `idx_users_action_denylist_gin`.
- `265_banquet_groups.sql` owns `banquet_groups`,
  `banquet_group_bookings`, `idx_banquet_groups_business_date`,
  `idx_banquet_groups_primary_booking`, `idx_banquet_group_bookings_group`,
  and `idx_banquet_group_bookings_booking`.
- `266_profile_avatar_postgres_storage.sql` owns
  `profile_avatar_blobs`, `idx_profile_avatar_blobs_username`, and
  `idx_profile_avatar_blobs_created_at_desc`.

These objects must not be re-added to `initDatabase()` as startup compatibility
shims. The first `initDatabase()` pass does not read these objects before
`runMigrations(pool)`, and the migration runner applies them before Express
starts serving authenticated routes.

## Startup Data Hooks

| Hook | Source | Owner | Mode | Notes |
| --- | --- | --- | --- | --- |
| `firstUserBootstrap` | `db/index.js` | auth | env-gated | Uses `BOOTSTRAP_CREATOR_*` or local-only `ALLOW_DEV_USER_SEED`. |
| `legacyUserResetMarker` | `db/index.js` | auth | mark-only | Marks `007_upsert_users_v12_5`; hardcoded reset remains disabled. |
| `legacyAnnaArtemMarker` | `db/index.js` | auth | mark-only | Marks `008_add_anna_artem`; legacy shared users remain disabled. |
| `productsSeed` | `db/index.js` | products | seed-if-empty | Seeds the legacy product catalog only if `products` is empty. |
| `staffAndScheduleSeed` | `db/index.js` | staff | seed-if-empty | Seeds demo staff and rolling schedule only if `staff` is empty. |
| `automationRulesSeed` | `db/index.js` | automation | seed-if-empty | Seeds three default automation rules only if empty. |
| `contractorZhenyaSeed` | `db/index.js` | contractors | legacy-seed-marker | Legacy contractor seed marker `008_seed_contractor_zhenya`. |
| `openclawUserBootstrap` | `db/index.js` | openclaw | env-gated-marker | Requires `OPENCLAW_BOOTSTRAP_PASSWORD`; marks `009_seed_user_openclaw`. |
| `financeCategoriesSeed` | `db/index.js` | finance | seed-if-empty | Seeds finance categories only if empty. |
| `greetingCacheStartupDelete` | `server.js` | kleshnya | startup-data-delete | Clears daily greeting cache on startup. |

These hooks are not a template for new data changes. New seed/data-fix/cleanup
work belongs in migrations with the governance metadata from
`DB_MIGRATION_GOVERNANCE.md`.

## Done Marker

This surface is considered controlled when all of these remain true:

- `npm run check:db-startup-surface` passes.
- `npm test` includes `npm run check:db-startup-surface`.
- `npm run check:migrations` remains green.
- New durable schema work goes to `db/migrations/`, not `db/index.js`.
- Any future removal from `initDatabase()` first gets an equivalent migration
  and focused verification on a fresh database path.
