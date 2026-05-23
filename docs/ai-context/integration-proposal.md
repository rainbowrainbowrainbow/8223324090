# Integration Proposal: Expose AI Context Knowledge Base Safely

## Current Assistant Integration Points

Source evidence:

- `routes/crm-assistant.js` exposes shared assistant endpoints:
  - `POST /api/crm-assistant/reply`
  - `POST /api/crm-assistant/telemetry`
  - `POST /api/crm-assistant/transcribe`
  - `POST /api/crm-assistant/speak`
- `routes/dashboard-assistant.js` is a legacy alias for `routes/crm-assistant.js`.
- `services/dashboardAssistant.js` loads `prompts/crm-assistant-system.md` and uses `js/crm-feature-registry.js` for feature-location questions.
- `prompts/crm-assistant-system.md` already instructs the assistant to consider page, role, active view/tab, and visible CRM signals.
- `js/crm-feature-registry.js` is a lightweight route/action registry used by browser search and server-side assistant logic.

## Minimal Safe Integration

Recommended first production step after confirmation:

1. Add a read-only server helper such as `services/aiProductContext.js`.
2. It should load selected markdown files from `docs/ai-context/` by route/entity key.
3. In `services/dashboardAssistant.js`, after context compaction, attach only a small relevant excerpt:
   - current page doc summary;
   - selected entity doc summary when provided;
   - one workflow doc when the user intent matches a workflow;
   - no full-directory dump.
4. Keep the feature locator as the route/action source of truth.
5. Add a focused unit test that `/customers` + "дзвінок" selects:
   - `pages/client.md`
   - `entities/call.md`
   - `workflows/client-call-flow.md`

## Non-Invasive Changes Allowed Without Extra Product Risk

- Add or update docs.
- Add comments/TODOs.
- Add read-only helper utilities if explicitly approved.
- Add tests for context selection if an existing test pattern is used.

## Changes Requiring Confirmation

- Changing assistant prompt behavior in production.
- Adding dependencies.
- Adding vector/RAG infrastructure.
- Modifying database schema.
- Changing auth/permissions.
- Changing API contracts.
- Sending user screen data to new external services.

## First Integration Target

The highest-impact first target is Client/Call context:

- current route `/customers`;
- selected customer id from query/hash/modal state if available;
- user terms: `дзвінок`, `call`, `подзвонити`, `комунікація`, `CRM-журнал`;
- docs:
  - `pages/client.md`
  - `entities/call.md`
  - `workflows/client-call-flow.md`

## Open Risk

The docs are source-derived but not yet wired into runtime. Until integration is approved, assistants can only use them if their retrieval/prompt layer explicitly loads this directory.
