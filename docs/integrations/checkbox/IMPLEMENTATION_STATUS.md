# Checkbox Implementation Status

Last updated: 2026-08-09.

Production/deploy base:

- Live URL: `https://8223324090-production.up.railway.app/api/version`.
- Live version before this release pass: `0.80.100`.
- Live commit before this release pass: `a467fa4343e03a63344e2f9e03c1318c97cfbd90`.
- Source branch: `codex/my-day-ai-composer-v08094`.
- Local release worktree: `.codex-temp/checkbox-fiscal-readiness-release-v080101`.
- Local release branch: `codex/checkbox-fiscal-readiness-release-v080101`.

## Current Position

EventGenix has a substantial local ledger, payment workflow, permissions, outbox skeleton, Checkbox runtime provider bridge, Checkbox adapter scaffolding, and cashier UI. It is not an activated live Checkbox integration yet.

The thin MVP should connect only the park `event_genix` profile and `middle` register to one server-priced admission sale path with cash/manual card confirmation and one official Checkbox sale receipt. Everything else is Cashier PRO and must remain disabled separately.

## Done

- Additive payment/fiscal schema exists in migrations `316` through `319`.
- Payment orders, items, attempts, allocations, fiscal operations, receipts, shifts, webhooks, approvals, reconciliations, refunds, outbox jobs, and audit events exist.
- New ledger avoids using `finance_transactions`, `bookings.paid_amount`, legacy `receipts`, or `cash_register_shifts` as the fiscal source of truth.
- `routes/payments.js` and `services/payments/paymentService.js` implement a local cash/card manual confirmation path with received/change snapshots.
- The outbox worker has locking, bounded batches, retry/backoff, dead-letter, sanitized errors, and lookup-before-resale structure.
- `/cashier-payments` exists and is visible through the current permission/navigation surface.
- Creator and art director access was opened in the current production base.
- Checkbox client, mapper, errors, config, signature, webhook service, and sandbox smoke script exist.
- Runtime worker can use a Checkbox provider factory when `CHECKBOX_INTEGRATION_ENABLED=true`.
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

## Not Ready

- Runtime provider is disabled by default and has not been run against real Checkbox sandbox credentials.
- Production pilot mapping has not been applied.
- Real Checkbox credentials and register IDs are not configured, and must not be added to source.
- Accountant-approved fiscal item/tax values are still missing for production activation.
- Sandbox QA has not been proven against real Checkbox test credentials.
- End-of-day production policy still needs a final product decision before real activation: manual Checkbox portal close/runbook or narrow Phase-1 close flow.

## Next Tasks

1. Commit and push the accumulated release diff.
2. Bump the patch release version and deploy with `CHECKBOX_INTEGRATION_ENABLED=false` and `EVENTGENIX_CASHIER_PRO_ENABLED=false`.
3. Perform live read-only QA: page/access/disabled-state only, with no payment confirmation.
4. Run real Checkbox sandbox QA only when local `CHECKBOX_SANDBOX_*` secrets exist and the provider reports test cashier/register state.
5. Create a separate production activation task for real mapping/secrets/webhook/first fiscal receipt.

## Activation Blockers

- Accountant-approved FOP data, fiscal item names, tax groups, VAT policy, and register/cashier mapping are missing.
- Production Checkbox credentials and webhook setup require a separate activation task.
- First real fiscal receipt requires explicit approval and controlled live QA.
