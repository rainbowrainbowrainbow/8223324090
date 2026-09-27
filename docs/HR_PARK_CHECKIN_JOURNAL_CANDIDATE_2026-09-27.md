# EG-HR-19 — Park Check-in picker and journal candidate

## Source and ownership

The initial live `/api/version` was `0.82.21` on
`codex/eventgenix-production` at
`acbd1f62ed51ce16b6b0469023f4225c8bef6d7a`. This feature started from
remote production `81717114a1eaa55d9fc976e80b29099211d8f2b0`
(`0.82.22`). A later read-only check found live `/api/version` at the same
`0.82.22` SHA and branch; the initial deployment lag has cleared.

The existing `GET /api/staff` route returns `{ success: true, data: [...] }`,
but the Check-in picker only accepted an array or `staff.staff`; a successful
Park GET therefore looked like a failed picker. The current journal handler
also selected `sc.*`, returned a raw array and changed a missing-table error
into a successful empty list.

`docs/PARK_STAFF_SCHEDULE_READ_RECOVERY.md` records the owner decision that
the existing staff namespace belongs to Park. `staff_checkins` has a required
foreign key to `staff`, no business-context column, and the existing write
routes are behind the Park legacy business guard. An aggregate production
audit under the dedicated `eventgenix_audit_ro` role in a
`REPEATABLE READ READ ONLY` transaction at `2026-09-27T11:32:24Z` found zero
check-in rows, orphan rows, missing dates and empty-time rows. Thus no
existing row contradicts the Park owner decision. The new journal SQL was
also validated against the production schema with read-only `EXPLAIN`.
There were no new grants, real-data changes or biometric reads in this audit.

## Boundary and behavior

Only exact `GET /api/staff/checkins` can use the Park recovery. It requires
current single-business Park membership, matching business/organization IDs
and `hr.today.view`. Its response allows only date, check-in/check-out time,
status and safe display name. It does not return raw check-in rows, staff IDs,
attendance method, face vectors, account data or payroll fields. A failed SQL
read is a 500, not an empty-success response.

The picker accepts the real staff envelope and rejects unsuccessful or
malformed payloads. The journal loads before the optional biometric model and
descriptor dependencies, so Park can read it even while recognition remains
restricted. Journal retry repeats only its GET and never starts the camera.
Browser-visible names are rendered through `textContent`. The existing
biometric descriptor GET and all attendance/face POST routes remain closed.

## Verification and next gate

Real Express tests cover allowed Park, missing capability, foreign business
or organization, revoked/inactive/mismatched membership, multi/all scope,
bad date, 500, no sensitive fields and blocked HEAD/POST/descriptor paths.
The browser smoke uses the actual Express envelope shape, checks real clicks,
403/malformed/retry, journal separation, no POST on page load, and desktop/
mobile layout. Screenshots are local ignored artifacts under
`output/playwright/checkin-journal-browser-smoke/`.
The static UI smoke also asserts that the HR browser job still runs its
existing scenarios and adds the Check-in smoke, while preserving the Today
attendance sync assertion under the validated journal date parser.
On Node 22.23.1/npm 10.9.8, focused Express/UI tests, the Check-in Playwright
smoke, `npm run test:ui` and the full `npm test` baseline passed locally.

The feature may be pushed for exact-SHA CI. Production integration and live
test-account GET QA require a separate release, a fresh ownership check and
version/source alignment. No positive live journal row exists at this audit;
the positive journal flow is therefore proven with synthetic route/browser
fixtures until a separately authorized safe fixture is available.
