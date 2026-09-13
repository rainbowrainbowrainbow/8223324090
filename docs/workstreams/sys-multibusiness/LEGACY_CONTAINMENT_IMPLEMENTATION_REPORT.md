# D02-C1/C2 — Private legacy-surface containment

Date: 2026-09-12. **READY_LOCAL_PRIVATE_CONTAINMENT_REVIEW**. Global cutover remains **HOLD_REMAINING_DOMAIN_GAPS**.

Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`.
Base/HEAD: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
The unchanged `0.81.132` package marker is local, not a claim about the live site's version.

## Decision and actual scope

The user's continuation accepted the recommended restriction in [LEGACY_CONTAINMENT_PLAN.md](LEGACY_CONTAINMENT_PLAN.md). Global legacy records lack durable business ownership; assigning them from creator names, products or the first recurring occurrence would invent ownership. C1 restricts their private APIs; C2 explains the interruption and clears stale browser state. Existing-record migration remains separate.

Only a fresh, valid, single `event_genix` request in **pre-cutover compatibility** mode retains old behavior and existing role/action checks. Park/Dar/custom memberships, including organization owners and platform creators, receive unavailable results. Switching to authorized CRM/Майстерня/Dar compatibility does not reopen the global namespace. Aggregate and invalid/revoked contexts fail before domain work. The database enum is `compatibility`; an initial `legacy` spelling error was reproduced on actual PostgreSQL and corrected.

Direct private routes return existing auth/scope errors or `catalogs_not_migrated`, `booking_templates_not_migrated`, `recurring_not_migrated`, `finance_salary_not_migrated`. Mixed Products/Dashboard/Omni responses retain supported data and add `legacyCatalogs: { available, code, message }`. Blocked data is distinguishable from an ordinary empty catalog.

## Changed areas in this increment

| Files | Behavior change |
|---|---|
| `services/legacyBusinessSurface.js` | Shared request policy. Internal callers supply an explicit trusted Park context and read the registry afresh; missing/failed authority never manufactures access. |
| `routes/catalogs.js`, `routes/booking-templates.js`, `routes/recurring.js` | Whole-router gate before methods, nested IDs, implicit HEAD, settings initialization, usage mutation, generation, pool connections or provider helpers. |
| `routes/finance.js` | Gate only `/report/salary`; payroll calculations and other HR/payroll endpoints remain unchanged. |
| `routes/products.js`, `routes/dashboard.js` | Omit legacy catalog SQL; preserve scoped graduation and non-catalog mixed data. |
| `services/omniLeadAssistant.js`, `routes/omnichannel.js` | Trusted request context for material sources, script tests and analysis; omit global catalog items before SQL/provider input. No missing-context Park fallback in this loader. |
| `js/api.js` | Fresh-profile hint, context key and same-context denial propagation. Existing array callers remain compatible; optional metadata distinguishes unavailable sources. |
| `js/booking-form.js`, recurring additions in `js/booking.js` | Disable unavailable controls, clear templates, reject stale requests and revalidate before application. Canonical booking mappings/renderers remain unchanged. |
| `js/programs-page.js`, `js/catalogs.js`, `js/designs-page.js`, `designs.html` | Unavailable states, cleared global sources and late-response protection; preserve graduation. Containment 403 does not log the user out. |
| `js/finance-page.js`, `js/dashboard-page.js`, `omni.html` | Clear source-specific caches/DOM after context/access changes and reject late responses. Salary report authorization precedes schemes loading. |
| `package.json`, new tests, `tests/revenue-access-surface-contract.test.js`, `tests/warehouse-product-isolation.test.js` | New verification stage, real compatible Park fixture for the existing public-price assertion, and zero legacy SQL expectation for membership graduation fallback; no dependency or version change. |

Prior SYS-MB increments also remain uncommitted in this worktree. Earlier HR/auth/domain edits are not new changes here. The previous 87 source hashes were checked before starting; 82 remain unchanged. The five changed prior sources are `js/api.js`, `package.json`, `routes/finance.js`, `routes/products.js` and `tests/warehouse-product-isolation.test.js`. Another 24 newly touched source/test files complete this 29-file increment; the cumulative manifest covers 111 sources. The main checkout and other workstreams were not edited.

## Verification

Final commands, counts, exact source hashes and artifacts are recorded in [LEGACY_CONTAINMENT_VERIFICATION.json](LEGACY_CONTAINMENT_VERIFICATION.json). Raw logs are in ignored `.codex-temp/sys-mb-legacy-containment/`.

| Check | Result |
|---|---|
| Full `npm test` on final source | **PASS**, exit 0. Core unit 2912, new containment stage 67, My Day 337, static UI and four frontend code-splitting checks passed; runtime/version/access/migration/surface guards passed. Repository parser checked 1188 JavaScript files. These are stage counts, not a deduplicated total. |
| `npm run test:unit:legacy-containment` on final source | **67 PASS**, no failures/skips: policy 8, alternate sources 19, templates/catalog UI 14, salary/dashboard UI 18, Omni UI 8. |
| Actual HTTP/auth/PostgreSQL core routes | **11 PASS**, 571 HTTP requests, zero denied-domain/helper/provider calls; the owned disposable database was dropped and absence asserted. |
| New frontend suite plus existing graduation catalog regressions | **20 PASS**. |
| Synthetic Chromium browser | **6 PASS**, light/dark × 390/768/1440, 12 safe screenshots. |
| Final changed-source parser | **PASS**, 17 JavaScript files plus 12 inline scripts in two HTML pages. |
| Protected booking/timeline manifest | **PASS**, six protected blocks unchanged, four forbidden patterns checked, two regression files. |
| `git diff --check` | **PASS**. |

Visually inspected synthetic evidence: [Products at 390px](../../../output/playwright/sys-mb-legacy-containment/catalogs-light-390.png) and [template denial in dark mode](../../../output/playwright/sys-mb-legacy-containment/templates-dark-390.png). The template page is an isolated consumer shell, not the complete booking screen. Other consumers receive JSDOM/HTTP tests; this increment does not claim a full manual UI tour of every changed page.

Repeat the self-contained increment with `npm run test:unit:legacy-containment`. The PostgreSQL command is `wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/legacy-business-containment-postgres.test.js'`. Exact successful browser CLI/runtime/config paths are retained in the verification manifest and `.codex-temp/sys-mb-legacy-containment/frontend-browser-reproduction.md`; the run reused installed Chromium 1243 without installing dependencies.

- Actual HTTP, fresh DB authentication and disposable PostgreSQL cover 66 route/method cases across eight context variants, aliases, aggregate/HEAD/unknown IDs, owners/creators, same-JWT cutover, deactivation and role changes. Denied domain SQL/helpers/providers are trapped. The positive salary helper is synthetic and does not test payroll formulas.
- Alternate-source tests exercise Products/Dashboard/Omni responses and SQL/provider spies, including registered compatibility Park and preserved scoped graduation/products.
- Frontend checks run real page code with synthetic transports/profile state. Browser fixtures are separate from live QA.
- An initial baseline failure exposed an outdated dashboard revenue fixture. Its public-price assertion and denied revenue permission remain intact after adding real server authority.
- A later baseline failure exposed the old graduation fallback expectation of two SQL queries. Membership Park now correctly runs only its scoped package count and no global catalog query; both zero and nonzero package counts remain asserted.
- Independent review also covers cross-view denial propagation, late image responses, initial profile hydration and rejected template `/use` before field application.
- Appending five new files exceeded Windows' command-line limit. The explicit `test:unit:legacy-containment` stage is included in `verify`, keeping every test in `npm test` without changing the shared runner or CI configuration.

## Review/demo procedure

Use disposable fixtures, or an authorized live test account after a separate release and exact `/api/version` check. Do not generate catalogs/recurring bookings, save schemes, calculate/pay salary, publish, export or message real records.

1. In Park/Dar/custom membership, open Products: normal products and applicable graduation entry remain; legacy catalogs explain unavailability.
2. Open the generic Designs catalog. Its unavailable state preserves the login session. Direct legacy APIs deny access even for an owner/creator.
3. In a pre-cutover Park fixture, load a template and switch/revoke access while a response is pending. The cache clears; neither a late list nor a rejected `/use` populates the form. Recurring submission is disabled in unsupported contexts.
4. Open salary, catalog widgets and Omni materials. Change business/access while data is pending. Old staff/catalog material disappears and cannot be restored by that response; supported mixed sources remain.
5. Repeat key unavailable states at 390/768/1440 and light/dark; check keyboard access to the remaining graduation action. Synthetic screenshots are not production evidence.

## Remaining work

- **D02-C3 BLOCKED_ON_CLASSIFICATION:** public catalog links/assets and actorless maintenance. Private gates cannot retract bearer URLs, external copies or scheduled image refresh. The recurring scheduler export is dormant in this checkout; its operator/service path remains unowned. No public/background policy changed.
- **D02-C4 BLOCKED_ON_OWNERSHIP:** historical record-to-business mapping and shared-library policy, then a separate idempotent migration. No schema/backfill/automatic owner assignment was added.
- **D-03 READY_LOCAL_ANALYSIS:** continue registry/modules/branding/full-business setup independently of historical owners.
- HR/payroll roster ownership, income notification routing, general chat and D-04/D-05 integration gaps remain in [DOMAIN_ISOLATION_INVENTORY.md](DOMAIN_ISOLATION_INVENTORY.md). This is not complete multi-business isolation certification.
- Commit/push/exact-candidate CI/deploy/live QA were not run. Cumulative auth-sensitive release needs a fresh production base and active authorization envelope. No production data, credentials, secrets, hosting settings, dependencies, formulas or shared menu/router/theme were changed here.
