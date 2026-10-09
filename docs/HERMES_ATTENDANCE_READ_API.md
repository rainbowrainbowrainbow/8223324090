# Hermes attendance read API

Task: `CRM-ATTENDANCE-READ-001`. Local implementation; no production verification or deployment is implied.

## Request and access

```http
GET /api/hermes/attendance?businessContext=event_genix&dateFrom=2026-09-29&dateTo=2026-09-29&staffIds=
```

- Existing Hermes machine authentication: `x-api-key` or `Authorization: Bearer <configured machine secret>`. The existing key, actor lookup, active-account checks, actor normalization, and optional business allowlist are unchanged.
- The actor's effective business contexts must include `event_genix`, and its existing effective role permissions must grant `hr.today.view`, matching the canonical HR attendance read policy. No permissions or role defaults are granted by this endpoint.
- `businessContext` defaults to `event_genix`; other requested businesses are rejected. This endpoint deliberately preserves the current Hermes attendance business boundary.
- `dateFrom` and `dateTo` are required real `YYYY-MM-DD` dates, years 0001–9999, inclusive, ordered, at most 31 days.
- `staffIds` is optional, a comma-separated list of positive PostgreSQL integer IDs (1–2147483647), at most 50 distinct IDs. Duplicate IDs are deduplicated. An omitted or exactly empty value means no staff filter **within the permitted business**.
- Nonempty malformed ID values, empty list fragments, repeated/object/array parameters, and simultaneous canonical/alias filters fail closed. Existing `business_context` and `staff_ids` spellings are supported individually; dates use camel case only.
- A staff ID with no record in the permitted business produces no row; it never broadens the selection.

## Response

```json
{
  "success": true,
  "items": [
    { "staffId": 11, "staffName": "Synthetic Display 11", "date": "2026-09-29", "arrivalTime": "09:07", "status": "present" }
  ],
  "meta": {
    "businessContext": "event_genix",
    "dateFrom": "2026-09-29",
    "dateTo": "2026-09-29",
    "days": 1,
    "staffIds": [],
    "timeZone": "Europe/Kyiv",
    "sanitized": true,
    "readOnly": true
  }
}
```

The example is synthetic. `items` contains only stored `hr_time_records` rows, scoped by their own `business_context` and `record_date`. `staffName` is an additive display convenience from the current global `staff.id`: trimmed nonempty `display_name`, otherwise trimmed nonempty `name`, otherwise JSON `null`. Missing staff rows do not hide attendance rows. `arrivalTime` formats actual `clock_in` in `Europe/Kyiv` as `HH:mm`; `date` remains the stored work date. `status` is returned as stored. Missing arrival/status values remain JSON `null`. No records means HTTP 200 with `items: []`.

No schedule, payroll, personal contact fields, or compensation snapshots are read or returned. The only staff enrichment is a `LEFT JOIN staff ON staff.id = hr_time_records.staff_id`; staff business/context, active-state, scheduleability, HR pool, freelance and termination filters are not applied to historical facts. GET does not create preview/import/idempotency records, mutate attendance/schedule/payroll/outbox, broadcast, or send messages. Only the existing machine-actor SELECT and the attendance SELECT are needed.

The inspected Hermes client's `_first_list` accepts `items`, and `_compact_attendance_cell` consumes the attendance fields plus additive `staffName` when present. The client currently displays the first 50 cells while counting the complete result. The API does not silently truncate the list. No Hermes client change is required for this contract.

## Errors and discovery

- 400: `HERMES_INVALID_DATE_RANGE` or `HERMES_INVALID_FILTER`.
- 401: existing `HERMES_AUTH_REQUIRED` / `HERMES_AUTH_INVALID`.
- 403: existing business/actor errors or `HERMES_CAPABILITY_REQUIRED`.
- 503: existing machine-auth/actor configuration failures.
- 500: `HERMES_INTERNAL_ERROR` if the attendance read fails, with no fallback to planned data.

`GET /api/hermes/capabilities` advertises `attendance.read` and `endpoints.attendance.list`, `maxDateRangeDays`, `timeZone`, and `readRequiredCapability`. Preview/apply capabilities and behavior are unchanged.

## Local diagnosis and verification

Before this endpoint was registered, a valid machine-key GET had no matching Hermes handler. It fell through `server.js`'s later generic `/api` settings router to `routes/settings.js`'s unconditional JWT middleware. With an API-key-only request, `middleware/auth.js` returned `401 Authentication required` / `auth_token_missing`. This mechanism was reproduced locally using the real auth boundary, machine-auth, business-scope guard, API audit, Hermes, shop and settings routers with synthetic persistence. An unknown-route control still demonstrates the existing fallthrough behavior; this patch does not widen any auth exception.

Production's exact cause remains unverified: the deployed source, middleware order, configuration and credential mode were not inspected. Do not interpret local success as proof of a production fix.

Use the repository's Node 22 / npm 10 runtime:

```powershell
npm run check:runtime
node --require ./tests/helpers/forbid-real-db.js --test tests/hermes-attendance-read.test.js
node --require ./tests/helpers/forbid-real-db.js --test tests/hermes-attendance-import.test.js tests/hermes-schedule-routes.test.js tests/hermes-schedule-preview.test.js tests/hermes-schedule-apply.test.js tests/hermes-staff-schedule.test.js tests/hermes-date-only.test.js tests/staff-schedule-service.test.js tests/staff-schedule-mutations.test.js tests/hr-attendance-clock-in.test.js tests/hr-attendance-clock-out.test.js
node --require ./tests/helpers/forbid-real-db.js --test tests/hermes-auth.test.js tests/auth-boundary.test.js tests/forbid-real-db.test.js
node scripts/run-hermes-attendance-read-postgres.js
npm run check:auth-boundary
npm run check:api-surface
npm run check:access
npm run check:action-permissions
npm run check:permission-registry
npm run check:syntax
```

The synthetic tests use actual routers and authorization with injected queryables. The early `forbid-real-db` guard blocks `pg.Pool`/`pg.Client` query/connect calls and fails even if an application catches the error. Auth-boundary report-bot configuration reads use a narrowly validated synthetic provider store. Exact capabilities assertions preserve the production-base task contract while adding `attendance.read`; no unrelated task actions are introduced.

The PostgreSQL runner reuses the documented disposable Docker lifecycle and `scripts/test-db-safety.js`. It requires an already cached `postgres:16` image, uses `--pull=never`, a local Docker engine, a random loopback-only port, temporary storage, and process-local disposable credentials. It starts no CRM server or background tasks and runs no application migrations. Cleanup verifies the exact container name and disposable labels before removing only its own container.

The integration suite forwards the actual GET handler SQL and parameters unchanged to the single validated PostgreSQL Client; other DB connections are blocked. Temporary synthetic records cover business isolation (including the same staff ID in two businesses), PostgreSQL `int[]` filters, empty results, null arrivals, inclusive dates, and Kyiv summer/winter offsets under UTC and America/Los_Angeles DB sessions. It verifies that GET leaves all fixture rows unchanged, then rolls back and closes the client. This proves the SELECT on isolated PostgreSQL; deployed code, production schema, credentials and live behavior remain unverified.
