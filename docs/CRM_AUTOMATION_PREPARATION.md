# CRM automation without an external Hermes runtime

Local preparation, updated-plan Task 2, 2026-11-01.
No production activation, credentials, real records or external sends changed.

## Working state

Worktree: `D:\Codex\EventGenix\hermes-independent`.
Branch: `codex/hermes-independent-preparation`, based on production-source
revision b8e842cf4053713c0006f9e96c56ab55cef317b6 (0.82.118).
Live remains 0.82.117 / 34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b.
The older PDFKit/Bash changes remain in the separate optimization worktree;
they have not been overwritten or silently included in this branch.

No dependencies were added. A local ignored node_modules junction points to
the existing dependency installation on D:. It is not a deliverable dependency
or a change to package-lock.json. CI uses ordinary npm ci.

## What runs locally

### Menu photos

Keep the current authenticated product workflow:
`POST /api/products/:id/menu-image/draft` (generate compatibility alias),
`GET .../status`, `POST .../apply`, `POST .../reject` and the existing
external-draft path. It does not need Hermes. Human approval and existing
product/business permission checks remain unchanged. Existing provider/storage
and browser-lifecycle regression tests were used rather than duplicating them.

The existing OpenAI generation request now has a bounded 60s timeout (internal
override capped at 120s). No retry or automatic publication was added.
The separate scheduled stale-catalog KIE refresh was not modified.

### Creative Studio

The existing Studio brief, queue, assets, decisions and regeneration endpoints
remain. Added explicit operator API:

```text
POST /api/hermes-studio/jobs/:id/execute
{"businessContext":"event_genix","confirmed":true}
```

It inherits Studio JWT access and the existing decision-role guard. No roles,
capabilities or auth/session definitions changed. The old URL/table/service
names are storage/API compatibility, not a dependency on external Hermes.
The execution action is also available from the existing Studio detail panel
through an explicitly confirmed Generate draft button. The brief, queue, assets,
decisions and history remain on their existing paths.

Requires CRM_CREATIVE_EXECUTION_ENABLED=true in the intended environment;
unset is disabled. This flag was NOT set in production. Native menu generation
uses its existing provider configuration; a separate permanent worker or queue
poller was not added. The executor handles a single explicitly selected
creative_material_job, not a sweep of queued jobs or menu_photo_job backlog.
Menu_photo_job history remains intact; use the native product image workflow
for new menu photos, and review old queued menu jobs separately at cutover.

A shared PostgreSQL session advisory lock permits one new CRM paid operation
(creative or OCR) across replicas. The queued job is claimed and its claim/event
committed before calling the provider. No DB transaction is held across the
provider request. Successful output is stored through canonical job/asset
services as ready_for_review, never approved/applied automatically. Repeated
execution of a ready/approved job returns its stored result without a paid call.

The initial creative adapter supports one generated image draft. References
requiring image editing are explicitly rejected before spending, not silently
ignored. Output is a square review draft with requiresFormatReview=true;
requested copy/material/format context is included in the prompt, but exact
typography, requested final dimensions, multipage/PDF output and reference-image
editing are not claimed. Those production acceptance requirements must be
resolved before removing the old executor for jobs that need them.

If a provider fails/times out, the job is failed with a sanitized review code;
the executor never automatically pays again. If generation succeeded but result
persistence failed, its claim remains and requires manual reconciliation.
An unsupported/malformed provider image also leaves the claim for review.
Use the existing explicit regeneration flow for a deliberately approved new
attempt; do not reset claimed/failed jobs to queued in a background loop.

### Schedule photo OCR

```text
POST /api/staff/schedule/ocr-preview
multipart/form-data:
  file=<PNG or JPEG, <=4 MiB>
  documentDate=YYYY-MM-DD
  confirmed=true
  businessContext=event_genix (optional)

POST /api/staff/schedule/ocr-apply
application/json:
{"confirmed":true,"previewId":"<returned importId>",
 "selectedRowIds":["<returned rowId>"],"conflictConfirmed":[]}
```

Both inherit native staff JWT authentication and hr.schedule.manage. The
current canonical schedule import supports event_genix only; another explicit
business is rejected. The apply service additionally checks the stored preview
creator, uses a transaction and the canonical immutable-preview/stale-state/
conflict/idempotency checks. It writes planned schedule only, not attendance.
After commit it reuses the staff route's timeline:roster-updated notification.
Realtime broadcast failure does not report a committed schedule as failed.

Requires CRM_SCHEDULE_OCR_ENABLED=true and an explicitly selected
CRM_SCHEDULE_OCR_MODEL, plus existing OPENAI_API_KEY/configuration. None were
set remotely. The model must support vision and the chosen Responses request
format; no unverified default model was silently introduced. Transport follows
the existing official-host restriction for production. Input image is sent as
an inline input_image with store=false, timeout 45s and bounded output. The
provider adapter was tested with a synthetic response, not a real paid model.

Multipart input is bounded to one 4 MiB file and three small fields; image
signature must agree with MIME. The source photograph is not stored in the
public image bucket or preview metadata. It exists only for this request;
after invocation, normal process memory management applies. Recognized rows
and hashes use the existing private schedule-import storage/audit lifecycle.
Review provider data-handling requirements before sending real staff images.

A durable draft reservation is committed before recognition, keyed by image
hash, date, actor, context and model. A repeated completed extraction reuses
stored rows; an ambiguous/incomplete execution requires review rather than
another paid request. Source images/keys are not put into the reservation.
If execution crashes after recognition but before row persistence, it cannot
automatically resume without a possible charge; the reserved draft blocks that
retry. This is intentional and requires an operator resolution procedure.

OCR is untrusted input. The adapter emits only selected schedule fields;
missing/low (<0.85)/invalid confidence or reported ambiguities make a row
invalid for selection in the canonical preview. Such rows can be reviewed
and entered through the ordinary schedule editor; automatic correction is not
implemented. Safe rows still require explicit selected row IDs and confirmation.
The shared /staff and HR schedule shell now includes an expandable photo upload,
review and selected-apply interface. Paid recognition and schedule application
have separate explicit confirmations; uncertain rows are disabled and conflicts
need individual confirmation. Existing backend business/action/actor checks remain.

### Notification delivery boundary

`services/crmNotificationDelivery.js` exports a one-event executor. It is NOT
mounted as a public API, attached to Telegram or registered in a scheduler.
It supplies no implicit transport/recipient mapping and cannot send by itself.

All of the following must be provided at deliberate activation:

- CRM_TASK_DELIVERY_ENABLED=true.
- CRM_TASK_DELIVERY_CUTOVER_CONFIRMED=true after external sender verification.
- CRM_TASK_DELIVERY_NOT_BEFORE=<approved ISO cutoff>.
- CRM_TASK_DELIVERY_APPROVED_EVENT_IDS=<exact comma-separated pilot IDs>.
- Explicit confirmed=true call and one business context.
- An approved direct-owner recipient resolver and bounded transport adapter.

Existing outbox remains the source of truth. Business is checked against the
task before claim. Old backlog is rejected for separate review. Positive
Telegram user IDs only; mismatched owners or negative group/channel IDs are
rejected. The adapter must honor AbortSignal and never retry an ambiguous send.

Successful claim -> send -> ack reuses canonical helpers. Definite pre-send
rejection schedules the existing retry/backoff policy. Ambiguous send or ack
failure moves the still-claimed event to dead_letter for manual reconciliation.
If the DB fails too, the durable claim may remain and must be reconciled before
any other consumer can reclaim it. This does NOT promise cross-system exactly
once delivery. No live sender should be enabled while the other computer's
Hermes state is unknown. Task producer flags, after-commit behavior and alternate
creation notification suppression were not changed in this phase.

## Verification performed

Runtime: Node 22.23.4, existing npm 10 dependency baseline.

- First focused regression set: 103 passed, 0 failed/skipped, covering new
  services and existing Studio, schedule preview/apply, menu provider/drafts/
  lifecycle, outbox and kleshnya producer tests. Reported duration 67.477s.
- Final changed-service/HTTP/Studio/permission-registry run: 32 passed,
  0 failed/skipped, duration 2.437s. These runs overlap; do not sum them as
  unique test coverage.
- Multipart HTTP checks use real multer, Express and existing requireAction:
  unauthenticated 401, animator 403, disabled 503, other business 403,
  oversized upload 413, authorized synthetic upload 200 with zero writes.
- Studio HTTP checks preserve decision roles and reject cross-business calls.
- Whole-tree syntax pass: 1596 JS files at its run point; subsequent changed
  JS files checked separately. Auth boundary/API surface/action permission gates
  pass. Correct permission-registry check is its node:test contract suite;
  an initial attempt at a nonexistent standalone script was corrected.
- New suite is included once in verify via npm run test:crm-automation.
- At the original backend stage, no full npm test rerun, real provider charge,
  Telegram send, browser/UI change, live QA, CI run, commit/push or deployment.
  Local PostgreSQL and UI verification were completed in the follow-ups below.

Logs: D:\Codex\EventGenix\hermes-independent-verification.
No new dependency/lockfile, schema migration or version bump.

### Follow-up: local PostgreSQL verification (2026-11-01)

Portable PostgreSQL 16.15 is installed on D:, bound only to 127.0.0.1:55432,
with a dedicated disposable database and non-superuser login. It is stopped
after verification and has no Windows service/autostart registration.

- Canonical initDatabase -> runMigrations -> initDatabase completed; all 382
  migration ledger entries are present. Existing fresh-startup integration
  contract passed, including concurrent fenced restarts and sentinel retention.
- New tests/integration/crm-automation-postgres.integration.test.js: 9 passed,
  0 failed/skipped (final test duration 1.797s). Covers cross-session provider
  locks, persisted creative assets/approval, failed/result-write/crashed executor
  replay prevention, OCR reservation/immutable preview/selected apply/stale-state
  rejection, unchanged actual attendance, transaction rollback, personal outbox
  delivery, definite-send retry and ambiguous-send quarantine.
- Existing real-SQL attendance suite: 8 passed, 0 failed/skipped (1.300s).
  Focused mock/HTTP/permission regression: 32 passed (2.143s), overlapping prior
  runs. External providers/transports were synthetic; no billable request or
  real notification was made.
- Cluster stop/start retained the migration-ledger SHA256. New CRM suite
  removes its exact synthetic rows and assets; probes found zero leftover
  crm_ci_* users, staff or tasks. Canonical development seeds/startup sentinel
  fixtures remain only in this disposable database.
- Existing hermesJobs.getHermesJobDetail uses Promise.all with one client and
  emits a pg deprecation warning. Tests pass with the current dependency; this
  was not changed or counted as a measured Railway optimization.

Reproduction, credentials handling, official binary source/checksum, evidence
and limitations: D:\Codex\EventGenix\local-postgres\REPORT.md and README.md.
Only start that isolated cluster when needed. The opt-in PostgreSQL suite is
not added to the default verify chain; it requires a validated disposable DB.

## Activation sequence and rollback

1. Review this branch together with earlier independent PDFKit/Bash work;
   do not overwrite either worktree. Recheck remote/live drift.
2. Local PostgreSQL gate completed in updated Task 6 above. Re-run its focused
   integration suite after relevant backend changes; the local result does not
   establish current production runtime state or real-provider quality.
3. Local operator UI and synthetic browser acceptance completed in the follow-up
   below. Re-run relevant browser flows after UI changes; real-provider acceptance
   remains separate from the synthetic UI proof.
4. Select/configure the OCR model and verify one explicitly approved synthetic
   image and one creative generation for quality, latency and actual cost.
   Validate format/reference requirements before migrating corresponding jobs.
5. Inventory/resolve old queued/claimed jobs and notification backlog without
   replay. Determine current external worker, recipients and route ownership
   once the other computer is accessible. One sender only.
6. Prepare exact-SHA CI/release and scoped authorization under the current
   production runbook. Deploy with the new flags absent/false first, then enable
   only approved features/pilot IDs in their separate settings scope.
7. Verify drafts, human decisions, schedule-only writes and delivery invariants;
   observe before retiring old consumers. Task 3 may not bypass these gates.

Rollback: disable the new flags, stop only new execution entry points and return
to the prior reviewed artifact/settings as appropriate. Preserve jobs/assets/
approvals/imports/outbox and reconcile paid/unknown outcomes before retrying.
Do not erase reservations or automatically restart a historical Hermes cron.
No DB rollback migration is needed because no new schema was introduced.

## Remaining limits

This is a local backend implementation with real PostgreSQL and synthetic
provider/transport verification, not proof of end-to-end production readiness.
Real OCR quality, unresolved reference-editing jobs and inaccessible external
sender ownership remain explicit gates. The owner subsequently confirmed that
square creative drafts are sufficient now; finished story/print dimensions are
not a blocker for that scope. See CRM_AI_QUALITY_COST_ACCEPTANCE.md. There is no new
continuous worker and no claim of measured Railway or AI-provider savings.

## Follow-up: operator UI (2026-11-01)

- Studio execution uses the current decision-role availability, a shared
  confirmation modal and an in-flight latch. A successful result remains a
  review draft; approval/rejection/history are still explicit existing actions.
  Busy/disabled/reference/ambiguous outcomes have user-facing messages.
- Photo recognition is available only when the existing schedule-manage UI
  capability permits it and the business scope is writable Event Genix. The
  expandable panel is shared by /staff and HR. No role or auth code changed.
- The UI checks PNG/JPEG and 4 MiB before upload, sends multipart without a JSON
  Content-Type, defaults selections to empty, disables invalid/unmatched rows,
  shows current/proposed state and requires per-conflict plus final confirmation.
  Invalid/unresolved current state is shown as unverified, not a missing shift.
- Paid/request ambiguity blocks repeat controls on that page. Confirmed apply
  re-reads the current visible schedule via its canonical range loader, without
  a second apply or unrelated staff/profile reload. Stale/expired/unknown apply
  outcomes require review; there is no automatic paid or mutation retry.
- Browser proof: 7 flows passed in Chrome 156.0.8078.74 with isolated Playwright
  1.64.1 tooling, duration 18.788s. Studio desktop/mobile, schedule desktop/mobile,
  schedule read-only, HR desktop and HR mobile dark theme. Real clicks, cancel,
  duplicate-click suppression, explicit approval, invalid input/uncertain rows,
  conflict confirmation, disabled service, ambiguous network and stale preview
  outcomes were exercised. Six screenshots were viewed and reviewed.
- The browser server uses existing synthetic page/API fixtures and a local fake
  WebSocket. It does not start CRM production services, use a live DB or contact
  real AI/Telegram. A synthetic blue-circle asset demonstrates rendering; it is
  not provider quality evidence. PostgreSQL evidence above is a separate layer.
- New opt-in npm run test:browser:crm-automation reuses existing browser fixture
  helpers; it is not added to default verify. Tool installation/caches/profiles,
  raw logs/screenshots and reproduction instructions are on D: under
  D:\Codex\EventGenix\ui-verification. No repo dependency/lockfile added.
- Production flags remain inactive/unmodified. No commit/push/deploy/live QA.
  Next: choose OCR/image quality, required final creative formats and a bounded
  explicit paid-sample acceptance before preparing any feature activation.

OpenAI request shape reference checked during implementation:
https://developers.openai.com/api/docs/guides/images-vision

## Integration against 0.83.0 production source (2026-11-03)

The work was replayed into `codex/hermes-independent-integration-20261103` from
source revision `90b3efdab790807b24ab693321fd68a918e08f48`; the original
preparation worktree remains unchanged. This section supersedes the historical
working-state paths and version in the beginning of this document.

Synthetic verification includes the Studio and schedule interfaces in a browser
connected through the real HTTP handlers and a disposable PostgreSQL database,
with fake AI providers and synthetic user identity. It confirms explicit review
and apply, durable records, and no paid retry. Unrelated UI endpoints use fixture
responses; this is not proof of production authentication or real-model quality.
The opt-in `RUN_CRM_AUTOMATION_BROWSER_POSTGRES=true` integration requires a
local disposable DB and an explicit `PLAYWRIGHT_MODULE_PATH` and
`CRM_AUTOMATION_CHROME_PATH`; it must never point at production.

No production execution or delivery flags were enabled. The actual Telegram
sender and external Hermes runtime remain unverified; do not enable a second
sender or replay backlog. Real OCR and creative quality, provider access,
current pricing and spend authorization remain separate activation gates.
The former image default `gpt-image-1-mini` is scheduled for retirement on
2026-12-01; select and validate a supported replacement before enabling new
production execution rather than silently relying on that default.

### Explicit creative image-model gate

Before claiming a queued creative job for a real provider call, CRM now requires
`OPENAI_MENU_IMAGE_MODEL` or `OPENAI_IMAGE_MODEL` to be explicitly configured and
rejects the retired or scheduled-for-retirement legacy image models. A missing or
legacy model returns `CRM_CREATIVE_MODEL_NOT_READY` without claiming the job;
previously completed drafts remain available for review/replay. This does not
change the native menu-photo workflow or select a replacement model. Operator
access, quality, pricing and exact model selection still require a paid pilot
and separate production settings authorization. The gate rejects known legacy
models but does not prove that an arbitrary other model is available or valid.
