# Task Center saved views: schema decision

## Decision requested

Saved views must persist for the current user across devices. The existing
`task_user_preferences` row is the correct ownership boundary: it is already
one row per user and is served by the authenticated task preferences API.

Do not use browser storage as persistence. Browser storage may still hold an
ephemeral UI draft, but it is not a source of truth.

## Proposed additive schema

Future migration filename: `308_task_saved_views_preferences.sql`.

```sql
-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent preference fields only. Existing users receive an empty saved-view list and revision 0; no task data is read, changed, or removed.
-- ROLLBACK: Keep the additive fields during application rollback. If the feature is permanently removed after exporting or intentionally discarding saved views, drop the named constraint and both added columns.

ALTER TABLE task_user_preferences
    ADD COLUMN IF NOT EXISTS saved_task_views JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS saved_task_views_revision INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'task_user_preferences_saved_task_views_array_check'
          AND conrelid = 'task_user_preferences'::regclass
    ) THEN
        ALTER TABLE task_user_preferences
            ADD CONSTRAINT task_user_preferences_saved_task_views_array_check
            CHECK (jsonb_typeof(saved_task_views) = 'array');
    END IF;
END $$;
```

No index is needed: the read and update path is always `WHERE user_id = $1`,
which already has a unique constraint/index. No backfill is required because
the default is a valid empty list.

## Why the revision is included

The `saved_task_views_revision` counter prevents silent lost updates when the
same user edits saved views from two browsers/devices. A write supplies the
revision returned by the preceding preferences read. The server updates only
when it still matches and increments it atomically. On a mismatch it returns
HTTP 409 with the current server value; the UI reloads it and shows a visible
conflict message instead of overwriting another device's change.

The counter applies only to saved views. Existing sound and personal task
preferences preserve their current PATCH behavior.

## Stored object contract

`saved_task_views` is an array of at most 12 objects. Application validation,
not the database check constraint, enforces every object field.

```json
{
  "id": "uuid",
  "name": "Прострочені моєї команди",
  "state": {
    "mode": "overview",
    "queue": "overdue",
    "ownerUserId": 42,
    "dateFrom": "2026-08-01",
    "dateTo": "2026-08-07",
    "status": ["todo", "in_progress"],
    "priority": ["urgent", "high"],
    "category": "orders",
    "source": "booking",
    "search": ""
  }
}
```

Validation rules:

- `id`: UUID string, unique within the current user's array.
- `name`: trimmed text, 1–64 characters; no HTML is rendered unsafely.
- `mode`: `overview`, `team`, `planning`, or `library`.
- `queue`: a canonical Task Center queue/view identifier only.
- `ownerUserId`: positive integer or omitted.
- `dateFrom` / `dateTo`: `YYYY-MM-DD`, ordered if both exist.
- `status`: unique allowed task statuses only; `priority`: unique allowed
  priorities only.
- `category` and `source`: recognized task taxonomy/source values only.
- `search`: trimmed plain text, maximum 120 characters.
- Unknown fields are dropped. `businessContext`, role/permission fields,
  arbitrary API parameters, raw SQL, HTML, and source-record payloads are not
  stored.

The current business context is intentionally excluded. It remains resolved by
the authenticated request and existing business-scope middleware, so a copied
view cannot bypass isolation or make a different context the user's default.

## API contract after approval

`GET /api/tasks/preferences` returns the current `saved_task_views` and
`saved_task_views_revision` only for the authenticated user.

`PATCH /api/tasks/preferences` accepts either existing preference fields or:

```json
{
  "savedTaskViews": ["validated view objects"],
  "savedTaskViewsRevision": 4
}
```

The server validates the complete array, then executes an atomic update:

```sql
UPDATE task_user_preferences
SET saved_task_views = $1::jsonb,
    saved_task_views_revision = saved_task_views_revision + 1,
    updated_at = NOW()
WHERE user_id = $2
  AND saved_task_views_revision = $3
RETURNING saved_task_views, saved_task_views_revision;
```

If no row is returned, the route reads the current user-owned view list and
returns `409 TASK_SAVED_VIEWS_CONFLICT`. It must never read another user's
preferences, merge arbitrary stale arrays, or silently choose a winner.

## Implementation boundary after approval

1. Create the governed migration above; do not run it on production in that
   implementation task.
2. Add server validation and conflict behavior to the existing preferences
   route/service.
3. Add URL serialization, `popstate`, and server-side task search separately
   from saved-view persistence.
4. Add `BroadcastChannel` only as a notification mechanism. The server
   response remains the source of truth.
5. Add tests for validation, user isolation, revision conflict, URL round-trip,
   stale response rejection, and cross-tab notification.

## Rollback and operational safety

- Application rollback: leave both new columns in place; older application
  versions ignore additive fields.
- Schema rollback after permanent feature removal: export or deliberately
  discard saved views, drop the named constraint, then drop both fields.
- This is a schema-only migration. It does not update tasks, roles,
  permissions, customer data, or business data.
- Production execution requires a separate explicit confirmation after the
  migration file and its static checks are reviewed.

## Required confirmation

Before implementation, the product owner must explicitly confirm:

> I approve the `saved_task_views` plus `saved_task_views_revision` additive
> schema and the validation contract in
> `docs/TASK_CENTER_SAVED_VIEWS_SCHEMA_DECISION.md`. Create the migration file
> and implement the API/UI, but do not run a production migration, deploy, or
> change roles/permissions.
