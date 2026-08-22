# Task AI legacy decompose-draft sunset audit — 2026-08-22

## Scope

Legacy endpoint:

- `POST /api/tasks/decompose-draft`

Canonical AI Composer endpoints:

- `POST /api/tasks/ai-draft/preview`
- `POST /api/tasks/ai-draft/commit`
- `POST /api/tasks/ai-draft/bundle/commit`

## Current production baseline

- Live version: `0.81.12`
- Live SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Stable marker: `codex/eventgenix-production`
- Historical rollback marker: `codex/checkbox-hardening-release-v080103`

## Repository findings

- `js/task-create.js` routes `ai` and `template_ai` decomposition requests through canonical `requestAiDraftPreview(...)`.
- `js/task-create.js` still calls `/tasks/decompose-draft` for non-AI decomposition modes.
- `routes/tasks.js` keeps `/api/tasks/decompose-draft` as a compatibility endpoint:
  - `ai` / `template_ai` delegate to canonical preview and record sanitized deprecation telemetry;
  - non-AI/template modes call `generateTaskDecompositionDraft(...)`.
- Tests intentionally verify the wrapper, telemetry redaction, and canonical AI-mode delegation.

## Usage evidence

Sanitized checks performed without saving raw logs:

- Structured `task_ai_draft_event` legacy deprecation telemetry:
  - 24h: `0`
  - 1w: `0`
  - 4w: `0`
- HTTP `POST /api/tasks/decompose-draft` events:
  - 24h: `0`
  - 1w: `0`
  - 4w: `0`

The evidence shows zero observed production usage in the inspected windows, but the route is still a repository consumer for non-AI/template decomposition behavior.

## Verdict

`HOLD_REMOVAL`

Do not remove `/api/tasks/decompose-draft` yet.

Reason: the primary AI Composer flow is canonical, but the endpoint still serves non-AI/template decomposition requests from `js/task-create.js`. Removing it safely requires either migrating that remaining consumer to a separate canonical non-AI/template endpoint or explicitly retiring the old decomposition UI behavior.

## Removal prerequisite

Before endpoint removal, obtain explicit operator confirmation with the no-usage artifact:

```text
Підтверджую видалення legacy /api/tasks/decompose-draft після no-usage evidence artifact <ARTIFACT>, з оновленням tests/docs/API inventory. Canonical /api/tasks/ai-draft/preview лишається єдиним AI Composer flow.
```

## Safe next step

Keep the thin wrapper and sunset marker for now. Prepare a separate small removal/migration task only after product confirmation for the remaining non-AI/template decomposition path.
