# LEAD-UI-2 handoff — 2026-09-27

Status: implementation and local verification complete, including the full
baseline, expanded real-API browser, final visual review, and fixture cleanup.
This is a continuation of [LEAD-UI-1](LEAD_UI_1_HANDOFF_2026-09-27.md)
in `C:\Users\Plotva\.codex\worktrees\omni-close-1\EventGenix`, branch
`codex/lead-unified-card`, on base
`6f17cd90f3157cba57806d710a9bed607b40ccde`.

No commit, push, deployment, production mutation, migration, permission/provider
change or booking/timeline change belongs to this task. Existing uncommitted
LEAD-UI-1 changes are the starting point and must be preserved.

## Files changed in LEAD-UI-2

The worktree's aggregate diff includes LEAD-UI-1. The following files were added
or further changed for the editor task specifically; this is not a claim that
every changed line in those shared files belongs to LEAD-UI-2.

| Files | Task-2 responsibility |
| --- | --- |
| `leads.html` | Shared editor form, create/workspace mounting hosts, grouped fields, accessible controls |
| `css/pages-leads.css` | Embedded editor layout, mobile controls, scoped light/dark select styling |
| `js/leads-page.js` | Shared create/edit lifecycle, sparse save, request/draft guards, list/focus preservation |
| `tests/lead-workspace-navigation.test.js` | Editor/navigation behavior regressions, including race and payload preservation cases |
| `tests/dashboard-leads-drilldown.test.js` | Align existing dashboard drilldown fixture harness with current workspace navigation |
| `tests/ui-check.js` | Current shared-editor/static UI expectations |
| `tests/browser/omni-lead-links-actual-app-browser-smoke.js` | Real API editor, error, mobile, contact/Omni preservation, and visual checks |
| `tests/browser/lead-editor-mode-fixtures.js` | Isolated customer-prefilled creation and Maysternya preservation scenarios |
| `tests/browser/lead-editor-navigation-fixtures.js` | Delayed real hydration, native history/Esc, and discard scenarios |
| `docs/LEAD_WORKSPACE_UI_CONTRACT.md`, `docs/LEAD_UI_2_HANDOFF_2026-09-27.md` | Editor contract, verified results, limitations and next-task handoff |

Other inherited dirty files, including entry-point work, package test wiring and
the Omni contract crosslink, must not be restored or dropped as unrelated cleanup.

## Implementation decision and API audit

The old `editLead` relied on the paginated `leadsData` array, so a valid direct-URL
lead could not open its editor. It also always sent nearly every form field:
unchanged lead type can reset the stage, hidden Maysternya fields could be cleared,
and `eventPreference.notes` could be overwritten by `null`. The duplicate-submit
lock started after asynchronous type preparation, leaving that phase unprotected.

The implementation uses one `#leadEditorForm`, moved between creation's
`#leadCreateEditorHost` and Details' `#leadWorkspaceEditorHost`, with one validation,
payload, and save pipeline. The workspace GET provides a real record by ID/business
and an editor baseline; no new generic lead GET is needed. Retain the original
creation modal and customer handoff, without a parallel edit implementation.

The current product diff has been independently reviewed for sparse payloads,
asynchronous hydration/save completion, shared-form remounting, and guard behavior.
No additional actionable regression was identified in that focused source review;
the separate executed verification evidence is recorded below. Implemented behavior includes:

- Unknown source/assignee select values are retained through a temporary option.
- Same-lead tab/history changes keep the draft; a data refresh temporarily parks
  and remounts the same form node, preserving values, listeners, focus and scroll.
- Editor hydration validates its request sequence, current session, business and
  lead; an earlier request cannot replace a newer card/editor.
- Save holds the duplicate-submit lock through reason/task preparation, disables
  form controls, and respects the captured session before applying results.
- Native `beforeunload` also covers an active request even when the initial
  prefilled form was not dirty. Cancelled in-app navigation keeps the same draft.
- A collaboration task response advances only committed workflow baseline fields;
  a later contact-save error retains the remaining draft for a sparse retry.
- List refresh preserves filters, loaded window and scroll; its failure is reported
  as a refresh failure after persistence, rather than silently retrying a create.
- Closing after a list repaint returns focus to the current opener or search when
  the original invoking node was replaced.

Double-submit protection covers one active preparation/request. This task does
not add server idempotency or promise exactly-once create after a lost response,
reload, or unknown server outcome. Collaboration task/type creation and the
subsequent contact PATCH are separate commits; a known successful workflow step
is retained and disclosed if the contact save fails.

Read-only source audit of `routes/leads.js` confirmed:

- `GET /api/leads/:id/workspace` returns editable camelCase lead fields and the
  stored event preference; there is no generic `GET /api/leads/:id`.
- `PATCH /api/leads/:id` preserves omitted fields. Explicit unchanged `lead_type`
  and `pipeline_stage` can still invoke existing workflow rules/hooks; a diff
  payload is required.
- `eventPreference: null` clears its record. `event_date` also activates preference
  normalization. Preserve preference notes during date/count updates; omit an
  untouched preference and hidden fields.
- `POST /api/leads/:id/collaboration-task` commits task/type together; later contact
  PATCH is separate. A retry must retain the successful workflow state rather than
  create another task.
- Existing create/stage/type rules own lost reasons, quality categories,
  collaboration, deposit effects, child sync, and booking/customer behavior.
  This UI task must reuse them without changing those contracts.

The [shared UI contract](LEAD_WORKSPACE_UI_CONTRACT.md) retains the task-1 inventory
and now specifies editor mounting, partial-save rules, one draft, and guarded
navigation. Do not merge lead notes, customer notes, and event-preference notes.
Do not infer or write Omni links from changes to name/phone.

## Verification record

Execution runtime: Node 22.23.1 / npm 10.9.8, with portable isolated PostgreSQL
18.6. CI/PostgreSQL 16 and production behavior were not run in this local task.
Canonical commands:

```text
npm run check:runtime
node --test tests/lead-workspace-navigation.test.js
npm run check:syntax
npm run test:ui
npm run test:browser:omni-links:isolated
npm test
git diff --check
```

The actual browser command was
`node scripts/run-isolated-postgres-tests.js omni-links-browser`, through a
temporary process-local disposable-runtime wrapper with cached Playwright in
`NODE_PATH`. No dependencies or persistent environment settings were added.

| Check | Actual result / remaining verification |
| --- | --- |
| Editor/navigation behavior | Latest focused suite 22/22 passed; `%TEMP%/lead-ui2-behavior-final.log` |
| Adjacent regression checks | 35/35 passed; separate run, not an additional unique-test count |
| Dashboard lead navigation | 3/3 passed after updating the old fixture harness for current lead navigation |
| UI/static smoke | 1326/1326 passed; `%TEMP%/lead-ui2-ui-check-updated.log` |
| Expanded actual-app browser | Final rerun passed, exit 0, `success: true`, with real API/isolated PostgreSQL; `%TEMP%/lead-ui2-browser-final-verified.log` |
| Full `npm test` | Final rerun passed, exit 0: main units 3131/3131, UI 1326/1326, final Omni links 20/20; `%TEMP%/lead-ui2-npm-test-final.log`. The first run's two old fixture expectations were corrected before this successful rerun |
| Screenshots | Twelve final artifacts captured. Final dark desktop, dark mobile top, light mobile top, and 390x420 footer screenshots visually reviewed. Automated text contrast at least 4.5:1, dropdown-arrow geometry, and footer reachability checks passed |
| Fixture cleanup | Completed: `pg_ctl stop` exit 0; subsequent status exit 3 confirmed stopped; only this run's registered temporary cluster directory removed |
| CI, deployment, production writes and provider sends | Not performed; production delivery belongs to LEAD-UI-4 |

The passing expanded browser run covers real create/edit/reload, all editable
field groups, validation and network errors with retained draft, duplicate-click
protection, type-reason flow, customer-prefilled creation, Maysternya hidden-field
preservation, and mobile Save/Cancel reachability at 390x844 and 390x420. The
existing canonical conversation origin and manually selected primary survive a
real contact PATCH. The main flow also checks exact Instagram navigation, return,
link/primary actions, reload, and direct selection despite conflicting filters.

`lead-editor-mode-fixtures.js` uses the canonical
`action=create&customerId=...` entry point and checks that opening it creates no
records before explicit submit. `lead-editor-navigation-fixtures.js` delays a
successful real `route.fetch()` response: closing the loading editor and opening
another lead cannot mount the stale form. Visible openers build browser history;
native Back across same-lead tabs preserves the draft, closing Back and Esc can
be declined, and explicit discard leaves the stored records unchanged. These
helpers use only the runner's isolated pool and do not mock successful API data.

Browser assertions are distinct from source/behavior tests: business-switch and
save-completion race coverage in the behavior harness is not a production QA
claim. Implementation, UI, and QA reviewers inspected the final editor screenshots
listed as reviewed below after the successful rerun; this is not a claim that all
twelve final captures were manually reviewed. Tests wait for finite animations
before measuring/capturing the UI; production CSS transitions were not changed to
make the checks pass.

Reviewed editor screenshot artifacts:

- [Dark desktop editor](../output/playwright/omni-lead-links/dark-desktop-inline-lead-editor.png)
- [Mobile editor top](../output/playwright/omni-lead-links/mobile-inline-lead-editor-top.png)
- [Dark mobile editor top](../output/playwright/omni-lead-links/dark-mobile-inline-lead-editor-top.png)
- [Mobile 390x420 footer](../output/playwright/omni-lead-links/mobile-420-inline-lead-editor.png)

Additional captured editor artifacts are the [desktop editor](../output/playwright/omni-lead-links/desktop-inline-lead-editor.png)
and [390x844 footer](../output/playwright/omni-lead-links/mobile-844-inline-lead-editor.png).
The other six workspace/Omni captures retain the paths listed in the task-1
handoff; that earlier task's review is separate from this final editor review.
Screenshot review and automated checks do not replace production delivery or the
owner's deferred manual QA.

Cleanup checked the resolved temporary path and registry ownership before
removing only `eventgenix-lead-ui2-pg-4acb1ee50814499f801d7de155ad4fb5` under
the local temporary directory. Shared PostgreSQL binaries and other clusters were
untouched. Screenshots and execution logs are outside that directory and remain
available. All mutation scenarios used disposable fixtures; no production DB,
real-customer edit, message send, or provider/AI call was used.

## Remaining scope after this task

LEAD-UI-3 still investigates the failed-send explanation and low-height Omni
loading observation. LEAD-UI-4 owns release and deferred owner manual tests
**3-8**. Automated fixture results do not mark those manual tests complete.
Do not release this local intermediate step or rerun production backfill.

Continue LEAD-UI-3 in the same worktree and branch named above, preserving the
combined uncommitted LEAD-UI-1/2 diff. Recheck current live/remote identity before
any later integration or release; the recorded base SHA is not evidence that
this local UI is deployed.
