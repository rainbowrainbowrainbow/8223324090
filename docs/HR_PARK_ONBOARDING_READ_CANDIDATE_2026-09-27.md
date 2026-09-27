# EG-HR-17 — Park HR onboarding read candidate

## Source and ownership evidence

- Production `GET /api/version` and remote `codex/eventgenix-production` both resolved to
  `18be138847f34a0ba935dd52d6dc6bedea9fdcb3b`, version `0.82.20`, before this
  feature worktree was created. The worktree starts at that commit.
- During implementation, production advanced to the certificate release:
  live `acbd1f62ed51ce16b6b0469023f4225c8bef6d7a` (`0.82.21`) and remote
  `3c8aff0c88c468d82edf383467b1fe794323a43d`. The feature merged that remote
  production tip through ordinary Git history, preserving its certificate changes,
  migration/test coverage, release markers and CI workflow. This feature does not
  alter the current `0.82.21` release markers or deploy to production.
- `docs/PARK_STAFF_SCHEDULE_READ_RECOVERY.md` records the owner's decision that the
  existing `staff` namespace belongs to Park. Account membership is not the owner
  key for a staff row. It remains mandatory for the *requesting viewer*.
- An aggregate audit on 2026-09-27 at 09:32 UTC used `eventgenix_audit_ro` inside
  `REPEATABLE READ READ ONLY` with a 10-second statement timeout. It returned seven
  `onboarding_progress` rows, all general and all linked to existing staff. Both
  templates are referenced by those rows; no progress/template/staff/responsible
  orphan was found. All 20 generated onboarding tasks have `event_genix` context,
  a valid progress source and a task owner matching the assigned responsible user.
  Four distinct responsible identities are active and have Park in their legacy
  context mirror; one also has another legacy context. The mirror is not used as
  authorization. Current target membership is checked by SQL at request time.
- A second aggregate snapshot at 09:45 UTC found one new staff row since
  2026-09-14, one active linked account/profile, one matching controlled-account
  onboarding security event and no non-Park legacy account context.
- The audit role cannot select organization or business membership registry tables.
  No DB lease was requested or used. The exact current membership count for linked
  accounts is therefore **not freshly audited** by EG-HR-17.

## Exact read boundary

Only these Park `GET` routes are added to the legacy surface allowlist. They require
a fresh single-business Park membership, matching active business and organization
IDs, and `hr.staff.view`:

| Route | Park response |
| --- | --- |
| `/api/hr/onboarding` | General progress anchored to Park staff, task counts from Park-context tasks only, safe checklist titles/completion and current-member responsible display name. Unsupported profession filters return `403 staff_not_migrated`. `onboardingAccess.partial` and `readOnly` disclose the limitation. |
| `/api/hr/onboarding/templates` | Only templates referenced by general Park progress; id, name and department. |
| `/api/hr/onboarding/responsible-candidates` | Existing task-owner directory requires active business/organization membership using the requester's IDs. Response retains only id, display name and label. |

The general list omits usernames, account roles, contacts, account privileges,
compensation, task titles/descriptions and free-text checklist notes. If a
responsible identity lacks a current valid Park membership, its identity is
suppressed and `responsible_restricted` is true. The UI distinguishes that state
from an unassigned responsible user and disables writes in the Park read-only lane.

**HOLD:** `GET /api/hr/staff/:id/onboarding-assignment` and
`GET /api/hr/staff/:id/onboarding-processes` remain behind `staff_not_migrated`.
Their current implementation joins profession checklist/readiness data without a
proven owner, and the modal also depends on the separately blocked
`GET /api/hr/staff/:id/role-assignments`. Profession progress and these joins need
their own ownership decision and scoped response before being opened. No prefix
allowlist, account options or write route changed. `GET /api/users/onboarding/options`
still requires `manage_accounts` plus `hr.staff.manage`.

## Linked account without membership

The current read-only aggregate found one staff row created since 2026-09-14 with
an active linked profile and account carrying only Park in its legacy context
mirror. It cannot verify current membership tables. The previous authorized
registry audit recorded one such linked account with no active organization or
business membership. `createAccountOnboarding()` commits staff, user, profile and
audit events, returns a one-time credential with `loginReady=true`, but does not
create membership. The live membership-enabled Park authorization requires both
memberships. **This is an account-activation lifecycle defect in the issued
"login ready" contract, not a reason to change staff ownership or bypass HR
membership checks.** A password check alone does not establish Park access.

Separate remediation proposal, requiring account/security owner approval:

1. Decide whether controlled account onboarding is meant to activate Park access
   immediately. If yes, create the organization and business memberships in the
   same audited, authenticated lifecycle transaction, with explicit business and
   organization IDs, role mapping and rollback on failure. Define what the receipt
   means if activation is intentionally deferred.
2. Add disposable PostgreSQL tests for credential issuance, fresh membership
   authority, wrong organization, retry/idempotence and rollback; do not infer
   membership from `users.business_contexts` or employee-profile linkage.
3. Before any existing-account repair, repeat a read-only registry/provenance
   aggregate under separately authorized access. Obtain an explicit bounded data
   remediation approval for exact eligible accounts, execute through membership
   management with audit events, and verify before/after fingerprints. No grant or
   account write is part of EG-HR-17.

## Verification and release gate

The feature adds a real Express-router regression for allowed reads, capability,
foreign business/organization, revoked or stale membership, multi/all scope,
unsupported profession scope, denied staff-specific routes/writes, payload masks
and 500 handling. `npm test` and exact-SHA CI are required before review. This
candidate is not deployed; live QA after a separate release is test-account GET
only, including restricted/error/retry states. A fresh ownership check remains a
release gate if onboarding rows or identity/membership signals change.
