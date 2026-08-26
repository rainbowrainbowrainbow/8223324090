# My Day AI closure — current evidence

## Current production evidence refresh — v0.81.27

Status: `MONITORING_HOLD`.

- Live version/SHA: `0.81.27` / `88138e98fa31411923e6ec387af7aa155d25b711`.
- Source branch: `codex/eventgenix-production`.
- Deployment ID: `80613a91-b3ac-446c-9b66-aa5823559f83`.
- Deployment start: `2026-08-26T13:57:25.311Z`.
- Rollout unchanged:
  - single/checklist: `20%`;
  - bundle: `10%`.
- Read-only database evidence is now available through the local
  `TASK_AI_ROLLOUT_DATABASE_URL` operator secret. The audit session verified
  `BEGIN READ ONLY`, `transaction_read_only=on`,
  `default_transaction_read_only=on`, and zero persistent write grants on CRM
  tables for the audit role.
- Rollout evidence is not PASS:
  - single/checklist latest report has `0` preview attempts and remains
    `HOLD_INSUFFICIENT_TRAFFIC`;
  - bundle latest report has `0` preview attempts and remains
    `HOLD_INSUFFICIENT_TRAFFIC`.
- The collectors did not classify the current evidence as `TELEMETRY_GAP`:
  - HTTP evidence was available and showed `0` matching requests for both
    scopes;
  - structured preview logs were absent for the current exact deployment
    because no preview traffic was observed.
- Legacy endpoint status: `HOLD_REMOVAL`; internal runtime callers are absent,
  observed real usage is `0`, but removal still requires a complete no-usage
  evidence window and explicit operator confirmation.

This evidence refresh does not change prompt, schema, model, reasoning effort,
Railway variables, rollout percentages, legacy endpoint code, or database
schema. No patch release or deploy was performed.

## Current v0.81.27 evidence artifacts

- Single/checklist rollout 20%:
  - `output/task-ai-rollout/task25-v08127-single.md`;
  - verdict: `HOLD_INSUFFICIENT_TRAFFIC`.
- Bundle rollout 10%:
  - `output/task-ai-bundle-rollout/task25-v08127-bundle.md`;
  - verdict: `HOLD_INSUFFICIENT_TRAFFIC`.
- Legacy route sunset evidence:
  - `output/task-ai-legacy-decompose/task25-v08127-legacy-decompose.md`;
  - verdict: `HOLD_REMOVAL`.

These artifacts are redacted. They must not contain task text, prompts, provider
responses, credentials, proposal tokens, API keys, bearer tokens, or raw Railway
logs.

---

Historical section below documents the earlier `v0.81.24` evidence refresh. It
is kept as release history, not as the current production source of truth.

## Current production evidence refresh — v0.81.24

Status: `MONITORING_HOLD`.

- Live version/SHA: `0.81.24` / `4734838db3b0c05923669b6381f9a7159e4e6f3e`.
- Source branch: `codex/eventgenix-production`.
- Deployment ID: `dca62851-2c49-4a9e-8690-63acbcb1ddd7`.
- Deployment start: `2026-08-26T10:57:16.621Z`.
- Rollout unchanged:
  - single/checklist: `20%`;
  - bundle: `10%`.
- Rollout evidence is not PASS:
  - single/checklist latest report has `0` preview attempts and remains `HOLD_INSUFFICIENT_TRAFFIC`;
  - bundle latest report has `0` preview attempts and remains `HOLD_INSUFFICIENT_TRAFFIC`.
- The collectors did not classify the current evidence as `TELEMETRY_GAP`:
  - HTTP evidence was available and showed `0` matching requests for both scopes;
  - structured preview logs were absent for the current exact deployment because no preview traffic was observed.
- Read-only database rollout evidence was not included because `TASK_AI_ROLLOUT_DATABASE_URL`
  was not present in the process environment or the local operator secrets file. `DATABASE_URL`
  was intentionally not used as a fallback.
- Legacy endpoint status: `HOLD_REMOVAL`; internal runtime callers are absent,
  observed real usage is `0`, but removal still requires a complete no-usage
  evidence window and explicit operator confirmation.

This evidence refresh does not change prompt, schema, model, reasoning effort,
Railway variables, secrets, rollout percentages, legacy endpoint code, or database schema.

## Current v0.81.24 evidence artifacts

- Single/checklist rollout 20%:
  - `output/task-ai-rollout/2026-08-26T11-02-50-557Z-single-v08124.md`;
  - verdict: `HOLD_INSUFFICIENT_TRAFFIC`.
- Bundle rollout 10%:
  - `output/task-ai-bundle-rollout/2026-08-26T11-02-50-557Z-bundle-v08124.md`;
  - verdict: `HOLD_INSUFFICIENT_TRAFFIC`.
- Legacy route sunset evidence:
  - `output/task-ai-legacy-decompose/2026-08-26T11-02-50-557Z-legacy-decompose-v08124.md`;
  - verdict: `HOLD_REMOVAL`.

These artifacts are redacted. They must not contain task text, prompts, provider
responses, credentials, proposal tokens, API keys, bearer tokens, or raw Railway
logs.

---

Historical section below documents the earlier `v0.81.19` closure refresh. It is
kept as release history, not as the current production source of truth.

## Production closeout — v0.81.19

Status: `MONITORING_HOLD`.

- Live version/SHA: `0.81.19` / `c47ca4cacebb9553b020c6e159ae1ad881a2bced`.
- Source branch: `codex/eventgenix-production`.
- Deployment ID: `03e61828-2c5c-4333-b8a4-e6227500dfac`.
- Deployment start: `2026-08-24T11:10:01.873Z`.
- Release branch used for v0.81.19: `codex/my-day-ai-final-closure-0.81.19`.
- Previous live version/SHA: `0.81.18` / `bb272963291d71b64a27c93758fee900c7b657d6`.
- Rollout unchanged:
  - single/checklist: `20%`;
  - bundle: `10%`.
- Production mutation smoke for exact live `v0.81.19` passed:
  - simple/checklist flow;
  - bundle test-user flow;
  - schedule to My Day projection;
  - idempotent replay;
  - global timer start/hydrate/stop;
  - exact QA IDs archived after the run.
- Rollout evidence is not PASS:
  - single/checklist latest report has `2` preview attempts and remains `HOLD_INSUFFICIENT_TRAFFIC`;
  - bundle latest report has `1` preview attempt and remains `HOLD_INSUFFICIENT_TRAFFIC`.
- Legacy endpoint status: `HOLD_REMOVAL`; internal runtime callers are absent,
  observed real usage is `0`, but removal still requires a complete no-usage
  evidence window and explicit operator confirmation.

The closure patch does not change prompt, schema, model, reasoning effort,
Railway variables, secrets, or database schema.

## Current v0.81.19 evidence artifacts

- Final closure report:
  - `output/my-day-ai-final-closure-v08119-2026-08-24.md`;
  - `output/my-day-ai-final-closure-v08119-2026-08-24.json`.
- Production mutation smoke PASS:
  - `output/live-my-day-ai-mutation-smoke/EGX_MY_DAY_AI_QA_v08119_20260824T153010.json`.
- Single/checklist rollout 20%:
  - `output/task-ai-rollout/2026-08-24T12-40-31-391Z.md`;
  - verdict: `HOLD_INSUFFICIENT_TRAFFIC`.
- Bundle rollout 10%:
  - `output/task-ai-bundle-rollout/2026-08-24T12-40-50-760Z.md`;
  - verdict: `HOLD_INSUFFICIENT_TRAFFIC`.
- Legacy route sunset evidence:
  - `output/task-ai-legacy-decompose/2026-08-24T12-44-23-888Z.md`;
  - verdict: `HOLD_REMOVAL`.

These artifacts are redacted. They must not contain task text, prompts, provider
responses, credentials, proposal tokens, API keys, bearer tokens, or raw Railway
logs.

---

Historical section below documents the earlier `v0.81.13` reconciliation. It is
kept as release history, not as the current production source of truth.

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
