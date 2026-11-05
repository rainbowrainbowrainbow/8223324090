# Actual arrival/departure OCR preparation

Owner priority: recognize staff arrival/departure sheets first. Planned schedules
remain a separate workflow. This candidate is **internal recognition/staging**, not
a released or durable attendance preview/apply implementation.

`services/crmAttendanceOcr.js` uses the existing bounded KIE transport and image
validation. No external Hermes process or OpenAI key is required. It has its own
default-off `CRM_ATTENDANCE_OCR_ENABLED` flag and explicit
`CRM_ATTENDANCE_OCR_MODEL=gemini-3-8-flash-openai`. No production setting is changed.

Recognition requests actual document type/date, visible page identity, every visible
employee row, arrival, departure, confidence and ambiguity. Empty cells stay
unknown, never dayoff or absence. Both raw and normalized time columns survive.
Wrong document/date and duplicated source ordinals fail closed. Incomplete,
uncertain, invalid-time and overnight/zero-duration pairs cannot proceed as normal
same-day candidates. Missing/malformed issues are uncertain. Partial pages never
establish whole-day completeness. Supplied model staff IDs and payroll fields are
discarded; canonical exact-name matching rejects ambiguous or duplicate targets.

Staging objects are frozen in memory. Matching still returns
`requires_current_state_preview`, never write permission. **This is not a durable
signed database preview**: no HTTP endpoint, upload UI, receipt/reservation table,
attendance/payroll mutation or apply method is exposed yet. The future wrapper
must commit a durable paid reservation before calling the internal recognizer;
the standalone helper must not be wired directly to an API or automatic retry.

The shared KIE transport now exposes structured-document decoding; the existing
planned-schedule wrapper still enforces its own document-type boundary. Fixed
endpoint/model, timeout, response/input bounds, no public upload, no redirects,
test HTTP block and whitelisted receipt metadata are preserved.

## Remaining implementation, in order

1. Add durable neutral CRM execution/preview storage with immutable raw-reviewed
   content, source/date/actor/context dedupe independent of provider/model, provider
   receipt/unknown hold, preview hash/TTL and ownership. Check current schema and
   migration governance before adding any SQL. Do not silently extend the existing
   arrival-only Hermes payload or reuse its apply route for a departure.
2. Load operational staff candidates and current schedule/attendance/check-ins for
   the document date through canonical rules. Preview both times and resulting
   classifications, snapshots and conflicts; explicitly keep unknown rows excluded.
3. Prepare selected, confirmed, transactional apply. Acquire canonical attendance
   write/maintenance locks; recheck owner/hash/expiry and current-state snapshots.
   Reuse `recordAttendanceClockIn` and `recordAttendanceClockOut` and the existing
   historical/closed-period, compensation snapshot and mirror-checkin semantics.
   Do not calculate or directly write payroll totals; roll back the entire selected
   operation on conflicts. Existing/closed/partial attendance requires explicit
   handling, not overwrite or an inferred replacement. Never alter staff_schedule.
4. Wire the real upload/review UI using existing attendance management authorization
   without inventing an alternate permission path. Confirm actor/context before
   paid work and apply. Add real PostgreSQL/browser transactional, stale-state,
   partial-page, duplicate and payroll-regression evidence before release.
5. Only after a concrete reviewed executor exists, prepare a new bounded KIE test
   on the owner-confirmed sample. The previous printed probe is consumed/expired.
   Photo contains real employee names; identify exactly what leaves the CRM in that
   scope. No real provider request or business apply is implied by sample upload.
6. Prepare exact release/settings approvals and rollback after local checks and
   actual handwriting acceptance. Keep production execution flags off meanwhile.

Current targeted verification and exact branch/commit are recorded in
`D:/Codex/EventGenix/attendance-ocr-core-20261105/REPORT.md`. No full-suite,
actual-provider or production acceptance claim follows from these mocked checks.
