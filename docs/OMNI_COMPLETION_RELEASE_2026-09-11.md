# Omni completion — release 1

Production impact: yes. The user explicitly requested implementation of the six-block
plan, including additive migrations, the Viber management guard, webhook ownership,
commit/push, exact-SHA CI, manual Railway deployment and read-only live QA.

## OMNI-COMPLETION-RELEASE-1

- Feature branch: `codex/omni-completion-20260910`.
- Destination: `codex/eventgenix-production`.
- Initial live SHA: `3312ace2b5dbe18eda11fd865e6a6218212ff23d` (0.81.94).
- Integrated upstream: `86402ee666246ffb48bb31f7e88c49db5eb3b0d1` (HR 0.81.95).
- Candidate: 0.81.96, Omni Webhook Ownership and Health; exact release SHA recorded after commit.
- Railway: fortunate-appreciation / production / 8223324090,
  project `bc28b46c-d4bc-491c-893a-d8401c633668`,
  service `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`.
- Domain: https://8223324090-production.up.railway.app.
- Scope: plan blocks 1–2. Migration 353 creates only health/error metadata tables;
  no message bodies, credential changes, customer-data updates or provider setup.
- Local PostgreSQL fixtures create and remove only their own `omni_test_*` database.
- Live QA: test login, GET reads, Telegram getMe/getWebhookInfo; block all business writes.
- Rollback: promote the exact previous live SHA through the release helper and retain
  additive diagnostic tables. No destructive down migration.
- Bound: this task, six hours from the implementation request, at most three release
  attempts; no force-push or Railway/environment/settings changes.

## Evidence before release

- Functional commit: `215b6d663`.
- Targeted Omni tests: 121 passed, 0 failed.
- Local Node 22/npm 10 full baseline: passed; final UI gate 1312 passed, 0 failed.
- Real local PostgreSQL: three concurrent owners yield one success/two conflicts;
  migration reapplies safely; metadata isolation/recovery pass.
- Browser fixtures 1440/390: history/list pagination, drafts, late responses, send
  targeting, assignment/status, failure feedback, composer and back navigation pass.
  Five simulated mutations, zero production business writes.
- Local baseline predates the upstream HR merge; final exact-SHA CI is mandatory.
- Git metadata cleanup was rejected by automatic review. No restore was performed.
  All prepared metadata was preserved in commit `7d4db3517`, followed by a normal
  upstream merge `07ee4fbec` and the new release number.

Remaining plan blocks: concurrent manager controls; media and physical-mobile QA;
delivery reconciliation; provider activation and Meta comment/interactive events.
Provider E2E requires the specified test accounts and separately bounded messages.
