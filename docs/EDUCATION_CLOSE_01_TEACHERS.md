# EDU-CLOSE-01 — teacher identity baseline

## A — canonical teacher name overwritten
Symptom: supplying a group on create, or changing a linked group, can persist caller teacherName despite a validated staff ID.
Expected: canonical name/ID produced by assertLessonTeacher survive groupName normalization.
Actual: educationGroupWriteError writes validated, then overwrites educationLesson with original lesson spread.
Root cause: routes/bookings.js uses `{ ...lesson, groupName: group.name }` instead of validated.
Reproduction: visible education create/edit/series submit; deliberately malformed teacherName in the outgoing UI request; assert response, reload/card and independent SQL. This fault injection changes input only, never repairs a failed UI action.

## B — two same-name teachers conflict
Symptom: distinct eligible staff IDs with identical names cannot book overlapping times in different rooms.
Expected: stable IDs distinguish teachers. Name comparison is a fallback only when either record genuinely has no ID.
Actual: validateEducationLessonTeacherConflict joins ID and name predicates with OR for all stored rows.
Root cause: unconditional name predicate even when both records contain different valid IDs.
Reproduction: create two same-name teachers through UI, first lessons through visible forms in separate cabinets at the same time; compare IDs and SQL. Also cover same-ID overlap/adjacency, legacy name-only records, series atomic rollback and businesses.

## Existing HR staff — BLOCKED_DESIGN candidate
Current staff has no business ownership column. /api/hr/staff reads the global staff table and filters activity/profession, not business ownership. company_structure_node_id and operational schedules do not establish education membership. business_memberships relate users to businesses, not arbitrary staff rows; employee_profiles may be absent and does not record membership-link provenance. Existing education_teacher_memberships provides explicit ownership only after an approved link, and existing group assignment is the grandfathered path.
No general predicate currently proves the right to attach an unassigned, accountless HR staff row to an education business. Creating a duplicate staff row is not an acceptable linking workaround. Keep arbitrary staff-ID POST rejection and hidden unowned rows.
Required decision: authorize an explicit HR manager action for selected staff and selected business, define the exact staff visibility/write capability and audit evidence, or restrict eligibility to a separately reviewed reliable current staff/account/business mapping. This task does not broaden HR/global permissions or invent ownership.

Verification pending; no production incident is asserted by this source diagnosis alone.

## Verified baseline and implementation

Before any product edit, baseline-r4 finished exit1 with 6 PASS / 4 FAIL. The four real failures are canonical teacherName on visible create, changed-group edit, visible series, and distinct teacher IDs/same name at identical SQL date/time in different cabinets (409 instead of200). Evidence: output/education-ready/close01/baseline-r4/regressions/closeTeachers/attempt-2026-10-04T16-59-52-395Z/verification.json. The original route hash is recorded there; original harness copies are preserved for each revised attempt.

Earlier diagnostic attempts remain: initial harness referenced a missing10:00 grid cell; r2/r3 exposed auto-selected time and PostgreSQL C locale differences. Those failures/partial PASS are not final product acceptance. The final reproduction explicitly selects bookingTime and compares SQL date/time/teacherId. Same-name teachers use valid lower-case Ukrainian spelling to make OR-name comparison independent of locale; database datctype/datcollate are bothC. Legacy fallback preserves its existing locale-sensitive case semantics; no global collation change is made.

Product changes are only in routes/bookings.js:
- spread validated teacher metadata when replacing groupName;
- use ID equality for known IDs; name matching on the stored side requires a missing/blank ID when the candidate has an ID;
- a legacy candidate without an ID retains conservative name comparison to ID-backed rows.

The shared ID/name advisory locks remain intact so legacy and ID-backed requests still serialize. Inactive policy, business access, old assignments, renderer/detail identity, schema and permissions are unchanged. No automatic repair of historical teacherName snapshots is performed.

## Verification scope

Postfix-r2:26 PASS /0 FAIL /0 skips, exit0. Its26 checks combine visible UI workflows, fault-injected UI inputs, API/SQL negative contracts, fixture/page-error checks and concurrency/SQL barriers; they are not26 independent continuous journeys. Malformed teacherName is injected into the real outgoing visible UI submit and accepted/rejected by real Express. No failed UI action is repaired using API writes.

Separate series suite:17 real HTTP/PostgreSQL tests PASS, skipped0, exit0. It covers DST/calendar, create/create, create/edit, create/series serialization, adjacency, different teachers/businesses and rollback. New visible series test has a conflict at occurrence3 and proves every booking row unchanged.

Two key screenshots personally reviewed: close01-canonical-name.png and close01-distinct-teacher-simultaneous.png in the successful teacher attempt. The reconnecting toast is local outbound/WS hold behavior, not production synchronization evidence. Existing card duplication/stock image/zero total remain UX task03 scope.

Preservation:39 bookings in each retained manual/device DB, ten complete-table hashes unchanged; dirty main and previous worktree status/diff hashes unchanged;1542 earlier QA evidence hashes unchanged. All isolated runs clean only the fixed disposable DB to zero public tables. Production version/remote were rechecked and still match the verified base.

The HR-link safety boundary passes (hidden unowned staff, education /api/hr/staff403, explicit arbitrary staffId400, no duplicate staff/membership). The desired linking workflow itself remains BLOCKED_DESIGN, not PASS. The existing legacyBusinessSurfaceAccess requires Park context for staff namespace; enabling education global HR reads would expand current access boundaries. No such change was made.

Required follow-up decision: define a bounded, auditable HR-manager assignment of a selected existing staff ID to a selected education business, including eligibility of accountless/shared/inactive staff and exact existing capability checks. The owner must authorize that workflow before implementation; staff name, old bookings or operational shifts cannot be ownership evidence.

Final npm/runner results and hashes are recorded in the handoff and output/education-ready/close01/evidence-index.json. All unsuccessful diagnostics remain retained.

Final completion: final CLOSE01 runner26/26 PASS, npm test repeat exit0, static-doc guard5/5 PASS, protected6-block guard PASS, series17/17 PASS, skipped0, diff --check exit0. The initial npm failure was the strictly enumerated operating-doc list; its full log is retained. Only the expressly required handoff was added to the allowed inventory, with an HTTP404 assertion.
