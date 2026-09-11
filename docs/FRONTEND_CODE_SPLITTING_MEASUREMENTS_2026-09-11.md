# Frontend code splitting measurement — 2026-09-11

Branch: `codex/audit-frontend-code-splitting-rebased`

Base: `origin/codex/eventgenix-production` at `ed82d7cdebff55551d3ca5487e7b59bf36900698`

Runtime: Node.js 22.23.1 / npm 10.9.8

## Scope

Bounded frontend code splitting for dashboard, profile/My Day, and HR without changing UI, globals, inline handlers, permissions, timeline, or booking flows.

The lowest-risk split point remains `hr.html` → `js/staff-page.js`:

- `js/staff-page.js` is 409,450 B and exposes one public global, `window.StaffSchedulePage`;
- `hr.html` only needs it after the HR schedule tab is activated;
- standalone `staff.html` still loads the module directly;
- dashboard and profile/My Day were retained because their dependency surfaces are broader and no equally bounded split was proven;
- CSS was retained because shared dark, responsive, and shell selectors make a one-file split higher risk.

## Implementation

`hr.html` initially loads `js/staff-schedule-loader.js`. The loader:

- preserves `window.StaffSchedulePage` and its existing methods;
- injects `js/staff-page.js` on the first schedule call;
- deduplicates concurrent calls through one in-flight promise;
- clears a failed promise so the next user action can retry;
- propagates the current loader `?v=` cache key instead of hard-coding a release marker;
- leaves the standalone `staff.html` path unchanged.

## Current-production before / after

Exact static linked JavaScript in `hr.html`:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Initial linked JS files | 14 | 14 | 0 |
| Initial raw linked JS | 2,694,896 B | 2,288,654 B | -406,242 B / -15.07% |
| Staff schedule module | 409,450 B | deferred | -409,450 B |
| Lazy loader | — | 3,208 B | +3,208 B |

Fresh Playwright/Chromium measurement used the same current-production files and a disposable localhost static/API stub. It did not access production data.

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Initial local JS transfer bytes | 2,737,772 B | 2,331,530 B | -406,242 B / -14.84% |
| Initial local JS decoded bytes | 2,781,933 B | 2,375,691 B | -406,242 B / -14.60% |
| Initial local JS requests | 18 | 18 | 0 |
| Initial `staff-page.js` requests | 1 | 0 | -1 |
| Initial API requests | 16 | 16 | 0 |
| Recorded long tasks | 0 | 0 | 0 |

After activating the schedule tab, the candidate made exactly one `staff-page.js` request, retained exactly one loader request, rendered the schedule region, and changed the URL to `/hr#schedule` without a page reload.

Browser console errors in this measurement came from deliberately generic empty API fixtures. They were identical between before/after runs and did not include script-load, missing-global, or uncaught loader failures.

## Regression coverage

`tests/frontend-code-splitting.test.js` verifies:

- HR uses the lazy loader while standalone Staff keeps its direct module load;
- the current release cache key is propagated to the deferred script;
- concurrent calls create one script request;
- failed loading clears the in-flight promise and allows retry.

`tests/ui-check.js` also requires the loader on HR and rejects a direct HR `staff-page.js` tag.

## Decision and remaining risk

The exact static closure reduction is above the task's 15% evidence gate, and the browser transfer reduction is within rounding distance at 14.84%. The change is therefore retained as the single bounded split for this pass.

No dashboard, profile/My Day, or CSS speculative split is included. A live authenticated HR smoke is still required only if this branch is later selected for release; merge and deployment are outside this task.
