# HR Park staff card: release preflight (2026-09-25)

Production impact: yes. This is evidence for EG-HR-02 through EG-HR-06, not a release authorization.

## Production identity and source drift

- Read-only `GET /api/version` reported version `0.82.15`, source branch `codex/eventgenix-production`, and SHA `e1694b9e0a96883960ad37fd0be32c2d2c817362`. `git ls-remote` and a subsequent fetch found the same branch SHA.
- The original, still-dirty HR worktree is detached at `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79` (`0.82.11`) and remains untouched. A second isolated candidate worktree, `hr-park-card-current-20260925`, was created directly at the verified live SHA and placed on local branch `codex/hr-park-card-read-20260925`. The scoped uncommitted HR changes were copied into it. For the three upstream overlaps, `checkin.html` and `hr.html` retain the current `0.82.15` asset tags and `package.json` retains the current production version/release label while adding the focused test script entries. No commit was made in either worktree.
- Explicit, read-only Railway status resolved project `fortunate-appreciation`, environment `production`, and the `8223324090` service. The old HR worktree is not Railway-linked; do not use raw `railway up` from it.

## Read-only staff provenance and dependencies

The production DB role was checked inside `BEGIN READ ONLY`: `transaction_read_only=on`, with no `INSERT`, `UPDATE`, or `DELETE` privilege on `public` tables. Queries returned aggregates only; no staff IDs, names, contacts, tokens, or row contents were output.

| Check | Aggregate result |
| --- | ---: |
| All `staff` rows | 217 |
| `staff.created_at >= 2026-09-14` | 1 |
| New rows with `account_onboarding_created`, `staffCreated=true`, and audit `businessContexts=[event_genix]`, `defaultBusinessContext=event_genix` | 1 |
| New rows linked to an active Park-only account through an active employee profile | 1 |
| New rows linked to an account with another business context | 0 |
| Explicit non-Park context signals on staff-linked schedule/time records | 0 |
| `staff_certifications` with `business_context IS NULL` | 2; neither belongs to the new row |
| Resource assignments pointing to Park stock | 2; neither belongs to the new row |
| Resource assignments pointing to non-Park stock | 0 |
| Orphan certifications, resources, schedules, or time records | 0 |

The one new row has a stronger provenance chain than account context alone: `createAccountOnboarding()` creates the staff row, account, employee-profile link, and `account_onboarding_created` audit event in one transaction; the audit records `staffCreated` and the Park-only contexts. Existing rows remain covered by the 2026-09-14 owner decision recorded in `docs/PARK_STAFF_SCHEDULE_READ_RECOVERY.md`. `staff` still has no row-level business owner column, so this is a conditional Park-only namespace finding, not a general multi-business ownership proof. The two NULL-context certifications remain outside the base card and require a separate medical-data decision.

Immediately before release, repeat the aggregate provenance check for all rows created since 2026-09-14. If any row lacks Park-only provenance or has a non-Park signal, stop the Park-wide list/detail release and establish an explicit ownership mapping first. Never substitute production write credentials for this read-only check.

## Regression evidence and open gates

- Actual Express router tests with synthetic DB/membership cover exact GET paths, Park membership, capability denial, foreign organization/business, revoked/inactive membership, aggregate scope, 404, field projection, and Schedule/Today isolation.
- The HR Team browser smoke passed in both worktrees, including the production `loadTeam()` function under synthetic 403, 500, offline, retry, and late cross-business response, followed by the existing card/tab/focus/draft scenarios.
- Focused Node suites passed: 61/61 staff/schedule/Today tests via the repository's `npm run test:staff-schedule-recovery`, and 113/113 adjacent HR/Check-in tests using Node 22 with `--experimental-test-isolation=none`. The default sandbox invocation of the spawned script returned `spawn EPERM` before running tests; the same official script passed with managed escalation. `npm run check:runtime` passed on Node 22.23.1/npm 10.9.8, and `npm run check:syntax` parsed 1301 JavaScript files successfully.
- The full local `npm test` baseline passed in both worktrees with managed escalation and Node 22/npm 10, including 1323 static UI checks and the staff-schedule recovery suite. The current-SHA candidate also passed `npm run check:version` with all `0.82.15` references in sync, 61/61 focused recovery tests, 113/113 adjacent HR/Check-in tests, the HR Team browser smoke, and `git diff --check`. These local results do not replace the disposable PostgreSQL or exact-SHA CI gates.
- A new actual-app/disposable-PostgreSQL regression is in the existing permissions integration suite. It creates an isolated Park membership and staff fixture, then checks list/detail, masking, 404, foreign context, aggregate scope, capability denial, and adjacent route denial. It passed locally when selected by `ISOLATED_TEST_NAME_PATTERN` against a dedicated PostgreSQL 16 cluster on WSL localhost. The fixture now applies payroll/staff denies to the effective business membership and verifies the resulting capability snapshot after login; an initial fixture-only failure would otherwise have overstated payroll leakage.
- The complete isolated permission suite passed 9/9 under Linux Node 22/npm 10 against the disposable PostgreSQL 16 cluster. Existing permission-contract tests had first produced intermittent `auth_session_revoked` immediately after access PATCH/relogin. The test-only login helper now waits 20 ms so that replacement `sessionIssuedAt` is later than the revocation timestamp at JWT millisecond precision. No production authentication code was changed. Mixed Windows/WSL attempts remained unsuitable for this suite: the WSL clock was measured approximately 58 seconds behind Windows, and `refresh_tokens.created_at` is a timestamp without time zone while `session_revoked_at` is a timestamp with time zone. CI must still pass the complete isolated job on the exact candidate SHA.
- No commit, push, CI run for a candidate SHA, deployment, or live-site QA of the new HR behavior has occurred. The current production site still runs the old HR behavior.

Release remains blocked on exact-SHA CI gates, refreshing the read-only ownership audit, and a separately authorized production delivery. Base-card access must not be generalized to other HR routes, writes, payroll, medical data, resources, or Check-in.
