# LEAD-UI-1 handoff — 2026-09-27

Status: LEAD-UI-1 local implementation and required verification completed.
The final full baseline and actual-app browser checks passed. This intermediate
step remains local and does not authorize a release.

## Base and scope

- Verified implementation base, live SHA, and remote production SHA at task
  start: `6f17cd90f3157cba57806d710a9bed607b40ccde` (v0.82.30).
- Production branch at that check: `codex/eventgenix-production`.
- Local feature branch: `codex/lead-unified-card`.
- Reused worktree: `C:\Users\Plotva\.codex\worktrees\omni-close-1\EventGenix`.
- Scope: one viewing workspace and its entry points; existing editor remains
  until LEAD-UI-2. Do not release this intermediate step by itself.
- No commit, push, deploy, production writes, schema/permission changes, provider
  calls, or backfill are part of this task.

## Root causes and changes

The table's `Деталі` action called `editLead`, while `Кейс` opened a different
workspace. Contact/customer actions were duplicated, and the old customer-card
opener could create a customer while appearing to be a view action. Source links
did not consistently carry the business context; task links also used an `open`
query alias that the lead workspace did not read.

| Files / area | Local change |
| --- | --- |
| `leads.html`, `js/leads-page.js`, `css/pages-leads.css` | Existing workspace gains Overview, Lead data, Communications, and History tabs; table has one primary view action; pencil/legacy details open read-only data; page-owned CSS and scoped theme overrides |
| Workspace navigation | `lead`, `leadTab`, business context, legacy aliases, Back/Forward, focus return, stale-response rejection, keyboard tabs, editable-surface guards |
| Workspace content | All prior sections retained; lead/customer data and explicit customer/edit actions move to Details; hero has call/channel/tab actions; first three task/booking rows plus native expansion retain all loaded records |
| Customer view/create | Read opener never ensures a customer; explicit Create/Link controls retain guarded operations; booking/conversion helper unchanged |
| Instagram display | Presence label in summary, unverified stored value in Details disclosure; no invented username or stored-data rewrite |
| `omni.html`, `js/customers-page.js`, `services/taskDetailContract.js` | Narrow lead URL fixes preserve business context and route through the same workspace; task source handling outside lead navigation is unchanged |
| Navigation, UI, task-detail and browser tests; `package.json` | Navigation/read-only regression coverage, task lead URL parity, and existing test-runner inclusion; no workflow edit, dependencies, or changed governance limits |
| Documentation | [UI contract](LEAD_WORKSPACE_UI_CONTRACT.md) contains the field/action/entry matrix; [Omni contract](OMNI_LEAD_CONVERSATION_LINKS.md) links to it |

Reading the product diff found no lost prior data sections: linked customer and
children, inbound IDs/UTM, bookings, tasks, history, confirmed conversations and
suggestions remain reachable. Guest counts now retain explicit zero versus
missing values through a view adapter, without changing the shared conversion
helper. This static inventory review is not a substitute for behavior tests.

## Visual failure found during verification

The first actual-app browser run satisfied its API/interaction assertions, but
screenshot review found visual failures. A transformed main container established
the wrong containing block for the fixed workspace, and flex shrinking affected
the card layout. That run is not accepted as a visual pass.

The completed scoped repair moves the fixed workspace/backdrop outside the
transformed main container and prevents workspace content sections from
shrinking. Styles are in `css/pages-leads.css`; scoped dark-mode overrides work
with the actual global tokens, and governance limits are unchanged. No shared
booking/timeline layout was changed.

The final actual-app rerun passed. Desktop 1366x900 and mobile 390x844 screenshots
in light/dark mode were visually reviewed. Workspace bounds and tab-label contrast
checks passed across all four tabs, with a minimum ratio of 4.5:1. This is targeted
contrast verification, not a claim of full WCAG conformance.

Local screenshot evidence (ignored output files; retained in this worktree):

- [Desktop overview](../output/playwright/omni-lead-links/desktop-lead-overview.png)
- [Desktop communications](../output/playwright/omni-lead-links/desktop-lead-links.png)
- [Desktop dark details](../output/playwright/omni-lead-links/dark-desktop-lead-details.png)
- [Mobile details](../output/playwright/omni-lead-links/mobile-lead-details.png)
- [Mobile dark details](../output/playwright/omni-lead-links/dark-mobile-lead-details.png)
- [Mobile direct Omni open](../output/playwright/omni-lead-links/mobile-direct-open.png)

## Verification record

Execution runtime: Node 22.23.1, npm 10.9.8. The actual-app browser used a portable
isolated PostgreSQL 18.6 fixture. CI's PostgreSQL 16 was not run in this local task.
These are the relevant canonical commands; results are recorded separately below:

```text
npm run check:runtime
node --test tests/lead-workspace-navigation.test.js
npm run check:syntax
npm run test:ui
npm run test:lead-conversation-links
npm run test:browser:omni-links:isolated
npm test
git diff --check
```

The actual browser execution used
`node scripts/run-isolated-postgres-tests.js omni-links-browser` through a
temporary process-local disposable-runtime wrapper, with cached Playwright
resolved through `NODE_PATH`. It is the same isolated runner underlying the
canonical npm command above; no dependencies were added or installed for this
task, and no persistent environment/secrets settings were changed.

| Check | Current evidence / remaining work |
| --- | --- |
| Static content and entry-point inventory | Reviewed against current product diff; task `open` alias gap found and handled in the navigation implementation |
| Targeted automated tests | Current navigation suite: 10 passed; earlier targeted regression set: 44 passed. Separate runs, not an aggregate unique-test count |
| Full baseline | Final `npm test` passed, exit 0: main unit 3119/3119, My Day 344/344, UI 1326/1326, final Omni links 20/20. Local execution log: `%TEMP%/lead-ui1-npm-test-final-20260927.log` |
| Corrected UI suite | `npm run test:ui` passed, 1326/1326, exit 0. The first full run's single stale pencil-to-`editLead` expectation was updated for read-only Details; the complete rerun above passed |
| Actual-app browser | Final rerun passed with real isolated API/DB: table open, four tabs without mutation requests, actual Instagram click, Back to same lead/tab, manual link and repeat submit, primary change preserving origin, reload, direct open with conflicting filters, mobile |
| Desktop/mobile screenshots | Final six artifacts above reviewed; light/dark, desktop 1366x900 and mobile 390x844, bounds and minimum 4.5:1 tab contrast passed |
| CI, deploy, live behavior of new UI | Not run; delivery belongs to LEAD-UI-4 |
| Production records/provider requests | Not performed in this local task |

Cleanup completed: this run's PostgreSQL instance was stopped (subsequent status
exit 3), and the exact temporary database root, wrapper, and DPAPI credential were
removed. Shared binaries and older data were left untouched. No production
database was used; the browser assertions observed zero mutation requests while
viewing/switching tabs, and the only write scenarios targeted isolated fixtures.
Screenshots and navigation were exercised without sending messages. Test-owned
screenshot artifacts remain for handoff. These checks do not replace the owner's
deferred manual QA or test the new UI in production.

## LEAD-UI-2 handoff and remaining work

Continue in this same worktree and read the complete current diff plus the UI
contract before editing. Do not reconstruct the work from the older release.
`editLead` still depends on `leadsData`; a directly opened lead outside the loaded
list can lack editor data. LEAD-UI-2 must supply the real record by ID, embed one
editor in Details, and preserve create flow, all fields, quality reasons,
collaboration tasks, Maysternya, and customer handoff.

Protect drafts on tab/lead/business/history changes, duplicate submits, stale
saves, and errors. Do not combine lead notes with customer notes/event preferences
or clear fields that were not edited. Preserve Omni origin/primary. Keep the
existing `customerCardModal` until its remaining callers are traced.

Owner manual tests **3-8 remain pending**: manual lead/link/reload; multiple
channels with origin preserved when primary changes; repeat submit; two leads in
one chat; closed/unavailable/cross-business chats with filters/pagination; desktop,
mobile including 390x420, keyboard/focus/history and draft protection. LEAD-UI-4
must explicitly remind the owner and record manual results separately from local
automation. Failed-send cause and the older 390x420 loading observation remain
LEAD-UI-3 investigations.
