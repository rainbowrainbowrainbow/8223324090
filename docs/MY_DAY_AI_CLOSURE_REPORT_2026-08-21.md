# My Day AI closure report — 2026-08-21

## Live state

- Version: `0.81.12`
- SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Release label: `My Day AI Evidence Hardening`
- Stable production marker: `codex/eventgenix-production`
- Historical rollback/reference marker: `codex/checkbox-hardening-release-v080103`
- Deployment manifest: complete
- Health: `/api/health` OK, `/api/health/deep` OK
- Latest Railway deployment: `6442dafb-f763-4f4a-a95c-3f6428c685f2`, `SUCCESS`

## AI rollout state

- Provider: OpenAI
- Model: `gpt-5.6-luna`
- Single/checklist rollout: `20%`
- Test user access reason: `test_username`
- Bundle rollout: `0%`
- Bundle test-user access reason: `bundle_test_username`

No Railway variables were changed while preparing this report.

## Evidence artifacts

- Paid Luna eval: `output/task-ai-live-eval/2026-08-21T17-42-04-460Z.json`
- Production mutation smoke: `output/live-my-day-ai-mutation-smoke/EGX_MY_DAY_AI_QA_2026-08-21T18-16-09-054Z_7e68aee6.json`
- Single/checklist rollout evidence: `output/task-ai-rollout/2026-08-21T18-53-50-300Z.json`, verdict `HOLD`
- Single/checklist rollout evidence summary: `output/task-ai-rollout/2026-08-21T18-54-16-386Z.md`
- Legacy `/api/tasks/decompose-draft` sunset evidence: `output/task-ai-legacy-sunset/2026-08-21T18-57-legacy-decompose-usage.md`
- Bundle rollout evidence: `output/task-ai-bundle-rollout/2026-08-21T19-05-41-108Z.json`, test-user stage `PASS`, public rollout `HOLD`
- Bundle rollout evidence summary: `output/task-ai-bundle-rollout/2026-08-21T19-05-41-108Z.md`

Artifacts are redacted: they must not contain task text, prompts, provider responses, credentials, proposal tokens, API keys, or raw Railway logs.

## Completed confirmations/evidence

- Paid Luna eval passed for the current candidate and selected `reasoning.effort: low`.
- Production-write My Day AI mutation smoke passed on the test account in `event_genix`.
- Exact QA task IDs created by the mutation smoke were archived by exact ID.
- Bundle test-user flow passed: preview proposed `4` tasks, commit created `3` tasks after rejecting `1`.
- Read-only DB evidence found `0` partial bundles and `0` duplicate idempotency rows in the 24h window.

## Current rollout verdicts

- Single/checklist: keep at `20%`.
  - Reason: current exact-SHA evidence is clean but insufficient for rollout; only `3` successful actionable previews and no 24h exact-SHA window with real preview attempts.
- Bundle: keep `0%` public rollout / test users only.
  - Reason: test-user stage passed, but public bundle rollout requires separate confirmation and its own bundle-specific evidence window.

## Legacy endpoint status

- Internal Composer flow uses the canonical `/api/tasks/ai-draft/preview` and commit endpoints.
- Legacy `/api/tasks/decompose-draft` usage evidence is currently `0` for the observed window.
- The legacy endpoint should not be removed until a full agreed non-QA usage window proves no real consumers.

## Production marker status

- Stable marker: `codex/eventgenix-production`
- Stable marker SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Historical rollback/reference marker: `codex/checkbox-hardening-release-v080103`
- Historical marker SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Diff between stable marker and historical marker: none
- Live `/api/version` still reports `sourceBranch: codex/checkbox-hardening-release-v080103` because this value is embedded in the currently deployed manifest. The next canonical deploy from `codex/eventgenix-production` should update the manifest branch value.

## Rollback points

- Current live rollback reference: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Previous known stable production marker before `v0.81.12`: `1d563ec90ec8b154d770bdf7e77724f47e702750` (`v0.81.11`)
- Old branch `codex/checkbox-hardening-release-v080103` must be preserved as rollback/reference during marker migration.

## Known remaining risks

- Single/checklist rollout cannot move above `20%` until an exact-SHA `PASS` artifact exists.
- Bundle rollout cannot move beyond test users until a separate staged bundle rollout is explicitly approved.
- Legacy `/api/tasks/decompose-draft` remains as a compatibility wrapper until a full no-usage window is complete.
- Live `/api/version` branch will continue to show the historical marker until the next deploy is made from `codex/eventgenix-production`.
- Some old dirty/conflicted worktrees still exist outside this clean worktree and must not be used for releases.
