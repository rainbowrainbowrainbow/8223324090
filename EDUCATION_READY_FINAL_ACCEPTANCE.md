# Current release acceptance — 2026-10-04

Conclusion: GO_WITH_OWNER_DEVICE_DEFERRAL for v0.82.62. All19 mandatory software suites pass on freshly integrated source; physical device checks remain BLOCKED_DEVICE /42 NOT RUN /0 PASS, deferred by the owner's latest release-and-self-test instruction.

Current authoritative evidence and limits: docs/EDUCATION_READY_RELEASE_ACCEPTANCE_2026-10-04.md and output/education-ready/release-acceptance/release-acceptance.json.

Release worktree: C:/Users/Plotva/.codex/worktrees/education-ready-release-20261004/EventGenix, base44a7d498c8bf4aabc2fac9eba05218473518696a. Final exact-SHA CI/deploy/live proof: output/education-ready/release-acceptance/RELEASE_PROOF.md (filled after deployment).

The original NO-GO below is historical evidence. Its product blockers were fixed and freshly repeated; it is not silently relabelled PASS. Hardware remains unperformed.

---
# EDU-READY-08 — фінальний acceptance, 2026-10-04

**Висновок: NO-GO.** На поточному коді є два відкриті FAIL: перекриття education editor боковим меню на844×390 та невдале видиме створення заняття у WebKit. Фізичні пристрої — **BLOCKED_DEVICE**, а не PASS. Історичні результати01–07 не використані замість нових прогонів.

Production impact: yes — для майбутнього релізу успадкованих продуктових змін. У задачі08 змінено лише harness/документацію; продуктові fixes не внесено. Commit/push/deploy/CI не виконувалися.

## Код і межі перевірки

- Worktree: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`.
- Branch: `codex/education-ready-pack-20261003`.
- HEAD/base/live/remote production HEAD: `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`, version0.82.59. Production branch: `codex/eventgenix-production`.
- Поточний кандидат містить незакомічені зміни. Base SHA не ідентифікує ці зміни; точний код визначений source hashes у `output/education-ready/08/final-evidence.json` і command manifests.
- Source fingerprint1061 файлів: `53aa64e90872cd15cd0e9419eb39026cef404c7870072fdbd6bf2729504f3b03`.
- Harness fingerprint909 файлів: `179e869c135cbbf476b8c3e4902b3320f20d64463ed2b1727405803a8f713f9b`.
- Node22.23.1 / npm10.9.8; `check:runtime` і `git diff --check` — exit0. Стан dirty main checkout збігається до/після; checkout не оновлювали. `identity.json`, `identity-final.json` містять timestamps/status/diff/runtime/live/remote evidence.
- Усі записи — actual-app → Express → owned disposable PostgreSQL `127.0.0.1:55469/eventgenix_education_ready_fixture_test`. Фіксований anchor2026-10-03, report clock2026-10-03T09:00:00Z, timezoneEurope/Kyiv.
- API/SQL використовуються для prerequisites та незалежних assertions. Жоден невдалий крок нового continuous journey не ремонтувався API-записом.

У таблицях нижче всі proof/log paths відносні до `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix/output/education-ready/08/`. Точні command manifests, позиції, log hashes та повні source/harness maps: `final-evidence.json`.

## Свіжа acceptance матриця

| Область | Результат | Рівень і фактичний доказ |
|---|---|---|
| Повний Chromium journey | PASS,12 checks, exit0 | Один безперервний visible UI journey; `regressions/journey/attempt-2026-10-04T09-51-13-267Z/verification.json` |
| Повний WebKit journey | FAIL,4 PASS /1 FAIL /7 BLOCKED_DEPENDENCY, exit1 | Visible create не відправляє POST; `regressions/journey/attempt-2026-10-04T09-42-43-457Z/verification.json` |
| Новий викладач / isolation08A | PASS,16 checks, exit0 | UI першого призначення, два synthetic бізнеси, чужий ID/readonly/inactive/race/migration; `regressions/teachers/attempt-2026-10-04T09-57-04-730Z/verification.json` |
| Групи F01/F02 | PASS,15 checks, exit0 | Selection/load/draft, pending save, loader failure, capacity/member/archive/double/retry; `regressions/groups/attempt-2026-10-04T10-00-27-855Z/verification.json` |
| Duration F05 / lifecycle | PASS,12 checks, exit0 | З них8 visible UI scenarios; duration30/45/60/90, invalid, окремі edits, canonical Today/day/week, Park API contract; `regressions/lifecycle/attempt-2026-10-04T09-55-29-507Z/verification.json` |
| Visible date08B | PASS,13 checks, exit0 | З них11 visible UI scenarios; усі persisted columns, old/new projections, conflict/adjacent, month/year/Kyiv DST, slow/double/retry, один series member, mobile; `regressions/date/attempt-2026-10-04T09-59-01-882Z/verification.json` |
| Today/journal/report F03/F04/F06 | PASS,17 checks, exit0 | З них15 visible UI scenarios; другий оператор, dirty draft, незалежні report oracles, stale success/error/navigation/reset; `regressions/async/attempt-2026-10-04T09-53-42-823Z/verification.json` |
| Frozen roster / concurrent attendance | PASS,3 PostgreSQL HTTP tests, exit0 | Standalone після завершення інших runner’ів; `attendance-2026-10-04T10-03-31-816Z.log` |
| Series / DST / atomic conflicts / concurrency | PASS,17 PostgreSQL HTTP tests, exit0 | Реальні API+SQL: create/create, create/edit, create/series, partial conflicts/rollback, adjacent/different teachers/businesses; `series-2026-10-04T09-51-04-897Z.log` |
| Mixed PostgreSQL/browser acceptance + Park | PASS,11 mixed tests, exit0 | `acceptance-2026-10-04T09-55-18-890Z.log`; це API/contracts і UI/internal-helper probes, не11 наскрізних journeys |
| Navigation / group submit / context | PASS, exit0 кожен | `navigation-2026-10-04T09-58-51-511Z.log`, `submit-2026-10-04T10-01-50-942Z.log`, `context-2026-10-04T10-02-09-071Z.log`; рівень окремих helper/UI probes з audit01 збережений |
| Chromium responsive/ARIA/contrast matrix | Automated probes PASS:6 profiles /753 checks /117 frames | `final-chromium-2026-10-04T09-48-00-628Z/verification.json`; **загальний visual acceptance FAIL** за edge hit-test нижче |
| WebKit responsive/ARIA/contrast matrix | Automated probes PASS:6 profiles /753 checks /117 frames | `final-webkit-2026-10-04T09-43-35-897Z/verification.json`; **загальний visual acceptance FAIL** за edge hit-test нижче |
| Desktop visual/contrast/Park reference | PASS для виміряного scope,60 frames | `after-visual-2026-10-04T09-52-31-878Z/verification.json`;4529 text observations, min normal4.55:1, large3.48:1,0 contrast failures/unstyled buttons/page errors; borders matrix≥3:1 |
| Landscape editor occlusion | **FAIL**, exit1 | Left/center/right DOM hit testing:844×390 FAIL обидва engines;1024×768 PASS для виміряних controls; `occlusion-edge/verification.json` |
| npm test | PASS, exit0 | `npm-2026-10-04T09-38-03-114Z.log`; загальні unit/static/guard executions не є education journeys |
| iPhone/Safari, iPad/Safari, Android/Chrome hardware | **BLOCKED_DEVICE**,42 planned /0 PASS | `current-device-verification.json`;8 source hashes звірені з кінцевим кодом; фактичних model/OS/browser/operator/evidence немає |
| Native keyboard/pickers, VoiceOver/TalkBack, hardware notch/zoom | **NOT RUN** | Browser emulation/DOM ARIA/focus перевірки цього не доводять |
| Production QA | READONLY_OBSERVATION_COMPLETE | `live-readonly-2026-10-04T09-55-13-563Z.json`; окремо від readiness кандидата |

Primary Chromium journey: нова Віра Савченко без попередніх group assignments → нова музична група → пошук вигаданої дитини та зарахування → заняття45 хв → reload/card → окремі topic/date/cabinet edits → present → correction absent → reload/history → independently expected report `{held:1, absent:1, ...others:0}` → visible cancel → SQL: змінився лише status. Teacher/group/time/duration edits додатково перевірені lifecycle suite.

Report matrix включає кілька груп/дат, conducted/cancelled/future/no journal/unmarked; очікування обчислено від fixture plan/constants, не продуктовою report функцією. Attendance suite перевіряє snapshot names/roster після backdated membership change, clear/null marks, serialization/author/time і чинний last-write-wins контракт. WebKit-dependent частина continuous journey не виконана після FAIL; окремі Chromium PASS не замінюють її.

Series calendar/atomic concurrency доведені на HTTP+SQL рівні. Відкриття/контроли series manager перевірені у browser matrix; окремий повний visible UI series create/cancel journey у08 **NOT RUN**. Частина успадкованого mixed acceptance harness ще має API fixture writes, internal helper calls та500ms pauses. Її PASS не використано замість fresh visible journeys/regressions з terminal-state/barrier waits.

## Відкриті дефекти та release blockers

**ACCEPT-01 — FAIL, high:** sidebar перекриває форму на844×390. Panel x164..844/z90, sidebar x0..236.3125/z900; date x198 і Save x196 частково приховані. Left-edge clicks потрапляють у sidebarIdentityCard/business select. Root cause: panel stacking і tablet width. Rect/overflow/center-only audit давав false-positive visual PASS; особистий review та edge assertions його відхилили. Докази: `occlusion/verification.json` (лише centers; недостатній oracle), `occlusion-edge/verification.json`, обидва landscape date/Save screenshot у final engine folders.

**ACCEPT-02 — FAIL, high:** valid WebKit create не генерує click/submit/POST. У trusted event diagnostic приходять mousedown/mouseup, кнопка enabled/type submit/form bookingForm/noValidate true, validation valid; немає page error. Root cause **NOT PROVEN**. Focus/blur-rendering із переписуванням button.textContent — кандидат, а не доведений висновок. Діагностичне спостереження0.5px руху не пояснює дефект саме по собі. Потрібно відокремити продуктову причину від browser automation interaction і повторити visible сценарій; фізичний Safari failure ще не доведений. Докази: `diagnostic/attempt-2026-10-04T09-51-54-385Z/verification.json`, `webkit-diagnostic-command.json`. Diagnostic не зарахований як acceptance.

**DEVICE-08C — BLOCKED_DEVICE:** усі42 hardware cases без фактичних результатів. Старий checklist/source binding актуальний щодо кінцевого коду, але це не виконана перевірка. Продовжити `docs/EDUCATION_READY_08C_OPERATOR_CHECKLIST_UK.md` у bounded owned preview; після fixes потрібен новий source-bound device run, не заміна hash старого результату.

**HARNESS-01:** перший attendance run exit1: загальний pg_stat_activity Lock count4 замість2 включав advisory-lock waiters інших runner’ів. Червоний лог збережено: `attendance-2026-10-04T09-42-28-684Z.log`. Повтор **без queued runner’ів** довів3/3, exit0. Це harness limitation; майбутній fix — scoping через blocker PID/pg_blocking_pids, без послаблення two-operator assertions. Один додатковий retry був BLOCKED_CONFIGURATION через відсутній process-local TEST_DATABASE_URL; guard зупинив його до reset/start, evidence не зарахований (`attendance-2026-10-04T10-02-45-008Z.log`).

Повний bug report, очікування, reproduction і future verification: `output/education-ready/08/BUG_REPORTS.md`. Перед продуктовим редагуванням08 root cause не підміняли здогадкою; fixes у цьому acceptance не виконані.

## Фонові4xx/5xx і live boundary

`background-diagnostics.json` класифікує27 environment/method/path/status/role/business groups із28 нових browser network files, з counts selected command observations окремо від ранніх attempts. Node HTTP negatives залишаються в TAP logs, не названі background browser traffic.

- Pre-auth401: startup probes до verified login; production creator/Dar staff403 — `staff_not_migrated`, legacy business gate. Education teacher picker має окремий endpoint; global права не відкриті.
- Local director/creator event_genix education403: очікувана non-education/context isolation. Real409: teacher-slot/capacity conflicts, SQL unchanged/draft retained.
- Injected500/503: керовані loader/save/report/journal errors і read-only visual hold; відрізнені від Express/production faults. Local wallet503 — visual write hold, не product failure.
- Local creator/Dar Telegram threads500 — **LOCAL_CONFIG_GAP**: empty configured chat ID → BIGINT22P02. Null query успішний. `telegram-local-preflight.json`, `telegram-empty-chat-diagnostic.json` доводять причину незалежно від outbound hold. Telegram settings тут недоступні; глобальний integration fix поза scope.
- Local outbound/WS hold і «Перепідключення…» не є production failure і не доводять live synchronization. Production/external provider synchronization — **NOT RUN**.

Production interception встановлено до login: лише auth login/refresh/verify writes дозволені. Wallet daily-login POST заблоковано до відправлення, business cabinet/profile fingerprints незмінні, page errors0. Production direct/reload reports залишилися без rendered report/status, teacher directory має старий обмежений набір; це observation незадеплоєної бази, не PASS нового кандидата. Не робили seed або business writes у Дар/Park.

## Достовірність доказів і збереження даних

- `truth-verification.json`: evidence integrity PASS; mandatory command gates17 PASS /1 FAIL плюс окремий visual FAIL, physical BLOCKED_DEVICE і native NOT RUN. Ці gates не є кількістю journeys. Final candidate FAIL, conclusion NO-GO, **exit1**.
- `node output/education-ready/08/build-final-evidence.js` повторно перевіряє current source/harness hashes, source/harness/retained invariance під час кожного command, exit/status, відповідні fresh proof files, hardware blocking і occlusion FAIL. Final exit1 перевірено фактичним shell запуском.
- `node tests/tools/verify-education-ready-final.js` — strict GO gate, **exit1** на WebKit FAIL; не видає green acceptance. `verification-summary.json` фіксує rejection, а не проходження всіх внутрішніх gates.
-10 early command attempts зі зміною harness під час виконання відхилено, навіть якщо child exit0. Усі їхні логи/скриншоти збережені. Додаткові red harness debugging/configuration attempts не приховані; final index явно вибирає поточні докази.
- `personal-review.json`: особисто переглянуто всі515 нових оригіналів через27 contact sheets і додаткові full-size failures; SHA256 оригіналів незмінні. Raw layout PASS не перекриває виявлений visual FAIL.
- `preservation-final.json`: усі10 перевірених business-data tables у manual/device DB мають ті самі counts/full-row hashes до/після;39 bookings у кожній. Preflight/ownership/relationships збережені. Manual anchor2026-10-03, device anchor2026-10-04.
- Disposable public tables після cleanup:0. `listeners-final.json`: лише loopback3012 retained preview і55469 PostgreSQL;3013/3014 LAN device listeners відсутні.
- Retained preview: `http://127.0.0.1:3012/?businessContext=dar&educationSchedule=today&date=2026-10-03`. Приватні credentials не потрапили у докази/документи.

## Зміни08 і наступна дія

Harness: `tests/browser/education-ready-final-journey.js`, `tests/helpers/education-ready-final-browser-driver.js`, `tests/tools/run-education-ready-final.js`, `tests/tools/verify-education-ready-final.js`; stage08 routing у `tests/integration/run-education-ready-design.js`, fresh teacher/date captures у mobile matrix, окремий08 visual output. Нові diagnostic/review/preservation scripts і manifests — тільки `output/education-ready/08/`. Handoff оновлено; prior01–08C artifacts збережені. Dependencies/lockfile/version/auth/schema/protected manifest не змінено в08.

Рекомендована наступна дія: вузько закрити ACCEPT-01 та встановити причину ACCEPT-02, додати відповідні focused assertions, повторити потрібні final suites на нових source/harness hashes; далі операторський08C run на фізичних iPhone/iPad/Android і повторний combined acceptance. До цього реліз розділу не рекомендується.
