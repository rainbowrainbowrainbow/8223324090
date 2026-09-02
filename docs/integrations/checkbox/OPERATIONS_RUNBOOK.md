# Checkbox Thin MVP Operations Runbook

Status: production deployment runbook for disabled fiscal mode. Production activation is a separate task.

## Default production state

- `CHECKBOX_INTEGRATION_ENABLED=false`.
- `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false`.
- `CHECKBOX_WEBHOOK_ENABLED=false`.
- `EVENTGENIX_CASHIER_PRO_ENABLED=false`.
- Checkbox webhook configuration is not applied.
- Fiscal register mappings remain disabled until an explicit operator preflight and enable command.
- No production fiscal operation, refund, service operation, or preschool profile activation is part of this release.

## Activation checklist

1. Confirm production `/api/version` matches the intended release commit.
2. Confirm the active deploy branch is the branch that contains the release commits.
3. Collect accountant-approved FOP/legal entity data, fiscal item names, tax mode, and tax IDs.
4. Collect exact Checkbox test-mode organization, register, cashier, and credential reference names. Outlet ID is optional metadata because the current official cashier/register schemas do not expose it; do not invent one.
5. Store raw Checkbox credentials only in environment variables outside the repository.
6. For local test-mode preparation, keep non-secret mapping in `C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json` and run dry-run first:
   `npm run configure:checkbox:park -- --config-file="C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json"`.
7. Run preflight with the same config file only after dry-run is clean:
   `npm run configure:checkbox:park -- preflight --config-file="C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json"`.
   On npm 10 for Windows, `--config-file=<path>` must stay one argument. Do not write it as the separated `--config-file <path>` form after a single npm separator, because npm consumes the option and passes only the path to Node. Use `node scripts/configure-checkbox-park-pilot.js --help` for the canonical examples.
8. Keep raw Checkbox credentials in the local env file only. Do not put password, PIN, license key, access key, token, webhook secret, or price overrides into the JSON config.
9. Run the Checkbox test-mode smoke only when `/cashier/me` proves the cashier is test-mode.
10. Enable the pilot register only after successful preflight and explicit activation approval.
11. Turn on `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=true` only in the separate controlled payment activation task.

### Test register device identity

Checkbox uses `X-Device-ID` to block duplicate RRO agents. Keep one stable local-only value per test register and never commit or print it.

- Do not generate a new value after a successful sign-in.
- `QR-код ключа ліцензії` and `Скинути пінкод` do not replace `X-Device-ID`.
- HTTP 409 `base.device_id` means the register is already bound to another agent ID. Stop; do not omit the header, delete the register, or retry with random IDs.
- Recover the exact prior ID, use a separately approved fresh test register, or request a provider-side re-bind for the test register.

With the exact stable ID configured in the local secret file, always run the read-only/full-stack preflight first:

`npm run smoke:checkbox:testmode:fullstack:preflight`

The mutation stage is a separate operator action and must retain its explicit sandbox and owned-shift cleanup confirmations.

### Full-stack test-mode proof contract

Use only the npm commands backed by `scripts/run-isolated-postgres-tests.js`. Do not run `tests/browser/checkbox-cashier-real-testmode-browser-smoke.js` directly. The runner attests the loopback target and disposable PostgreSQL configuration before the harness can authenticate or mutate Checkbox.

- `npm run smoke:checkbox:testmode:fullstack:preflight` is read-only and is always the first step.
- Mutation commands require a fresh, explicit user authorization, the exact stage-specific confirmation variables, a new single-use UUID run ID, and a local run-ledger directory outside the repository.
- `smoke:checkbox:testmode:fullstack` is the full mutation proof.
- `smoke:checkbox:testmode:fullstack:card-recovery` is only for the documented preserved-cash recovery state; it must never recreate the cash sale.
- `smoke:checkbox:testmode:fullstack:final-card-close` creates or resumes only the explicitly authorized single card draft, proves `DONE`, and closes only its exact owned shift through the Phase-1 EventGenix route.
- A resume confirmation never authorizes creating a replacement order. Identity mismatch, `is_test` mismatch, non-ready provider state, or an unknown result stops the run.
- An explicit `cash_payment=false` or `card_payment=false` blocks confirmation of that tender before money/fiscal mutation. Closing an already-fiscalized, smoke-owned shift is a separate recovery action: it never authorizes another payment and still requires exact provider identity, an available provider, zero unresolved orders, and the immutable shift ID.

The value-free variable manifest is `docs/integrations/checkbox/checkbox-test-mode.env.example`. Real values remain only in local secret files outside the repository.

## First test receipt

1. Use Checkbox test-mode credentials only.
2. Verify expected organization, register, cashier, and `is_test=true`. Verify outlet only when it comes from an authoritative Checkbox source.
3. Create one park `middle` walk-in admission order.
4. Confirm payment only after readiness is fresh and ready.
5. Verify the official receipt status is terminal successful and all immutable local fields match provider data.
6. Save only sanitized receipt evidence: internal order ID, fiscal operation ID, provider receipt UUID, status, and trusted Checkbox artifact URL.

## Monitoring

Track these read-only signals:

- readiness age and readiness code;
- outbox queue depth;
- oldest pending job age;
- pending, unknown, retryable, dead, and fiscalized counts;
- shift status and shift open duration;
- provider identity mismatch incidents;
- sanitized worker errors.

## Unresolved recovery

1. Use the unresolved operations UI or `npm run checkbox:readiness-status` for scoped status.
2. For operations before `sale_submit`, requeue only safe pre-sale stages.
3. For operations at or after `sale_submit`, run lookup-only recovery with the same provider receipt UUID.
4. Never create a second sale UUID for the same payment order.
5. Escalate dead jobs with sanitized incident details before any manual correction.

## End of day

Phase 1 supports a narrow close/sync policy only. Full cash reconciliation, service operations, supervisor PIN approvals, operational reports, and auto-close are Cashier PRO and remain disabled.

The normal thin-pilot end-of-day policy is the narrow Phase 1 close flow in EventGenix:

1. Only the exact configured integration owner with `fiscal.shift.close` and an active profile/location/register binding can see and use the action.
2. The unresolved queue must be available and empty for the whole register.
3. The local shift must match the provider `OPENED` shift exactly.
4. The operator confirms the final action once. A repeated request reuses the same idempotency key, close operation, outbox job, and provider shift UUID.
5. EventGenix waits for Checkbox `CLOSED`; it never treats a submitted/closing response as final success.

Closing in the Checkbox portal is an audited recovery fallback only. After a portal close, use the read-only status/sync flow so the local shift converges to the same provider shift; never open or adopt another shift automatically.

## Refund fallback

Refunds are not active in thin MVP production mode. Until Cashier PRO is explicitly activated and tested:

- handle customer refund decisions outside EventGenix fiscal automation;
- do not mutate original fiscal receipts;
- record any manual accounting action in the approved accounting process, not in the Checkbox thin MVP ledger.

## Rollback

There are two different stops:

- Stop new payments: set `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false` or disable the specific register mapping so cashiers cannot confirm new money.
- Full emergency stop: set `CHECKBOX_INTEGRATION_ENABLED=false` to stop new provider HTTP mutations.

Rollback procedure:

1. Stop new payments first with `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=false`. Existing paid orders must stay visible in unresolved operations.
2. Drain already-paid queue where safe:
   - before external mutation, requeue only the safe pre-sale stage;
   - at or after `sale_submit`, use lookup-only recovery with the same provider receipt UUID;
   - never create a second sale UUID for the same payment order.
3. If provider or code behavior is unsafe, use the full emergency kill switch: `CHECKBOX_INTEGRATION_ENABLED=false`.
4. Keep `CHECKBOX_WEBHOOK_ENABLED=false` and `EVENTGENIX_CASHIER_PRO_ENABLED=false`.
5. If the page or routes regress, deploy the previous verified Railway release commit.
6. Run `npm run version:smoke -- https://8223324090-production.up.railway.app`.
7. Confirm `/cashier-payments` is either unavailable or shows disabled state.
8. Do not delete fiscal ledger data in rollback; this release is additive.

## Production activation data checklist

Required external inputs for a future activation task:

- FOP/legal entity key, legal name, and tax identifier;
- Checkbox organization ID, register ID, cashier ID, and optional authoritative outlet ID;
- register and cashier credential reference names;
- ref-specific environment variables for Checkbox base URL, login, password, license key, and access key;
- expected test/production mode flag;
- EventGenix user IDs for cashier and integration owner;
- accountant-approved fiscal item names, tax mode, and tax IDs;
- webhook secret and callback configuration plan, if webhook will be enabled.
