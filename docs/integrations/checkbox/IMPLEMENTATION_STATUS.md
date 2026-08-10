# Checkbox Implementation Status

Last updated: 2026-08-10.

Production/deploy base:

- Live URL: `https://8223324090-production.up.railway.app/api/version`.
- Live production package baseline prepared for this handoff: `0.80.115` (`Checkbox Park Readiness Hardening`).
- Release commit prepared for this handoff: `b3f87d8a2` plus any fast-forward CI-only follow-up required by this release.
- Live source branch checked for this handoff: `codex/checkbox-hardening-release-v080103`.
- Release source of truth is not this document and not any long-lived `.codex-temp` worktree. Before commit, push, deploy, rollback, or production activation, run the release staleness guard and use live `/api/version` plus the confirmed deploy source branch.
- Current released Checkbox migrations: `316` through `331`.

## Current Position

EventGenix has a released ledger, payment workflow, permissions, outbox worker, Checkbox runtime provider bridge, Checkbox adapter, readiness checks, and cashier UI. It is not an activated live Checkbox integration yet.

The thin MVP should connect only the park `event_genix` profile and `middle` register to one server-priced admission sale path with cash/manual card confirmation and one official Checkbox sale receipt. Everything else is Cashier PRO and must remain disabled separately.

## Done

- Additive payment/fiscal schema exists in released migrations `316` through `331`.
- Payment orders, items, attempts, allocations, fiscal operations, receipts, shifts, webhooks, approvals, reconciliations, refunds, outbox jobs, and audit events exist.
- New ledger avoids using `finance_transactions`, `bookings.paid_amount`, legacy `receipts`, or `cash_register_shifts` as the fiscal source of truth.
- `routes/payments.js` and `services/payments/paymentService.js` implement a local cash/card manual confirmation path with received/change snapshots.
- The outbox worker has locking, bounded batches, retry/backoff, dead-letter, sanitized errors, and lookup-before-resale structure.
- `/cashier-payments` exists and is visible through the current permission/navigation surface.
- Creator and art director access was opened in the current production base.
- Checkbox client, mapper, errors, config, signature, webhook service, and sandbox smoke script exist.
- Runtime worker can use a Checkbox provider factory when `CHECKBOX_INTEGRATION_ENABLED=true` and payment acceptance remains separately gated.
- Default runtime skips outbox claiming when Checkbox integration is disabled or no resolvable runtime env config exists.
- Worker maps `provider_operation_id` to the Checkbox receipt UUID and status lookup uses the same UUID.
- Official webhook signature verification now uses `x-request-signature` and Base64 HMAC-SHA256 over the raw body.
- Polling/status lookup remains the canonical convergence path.
- `EVENTGENIX_CASHIER_PRO_ENABLED=false` keeps Phase 2 operations hidden/fail-closed.
- `fiscal_item_mappings` separates internal EventGenix tariff references from Checkbox fiscal names and tax IDs.
- `scripts/configure-checkbox-park-pilot.js` provides repeatable dry-run-first pilot mapping setup without raw secrets.
- The local non-secret test-mode mapping source is `C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json`; the CLI supports `--config-file` and `CHECKBOX_PILOT_CONFIG_FILE`.
- Pilot configuration is version-aware: exact repeated apply is a no-op, generic apply refuses drift, and explicit mutation commands write append-only `fiscal_configuration_audit` rows.
- CLI dry-run output is sanitized by default: provider organization/register/cashier IDs are shown only as configured/not-configured flags.
- Fiscal item mapping supports explicit `taxed` / `untaxed` modes. `admission_tariff:*` is blocked from Checkbox tax fields.
- `docs/integrations/checkbox/checkbox-test-mode.env.example` documents ref-specific test-mode env names without values.
- Checkbox sandbox smoke allows official Checkbox HTTPS hosts but refuses mutation until exact expected test identity is configured and `/cashier/me` proves `is_test === true`.
- Focused local mock HTTP + PostgreSQL smoke coverage exists and is wired into CI.
- CI hardening gates now include value-free Checkbox OpenAPI compatibility checks, source safety scans, real PostgreSQL configuration tests, real PostgreSQL/local HTTP worker smoke, and real-routes browser smoke.
- Release `0.80.115` is the package baseline prepared in this handoff. Reconfirm live version/commit before any future delivery or activation action.
- Provider-aware readiness fail-closed handling, unresolved-queue unavailable state, scheduler degraded incidents, durable shift recovery, immutable provider context snapshots, append-only configuration audit guards, and actor-based configuration authorization are part of the released baseline.

## Not Ready

- Runtime provider and payment acceptance are disabled by default and have not been run against real Checkbox sandbox credentials.
- Production pilot mapping has not been applied.
- Test-mode non-secret organization/register/cashier identity has been collected locally in the non-repository JSON config; secrets remain local-only and production mapping is not configured.
- Accountant-approved fiscal item/tax values are still missing for production activation.
- Sandbox QA has not been proven against real Checkbox test credentials.
- End-of-day production policy still needs a final product decision before real activation: manual Checkbox portal close/runbook or narrow Phase-1 close flow.
- `npm run test:integration:checkbox-ui-real:isolated` needs a disposable local `TEST_DATABASE_URL`; production `DATABASE_URL` must not be used as a fallback.
- Current release preparation adds explicit password/PIN provider authentication and removes the unsafe requirement to invent an outlet ID. Production activation remains disabled.
- Mutation-free test-mode readiness reached the real Checkbox cashier identity on 2026-08-10 and failed closed because `cash_payment` and `card_payment` were not explicitly `true`. Enable both permissions for the test cashier in Checkbox before any controlled receipt test.

## Next Tasks

1. Verify and release the local explicit password/PIN authentication and optional-outlet hardening after CI passes, keeping all production gates false.
2. Run local config preflight from `CHECKBOX_PILOT_CONFIG_FILE` against a disposable/local PostgreSQL database before any apply. User `3` is the confirmed primary test cashier, and QA-only user `47` is allowed only for test-mode configuration.
3. Run real Checkbox test-mode mutations only after a separate explicit approval, exact `is_test=true` readiness, and access-key requirements for the selected operations are confirmed.
4. Create a separate production activation task for real legal/tax mapping, secrets, webhook, and first controlled fiscal receipt.

## Activation Blockers

- Accountant-approved FOP data, fiscal item names, tax groups, VAT policy, and register/cashier mapping are missing.
- Production Checkbox credentials and webhook setup require a separate activation task.
- First real fiscal receipt requires explicit approval and controlled live QA.
- The current test cashier must expose `sales=true`, `cash_payment=true`, and `card_payment=true` before Phase 1 accepts money.
- Production mapping must be applied only by an authenticated active EventGenix user with non-delegable `fiscal.configure`, a mandatory reason, and no raw secrets in CLI args, DB, logs, docs, or tests.
- Production register must remain disabled until successful preflight, sandbox/test-mode proof, explicit `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=true`, and explicit activation approval.
