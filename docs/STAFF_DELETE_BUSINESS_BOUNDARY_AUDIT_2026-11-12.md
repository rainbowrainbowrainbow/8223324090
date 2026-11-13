# Staff deletion and adjacent business-boundary audit

Status: local repair implemented after the owner's explicit
`RED-STAFF-DELETE` authorization. No commit, push or deployment performed.

## Scope and evidence

Audited production-branch source: `72084b01` (fetched from
`origin/codex/eventgenix-production` on 2026-11-12). This is a source audit,
not verification of the deployed SHA or any real employee record.

The owner reported the exact legacy staff denial message when attempting to
delete an employee card from two accounts. The local reproduction uses synthetic
`director` and `creator` principals with current Park membership, the actual
Express HR router and actual capability/business-boundary middleware. Database
and external services are mocked. No production request or mutation was made.

## Confirmed cause

`deleteStaffProfile` in `js/hr-page.js` first requests
`GET /api/hr/staff/:id/delete-readiness`. It only opens the confirmation form after
that succeeds, then submits `DELETE /api/hr/staff/:id` with typed confirmation.

Both endpoints reach the legacy staff boundary in `routes/hr.js` before their
handlers. `services/legacyBusinessSurface.js` rejects membership-mode access by
default and selectively restores exact Park workflows. The base staff card has
GET and PUT recovery; deletion readiness and DELETE have neither staff-card nor
payroll nor schedule recovery. Both return HTTP 403 / `staff_not_migrated`, before
SQL, even when the principal has full staff management capabilities.

Changing user roles or using the creator account does not resolve this gap.
The current failure is not a foreign-key failure and does not prove whether the
selected real card is eligible for permanent deletion.

## Reproduced adjacent gaps

Before the repair, each of the following 18 method/path pairs returned the same 403 before SQL for
both synthetic roles (36 denied requests). A successful base-card GET is checked
first for each principal. Paths below are relative to `/api/hr`.

| Workflow | Method and path | Status |
| --- | --- | --- |
| Delete readiness | GET `/staff/:id/delete-readiness` | Repaired locally, regression tested |
| Permanent duplicate deletion | DELETE `/staff/:id` | Repaired locally, regression tested |
| History | GET `/staff/:id/history` | Adjacent blocked workflow |
| Lifecycle checklist | GET `/staff/:id/lifecycle-checklist` | Adjacent blocked workflow |
| Documents | GET, POST `/staff/:id/documents` | Adjacent blocked workflow |
| Medical book | GET, POST `/staff/:id/medical-book` | Adjacent blocked workflow |
| Resources | GET, POST `/staff/:id/resources` | Adjacent blocked workflow |
| Offboarding | GET, POST `/staff/:id/offboarding` | Adjacent blocked workflow |
| Offboarding readiness | GET `/staff/:id/offboarding-readiness` | Adjacent blocked workflow |
| Active status | PUT `/staff/:id/status` | Adjacent blocked workflow |
| Core/reserve/blacklist placement | PUT `/staff/:id/pool-status` | Adjacent blocked workflow |
| Individual shifts | GET `/staff/:id/shifts` | Adjacent blocked endpoint |
| Onboarding assignment | PUT `/staff/:id/onboarding-assignment` | Adjacent blocked workflow |
| Company structure save | PUT `/company-structure` | Read is restored, write remains closed |

`js/hr-page.js` still contains calls for history, lifecycle, documents, medical
book, resources, offboarding, status, pool status and onboarding assignment.
This is a route-level audit; it does not claim that every corresponding control
is visible in every browser state. Existing containment tests intentionally
expect several adjacent denials, so passing them alone never proved a complete
staff lifecycle workflow. Some restrictions may be intentional pending ownership
migration and must not all be removed as if they were incidental errors.

## Wider shared-boundary inventory

Static inspection also found the shared boundary in booking templates, recurring
bookings, chat, contractors/procurement, legacy salary reporting, payroll,
Kleshnya, catalogs, certificates and Art, plus conditional consumers in dashboard
and products. Catalogs, Art, certificates and selected payroll routes already
have specialized recovery rules. A shared helper reference is a risk inventory,
not proof that every listed module is broken. No business-wide bypass is proposed.

## Approved repair scope

1. Add an exact Park deletion-operation classifier for only GET
   `/staff/:id/delete-readiness` and DELETE `/staff/:id`, mounted solely in the HR
   staff boundary. Require current single Park membership with matching business
   and organization identities, writable scope, and `hr.staff.manage`; preserve
   explicit denies. Readiness should require management too: the current generic
   GET capability selector resolves it to `hr.staff.view` despite its inline
   `requireHrManage` label. Do not grant deletion through delegated profile editing.
2. Reuse the existing readiness and transactional delete handlers. Preserve typed
   `ТАК`, row locking, related-record blockers, audit retention and foreign-key
   failure handling. Review all current staff references and cascades before
   enabling deletion; unknown or foreign-owned dependencies must block it.
   Return blocker presence without exposing payroll amounts to non-payroll users.
3. Replace the two incident denial expectations with actual-router regression
   coverage for permitted management, viewer/delegated-editor denial, explicit
   capability denial, foreign business, revoked/inconsistent membership,
   aggregate scopes, malformed IDs and trailing-path variants.
4. Exercise disposable local database records for missing/wrong confirmation,
   linked account/booking/attendance/payroll dependencies, clean duplicate
   deletion, audit preservation, rollback and concurrent related-record writes.
   Browser QA must cover the readiness-confirmation-delete sequence and changing
   business context while the confirmation is open.
5. Keep adjacent families as separate reviewed operations; give each an explicit
   intended support status and paired frontend/backend tests. A complete workflow
   matrix must include negative isolation tests AND positive end-to-end workflow
   tests, not just an expanding list of allowed reads.

Runtime files: a focused `services/parkHrStaffDeletionAccess.js`, the HR
integration in `services/legacyBusinessSurface.js` and `routes/hr.js`, and the
existing frontend deletion flow with context/session checks. No global role grants,
database migration, real-record deletion, commit, push or deployment is included.

## Implementation

- `services/parkHrStaffDeletionAccess.js`: exact method/path classifier and current
  writable Park membership plus `hr.staff.manage` check. Payroll blocker amounts
  are projected out for managers without `hr.payroll.view`.
- `services/legacyBusinessSurface.js`: enables only those two operations in the
  existing HR staff recovery boundary. It does not open the whole staff namespace.
- `routes/hr.js`: readiness resolves to the management capability; both handlers
  also require that capability explicitly. The existing confirmation, staff row
  lock, transaction, audit and FK-error handling remain in use.
- `services/staffDeletionReferences.js`: discovers actual FK references to staff,
  counts additional dependencies and blocks CASCADE/SET NULL as well as RESTRICT
  dependencies. Only the existing reported cleanup is exempt. Identifiers come
  from PostgreSQL catalogs and are quoted. Query failures stop deletion. Explicit
  checks additionally cover training submissions, assignment arrays and personnel
  decision history without foreign keys.
- `js/hr-page.js`: captures business/session identity and team generation before
  readiness; rechecks after readiness, confirmation and DELETE. A business switch,
  session change or team invalidation prevents a stale confirmation from issuing
  a DELETE and prevents a stale response from refreshing another context.
- Tests cover real Express middleware/handlers, isolated PostgreSQL constraints
  and transactions, and the production frontend functions/shared modal in Chromium.
  The original incident test now retains 16 adjacent blocked routes (32 requests),
  while the two repaired endpoints have positive and negative workflow coverage.
- `package.json`: includes the new route regression in the existing staff recovery
  test command and the browser smoke in the existing HR team browser command.
  No dependency, lockfile or version change.

## Completed verification after repair

- Node.js `22.14.0`: direct `scripts/check-runtime.js` passed. npm is unavailable
  on PATH; no npm baseline or full `npm test` is claimed.
- Targeted regression command: `node --test tests/legacy-business-surface.test.js tests/park-hr-payroll-access.test.js tests/park-staff-schedule-access.test.js tests/park-hr-onboarding-routes.test.js tests/hr-capability-contract.test.js tests/hr-button-contract.test.js tests/staff-offboarding-account-deactivation.test.js tests/park-hr-staff-deletion.test.js tests/park-hr-staff-card-routes.test.js`:
  **112 passed, zero failed/skipped**.
- Disposable PostgreSQL 17, `tests/integration/park-hr-staff-deletion-postgres.test.js`:
  **9 passed, zero failed/skipped**. Tests actual HR handlers against a fresh,
  minimal local schema: known/unknown references, non-FK legacy records, cleanup,
  rollback, audit retention and a concurrent FK insertion blocked by the staff
  row lock. Payroll outstanding aggregation and external services are mocked;
  this is not a full migrated application database test.
- Chromium, `tests/browser/hr-staff-deletion-browser-smoke.js`: **9 scenarios
  passed**. Production UI functions and shared dialogs call the actual local HR
  router with a synthetic database adapter. Real clicks cover desktop/mobile
  deletion, cancellation, wrong confirmation, dependency blockers, context/session
  changes while the modal is open, and a context change during readiness.
- Reviewed `output/playwright/hr-staff-deletion/confirmation-390.png` and
  `confirmation-1100.png`: text, fields and actions are visible without clipping.
- Action permission drift check: **51 actions passed**. Auth boundary check:
  **46 public API exceptions, 15 integration contracts, 2 query-token exceptions
  passed**. Changed runtime JavaScript syntax, package JSON and `git diff --check`
  passed.
- No full `npm test`, remote CI, live QA, commit, push or deployment performed.

For the PostgreSQL fixture, supply a fresh local database with a test/disposable
name as `STAFF_DELETE_TEST_DATABASE_URL`, plus
`TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`, then run
`node --test tests/integration/park-hr-staff-deletion-postgres.test.js`.
The fixture refuses a pre-existing `public.staff` table and does not reset it.

## Remaining boundaries and next action

The other 16 audited routes remain closed and need operation-specific ownership
and access decisions. No claim is made that the whole business split is repaired.
The FK race proof does not establish concurrency guarantees for legacy references
without FKs (for example booking text identifiers); their existing checks still
apply. Adding database constraints or changing their writers is outside this block.

Recommended next action: prepare an authorized release of this scoped repair with
exact-SHA CI and disposable live QA. The live site still runs its existing code;
this local authorization did not include deployment.

## Owner-requested card menu visual follow-up

The owner additionally requested recognizable three-dot actions and better menu
separation from employee cards in light/dark themes. `js/hr-page.js` now renders
three SVG circles instead of a font-dependent ellipsis. `css/hr-page.css` centers
the icon within the existing 44px control. `css/pages-hr-staff.css` gives the menu
an opaque light slate or raised dark slate background, a visible border and a
stronger shadow. The dark-theme deletion explanation uses a readable light red.
Menu ownership, action handlers, roles and keyboard behavior are unchanged.

Browser verification reused the existing HR team harness with the page's actual
local stylesheet order and `.page-container` wrapper. On synthetic data, real
clicks passed for light/dark themes at 1100px and 390px; menu bounds remained within
the viewport and the control retained a 44px target. Enter, arrow navigation,
Home/End, Escape with focus restoration, and outside click worked. The rendered
screenshots were visually reviewed:

- `output/playwright/hr-team-menu/light-1100.png` and `dark-1100.png`
- `output/playwright/hr-team-menu/light-390.png` and `dark-390.png`
- Owner-facing crops: `light-detail.png` and `dark-detail.png` in that directory.

JavaScript syntax and diff whitespace checks passed. CSS surface check passed
(101 files); theme surface check passed (46 pages). These are local fixture
previews, not live-site screenshots. Deployment remains outside the current scope.

## Follow-up readiness review: additional work before release

The owner requested an analysis of remaining work after the deletion and menu
changes. This review did not change functional code. The successful-path results
above remain valid, but do not cover the following confirmed failure paths.

### High priority: connection acquisition escapes the DELETE error handler

`routes/hr.js` acquires `await pool.connect()` before entering the DELETE handler's
`try` block. Evaluating that actual handler with a synthetic rejected connection
promise produced a rejected handler promise and no HTTP status. Express 4 does not
automatically forward asynchronous handler rejections, and `server.js` exits on
`unhandledRejection`. A database connection outage can therefore terminate the
application process. Move connection acquisition inside guarded error handling,
rollback/release only an acquired client, and add a route-level regression for
connection acquisition failure. This is within the approved deletion repair scope.

### Medium priority: network failures have no user-visible recovery

`deleteStaffProfile` awaits readiness and DELETE without a catch, and the actual
`hrFetch`/`apiFetchWithAuthRetry` path permits fetch rejection. Evaluating the actual
frontend function with synthetic fetch failures confirmed:

| Failure | Requests | Result |
| --- | --- | --- |
| Readiness network failure | GET | Function rejects, zero notifications |
| DELETE network failure | GET, DELETE | Function rejects, zero notifications |

Add explicit pending/error states and scoped recovery. A lost DELETE response is
ambiguous: the server may already have committed. Reconcile the card with a fresh
authorized read rather than automatically resending the destructive operation.
Do not present a transport failure as proof that the delete did not happen.

### Medium priority: repeated invocation opens duplicate confirmations

Two concurrent invocations of the actual `deleteStaffProfile` function produced
two readiness requests and two form calls; completing both confirmations produced
two DELETE requests in the synthetic harness. There is no in-flight guard around
this workflow. This does not prove duplicate database deletion (the locked handler
should reject the second missing record), but does produce duplicate dialogs and
contradictory results. Use a per-card, context-bound pending operation released in
`finally`, disable the trigger while pending, and cover rapid clicks in Chromium.

### Remaining workflow and verification gaps

- The polished menu still offers Documents and Move although related document,
  status and pool-status operations remain behind the legacy staff boundary.
  Complete each operation's ownership/access contract or explicitly communicate
  its unavailable state; do not remove isolation to make the buttons succeed.
- PostgreSQL deletion checks were run locally against a minimal fixture. The new
  PostgreSQL test is not in the isolated runner or CI workflow, and the menu theme
  checks currently live only in a local QA runner. The route/browser deletion
  checks are wired into existing package commands. Before release, retain the
  important database/theme regressions in CI and verify against the full migrated
  disposable schema; exact-SHA CI and live QA are still pending.
- The earlier legacy non-FK concurrency limitation remains. The FK race test does
  not prove that a concurrent text-ID booking writer cannot create a stale staff
  reference. Addressing its writer/constraint contract requires the separately
  protected booking/migration scope and is not silently included here.

Recommended order: connection and frontend failure handling, duplicate-action
guard, reproducible CI coverage, then authorized release. Plan the remaining 16
route gaps as a workflow matrix so that each restored feature covers list, detail,
write, error and business-switch behavior together.

## Route-by-route follow-up matrix

Follow-up implementation now guards database connection acquisition, handles
readiness and DELETE transport failures, checks staff state after an ambiguous
DELETE response without retrying it, and locks the per-context card action while
pending. Documents and Move show an unavailable explanation when the existing
legacy surface availability says they are unavailable. The menu and deletion
browser checks are wired into the existing HR browser command; the minimal
PostgreSQL fixture and the fully migrated disposable-schema test are wired into
the HR PostgreSQL CI job. The migrated-schema test runs the actual HR router and
database queries but mocks external services and payroll outstanding aggregation.
It verified a schedule blocker, clean deletion and audit on a fresh local schema.
It does not replace the minimal-schema tests for synthetic unknown FK races.

All entries below concern the observed single Park membership context. The two
deletion routes are locally restored only for the current writable membership
with `hr.staff.manage`; foreign, aggregate, inactive and denied scopes remain
closed. The other routes still encounter the `staff_not_migrated` legacy staff
boundary in that context. Compatibility mode is governed by its existing policy,
not by this matrix. Each future recovery needs a separately reviewed ownership
contract and explicit Red approval for its exact access changes. Tests listed as
needed are not claims of passing coverage.

| Operation | Local status and next solution | Evidence or required verification | Approval |
| --- | --- | --- | --- |
| GET delete-readiness | Restored for manager; retain blockers and restricted financial projection | Actual-router positive/negative tests; full migrated schema | RED-STAFF-DELETE already granted locally |
| DELETE staff | Restored for manager; typed confirmation, transactional lock and audit | Actual router, PostgreSQL FK race and full migrated schema | RED-STAFF-DELETE already granted locally |
| GET history | Blocked; scope audit history by staff and business ownership | Denial reproduced; require scoped history and isolation tests | Separate exact Red access approval |
| GET lifecycle-checklist | Blocked; define ownership for checklist reads | Denial reproduced; require scoped read and isolation tests | Separate exact Red access approval |
| GET documents | Blocked; define document ownership and storage isolation | Denial reproduced; require list/read and isolation tests | Separate exact Red access approval |
| POST documents | Blocked; define upload ownership and cleanup | Denial reproduced; require upload and cross-business rejection | Separate exact Red access approval |
| GET medical-book | Blocked; define sensitive record visibility | Denial reproduced; require scoped read and privacy tests | Separate exact Red access approval |
| POST medical-book | Blocked; define sensitive record ownership | Denial reproduced; require write, audit and isolation tests | Separate exact Red access approval |
| GET resources | Blocked; define staff/resource ownership | Denial reproduced; require read and cross-business tests | Separate exact Red access approval |
| POST resources | Blocked; define assignment ownership | Denial reproduced; require assignment and cross-business tests | Separate exact Red access approval |
| GET offboarding | Blocked; define lifecycle ownership and history visibility | Denial reproduced; require scoped read and isolation tests | Separate exact Red access approval |
| POST offboarding | Blocked; review downstream account, payroll and lifecycle effects | Denial reproduced; require full lifecycle and isolation tests | Separate exact Red access approval and any affected sensitive scopes |
| GET offboarding-readiness | Blocked; define scope and financial projection | Denial reproduced; require privacy and isolation tests | Separate exact Red access approval |
| PUT status | Blocked; define activation ownership and account side effects | Denial reproduced; require status and account boundary tests | Separate exact Red access approval; account effects separately reviewed |
| PUT pool-status | Blocked; define placement ownership and history | Denial reproduced; require move and cross-business tests | Separate exact Red access approval |
| GET shifts | Blocked; define individual shift ownership and scoped projection | Denial reproduced; require staff-specific and cross-business tests | Separate exact Red access approval |
| PUT onboarding-assignment | Blocked; define assignment and education ownership | Denial reproduced; require write and cross-business tests | Separate exact Red access approval |
| PUT company-structure | Blocked; define structure ownership and writable scope | Denial reproduced; require read/write and cross-business tests | Separate exact Red access approval |

FK locks do not establish protection from a concurrent legacy writer that stores
a staff identifier as text or without a foreign key. Resolving that writer or
constraint contract is outside this deletion block and may require a separate
protected booking or migration approval.
