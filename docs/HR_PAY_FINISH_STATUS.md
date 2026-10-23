# HR-PAY finish status — 2026-10-23

Production impact: yes. This is a work report; no production code has been released, no payroll data was changed, and no deployment was attempted.

## Verified source and release status

- Verified live `/api/version` and `origin/codex/eventgenix-production`: `968bb497a4dcf48de6f67e5a6ebdc3f5a956c466`, version `0.82.110`, branch `codex/eventgenix-production`. Live deployment metadata is complete and manifest-backed.
- Exact-SHA GitHub CI: run [39931933693](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/39931933693), `CI`, completed successfully for that SHA.
- Candidate worktree: `codex/hr-pay-finish-20261023`, based directly on the verified SHA. The original checkout was dirty and 926 commits behind; it was not edited.
- The previous v0.82.57 HR-PAY release is historical and is not the current production base.

## HR-PAY-14 read-only audit

Two sources were kept separate. The live API audit ran for `2026-10-23` using login and GET requests only. It saw 46 active staff and 59 staff-profession pairs; its catalog projection was partial, and role assignments, one-day exceptions, and payroll schemes/monthly norms were unavailable. It found six admission exceptions and did not prove a missing effective rate. Those rates remain unverified in this source.

The owner-authorized database audit used `TRUSTED_QA_OPERATOR_DATABASE_URL` in a `REPEATABLE READ READ ONLY` transaction and rolled back. The staff and payroll tables are the Park-only namespace confirmed by the owner on 2026-09-14 (`services/parkStaffScheduleAccess.js`); the payroll runtime ownership guard in `services/parkHrPayrollAccess.js` rejects unowned/foreign attendance, and a live Park payroll-conditions GET returned 200. No write, migration, or payroll mutation occurred.

The direct database report is `output/hr-pay/hr-pay-14-readiness-2026-10-23-database.json`. It separates 56 active core staff (69 profession pairs) from 111 `hr_pool_status=reserve` records (174 pairs, including one active reserve record). The direct source had complete catalog, roles, profiles, assignments, legacy rates, exceptions, and schemes coverage. Findings were:

| Pool | Proven missing effective rate | Admission not approved | Monthly norm unconfirmed | Other unverified pairs |
| --- | ---: | ---: | ---: | ---: |
| Core | 66 | 6 | 1 | 9 |
| Reserve | 87 | 26 | 4 | 11 |

The top-level report status is `PARTIAL`: nine core pairs have an unverified role assignment, in addition to findings that need owner decisions. The 111 reserve records are a separate optional/historical pool. Their resolver pass temporarily treats records as active in memory only to evaluate configuration; it does not mark them active or make them a required setup list. The reserve pass also has 11 pairs with unverified role assignments. Additional professions are potential configuration checks. No rule was inferred that every additional profession needs pay, and no admission was auto-approved.

The private sanitized owner list is stored locally at `output/hr-pay/hr-pay-14-manual-review-2026-10-23.md` (157 rows). It contains only staff ID, profession, core/reserve pool, primary/additional role, reason, and a Park-context HR deep link; no names, rates, payroll sums, contact data, authors, or free text. The file is ignored by Git and will not be pushed. It is a review aid and does not authorize rate entry. The authoritative real rate source and owner approval are still required; no amounts were invented.

The API count (46 staff) and direct database count (56 core plus reserve) differ because they are distinct access/source views. They are not merged into one roster. The database report is the broader current read-only source for this manual review.

## HR-PAY-15 implementation

- Added the existing `#copyWeekBtn` action to the shared weekly schedule header and retained the `hr.schedule.manage` permission boundary.
- The confirmation names the source and target weeks and says exactly: `Разова ставка не копіюється. Для нової дати застосовуються чинні умови оплати.` It omits technical copy mode and staff IDs.
- The handler freezes the department/mode/visible staff IDs and dates before the dry-run request; a pending guard blocks duplicate clicks.
- The new UI request sets `rejectConflicts`. Inside the existing transaction, after ordered staff locks and a fresh source read, the route counts occupied target dates across `staff_schedule` and canonical `hr_shifts`. Any conflict returns 409 and rolls back before writes. The old API default remains compatible for other callers.
- Existing resolver behavior remains: the target date is resolved fresh, target-date terms apply, and `payroll_day_exceptions` are not copied. The day plan continues to copy time segments, breaks, professions/additional roles, and notes without changing payroll formulas or multiplying simultaneous roles into physical hours.
- HR deep links use `/hr?businessContext=park&employee=<id>&profileTab=payroll&profession=<key>&payDate=<date>#team`.

The schedule uses a 9-day rolling window. The copy action identifies and previews the explicit 7-day source period at the start of that window, then targets the next 7-day period. It does not copy the full 9-day display window.

## HR-PAY-16 manual entry status

The private sanitized manual review list is ready for the owner, but entry is `BLOCKED` until the authoritative rate source, effective dates, and owner-approved values are supplied. This is a data-entry blocker only; no rates, norms, or admission decisions were invented or written. The core/reserve distinction and optional historical reserve pool remain explicit in the private list.

## HR-PAY-17 exact-SHA verification

Candidate feature SHA `cac8f4d935396edd5cb9457de4c9cfcdf6e6a794` passed the exact GitHub Actions HR/PostgreSQL integration job and Fast baseline in run [39946315481](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/39946315481). The HR actual-app browser evidence is synthetic-only (`productionWrites: 0`) and is saved as CI artifact [hr-pay-actual-app-browser](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/39946315481/artifacts/12498916601). Its journey evidence reports `PASS` for the HR profile card, schedule copy preview/write, exception conflict, draft return, salary restriction, missing-mirror conflict, attendance, salary breakdown, and membership/security boundaries. The browser measured 330 physical minutes with a 30-minute break, then 5.5 physical hours and one additional-profession pay line. The exact actual-app copy response is checked through the Park projection's permitted fields (`copyMode`, `staffCount`); exact `staffIds` are asserted on the request and against the UI-visible synthetic fixture, while the target is checked in isolated PostgreSQL.

The HR job also runs `tests/integration/payroll-profiles-conditions.integration.test.js`, covering idempotency and concurrency, frozen clock-in snapshots, future-plan voiding, monthly plus day top-ups, one monthly group payment, absence handling, and closed-period snapshots. The actual-app browser test covers hourly, daily, and monthly conditions, additional profession pay without multiplying physical hours, date-specific exception behavior, and restricted salary access. The current whole-workflow run is still pending while unrelated browser jobs finish; no result is claimed for those unfinished jobs. A final status commit adds a target-range readiness barrier after copy confirmation so follow-up assertions wait for the target's committed range. A release/version commit and its own exact-SHA green CI are still required before preparing a fresh production manifest.

The initial copy-week actual-app failure at preview reported 371 target conflicts because the test accidentally used the raw `animators` department scope; those were real existing target records and the conflict guard correctly refused the operation. The fixture now uses the supported `reception` explicit-staff category and UI search, and asserts the sole visible synthetic staff ID and exact request scope. A later test assertion expected `staffIds` in the response, but the Park projection intentionally masks that field; the test now checks the allowed `staffCount` response and keeps exact-ID assertions on the request and isolated database. No projection or access mask was changed.

## Reproduction and exact audit command

Open `/staff`, load the current 9-day rolling schedule, and use `Копіювати тиждень`. The action previews the explicitly shown 7-day source period, requires confirmation, and rejects any existing target schedule or canonical HR plan. A race after preview is rechecked under staff locks and returns 409 without writing.

Live API read-only audit:

```powershell
. 'C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1'
$env:NODE_PATH='C:\Users\Plotva\OneDrive\Документи\EventGenix\node_modules'
$env:HR_PAY_QA_USER=$env:LIVE_CREATOR_USER
$env:HR_PAY_QA_PASS=$env:LIVE_CREATOR_PASS
node scripts/audit-hr-pay-readiness.js --date 2026-10-23 --source api --output output/hr-pay/hr-pay-14-readiness-2026-10-23.json
```

Owner-authorized direct database audit:

```powershell
. 'C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1'
$env:NODE_PATH='C:\Users\Plotva\OneDrive\Документи\EventGenix\node_modules'
node scripts/audit-hr-pay-readiness.js --date 2026-10-23 --source database --output output/hr-pay/hr-pay-14-readiness-2026-10-23-database.json
```

Local checks on Node 22.23.1/npm 10.9.8 passed: four targeted Node test files, `npm run test:ui` (1327 static checks, 4 code-splitting tests, 16 timeline-settings tests), and the mocked schedule browser smoke. Logs are in `output/hr-pay/hr-pay-runtime-2026-10-23.log`, `hr-pay-targeted-tests-2026-10-23.log`, and `hr-pay-ui-check-2026-10-23.log`. The actual Express/PostgreSQL browser suite could not run locally because the isolated runner requires `TEST_DATABASE_URL` and Docker Desktop's Linux engine is unavailable; it did not fall back to `DATABASE_URL`. The same actual-app suite passed on the disposable PostgreSQL CI runner above.

No production release has been prepared or uploaded. A new version/cache/changelog commit and exact release manifest remain gated by successful exact-SHA CI and an actual new human confirmation phrase. No production branch push or Railway deploy is authorized until that confirmation is supplied.
