# EDU-READY-07: mobile and accessibility

Production impact: yes, after a future release. No commit, push, deployment, schema, permission, dependency or release-marker changes are authorized here.

## Pre-edit bug report (23:12 UTC, 2026-10-03)

- Symptom: phone users cannot see all toolbar actions; controls are small; keyboard focus remains behind the lesson editor/series dialog; report scrolling is not keyboard discoverable.
- Expected: all five views fit the page, deliberate timeline/table overflow stays inside named regions, actionable controls have 44px touch targets, input text is at least16px, dialogs contain Tab/Shift+Tab and restore focus on Escape.
- Actual: at390px, date cluster right edge614px; export/filter actions outside viewport. Many controls34–42px, date input below16px. `programSearch` has no associated label. Report wrapper has no tabindex. Editor/series initial focus times out outside the surface.
- Reproduction: actual retained synthetic app → five tabs → journal/report → Today card → visible Edit → series. Real UI clicks; read-only route guard installed before login; no API repair.
- Primary baseline: `output/education-ready/07/baseline-chromium-2026-10-03T23-04-46-493Z/verification.json`,14 personally reviewed frames, exit1. WebKit initial launch failure (missing revision2203) is preserved separately and is not browser verification. Matching installed Playwright/WebKit2359 is being used without an install.
- Root cause: last responsive toolbar rules force `width:max-content` and nowrap; education overrides stop at42px; report wrapper is plain div; `openBookingPanel` and `openEducationSeriesManager` only remove hidden and bypass existing shared focus lifecycle.
- Scope: education stylesheet, canonical booking panel/series lifecycle outside protected source blocks, report semantics, static field label. Park retains its existing shared lifecycle and style.
- Verification: preserved baseline assertions through real Chromium/WebKit,320/390/640/768/844/1024 widths, short landscape height, both themes, touch/keyboard, independent retained SQL preflight; targeted guards and disposable functional regressions.

## Device evidence boundary

Windows Playwright WebKit is an engine test, not physical iPhone Safari. `reflow-200` is640 CSS pixels corresponding to a1280px viewport at200% browser zoom; it is a layout proxy, not a physical pinch-zoom or assistive-technology certification. VoiceOver/TalkBack, on-screen keyboard, actual notches and device hardware require a later physical-device check. No unavailable check is recorded as PASS.

## Results

Local browser implementation and verification are complete. Physical-device acceptance remains NOT RUN. Evidence root: `output/education-ready/07/`; `final-evidence.json` identifies exact attempts and logs, source/harness hashes are verified against current files.

| Verification | Actual result | Retained evidence |
| --- | --- | --- |
| Chromium140.0.7339.16, six profiles |675/675 assertions PASS,105 frames, exit0 | `after-chromium-2026-10-03T23-58-18-696Z/verification.json` |
| WebKit26.6/revision2359, six profiles |675/675 assertions PASS,105 frames, exit0 | `after-webkit-2026-10-03T23-53-05-057Z/verification.json` |
| Groups at390×844 |15/15 checks PASS, real UI/API/SQL | `regressions/groups/attempt-2026-10-03T23-32-40-610Z/verification.json` |
| Lesson lifecycle at390×844 |12/12 checks PASS, real UI/API/SQL | `regressions/lifecycle/attempt-2026-10-03T23-37-53-401Z/verification.json` |
| Today/journal/report at390×844 |17/17 checks PASS, real UI/API/SQL | `regressions/async/attempt-2026-10-03T23-42-59-518Z/verification.json` |
| Mixed acceptance, including Park |11/11 PASS, no skips, exit0 | `logs/07-acceptance-final.log` |
| Fresh design/contrast/Park |60/60 frames PASS, no contrast/native/page/route errors, exit0 | `after-visual-2026-10-03T23-56-44-659Z/verification.json` |
| Focused final contracts |24/24 PASS, no skips, exit0 | `../07-final-focused.log` |
| General `npm test` |exit0;3484 unit and1327 static checks PASS | `logs/07-npm-current-final.log` |
| Current-source evidence verifier |6/6 PASS, exit0; missing index previously returned exit1 | `verification-summary.json`, `../07-evidence-final.log` |

Counts are assertions/frames across mixed test levels, not a total of independent education journeys. The final groups/lifecycle/async runs preceded the last CSS font correction; the final two-engine matrix and60-frame visual run followed it. `npm test` finished at23:52:02 UTC before that final CSS-only correction. Focused24 tests, CSS/static/protected guards and current-source browser proof were completed after it. No CI was run. Final guard commands all returned0 and six protected source blocks remained intact.

Computed text contrast:4416 repeated own-text/value/placeholder observations, minimum4.55:1 normal and3.48:1 large. Final input boundary minimum3.08:1 in both engines. Focus visibility,44px targets,16px text fields and names are checked separately. Park computed styles match the preserved06 reference. This is scoped contrast evidence, not a full WCAG certification.

Personally reviewed all1154 original07 screenshots in63 contact sheets, including initial failures and diagnostic attempts. All210 final engine frames,60 final visual frames,15 functional frames and2 acceptance frames are included; representative final phone/landscape/tablet screens were also viewed at full resolution. `personal-review.json` and11 SHA256 manifests bind that review to the original files. The older01–06 evidence was preserved and was already reviewed during06.

Seven selected safe runners returned0, each retaining39 owned manual bookings and cleaning only the disposable database to zero public tables. Full manual preflight still matches the fixture manifest. The retained preview and PostgreSQL remain on loopback3012/55469. No production request was made in07; no commit/push/deploy or production seed occurred.

## Implementation and ownership

- `css/education-schedule.css`: education-only44px targets,16px text fields, opaque date field, wrapped toolbar, grid based on actual available width, explicit CRM font on tabs/cards, stronger field boundaries, visible keyboard outline, contained report/timeline scrolling, bounded dialog height using dynamic viewport units and safe-area padding, reduced-motion rules. Existing CRM sidebar/breakpoints remain shared.
- `index.html`: named booking panel heading and accessible program-search name.
- `js/booking.js`: education panel and series manager use the existing shared modal focus lifecycle. Dirty-draft close protection still executes before closing. Series returns focus to its explicit visible trigger, including WebKit touch taps which do not implicitly focus a button.
- `js/education-attendance.js`: named keyboard-scrollable report region, caption and column headers. Report semantics and attendance concurrency are unchanged.
- No booking identity/source priority, alternative renderer, protected manifest, database/auth/permission/dependency/lockfile/version/config changes.

## Harness and evidence method

`tests/browser/education-ready-mobile-browser.js` exercises six viewports per engine with actual clicks/taps, real UI login completed before the education page, locale uk-UA, Europe/Kyiv, touch/device user-agent emulation and reduced motion. The profiles are320×740,390×844,844×390,768×1024,1024×768 and640×800. Dark mode covers390 and1024; other profiles use light mode. Seventeen normal states per profile plus390px save-error/empty/error give105 frames and675 assertions per engine, including105 added font checks. These are repeated state/assertion observations, not675 independent journeys.

Checks cover document overflow, controls outside their containing viewport (intentional named table/timeline scroll is exempt),44×44px control targets, accessible names,16px input text, opaque input-border/background contrast≥3:1, viewport zoom permission, Tab/Shift+Tab/Escape/focus return, keyboard report scroll and unsaved-draft retention. Text contrast is independently rechecked by the existing60-frame design harness. This does not certify every WCAG criterion, native picker, assistive technology, pointer occlusion or physical hardware.

Business-write requests are blocked before login in the visual matrix. A controlled503 must leave the visible group draft intact; a controlled date-read503 must show a retry and reach the final empty state after retry. Initial API/SQL fixtures and independent assertions never replace a failed UI action. Groups/lifecycle/async suites run separately at390×844 and retain their real UI→Express→PostgreSQL checks. The safe runner keeps the manual39-booking dataset and resets/cleans only its named disposable database under an exclusive advisory lock.

Arbitrary pauses are not used. The harness waits for network drain, visible application state, education settings mode, CSS transitions to finish, final focus outline and final native scroll position. Early snapshots and cancelled navigation reads were preserved as FAIL while readiness was corrected. Product field-border contrast1.48:1 and touch-series focus return were real defects and have their original RED evidence. Missing WebKit2203 launch remains a launch failure; the installed matching2359 runner is used without downloading dependencies.

Personal review found two further visual defects before the final corrections: landscape Chromium split the last character of “Відвідування” onto a new line; WebKit tabs/cards inherited its default serif font. The preserved pre-font WebKit proof is `after-webkit-2026-10-03T23-44-39-952Z`; it passes the earlier570 checks but does not prove font consistency. The final675-check harness explicitly rejects that serif fallback, and both engines are re-run on the corrected source.

## Remaining acceptance boundaries for08

| Item | Evidence boundary |
| --- | --- |
| Physical iPhone/iPad/Android, VoiceOver/TalkBack, on-screen keyboard, pinch zoom, actual notches | NOT RUN; no hardware/session available in this task |
|640px reflow and reduced-motion | Browser layout/media emulation; native browser200% zoom interaction is not proved |
| Native date/select picker usability | Playwright fills real form controls; operating-system picker UI is not automated |
| Reports/timeline overflow | Contained horizontal scrolling is deliberate; whole-page overflow must remain absent |
| Local WebSocket/outbound hold | Reconnect banner and restricted provider/media requests are preview limitations; real-time sync/messages/media delivery are not accepted |
| Teacher ownership/new unassigned teachers | Existing03 schema limitation stays open; no authorization/schema scope expansion here |
| Production/release | No07 production requests or commit/push/CI/deploy;06 read-only visual reference remains historical |

Continue08 in `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`, branch `codex/education-ready-pack-20261003`, unchanged base `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`. Retained preview remains loopback3012; it does not expose the dataset on the LAN. A physical-device acceptance needs an explicitly arranged safe local access path, not a production seed.

## Reproduction commands

Use Node22/npm10 in this worktree. Existing PostgreSQL port55469 is required; no production connection is accepted.

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM='RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT='C:/Users/Plotva/AppData/Local/npm-cache/_npx/fd3bca3c548369c0/node_modules/playwright'
$env:EDU_READY_SUITE='mobile'
$env:EDU_MOBILE_ENGINE='chromium'
node tests/integration/run-education-ready-mobile.js
# WebKit: use existing420ff84f11983ee5/node_modules/playwright and engine=webkit.
# Functional: EDU_READY_PHONE=true; suite=groups, lifecycle, async or acceptance.
# Text contrast/Park: suite=visual; EDU_VISUAL_PHASE=after.
node tests/tools/verify-education-ready-mobile-evidence.js
```

The verifier consumes retained final evidence; it does not run or fabricate browser tests. Missing, stale, failed or incomplete evidence returns exit1. Original01–06 proof remains historical after product changes;07 establishes new proof rather than rewriting those snapshots.
