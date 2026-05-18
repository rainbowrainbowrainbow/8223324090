# CRM Assistant Master Roadmap

**Priority:** HIGH  
**Date:** 2026-05-18  
**Main release target:** `v0.56.0`  
**Type:** master plan, phased execution, post-release roadmap

This is the canonical roadmap for the Event Genix CRM assistant program. It is not a single giant implementation task. Use it as the sequence map for launching phase-specific tasks and for keeping the assistant work from turning into unstructured cross-file churn.

## Current Release Reality

As of 2026-05-18, the first flagship assistant release has shipped as:

- `v0.56.0 — AI Assistant: флагманський провідник`
- Git commit: `c79b14c0 v0.56.0: finalize assistant flagship release`
- Core pages covered: dashboard, tasks, finance, chat, leads
- Live smoke passed against `https://8223324090-production.up.railway.app`

The roadmap below remains useful as the source of truth for what was built, why it was phased, and what should happen after release.

## Big Goal

Build a flagship assistant layer inside Event Genix CRM that:

- lives in the shared assistant rail;
- is page-aware and role-aware;
- is grounded in real CRM signals;
- can advise, guide, teach, and act safely;
- supports voice/text UX;
- can highlight the right controls honestly;
- helps briefly, strongly, and operationally;
- feels like a premium in-product AI guide, not a decorative chatbot.

## Principles

- Reuse, extend, and refactor before rewriting.
- Build in phases; do not merge foundation, intelligence, polish, and release work into one unsafe diff.
- Core pages are more important than broad but shallow coverage.
- Honest fallback is better than fake precision.
- Role/session truth must come from canonical auth/session state.
- Assistant actions must wrap existing safe handlers rather than inventing fake UI capabilities.
- Guided teaching must target stable selectors or fail gracefully.

## Phase 0 — Analysis First

**Status:** completed.

### Goal

Understand the real codebase before implementation:

- what already exists;
- what is canonical;
- what is legacy;
- what can be reused;
- what should be rewritten;
- where the main risks are.

### Findings

- The real CRM repo lives outside the old docs workspace assumptions.
- A global shared assistant rail already existed.
- Backend assistant endpoints already existed: `/reply`, `/transcribe`, `/speak`.
- Role truth already existed in backend/session flow.
- Work queue, tasks, finance, leads, and chat already had reusable patterns.
- Dashboard had legacy assistant ambiguity.
- Teaching/highlighting needed a stable target contract.

### Result

The original giant flagship task was split into smaller safe phases.

## Phase 1 — Foundation Contracts

**Status:** completed.

### Goal

Create the canonical assistant system foundation.

### Scope

- Compact shared assistant store.
- Page adapter contract.
- Thin shared action registry.
- Assistant-safe teaching target contract.
- Reply schema normalization.
- Dashboard legacy delegation into the canonical shared path.
- Provider/config boundary clarification.

### Out Of Scope

- Premium avatar overhaul.
- Deep page intelligence.
- Broad teaching flows.
- Strategic advisor depth.
- Release/deploy.

### Result

The assistant stopped being scattered page logic and became a contract-driven shared system.

## Phase 2 — Intelligence Adapters + Action Proposal UI

**Status:** completed.

### Goal

Make the assistant materially useful on core pages through data-backed adapters.

### Scope

- Dashboard/work queue adapter.
- Tasks adapter.
- Finance adapter.
- Leads/chat adapter.
- Action proposal UI in the rail panel.
- Single-step and short-sequence guided teaching runner.
- Better grounding through real API-backed signals.

### Result

The assistant can see bottlenecks, suggest next actions, guide users to relevant controls, and give practical grounded help on core pages.

## Phase 3 — Premium Voice UX + Strategic Polish

**Status:** completed.

### Goal

Raise the assistant from useful foundation tool to stronger premium experience.

### Scope

- Replay and interruption polish.
- Subtitle/ticker readability.
- Calm premium presence states.
- Stronger strategic guide quality.
- Smoother guided teaching behavior.
- Better action proposal presentation.

### Result

The assistant is shorter, calmer, more dependable in voice/text mode, and more strategic in its guidance.

## Phase 4 — Flagship Integration + Release

**Status:** completed and deployed.

### Goal

Unify Phases 1-3 into a deployable `v0.56.0` flagship assistant release.

### Scope

- Cross-phase integration cleanup.
- Core-page hardening for dashboard, tasks, finance, chat, and leads.
- Strategic advisor production pass.
- Guided teaching finalization.
- Voice/text release hardening.
- Release label/changelog/version surface alignment.
- GitHub push, Railway deployment, smoke checks.

### Required Core Pages

- Dashboard.
- Tasks.
- Finance.
- Chat.
- Leads.

### Result

`v0.56.0` honestly ships as the first flagship CRM assistant layer:

- one shared assistant rail;
- one foundation store/adapter/action/target/reply-schema model;
- API-backed intelligence on core pages;
- visible action proposals;
- guided teaching flows;
- voice/text UX;
- role-aware strategic framing;
- honest fallback when data, actions, or targets are limited.

## What Counts As The `v0.56.0` Flagship Release

The release is considered honest only if the assistant:

- is coherent across all previous phase outputs;
- is useful on dashboard, tasks, finance, chat, and leads;
- gives grounded, short, strong replies;
- has a real actionability path;
- can teach/highlight without fake target precision;
- has stable voice/text behavior;
- preserves honest fallback;
- passes smoke and release verification.

For `v0.56.0`, these gates were satisfied through local verification, GitHub CI, Railway status check, live version smoke, live health check, and static core-page smoke.

## Post-Release Roadmap

After Phase 4, do not run another giant assistant phase. Use smaller post-release tracks.

### Post-Release A — Hardening

Collect and fix:

- bugs;
- regressions;
- weak voice/highlight/advice moments;
- real user friction;
- failed API snapshot or playback cases.

Goal: remove cracks without chaotic feature creep.

### Post-Release B — Coverage Expansion

Expand the strong assistant experience to secondary or partially covered modules:

- staff / hr;
- customers;
- warehouse;
- optional pages not included in the core flagship release.

Goal: extend quality coverage after core pages are stable.

### Post-Release C — Advisor Depth + Memory

Deepen assistant capability in:

- longer workflows;
- pattern recognition;
- history-aware guidance;
- strategic managerial assistance;
- richer context and memory.

Goal: make the assistant better at multi-step operational reasoning.

### Post-Release D — Provider / Config Unification

Clean up the broader AI provider landscape:

- direct OpenAI usage;
- OpenRouter surfaces;
- Kleshnya/Copilot-adjacent paths;
- unrelated AI workflows.

Goal: less provider sprawl, clearer ownership, safer operational behavior.

## Recommended Execution Order

1. Phase 0 — analysis-first.
2. Phase 1 — foundation contracts.
3. Phase 2 — intelligence adapters + action proposal UI.
4. Phase 3 — premium voice UX + strategic polish.
5. Phase 4 — flagship integration + release.
6. Post-Release A — hardening.
7. Post-Release B — coverage expansion.
8. Post-Release C — advisor depth + memory.
9. Post-Release D — provider/config unification.

## Assistant Role Contract

The assistant should:

- help users on any CRM page;
- briefly explain what they see;
- recommend the strongest next action;
- stay page-aware and role-aware;
- sound alive but concise;
- behave like an operator, not a chatterbox.

### Response Rules

- Use 1-3 short paragraphs maximum.
- Proactive help is one short useful offer.
- Dashboard: widgets, priorities, bottlenecks.
- Tasks: overdue, owner, deadline, next action.
- Chat: waiting reply, unresolved conversation.
- Finance: sums, risks, control, P&L.
- Staff/HR: people, schedule, conflicts, HR tasks.
- Customers/leads: status, follow-up, next communication.
- Warehouse: stock, low inventory, movement history.
- Director: P&L, risks, control points.
- Manager: leads, tasks, team, bookings.
- HR: personnel and scheduling.
- Art director: content/catalog/production pipeline.
- Creator: whole-system visibility and scenario checking.
- Do not invent CRM functions that do not exist.
- Ask one short clarification only when context is truly insufficient.

## Related Phase Task Files

These phase files may live in external task/docs workspace history rather than this repo. Treat this roadmap as the current canonical overview.

- `TASK-crm-flagship-ai-assistant-analysis-first-v0.55.45.md`
- `TASK-crm-assistant-foundation-contracts-v0.56.0.md`
- `TASK-crm-assistant-intelligence-adapters-v0.56.0.md`
- `TASK-crm-assistant-premium-voice-strategic-polish-v0.56.0.md`
- `TASK-crm-assistant-flagship-integration-release-v0.56.0.md`

## Definition Of Done

This roadmap is done when:

- the full assistant sequence is understandable in one place;
- phase boundaries are clear;
- release target and post-release path are clear;
- future work can reference this file instead of recreating context from scattered task notes.
