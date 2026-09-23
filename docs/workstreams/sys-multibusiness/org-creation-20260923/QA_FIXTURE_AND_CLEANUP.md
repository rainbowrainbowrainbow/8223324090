# Organization creation — bounded live QA registry and cleanup

Status: `PREPARE_ONLY`. No fixture has been created. This document is not a production data authorization.

## Registered fixture envelope

Use the existing verified organization owner and existing smoke QA account only; no new user account. The owner's source organization, both user IDs, baseline memberships/defaults, current live SHA, and empty fixture slug/context must be verified in a private read-only preflight and stored outside Git. Do not put names, credentials, JWTs, or private IDs in reports.

Maximum planned writes through the normal authenticated lifecycle API after deployment and exact approval:

1. One `POST /api/organizations` with the verified source organization, exact slug `sys-mb-org-qa-20260923` and clearly marked QA name. The slug must be absent in fresh preflight. Capture exact returned organization ID and `created_by_user_id` predicate.
2. One `POST /api/organizations/:organizationId/businesses` with exact context `sys_mb_qa_20260923`, QA-only labels, and **zero enabled modules**. The context must be absent in fresh preflight. Do not initialize resources or create operational records. Capture exact returned business ID.
3. At most two `PUT /api/organizations/:organizationId/members/:userId`: owner gets an explicit business `director` membership; existing smoke account gets organization `member` and business `animator`, both `isDefault=false` and empty extra roles/overrides. The owner membership of the organization itself is created by step 1. Do not modify Park/Dar/MD/CRM memberships or any user's existing default.
4. Read-only browser/API checks: owner sees two organizations; admin/worker cannot create an organization; the smoke account sees only its explicitly assigned QA business in the second organization; a foreign user cannot read it; legacy four-business access/defaults remain unchanged; keyboard, cross-tab, late response, 390/768/1440, and console/network checks. Keep same-JWT revoke as a separate controlled check of the QA membership only if the block explicitly permits its `DELETE`; previous MD/CRM same-JWT evidence is not repeated.

QA TTL: at most two hours after fixture creation; one creation run and one bounded cleanup/resume. No sends, payments, Telegram, generation, export, bookings, clients, tasks, catalogs, jobs, or public links. Controlled QA traffic is excluded from the real-traffic compatibility denominator.

## Exact cleanup contract

There is no штатний organization/business hard-delete lifecycle API. `DELETE` membership merely deactivates and retains a row. Literal zero-fixture cleanup therefore requires an **additional exact Red data cleanup authorization** in the same approved block, and direct DB access must be explicitly scoped to the registered IDs/slug/context. Do not treat deactivation as zero new rows.

Before any cleanup, acquire a transaction lock and compare the captured receipt IDs, slug, context, `created_by_user_id`, creation window, exactly one registered business, owner + smoke QA membership rows, and unchanged baseline defaults. Require zero operational records, resources, active jobs/outbox, public links/assets, cutover journal rows, or other foreign-key consumers under the QA context. Delete only the registered business-membership rows, organization-membership rows, business and organization in child-to-parent order with exact ID + key + creator predicates and expected row counts; retain security audit evidence. A mismatch aborts the transaction and leaves the fixture inactive for reviewed forward repair. Never use broad `TRUNCATE`, `CASCADE` cleanup, or a filename/username-derived mapping.

Post-cleanup proof: zero matching QA organization/business/membership rows; no active temporary grant; no new jobs or sends; owner/worker Park defaults and all pre-existing business access unchanged. If the block does not explicitly authorize this exact cleanup, run read-only QA only and mark two-organization live acceptance `NOT_TESTABLE` instead of creating a fixture that cannot be removed.
