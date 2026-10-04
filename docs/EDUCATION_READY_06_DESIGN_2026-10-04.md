# EDU-READY-06 — design and visual evidence

Production impact: yes, after a future release. No commit, push or deploy.

## Bug report recorded before product edits

Expected: the five Education tabs, forms, settings and canonical card use the existing CRM action geometry, readable Ukrainian copy and clear hierarchy in both themes.

Actual: primary group/journal buttons use `btn-primary`, which has no base style on this page; secondary buttons define colors only; membership termination has no class. The native Add cabinet button is also visible in production. Light theme lesson inputs retain dark backgrounds. Today truncates teacher/group/cabinet; journal history is a dense inline list. Non-schedule tabs retain the timeline legend/minimap. The generic card image occupies about 312px before lesson data; the card does not display a clearly labeled duration and shows a banquet-sheet action even without banquet data.

Reproduction: retained realistic dataset at port3012; visit all tabs, select English/creative/empty/archived groups, open a frozen journal and period report, open a 45-minute lesson through Today and its visible Edit action, open both settings surfaces. Repeat in light/dark. A request-blocked 503 on Save group verifies that the entered draft stays visible. No business writes are sent.

Root causes: missing base button geometry, overly broad existing dark form rules, nowrap/ellipsis metadata, global timeline chrome outside the hidden grid, and education content positioned after generic card decoration. Existing CRM references are `btn-submit` in panel.css and modal secondary actions; toolbar styles are scoped and cannot serve as a global button base.

History: all290 retained screenshots were personally reviewed in15 contact sheets; immutable paths and SHA256 are in `output/education-ready/06/history-review/manifest.json`. Four cropped production button references were personally reviewed; read-only fingerprints are unchanged in `06/live-reference/verification.json`. Original evidence was not edited.

Before captures:20 dark frames in `06/before-2026-10-03T21-16-00-436Z`,20 light frames in `06/before-2026-10-03T21-19-41-353Z`. Their incomplete harness runs are FAIL_OR_BLOCKED, not functional PASS: sequential theme switch encountered a Today read error, and the initial Park URL used a nonexistent context. Park was corrected to the actual synthetic `event_genix` context in a separate read-only capture with complete preflight. Use fresh contexts per theme for visual isolation; navigation races remain covered by task05. Baseline visual defects are FAIL and are preserved.

## Bounded implementation and verification plan

Reuse existing primary/secondary classes with Education-only geometry/tokens. Preserve handlers, request/draft lifecycle, selectors and canonical data source. Structure roster/history and wrap metadata. Prefer lesson information above a compact generic image. Hide banquet-sheet action only when there is no banquet detail. Translate settings copy only in education mode and restore original text when switching to Park.

Verify actual computed contrast (normal text4.5:1, large3:1), button dimensions/focus/hover/disabled states, all before/after screenshots personally, small viewport real clicks, Park baseline styles, protected surface/parser guards and disposable UI→Express→SQL regressions. No schema/auth/permissions/dependency/lockfile changes. Device/accessibility acceptance remains task07; combined final acceptance remains08.

## Results

**COMPLETE locally.** Clean final proof: `output/education-ready/06/after-2026-10-03T22-18-50-439Z/verification.json`,60/60 frames,0 contrast failures,0 unstyled buttons,0 page/route errors. All60 frames were personally reviewed in `after-drained-review`.4414 repeated own-text/value/placeholder observations: minimum normal4.55:1 and large3.48:1. Park is a separate style/canonical-card regression, with no Education contrast roots. These4414 observations are not education scenarios.

Evidence consistency **7/7 PASS**, exit0 at2026-10-03 22:21:35 UTC / Oct04 01:21 Kyiv: `06/verification-summary.json`, log`06-evidence-complete.log`. Final index includes exact runner paths and source/harness hashes. Current CSS/theme/static/protected guards, targeted JS parsing and diff check PASS. Manual preflight matches the original02 database evidence after removing only the loader's `reused` metadata flag;39 manual bookings remain, disposable public tables0. No commit/push/deploy or production data mutation.

Initial complete visual gate PASS: `output/education-ready/06/after-2026-10-03T22-00-47-821Z/verification.json`,60/60 frames,0 failures in its measured subset,0 unstyled buttons,0 page errors. All60 were personally reviewed in three contact sheets, with eight key screens reviewed at full size. That subset had4965 repeated computed text observations (minimum normal4.68:1, large3.48:1), not4965 scenarios. Full-size review then found a light settings section heading in a `div` outside that selector subset. Its scoped color is fixed, and the final gate now checks every element's own text plus input values/placeholders. The earlier subset PASS is preserved but does not serve as final all-text proof.

`npm test` finished exit0 on Node22.23.1/npm10.9.8: unit3484/3484, static UI1327/1327, and remaining normal gates PASS. Log: `06-npm-test-final.log`.97 focused mixed tests PASS, no skips, `06-targeted-final.log`. The final title-color CSS rule landed during the general run; CSS/theme/static/protected guards are rerun on final sources by the evidence verifier. No general test count is presented as an education journey count.

Final disposable regressions passed: groups15/15, lifecycle12/12, async17/17, all exit0. Exact paths are in `06/final-evidence.json`. Their evidence levels remain13 group UI checks plus2 technical checks; lifecycle8 UI +2 API/UI-reload contracts +2 technical checks; async15 UI checks +2 technical checks. The last settings-only contrast CSS corrections do not change the request/draft/lifecycle behavior; the final visual gate captures their exact source hashes.

Mixed acceptance11/11 passed with no skips, including Park canonical details, Escape focus return and absence of education navigation. Log: `06-acceptance-expanded-final.log`; this suite contains API preparation, mocks and internal helper checks, so it is not11 full UI journeys. The mixed context suite also PASS in `06-context-first.log`.

The first evidence verification correctly rejected a visual artifact with a late intercepted GET error even though its visual subset said PASS. The harness now drains page routes with `unrouteAll({behavior:'wait'})` before navigation and before terminal status; context-level outbound/business-write blocks remain installed. The final clean run and verifier both PASS. The verifier separately asserts absent education roots and unchanged legend in Park, rather than requiring education contrast observations there. Missing-index, initial/late-route and preflight-wrapper verifier FAILs are preserved.

### Changes

- `css/education-schedule.css`: Education-only theme tokens, readable labels/inputs/statuses, wrapping, action geometry and interaction states. Primary actions reuse `btn-submit`; secondary actions reuse `btn-secondary`; archive/end/cancel use an outlined destructive modifier. Two narrowly scoped color overrides are necessary because existing canonical styles use `!important`/inline colors. Shared Park CSS is unchanged.
- `index.html`: consistent Ukrainian action copy and classes, aligned action/filter groups, lesson fields before generic form sections, education-specific settings labels. Existing field IDs and handlers are retained.
- `js/education-groups.js`, `js/education-attendance.js`: structured member/history rows, explicit error styling. Request ownership, draft and concurrent-write semantics from03/05 are preserved.
- `js/education-schedule.js`: styled retry, human child count, education settings copy with restoration when switching context.
- `js/booking.js`: the existing education helper presents topic/date/time/duration/teacher/group/cabinet first; image is compact, and banquet-sheet action is hidden only when there is no actual banquet detail. Series uses readable status labels, shared actions and a keyboard-operable close button. Protected identity/source blocks and canonical renderer ownership are unchanged.
- `js/settings.js`, `timeline-settings.html`, `js/timeline-settings-page.js`, `js/timeline-context.js`: education copy, scoped settings theme, relevant legend categories. Park-only settings fields are hidden in education while retaining their existing DOM/state/save contract. There is no settings API/schema/permissions change.
- Tests/tools: visual/read-only production harness, contact-sheet generator, safe design runner/evidence verifier; existing group/lifecycle/async harnesses accept a separate output directory. The settings VM test now provides `document.body`; assertions were not weakened. The legend contract distinguishes education from staff modes.

### Visual evidence and numerical method

All290 original full-QA/01–05 frames were personally reviewed. Original before captures cover20 dark,20 light and one Park frame. Eleven additional ready before frames cover all four modern settings tabs and series in both themes, plus Park. These11 are explicitly **reconstructed from base SHA56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e static files over the real local Express API**, rather than mislabeled as original pre-edit captures. The first light modern-settings capture was early/blank and is not accepted as evidence. Contact manifests preserve original paths, dimensions and SHA256.

The final matrix specifies29 states per theme plus Park and a390px observation:60 frames. It includes all five tabs, English/creative/empty/archive/new groups, failure with retained draft, pending disabled save, keyboard focus/hover, journal actions/history, report, day/week, canonical card, edit/create, series and both settings surfaces. Visible UI clicks select/open all screens; failed UI actions are never repaired by an API write. API/SQL fixture preparation happens before the scenario. Source hashes are checked before/after capture to reject edits made during a run.

The final contrast audit reads actual computed text/font/background colors for every element with its own text, plus input values/placeholders; converts colors through a browser canvas; composites transparent ancestor backgrounds; and samples21 points per gradient segment. It takes the minimum ratio across samples using sRGB relative luminance. Thresholds:4.5:1 normal text,3:1 large text. Unknown/non-finite measurements fail. Disabled/inert/decorative controls are excluded. Ancestor opacity, image backgrounds, occlusion and non-text contrast are not a complete pixel-level WCAG audit; this is a measured text-contrast gate for captured states, not full certification. Task07 must cover the complete accessibility/device matrix and physical devices.

Failed/incomplete captures remain immutable. Diagnostics include incorrect fixture keys/context, request throttling, an early theme transition, aborted stale GET routes and an initial color-parser bug. Assertions were corrected to wait for genuine end state; actual contrast failures were fixed in scoped CSS. `after-2026-10-03T21-55-30-352Z` has60 frames and two real contrast FAILs, exit1, preserved. A later capture inadvertently selected `before` phase and is supplementary only; the final indexed proof requires `after` and60 exact frame names. The runner now defaults visual runs to `after`.

The expanded own-text/placeholder matrix `after-2026-10-03T22-09-07-279Z` found14 additional repeated contrast FAILs: dark textarea/settings placeholders, light catalog category headers and the light settings preview heading. Its exit1 is preserved. Education-scoped muted/text colors now cover these cases; the parser also recognizes computed CSS Color4 forms, hexadecimal stops and `transparent`, while retaining FAIL for non-finite measurements. Final results must come from the subsequent all-text run, not the earlier narrower PASS.

### Verification levels and boundaries

The evidence index records actual exit codes and paths for the final visual runner, group/lifecycle/async regressions,97 focused mixed tests and `npm test`. General unit/static counts are not education journeys. The existing mixed context suite is separately classified because it uses mocks/internal calls. Initial `npm test` failed because its VM DOM omitted `document.body`; that RED log is preserved, and the same assertions pass with the complete stub.

Production was used only as a visual reference: business writes were blocked before login, four cropped button references reviewed, and profile/cabinet fingerprints unchanged. Live identity remains v0.82.59/SHA56fe…/`codex/eventgenix-production`; local fixes are not deployed. Each completed disposable runner independently checks full retained preflight,39 manual bookings and0 disposable public tables after cleanup. Manual preview remains at [Today](http://127.0.0.1:3012/?businessContext=dar&educationSchedule=today&date=2026-10-03). Use a private window to avoid older local Service Worker assets; release/cache version markers were intentionally not bumped.

Outbound provider/TCP/WebSocket holds remain enabled; reconnect banner and local Telegram read failures are known preview limitations, not messaging/live-sync PASS. Staff ownership/new unassigned teacher limitation03 remains outside06.390px group selection/scroll is an observation; whole-app overflow, phone/tablet/iPhone and accessibility acceptance remain07. No schema/auth/access/dependencies/lockfile/release/protected manifest changes, commit/push/deploy or real business data writes.

### Repeatable commands

Use Node22/npm10 and the retained loopback PostgreSQL from task02. Do not target the manual or production database for resets.

```powershell
npm run check:runtime
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM='RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT='C:/Users/Plotva/AppData/Local/npm-cache/_npx/fd3bca3c548369c0/node_modules/playwright'
$env:EDU_READY_SUITE='visual'
$env:EDU_VISUAL_PHASE='after'
node tests/integration/run-education-ready-design.js
# Repeat serially with EDU_READY_SUITE groups, lifecycle, async or context.
node tests/tools/verify-education-ready-design-evidence.js
```

The verifier rejects missing/incomplete/stale final evidence and returns exit1. A new product edit requires fresh visual/regression evidence and a refreshed index; it does not authorize overwriting original before/RED proof. Recommended next action: EDU-READY-07 in this same worktree.

Local tooling note: the installed Node22 PowerShell shim forwards file arguments but did not forward piped stdin on two recording attempts. Recommended small AGENTS addition: “On this host, run Node verification/recording through a saved `.js` entrypoint; do not pipe a PowerShell here-string into the Node shim.” No AGENTS edit was made in06. The ignored `06/record-final-index.js` records this session's observed exits only; it must not be used to infer success for a future run.
