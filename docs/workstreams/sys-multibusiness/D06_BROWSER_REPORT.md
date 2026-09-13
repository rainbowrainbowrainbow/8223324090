# D06 — Actual local application browser acceptance

Date: 2026-09-12. Branch: `codex/sys-mb-auth-p0-20260912`.
Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Starting checkpoint: `D05_IMPLEMENTATION_REPORT.md` + `D05_VERIFICATION.json`.
Status: **LOCAL_ACCEPTANCE_COMPLETED_WITH_OPEN_ISSUES**. Final actual-app run
`d06_1789241525527_7d4a50`: **14 functional PASS / diagnostics B09 FAIL**.
The product-context regression is fixed and verified against real HTTP/PostgreSQL.
Five unclassified HTTP failures and an earlier intermittent editor-launch issue
remain open. This is not a live-site or domain-completion certificate. Failed
attempts remain evidence; no further run was used to replace the final result.

## Scope and source boundaries

New reusable runner: `tests/acceptance/sys-mb-browser-scenarios.cjs`, export
`runBrowserAcceptance({baseUrl, fixture, outputDir, playwrightModule,
executablePath, record})`. Runtime correction is limited to `js/programs-page.js`
after the actual-app B12 reproducer below. Its prior cumulative bytes were saved
before editing; shared auth, menu, router, theme and API contracts are unchanged.
The parent task owns the full `server.js`/disposable PostgreSQL orchestrator,
Windows stdin worker, domain API matrix, readiness collection and final manifest.

All pages/assets, login, permissions, lifecycle operations and domain responses
come from the actual local application. There are no mocked API responses,
injected JWT principals, extracted UI functions or synthetic HTML shells. The
late-response scenario fetches the real management response and delays only its
delivery; it does not fabricate or alter its body/status.

The runner accepts only loopback HTTP, blocks external browser network, and
disables service workers to require current HTTP responses. This does not certify
offline/cache behavior, production provider delivery or live-site QA. The parent
harness separately holds background startup work and outbound transports; see its
acceptance report for the exact environment limitations.

Synthetic credentials/tokens arrive in process memory through the Windows worker's
stdin pipe, never a fixture file or command argument. Browser login uses the real
username/password form and native keyboard submit. Reports retain no auth headers,
cookies, tokens, passwords or request bodies. Screenshots contain only fixture
records. The parent harness drops its exact disposable database during cleanup.

## Executable scenarios

Final-run statuses: B01, B02, B03, B04, B05, B06, B07 at each of three widths,
B08, B10, B11, B12 and B13 **PASS**; B09 **FAIL**. B02 PASS applies to this
interaction only and does not close D06-UI-02 from an earlier run.

| ID | Actual interaction / assertion |
| --- | --- |
| D06-B01 | Non-platform owner creates a custom business with explicitly empty modules, changes branding, checks unsupported modules are disabled, and explicitly initializes Park resources twice with zero additions on replay. |
| D06-B02 | Owner uses the canonical membership editor to give an existing synthetic account different Park/Dar roles and an explicit Dar default; actual access-profile response verifies persistence and opener focus is restored. |
| D06-B03 | Organization admin sees member management without owner cabinet controls; ordinary worker has neither lifecycle launcher. |
| D06-B04 | Two real tabs share a worker session; the sidebar switch changes Park/director to Dar/animator in both tabs; refresh/back/forward retain the correct business and role. |
| D06-B05 | A two-organization account passes the explicit business-selection gate with keyboard and receives the second organization's custom business/manager role. |
| D06-B12 | Actual product cards contain only the selected Park/Dar fixture marker before/after switching and reload. |
| D06-B13 | An existing multi-organization session reads the second organization's custom product, registry label and exact API context through reload/back/forward. |
| D06-B06 | A real management GET held in transit cannot repaint stale directory data after a real sidebar switch. |
| D06-B10 | An owner UI role change and membership deactivation affect the worker's same original browser JWT; real HTTP and refreshed UI are checked separately. |
| D06-B07-layout-390/768/1440 | Actual cabinet and membership forms in both canonical themes; focus, keyboard, document overflow, viewport bounds and covered controls. At 390px, native End-key activation must bring the rightmost History tab into the visible horizontal rail. |
| D06-B08 | Owner deactivates only the business created by the runner; actual management read confirms inactive status. |
| D06-B11 | Sole-owner demotion through the editor returns 409 and retains the owner. |
| D06-B09 | Page exceptions, console errors, HTTP failures and blocked external resources are retained. The final runner accepts only exact expected actor/context/method/path denials and explicitly fenced fonts/analytics; unclassified failures cannot produce PASS. |

All explicit mutations stay within the synthetic fixture: the newly created
custom business, explicit resource initialization, the existing `unassigned`
account's memberships, and a rejected sole-owner demotion. The runner does not
submit booking, client, finance, HR, message, provider or Art writes. Existing
login/profile bootstrap can invoke account-local gamification handlers; these
actual requests and their failures are retained in diagnostics rather than
silently mocked away.

## Runtime and results

Installed runtime verified before execution:

- Playwright `1.63.0` at
  `C:/Users/Plotva/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright`.
- Existing Chromium revision `1243` executable at
  `C:/Users/Plotva/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe`.
- `node --check tests/acceptance/sys-mb-browser-scenarios.cjs`: PASS.

Executed attempts before browser behavior could be certified:

| Run | Evidence and classification |
| --- | --- |
| `d06_1789237617237_b811eb` | Actual startup applied 353 migrations and bootstrap succeeded. Domain fixture preparation failed on nonexistent `leads.customer_id`; browser did not execute. Harness/schema drift, not a UI defect. |
| `d06_1789237804071_f534c5` | Browser process launched, but Windows `127.0.0.1` could not reach the WSL app (`ERR_CONNECTION_REFUSED`). No actual-app API responses reached the browser. Its four initial transport FAIL entries do not demonstrate UI regressions. The original B09 PASS was invalid empty-evidence classification, explicitly superseded by the new zero-response `NOT_TESTABLE` guard. |
| `d06_1789238394299_b3209e` | The TCP bridge reached the app and B01 performed actual UI work, but an unhandled pending `waitForResponse` timeout terminated the worker before a result. No browser PASS is credited. Response/action promises are now awaited together, partial evidence is persisted per scenario, and replay reopens the directory through the existing UI after profile invalidation. No runtime patch was justified by this harness failure. |
| `d06_1789238649086_b05104` | Twelve functional scenarios PASS, B12 FAIL, B09 NOT_TESTABLE before diagnostics review. B12's old selector assumed every renderer used `.program-card`, and its failure screenshot incorrectly selected another session. Those are harness defects, superseded by the next exact owner-page reproducer. Raw diagnostics: 500 API responses, 0 HTTP5xx, 0 page errors, 108 console errors = 92 intentional external blocks + 16 expected HTTP denials. |
| `d06_1789239219113_74dc2d` | Exact real-app red B12: Dar active profile/permissions, but products requested `event_genix` and visible Park synthetic records were rendered with Maysternya branding. Twelve other functional scenarios PASS. The parent verified cleanup/source stability before any runtime edit. |
| `d06_1789239792043_64ed0c` | Fourteen PASS / one FAIL. Actual Dar and custom-business product targeting/history/branding passed. Diagnostics PASS with 578 API responses, 0 HTTP5xx/page errors, 22 exact expected HTTP denials and 105 intentional external blocks (127 browser console errors retained). The new immediate 390px History-rail geometry assertion failed after successful keyboard focus/activation. Visual review also found the MD-only CTA still visible despite `hidden`, prompting the final minimal correction described below. |
| `d06_1789240335521_4b0509` | Fourteen PASS / one FAIL. Dar/custom targeting, branding, actual CTA invisibility, all six width/theme combinations and keyboard History visibility passed. B06 completed every existing assertion, then its full-page screenshot timed out at 15 seconds; raw FAIL remains an evidence-capture failure. Diagnostics: 567 API responses, 0 HTTP5xx/page errors, 22 exact expected denials + 111 external blocks = 133 console errors, no unclassified failures. The next run strengthens B06 to await actual request completion and two UI frames before asserting stale data absence; screenshot-only timeout becomes 30 seconds for the large page capture. |
| `d06_1789240691369_eeb5a9` | Thirteen PASS / one FAIL / one NOT_TESTABLE. Strengthened B06 passed with actual delivered 200/requestfinished/two UI frames/stale count zero. B02's first editor launch timed out without any access-profile HTTP request; dependent B10 did not execute. Diagnostics PASS: 509 API responses, 0 HTTP5xx/page errors, 19 expected denials + 94 fenced resources, 113 console errors. B02 remains the open intermittent issue below. |
| `d06_1789241141249_542fd3` | Thirteen PASS / two FAIL. B02 succeeded with recorded ready identity, canonical runtime/shell readiness, a trusted click on the actual add button and HTTP200. Its previous failure is not declared fixed. B10 was superseded by a pending post-login redirect before the Profile page loaded; no B10 role writes ran. B09 retained one unclassified assigned-worker chat403, 581 API responses, 0 HTTP5xx/page errors, 118 console errors and 101 external blocks. The final test-only changes wait for actual login completion and read only the exact chat denial code. |
| `d06_1789241525527_7d4a50` | Final source-bound run: fourteen functional PASS / B09 FAIL. All lifecycle, same-JWT revocation, late-response delivery, keyboard/viewport and Dar/custom product assertions completed. Diagnostics: 627 actual API responses, 0 HTTP5xx, 0 page errors, 26 HTTP4xx (21 exact expected denials, five unclassified), 110 fenced external requests and 136 console errors (five unclassified). Four daily-login400 responses lack captured bodies; one contextless multiOrg chat403 has the observed code `business_context_required`. The classifier remains unchanged and the raw FAIL is retained. |

All attempts remain in `.codex-temp/sys-mb-d06/runs/<runId>/` and
`output/playwright/sys-mb-d06/<runId>/`. The test-only loopback TCP bridge forwards
actual application traffic without changing HTTP responses. Failed/empty attempts
are not counted as application PASS.

## D06-UI-01 — Wrong product business targeting and branding

Severity: **P1**. Status: **FIXED_LOCAL / ACTUAL_HTTP_PG_BROWSER_PASS**.

- URL: `/programs?businessContext=dar#maysternya` in the red run's loopback app.
- Steps: real login as synthetic owner with Park and Dar memberships; open Products
  in Park; select Dar using the actual sidebar; inspect visible cards/request.
- Expected: active Dar requests `/api/products?active=true&businessContext=dar`,
  renders Dar records and registry label, and preserves Dar after refresh.
- Actual: profile and permissions both returned 200 for Dar, body context was Dar,
  but `ProductBusinessContext.getApiContext()` returned `event_genix`; the products
  GET returned 200 for Park. Visible cards contained the exact Park fixture marker.
  Title was `Products · Майстерня долі`, subtitle mentioned Park, and the add label,
  panel introduction/hash and timeline CTA described Maysternya.
- Evidence: `output/playwright/sys-mb-d06/d06_1789239219113_74dc2d/`
  `products-context-diagnostics.json`, `products-after-dar-switch.png`,
  `D06-B12-products-context-failure.png`. This corrected owner-page evidence
  supersedes the previous run's wrong-session failure screenshot.
- Cause/candidate: `js/programs-page.js`, `getProductApiBusinessContext`,
  `getActiveBusinessContext`, `getBusinessHash`, `updateProductTabPanels`,
  `renderMaysternyaProducts`. The legacy two-context lookup mapped every other
  key to Park for API requests and reused Maysternya presentation for non-Park.
- Security interpretation: this actor legitimately belongs to both businesses.
  The evidence proves wrong selected-business targeting, not a server bypass of
  a denied foreign organization. The shared context getter is also consumed by
  existing product write callers, so an incorrect target is operationally risky;
  no product write was submitted through the browser reproducer.
- Minimal change: preserve the normalized actual API key; read branding through
  existing `CrmBusinessContext.profileFor`; give custom/Dar contexts neutral
  product vocabulary; reserve the MD hash and MD-specific action for actual MD.
  Existing DOM classes/card renderer and known legacy navigation remain intact.
  No formulas, API write contract, provider, schema or shared UI changes.

The first post-fix screenshots confirmed correct Dar/custom records and branding,
but exposed a remaining CTA display issue: the authored `.business-variant-actions`
flex rule left the MD timeline link visible despite its `hidden` attribute. The
final page-local correction sets display explicitly for that MD-only action, and
B12/B13 now assert actual Chromium invisibility. JSDOM's computed display did not
reproduce the browser cascade difference; it is not used as visual proof.

Final B12 proves Park-to-Dar targeting and Dar reload; B13 proves the second
organization's `d06_other` key, own product marker, registry label and history.
Both assert actual MD-action invisibility. The final screenshots
`products-dar-only.png` and `products-custom-history.png` were manually reviewed.

Prior source: `.codex-temp/sys-mb-d06/prior-sources/js/programs-page.js`.
SHA256 `5947fff0e1b44cc65b9c123d2e39c6b70058f34856db5e1b880c894779c37c88`,
exactly matching `D05_VERIFICATION.json`.

## D06-UI-02 — Intermittent membership editor launch

Severity: **P2**. Status: **OPEN_UNCONFIRMED_ROOT_CAUSE**.

- URL: `/profile?tab=settings&businessContext=event_genix` in the disposable app.
- Steps: complete owner cabinet lifecycle; reload Profile settings; enter the
  synthetic unassigned account ID and click “Призначити доступ акаунту”.
- Expected: an actual access-profile request completes and opens the canonical
  membership editor.
- Actual in `d06_1789240691369_eeb5a9`: the account ID remained filled, but no
  editor appeared within 15 seconds, no loading/error status was shown, and no
  `/api/organizations/members/:id/access-profile` request was recorded. All
  recorded auth/profile requests were 200. B10 was correctly NOT_TESTABLE there.
- Evidence: that run's `D06-B02-membership-editor-failure.png`,
  `browser-results.json` and `browser-diagnostics.json`.
- Candidate areas: `js/business-membership-manager.js` add/open/currentIdentity
  path and `js/profile-page.js` initial render/mount/shell lifecycle. The evidence
  does not establish which branch or event caused the missing request.
- Bounded follow-up: `d06_1789241141249_542fd3/membership-open-1-diagnostics.json`
  recorded owner ID5, ready access/permissions/runtime/shell, mounted enabled
  button, trusted pointerdown/up/click on that button, and HTTP200. This is a
  successful later interaction, not proof that the intermittent failure is fixed.
- No runtime patch or blind retry was made. The reusable runner now records
  pre/post readiness, intended hit target, actual pointer/click targets and exact
  request metadata. The next bounded repair should use a failing capture to
  identify the event/lifecycle cause before changing the component.

## Harness correction — Post-login navigation completion

B10 in `d06_1789241141249_542fd3` failed before its role-change steps: the screenshot
shows the Dar timeline, while the test was waiting for Profile; network contains
timeline/lines/settings requests and no `/api/auth/profile`. The previous
`newSession` helper accepted either stored or in-memory user ID immediately after
login. In `js/auth.js`, `login` stores `AppState.currentUser` before awaiting profile,
permissions and service-worker bootstrap, then applies the account start-page
redirect. `js/app.js` keeps the real login form `aria-busy` until that function
completes. The test could navigate to Profile while that login navigation was
still pending.

The corrected helper waits for actual account ID, the real form no longer busy,
and canonical runtime/shell/permissions ready on the destination page, or the
actual visible business-selection gate for selection-required accounts. It writes
`login-<actor>-completion.json`. No login function, redirect, profile or auth source
is changed. Separately, chat403 classification now requires the exact observed
`chat_not_migrated` code, GET path and known membership actor; no blanket403
allowance was added. The previous unclassified raw FAIL is preserved.

Final `login-assigned-worker-completion.json` records the actual destination
`/?businessContext=dar`, fixture user ID10, ready Dar access/runtime/shell and
`loginBusy:false` before navigation. B10 then passed with `sameOriginalJwt:true`,
role `animator` after the owner UI save, and HTTP403 after membership deactivation.
This closes the evidenced test navigation race, not the separate intermittent
B02 issue.

## Final B09 failures — retained without classifier relaxation

Evidence: final `browser-diagnostics.json` and B09 in `browser-results.json`.
The 136 console errors consist of 110 deliberately blocked fonts/analytics,
21 classified expected HTTP denials and five unclassified HTTP failures. There
were no page exceptions, HTTP5xx or unclassified external destinations. Error
phase identifies when a background response was observed, not necessarily its
initiating UI action. No request initiator stacks or wallet response bodies were
captured, so the candidate analysis below does not assert an unobserved cause.

| ID / severity / status | URL and actual reproducer | Expected / actual / source candidate |
| --- | --- | --- |
| D06-NET-01 / P2 / OPEN_UNCONFIRMED_ROOT_CAUSE | `POST /api/wallet/daily-login`; real login and Profile usage in the disposable fixture. Four observed400 responses: owner in B01; admin and worker in B03; worker-cross-tab in B04. | Expected account bootstrap and automatic daily-login handling without unexplained errors. Actual400 with body not captured; `js/auth.js:4595` sends the automatic POST and silently returns on `!ok`. `routes/wallet.js:87` returns400 for a missing wallet; its GET `/` initializes the wallet at lines36–58. This supports an initialization/order candidate, but the run did not record the missing row or exact body. Duplicate claims at lines96–111 return200 `alreadyClaimed`, so duplicate-claim400 is **not** the source contract. |
| D06-NET-02 / P2 / OPEN_CALLER_CONTEXT_GAP | `GET /api/chat/unread` without business context; multiOrg session remains open after selecting the second organization while B12 operates in another session. Actual403 body code `business_context_required` was captured. | Expected background chat reads to honor the selected context and the legacy availability policy, or skip an unavailable surface. Actual request omitted context. `js/ws.js:355,804–812` refreshes the badge after the connected message and uses a contextless fetch; this is a concrete matching caller candidate, not a captured initiator stack. `services/businessMembership.js:74–76` deliberately requires an explicit context for multiple organizations. The response is safe fail-closed behavior, not cross-business disclosure. `routes/chat.js:30–32` also retains its legacy-surface guard; do not weaken either guard to eliminate the console error. |

Next bounded checks: for NET-01, retain only the local response error code/message
and explicit wallet-existence/transaction timing in a fresh synthetic login
reproducer before deciding which initialization path needs repair. For NET-02,
capture the request initiator and add a focused context/revocation/selection-gate
test around the existing unread caller before a minimal caller fix; a passed
business key alone must not enable chat where the legacy guard blocks it. No
wallet, shared-auth, shared-WS, policy or provider runtime change was made for
these findings, and the diagnostics collector was not expanded merely to pass.

Final B06 proof is in its `browser-results.json` entry: actual PostgreSQL-backed
management response, unchanged delayed delivery, delivered200, exact request
finished, two native UI frames, active Dar and `staleDirectoryCount:0`. No mocked
response or pre-delivery-only assertion is counted as PASS.

## Focused verification and known fixture debt

Commands use installed Node 22.23.1; `--experimental-test-isolation=none` avoids
the Windows restricted process-spawn limitation for focused local runs. The first
EPERM attempt is retained as `products-context-red-environment.log` and does not
count as a product test result. The parent runs the normal baseline separately.

| Check | Result | Artifact under `.codex-temp/sys-mb-d06/` |
| --- | --- | --- |
| New `tests/d06-products-context.test.js` against unmodified source | 1 PASS / 5 FAIL, no skip/cancel | `products-context-red.log` |
| Same six tests after the minimal patch | 6 PASS / 0 FAIL | `products-context-green.log` |
| New test + products IA/catalog/graduation tests | 22 PASS / 0 FAIL | `products-core-green.log` |
| Same relevant sweep after the CTA display correction | 22 PASS / 0 FAIL | `products-core-final.log` |
| Above plus existing products-demo-flow | 32 PASS / 1 FAIL | `products-affected-green.log` |
| Existing products-demo-flow against the exact preserved D05 source | 10 PASS / same 1 FAIL | `products-affected-prior.log` |
| Browser runner parser | PASS | `node --check tests/acceptance/sys-mb-browser-scenarios.cjs` |

The last failure is **PREEXISTING_FIXTURE_DRIFT**, not a new product regression.
`tests/products-demo-flow.test.js:61`, “reopening cached catalogs rechecks
constructor visibility without another catalog request,” manually primes
`productCatalogs` and `catalogEntriesLoaded` but not the D01 cache context.
`productCatalogContext` therefore starts at null while the absent context helper
returns undefined; the existing context invalidation correctly discards the
manually incomplete cache on the permissions event. The same assertion fails
against the exact D05 source through read-only
`.codex-temp/sys-mb-d06/check-prior-products.cjs`; no source swap was performed.
Reproducer: `node --experimental-test-isolation=none --require
./.codex-temp/sys-mb-d06/check-prior-products.cjs --test
tests/products-demo-flow.test.js`. A separate minimal fixture repair should set
an explicit fixed `getLegacyBusinessSurfaceContextKey` and matching
`productCatalogContext` in that cached-control setup, retaining its assertions.
This off-baseline test is not edited or silently accepted in D06.

## Visual and diagnostic interpretation

Full-page screenshots are retained, with extra viewport images for the actual
save/footer controls at each width/theme. The red-run viewport review found the
cabinet forms and modal footer readable/reachable. At 390px the modal tab strip is
a horizontal rail. Its new End-key check initially asserted bounds immediately
after a full sheet rerender, while the canonical `.aae-sheet` entry animation can
translate the sheet for .18 seconds. The final runner records before/settled
geometry and waits up to two seconds for the same visible-rail predicate, without
scroll injection, CSS overrides or an account-editor runtime change. Settled
visibility passed in `d06_1789240335521_4b0509` in both themes. The preserved geometry
shows initial sheet translateX 24px / History right 403.875px, then right about
386.05px within the 390px viewport as the animation progresses; rail scrollLeft
stays 128 and focus remains on History. This is **HARNESS_ANIMATION_TIMING**, not an
account-editor runtime regression. No account-editor source or CSS was changed.
The canonical access-editor component remains dark under the global light theme;
testing both themes does not mean every component recolors. No CSS/theme patch.

The reviewed red-run browser errors were exact expected denials: animator task-AI
management reads, protected currency widget for manager/animator, custom-membership
legacy chat, explicit membership revocation, and sole-owner demotion. Browser
outbound fencing blocked only Google Fonts CSS and Clarity analytics. Counts and
paths remain in diagnostics; a classified PASS never claims zero console errors.
The final runner fails on unmatched 4xx/5xx, page exceptions, console messages or
external requests. Earlier server logs also contain a missing `title_definitions`
background-gamification table and the deliberately denied bank.gov.ua call;
neither is hidden through invented fixture DDL or real provider access. They are
separate fresh-schema/outbound-fence observations, not observed final HTTP5xx.

Source SHA256 used by the first post-fix run (retained for traceability):

- `js/programs-page.js`: `040ca79246a1e929d44255c6d62aa62c60f88882e96c729b67951e20e0672da8`
- `tests/d06-products-context.test.js`: `e83a0931a85128149622b3eca8a1f4ec9b009e3517a74e1370b1d87d760795d2`
- `tests/acceptance/sys-mb-browser-scenarios.cjs`: `0a888ffce56b1284e55c4eb769fa53dbef66428caf1373baf1197f68514bb574`

Frozen source SHA256 for the first CTA-corrected run
`d06_1789240335521_4b0509`:

- `js/programs-page.js`: `fd5a90e4f0504b55aa175188359c3f758b41ccccf15f6fdffc585b1bcab5f73d`
- `tests/d06-products-context.test.js`: `e83a0931a85128149622b3eca8a1f4ec9b009e3517a74e1370b1d87d760795d2`
- `tests/acceptance/sys-mb-browser-scenarios.cjs`: `12f5adc7ef156d240df815444c1ccd361e92d5c4243ae476e6c420d53f34b1dd`

After the isolated B06 evidence-capture failure, only the runner changed to
`bafdb4b72cbe65bb18c000d14d7c4773bd8493495d8d8429becc31d15a43a75f`.
It requires the exact held real request's `requestfinished` event, its delivered
200 response, response completion and two native animation frames before the
stale-directory assertion. Errors on that wait are handled immediately. Only the
screenshot deadline is 30 seconds; ordinary action limits stay unchanged.

The bounded membership diagnostic runner was
`d7688fd117428aad77785912992331bfd86a58c71c2d206728a3c7a3e7f54f3d`.
The final login-completion/code-capture runner is
`46bdb48eb7486a09881b085e65dffe67cca27550b9a869336564cfee8087bf54`.
Product runtime and focused unit-test hashes remain unchanged.

Rehashed after the final run: product
`fd5a90e4f0504b55aa175188359c3f758b41ccccf15f6fdffc585b1bcab5f73d`, focused test
`e83a0931a85128149622b3eca8a1f4ec9b009e3517a74e1370b1d87d760795d2`, final runner
`46bdb48eb7486a09881b085e65dffe67cca27550b9a869336564cfee8087bf54`.

Manual review of the same final runtime's safe screenshots in
`d06_1789240335521_4b0509` covered `cabinet-390-dark-viewport.png`,
`membership-390-light-history-viewport.png`, `membership-768-dark-viewport.png`,
`cabinet-768-light-viewport.png`, `cabinet-1440-dark-viewport.png`,
`membership-1440-light-viewport.png` and `products-custom-history.png`. Inputs,
labels and footer actions remain readable, History has a visible focus ring, and
the custom product screen contains its own marker/label without the MD action.
These are synthetic screenshot observations, not a live-site accessibility audit.

Final run `d06_1789241525527_7d4a50` retains 42 safe PNGs. Eight were manually
reviewed: `cabinet-390-dark-viewport.png`,
`membership-390-light-history-viewport.png`, `cabinet-768-light-viewport.png`,
`membership-768-dark-viewport.png`, `cabinet-1440-dark-viewport.png`,
`membership-1440-light-viewport.png`, `products-dar-only.png` and
`products-custom-history.png`. Cabinet actions and modal footers are readable and
reachable; the focused History tab is visible; Dar/custom headings and own
records are correct, with no MD-only CTA. This is a representative visual review,
not a claim that every screenshot was manually inspected.

Final 390px native-keyboard geometry retains focus and rail scrollLeft128:
History right400.28→388.42px in light and403.875→388.40px in dark, both within the
390px viewport when the visible predicate passes. The JSON key `settled` denotes
that visibility predicate, not a guarantee the entire .18-second animation has
ended; the screenshot is also checked visually. No scroll was injected.

The final runner wrote `browser-results.json`, `browser-diagnostics.json`, login
completion and editor-click traces, geometry and screenshots under
`output/playwright/sys-mb-d06/d06_1789241525527_7d4a50/`. Previous
`tests/browser/*.spec.js` fixture PASS counts are not reused as D06 acceptance.
The parent reports its separately executed normal `npm test` final2 as PASS;
see the main acceptance report for its exact log and the combined 173 PASS /
23 FAIL / one NOT_TESTABLE domain/readiness result. Browser functional success
does not override that broader result or the open findings above.

The parent task determines `PARK_DAR_RELEASE_READY` and `GLOBAL_MODEL_COMPLETE`
from the full acceptance matrix; a browser subset cannot decide either alone.
