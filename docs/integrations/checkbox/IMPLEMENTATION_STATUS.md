# Checkbox Implementation Status

Last updated: 2026-09-03.

Production/deploy base:

- Live URL: `https://8223324090-production.up.railway.app/api/version`.
- Confirmed live release: `0.81.68` (`Checkbox Cashier UI Polish`).
- Release package baseline prepared for this handoff: `0.81.79` (`PARK/DAR HOLD Startup Guard`).
- Confirmed live commit: `b7980fb451e6a50a9fe2403613a27bcd721d210a`.
- Live source branch: `codex/eventgenix-production`.
- Release source of truth is not this document and not any long-lived `.codex-temp` worktree. Before commit, push, deploy, rollback, or production activation, run the release staleness guard and use live `/api/version` plus the confirmed deploy source branch.
- Current live-released Checkbox migrations: `316` through `337`.
- The repository baseline is migrated through `342`; Checkbox-specific released migrations currently end at `337`.
- This unreleased local hardening adds proposed migrations `343_checkbox_shift_operation_invariants.sql`, `344_checkbox_concurrent_immutability_guards.sql`, and `345_checkbox_service_receipt_recovery_stages.sql`. None is active in production until a separately reviewed release passes the read-only DB preflight and the normal migration startup succeeds.

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
- A browser-to-EventGenix-to-Checkbox proof completed on 2026-09-02 with one existing unpaid CARD draft only: no CASH order was created, one durable sale reached `DONE`, all payment/shift outbox work converged, and the final unresolved order/job counts were zero. The first canonical EventGenix Phase-1 close attempt was correctly denied because the harness reused the cashier session instead of authenticating the exact integration owner; the exact smoke-owned shift was then closed through the guarded provider cleanup. The harness now authenticates the owner separately and the canonical close path passes local PostgreSQL/mock-provider tests, but a second real-provider canonical-close mutation was intentionally not created solely to repeat that proof. The local disposable ledger and sanitized one-shot run record were preserved for inspection.
- The proof succeeded without an access key for the selected Phase-1 calls. This is evidence for the current Checkbox contract only, not permission to omit a key from future operations that officially require one.
- Real Checkbox responses normalize the EventGenix context marker to the string `True` and may omit optional context. Receipt verification therefore treats context as optional official metadata, but validates any echoed EventGenix context completely and fail-closed; durable UUID, status, type, amount, tender, cashier, register, and shift remain mandatory.
- Official short `/cashier/shift` responses do not contain cashier identity. Cleanup proves ownership through `/shifts/{id}`, then matches the short current-shift UUID/register before close.
- Sandbox mutation runs require an explicit stable `CHECKBOX_SANDBOX_DEVICE_ID`; PID-derived device identities are no longer allowed. Official empty-body HTTP 205 signout is handled explicitly.
- Focused local mock HTTP + PostgreSQL smoke coverage exists and is wired into CI.
- CI hardening gates now include a deterministic value-free semantic Checkbox OpenAPI projection, source safety scans, real PostgreSQL configuration tests, real PostgreSQL/local HTTP worker smoke, and real-routes browser smoke.
- `config/checkboxOpenApiContract.js` pins the reviewed public API operations, response codes, required fields, enums, headers, and money/quantity units without provider IDs or examples. `check:checkbox-openapi:official` compares it read-only with the current official contract before release or activation.
- Release `0.81.68` is deployed to production with complete manifest-backed commit and branch metadata.
- Release `0.81.79` is the package baseline prepared in this handoff.
- The cashier UI polish and its fail-closed readiness refresh regression fix are part of the live release.
- Provider-aware readiness fail-closed handling, unresolved-queue unavailable state, scheduler degraded incidents, durable shift recovery, immutable provider context snapshots, append-only configuration audit guards, and actor-based configuration authorization are part of the released baseline.

## Unreleased Local Hardening

- Shift open/close links and unresolved shift lifecycle cardinality are enforced at DB level; legacy rows are inspected by a dedicated read-only release preflight instead of being silently rewritten.
- Credential-reference normalization and payment-item sealing are serialized against concurrent writers.
- Every worker mutation validates the immutable provider snapshot against the current exact profile/location/register/binding before provider HTTP.
- A final uncached cashier/current-shift/detailed-shift identity check runs immediately before a sale POST.
- Pre-mutation failures may safely retry the same durable UUID; possibly submitted sale, return, and service receipts converge through lookup-only recovery.
- Provider receipt mismatches are committed as append-only evidence plus a scoped incident without overwriting the immutable receipt or marking it fiscalized.
- The thin cashier UI removes dormant Cashier PRO behavior, keeps provider/report controls visibly styled, and distinguishes in-flight work from retryable/terminal failures.
- These changes are local and uncommitted. Passing local tests is not proof that migration `343` can run against production data; `npm run audit:checkbox-release-db-preflight` remains a mandatory release gate.

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

1. Run the read-only production migration preflight and resolve any reported historical shift blockers through a separate audited data-fix task; do not bypass migration `343`.
2. Review and release this local Phase-1 close/recovery/queue hardening from a fresh confirmed deploy source, with every production Checkbox flag still disabled.
3. Collect accountant-approved production legal entity, item names, taxed/untaxed policy, and provider mapping inputs.
4. Prepare and review the production mapping diff without enabling the register or any global acceptance flag.
5. Apply production mapping only in a separately approved activation task, with the register and all global acceptance flags still disabled.
6. Run production-identity read-only readiness before accepting money.
7. Enable the first controlled production receipt only after fresh provider readiness, operator review, rollback readiness, and explicit approval.

## Activation Blockers

- Accountant-approved FOP data, fiscal item names, tax groups, VAT policy, and register/cashier mapping are missing.
- Production Checkbox credentials and webhook setup require a separate activation task.
- First real fiscal receipt requires explicit approval and controlled live QA.
- Test-only acceptance of unreported payment-permission fields must never be enabled for production identity (`is_test=false`).
- Production mapping must be applied only by an authenticated active EventGenix user with non-delegable `fiscal.configure`, a mandatory reason, and no raw secrets in CLI args, DB, logs, docs, or tests.
- Production register must remain disabled until successful preflight, sandbox/test-mode proof, explicit `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=true`, and explicit activation approval.
- Migration `343` must not be released until the read-only production preflight reports zero legacy shift/lifecycle/link blockers; any non-zero result requires an explicit audited reconciliation/data-fix.
