# Staff workflow recovery: incident audit and implementation contract

Status: locally implemented under `RED-STAFF-WORKFLOWS`. The sections below
record the original audit and the implementation contract. Production remains
at the audited baseline unless released separately.

## Implementation and verification

- The 29 operation pairs now have explicit Park membership and capability
  checks. Private document endpoints enforce staff management, including HEAD.
  Document and medical-book writes commit with their audit record.
- Both move entry points load the profile revision and submit it with the
  existing profile endpoint. Context changes cancel pending confirmation.
  Placement and activation still use separate requests. A partial success or
  an uncertain response is shown explicitly, with a fresh team read when the
  same context is active.
- Stock issue and return use the selected business. The migrated database
  exposed a separate return bug where PostgreSQL rejected a numeric quantity
  serialized as `2.00` in an integer stock update. The service validates and
  passes an integer. Shared costumes have no business ownership column and
  remain excluded from Park membership resource actions.
- Shared CRM accounts are blocked before global account activation or
  deactivation. The company structure write requires a matching revision and
  clears references only to nodes removed from the previous saved tree.
- Focused route and UI regressions passed. Three scenarios passed on a fully
  migrated disposable PostgreSQL database, covering document and medical-book
  lifecycle, permanent deletion, move revision, stock return and isolation,
  shared-account protection, company-structure revision, general onboarding
  template/checklist writes and individual shift isolation. Chrome verified
  menu actions at 390px and 1100px in both themes with synthetic API responses.
  Assigning an onboarding owner and syncing the generated tasks have
  access-boundary coverage. This run did not exercise that complete workflow
  against PostgreSQL.
- Node 22.14.0 and npm 10.9.8. The final unit run passed all 3,985 tests,
  and the separate UI, My Day, CRM automation, multibusiness and
  timeline/marketing commands passed. Earlier full runs exposed stale
  assertions and Windows temporary-directory and Git Bash configuration
  issues. Those failures passed in the reruns with updated fixtures and
  local environment settings.

## Verified baseline and scope

- Production source fetched on 2026-11-13: `9b190f789ebc0732bec7d3803fb229122eda7de5`.
- Public `/api/version`: `0.83.41`, source branch `codex/eventgenix-production`,
  same commit SHA, complete manifest identity.
- Clean audit branch: `codex/staff-workflows-audit-20261113`.
- The owner screenshot shows the explicit unavailable menu state for Documents
  and Move, plus an update notification. It does not show a database exception
  or prove that the selected employee record is damaged. Refreshing can update
  cached UI but cannot restore endpoints that are still blocked in this version.
- No real employee, private document, database row or authenticated production
  response was inspected or changed. The prescribed live QA credentials file is
  absent. All identity and mutation fixtures below are synthetic and local.

## Confirmed findings

1. `renderTeamCardOverflowMenu` in `js/hr-page.js` uses the broad legacy `staff`
   availability flag to disable Documents and Move. The flag cannot distinguish
   already recovered profile editing from the unrecovered child operations.
2. The HR legacy boundary still rejects 29 operation/path pairs listed below.
   Actual Express-router tests reproduce `403 staff_not_migrated` for both
   synthetic director and creator, before SQL/service mutations: 58 denials.
   Successful deletion readiness is the positive control for both principals.
   This expands the earlier 16-operation inventory; these are API operations,
   not 29 distinct visible buttons or proven failures across all CRM modules.
3. Move has an independent contract failure. `openStaffMoveMenu` and
   `moveStaffToBucket` use `PUT /staff/:id` without `X-Staff-Profile-Revision`.
   The restored Park profile handler requires this header and returns
   `428 STAFF_PROFILE_REVISION_REQUIRED`. The actual menu function connected to
   the actual HR route reproduces this failure without database access.
4. Move's transport rejection escapes its `try/finally` without notification.
   A business change while its form is open does not cancel the subsequent PUT.
   Both are reproduced with the actual frontend function and synthetic I/O.
   The stale request reproduction does not demonstrate cross-business mutation;
   server isolation still applies.
5. Private-data capability checks need correction before recovery. Generic GET
   classification chooses `hr.staff.view`; the inline `requireHrManage` then
   accepts any previously resolved `req.hrCapability`. Executing both actual
   guard functions proves this for the documents path. The current membership
   legacy boundary masks it; no production document disclosure is claimed.

## Exact reproduced inventory

All paths are relative to `/api/hr`; `:id` is a synthetic staff ID.

| Family | Methods and paths | Count |
| --- | --- | ---: |
| History | GET `/staff/:id/history` | 1 |
| Lifecycle | GET `/staff/:id/lifecycle-checklist` | 1 |
| Documents | GET/POST `/staff/:id/documents`; GET `/staff/:id/documents/:documentId/download`; GET `/staff/:id/documents/:documentId/preview`; DELETE `/staff/:id/documents/:documentId`; PUT `/staff/:id/documents/:documentId/restore` | 6 |
| Medical book | GET/POST `/staff/:id/medical-book`; PATCH `/staff/:id/medical-book/:certificationId` | 3 |
| Resource lifecycle | GET/POST `/staff/:id/resources`; PUT `/staff/:id/resources/:assignmentId/return`; PUT `/staff/:id/resources/:assignmentId/status` | 4 |
| Resource picker | GET `/resource-options` | 1 |
| Offboarding | GET/POST `/staff/:id/offboarding`; GET `/staff/:id/offboarding-readiness` | 3 |
| Activation | PUT `/staff/:id/status` | 1 |
| Placement | PUT `/staff/:id/pool-status` | 1 |
| Individual shifts | GET `/staff/:id/shifts` | 1 |
| Profession report | GET `/role-assignments/report` | 1 |
| Training assignment | PUT `/staff/:id/onboarding-assignment` | 1 |
| Profession checklist | PUT `/staff/:id/profession-checklist` | 1 |
| Training start/template/check | POST `/onboarding/start`; POST `/onboarding/templates`; PUT `/onboarding/:id/check` | 3 |
| Company structure | PUT `/company-structure` | 1 |
| Total | | 29 |

Do not count existing recovered lanes as new legacy failures:

- GET/PUT `/staff/:id/role-assignments` use the separate payroll access/ownership
  lane. An incomplete diagnostic mock initially returned 503 at its ownership
  query; that is not evidence of a production failure. Its payroll permissions
  must remain separate from ordinary staff management.
- GET `/staff/:id/onboarding-assignment` and `/onboarding-processes` are served
  by `parkHrProfessionRead` before the legacy boundary. They are not in the 29.
- Base profile GET/PUT and deletion already have bounded recovery rules.

## Additional source findings to address before opening the affected flows

These are source findings, not demonstrated production exploits:

- `hrStaffMedicalBook.createStaffMedicalBook` accepts business context from the
  request payload; list/update queries do not consistently constrain that field.
  Bind it to server-resolved ownership and reject conflicting context. Document
  joins must preserve both document and employee ownership. Existing null legacy
  ownership needs an explicit Park-only policy, not arbitrary reassignment.
- `hrStaffResources` scopes warehouse issuance, but return/status routes do not
  pass the request business context. Return derives it from the stored stock row.
  Verify the employee, assignment and stock/costume ownership together before
  stock mutation; do not adopt a foreign stock's context as authority.
- History/lifecycle/offboarding contain account, payroll and audit data. Project
  fields by the existing capabilities; a dependency may remain a blocker without
  exposing amounts or private account metadata.
- Offboarding/status affect linked CRM accounts, sessions and future schedules.
  Preserve self/owner protection, `manage_accounts` and payroll blockers; reject
  account side effects crossing the authorized business. Never disable a shared
  account globally merely because Park employment ends.
- Several lifecycle handlers acquire `pool.connect()` outside their error guard.
  Move acquisition inside guarded handling and test connection/audit failures.
- Company-structure recovery projects out `updatedAt`, while the write handler
  uses it for optimistic concurrency. Restore the version in the authorized
  contract before enabling writes. Its stale-reference cleanup updates staff and
  professions across the legacy namespace; prove Park ownership and constrain
  that cleanup to the reviewed tree change, not an unrestricted reset.
- Returning dismissed staff currently chains profile PUT and activation PUT.
  This can partially succeed. Require a coherent transaction or explicitly
  reconcile partial completion before presenting a success message.

## Proposed bounded implementation

### 1. Operation contract and private reads

Use one explicit operation matrix (exact method/path, business ownership,
capability, read/write and frontend availability), scoped to the existing Park
staff namespace. Require current single active membership, matching organization,
writable scope for writes, exact valid identifiers, and existing explicit denies.
Do not enable the entire legacy staff surface or grant new global roles.

Private documents, medical records, resources and sensitive lifecycle reads must
require staff management, not ordinary staff viewing or delegated profile editing.
Keep schedule/report capabilities and payroll rules distinct. For compatibility
requests, private guards must also hold; do not rely only on the recovery branch.

### 2. Complete operations

- Documents: list, upload, private preview/download, archive and restore as one
  workflow; maintain upload limits and matching staff/document identifiers.
- Medical/resources: server-owned business context on every read/write and
  linked-resource check; retain audit and transactional inventory behavior.
- History, lifecycle and schedule detail: scoped reads and sensitive projection.
- Training: paired reads/writes, responsible-person ownership and task ownership;
  preserve canonical checklist writers and existing task side-effect rules.
- Company structure: validate the complete tree/employee references in scope,
  preserve revision/conflict behavior, reject foreign or ambiguous nodes.
- Status/offboarding: retain existing checks; enforce business-safe account side
  effects. Do not change payment settlement or protected booking contracts.

### 3. Move and frontend state

Read fresh staff detail/revision before offering a move, send that revision,
handle 409/428 with visible review rather than blind retry, and preserve current
blacklist reasons/professions. Apply the same contract to drag-and-drop.
Capture business/session and team generation before asynchronous work; cancel
stale submission, guard double actions, handle offline failures and reconcile
ambiguous writes. Make placement plus reactivation coherent.

Render each menu/tab from operation availability with an actionable explanation,
not the aggregate legacy flag. Verify direct menu actions and profile tabs agree.

### 4. Acceptance and release preparation

Replace incident denial expectations with positive actual-router workflows and
negative isolation tests for every recovered operation. Use disposable migrated
PostgreSQL for ownership, foreign identifiers, transactional rollback, audit,
revision conflicts and resource/account effects. Use actual browser clicks in
light/dark and mobile/desktop for menu, documents, move, context change and errors.
Run Node 22/npm 10 checks. Production release remains a separate exact-SHA CI and
manual-helper envelope after the candidate is prepared and reviewed.

## Authorization boundaries

Proposed `RED-STAFF-WORKFLOWS` covers local code/test changes for the above 29
operations, shared operation availability, profile move/revision/error handling,
private-data capability checks, and business-safe linked-account side-effect
guards. Intended files: HR routes/frontend, focused Park staff access/projection
helpers, HR documents/medical/resources/training/lifecycle services and associated
tests/docs. Preserve existing role grants, payroll/payment authorization, booking
contracts, and unrelated module behavior.

No production data mutation, migration/backfill, real employee move/deletion,
password/session administration, secrets/settings/CI modification, push or deploy
is included. If schema work or another protected surface is required, provide its
exact reviewed delta separately. Rollback at this stage is removal of only these
local task-owned edits; production remains unchanged.

## Verification actually performed

Node `22.14.0`:

`node --test tests/hr-staff-workflow-incident-audit.test.js tests/park-hr-staff-deletion.test.js tests/park-hr-staff-card-routes.test.js`

Result: **32 tests passed, zero failed/skipped**. Includes five new incident
characterizations and existing deletion/card regressions. SQL/external services
are synthetic adapters. `git diff --check` passed. These results reproduce the
problem and preserve the previous repair; they are not acceptance of a fix.
No full npm baseline, migrated database, browser QA, CI or deployment was run for
this audit-only change.
