# Checkbox Thin MVP Operations Runbook

Status: production deployment runbook for disabled fiscal mode. Production activation is a separate task.

## Default production state

- `CHECKBOX_INTEGRATION_ENABLED=false`.
- `EVENTGENIX_CASHIER_PRO_ENABLED=false`.
- Checkbox webhook configuration is not applied.
- Fiscal register mappings remain disabled until an explicit operator preflight and enable command.
- No production fiscal operation, refund, service operation, or preschool profile activation is part of this release.

## Activation checklist

1. Confirm production `/api/version` matches the intended release commit.
2. Confirm the active deploy branch is the branch that contains the release commits.
3. Collect accountant-approved FOP/legal entity data, fiscal item names, tax mode, and tax IDs.
4. Collect exact Checkbox test-mode organization, outlet, register, cashier, and credential reference names.
5. Store raw Checkbox credentials only in environment variables outside the repository.
6. Run `npm run configure:checkbox:park -- preflight` with value-free command history or a sanitized operator shell.
7. Run the Checkbox test-mode smoke only when `/cashier/me` proves the cashier is test-mode.
8. Enable the pilot register only after successful preflight and explicit activation approval.

## First test receipt

1. Use Checkbox test-mode credentials only.
2. Verify expected organization, outlet, register, cashier, and `is_test=true`.
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

1. Keep `CHECKBOX_INTEGRATION_ENABLED=false` and `EVENTGENIX_CASHIER_PRO_ENABLED=false`.
2. If the page or routes regress, deploy the previous verified Railway release commit.
3. Run `npm run version:smoke -- https://8223324090-production.up.railway.app`.
4. Confirm `/cashier-payments` is either unavailable or shows disabled state.
5. Do not delete fiscal ledger data in rollback; this release is additive.

## Production activation data checklist

Required external inputs for a future activation task:

- FOP/legal entity key, legal name, and tax identifier;
- Checkbox organization ID, outlet ID, register ID, cashier ID;
- register and cashier credential reference names;
- ref-specific environment variables for Checkbox base URL, login, password, license key, and access key;
- expected test/production mode flag;
- EventGenix user IDs for cashier and integration owner;
- accountant-approved fiscal item names, tax mode, and tax IDs;
- webhook secret and callback configuration plan, if webhook will be enabled.
