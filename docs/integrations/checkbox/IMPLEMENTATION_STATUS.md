# Checkbox Implementation Status

Last updated: 2026-09-03.

Production/deploy base:

- Live URL: `https://8223324090-production.up.railway.app/api/version`.
- Release package baseline prepared for this handoff: `0.81.67` (`Checkbox Fiscal Safety Hardening`).
- Confirmed live commit at the start of this release preparation: `a43a2eaef5120580aa624f33655a388ae6f79acd`.
- Live source branch: `codex/eventgenix-production`.
- Release source of truth is not this document and not any long-lived `.codex-temp` worktree. Before commit, push, deploy, rollback, or production activation, run the release staleness guard and use live `/api/version` plus the confirmed deploy source branch.
- Current released Checkbox migrations: `316` through `337`.

## Current Position

EventGenix has a released ledger, payment workflow, permissions, outbox worker, Checkbox runtime provider bridge, Checkbox adapter, readiness checks, and cashier UI. It is not an activated live Checkbox integration yet.

The thin MVP should connect only the park `event_genix` profile and `middle` register to one server-priced admission sale path with cash/manual card confirmation and one official Checkbox sale receipt. Everything else is Cashier PRO and must remain disabled separately.

## Done

- Additive payment/fiscal schema exists in released migrations `316` through `337`.
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
- Real Checkbox test-mode proof completed on 2026-08-22 against the locally configured test register: exact organization/register/cashier and `is_test=true` were verified; one 10 UAH CASH and one 10 UAH CASHLESS receipt reached `DONE`; both smoke-owned shifts reached `CLOSED`; no service, refund, PRO, production EventGenix, or production Checkbox operation was performed.
- A final browser-to-EventGenix-to-Checkbox proof completed on 2026-09-02 with one existing unpaid CARD draft only: no CASH order was created, one durable sale reached `DONE`, the exact smoke-owned shift closed through the canonical EventGenix Phase-1 close route, all three outbox jobs succeeded, and the final unresolved order/job counts were zero. The local disposable ledger and sanitized one-shot run record were preserved for inspection.
- The proof succeeded without an access key for the selected Phase-1 calls. This is evidence for the current Checkbox contract only, not permission to omit a key from future operations that officially require one.
- Real Checkbox responses normalize the EventGenix context marker to the string `True` and may omit optional context. Receipt verification therefore treats context as optional official metadata, but validates any echoed EventGenix context completely and fail-closed; durable UUID, status, type, amount, tender, cashier, register, and shift remain mandatory.
- Official short `/cashier/shift` responses do not contain cashier identity. Cleanup proves ownership through `/shifts/{id}`, then matches the short current-shift UUID/register before close.
- Sandbox mutation runs require an explicit stable `CHECKBOX_SANDBOX_DEVICE_ID`; PID-derived device identities are no longer allowed. Official empty-body HTTP 205 signout is handled explicitly.
- Focused local mock HTTP + PostgreSQL smoke coverage exists and is wired into CI.
- CI hardening gates now include a deterministic value-free semantic Checkbox OpenAPI projection, source safety scans, real PostgreSQL configuration tests, real PostgreSQL/local HTTP worker smoke, and real-routes browser smoke.
- `config/checkboxOpenApiContract.js` pins the reviewed public API operations, response codes, required fields, enums, headers, and money/quantity units without provider IDs or examples. `check:checkbox-openapi:official` compares it read-only with the current official contract before release or activation.
- Release `0.81.67` is the package baseline prepared in this handoff.
- The same `0.81.66` package is the confirmed live baseline before the pending test-mode harness hardening is released.
- Provider-aware readiness fail-closed handling, unresolved-queue unavailable state, scheduler degraded incidents, durable shift recovery, immutable provider context snapshots, append-only configuration audit guards, and actor-based configuration authorization are part of the released baseline.

## Not Ready

- Runtime provider and payment acceptance are disabled by default.
- Production pilot mapping has not been applied.
- Test-mode non-secret organization/register/cashier identity has been collected locally in the non-repository JSON config; secrets remain local-only and production mapping is not configured.
- Accountant-approved fiscal item/tax values are still missing for production activation.
- The test cashier returns `cash_payment=null` and `card_payment=null`. This is unreported legacy test metadata, not an explicit denial; a guarded test-only proof succeeded for both tenders. Production remains fail-closed unless permissions are explicitly reported as allowed.
- End-of-day policy for the thin pilot is the narrow Phase-1 close flow in EventGenix. It is restricted to the exact configured integration owner, blocks on unresolved receipts, reuses one durable close operation, and waits for Checkbox `CLOSED`. Portal close remains an audited recovery fallback, not the normal operator flow.
- `npm run test:integration:checkbox-ui-real:isolated` needs a disposable local `TEST_DATABASE_URL`; production `DATABASE_URL` must not be used as a fallback.
- Current release preparation keeps explicit password/PIN provider authentication, optional outlet ID, test-mode certificate handling, and null-current-shift readiness handling. Production activation remains disabled.
- A stable test-only Checkbox device identity is configured in the local secret file and was proven by the 2026-09-02 smoke. Its value must remain outside the repository and must not be copied into logs or documentation.
- The pinned projection intentionally covers the EventGenix-used Checkbox surface rather than copying the full upstream document. Upstream compatibility must still be checked with `npm run check:checkbox-openapi:official` before activation; a contract mismatch blocks fiscal mutations until reviewed.

## Next Tasks

1. Release the reviewed test-mode harness and owner-only Phase-1 close hardening with all production Checkbox gates disabled.
2. Collect accountant-approved production legal entity, item names, taxed/untaxed policy, and provider mapping inputs.
3. Apply production mapping only in a separately approved activation task, with register and all global acceptance flags still disabled.
4. Run production-identity read-only readiness before accepting money.
5. Enable the first controlled production receipt only after fresh provider readiness, operator review, rollback readiness, and explicit approval.

## Activation Blockers

- Accountant-approved FOP data, fiscal item names, tax groups, VAT policy, and register/cashier mapping are missing.
- Production Checkbox credentials and webhook setup require a separate activation task.
- First real fiscal receipt requires explicit approval and controlled live QA.
- Test-only acceptance of unreported payment-permission fields must never be enabled for production identity (`is_test=false`).
- Production mapping must be applied only by an authenticated active EventGenix user with non-delegable `fiscal.configure`, a mandatory reason, and no raw secrets in CLI args, DB, logs, docs, or tests.
- Production register must remain disabled until successful preflight, sandbox/test-mode proof, explicit `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=true`, and explicit activation approval.
