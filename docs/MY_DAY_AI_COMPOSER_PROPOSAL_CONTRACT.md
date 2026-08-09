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

## Canonical Actions

`apply`

Use when the task can be safely prepared as a normal task draft or checklist draft.

`needs_clarification`

Use when the input is not enough to safely choose title, scope, or impacts. No task is created.

`needs_project`

Use when the input describes a multi-task/project-sized plan. MVP must not auto-create a project. It may propose a checklist task or ask the user to confirm a future bundle flow.

`no_change`

Use when the draft is already clear and AI would not materially improve it.

## Strict Output Schema

The model output must be a single JSON object with no extra fields.

Required top-level fields:

- `action`: one of `apply`, `needs_clarification`, `needs_project`, `no_change`.
- `mode`: one of `simple`, `checklist`, or `null`.
- `title`: string or null.
- `description`: string or null.
- `impactIds`: array of existing active impact IDs, max 3.
- `subtasks`: array of checklist items, max 7.
- `confidence`: object with per-field confidence.
- `reason`: short non-sensitive explanation.

The model may only choose impact IDs supplied in the request. It must not create impacts, directions, dependencies, owners, permissions, statuses, priorities, deadlines, or business scope.

Priority and date may be suggested only later as human-review hints if explicitly present in the source text. They are excluded from this MVP contract.

## Request Context

Send bounded input only:

- raw composer title;
- optional composer description;
- current draft fields already set by the user;
- active impacts with IDs, names, icons, and trusted guidance;
- business-safe task taxonomy hints;
- maximum limits.

Do not send secrets, full user profile, unrelated task history, or production logs.

## Commit Rules

- Commit accepts only the signed proposal token plus accepted field mask.
- Server recomputes/validates the final payload.
- All accepted task fields, subtasks, and My Day impacts are written in one transaction.
- Action history stores field masks, model, contract version, and prompt version, but not the raw prompt, full description, API key, or full provider response.
- AI-changed fields are marked for frontend highlighting after commit.

## UI Rules

- Show one visible `AI` action in the composer.
- Preview must be reviewable before save.
- Highlight fields changed by AI for 5-8 seconds after apply/commit.
- User edits after preview convert that field provenance to `user_edited`.
- For `needs_clarification`, show one concise question instead of a generic error.
- For `needs_project`, show that this is bigger than one task and offer a checklist MVP path first.

## Quality And Safety Gates

- Production rollout is controlled by `TASK_AI_DRAFT_TEST_USER_IDS`, `TASK_AI_DRAFT_TEST_USERNAMES`, `TASK_AI_DRAFT_TEST_EMAILS`, `TASK_AI_DRAFT_ROLLOUT_PERCENT`, `TASK_AI_DRAFT_ENABLED`, and emergency `TASK_AI_DRAFT_DISABLED`.
- Manual task creation must remain available when the feature is disabled, rate-limited, missing provider key, or timed out.
- CI fixtures cover 50-60 anonymized CRM, Hermes, Park, AI, content, analytics, team, mixed, clarification, project, ambiguous-date, and injection-like cases.
- Deterministic eval gates compare `reasoning.effort: low` and `none` without real OpenAI calls. `low` is the selected MVP default until operator eval proves otherwise.
- Quality gates: unknown impact IDs = 0, forbidden field changes = 0, partial writes = 0, core impact mapping at least 90%, simple/checklist decision at least 85%.
- Tests must inject mock OpenAI transport. Real OpenAI calls are blocked in test/CI unless an operator explicitly sets an allow-real-test override outside CI.
- Telemetry may store only attempt/status, latency, token counts, model, contract/prompt/schema version, and field masks. It must not store prompt text, task title/description, API keys, or full provider response.
- Current per-user preview limiter is in-process. Before multi-replica rollout, replace or supplement it with a durable existing limiter or an explicitly approved additive PostgreSQL usage ledger migration.
