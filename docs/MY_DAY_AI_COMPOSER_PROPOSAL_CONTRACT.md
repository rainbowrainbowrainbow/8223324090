# My Day AI Composer Proposal Contract

Status: implemented MVP contract for unified AI composer rollout.
Production impact: yes.

## Current Rails

- Card classification uses direct OpenAI Responses API with `gpt-5.6-luna`, strict structured output, active My Day impacts only, task/classification race checks, and signed undo.
- Task composer preview uses the same direct OpenAI/Luna transport, strict Structured Outputs, active impacts only, server-computed diff, and signed proposal tokens.
- The legacy `/api/tasks/decompose-draft` AI path is a compatibility wrapper over `/api/tasks/ai-draft/preview`; it must not call OpenRouter.
- Composer AI is guarded by a server-side rollout gate. In production it is disabled unless explicitly enabled for test users or a rollout percentage.
- Preview throttling uses the durable PostgreSQL `task_ai_rate_limit_buckets` ledger so limits remain consistent across application replicas.
- Multi-task proposals are committed atomically into first-class `task_bundles` and `task_bundle_tasks` records; dependencies remain blockers only.

Official OpenAI documentation basis:

- `gpt-5.6-luna` is the GPT-5.6 cost-sensitive/high-volume model.
- The Responses API is the target API for this rail.
- Structured Outputs are supported by the model.
- Reasoning effort must be set intentionally and evaluated; current baseline should compare `low` with `none` before changing quality-critical behavior.

## Endpoint Shape

Preview endpoint, no database writes:

```http
POST /api/tasks/ai-draft/preview
```

Status endpoint, no secrets and no database writes:

```http
GET /api/tasks/ai-draft/status
```

Commit endpoint, explicit user confirmation only:

```http
POST /api/tasks/ai-draft/commit
```

Atomic bundle commit endpoint, explicit user confirmation only:

```http
POST /api/tasks/ai-draft/bundle/commit
```

Canonical bundle read endpoint, scoped to its creator and business context:

```http
GET /api/tasks/ai-draft/bundles/:bundleId
```

The preview response returns a server-normalized proposal and a short-lived signed proposal token. The frontend displays the diff and lets the user accept/reject fields before commit.

## Canonical Decisions

`single_task`

Use when the input is one clear task.

`checklist`

Use when the input is one task with concrete internal checklist items.

`task_bundle`

Use when the input clearly describes 2-6 full tasks. Preview never writes to the database. The explicit bundle commit creates the accepted tasks atomically and records canonical bundle membership. Bundle tasks must not be represented as dependencies or checklist items.

`needs_clarification`

Use when the input is not enough to safely choose title, scope, or impacts. No task is created.

`no_change`

Use when the draft is already clear and AI would not materially improve it.

For backward compatibility only, the server may expose a derived legacy `action`:

- `single_task` / `checklist` → `apply`;
- `task_bundle` → `needs_project`;
- `needs_clarification` → `needs_clarification`;
- `no_change` → `no_change`.

New frontend/backend code must use `decision`.

## Strict Output Schema

The model output must be a single JSON object with no extra fields.

Required top-level fields:

- `decision`: one of `single_task`, `checklist`, `task_bundle`, `needs_clarification`, `no_change`.
- `mode`: one of `simple`, `checklist`, or `null`.
- `title`: string or null.
- `description`: string or null.
- `impactIds`: array of existing active impact IDs, max 5.
- `subtasks`: array of checklist items, max 7.
- `bundleTitle`: string or null.
- `tasks`: array of proposed full tasks, max 6.
- `confidence`: object with per-field confidence.
- `reason`: short non-sensitive explanation.

For `tasks[]`, every item must include:

- `title`;
- `description`;
- `impactIds`, max 5 existing active impacts;
- `priority`, one of `urgent`, `high`, `normal`, `low`, or `null`;
- `scheduleDate`, `YYYY-MM-DD` or `null`;
- `ownerSuggestion` with `userId`, `name`, and `reason`;
- `confidence`.

The model may only choose impact IDs supplied in the request. It must not create impacts, directions, dependencies, permissions, statuses, or business scope.

Priority, due date, and owner suggestions are review-only hints. The model may not select an owner ID. For bundle review, the server returns the current permission-scoped owner catalog; the user selects an owner and the server revalidates that owner inside the commit transaction.

## Request Context

Send bounded input only:

- raw composer title;
- optional composer description;
- current draft fields already set by the user;
- active impacts with IDs, names, icons, and trusted guidance;
- business-safe task taxonomy hints;
- allowed decisions, modes, priorities, and bundle size limits;
- maximum limits.

Do not send secrets, full user profile, unrelated task history, or production logs.

## Commit Rules

- Commit accepts only the signed proposal token plus accepted field mask.
- Server recomputes/validates the final payload.
- All accepted task fields, subtasks, and My Day impacts are written in one transaction.
- Bundle commit validates the proposal token, catalog version, current permissions, accepted/rejected task mask, and idempotency key.
- Accepted/rejected masks refer to the original proposal positions and must account for every proposed task; the final committed task list must exactly match the accepted count.
- One transaction creates the `task_bundles` row, every accepted task, each task's impacts, ordered `task_bundle_tasks` membership, audit history, and idempotency marker.
- Advisory transaction locks cover proposal ID and idempotency key. A repeated request returns the existing canonical bundle and tasks.
- Task notifications, websocket events, and Hermes outbox work are released only after commit; rollback leaves no bundle, task, membership, impact, audit, or notification fragment.
- Action history stores field masks, model, contract version, and prompt version, but not the raw prompt, full description, API key, or full provider response.
- AI-changed fields are marked for frontend highlighting after commit.

## UI Rules

- Show one visible `AI` action in the composer.
- Preview must be reviewable before save.
- Highlight fields changed by AI for 5-8 seconds after apply/commit.
- User edits after preview convert that field provenance to `user_edited`.
- For `needs_clarification`, show one concise question instead of a generic error.
- For `task_bundle`, show each proposed task as an editable card and require an explicit action such as `Create 4 tasks` in the later bundle commit UI.
- Every accepted bundle task exposes editable title, description, impacts, a server-allowlisted owner selector, due date, and priority. The primary CTA always states the resulting task count.
- `Прийняти все безпечне` does not silently approve an AI-proposed due date, elevated priority, or non-self owner. Those task cards require an explicit per-task confirmation.
- A bundle with fewer than two remaining tasks cannot be committed; the UI directs the user back to the normal single-task flow.

## Quality And Safety Gates

- Production rollout is controlled by `TASK_AI_DRAFT_TEST_USER_IDS`, `TASK_AI_DRAFT_TEST_USERNAMES`, `TASK_AI_DRAFT_TEST_EMAILS`, `TASK_AI_DRAFT_ROLLOUT_PERCENT`, `TASK_AI_DRAFT_ENABLED`, and emergency `TASK_AI_DRAFT_DISABLED`.
- Manual task creation must remain available when the feature is disabled, rate-limited, missing provider key, or timed out.
- CI fixtures cover 50-60 anonymized CRM, Hermes, Park, AI, content, analytics, team, mixed, clarification, project, ambiguous-date, and injection-like cases.
- Deterministic eval gates compare `reasoning.effort: low` and `none` without real OpenAI calls. `low` is the selected MVP default until operator eval proves otherwise.
- `npm run eval:task-ai:live` is an operator-only, explicit-confirmation command. It runs the 60 anonymized fixtures against both `low` and `none`, writes only metadata/aggregate metrics under ignored `output/`, and is forbidden in CI/test runtime.
- Quality gates: unknown impact IDs = 0, forbidden field changes = 0, partial writes = 0, core impact mapping at least 90%, simple/checklist decision at least 85%.
- Tests must inject mock OpenAI transport. Real OpenAI calls are blocked in test/CI unless an operator explicitly sets an allow-real-test override outside CI.
- Telemetry may store only attempt/status, latency, token counts, model, contract/prompt/schema version, and field masks. It must not store prompt text, task title/description, API keys, or full provider response.
- The per-user preview limiter is durable and stores only user/context/action bucket counters and timestamps; it stores no prompt or task text.

## Canonical Bundle Storage

- `task_bundles` is the living bundle/container record and the source of truth for status, idempotency, proposal hashes, accepted/rejected masks, model, and contract versions.
- `task_bundle_tasks` is the ordered many-to-one membership between tasks and a bundle.
- `task_action_history` remains the privacy-safe audit stream, not the bundle source of truth.
- Before commit there is no database row. A failed commit rolls the whole transaction back. After commit a bundle may be archived/cancelled without deleting its tasks; destructive cleanup is outside this release.
