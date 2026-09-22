# SYS-MB-CLOSE-03 — bounded live role and revoke QA

Status: `EXECUTED / LIFECYCLE_PASS` (2026-09-22 UTC). The owner approved the exact block before execution. See [ROLE_QA_REPORT.md](ROLE_QA_REPORT.md) for the run, cleanup and residual HOLD. The original permission request below is retained as the approved scope, not as a request to rerun the mutations.

## Exact target and preflight

- Live and production branch at preparation: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`.
- Railway: `fortunate-appreciation / production / 8223324090`; no deploy is part of this QA block.
- Existing registered smoke QA account only. Its exact user, organization and business IDs remain in `C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922\ROLE_QA_PREFLIGHT_PRIVATE.json` and are not copied to Git. Private preflight SHA-256: `82a25cb86f7f72a2d9843768138195946766567ce511c088b08c5a859e96977f`.
- Read-only live profile: one active organization membership as `member`; Park (`event_genix`) membership is active `senior_manager` and default. Maysternya (`maysternya_doli`) and CRM memberships do not exist. Both target businesses are active.
- Before each write, recheck exact live SHA, target IDs, active organization and business, smoke account activity, Park role/default, and absence of active target membership. Any drift stops that business's QA; no automated recovery by changing another account.

## Allowed lifecycle

Using the existing creator account through the normal authenticated organization API, and the existing smoke account in one retained JWT session:

1. For `maysternya_doli` only, `PUT /api/organizations/:organizationId/members/:qaUserId` with the exact target `businessId`, `organizationRole: member`, `role: manager`, `isDefault: false`, empty extra roles and page/action overrides. Read-only check of business profile and permitted/denied surfaces.
2. Update the same membership to `admin`; read-only check. Update it to `animator` as the existing ordinary worker role; read-only check. No `worker` role exists in the canonical role registry.
3. Retain the original smoke JWT, then `DELETE /api/organizations/:organizationId/members/:qaUserId/:businessId`; confirm immediate `maysternya_doli` denial with that same JWT and that Park remains accessible/default.
4. Repeat steps 1–3 for `crm`, never with Maysternya active simultaneously. Confirm foreign-business denial after each transition.
5. In `finally`, deactivate any still-active QA target membership through the same exact API and verify both target memberships inactive, Park membership/default unchanged, and no additional active grants. Record request status and sanitized result, not tokens or personal data.

Maximum: six `PUT` role transitions and two planned `DELETE` deactivations, plus a bounded recovery `DELETE` for a target left active by interruption. No other user, organization, business, role, default, data record or public asset may be changed. No create-business, create-user, booking, payment, generation, send, export, schema, deploy, settings or secret operation. Time limit: two hours after exact approval; one QA run with at most one resumed cleanup attempt.

The lifecycle API retains two **inactive** membership rows and security audit records after deactivation; it has no safe delete operation that restores literal row absence. This is an explicit residual of the proposed test. The acceptance claim is zero **active** temporary grants, not zero new rows. If literal row cleanup is required, it is outside this block and requires a separate exact repair.

## Expected access matrix and evidence

| Checkpoint | Park | Maysternya | CRM |
| --- | --- | --- | --- |
| Before | `senior_manager`, default | no membership, denied | no membership, denied |
| Maysternya manager/admin/animator | unchanged | active, exact role | denied |
| Maysternya after revoke, same JWT | unchanged | denied immediately | denied |
| CRM manager/admin/animator | unchanged | denied | active, exact role |
| After cleanup, same JWT | `senior_manager`, default | inactive, denied | inactive, denied |

Read-only browser checks may cover switching, cross-tab, late responses, keyboard and widths 390/768/1440. A role's permitted pages must be judged against its configured capabilities; an expected 403 is not a defect. QA operations must not be counted as real traffic for the measured exit gate. Verify no jobs, sends, payments or generation were triggered. A failure remains FAIL and blocks observation start until reviewed.

This one-account lifecycle cannot prove **two-organization isolation**, simultaneous independent worker sessions, or complete enabled entry-family coverage. Those remain HOLD until separate safe evidence exists. The longest enabled cycle also remains unbounded. This block alone cannot set `observation.startUtc` or `GLOBAL_MODEL_COMPLETE`.

## Exact permission request

`Дозволяю блок SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922` for the existing smoke QA account and the six exact role transitions/two deactivations above, on the stated live target/SHA, with same-JWT read-only verification and bounded cleanup; up to two hours and one QA run. Any live SHA or profile drift requires a refreshed manifest and block.
