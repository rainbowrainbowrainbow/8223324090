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
   `npm run configure:checkbox:park -- --config-file C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json`.
7. Run preflight with the same config file only after dry-run is clean:
   `npm run configure:checkbox:park -- preflight --config-file C:\Users\Plotva\.eventgenix\checkbox-park-test.config.json`.
8. Keep raw Checkbox credentials in the local env file only. Do not put password, PIN, license key, access key, token, webhook secret, or price overrides into the JSON config.
9. Run the Checkbox test-mode smoke only when `/cashier/me` proves the cashier is test-mode.
10. Enable the pilot register only after successful preflight and explicit activation approval.
11. Turn on `CHECKBOX_ACCEPT_PAYMENTS_ENABLED=true` only in the separate controlled payment activation task.

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

If production activation starts before Cashier PRO, the accepted end-of-day policy must be one of:

- close in the Checkbox portal and sync local status read-only; or
- use the narrow Phase 1 close flow that blocks on pending, unknown, retryable, or dead fiscal operations.

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
