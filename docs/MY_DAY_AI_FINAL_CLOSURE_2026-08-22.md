# My Day AI closure — v0.81.14 evidence

## Current production closeout candidate — v0.81.19

Status: prepared as a final closure patch after `v0.81.18` with no rollout
variable changes.

- Candidate branch: `codex/my-day-ai-final-closure-0.81.19`.
- Previous live version/SHA: `0.81.18` / `bb272963291d71b64a27c93758fee900c7b657d6`.
- Source branch remains: `codex/eventgenix-production`.
- Included candidate commits:
  - rollout telemetry evidence hardening;
  - legacy `/api/tasks/decompose-draft` sunset evidence tooling;
  - CI guard against runtime frontend legacy callers;
  - updated operator documentation.
- Legacy endpoint status: `HOLD_REMOVAL`; no internal runtime caller exists, but
  removal still requires a complete no-usage evidence window and explicit
  operator confirmation.
- Rollout status: unchanged by this release. Single/checklist and bundle stages
  require independent PASS artifacts before any Railway variable change.
- Latest legacy usage artifact: `output/task-ai-legacy-decompose/2026-08-24T10-legacy-decompose-v08118.md`.

This patch does not change prompt, schema, model, reasoning effort, Railway
variables, secrets, or database schema.

---

Status: reconciled into production source after the `v0.81.15` Hermes release.
This is an evidence-only closeout; it does not change rollout values or require a
separate runtime deployment.

## Live baseline before this closure

- Live version: `0.81.13`.
- Live SHA: `d10a1c548c9b3e7473e058b9c8b1ece74f70eff6`.
- Source branch: `codex/eventgenix-production`.
- Rollback marker: `codex/checkbox-hardening-release-v080103` at `a990b668f60e6376439e80cef0a3ade7672dfe37`.
- Deployment manifest: complete.
- Health/deep: ok.
- Single/checklist rollout: 20%.
- Bundle rollout: 10%.
- Provider/model: OpenAI `gpt-5.6-luna`.
- Reasoning effort: `low`.
- Prompt version: `2026-08-13.6`.
- Contract version: `my_day_ai_composer_proposal_v2`.

## Closed

- Internal runtime callers use the canonical AI preview/commit contract.
- Deterministic task decomposition is isolated from the legacy AI compatibility route.
- Production marker migration to `codex/eventgenix-production` is live and proven by `/api/version`.
- Exact-SHA production mutation smoke passed for `v0.81.13`:
  - Luna preview and commit;
  - simple task;
  - checklist;
  - bundle;
  - schedule to My Day projection;
  - idempotent replay;
  - rapid bundle commit replay;
  - global timer start/hydrate/stop;
  - exact QA task IDs archived after the run.
- Rollout evidence tooling distinguishes insufficient traffic from telemetry gaps.
- Legacy `/api/tasks/decompose-draft` usage evidence is redacted and measured.

## Evidence artifacts

- Baseline: `output/my-day-ai-baseline-v08113-2026-08-22.md`.
- Production mutation smoke PASS: `output/live-my-day-ai-mutation-smoke/EGX_MY_DAY_AI_QA_v08113_20260822T151956.json`.
- Single/checklist rollout 20%: `output/task-ai-rollout/2026-08-22T12-21-53-418Z.md`.
- Bundle rollout 10%: `output/task-ai-bundle-rollout/2026-08-22T12-23-08-661Z.md`.
- Legacy route sunset evidence: `output/task-ai-legacy-decompose-sunset-v08113-2026-08-22.md`.

## Current HOLD items

- Single/checklist rollout remains `HOLD_INSUFFICIENT_TRAFFIC`.
  - The exact-SHA report saw real preview traffic, but only 4 preview attempts and 3 successful actionable proposals.
  - Rollout must stay at 20% until an independent PASS artifact exists.
- Bundle rollout remains `HOLD_INSUFFICIENT_TRAFFIC`.
  - The exact-SHA report saw one bundle preview attempt and one successful proposal.
  - Bundle rollout must stay at 10% until an independent PASS artifact exists.
- Legacy `/api/tasks/decompose-draft` remains `HOLD_REMOVAL`.
  - Internal runtime callers are gone.
  - Observed legacy usage is zero in the checked logs.
  - Removal still requires a complete agreed no-usage window and explicit operator confirmation.

## Data safety

No task title, description, prompt body, provider response, credentials, API key,
bearer token, signed proposal token, or raw production logs belongs in release
or evidence artifacts.

## Next allowed actions

- Repeat rollout evidence after enough real AI Composer traffic or a 24h exact-deployment window with real preview attempts.
- Request a specific Railway rollout confirmation only after a PASS artifact.
- Remove the legacy route only after the no-usage gate and explicit removal confirmation.
