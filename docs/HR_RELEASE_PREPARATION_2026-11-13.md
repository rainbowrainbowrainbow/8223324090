# HR release preparation

The production baseline observed on 2026-11-13 was v0.83.45,
`dd511e2f0da52da1401502991a68d476eee9ce44` on
`codex/eventgenix-production`. Railway reported a successful deployment on
`fortunate-appreciation / production / 8223324090`. The HR branch includes
that baseline and preserves the prior HR changes.

## Functional scope

- Personal HR deadlines are computed from active linked staff records, scoped
  to the request's authorized businesses. Both My Day and the alert center
  use the same projection. Resource reminders start seven calendar days before
  the due date, medical-book reminders fourteen days before expiry. The
  transition to overdue, due-date changes and closure are reflected on refresh.
- Migration 392 adds a nullable business key for new resource issues.
  Existing warehouse issues can use their warehouse context. Legacy issues
  without authoritative context stay out of personal reminders and HR can see
  a prompt to handle them manually. No historical data is backfilled.
- The existing shared Telegram digest excludes medical-book records. Its
  daily success marker is saved after a successful delivery. Expiry
  reconciliation now runs independently of whether upcoming rows exist.
- Restricted staff are routed to the schedule. The timeline date reads,
  resource reads and event delivery apply the page policy. The booking detail
  contract and its protected hashes are unchanged.
- The UI separates full name and login at entry, in profile settings, in HR
  and in the account handoff.

## Role audit and live acceptance

- Read-only browser review in Park HR returned eight active cards from the
  query for trampoline work; all eight showed no linked CRM account. This
  search is not a full audit of account and membership roles.
- `scripts/audit-hr-timeline-roles.js` lists IDs, effective roles and page
  access by business for linked active trampoline instructors who have
  the animator role in that business. It also counts the pending expiry
  transitions by business in the same read-only snapshot. Run with an
  authorized `PRODUCTION_READONLY_DATABASE_URL` or its audit-specific
  alias `HR_ROLE_AUDIT_DATABASE_URL`. No account role writes
  are part of this release. Review any genuine animation duties before
  proposing a separate, exact correction.
- The production test credentials file specified by the runbook was absent.
  Use a disposable account for live checks; no real employee receives test
  messages or assignments. Existing Park stock `QA-HR-LIGHTERS-20261113` is
  retained and is not a disposable QA fixture.
- The corrected scheduler can transition real active, past-due certification
  records to expired after deployment. Before release execution, obtain a
  fresh read-only count and separate bounded approval for that side effect
  under the production runbook. The role audit, count and any real-data
  approvals remain separate from the release envelope.

## Release envelope preparation

Candidate version: v0.83.47. The parallel HR Team Pulse branch already has a
v0.83.46 candidate. Refresh live version, remote production SHA, nearby
release refs and pending Railway deployments before presenting the envelope.

Destination: `codex/eventgenix-production`. Use a normal fast-forward push,
require successful CI on that exact pushed SHA, then use
`npm run release:railway-up` and verify the live manifest metadata.
No production QA writes are included in this draft. Retain the nullable
column on binary rollback. Roll back to the verified prior live SHA only
through the documented release helper. Prepare the final Yellow envelope with
the exact candidate and verified rollback SHA once prerequisites are met.
