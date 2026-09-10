# Omni completion — staged releases

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

Remaining plan blocks at release 1: concurrent manager controls; media and physical-mobile QA;
delivery reconciliation; provider activation and Meta comment/interactive events.
Provider E2E requires the specified test accounts and separately bounded messages.

## Release 1 delivered

- Version 0.81.96 / `a52725f867cbe2d21188198ce0b0e7a51a7c52d2`.
- CI run 34531334428: all six jobs successful.
- Railway deployment `ce8be69f-7920-4925-9883-d92e6d9c7111`; exact-SHA version smoke passed.
- Test-account read-only live API: Telegram account/history return 200; optional
  channels stay disconnected; DAR remains outside this test account's access.

## Release 2 candidate — manager concurrency and delivery review

Production impact: yes. Same authorized service, branch and delivery envelope.
No migration, account activation, provider setup or secret changes in this block.

- Open conversation controls refresh while preserving drafts and focused edits.
- PATCH compares the expected value of only the changed field, returning 409 with
  current state when another manager has already changed that field.
- TurboSMS status lookup validates message ID, SMS type and recipient, never sends.
- Manual verification is append-only metadata distinct from provider confirmation.
- Late status queries cannot overwrite a terminal receipt.
- Targeted tests: 83 pass; local disposable PostgreSQL concurrency and receipt/manual
  review persistence pass. The first receipt fixture incorrectly used Telegram,
  which has no delivery receipts; the corrected SMS scenario passed.
- Live QA remains read-only; actual two-manager mutations and SMS require test scope.

## Release 2 delivered

- Version 0.81.97 / `7e51aaec1f31967fbf72191573dccd02956b78b6`.
- Functional commit `13e291a3b`; CI run 34532704149: all six jobs successful.
- Railway deployment `512ac9a5-2fb9-491a-b723-58efb7b87016`; exact-SHA version smoke passed.
- Read-only live account diagnostics prove the scheduled check actually ran:
  Telegram lastCheckedAt `2026-09-10T21:51:27.966Z`, fresh successful check,
  pending update count zero. Other channels remain disconnected.

## Release 3 — attachments and Meta events

Production impact: yes. Same authorized branch/service and task envelope.
Scope includes additive migration 354 (scoped file bytes and expiring grants),
narrow file-grant auth boundary explicitly required by block 4, channel adapter
changes, signed Meta comment/interactive events, UI composer, and health recovery.
No customer message, provider setup, production secret or external account activation.

- File routes, `omni-attachments`, adapters and workspace: durable scoped JPEG/PNG/PDF;
  upload validation before provider send, checksum-bound idempotency, expiring single-file
  grants, safe inbound archival, separate visible archival errors.
- `omni-meta-events`: normal DM compatibility, comment/postback/quick-reply normalization,
  deduplication, scoped Page/IG identity, explicit public/private reply dispatch.
- Health follow-up: validated receipt clears a processing alarm without inventing an
  inbound timestamp; environment-backed connections receive actual scheduled checks.
- Real PostgreSQL fixtures: migrations reapply; expiry/business isolation; simultaneous
  attachment sends call the provider stub once; changed checksum conflicts; incoming
  archival is reused on duplicate webhook. Existing CAS/ownership/review tests pass.
- Browser fixtures 1440/390: two clients, CAS feedback and draft preservation, file
  isolation and single send, controls and mobile composer/back. Ten simulated mutations,
  zero production business writes; screenshots inspected.
- Local full baseline before final targeted refinements passed: 2639 unit tests,
  334 My Day tests, 1312 UI assertions. Final exact-SHA CI remains the release gate.
- Scope and external activation dependencies: `OMNI_CHANNEL_ACTIVATION_2026-09-11.md`.
- Rollback retains additive tables, promotes the exact previous .97 SHA only through
  the release helper. No destructive down migration or secret changes.
