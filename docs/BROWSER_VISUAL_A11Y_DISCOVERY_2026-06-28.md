# Browser, Visual, And Accessibility Discovery

Date: 2026-06-28
Status: discovery report, no CI changes
Task: `SYSTEM_OPTIMIZATION_DETAILED_TASKS_2026-06-28.md` Task 03
Production impact: none

## Summary

The repository already has a useful split between static DOM checks and real
browser smoke checks:

- `npm run test:ui` is a broad jsdom/static contract suite and already runs in
  the fast CI baseline through `npm test`.
- `npm run test:browser:invite` is the safest first real-browser gate.
- `npm run test:browser:booking-summary` is the next safest browser gate.
- `npm run test:browser:event-cards` is also CI-ready, but it uses
  `@playwright/test` and creates Playwright output artifacts during failures, so
  it should be added after the two direct browser smoke scripts.
- `npm run test:browser:timeline` should not be added to the first browser CI
  gate. It needs a running authenticated app, live API, DB-backed data, and test
  credentials; it belongs with PostgreSQL-backed CI or a manual release proof.

Recommended first browser gate order:

1. `npm run test:browser:invite`
2. `npm run test:browser:booking-summary`
3. `npm run test:browser:event-cards`

Do not replace the existing fast baseline. Add browser checks as a separate
future job only after explicit CI-change approval.

## Runtime Note

The requested command shape:

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"
```

failed on this Windows workstation before the browser script ran. The failure
was an npm `EUSAGE` error from the nested `npx --package ...` inside the package
script. The same nested wrapper failed on a trivial nested `npx cowsay` command,
so this is a local wrapper false negative, not evidence that the browser tests
themselves are broken.

To verify the real browser scripts under the canonical runtime, I used the
Node 22/npm 10 bin that the wrapper had already installed into the local npm
cache and ran `npm run ...` directly with that bin first in `PATH`.

Verified runtime for the passing browser runs:

- Node: `v22.23.1`
- npm: `10.9.8`

Implication for future local docs: browser scripts that themselves call `npx`
should be run from an installed Node 22/npm 10 shell, not from an outer
`npx -p node@22 -p npm@10 -c ...` wrapper.

CI should not have this nested-wrapper issue because `.github/workflows/ci.yml`
uses `actions/setup-node`, installs `npm@10.9.8`, and then runs commands
directly.

## Current CI Baseline

Source: `.github/workflows/ci.yml`.

Current job:

- job id: `fast-baseline`
- runner: `ubuntu-latest`
- timeout: 15 minutes
- Node comes from `.node-version`
- npm is aligned with `npm install -g npm@10.9.8`
- dependencies install with `npm ci`
- verification command is `npm test`

Current CI already covers `npm run test:ui` through `npm test`, but it does not
run real browser smoke scripts.

## Browser And UI Script Inventory

| Script | Command | Server requirement | Credentials | Writes data | Primary value | CI suitability |
| --- | --- | --- | --- | --- | --- | --- |
| `test:ui` | `node tests/ui-check.js` | none | none | no | Broad static DOM/CSS/JS guardrails | Already in fast baseline |
| `test:browser:invite` | `npx --yes --package playwright node tests/browser/invite-browser-smoke.js` | self-started local static server | none | no | Public invite page, hero image, links, skip link, mobile overflow | First browser gate |
| `test:browser:booking-summary` | `npx --yes --package playwright node tests/browser/booking-summary-browser-smoke.js` | self-started local static server | none | no | Banquet summary page, mocked API, desktop/mobile layout, no horizontal overflow | First browser gate |
| `test:browser:event-cards` | `npx --yes --package @playwright/test playwright test tests/browser/event-cards-visual-smoke.spec.js --reporter=line` | self-started local static server | none | no | Event-card image rendering across programs, leads, afisha, timeline details | Add after first two |
| `test:browser:timeline` | `npx --yes --package playwright node tests/browser/timeline-browser-smoke.js` | running local app/API/DB | token or user/pass | yes, with cleanup | Authenticated timeline and banquet interaction smoke | Later DB-backed gate/manual proof |
| `audit:booking-summary-layout` | `npx --yes --package playwright node scripts/audit-booking-summary-layout.js` | self-started local static server | none | writes artifacts | Print/PDF layout metrics and screenshots for booking summary fixtures | Manual/release audit first |

## Execution Results

### Requested Wrapper Commands

| Command | Result | Duration | Notes |
| --- | --- | ---: | --- |
| `npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"` | failed | 17.7s | npm `EUSAGE` before the test ran; nested `npx --package playwright` issue. |
| `npx -y -p node@22 -p npm@10 -c "npm run test:browser:invite"` | failed | 3.4s | Same nested `npx` failure before the test ran. |
| `npx -y -p node@22 -p npm@10 -c "npm run test:ui"` | passed | 40.3s | `1078` passed, `0` failed. |

### Clean Node 22/npm 10 Browser Runs

| Command | Result | Duration | Key output |
| --- | --- | ---: | --- |
| `npm run test:browser:booking-summary` | passed | 4.6s | `Booking summary browser smoke passed` |
| `npm run test:browser:invite` | passed | 2.5s | `Invite browser smoke passed` |
| `npm run test:browser:event-cards` | passed | 16.4s | `4 passed` |
| `npm run test:browser:timeline` | failed safely | 1.5s | `provide URL argument or TIMELINE_BROWSER_SMOKE_URL/TEST_URL` |

The `timeline` failure is the expected safe failure mode when no local app URL
or test credentials are provided. The script exits before creating customers or
bookings.

## Script Findings

### `tests/ui-check.js`

Strengths:

- broad static guardrail coverage;
- checks many HTML pages and shared JS files;
- validates version text, sidebar/access contracts, timeline responsive
  contracts, modals, dark-mode contrast CSS, booking summary and invite static
  expectations;
- no live server, no DB, no credentials, no external network.

Risks:

- it is not a real browser check;
- jsdom cannot prove actual rendering, image decode, layout overflow, focus
  behavior, browser-specific viewport behavior, or real computed visual state.

Recommendation:

- keep it in `npm test`;
- do not treat it as a substitute for browser smoke.

### `tests/browser/invite-browser-smoke.js`

Strengths:

- starts its own static server on `127.0.0.1`;
- maps `/invite` to `invite.html`;
- requires no app server, DB, or credentials;
- checks company logo and event-card hero image asset loading;
- validates invite title, labels, location, map link, visit section, share/copy
  controls, and absence of old generic service-grid copy;
- validates skip-link hidden-by-default behavior;
- checks mobile no-horizontal-overflow at `390x844`;
- blocks Clarity and Google font network requests.

Risks:

- no general console-error/pageerror failure hook;
- no screenshot/nonblank assertion;
- only one mobile viewport and one desktop viewport;
- does not test keyboard navigation after skip-link focus.

CI decision:

- best first browser gate because it is public, fast, self-contained, and
  validates real image/layout behavior.

### `tests/browser/booking-summary-browser-smoke.js`

Strengths:

- starts its own static server on `127.0.0.1`;
- maps `/booking-summary` to `booking-summary.html`;
- requires no app server, DB, or credentials;
- injects local storage token only for page behavior;
- routes `/api/**` with deterministic mocked responses;
- validates booking-summary document content, controls, API PDF path behavior,
  desktop layout, mobile no-horizontal-overflow, and important client summary
  sections.

Risks:

- no screenshot/nonblank assertion;
- no general console-error/pageerror failure hook;
- mocked API coverage is useful for UI, but does not prove live backend
  contract;
- only one fixture-style smoke payload.

CI decision:

- add immediately after `invite` in the first browser gate.

### `tests/browser/event-cards-visual-smoke.spec.js`

Strengths:

- starts its own static server on `127.0.0.1`;
- requires no app server, DB, or credentials;
- checks `js/event-cards.js` load order before each consumer;
- validates actual event-card image rendering and image asset loading across:
  `programs.html`, `leads.html`, `afisha.html`, and `index.html`;
- verifies image path, expected filename, `object-fit: cover`, and `16 / 9`
  visual aspect ratio.

Risks:

- uses `@playwright/test`, which creates `test-results/` artifacts on some
  runs/failures;
- currently checks inserted event-card component behavior, not full page
  screenshot composition;
- does not fail on all page console errors by default.

CI decision:

- good third command in the first browser gate.
- CI should either ignore/upload Playwright artifacts or clean them after runs.

### `tests/browser/timeline-browser-smoke.js`

Strengths:

- has explicit local-only protection: refuses non-local bases unless
  `TIMELINE_BROWSER_SMOKE_ALLOW_PRODUCTION=true`;
- supports token auth or username/password auth;
- creates realistic customers/bookings and validates timeline room/animator
  behavior, banquet bridge flows, group reuse, reveal action, and cache view/date
  switches;
- has cleanup enabled by default.

Risks:

- requires a running app URL through CLI arg, `TIMELINE_BROWSER_SMOKE_URL`,
  `TEST_URL`, or `LIVE_SMOKE_URL`;
- requires `TIMELINE_BROWSER_SMOKE_TOKEN` or
  `TIMELINE_BROWSER_SMOKE_USER`/`TIMELINE_BROWSER_SMOKE_PASS` or live/test
  credentials;
- writes customer and booking rows before cleanup;
- depends on DB seed assumptions, lines, rooms, business context, and current
  auth/session behavior;
- much higher blast radius than public static browser checks.

CI decision:

- do not add to the first browser-only CI gate;
- add later only with the PostgreSQL-backed CI job and disposable credentials;
- keep production usage manual and explicitly approved.

### `scripts/audit-booking-summary-layout.js`

Strengths:

- uses real Chromium;
- loads compact, realistic, and long fixtures;
- collects layout metrics for A4 print behavior;
- can generate screenshots, PDF, and metrics JSON under `output/playwright/`.

Risks:

- writes artifacts by design;
- print/PDF metrics are more sensitive to Chromium/runtime changes than basic
  DOM smoke;
- better suited for release-proof or manual visual audits before becoming a
  strict CI gate.

CI decision:

- do not add to the first browser gate;
- consider a manual release checklist command first.

## First Browser Gate Proposal

Add a separate future CI job, after explicit confirmation, named for example
`browser-static-smoke`.

Initial commands:

```bash
npm run test:browser:invite
npm run test:browser:booking-summary
npm run test:browser:event-cards
```

Job properties:

- keep existing `fast-baseline` unchanged;
- run after `npm ci`;
- use the same Node/npm baseline as the fast job;
- no app server;
- no PostgreSQL;
- no secrets;
- no production URL;
- no deployment config changes.

Why this order:

1. `invite` is the smallest, fastest, public visual page smoke.
2. `booking-summary` covers a high-value operational document surface with
   mocked API behavior.
3. `event-cards` covers multiple consumer pages and image rendering, but brings
   the `@playwright/test` runner/artifact behavior.

## Later Browser Gates

Add after the first browser gate is stable:

```bash
npm run test:browser:timeline
```

Requirements:

- disposable local PostgreSQL database;
- running app at `http://127.0.0.1:3000`;
- CI-only creator test account;
- explicit `TEST_URL`, `TEST_USER`, and `TEST_PASS` or
  timeline-specific credentials;
- clear artifact/log capture on failure;
- cleanup verification.

Possible manual/release audit:

```bash
npm run audit:booking-summary-layout -- --fixture all
```

This should start as a manual release-proof step because it writes screenshots,
PDFs, and metrics under `output/playwright/`.

## Missing Tests To Add Later

No-dependency first additions:

- fail browser scripts on unexpected `pageerror`;
- collect and fail on severe `console.error` messages, with an allowlist for
  known intentional errors;
- add desktop and mobile viewport coverage consistently across public browser
  checks;
- add explicit keyboard/focus smoke for invite share/copy controls and
  booking-summary toolbar buttons;
- add nonblank image/screenshot pixel checks for invite hero and event-card
  surfaces;
- assert `document.documentElement.lang`, landmark presence, and visible focus
  states on public pages.

Possible dependency-based additions, only after approval:

- `axe-core` or `@axe-core/playwright` for basic automated accessibility smoke;
- screenshot diff tooling only for tightly scoped, stable surfaces.

## Risks And Constraints

- Browser scripts rely on on-demand `npx --package` installs; first run can be
  slower than subsequent runs.
- Nested `npx -p node@22 -p npm@10 -c "npm run ..."` can produce false
  negatives on Windows when package scripts also call `npx`.
- `@playwright/test` can leave `test-results/` artifacts; CI should account for
  this before turning it into a gate.
- Real timeline browser coverage needs DB/auth/app orchestration and should be
  handled together with PostgreSQL CI, not as a static browser job.
- Static browser tests prove rendered frontend contracts, not live backend
  behavior.

## Protected Implementation Task

Only after explicit confirmation, update `.github/workflows/ci.yml` to add a
new browser job.

Allowed first implementation shape:

- keep `fast-baseline` unchanged;
- reuse Node/npm setup from the existing CI job;
- run `npm ci`;
- run the three static browser commands in the recommended order.

Do not:

- change Railway/deploy config;
- add secrets;
- add production URLs;
- add PostgreSQL or authenticated timeline checks in the same browser-only job;
- add dependencies without explicit approval.

## Verification

Discovery commands run:

```bash
git status --short --branch
rg -n "test:browser|playwright|screenshot|viewport|console" package.json tests/browser scripts
npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:invite"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npm run test:browser:booking-summary
npm run test:browser:invite
npm run test:browser:event-cards
npm run test:browser:timeline
```

Result:

- `test:ui` passed: `1078` passed, `0` failed.
- clean Node 22/npm 10 `test:browser:booking-summary` passed.
- clean Node 22/npm 10 `test:browser:invite` passed.
- clean Node 22/npm 10 `test:browser:event-cards` passed: `4 passed`.
- clean Node 22/npm 10 `test:browser:timeline` failed safely before mutation
  because no URL was provided.
- generated `test-results/` artifact from the Playwright run was removed after
  confirming it was inside the repository workspace.

Run for this document:

```bash
git diff --check -- docs/BROWSER_VISUAL_A11Y_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```
