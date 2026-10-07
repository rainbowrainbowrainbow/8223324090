# EDU-READY-08A — teacher membership

Production impact: yes, after a future release. Local-only authorization: additive membership schema and synthetic UI/API/SQL verification. No production data mutation, backfill, commit, push or deploy.

## Pre-edit diagnosis and proposed model

Symptom: a new staff teacher without an education group is absent from both group and canonical lesson pickers; no education UI creates that first assignment. Expected: explicitly scoped new teachers are available before their first group/lesson. Root cause: `educationGroups.listTeachers` derives its directory solely from existing group references.

The existing357 `business_memberships` table associates user accounts, not staff. Employee profiles may link a user, but teacher records can legitimately have no account; deriving teacher ownership from account access would exclude those teachers and couple scheduling to login permissions. Neither historical lesson metadata nor global staff search proves ownership.

Recommended minimal model: empty additive `education_teacher_memberships` table, `(business_context, staff_id)` primary key, staff FK with RESTRICT, scoped active flag and creation/update audit actor/time. The business context follows existing372 education tables. No migration backfill or auth/role changes. New teachers are created atomically as minimal staff + explicit membership through the existing create-booking/context gate. Updates deactivate the scoped membership, never global staff/HR records. A teacher belongs to two businesses only through two explicit memberships.

Read directory: explicit active membership + active staff. Existing group assignments remain available as legacy compatibility in their own context without granting global-directory access; a scoped explicit inactive membership overrides this compatibility. Existing inactive/legacy assignments survive unrelated edits, but cannot be assigned to new records. Arbitrary lesson metadata is never a directory source. Existing group references are preserved, not converted into membership rows automatically.

SQL shape to implement in migration375: `CREATE TABLE IF NOT EXISTS education_teacher_memberships (business_context VARCHAR(64), staff_id INTEGER REFERENCES staff(id) ON DELETE RESTRICT, is_active BOOLEAN DEFAULT TRUE, created_by INTEGER REFERENCES users(id), updated_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, PRIMARY KEY(business_context,staff_id))`. The complete governed SQL is the migration source of truth. Rollback: restore pre-feature application code while leaving the additive table intact; export membership rows before any separately approved table retirement. Do not execute destructive rollback here.

Affected areas: education group service/routes/UI; narrow lesson teacher validation in existing create/edit/series transactions; fixture membership setup; actual-app regression harness. Existing shared action/context checks remain unchanged. Risk: legacy records need preservation while new/changed assignments must validate scoped eligibility; tests must cover both paths and reject foreign IDs before any booking/series write.

Verification: record failing actual-app first-assignment baseline before product edits, then UI teacher create → group → lesson/reload/API/SQL, reassignment/inactive/retry/double-submit, two-business negative writes, migration replay/no-backfill, focused existing groups/lifecycle/series/Park contracts and relevant guards. Preserve manual39-booking dataset and all01–07 proofs.

## Implemented behavior and boundaries

Worktree: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`; branch `codex/education-ready-pack-20261003`; unchanged HEAD/base `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`, v0.82.59. All changes remain local and uncommitted. Main checkout and earlier evidence were not edited.

The Groups tab now has a collapsible “Викладачі навчального центру” manager. Creating a teacher writes minimal staff + membership in one transaction; an unassigned teacher immediately becomes available in both group and canonical lesson selectors. The manager lists inactive scoped teachers and can deactivate/reactivate their membership. It does not edit global HR status, disclose global staff, attach arbitrary unowned staff IDs, rename teachers or add accounts/roles. Existing globally inactive staff must be restored through the existing HR workflow.

GET `/api/education/groups/teachers` uses existing timeline/context access; `includeInactive=true` adds scoped inactive rows. POST on that endpoint uses existing `create_booking` plus context-create access. PUT `teachers/:teacherId` uses existing `edit_booking` plus context-edit access. Foreign IDs are404; readers cannot write; legacy `/api/staff` stays403 in education. New staff creation is restricted to an education timeline. Minimal directory fields are `id/name/is_active`; no contacts or HR attributes are returned.

New or changed lesson assignments are validated inside existing booking create/edit/series transactions before writes. The selected staff name becomes the canonical snapshot; conflicting supplied names do not define ownership. Existing same-ID inactive or legacy snapshots survive unrelated edits. A new name-only assignment requires choosing a directory teacher; existing name-only legacy bookings remain editable and retain conflict behavior. Series propagation explicitly requires `education_lesson` for both main and candidate; the focused pure regression proves Park/legacy metadata and identity fields unchanged. Booking source/identity priorities, renderer ownership and protected manifest were not changed.

Assignments take staff/membership shared row locks, while scoped activation changes take the staff update lock. A controlled SQL lock regression proves that deactivation committed while a new assignment is waiting causes404 and no partial group. The same row-lock helper is used for changed lesson assignments. There is no delay-based attempt to manufacture this race.

Migration375 creates an empty, idempotent additive table only. It was exercised on disposable PostgreSQL and the retained synthetic preview; replay preserves records. No production migration or ownership backfill was run. Existing group references are a documented compatibility boundary in their existing business, not an automatic membership conversion. Arbitrary historical lesson metadata and unreferenced global staff are not directory sources. Explicit scoped inactive membership overrides group compatibility. Two explicit memberships can share one staff person while retaining independent activity.

## Fresh verification

08A files: `db/migrations/375_education_teacher_memberships.sql`; `services/educationGroups.js`; new `services/educationSeriesTeacher.js`; `routes/education-groups.js`; narrow changes in `routes/bookings.js`; `index.html`; `js/education-groups.js`; teacher-cache invalidation in `js/booking.js`; scoped `css/education-schedule.css`; fixture `scripts/lib/education-ready-dataset.js`; `tests/browser/education-ready-teachers-browser.js`; directory expectation in `tests/browser/education-ready-groups-browser.js`; `tests/integration/run-education-ready-design.js`; new `tests/integration/run-education-ready-teachers.js`; real scoped IDs in `tests/integration/education-series.integration.test.js`; new `tests/education-teacher-series.test.js`; new `tests/tools/verify-education-ready-teachers-evidence.js`; this report and `EDUCATION_READY_PACK_HANDOFF.md`. Earlier pack changes in these files are preserved; this is not the complete01–07 diff. Ignored output contains the retained attempts, review sheets and evidence recorder.

Evidence root: `output/education-ready/08A/`; authoritative index `final-evidence.json`; command exits `final-command-results.json`. These are new proofs, not re-labelled01–07 proofs.

| Verification | Actual result | Evidence |
|---|---|---|
| Pre-edit visible first assignment |2 PASS /2 FAIL, exit1 |`regressions/teachers/attempt-2026-10-04T07-49-51-339Z/verification.json` |
| Teacher actual-app Chromium |16/16 PASS, exit0 |`regressions/teachers/attempt-2026-10-04T08-03-10-721Z/verification.json` |
| Series/concurrency/DST/atomic rollback |17/17 PASS, no skips, exit0 |`logs/08A-series-real-ID-final.log` |
| Existing groups/F01/F02 |15/15 PASS, exit0 |`regressions/groups/attempt-2026-10-04T08-05-00-501Z/verification.json` |
| Existing lesson lifecycle/duration |12/12 PASS, exit0 |`regressions/lifecycle/attempt-2026-10-04T08-06-33-890Z/verification.json` |
| Mixed actual-app/Park acceptance |11/11 PASS, no skips, exit0 |`logs/08A-final-acceptance.log` |
| Focused unit/context/fixture/series guard |28/28 PASS, no skips |`logs/08A-focused-first.log` |
| Full `npm test` |exit0, Node22.23.1/npm10.9.8; static1327 PASS |`logs/08A-npm-test-final.log`, `npm-command-result.json` |
| Evidence verifier |5/5 PASS, exit0 |`verification-summary.json`, `../08A-evidence-final.log` |

The16 teacher checks include fixture preflight, UI creation before any group reference, first lesson reassignment, first group and new lesson, double-submit, failed-write draft/retry, foreign teacher creation through the second business UI, picker and direct-ID isolation, scoped inactive preservation/reactivation, migration replay/no backfill, two-business shared membership, legacy group preservation, read-only account boundaries, invalid/non-education creation, controlled deactivation race and page errors. They are mixed-level checks, not16 independent complete UI journeys. General npm/static totals are not education scenario counts.

All actual business writes in the browser suites reached the real application, Express and disposable PostgreSQL. API/SQL setup is fixture-labelled; API/SQL assertions are independent. No failed UI step was repaired through an API write. Foreign group/teacher/booking create/edit/series requests return404 and SQL proves no mutation. Both businesses create their new teachers through visible UI. Migration starts with zero membership rows before explicit fixture seeding. The fixture adds five memberships for four primary teachers and a deliberately shared teacher in the secondary business; an unowned synthetic staff candidate remains excluded.

Five selected safe runners finished exit0, verified the full retained manual preflight and39 owned bookings, and left zero public tables in the owned disposable database. Source/harness hashes bind the teacher proof to current product code. The verifier rejects missing index (observed exit1), stale source/log/screenshot hashes, incomplete checks, skipped backend tests and unsuccessful command results.

Failure history remains intact: an initial stopped-PG preflight; an early baseline lesson-selector harness error; a teacher-manager `details.open` harness predicate error; and the first full series run16/17 with an obsolete textual ID expectation after switching fixtures to real scoped staff IDs. The last required only correcting the independent expected ID; the repeat17/17 is separately recorded. Original `command-results.json` retains series exit1. Automatic approval review rejected an initially unguarded shared-series propagation patch; an explicit education-mode helper and focused Park/legacy regression resolved that boundary before the route edit was accepted.

Personally reviewed all32 original08A screenshots in two contact sheets and five representative final images at full resolution. `personal-review.json` and the two review manifests retain paths/dimensions/SHA256. The new manager uses existing CRM controls, scoped states, visible errors and retained draft;390px controls meet44px and page overflow is zero in the focused test. This does not recertify the full07 matrix, light/dark contrast, physical devices or WCAG after a new product change. Those remain part of combined final acceptance. Reconnect banners reflect the local outbound hold.

## Retained preview and repeat commands

Preview: `http://127.0.0.1:3012/?businessContext=dar&educationSchedule=today&date=2026-10-03`; PostgreSQL remains loopback55469. The owned cluster and preview had stopped before this task; they were safely restarted. `preview-restored.json` records the current server PID/url and post-start proof:39 complete booking rows, original manifest marker and full preflight unchanged, membership table empty. The manual dataset is not reset or reseeded. Old02 preview/evidence metadata is retained and its old PID must not be used to stop the new server without verifying the current process. Use the private existing test login; no credentials are persisted in evidence. External network/messages remain blocked by the process-only loopback helper.

Run in this worktree with Node22/npm10 and the already available Playwright module. The following envelope authorizes reset only of the exact owned disposable DB, never the manual preview:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM = 'RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT = 'C:/Users/Plotva/AppData/Local/npm-cache/_npx/fd3bca3c548369c0/node_modules/playwright'
node tests/integration/run-education-ready-teachers.js
# Separate runs use EDU_READY_SUITE=series/groups/lifecycle/acceptance.
# The runner holds an exclusive DB lock and performs owned disposable cleanup.
npm test
node --test tests/education-teacher-series.test.js
node tests/tools/verify-education-ready-teachers-evidence.js
```

Baseline mode `EDU_TEACHERS_PHASE=baseline` is evidence of the old product only; current fixed code is not expected to recreate its FAIL. New product changes require fresh runs, reviewed screenshots and a new index; the recorder cannot substitute for them. CI and live production QA were not run because this task is local-only; no commit/push/deploy, dependency/lockfile, role/global permission, infrastructure, environment setting or secret change occurred. Migration/protected/parser/diff guards passed; known historical migration numbering warnings remain unchanged.

## Result and next action

Blocker03 is closed locally: a new scoped teacher can be created and first assigned through visible UI, foreign teachers and writes are rejected, and legacy/inactive assignments are preserved without automatic ownership backfill. Production readiness still requires future release/migration approval and combined acceptance on the exact eventual release SHA. Continue **EDU-READY-08B: visible lesson date editing**, preserving this worktree and all evidence. Physical-device acceptance and the final combined pack are still pending.
