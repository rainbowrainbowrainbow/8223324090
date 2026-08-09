# My Day AI Composer Proposal Contract

Status: implemented MVP contract for unified AI composer rollout.
Production impact: yes.

## Current Rails

- Card classification uses direct OpenAI Responses API with `gpt-5.6-luna`, strict structured output, active My Day impacts only, task/classification race checks, and signed undo.
- Task composer preview uses the same direct OpenAI/Luna transport, strict Structured Outputs, active impacts only, server-computed diff, and signed proposal tokens.
- The legacy `/api/tasks/decompose-draft` AI path is a compatibility wrapper over `/api/tasks/ai-draft/preview`; it must not call OpenRouter.
- Composer AI is guarded by a server-side rollout gate. In production it is disabled unless explicitly enabled for test users or a rollout percentage.

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

The preview response returns a server-normalized proposal and a short-lived signed proposal token. The frontend displays the diff and lets the user accept/reject fields before commit.

## Canonical Decisions

`single_task`

Use when the input is one clear task.

`checklist`

Use when the input is one task with concrete internal checklist items.

`task_bundle`

Use when the input clearly describes 2-6 full tasks. This is a preview-only decision in this release: no tasks are created until a later explicit bundle commit flow. Bundle tasks must not be represented as dependencies or checklist items.

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
- `impactIds`: array of existing active impact IDs, max 3.
- `subtasks`: array of checklist items, max 7.
- `bundleTitle`: string or null.
- `tasks`: array of proposed full tasks, max 6.
- `confidence`: object with per-field confidence.
- `reason`: short non-sensitive explanation.

For `tasks[]`, every item must include:

- `title`;
- `description`;
- `impactIds`, max 3 existing active impacts;
- `priority`, one of `urgent`, `high`, `normal`, `low`, or `null`;
- `dueDate`, `YYYY-MM-DD` or `null`;
- `ownerSuggestion` with `userId`, `name`, and `reason`;
- `confidence`.

The model may only choose impact IDs supplied in the request. It must not create impacts, directions, dependencies, permissions, statuses, or business scope.

Priority, due date, and owner suggestions are review-only hints. They are not applied without explicit human review/confirmation.

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
- `task_bundle` commit is intentionally out of scope for the current preview task and must be implemented separately as atomic batch create.
- Action history stores field masks, model, contract version, and prompt version, but not the raw prompt, full description, API key, or full provider response.
- AI-changed fields are marked for frontend highlighting after commit.

## UI Rules

- Show one visible `AI` action in the composer.
- Preview must be reviewable before save.
- Highlight fields changed by AI for 5-8 seconds after apply/commit.
- User edits after preview convert that field provenance to `user_edited`.
- For `needs_clarification`, show one concise question instead of a generic error.
- For `task_bundle`, show each proposed task as an editable card and require an explicit action such as `Create 4 tasks` in the later bundle commit UI.

## Quality And Safety Gates

- Production rollout is controlled by `TASK_AI_DRAFT_TEST_USER_IDS`, `TASK_AI_DRAFT_TEST_USERNAMES`, `TASK_AI_DRAFT_TEST_EMAILS`, `TASK_AI_DRAFT_ROLLOUT_PERCENT`, `TASK_AI_DRAFT_ENABLED`, and emergency `TASK_AI_DRAFT_DISABLED`.
- Manual task creation must remain available when the feature is disabled, rate-limited, missing provider key, or timed out.
- CI fixtures cover 50-60 anonymized CRM, Hermes, Park, AI, content, analytics, team, mixed, clarification, project, ambiguous-date, and injection-like cases.
- Deterministic eval gates compare `reasoning.effort: low` and `none` without real OpenAI calls. `low` is the selected MVP default until operator eval proves otherwise.
- Quality gates: unknown impact IDs = 0, forbidden field changes = 0, partial writes = 0, core impact mapping at least 90%, simple/checklist decision at least 85%.
- Tests must inject mock OpenAI transport. Real OpenAI calls are blocked in test/CI unless an operator explicitly sets an allow-real-test override outside CI.
- Telemetry may store only attempt/status, latency, token counts, model, contract/prompt/schema version, and field masks. It must not store prompt text, task title/description, API keys, or full provider response.
- Current per-user preview limiter is in-process. Before multi-replica rollout, replace or supplement it with a durable existing limiter or an explicitly approved additive PostgreSQL usage ledger migration.
