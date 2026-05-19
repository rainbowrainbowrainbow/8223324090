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

`DB_MIGRATION_GOVERNANCE.md` remains the authority for migration rules.
`db/migrations/` is the durable schema history. `db/index.js` still owns legacy
compatibility schema and startup data hooks, so this map freezes the current
surface before we migrate one small responsibility at a time.

The rule going forward: do not add product tables, columns, indexes, triggers,
or one-off data fixes to `db/index.js`. Add durable schema work to
`db/migrations/`, with the required migration headers, and run `npm run
check:migrations`.

## Startup Schema Tables

`initDatabase()` currently creates these compatibility tables:

`afisha`, `afisha_templates`, `automation_rules`, `booking_counter`,
`bookings`, `budget_plans`, `certificate_counter`, `certificates`,
`contractor_notifications`, `contractors`, `customers`, `design_collections`,
`design_tags`, `designs`, `finance_categories`, `finance_transactions`,
`history`, `kleshnya_chat`, `kleshnya_messages`, `lines_by_date`,
`pending_animators`, `point_transactions`, `procurement_items`,
`procurement_lists`, `products`, `schema_migrations`, `scheduled_deletions`,
`settings`, `staff`, `staff_schedule`, `task_logs`, `task_templates`, `tasks`,
`telegram_known_chats`, `telegram_known_threads`, `user_action_log`,
`user_points`, `user_streaks`, `users`.

`schema_migrations` is intentionally present in both `db/index.js` and
`db/migrate.js` while the two-phase startup flow remains.

## Startup Compatibility Columns

`initDatabase()` currently keeps these `ADD COLUMN IF NOT EXISTS` shims:

`afisha.description`, `afisha.line_id`, `afisha.original_time`,
`afisha.template_id`, `afisha.type`, `bookings.costume`,
`bookings.customer_id`, `bookings.extra_data`, `bookings.group_name`,
`bookings.kids_count`, `bookings.payment_method`, `bookings.skip_notification`,
`bookings.status`, `bookings.telegram_message_id`, `bookings.updated_at`,
`certificates.customer_id`, `certificates.season`, `certificates.value_uah`,
`staff.telegram_username`, `task_templates.category`, `tasks.afisha_id`,
`tasks.archive_reason`, `tasks.archived_at`, `tasks.category`,
`tasks.control_policy`, `tasks.deadline`, `tasks.dependency_ids`,
`tasks.duplicate_of_task_id`, `tasks.escalation_level`,
`tasks.last_reminded_at`, `tasks.owner`, `tasks.source_id`,
`tasks.source_type`, `tasks.task_type`, `tasks.template_id`,
`tasks.time_window_end`, `tasks.time_window_start`, `tasks.type`,
`tasks.version`, `users.telegram_chat_id`, `users.telegram_username`.

## Startup Indexes And Triggers

The guard tracks 68 startup indexes in `config/dbStartupSurface.js`. The current
startup trigger/function pair is `update_updated_at_column` and
`trg_bookings_updated_at`.

Task lifecycle compatibility also keeps `idx_tasks_completed_at` and
`idx_tasks_duplicate_of_task_id` while older production databases catch up to the
durable SQL migration history.

Do not add a new startup index as a convenience shortcut. New durable indexes
belong in SQL migrations.

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

This pack is considered done when all of these remain true:

- `npm run check:db-startup-surface` passes.
- `npm test` includes `npm run check:db-startup-surface`.
- `npm run check:migrations` remains green.
- New durable schema work goes to `db/migrations/`, not `db/index.js`.
- Any future removal from `initDatabase()` first gets an equivalent migration
  and focused verification on a fresh database path.
