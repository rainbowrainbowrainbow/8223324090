# PARK/DAR follow-up acceptance and release review

Date: 2026-09-05. Production impact: no. Local review candidate only.

## Outcome by task

| Task | Outcome |
| --- | --- |
| PD1 | Implemented. Explicit next customer, empty cart/discount reset, last-row removal, durable submitted request recovery, same-origin Web Locks serialization and stale-tab reset guard. Previous confirmed pending receipts stay in the register-wide queue. |
| PD2 | Implemented and visually checked. Theme-safe select arrows, full-width wrapped selected item name, ordinary cashier wording, empty/unpaid/completed/intervention states, TEST warning retained. Existing shared close modal verified, not rewritten. |
| PD3 | Implemented locally under owner block `PARK-DAR-REUSABLE-TEST-DAY-LOCAL`. Durable physical stop, canonical close, explicit verified CLOSED/empty-queue resume, immutable history and serialized replay. See `REUSABLE_TEST_DAY_LOCAL_ACCEPTANCE_20260905.md`. |
| PD4 | Local mock/DB/browser acceptance includes PD3 two-cycle and failure/replay cases. Live owner-device and integrated R7B acceptance remain deferred. |
| PD5 | Scoped review candidate prepared; delivery is blocked on approval and the current R7B integration boundary. No commit/push/deploy. |

## Source and changed paths

- Worktree: `C:/Users/Plotva/.codex/worktrees/0eb7/EventGenix`.
- Branch: `codex/park-dar-cashier-followup-20260905`.
- Base/HEAD: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`.
- Runtime: Node 22.23.1 / npm 10.9.8. Dependencies were read from an existing local
  installation using `NODE_PATH`; package script registers the new unit test, with no dependency/lockfile/version changes.
- UI: `cashier-payments.html`, `css/cashier-payments.css`, `js/cashier-payments-page.js`.
- Tests: `tests/cashier-next-customer.test.js`,
  `tests/browser/cashier-catalog-layout-browser-smoke.js`,
  `tests/browser/cashier-next-customer-browser-smoke.js`,
  `tests/browser/cashier-payments-browser-smoke.js`, `tests/ui-check.js`.
- Docs: this file, `IMPLEMENTATION_STATUS.md`,
  `SHARED_TEST_END_OF_DAY_PROPOSAL.md`,
  `archive/IMPLEMENTATION_STATUS_20260903.md`, `docs/PARK_DAR_FOLLOWUP_PROGRESS.md`.
- PD3 backend/schema/test paths are itemized in `REUSABLE_TEST_DAY_LOCAL_ACCEPTANCE_20260905.md`
  and the complete review manifest. Local server admission/close rules changed as authorized.
- No permission/auth/session/SW, Hermes/scheduling, production settings, release
  version/cache or protected manifest edits.

## Evidence

All paths below are relative to this worktree. `output/` is ignored evidence,
not a set of operator scripts to include in the application release.

| Check | Result / evidence |
| --- | --- |
| Original PD1 regression reproduction | Four tests failed on baseline for completed create, carried cart/discount, cashier key reuse and last-row removal. |
| Focused Node tests | 127/127 PASS, `output/park-dar-targeted.log`. |
| Canonical cashier browser smoke | PASS, `output/park-dar-browser.log`; current auth scripts, cash/manual card, duplicate clicks, queue refresh/failure/staleness, pending receipt and Phase-1 close safeguards. |
| Next-customer browser smoke | PASS, `output/park-dar-next-customer-browser.log`; lost create response retained by mock server, reload, concurrent tabs, stable key, stale-tab reset rejection, identical next cart creates a second order, pending queue retained, completed create disabled. |
| Disposable PostgreSQL + local provider | PASS, `output/park-dar-postgres.log`, `output/catalog-sale-local-qa-report.json`. One physical test register, PARK/DAR sequential routes, both tenders, DAR discounts/hourly quantity rules, idempotency conflict rejection, same-UUID lookup-only recovery, no duplicate sale POST, final zero queues/unknowns/open shifts. |
| Required repository gates | Final `npm test` PASS, exit 0; `output/park-dar-npm-test.log`. Includes `check:runtime`, `check:syntax`, `check:checkbox-safety` and UI 1310/1310. |
| Whitespace/scope | `git diff --check` passed. |
| Public live metadata | Read-only version/health: v0.81.75, SHA `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`, production branch, health `ok`. No provider login or protected DB audit. |

The table above retains pre-PD3 evidence and historical public observations.
Final PD3 evidence supersedes its local test rows: targeted **154/154**, full
`npm test`, all three cashier/PD1/PD2 browser smokes, the new stop/resume browser
smoke, and two-cycle disposable PostgreSQL/mock QA PASS. Exact commands, scenarios
and `output/park-dar-pd3-*` logs are in the dedicated PD3 report. No new live checks
were performed during the local authorization block.

Commands actually used (Node 22/npm 10, existing dependencies):

```powershell
node --test tests/cashier-next-customer.test.js tests/catalog-sale.test.js tests/catalog-sale-manual-ui.test.js tests/payment-readiness.test.js tests/fiscal-cashier-operations.test.js tests/payment-workflow.test.js
npx --offline -y -p playwright node tests/browser/cashier-payments-browser-smoke.js
npx --offline -y -p playwright node tests/browser/cashier-next-customer-browser-smoke.js
node scripts/run-isolated-postgres-tests.js catalog-sale-local-qa
npm test
git diff --check
```

The DB runner used only the task-owned loopback container
`eventgenix-park-dar-followup-test-0eb7`, database `eventgenix_park_dar_test`,
port `15439`, with its explicit disposable reset confirmation. No production URL
was loaded or used as a fallback. Its generated synthetic report was moved from
`outputs/` to ignored `output/` after inspection.

Visual evidence: `output/playwright/park-dar/08-catalog-{light,dark}-{1440,390}.png`
and `09-close-modal-{light,dark}-{1440,390}.png`, plus empty, TEST-disabled,
pending/unavailable and completed receipt snapshots. Selected name width was
measured after the responsive layout settled. Modal cancel, Escape, focus return,
duplicate submit and final CLOSED focus passed. The screenshots use synthetic
customers/operators only; earlier negative-fixture notifications may remain visible.

## Bounded pre-approval follow-up: schema and zoom

The PD3 redesign replaces the earlier terminal stop with a historical
`draining -> closed -> resumed` lifecycle. Verified INTEGER/BIGINT keys and one
exact composite shift/profile/register FK remain; each cycle has its own BIGINT
ID and unique shift. A partial unique index permits only one active draining/closed
stop per register while resumed history remains immutable. Route keys are
VARCHAR(64), verified against migration 351.

The implemented explicit same-owner resume requires current authority on BOTH logical
routes, unchanged exact test scope/opener binding, fresh provider CLOSED, no
current/newer/unresolved shift and zero register-wide blockers/unknowns. It removes
only the selected local drain gate: no automatic midnight/restart action, history
deletion, provider mutation, shift/receipt creation or acceptance-flag update.
Global acceptance OFF still blocks sales after resume. The same physical lock
serializes lifecycle/start/admission actions; historical replay of cycle A cannot
release cycle B. Two full local test cycles now pass against migration 352 and
the real HTTP/services/outbox with a loopback provider. Drain-aware rollback remains
a release prerequisite; no production rollback was exercised.

Local zoom probe: `npx --offline -y -p playwright node output/park-dar-zoom-check.js`.
Evidence: `output/park-dar-zoom-check.log`,
`output/playwright/park-dar/zoom/report.json`, and eight PNGs in that directory.
Chromium 153.0.8010.12 ran headless with canonical single-tab auth scripts and
synthetic loopback API fixtures. Neither attempted browser shortcut changed the
1440x1000 CSS viewport, DPR 1, visual viewport scale 1, or CSS zoom 1:

| Requested browser zoom | Attempt | Observed zoom |
| --- | --- | --- |
| 125% | Ctrl+0, Ctrl+Equal twice | Unchanged; NOT VERIFIED |
| 150% | Ctrl+0, Ctrl+Equal three times | Unchanged; NOT VERIFIED |

This runner did not demonstrate native browser zoom. Reduced CSS viewports were
tested separately: 1152x800 (1440x1000 / 1.25) and 960x667 (/ 1.5), each light/dark.
All four automated cases passed selected-name width/wrapping, form/line overflow,
select-arrow and modal-fit checks. DPR/visual scale/CSS zoom remained 1; these are
equivalent layout checks only, not zoom or font-rasterization acceptance. The
shared modal was opened directly as a presentation fixture and cancelled with
Escape; this probe did not execute the close endpoint or new PD3 workflow.

Manual inspection of the initial screenshots found a visual defect at 1152px:
the initial amount and discount label touch in the narrow summary row. This is
not detected by the automated container-overflow assertions. Selected product
names and modal content remain readable. Therefore the probe's machine result
`equivalent_layout_passed` applies only to its named assertions; **full visual
acceptance was not established** by that probe. The subsequently authorized PD2
correction below resolves this summary defect. Native 125%/150% verification remains
manual owner-device QA; no viewport or device-scale substitute is claimed.

### PD2 summary-spacing correction

Root cause: the two-column summary grid remained active inside a narrow desktop
card, while each label/value flex row could not wrap. At 1152px the summary was
290.3125px wide; row contents overflowed into the adjacent column even though the
outer summary itself reported no overflow.

Only `css/cashier-payments.css` changed application behavior in this correction:
summary columns now fit their actual available width, label/value rows can wrap
with explicit gaps, and amounts stay right-aligned. Existing colors, typography,
final-total divider, markup, calculation logic and ARIA semantics remain intact.

The dedicated `tests/browser/cashier-catalog-layout-browser-smoke.js` reuses the
existing synthetic loopback server and canonical single-tab auth scripts. It
failed before the fix at 1152px (`rowsFit=false`,
`neighboringTextsSeparated=false`), then passed **16/16 cases**: 1152x800, 960x667,
1440x1000 and 390x844, light/dark, ordinary/long amounts, always with a long selected
product name. Assertions measure row/text overflow, label/value and neighboring
text separation, name and form fit. Amounts are presentation fixtures, including
`1 234 567 899,99 грн`; no payment or provider call is made.

Evidence: `output/park-dar-summary-layout-before.log` and
`output/playwright/park-dar/summary-layout-before/` retain the failing reproduction.
`output/park-dar-summary-layout.log` and
`output/playwright/park-dar/summary-layout/` contain the passing report, 16 summary
screenshots and eight long-name form screenshots. Manual inspection confirmed the
corrected spacing and readable long amounts across all four widths and both themes.
Runtime check: Node 22.23.1; CSS surface and theme surface checks PASS
(`output/park-dar-summary-style.log`); browser-script syntax and `git diff --check`
PASS. The later PD3 full-suite/DB run includes this CSS correction, and the
dedicated layout browser smoke was rerun successfully at 16/16.

## Limits that remain explicit

- The dedicated two-tab payment test substitutes a synthetic auth module **in the
  test browser only**. Canonical auth on this base repeatedly navigated/refreshed
  with two fixture tabs. No auth code was changed; repeat combined auth/payment
  multi-tab acceptance on the coordinated R7B integration base.
- Same browser/user/route/register tabs share one active draft. Web Locks requires
  a supported secure browser context; unsupported contexts fail closed. Independent
  devices cannot be deduplicated by browser storage and still depend on the
  existing server idempotency and operational workflow.
- A submitted request retains its payload/key after uncertain network failure.
  Cart editing stays locked until recovery. Definitive 400/403/404/422 rejection
  before a known order clears the draft; unknown/timeout/conflict retains it.
- Existing unpaid orders are retained, not silently discarded. Next customer is
  available only for complete/cancelled or confirmed orders and a fresh queue.
- The physical Shared Test drain and both endpoints are locally implemented and
  tested. No production migration, runtime activation or real provider call occurred.
  Provider access expiry retains the stop; stop/resume never log in automatically.
- Owner-device browser zoom 125–150%, live multi-device/network-loss behavior and
  working register activation are not established by these local screenshots.
  The 1152px summary-spacing defect was resolved by the dedicated PD2 correction.
- Reload open cashier tabs after eventual release so old and new draft protocols
  are not mixed during operator acceptance.

## R7B collision and application rollback

At 18:36 UTC, read-only `git ls-remote` observed production `9ea61f1e...` and R7B
`d7aed2573d876c7051e96897a835343ed33573d5`; their merge base is `9ea61f1e...`.
R7B's overlapping `cashier-payments.html` hunks only change asset version markers.
Its `IMPLEMENTATION_STATUS.md` hunks update the two package baseline markers.
Keep R7B functional changes and its release markers; review all PD1–PD3 hunks,
including migration-number availability, then update tooling-owned doc markers
to the final coordinated package during an authorized release stage.
Do not deploy either old snapshot over a newer live base.

No merge/rebase/commit/push was performed. Final exact-SHA CI must be run after the
approved integration and commit, not inferred from local tests on this base.

Application rollback: use the documented release helper for the confirmed previous
live SHA, preserving all payment records. Reload cashier tabs and recover known
order IDs/queue; browser cache/storage must not be broadly cleared during uncertain
payments. Runtime rollback is separate: PD3 introduces durable local acceptance gates.
Application rollback must retain active stops; never drop
the drain table or re-enable acceptance as an automatic rollback step.
The rollback application must understand resumed history and active draining/closed
rows. Pre-drain code is incompatible with acceptance-enabled operation; if no
compatible rollback exists, stop for a separately authorized operational plan.

## One next review checkpoint

Review the complete local PD1–PD3 diff and repeat-day acceptance. The local PD3
implementation block is complete; it does not need reauthorization. The next
checkpoint is `PARK-DAR-REUSABLE-TEST-DAY-RELEASE-PREP` in
`REUSABLE_TEST_DAY_LOCAL_ACCEPTANCE_20260905.md`: fresh coordinated base, migration
352 conflict check, canonical-auth two-tab acceptance and a drain-aware rollback
candidate, followed by an explicitly authorized integration/commit stage.

The earlier UI-only alternative below is historical and excludes PD3. If selected
explicitly by the owner, prepare one named
`PARK-DAR-UI-FOLLOWUP-RELEASE` envelope after R7B coordination: approve scoped local
integration/commit, record the resulting exact 40-character SHA and current live
rollback SHA, then bind production-branch push, exact-SHA CI, the documented
Railway helper and read-only version/health/UI QA to that artifact. Fixed target:
`fortunate-appreciation / production / 8223324090`, source feature branch above,
destination `codex/eventgenix-production`, maximum one release attempt, six hours,
no migrations, runtime settings or fiscal/provider operations. A hash is not yet
available because commit is not authorized; this description is not an executable
release authorization and must not be filled with an old candidate SHA.

## Owner-browser script after separately approved delivery

1. Reload the cashier page; inspect PARK/DAR route labels and the persistent TEST
   warning. Check light/dark, narrow width and 125–150% browser zoom.
2. Before any test receipt, obtain a separate exact Shared Test operation envelope:
   one physical test register, both routes sequentially, exact configured owner and
   cashier, at most four catalog receipts (PARK cash/card, DAR cash/card), two owned
   test shifts and their exact closes; no production registers, refund/service/PRO.
   Item codes and amounts must come from the fresh approved catalog/configuration
   inventory before that envelope can be executable.
3. Verify empty cart, selected quantity/full name, approved DAR discount, disabled
   duplicate action, explicit completed state and clean next customer.
4. Check reload/two tabs on the integrated auth base and previous pending queue.
   Use mock/disposable runs for injected long delay/unknown/network failures until
   those exact live interruptions are separately approved.
5. After separately approved PD3 release and exact live operation authorization,
   confirm stop, register-wide recovery, CLOSED and explicit next-day resume.
   Stop/resume must not create provider receipts/shifts or change acceptance flags.

No live receipt/shift/login mutation in this script is authorized by this document.
