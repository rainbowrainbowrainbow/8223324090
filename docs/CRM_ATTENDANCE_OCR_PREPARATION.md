# Actual arrival/departure OCR preparation

Owner priority: recognize staff arrival/departure sheets first. Planned schedules
remain a separate workflow. This candidate now includes **internal recognition,
durable execution, immutable database preview and confirmed transactional apply**.
HTTP upload/review/apply and the HR Today interface are prepared locally. They are
not released. The owner-approved narrow membership mapping and the actual-app
membership journey now pass. Production release/activation still need their own
scopes; the completed local access block does not authorize them.

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

Staging objects are frozen in memory. Matching initially returns
`requires_current_state_preview`, never write permission. The internal recognizer
must only be called through `crmAttendanceOcrPreview` when wired to production;
it must not be exposed directly or placed in an automatic retry loop.

## Durable execution and preview

Migration `389_crm_attendance_ocr.sql` adds isolated execution and preview metadata;
it changes no attendance, schedules, compensation or payroll records. It has only
been applied to a disposable local PostgreSQL fixture. Its number must be checked
against the then-current production branch before release.

`createAttendanceOcrPreview` commits a reservation before calling KIE and holds
the shared cross-replica provider execution lock without keeping a transaction
open over HTTP. Context/actor/document date/image hash are unique independently
of provider/model, preventing a model switch or process restart from recharging
the same submission. Receipt metadata is whitelisted. A reserved/unknown outcome
blocks resubmission; three unresolved attendance executions across owners stop new
ones, in addition to the existing menu paid-capacity check. This is a concurrency
and unresolved-work guard, not a guaranteed currency budget cap.

Reviewed OCR data and preview revisions are immutable in SQL. Previews bind a hash
to the execution, both recognized time columns, canonical operational staff
matches, schedule, attendance/check-in and canonical compensation-plan snapshots.
Existing attendance, nonworking schedules and compensation requiring manual
review are held. Blank/uncertain/unmatched rows stay excluded. A
`ready_for_confirmed_apply` classification is provisional: apply must still recheck
the period, history, time and current state. Internal preview responses keep
`applyAllowed: false`; the authenticated HTTP presenter only enables provisional
selection on a current unapplied preview with ready rows. This never bypasses the
apply checks. `wholeDayComplete` remains false everywhere.

`getPreview` only returns the exact actor/context's saved rows and public metadata,
not internal attendance/payroll snapshots. `refreshPreview` loads reviewed data by
owned preview ID, including an expired preview, and creates a new current-state
revision without a photo, provider credentials, model or paid request. The original
revision remains unchanged. Any applied revision prevents further refreshes; an
SQL partial unique index protects one apply marker per execution.

## Confirmed apply (internal, not activated)

`createAttendanceOcrApply` requires explicit confirmation, actor/context ownership,
the exact preview ID/hash and unique selected source-row ordinals. Its caller must
use the existing authenticated attendance-management boundary; a client-supplied
actor ID must never be trusted. HTTP handlers now supply the authenticated actor;
all six routes additionally require the existing `hr.schedule.manage` capability
before upload parsing, after the existing HR/business guards. No role, permission
definition or sender is changed. Under the explicitly approved
`EG-ATTENDANCE-OCR-ACCESS-20261105-398e6a04`, the Park allowlist now enumerates only
these six exact methods/paths with `hr.schedule.manage`. Existing context,
writable-scope, live membership, explicit-deny and ownership guards remain active.

Apply takes the canonical payroll-period lock, then attendance maintenance/shared
and staff/date locks in sorted order, and the execution lock. A serializable
transaction checks expiration, source integrity, current-state hash, the canonical
open-period guard and the existing reviewed/approved/paid-report or installment/
payment-history predicate from payroll day conditions. A stale view, existing
attendance/check-in or blocked selected row aborts the entire operation. Open
historical dates are permitted only after these checks; closed history is never
reopened or overwritten. Future dates/times, midnight-crossing pairs and DST
transition days are held for separate review.

Both clocks pass through `recordAttendanceClockIn`/`recordAttendanceClockOut` with
actual-time settlement. The compensation snapshot produced by clock-in must match
the reviewed canonical terms (excluding the capture timestamp). Clock-out retains
the canonical frozen plan, allocations, grace rules and audits; no payroll formula,
salary/report/payment record or staff schedule is directly changed. Both stored
clock values are mirrored into a new `staff_checkins` row in the same transaction.
Any later row failure rolls back earlier clocks, mirrors, audits and the apply
marker. Identical committed requests replay the saved result, including after
expiry; changed selections are rejected. Serialization conflicts return an error
and are never retried automatically.

The local PostgreSQL checks exercise actual synthetic attendance writes and full
rollback, in addition to the separate SQL metadata immutability/index assertions.
They do not establish live authorization or handwriting quality. The local actual
application/browser journey is documented below. Blank rows are never selected automatically and applying a
partial page never creates absences or whole-day completion.

History uses `ON DELETE RESTRICT`: physically deleting an owner/execution with
retained OCR history will be blocked. No deletion/reconciliation tool is included.
An unknown/reserved execution cannot simply be reset or deleted to clear capacity;
an explicit receipt/provider reconciliation and retention policy is required before
production activation. Source image bytes are not stored in these tables, but
reviewed names, times and internal snapshots are personal operational data and must
follow existing access/retention rules. All new HTTP responses use no-store caching.

## Local HTTP and HR Today interface

`crmAttendanceOcrHttp` bounds multipart memory, rejects caller-supplied actor/context
fields, resolves the server business context and hides raw errors. The HR interface
requires paid-operation confirmation before upload and separate selected-row apply
confirmation. Selection starts empty; unknown/blocked rows are disabled. Escaped
text nodes render model names and times. The reviewed date is restored after reload.

An owned preview ID in the page URL reopens it without photo storage. Source-hash
recovery never starts paid work when no reservation exists. It can resume reviewed
OCR even if a process stopped before creating a preview. An unknown provider result
remains held. Lost HTTP responses therefore have an explicit recovery action rather
than an automatic repeat. Refresh clears selections/confirmation, preserves the old
revision and makes no provider request. UI never polls or starts paid work on load.

The actual Node app, real login/permissions, PostgreSQL18, native KIE adapter with
an injected synthetic transport and real desktop/390px browser clicks were exercised.
The journey loses a committed recognition response, recovers it, reloads/refreshes,
rejects another owner and a changed rate, then applies one pair and no blank rows.
One mocked provider call remains one; real provider calls and production writes are
zero. The subsequent owner-approved actual-app membership journey proves the
working HR interface, foreign-owner rejection, explicit management deny, revoked
token rejection, foreign/aggregate business rejection and ownership conflict hold.
The fresh schema rejects NULL ownership via its NOT NULL constraint; empty/foreign
ownership values are also held by the existing API guard. Unrelated period-close
and bulk financial writes remain denied. Earlier unlisted-route denial evidence
is retained as the before state, not a current blocker.

## Real owner-photo pilot (completed, one request)

The owner separately approved
`EG-ATTENDANCE-HANDWRITING-PROBE-20261105-ec14e15e`, including original-photo
disclosure and estimated-price uncertainty. The pinned `dccf8b55` recognition core
correctly returned the owner-confirmed date, five names and arrival/departure pairs,
20 visible row ordinals, page2/3 and15 unknown blank rows. The one-request ledger is
complete; that spending scope is consumed and cannot authorize a repeat.

Provider receipt:1269 input tokens,1367 output tokens,0 reasoning tokens,
0.36credits; nominal USD0.0018 at USD0.005/credit (not a balance/invoice audit).
One accepted photograph does not establish average price or general handwriting
accuracy. No real staff/attendance/schedule/payroll record was applied. Native
recognizer/transport fingerprints must remain identical when preparing the release.
Private image/names were not copied into Git or the public comparison report.

Commands: `npm run test:crm-automation`,
`npm run test:browser:attendance-ocr:isolated` with a verified disposable database.
Do not point the isolated runner at a retained/production database; it resets the
test schema. The dedicated test shim is guarded by test/isolated/loopback flags,
injects only the adapter dependency and blocks non-loopback HTTP. Product code has
no test-provider environment bypass.

The shared KIE transport now exposes structured-document decoding; the existing
planned-schedule wrapper still enforces its own document-type boundary. Fixed
endpoint/model, timeout, response/input bounds, no public upload, no redirects,
test HTTP block and whitelisted receipt metadata are preserved.

## Remaining implementation, in order

1. Finish the release-candidate baseline and prepare one bounded production release
   plus exact activation/rollback proposal. The browser test is included in the
   existing fullstack command and its existing HR artifact directory; no workflow,
   CI job, token permission or role definition is changed. Hosted CI must run on
   the final approved SHA; local proofs do not substitute for it.
2. Release and activate only within the fresh exact production scopes, keeping
   planned-schedule OCR and notification sender configuration separate. Preserve
   snapshots, receipt/unknown holds and required authenticated live QA evidence.
   No further paid pilot or real business apply is authorized by the consumed scope.

Rollback preparation: keep the flag off, or stop new requests if later activated;
retain executions, receipts, previews and committed audit history. A code rollback
can leave the additive tables intact. Never erase a paid unknown result to retry,
and never delete committed attendance as an automatic release rollback. Any real
attendance correction needs its own controlled, explicitly authorized process.

Current targeted verification and exact branch/commit are recorded in
`D:/Codex/EventGenix/attendance-ocr-ui-20261105/REPORT.md`. Actual-provider,
membership and production acceptance do not follow from compatibility/mock checks.
