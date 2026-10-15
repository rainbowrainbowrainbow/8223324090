# EG-HR-16/17 — Park profession/checklist ownership and feature handoff

## Human owner decision

On 2026-10-15 the product owner explicitly confirmed that the existing professions,
checklist templates and employee progress belong exclusively to Park. This decision
supersedes the historical unknown-owner HOLD for these datasets only. It is not a
claim that zero orphan records proves ownership. Training, compensation, account
identities and conditions remain outside the ordinary read projection.

## Base and authorization

- Feature: `codex/hr-park-checklists-onboarding-20261015`.
- Confirmed production base: `6de1d0344e5d0e00318a86dcfd8d775133793b70`, v0.82.95.
- Base CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/38715284868
- Product scope: the six exact GET routes from EG-HR-16/17. No wildcard permission.
- No production push/deploy, membership writes, new DB grants or schema changes.

## Fresh aggregate audit

At 2026-10-15T20:57:21Z, `eventgenix_audit_ro` used a
`REPEATABLE READ READ ONLY` transaction and rolled back on completion.
Existing SELECT privileges sufficed; no lease or admin connection was used.

| Aggregate | Result |
| --- | ---: |
| Professions | 35 |
| Checklist items | 93 |
| Employee checklist progress | 7 |
| Staff assignments | 264 |
| Staff | 217 |
| Onboarding progress | 7 |
| Onboarding templates | 2 |
| Item orphans | 0 |
| Invalid progress links / profession mismatch | 0 |
| Assignment orphans | 0 |
| Onboarding orphans | 0 |
| Linked non-Park/unknown-context onboarding tasks | 0 |
| Linked Park onboarding tasks | 20 |

Ten new read queries also passed read-only EXPLAIN against the current schema.
Reproduce using `node scripts/audit-park-profession-ownership.cjs`, with only
`PRODUCTION_READONLY_DATABASE_URL` loaded process-locally. Output is aggregate-only.
The script refuses a different role; it never falls back to admin credentials.

## Read contract

- `GET /api/hr/checklists/dashboard`: active assignment readiness and template counts.
  Archived/orphan history counts are unknown, not zero, and remain excluded.
- `GET /api/hr/professions/:professionKey/checklist`: minimal canonical template.
- `GET /api/hr/professions/:professionKey/staff/:staffId/checklist`: canonical readiness
  only for an existing staff/profession assignment; missing association is 404.
- `GET /api/hr/professions/workspace/:identity`: read-only display identity, assigned
  people and checklist for ordinary staff viewers. The separately authorized existing
  payroll-viewer workspace retains its original gate and handler.
- `GET /api/hr/staff/:id/onboarding-assignment` and `/onboarding-processes`:
  display/progress fields plus minimal profession assignments. No dependency on the
  wider `/role-assignments` API for this read-only dialog. Responsible account identity
  is explicitly restricted rather than inferred from legacy user links.

All new membership-mode reads require current single Park membership, matching
business/organization IDs and `hr.staff.view`. Other businesses, revoked/stale
memberships and multi/all scope are denied. No schedule conditions, rate sources,
training catalog, medical or account data are queried. Existing compatibility-mode
behavior and the partial professions catalog remain unchanged.

## Verification status

- Actual Express HR-router negative/positive suite: 7 tests passed, covering all six
  GETs, denied membership/capability/scope, 404/500, field projection and closed writes.
- Synthetic Chromium read-only UI smoke: passed workspace 403/500/offline and Retry,
  both delayed context directions, onboarding without role-assignment fetch, and
  stale dialog invalidation. This is not live QA.
- Checklist quality browser: 94/94; existing onboarding browser: passed.
- Team/Structure/Check-in/payroll masking browser suite: passed.
- Schedule/Today/card recovery suite: 99/99 after replacing historical GET-HOLD
  expectations with the new authorized GET coverage and retained HEAD/write denials.
- Core baseline unit suite: 3883/3883. An earlier full baseline stopped on those
  historical expectations; the corrected focused suite passed. Full rerun and
  exact feature-SHA CI are delivery gates, not claimed complete at this commit.
- Mobile read-only workspace inspected at 390 px; no compensation controls.
- Production remains unchanged. Final release needs fresh base/ownership checks,
  exact-SHA CI and separately authorized deployment followed by test-account GET QA.
