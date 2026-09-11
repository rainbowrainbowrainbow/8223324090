# Frontend code splitting measurement — 2026-09-11

Branch: `codex/audit-frontend-code-splitting`  
Base: `origin/codex/eventgenix-production` at `344305f4d18e63e1cbcaa16ba5cc328d95ae00c3`  
Runtime: Node.js 22 / npm 10

## Scope

Bounded frontend code splitting for dashboard, profile/My Day, and HR without changing UI, globals, inline handlers, permissions, timeline, or booking flows.

## Dependency map summary

Static HTML script/style inventory showed these initial raw linked assets before the change:

| Page | JS files | Raw linked JS | CSS files | Raw linked CSS | Inline handlers |
| --- | ---: | ---: | ---: | ---: | ---: |
| `dashboard.html` | 11 | 1,514,847 B | 11 | 666,126 B | 44 |
| `profile.html` | 21 | 1,882,617 B | 16 | 982,706 B | 0 |
| `hr.html` | 14 | 2,693,406 B | 13 | 1,265,904 B | 27 |

The lowest-risk split point was `hr.html` → `js/staff-page.js`:

- `js/staff-page.js` is 409,450 B.
- It exposes a single public global, `window.StaffSchedulePage`.
- HR code already accesses that global through `init`, `refresh`, `focusStaff`, `openDayPlan`, and `renderSchedule`.
- Standalone `staff.html` still loads `js/staff-page.js` directly.
- No `js/timeline.js`, booking detail source fields, permissions, schema, migrations, or dependencies changed.

Rejected higher-risk targets for this pass:

- Dashboard: already touched by recent hydration/dedup release and has many inline handlers.
- Profile/My Day: larger dependency surface with task widgets, time tracking, AI draft, achievement, and sound modules.
- CSS splitting: high selector overlap with dark/responsive/shared page shells; no safe single-file split was proven in this bounded pass.

## Implemented split

`hr.html` now loads `js/staff-schedule-loader.js` initially instead of loading `js/staff-page.js` immediately. The loader:

- preserves `window.StaffSchedulePage`;
- lazy-loads `js/staff-page.js?v=0.81.112` on first staff schedule API call;
- deduplicates concurrent loads with one in-flight promise;
- clears failed loads so the next user action can retry;
- keeps the standalone `staff.html` direct-load path unchanged.

## Before / after

Exact static initial HR linked JS:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `hr.html` raw linked JS | 2,693,406 B | 2,286,871 B | -406,535 B / -15.09% |
| Removed initial file | `js/staff-page.js` 409,450 B | — | — |
| Added initial loader | — | `js/staff-schedule-loader.js` 2,915 B | — |

Local Playwright/CDP-style measurement with a disposable static/mock API server:

| Page/pass | Before script bytes | After script bytes | Delta |
| --- | ---: | ---: | ---: |
| `hr.html` cold | 4,867,752 B | 4,490,580 B | -377,172 B / -7.75% |
| `dashboard.html` cold | unchanged target | 1,631,247 B | not touched |
| `profile.html` cold | unchanged target | 4,118,448 B | not touched |

Notes:

- Browser-level script bytes include dynamic/runtime requests from the page, so the measured browser delta is smaller than the exact HTML initial-closure delta.
- The local mock server returns successful empty API payloads and does not access production data.
- WebSocket noise from the mock server was excluded as environment-only where it appeared.
- Duplicate API calls observed in the measurement are existing behavior and were not changed by this code-splitting task.

## Regression coverage

Added `tests/frontend-code-splitting.test.js` to verify:

- HR uses `js/staff-schedule-loader.js` instead of direct `js/staff-page.js`;
- standalone `staff.html` still loads `js/staff-page.js`;
- concurrent calls share one script injection;
- failed lazy load clears the in-flight promise and allows retry.

Updated `tests/ui-check.js` static checks so the HR schedule surface explicitly expects the lazy loader and rejects the direct HR `staff-page.js` script tag.

## Risks and follow-up

- The change intentionally leaves dashboard and profile/My Day untouched because a safe 15–20% single split was not proven for those pages in this pass.
- CSS still has a large low-usage signal, but safe splitting needs a separate selector-level pass because dark/responsive/page-shell styles are heavily shared.
- Full live QA is not part of this task because deployment is explicitly out of scope.
