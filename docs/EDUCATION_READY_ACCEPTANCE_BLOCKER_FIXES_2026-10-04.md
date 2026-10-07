# Education acceptance blocker fixes — 2026-10-04

Production impact: yes, after a future accepted release. The release09 GO condition is not met; no commit/push/deploy is performed. Worktree: education-ready-pack; base56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e. Previous08/09 evidence remains immutable.

## Bug reports and causes recorded before product edits

### ACCEPT-01: landscape education editor obscured by sidebar

- Expected: the entire date field, labels and Save control are visible and clickable.
- Actual:844×390 date/Save left edges hit sidebar children instead of the controls in Chromium and WebKit.
- Reproduction: retained synthetic Dar → Today → robotics lesson45min → visible Edit → date/Save; read-only request hold installed before login.
- Root cause: panel uses shared z-panel90, persistent sidebar uses z-sidebar900; tablet panel680px overlaps the sidebar. Existing center-only checks miss it.
- Fresh before proof: output/education-ready/blocker-fixes/occlusion-before-matching/verification.json: four engine/viewport observations,844FAIL and1024PASS in both engines.
- Target: education-scoped panel/backdrop stacking above sidebar layers and below canonical modal layers. No shared sidebar or Park CSS changes.

### ACCEPT-02: valid WebKit create loses native activation

- Expected: clicking the enabled visible submit control while the duration field is focused sends exactly one POST, then reload/API/SQL agree.
- Actual: trusted pointerdown/mousedown and mouseup, no click/submit/POST. Four setup checks pass; create fails and dependent steps are blocked.
- Reproduction: real new teacher → group → child enrollment → day grid future2030-01-10 → lesson45min → visible submit, without manually blurring duration first.
- Root cause: duration change on blur calls summary/validation refresh; updateBookingSubmitState unconditionally assigns the unchanged textContent. This removes the pressed text node between mousedown and mouseup. WebKit suppresses native activation after that node replacement.
- Causal diagnostic: original source records text node3 at mousedown, replacement nodes4/5 and node5 at mouseup, no click. A controlled browser-response variant removes only the redundant text assignment: same visible journey creates the lesson and records trusted click/submit with identical text node at down/up. This variant is diagnostic, never final acceptance evidence.
- Fresh before proof: blocker-fixes/original/attempt-*/verification.json; treatment: blocker-fixes/stable-text/attempt-*/verification.json. The unit regression before edits is2PASS/1FAIL, exit1 (activation-unit-before.log).
- Target: preserve unchanged education submit text nodes; retain real label changes, loading/error states and shared non-education semantics. Protected identity/source/renderer blocks and manifest are unchanged.
- Initial wrong cached WebKit revision2203 launch and CRLF diagnostic-target mismatch are retained as configuration/diagnostic failures; matching installed2359 is used with no downloads or dependency changes.

## Plan and verification

Affected product files: css/education-schedule.css and js/booking.js. Harness: focused activation regression, trusted-event/one-POST journey oracle, edge hit tests, isolated output-root support. Risks: overlay ordering and browser-native activation; verify dialogs remain above panel, all field validation still updates, Park remains unchanged.

Run actual unpatched Chromium/WebKit journeys, landscape edge clicks and personally reviewed screenshots, date/mobile regressions, measured contrast/Park smoke and npm baseline. API/SQL are independent assertions only. Preserve manual/device DB full-row hashes and prior evidence hashes. Hardware42cases remain BLOCKED_DEVICE; software fixes cannot prove iPhone/iPad/Android keyboards/pickers or VoiceOver/TalkBack.

## Поточні результати

**ACCEPT-01/02 закрито локально. Загальний висновок — NO-GO; release09 залишається HOLD.** Старі `EDUCATION_READY_FINAL_ACCEPTANCE.md` / `EDUCATION_READY_RELEASE_HOLD.md` описують попередню базу доказів і не переписувалися як новий acceptance.

| Перевірка | Фактичний результат | Доказ |
| --- | --- | --- |
| Native education submit | PASS: trusted click/submit, незмінний натиснутий вузол, рівно один POST, збережені45 хв через Express→SQL | `blocker-fixes/verified/regressions/journey/attempt-*/verification.json` |
| Суцільний UI цикл | Два journeys, Chromium/WebKit, по12 кроків PASS; тема, дата, кабінет, reload, журнал/виправлення, незалежний звіт, cancel; pageErrors0 | Ті самі journey proofs; engine зазначений у кожному |
| Краї date/duration/Save |6 профілів PASS:390×844,844×390,1024×768 у двох engines;54 hit samples,36 trusted native clicks.18 Save PUT блоковано до відправлення; ще6 background writes блоковано | `verified/regressions/editor/attempt-*/verification.json` |
| Focused units / protected booking |11/11 PASS, включно з3 activation regressions;6 protected blocks PASS, manifest незмінний | `focused-unit-final.log`, `protected-final.log` |
| Date / lifecycle / groups / teachers / async |13 /12 /15 /16 /17 checks PASS на поточному product source; F01–F06, isolation, date/draft/races | `final/regressions/`; окремі source/harness snapshots у command records |
| Attendance / series / booking contracts | Нові attendance, series, acceptance, navigation, submit, context команди PASS | `verified/commands-*.json`, відповідні logs |
| Chromium/WebKit responsive | По6 emulated profiles,753 checks і117 screenshots PASS. Ці checks не є753 education journeys чи фізичними пристроями | `final/final-{chromium,webkit}-*/verification.json` |
| Visual / contrast / Park |60 audits/60 screenshots PASS;4529 contrast samples, minimum normal4.55:1, large3.48:1; contrast failures0, unstyled buttons0; Park smoke PASS | `final/after-visual-*/verification.json` |
| Final npm / runtime | `npm test` exit0 на Node22.23.1/npm10.9.8 після context harness fix. Загальні unit/static counts не є education journeys | Найновіший npm record у `verified/commands-*.json`, `runtime-final.log` |
| Physical hardware |42 planned /0 PASS /0 FAIL /42 BLOCKED_DEVICE, verifier exit2; keyboards/native pickers/VoiceOver/TalkBack NOT RUN | `devices/device-verification.json` |

Усі шляхи доказів вище — відносно `output/education-ready/blocker-fixes/`. `BLOCKER_FIX_RESULTS.json` / `summarize-current.js` звіряють10 актуальних software commands і поточні product hashes; aggregate повертає exit2 через hardware/combined-acceptance block. Для старших commands змінився тільки окремий controlled-context harness, який вони не виконують; саме його фінальну версію й final npm повторено окремо. Це **не** означає новий повний combined acceptance08.

## Виправлення harness і чесна історія FAIL

- Початковий post-fix WebKit journey мав11 functional PASS і `no-page-errors` FAIL. Same-origin GET до outgoing document були `Load request cancelled`, а WebKit називав це access-control error. Перед goto/reload harness тепер чекає кінцевий loading-стан і завершення реальних запитів. Pageerror не фільтрується й не очищається; новий strict journey12/12 PASS. Це не доказ production CORS failure або live synchronization.
- Ранні readonly manual-preview перевірки вперлися в реальний local429 після багатьох bootstrap/login запитів. Вони залишилися FAIL. Permanent edge regression перенесено у стандартний disposable runner з його чинними test rate-limit settings; business write hold встановлено перед browser login. Manual settings/rate-limit middleware/permissions не змінювалися.
- Початковий `npm test` завершився exit1 через root-doc allowlist: задачі08/09 вимагали два нові root документи. Додано тільки `EDUCATION_READY_FINAL_ACCEPTANCE.md` та `EDUCATION_READY_RELEASE_HOLD.md`;5/5 focused guard PASS і404 для обох документів доведено. Product static/auth policy незмінна; final npm зелений.
- Controlled A→B→A smoke також реально мав exit1: mock завершив request index5, залишив новіший active-A index6 нерозв’язаним; loader правильно ігнорував старшу відповідь, після20с давав error. Модель ізоляції не змінювали. Harness завершує всі fresh-A mocks, залишає stale A/B затриманими й перевіряє, що вони не замінили поточні groups/journal/report/save. Permanent context regression PASS. Це mocked contract test, а не SQL journey.
- Додатковий WebKit UI-tab reuse diagnostic виявив Playwright auto-scroll/actionability timeout: при фокусі duration rect коливався на1px і `locator.click` взагалі не dispatch-ив pointer events. Ранні timeout/scroll variants збережено як FAIL. Native wheel→видима кнопка→positive bounds/hit assertions→trusted pointer пройшов12/12 через реальний Express/SQL, без force-click/API repair. Цей окремий diagnostic не підміняє permanent acceptance й не доводить physical Safari keyboard behavior; повторити його у фінальному acceptance і на пристроях.
- Wrong cached WebKit launch, patched-response treatment, harness-drift attempts та всі первинні FAIL залишено у власних output каталогах. Patched response не використано як прийнятий proof.

## Збереження й наступний крок

`personal-visual-review.json`: особисто переглянуто429 frames через22 contact sheets і full-size проблемні controls; оригінальні SHA незмінні. Before landscape перекриття та after date/Save доступність переглянуто окремо. Red Save toast у readonly regression — intentional request block, reconnect banner — outbound/WebSocket hold.

`preservation-after.json`:10 full-row table fingerprints обох retained DB, по39 bookings, dirty primary status та всі попередні08/09 evidence files незмінні. Старі08C файли не перезаписувалися. Disposable cleanup залишає public tables0; listeners лише loopback3012/55469,3013/3014 відсутні. Production не змінювали. Dependencies/lockfile/version/schema/auth/permissions/protected manifest/commit/push/deploy не змінено цією continuation.

Операторський набір: `devices/OPERATOR_CHECKLIST_UK.md`, `operator-results.json`, `verify-devices.js`, owned `start-device-preview.js` / `stop-device-preview.ps1`. Prepare PASS без seed/reseed і без LAN listener; окрема device-БД має anchor2026-10-04. Новий launcher пише лише нові device proof paths. Wi-Fi192.168.1.106/24 підтверджено read-only; адресу треба повторно звірити перед lease. LAN start/stop та доступ із пристрою в цій continuation NOT RUN.

Наступне: фактична iPhone/Safari, iPad/Safari, Android/Chrome сесія з оператором; після hardware — новий повний08 на незмінному source/harness із новими hashes. У ньому повторити series visible-create/cancel, scope of navigation/scroll, усі mandatory reports/isolation/concurrency і fresh read-only production reference. Лише після GO відновлювати09 зі свіжою live/remote/Railway перевіркою.
