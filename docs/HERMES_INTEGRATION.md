# Hermes Integration Contract

This document defines the CRM-side contract for the Hermes task, menu photo,
and durable job integration. The `/api/hermes/capabilities` endpoint,
read-only task endpoints, task mutations, menu/product photo draft workflow,
and CRM-owned Hermes jobs are implemented as safe MVP workflows.

## Scope

Hermes v1 is a pull/read/action integration for Event Genix CRM tasks,
reviewable kitchen menu/product photo drafts, and durable CRM-owned Hermes
jobs.

Hermes will call Event Genix CRM directly over HTTPS. CRM will not push events
to Hermes in v1, and no Hermes callback or webhook endpoint is required for the
first release.

The integration is intentionally narrow:

- Read a bounded task list.
- Read task detail.
- Read task action history.
- Create a task after Hermes-side user confirmation.
- Complete a task after Hermes-side user confirmation.
- Reassign a task after Hermes-side user confirmation.
- Reschedule a task after Hermes-side user confirmation.
- Read kitchen menu/product photo status.
- Generate a menu/product photo draft after Hermes-side user confirmation.
- Queue durable `menu_photo_job` work for up to five kitchen menu products
  without current photos.
- Apply or reject a ready menu/product photo draft after Hermes-side user
  confirmation.
- Read, create, claim, update, and return results for durable Hermes jobs.
- Store Hermes job assets, event history, and human approval decisions.
- Read a sanitized, cursor-paginated scheduleable staff directory.
- Read existing staff schedule cells for a bounded date range.

The integration must not expose generic CRM access, raw database rows, delete
operations, bulk operations, auth/session management, finance actions, admin
actions, unrestricted task updates, provider secrets, raw image provider
responses, unconfirmed bulk photo generation, auto-publish, or auto-apply.

## Hermes Environment Assumptions

Confirmed Hermes-side values:

- Integration id: `hermes-event-genix-crm`
- User-Agent: `Hermes-Agent/Event-Genix-CRM-Integration`
- Transport: HTTPS
- Hermes runtime: local desktop agent/gateway
- Static outbound IP: not guaranteed for v1
- CRM-to-Hermes webhook: not enabled and not required for v1
- Mutations: supported only after explicit user confirmation inside Hermes

Because Hermes is a local desktop runtime in v1, CRM must not depend on a
public Hermes URL or IP allowlist unless a later security review explicitly
changes that requirement.

## Endpoint Contract

All endpoints live under `/api/hermes`; v1 task action endpoints, menu photo
draft endpoints, and CRM-owned Hermes job endpoints are implemented.

| Method | Path | Purpose | Mutation |
| --- | --- | --- | --- |
| `GET` | `/api/hermes/capabilities` | Integration discovery and limits | No |
| `GET` | `/api/hermes/my-cabinet` | Read-only My Cabinet/My Day task projection | No |
| `GET` | `/api/hermes/tasks` | Bounded task list | No |
| `GET` | `/api/hermes/tasks/:id` | Task detail | No |
| `GET` | `/api/hermes/tasks/:id/history` | Task action history | No |
| `POST` | `/api/hermes/tasks` | Create task | Yes |
| `POST` | `/api/hermes/tasks/:id/complete` | Complete task | Yes |
| `POST` | `/api/hermes/tasks/:id/reassign` | Reassign task owner | Yes |
| `POST` | `/api/hermes/tasks/:id/reschedule` | Reschedule task deadline | Yes |
| `GET` | `/api/hermes/menu-photos/candidates` | Kitchen menu photo candidates | No |
| `GET` | `/api/hermes/menu-photos/:productId` | Kitchen menu photo status | No |
| `POST` | `/api/hermes/menu-photos/:productId/draft` | Generate a reviewable photo draft | Yes |
| `POST` | `/api/hermes/menu-photos/:productId/external-draft` | Store a worker-supplied reviewable photo draft | Yes |
| `POST` | `/api/hermes/menu-photos/jobs` | Queue up to five durable menu photo jobs for products without photos | Yes |
| `POST` | `/api/hermes/menu-photos/:productId/apply` | Apply a ready photo draft | Yes |
| `POST` | `/api/hermes/menu-photos/:productId/reject` | Reject a photo draft | Yes |
| `GET` | `/api/hermes/jobs/queue` | Queued durable Hermes jobs | No |
| `GET` | `/api/hermes/jobs/:id` | Job detail with assets, history, and decisions | No |
| `GET` | `/api/hermes/staff` | Sanitized scheduleable staff directory | No |
| `GET` | `/api/hermes/staff-schedule` | Existing schedule cells for up to 31 days | No |
| `POST` | `/api/hermes/staff-schedule/preview` | Validate OCR rows and persist a read-only schedule diff | No schedule writes |
| `POST` | `/api/hermes/staff-schedule/apply` | Atomically apply confirmed rows from an immutable preview | Yes, gated and idempotent |
| `POST` | `/api/hermes/jobs` | Create a durable Hermes job | Yes |
| `POST` | `/api/hermes/jobs/:id/claim` | Claim a queued job for a worker | Yes |
| `POST` | `/api/hermes/jobs/:id/status` | Post worker status | Yes |
| `POST` | `/api/hermes/jobs/:id/result` | Post worker result and assets | Yes |
| `POST` | `/api/hermes/jobs/:id/decision` | Record human approval decision | Yes |

Implementation must use the existing task policy, execution, and business
context services instead of duplicating authorization logic:

- `services/taskPolicy.js`
- `services/taskExecution.js`
- `services/taskBusinessScope.js`
- `services/businessContext.js`

The existing task APIs in `routes/tasks.js` and manager queue actions in
`routes/work-queue.js` are the behavioral reference for visibility, mutation
semantics, and error behavior.

## Authentication

Preferred auth header:

```http
x-api-key: <secret>
```

Allowed fallback auth header:

```http
Authorization: Bearer <secret>
```

Required headers from Hermes:

```http
Accept: application/json
Content-Type: application/json
User-Agent: Hermes-Agent/Event-Genix-CRM-Integration
X-Integration-Id: hermes-event-genix-crm
x-api-key: <secret>
```

Mutation requests must also send:

```http
Idempotency-Key: <uuid>
X-Hermes-User-Confirmed: true
```

The exact confirmation header name can change during implementation, but the
CRM contract must keep a machine-readable confirmation gate for every mutation.

### CRM Auth Boundary Requirement

Most `/api/*` routes are guarded by the central API auth boundary. Hermes routes
must not become unauthenticated public routes. `/api/hermes/*` is registered as
a custom-secret guarded API exception so the central middleware can pass the
request to the Hermes router. The Hermes router must then validate the API key
itself before doing any work.

The implementation must update all required ownership files in the same change
packet:

- `config/authBoundary.js`
- `docs/AUTH_BOUNDARY.md`
- `config/apiSurface.js`
- `docs/API_SURFACE.md`
- focused auth/API surface tests

This document alone does not change the active auth boundary.

## Secrets And Environment

CRM-side implementation is expected to use environment variables, but this
document does not define real values.

Planned CRM-side env names:

```bash
HERMES_API_KEY=<secret>
HERMES_ACTOR_USER_ID=<crm_user_id_for_hermes_actor>
HERMES_ALLOWED_BUSINESS_CONTEXTS=event_genix
EVENT_GENIX_CRM_AGENT_OWNER_USER_ID=4
EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS=4
```

Planned Hermes-side local configuration names:

```bash
EVENT_GENIX_CRM_BASE_URL=https://<crm-host>
EVENT_GENIX_CRM_API_KEY=<secret>
EVENT_GENIX_CRM_AUTH_MODE=x-api-key
```

Secrets must never be committed, pasted into chat, written into task
descriptions, stored in frontend JavaScript, exposed in screenshots, or logged
in plaintext. Production secrets belong only in server environment variables or
local Hermes secret storage.

## Actor Model

Hermes should act through a dedicated CRM service account configured by
`HERMES_ACTOR_USER_ID`.

Implementation requirements:

- Load the actor from the `users` table.
- Reject inactive or missing actor users.
- Build `req.user` in the same shape expected by existing task policies.
- Keep normal task visibility and business context rules.
- Log mutations as the Hermes actor.

The integration must not create the service account automatically and must not
hardcode user credentials.

## Business Context

Every read must resolve a valid business scope. Every mutation must require a
writable single business scope.

Allowed query/body fields:

- `businessContext`
- `business_context`

Multi-business and all-business scopes are read-only in the existing CRM model
and must not be accepted for Hermes mutations.

`HERMES_ALLOWED_BUSINESS_CONTEXTS` is an optional restrictive allowlist. When
set, CRM intersects it with the configured actor user's existing business
contexts. It never expands access. If the intersection is empty, Hermes auth is
rejected with `403 HERMES_BUSINESS_CONTEXT_FORBIDDEN`. Use canonical context
keys such as `event_genix`, `dar`, `maysternya_doli`, or `crm`.

## Capabilities Response

`GET /api/hermes/capabilities` should return a stable discovery response.

Example:

```json
{
  "success": true,
  "integrationId": "hermes-event-genix-crm",
  "auth": "x-api-key",
  "authFallback": "authorization-bearer",
  "maxLimit": 50,
  "pagination": "cursor",
  "mutationsRequireConfirmation": true,
  "mutationsRequireIdempotencyKey": true,
  "supportedActions": [
    "tasks.read",
    "tasks.detail",
    "tasks.history",
    "tasks.my_cabinet",
    "tasks.create",
    "tasks.complete",
    "tasks.completion_report",
    "tasks.comment",
    "tasks.subtasks.read",
    "tasks.subtask.toggle",
    "tasks.reassign",
    "tasks.reschedule",
    "tasks.status",
    "menu_photos.read",
    "menu_photos.candidates",
    "menu_photos.context",
    "menu_photos.draft",
    "menu_photos.external_draft",
    "menu_photos.jobs.create",
    "menu_photos.apply",
    "menu_photos.reject",
    "hermes_jobs.queue",
    "hermes_jobs.read",
    "hermes_jobs.create",
    "hermes_jobs.claim",
    "hermes_jobs.status",
    "hermes_jobs.result",
    "hermes_jobs.decision",
    "staff.read",
    "staff_schedule.read",
    "staff_schedule.preview",
    "staff_schedule.apply"
  ],
  "mutationActionsAvailable": true,
  "plannedMutationActions": [],
  "myCabinet": {
    "available": true,
    "defaultOwnerConfigured": true,
    "ownerAllowlistEnabled": true
  },
  "webhooks": {
    "crmToHermesEnabled": false
  }
}
```

## My Cabinet Task Projection

Endpoint:

```http
GET /api/hermes/my-cabinet?ownerUserId=4&businessContext=event_genix
```

Example:

```bash
curl -s "https://<crm-host>/api/hermes/my-cabinet?ownerUserId=4&businessContext=event_genix" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Hermes-Agent/Event-Genix-CRM-Integration" \
  -H "X-Integration-Id: hermes-event-genix-crm" \
  -H "x-api-key: <secret>"
```

This is the stable read-only Hermes path for the same task projection shown by
the CRM UI in `/api/tasks/my-cabinet` and the left sidebar "My Day" counters.
It must use Hermes `x-api-key` auth, not a personal CRM password, JWT, cookie,
or stored browser session.

Owner resolution:

- `ownerUserId` query param wins when present.
- Otherwise CRM reads `EVENT_GENIX_CRM_AGENT_OWNER_USER_ID`.
- If `EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS` is set, the resolved owner must
  be in that comma/space separated allowlist.

Controlled owner errors:

- `400 HERMES_OWNER_REQUIRED`
- `400 HERMES_INVALID_OWNER`
- `403 HERMES_OWNER_NOT_ALLOWED`
- `404 HERMES_OWNER_NOT_FOUND`

Response shape matches the core `/api/tasks/my-cabinet` payload:

```json
{
  "success": true,
  "focus": [],
  "today": [],
  "next": [],
  "deferred": [],
  "waiting": [],
  "private": [],
  "overdue": [],
  "inbox": [],
  "completedHistory": [],
  "all": [],
  "preferences": {},
  "stats": {
    "openTaskCount": 0,
    "activeOpenCount": 0,
    "todayDone": 0,
    "taskQuick": {}
  },
  "meta": {
    "sourceSurface": "hermes",
    "source": "hermes-event-genix-crm",
    "ownerUserId": 4,
    "businessContext": "event_genix",
    "projection": "tasks.my_cabinet"
  }
}
```

Hermes reads existing task preferences for the owner. It must not create,
complete, reassign, reschedule, or otherwise mutate tasks through this endpoint.

## Task List Contract

Endpoint:

```http
GET /api/hermes/tasks?limit=50&cursor=<cursor>
```

Supported filters:

- `status`
- `ownerUserId`
- `priority`
- `dateFrom`
- `dateTo`
- `businessContext`
- `cursor`
- `limit`

`limit` defaults to `50` and must be clamped to `50`.

Response shape:

```json
{
  "success": true,
  "items": [
    {
      "id": "crm_task_123",
      "title": "Call client",
      "status": "open",
      "priority": "normal",
      "assignee": {
        "id": "user_1",
        "name": "Manager Name"
      },
      "due_at": "2026-06-30T12:00:00+03:00",
      "created_at": "2026-06-27T07:00:00+03:00",
      "updated_at": "2026-06-27T07:10:00+03:00",
      "crm_url": "https://crm.example.com/tasks?open=123"
    }
  ],
  "pagination": {
    "next_cursor": null,
    "has_more": false,
    "limit": 50
  }
}
```

Required fields for each item:

- `id`
- `title`
- `status`
- `updated_at`
- `crm_url`

Preferred fields:

- `description`
- `priority`
- `assignee.id`
- `assignee.name`
- `due_at`
- `created_at`
- `labels`

## Task Detail Contract

Endpoint:

```http
GET /api/hermes/tasks/:id
```

Response shape:

```json
{
  "success": true,
  "task": {
    "id": "crm_task_123",
    "title": "Call client",
    "description": "Call and confirm booking details.",
    "status": "open",
    "priority": "normal",
    "assignee": {
      "id": "user_1",
      "name": "Manager Name"
    },
    "creator": {
      "id": "user_2",
      "name": "Creator Name"
    },
    "client": {
      "id": "client_123",
      "name": "Client Name"
    },
    "due_at": "2026-06-30T12:00:00+03:00",
    "created_at": "2026-06-27T07:00:00+03:00",
    "updated_at": "2026-06-27T07:10:00+03:00",
    "completed_at": null,
    "crm_url": "https://crm.example.com/tasks?open=123",
    "labels": ["booking", "urgent"],
    "subtasks": [
      {
        "id": "subtask_1",
        "title": "Check availability",
        "status": "done"
      }
    ],
    "metadata": {
      "crm_status": "todo",
      "business_context": "event_genix",
      "version": 1
    }
  }
}
```

Phone numbers and email addresses should be excluded from v1 unless a later
privacy review explicitly approves those fields.

## Staff And Schedule Read Contract

These endpoints use the same Hermes API-key middleware as every other
`/api/hermes` endpoint. A CRM JWT or session cookie is not accepted as an
alternative credential. The configured Hermes actor must have access to
`event_genix`; schedule reads do not grant or require `manage_staff`.

Until staff schedules become business-context-aware, both endpoints support
only `event_genix`.

Sanitized staff directory:

```http
GET /api/hermes/staff?scheduleable=true&includeFreelance=false&limit=50&cursor=<opaque>&q=<exact-name>
```

`scheduleable` defaults to `true`, `includeFreelance` defaults to `false`, and
`limit` is clamped to `50`. The optional `q` comparison is exact after Unicode,
case, surrounding-space, and repeated-whitespace normalization. Default reads
exclude inactive, blacklisted, non-core, freelance, and terminated staff.

Only these staff fields are returned:

```json
{
  "staffId": 746,
  "name": "Славицька Анна",
  "displayName": "Славицька Анна",
  "department": "admin",
  "position": "Адміністратор",
  "professions": ["administrator"],
  "scheduleable": true
}
```

Phone numbers, Telegram identifiers, documents, payroll, rates, attendance,
account links, HR status details, and raw staff rows are not returned.

Bounded schedule read:

```http
GET /api/hermes/staff-schedule?dateFrom=2026-07-14&dateTo=2026-07-15&staffIds=746,748
```

`dateFrom` and `dateTo` are required and inclusive. The range may not exceed
31 days. `staffIds` is optional and accepts at most 50 unique positive ids.
Only existing cells belonging to staff who are scheduleable on that cell date
are returned. Legacy `day_off` is normalized to `dayoff`.

Each cell includes `staffId`, `date`, normalized `status`, `startTime`,
`endTime`, `note`, `professionKey`, and `stateHash`. `stateHash` is a SHA-256
hash of the canonical cell state and can be stored in an import preview for a
later stale-state check. The read endpoint itself never creates or updates an
import or schedule row.

### OCR Schedule Preview

Hermes performs OCR and sends JSON rows only. The CRM does not accept photo or
image binary on this endpoint:

```http
POST /api/hermes/staff-schedule/preview
Content-Type: application/json
X-API-Key: <hermes-key>
```

```json
{
  "documentDate": "2026-07-13",
  "sourceReference": {
    "telegram": {
      "chatId": "-100123",
      "messageId": "456",
      "fileUniqueId": "schedule-photo-1"
    }
  },
  "rows": [
    {
      "employeeName": "Славицька Анна",
      "date": "2026-07-14",
      "startTime": "10:00",
      "endTime": "19:00",
      "status": "working",
      "note": null,
      "confidence": 0.98,
      "issues": []
    }
  ]
}
```

The endpoint accepts at most 100 rows and supports `working`, `remote`,
`dayoff`, `vacation`, and `sick`. `working` requires a valid `HH:MM` time pair;
overnight shifts are allowed, but equal start and end times are invalid.
Non-working statuses must not include times.

Staff matching uses CRM data as the source of truth. Exact matching has
priority over normalized exact matching. Normalization covers Unicode, case,
outer spaces, and repeated whitespace. Fuzzy matching is never automatic, and
OCR confidence never authorizes a guessed match. Only scheduleable staff can
be selected. A non-scheduleable exact match may be returned as a sanitized,
read-only candidate.

Every row is classified as `create`, `update`, `no_change`, `conflict`,
`staff_not_found`, `ambiguous_staff`, or `invalid`. Transitions between working
and non-working states, changes between different non-working states, duplicate
staff/date targets, and unexpected duplicate current cells are conflicts.

For matched rows, the preview stores the proposed state, expected current
state, a stable `rowId`, and a SHA-256 `stateHash`. Import metadata expires in
30 minutes. Repeating the same `sourceReference` returns the same import
session. The response always contains `scheduleWrites: 0`; this endpoint never
updates `staff_schedule` or `hr_shifts`.

### Confirmed Schedule Apply

Apply accepts only row identifiers from a stored immutable preview. Hermes
must not rebuild or send the proposed schedule payload:

```http
POST /api/hermes/staff-schedule/apply
Content-Type: application/json
X-API-Key: <hermes-key>
X-Integration-Id: hermes-event-genix-crm
X-Hermes-User-Confirmed: true
Idempotency-Key: <unique-key>
```

```json
{
  "previewId": "hsi_01J...",
  "selectedRowIds": ["row_01", "row_02"],
  "conflictConfirmed": ["row_02"]
}
```

The body may contain only `previewId`, `selectedRowIds`, and
`conflictConfirmed`. The last field is an array of selected conflict row IDs
that the user confirmed separately. Supplying `proposedMutationPayload` or any
other body key is rejected.

The authenticated Hermes actor must already have the current `manage_staff`
action permission. Hermes authentication never grants this permission. Apply
is currently limited to the `event_genix` business context.

Before any schedule write, CRM locks the import, selected staff rows, and
current schedule cells. It then rechecks preview status and TTL, scheduleable
staff eligibility, conflict confirmation, and each expected current-state
hash. Any stale or invalid selected row returns `409` with zero schedule
writes.

All selected writable rows are applied in one database transaction through
the shared schedule mutation service. `staff_schedule`, `hr_shifts`, schedule
audit, and animator roster reconciliation therefore succeed or roll back as a
single batch. After commit, CRM sends one bulk notification summary and emits
roster updates for the unique affected dates; it does not notify once per row.

An import is one-shot: a successful subset apply marks the whole import as
`applied`, so remaining rows require a new preview. Reusing the same
`Idempotency-Key` with the same request returns the stored result without new
writes. Reusing it with a different request is rejected.

Successful apply response:

```json
{
  "success": true,
  "previewId": "hsi_01J...",
  "status": "applied",
  "selectedCount": 2,
  "appliedCount": 1,
  "noChangeCount": 1,
  "scheduleWrites": 1,
  "dates": ["2026-07-15"],
  "results": [
    {
      "rowId": "hsr_aaaaaaaaaaaaaaaaaaaaaaaa",
      "previewAction": "update",
      "result": "applied",
      "staffId": 123,
      "date": "2026-07-15",
      "status": "working"
    }
  ]
}
```

### Schedule Error Contract

Errors use `{ "success": false, "error": "...", "code": "..." }` and may
include a sanitized `meta` object. Hermes must branch on `code`, not translated
error text.

| HTTP | Code | Worker action |
| --- | --- | --- |
| `400` | `HERMES_SCHEDULE_PREVIEW_BINARY_FORBIDDEN` | Run OCR in Hermes and resend JSON rows only. |
| `400` | `HERMES_SCHEDULE_IMPORT_DATE_INVALID` | Ask for a valid document date. |
| `400` | `HERMES_SCHEDULE_PREVIEW_ROWS_LIMIT` | Split input into previews of at most 100 rows. |
| `400` | `HERMES_INTEGRATION_ID_REQUIRED` / `HERMES_INTEGRATION_ID_INVALID` | Fix the integration header; do not retry unchanged. |
| `400` | `HERMES_CONFIRMATION_REQUIRED` | Obtain explicit user approval before apply. |
| `400` | `IDEMPOTENCY_KEY_REQUIRED` | Generate one key for this logical apply. |
| `401` | `HERMES_AUTH_REQUIRED` / `HERMES_AUTH_INVALID` | Stop and repair Hermes credentials without logging them. |
| `403` | `HERMES_MANAGE_STAFF_REQUIRED` | Stop; an operator must grant the configured actor permission in CRM. |
| `403` | `HERMES_SCHEDULE_BUSINESS_CONTEXT_UNAVAILABLE` | Stop; schedule integration currently supports only `event_genix`. |
| `404` | `HERMES_SCHEDULE_IMPORT_NOT_FOUND` | Create a new preview from the OCR rows. |
| `409` | `HERMES_SCHEDULE_APPLY_PREVIEW_EXPIRED` | Create a new preview and ask for approval again. |
| `409` | `HERMES_SCHEDULE_IMPORT_ALREADY_APPLIED` | Treat as already completed only if local correlation confirms the same operation. |
| `409` | `HERMES_SCHEDULE_APPLY_CONFLICT_CONFIRMATION_REQUIRED` | Ask the user to confirm the specific conflict row. |
| `409` | `HERMES_SCHEDULE_APPLY_ROW_BLOCKED` | Remove invalid, missing, or ambiguous rows and create a new preview if needed. |
| `409` | `HERMES_SCHEDULE_APPLY_STALE` | Never overwrite; fetch current schedule, create a new preview, and ask again. |
| `409` | `IDEMPOTENCY_KEY_CONFLICT` | The key was reused with a different request; generate a new key only for a new logical operation. |
| `5xx` | `HERMES_INTERNAL_ERROR` or transaction failure | Retry the exact same body with the exact same idempotency key after backoff. |

### End-To-End Schedule Flow

1. Read `/api/hermes/capabilities` and require all four schedule actions.
2. OCR the attached form inside Hermes; never send the image binary to CRM.
3. Optionally read sanitized staff and the bounded current schedule for worker
   diagnostics. Do not decide matches locally.
4. Send OCR rows to preview and assert `scheduleWrites === 0`.
5. Present CRM classifications to the user. Never auto-select `invalid`,
   `staff_not_found`, or `ambiguous_staff` rows.
6. Collect selected `rowId` values and separate confirmation for each selected
   `conflict` row.
7. Apply once with all required headers. Do not send a reconstructed mutation
   payload.
8. On a lost response, retry the identical apply request with the same
   `Idempotency-Key`.
9. On stale or expired preview, restart from preview and request approval again.

## Task History Contract

Endpoint:

```http
GET /api/hermes/tasks/:id/history?limit=50
```

Rules:

- Enforce task visibility before loading history.
- Clamp `limit` to `50`.
- Return newest-first history unless implementation documents otherwise.

Response shape:

```json
{
  "success": true,
  "events": [
    {
      "id": "event_1",
      "type": "created",
      "actor": {
        "id": "user_2",
        "name": "Creator Name"
      },
      "at": "2026-06-27T07:00:00+03:00",
      "changes": {},
      "metadata": {}
    }
  ],
  "meta": {
    "newestFirst": true,
    "limit": 50
  }
}
```

## Menu Photo Contract

Hermes menu photo actions are limited to active kitchen menu products:

- `COALESCE(products.domain, 'program') = 'kitchen'`
- `products.kitchen_type = 'menu'`
- active products only
- hidden products are treated as not found

The applied/current photo remains `products.icon_url`. Generated results are
stored first as a draft under `products.ai_card_draft.imageStudio`; Hermes must
not directly overwrite `icon_url` during draft generation.

Draft statuses:

- `draft`
- `generating`
- `ready`
- `failed`
- `approved`
- `rejected`
- `applied`

Read endpoints:

```http
GET /api/hermes/menu-photos/candidates?limit=50&businessContext=event_genix
GET /api/hermes/menu-photos/:productId?businessContext=event_genix
```

Safe product response shape:

```json
{
  "success": true,
  "product": {
    "id": "menu-001",
    "code": "menu-001",
    "name": "Cheese plate",
    "businessContext": "event_genix",
    "currentImageUrl": "/uploads/catalog-images/items/current.png",
    "draft": {
      "status": "ready",
      "imageUrl": "/uploads/catalog-images/items/generated.png",
      "prompt": "Create one product catalog photo...",
      "provider": "openai",
      "model": "gpt-image-1-mini",
      "size": "1536x1024",
      "style": "catalog",
      "generatedAt": "2026-06-27T08:00:00.000Z",
      "approvedAt": null,
      "approvedBy": null,
      "appliedAt": null,
      "appliedBy": null,
      "rejectedAt": null,
      "rejectedBy": null,
      "previousImageUrl": "/uploads/catalog-images/items/current.png",
      "error": null
    },
    "crm_url": "https://crm.example.com/programs.html#kitchen-menu:menu-001"
  }
}
```

Menu photo mutation endpoints:

```http
POST /api/hermes/menu-photos/:productId/draft
POST /api/hermes/menu-photos/:productId/external-draft
POST /api/hermes/menu-photos/jobs
POST /api/hermes/menu-photos/:productId/apply
POST /api/hermes/menu-photos/:productId/reject
```

`draft` allowed body:

```json
{
  "size": "1536x1024",
  "style": "catalog"
}
```

`reject` allowed body:

```json
{
  "reason": "Wrong dish or plating"
}
```

`apply` accepts an empty JSON body. It succeeds only when the draft has an
`imageUrl` and status `ready`, `approved`, or `applied`.

`POST /api/hermes/menu-photos/jobs` creates up to five queued
`menu_photo_job` records for active kitchen menu products where `products.icon_url`
is empty and there is no ready/generating/applied menu photo draft. Existing
active menu photo jobs for the same product are skipped. The route creates
durable CRM jobs only; it does not generate, apply, publish, or require
Telegram delivery.

Menu photo mutations use the same Hermes auth, confirmation, idempotency, and
writable single-business-scope rules as task mutations. Draft generation may
return a controlled `failed` response if OpenAI or upload storage is
unavailable; the current applied image must remain unchanged in that case.

Hermes menu photo responses must not expose provider API keys, raw provider
responses, cookies, request headers, full product rows, kitchen tech notes, or
unfiltered request bodies.

## Mutation Contracts

All mutations must require:

- Valid Hermes auth.
- Valid actor user.
- Writable single business scope.
- `X-Hermes-User-Confirmed: true`.
- `Idempotency-Key`.
- If present, `X-Integration-Id` must equal `hermes-event-genix-crm`.

All mutations should attach source metadata:

- `sourceSurface: "hermes"`
- `source: "hermes-event-genix-crm"`
- `idempotencyKey`
- `source_type: "hermes"` where task source fields are used
- `source_module: "hermes"` where module source fields are used

The shared Hermes mutation guard rejects missing confirmation or idempotency
headers before route handlers run. CRM must not infer user confirmation from
natural language request text.

Hermes mutation endpoints must use the durable CRM idempotency store:

- Table: `integration_idempotency_keys`.
- Unique key: `(integration_id, idempotency_key)`.
- Default TTL: 48 hours.
- Request hash input: HTTP method, endpoint path, and JSON request body.
- Request hash must not include auth headers, cookies, API keys, or raw request
  headers.
- Same key plus same request returns the stored response.
- Same key plus different request returns `409 IDEMPOTENCY_KEY_CONFLICT`.
- In-progress duplicate requests return `409 IDEMPOTENCY_KEY_IN_PROGRESS`.

### Hermes Jobs Foundation

CRM is the source of truth for durable Hermes jobs. Hermes is a worker that can
claim jobs, report status, and return results. A human decision can approve,
reject, or request revision, but that decision does not auto-publish or
auto-apply generated output.

Supported job types:

- `menu_photo_job` - dish/menu photos.
- `creative_material_job` - posters, flyers, posts, stories, banners, and
  other marketing materials.

Supported job statuses:

```text
queued, claimed, in_progress, needs_input, ready_for_review,
revision_requested, approved, rejected, failed, cancelled
```

The two job types must stay separate. `menu_photo_job` payloads accept menu
product fields such as `productId`, `productCode`, `productName`, `prompt`,
`size`, `style`, and `imageRules`. `creative_material_job` payloads accept
creative brief fields such as `brief`, `materialTypes`, `platforms`,
`dimensions`, `copy`, `tone`, `eventTitle`, `brandRules`, and `requirements`.
Unsupported fields are rejected instead of being merged into a generic job
payload.

Queue menu photo jobs for products without photos:

```http
POST /api/hermes/menu-photos/jobs
```

```json
{
  "businessContext": "event_genix",
  "limit": 5
}
```

The route returns queued `menu_photo_job` items with sanitized worker payloads
and skips products that already have an active menu photo job. It never applies
images and never requires Telegram routing.

Create a job:

```http
POST /api/hermes/jobs
```

```json
{
  "jobType": "menu_photo_job",
  "businessContext": "event_genix",
  "title": "Generate menu photo",
  "sourceEntity": {
    "type": "product",
    "id": "dish-123"
  },
  "payload": {
    "productId": "dish-123",
    "productCode": "MENU-123",
    "productName": "Berry cake",
    "prompt": "Clean catalog-style dish photo",
    "size": "1536x1024",
    "style": "catalog",
    "imageRules": {
      "targetUsage": "booking_menu_catalog"
    }
  }
}
```

The response includes `job.hermes.payload`, a sanitized worker payload. It must
not include provider secrets, auth headers, raw CRM rows, customer data, or
unbounded request data.

Post status:

```http
POST /api/hermes/jobs/:id/status
```

```json
{
  "status": "in_progress",
  "message": "Worker started rendering",
  "externalEventId": "worker-status-1"
}
```

Post result and assets:

```http
POST /api/hermes/jobs/:id/result
```

```json
{
  "status": "ready_for_review",
  "summary": "Ready for human review",
  "externalEventId": "worker-result-1",
  "result": {
    "notes": "Generated primary option."
  },
  "assets": [
    {
      "externalAssetId": "poster-final-1",
      "assetType": "result",
      "role": "final",
      "url": "https://cdn.example.test/poster-final.png",
      "mimeType": "image/png"
    }
  ]
}
```

For `menu_photo_job`, a `ready_for_review` result must include a final image as
`result.imageUrl`, `result.imageBase64`, or a result asset URL. CRM stores that
image through the existing menu image draft storage path and updates only
`products.ai_card_draft.imageStudio` to a ready review draft. It does not update
`products.icon_url`; managers still use the existing product/menu image apply
or reject actions.

Record human decision:

```http
POST /api/hermes/jobs/:id/decision
```

```json
{
  "decision": "approved",
  "notes": "Approved by human reviewer",
  "externalDecisionId": "approval-1"
}
```

`approved` only records approval in the job foundation. Publishing, applying to
CRM entities, sending to channels, or replacing menu photos requires a separate
explicit CRM action.

CRM managers create and review creative-material jobs from the separate
Hermes Studio page at `/hermes-studio`. That page uses JWT-protected CRM
endpoints under `/api/hermes-studio` and always scopes records to
`creative_material_job`; it does not list or mutate `menu_photo_job` rows.

Hermes Studio accepts only brief-level fields: material type, title, source,
format/size, requirements, deadline, priority, references, and comment. The
worker still consumes the sanitized `job.hermes.payload` from the foundation.
Approve, request edit, regenerate, and reject are human actions that write
`hermes_job_decisions` and `hermes_job_events`; none of them auto-publish or
apply assets to Afisha, Designs, Content, products, or external channels.

### Create Task

Endpoint:

```http
POST /api/hermes/tasks
```

Allowed body:

```json
{
  "title": "Call client",
  "description": "Call and confirm booking details.",
  "date": "2026-06-30",
  "due_at": "2026-06-30T12:00:00+03:00",
  "priority": "normal",
  "assignee": {
    "id": "8"
  },
  "businessContext": "event_genix",
  "labels": ["booking"],
  "subtasks": [
    {
      "title": "Check availability"
    }
  ]
}
```

The implementation must respect existing duplicate detection and owner
assignability rules.

Unsupported body fields are rejected instead of being forwarded into internal
task columns. Labels are accepted for the create response schema; persistent CRM
task label storage requires a separate task-labels data model.

### Complete Task

Endpoint:

```http
POST /api/hermes/tasks/:id/complete
```

Allowed body:

```json
{
  "reportId": 123
}
```

The implementation must preserve existing task completion errors, including:

- `TASK_REPORT_REQUIRED`
- `SUBTASKS_INCOMPLETE`
- `TASK_NOT_ACTIVE`

Implementation service: `services/taskExecution.completeTask`.
Action metadata must use `sourceSurface: "hermes"` and
`route: "hermes_task_complete"`.

### Reassign Task

Endpoint:

```http
POST /api/hermes/tasks/:id/reassign
```

Allowed body:

```json
{
  "ownerUserId": 123
}
```

The implementation must use existing owner assignability rules.

Implementation service: `services/taskExecution.reassignTaskOwner`.
Action metadata must use `sourceSurface: "hermes"` and
`route: "hermes_task_reassign"`.

### Reschedule Task

Endpoint:

```http
POST /api/hermes/tasks/:id/reschedule
```

Allowed body:

```json
{
  "deadline": "2026-06-30T12:00:00+03:00"
}
```

Implementation service: `services/taskExecution.rescheduleTask`.
Action metadata must use `sourceSurface: "hermes"` and
`route: "hermes_task_reschedule"`.

Alternative body:

```json
{
  "snoozeMinutes": 120
}
```

The implementation must use existing reschedule permissions and must reject
read-only business scopes.

## Idempotency

Hermes can retry `429` and `5xx` responses. CRM mutations must be safe under
retry.

Rules:

- `Idempotency-Key` is required for all mutations.
- Same integration id plus same idempotency key plus same request should return
  the stored response.
- Same integration id plus same idempotency key plus different request should
  return `409 IDEMPOTENCY_KEY_CONFLICT`.
- Stored idempotency records should expire after a bounded period, for example
  24 to 72 hours.
- Do not store secrets or raw auth headers in idempotency records.

If implementation requires a new table, it must use a governed SQL migration
and follow `DB_MIGRATION_GOVERNANCE.md`.

## Rate Limits And Reliability

CRM-side limits:

- Max task list page: `50` items.
- Hermes route-level rate limit: about `60` requests per minute per source.
- `429` responses include `Retry-After` so Hermes can back off predictably.
- Recommended Hermes request timeout: `30` seconds.
- Recommended client-side rate limit: `60` requests per minute.
- Task list response target: `<= 256 KB`.
- Task detail response target: `<= 1 MB`.
- Task detail does not include action history by default. Hermes must call
  `/api/hermes/tasks/:id/history` explicitly, and that endpoint is also clamped
  to `50` events.

Hermes retry policy:

- `401`: do not retry repeatedly; report invalid or expired CRM key.
- `403`: do not retry; report permission or scope issue.
- `404`: do not retry for the same resource.
- `409`: fetch latest state and ask for user confirmation before another
  mutation attempt.
- `429`: retry only after `Retry-After` when present.
- `5xx`: retry with exponential backoff, max 3 attempts.

## Error Shape

Hermes endpoints should return a consistent JSON error shape:

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "meta": {}
}
```

Preferred status/code mapping:

| Status | Code examples | Meaning |
| --- | --- | --- |
| `400` | `INVALID_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `HERMES_CONFIRMATION_REQUIRED` | Request shape or safety gate failed |
| `401` | `HERMES_AUTH_REQUIRED`, `HERMES_AUTH_INVALID` | Missing or invalid integration secret |
| `403` | `HERMES_ACTOR_FORBIDDEN`, `BUSINESS_SCOPE_UNAVAILABLE` | Actor or scope is not allowed |
| `404` | `TASK_NOT_FOUND` | Task is missing or hidden |
| `409` | `TASK_DUPLICATE_ACTIVE`, `TASK_NOT_ACTIVE`, `TASK_STALE_WRITE`, `IDEMPOTENCY_KEY_CONFLICT` | Conflict or guarded workflow state |
| `429` | `HERMES_RATE_LIMITED` | Too many requests |
| `500` | `HERMES_INTERNAL_ERROR` | Unexpected server failure |

Hidden tasks should normally return `404` instead of leaking existence.
Endpoint-specific details such as duplicate task ids or retry metadata should
be returned in `meta`, not as extra top-level error fields.

## Status Mapping

Hermes should receive a stable, simple status while CRM raw status remains
available in metadata.

| CRM status | Hermes status |
| --- | --- |
| `todo` | `open` |
| `in_progress` | `in_progress` |
| `done` | `done` |
| `archived` | `archived` |
| `cancelled` | `cancelled` |
| other/empty | `open` |

## Logging And Redaction

The implementation must never log raw secrets.

Always redact:

- `x-api-key`
- `Authorization`
- cookies
- webhook secrets
- API keys and tokens in request metadata

Hermes mutation logs should include:

- integration id
- route/action
- status code
- latency
- actor username or id
- idempotency key hash or short fingerprint, not the raw key

`middleware/apiAudit.js` records mutating Hermes requests in `user_action_log`
after the response finishes. Audit metadata must stay header/body-light: include
the integration id, endpoint, status, latency, action type, auth mode, actor id,
and idempotency key fingerprint only. Do not store raw request headers, request
body, API keys, bearer tokens, cookies, client phone, or client email.

Avoid logging client phone or email in Hermes debug receipts unless a later
privacy review approves that data.

## Rollout Plan

Recommended operational rollout:

1. Run focused Hermes route tests and auth/API surface checks.
2. Smoke test `capabilities`, task list, task detail, and history.
3. Smoke test create, complete, reassign, and reschedule only on clearly
   marked test tasks.
4. Enable production secrets and Hermes local config through secure storage.

Do not deploy or configure production secrets without explicit owner approval.

## Verification Expectations

Implementation work should run the smallest relevant checks first:

```bash
npm run check:runtime
npm run check:auth-boundary
npm run check:api-surface
npm run check:migrations
npm run check:syntax
node --test tests/<focused-hermes-test>.test.js
npm test
```

`npm run check:migrations` is required only when an idempotency migration or
other schema change is added.
