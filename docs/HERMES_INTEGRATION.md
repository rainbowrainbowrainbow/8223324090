# Hermes Integration Contract

This document defines the CRM-side contract for the Hermes task and menu photo
integration. The `/api/hermes/capabilities` endpoint, read-only task endpoints,
task create, complete, reassign, and reschedule endpoints are implemented for
v1. Menu/product photo draft, apply, and reject endpoints are implemented as a
safe MVP workflow.

## Scope

Hermes v1 is a pull/read/action integration for Event Genix CRM tasks and
reviewable kitchen menu/product photo drafts.

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
- Apply or reject a ready menu/product photo draft after Hermes-side user
  confirmation.

The integration must not expose generic CRM access, raw database rows, delete
operations, bulk operations, auth/session management, finance actions, admin
actions, unrestricted task updates, provider secrets, raw image provider
responses, or unconfirmed bulk photo generation.

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

All endpoints live under `/api/hermes`; v1 task action endpoints and menu photo
draft endpoints are implemented.

| Method | Path | Purpose | Mutation |
| --- | --- | --- | --- |
| `GET` | `/api/hermes/capabilities` | Integration discovery and limits | No |
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
| `POST` | `/api/hermes/menu-photos/:productId/apply` | Apply a ready photo draft | Yes |
| `POST` | `/api/hermes/menu-photos/:productId/reject` | Reject a photo draft | Yes |

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
HERMES_API_KEY=<server-side-secret>
HERMES_ACTOR_USER_ID=<crm-user-id>
HERMES_ALLOWED_BUSINESS_CONTEXTS=<optional-comma-list>
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
    "tasks.create",
    "tasks.complete",
    "tasks.reassign",
    "tasks.reschedule",
    "menu_photos.read",
    "menu_photos.candidates",
    "menu_photos.draft",
    "menu_photos.apply",
    "menu_photos.reject"
  ],
  "mutationActionsAvailable": true,
  "plannedMutationActions": [],
  "webhooks": {
    "crmToHermesEnabled": false
  }
}
```

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
