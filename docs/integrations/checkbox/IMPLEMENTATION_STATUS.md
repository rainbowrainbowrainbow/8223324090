# Checkbox Implementation Status

Last updated: 2026-08-10.

Production/deploy base:

- Live URL: `https://8223324090-production.up.railway.app/api/version`.
- Live production package baseline checked for this handoff: `0.80.108` (`Checkbox Fiscal Hardening`).
- Live commit checked for this handoff: `a6b2366167dd27c08d55cb7b774cce6074d6b1fb`.
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
- Pilot configuration is version-aware: exact repeated apply is a no-op, generic apply refuses drift, and explicit mutation commands write append-only `fiscal_configuration_audit` rows.
- Fiscal item mapping supports explicit `taxed` / `untaxed` modes. `admission_tariff:*` is blocked from Checkbox tax fields.
- `docs/integrations/checkbox/checkbox-test-mode.env.example` documents ref-specific test-mode env names without values.
- Checkbox sandbox smoke allows official Checkbox HTTPS hosts but refuses mutation until exact expected test identity is configured and `/cashier/me` proves `is_test === true`.
- Focused local mock HTTP + PostgreSQL smoke coverage exists and is wired into CI.
- CI hardening gates now include value-free Checkbox OpenAPI compatibility checks, source safety scans, real PostgreSQL configuration tests, real PostgreSQL/local HTTP worker smoke, and real-routes browser smoke.
- Release `0.80.108` is the latest live Checkbox hardening package baseline checked in this handoff. Reconfirm live version/commit before any delivery action.
- Provider-aware readiness fail-closed handling, unresolved-queue unavailable state, scheduler degraded incidents, durable shift recovery, immutable provider context snapshots, append-only configuration audit guards, and actor-based configuration authorization are part of the released baseline.

## Not Ready

- Runtime provider and payment acceptance are disabled by default and have not been run against real Checkbox sandbox credentials.
- Production pilot mapping has not been applied.
- Real Checkbox credentials and register IDs are not configured, and must not be added to source.
- Accountant-approved fiscal item/tax values are still missing for production activation.
- Sandbox QA has not been proven against real Checkbox test credentials.
- End-of-day production policy still needs a final product decision before real activation: manual Checkbox portal close/runbook or narrow Phase-1 close flow.
- `npm run test:integration:checkbox-ui-real:isolated` needs a disposable local `TEST_DATABASE_URL`; production `DATABASE_URL` must not be used as a fallback.
- Residual software hardening remains local until an explicitly approved release: exact host allowlist, activation gate docs, source safety coverage, and Cashier PRO PIN bootstrap compatibility.

## Next Tasks

1. Finish residual local software hardening for host allowlists, activation templates, source safety gates, and Cashier PRO PIN hashing compatibility.
2. Commit/push/deploy those residual changes only in a separate approved release task after CI passes, keeping `CHECKBOX_INTEGRATION_ENABLED=false`, `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false`, `CHECKBOX_WEBHOOK_ENABLED=false`, and `EVENTGENIX_CASHIER_PRO_ENABLED=false`.
3. Run real Checkbox sandbox QA only when local `CHECKBOX_SANDBOX_*` secrets exist and the provider reports exact test cashier/register state.
4. Create a separate production activation task for real mapping/secrets/webhook/first fiscal receipt.

## Activation Blockers

- Accountant-approved FOP data, fiscal item names, tax groups, VAT policy, and register/cashier mapping are missing.
- Production Checkbox credentials and webhook setup require a separate activation task.
- First real fiscal receipt requires explicit approval and controlled live QA.
- Production mapping must be applied only by an authenticated active EventGenix user with non-delegable `fiscal.configure`, a mandatory reason, and no raw secrets in CLI args, DB, logs, docs, or tests.
- Production register must remain disabled until successful preflight, sandbox/test-mode proof, explicit `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=true`, and explicit activation approval.
