# EDU-CLOSE-06 — фінальний acceptance, 2026-10-08

**NO-GO / HOLD_ACCEPTANCE. Production impact: yes. Education-пакет не випущено.**

Пакет перевірено заново на актуальній production-базі:12із13 software gates PASS, WebKit journey FAIL. Доведеного завершення всіх перевірок немає. Для повного закриття залишаються два конкретні продуктово-дизайнерські рішення та фізичні пристрої. Commit/push/deploy не виконано: поточна задача дозволяє випуск лише після дозволеного GO. Загальне «працюють» не є42-case device evidence або окремим exact Red-рішенням.

## Поточний пакет

- Worktree: C:/Users/Plotva/.codex/worktrees/education-close-release-20261008-r5/EventGenix
- Branch: codex/education-close-release-20261008-r5
- Base SHA: 9667c381781e83f6a484f3718ad6c36a2ac07fc9; інтеграція відr4 без конфліктів, старі dirty checkouts/докази збережені.
- Candidate: 0.82.73, локальна невипущена версія; український changelog/cache markers підготовлені.
- Runtime: Node22.23.1 / npm10.9.8, check:runtime PASS.
- Source digest: 209168cbdaf5e7e73c93a470f609aff009bdad9a38ae8ec8b2f9cd657725e1de
- Harness digest: e83fecf583a33c87e99b6560baff9dbe804f5254fbc554ba280f7f090f6baf54
- Full source/harness inventory SHA256: c80cefd86dca352ae914ce6eada02cb19fc92fc5b31d7fc4235e97834d1e776a
- Freeze: 2026-10-08T09:57:54.378Z → 2026-10-08T10:23:38.584Z; inventory після13 gates повністю дорівнює початковому, включно з доданими файлами.

## Що працює та що змінено

1. routes/bookings.js: validated teacher ID/name зберігаються при підстановці groupName; ID — основна ідентичність конфліктів, name fallback лише для legacy безID. Два однойменні люди не ототожнюються, чужийID відхиляється; inactive/старі призначення збережені. Новий викладач/перше призначення доведені через UI. Existing-HR positive workflow залишається BLOCKED_DESIGN.
2. services/educationAttendance.js, routes/education-attendance.js, js/education-attendance.js: revision атомарно перевіряється під чинним lock без schema change; stale409 нічого не пише, локальний draft збережений, explicit refresh/reapply. Повтор застосованого однакового запиту не множить історію. Автор/час/correction перевірені SQL. Canonical/legacy reports/journal узгоджені; held визначається завершенням Europe/Kyiv, attendance totals включають held, linked group не підміняється текстом; після початку журналу date/linked group захищені.
3. services/customerChildren.js: PostgreSQL DATE локальної цивільної дати зберігається без UTC-зсуву. Continuous journey створює нового representative і нову дитину через Customers UI; entered2020-05-14 = API/SQL та visible14.05.2020. Seeded child не підставляється.
4. js/ui.js: mini-map loading/error/retry/memo, date/business generation та stale responses; js/timeline.js: education axis враховує ранні/пізні заняття з actual data. js/timeline-visibility.js і js/global-task-timer.js: optional read scope/promise/page lifecycle; endpoint/auth/write контракт не змінено.
5. css/education-schedule.css та чинні education forms: compact tabs/filters, visible date/duration/українські labels, narrow cabinet width104px education-only, WebKit viewport cap. Title/subtitle не стискаються нижче рядка, час має один рядок. Mandatory title geometry oracle додано після реального FAIL4–8px замість14.16px; focused baseline exit1 та scoped after PASS збережені вr4.
6. tests/browser/education-close-journey-browser.js: navigation чекає реально hydrated timer, loading=false/pending=false; стан записується в runtimeReadSettles. networkidle/mainApp/auth-ready самі не доводили завершення lazy bootstrap. Pageerror gate суворий, API repair немає. Focused WebKit PASS не підставлено замість нової матриці: у ній WebKit знову FAIL, цього разу visibility-loader. Є15PASS,1FAIL та1BLOCKED_DEPENDENCY; raw failed proof/log/attempt hashes прив’язані selected-matrix-result.json.
7. Validator/CI: source/harness inventory рівний повністю, required IDs/count/skips/BLOCKED/attempt/proof/log hashes перевіряються fail-closed.13education suites додано у чинний Linux disposablePG/browser CI pattern, без production credentials/calls/CI settings/secrets/permissions changes.

## Свіжа матриця final-r5

| Gate | Результат | Внутрішні перевірки | Класифікація |
|---|---|---:|---|
| teachers/chromium | PASS | 26 | MIXED_VISIBLE_UI_API_SQL |
| groups/chromium | PASS | 15 | MIXED_VISIBLE_UI_API_SQL |
| lifecycle/chromium | PASS | 12 | MIXED_VISIBLE_UI_API_SQL |
| date/chromium | PASS | 13 | MIXED_VISIBLE_UI_API_SQL |
| async/chromium | PASS | 18 | MIXED_VISIBLE_UI_API_SQL_BARRIERS |
| journal/chromium | PASS | 6 | VISIBLE_UI_API_SQL_TWO_OPERATORS |
| attendance/chromium | PASS | 7 | HTTP_POSTGRESQL |
| series/chromium | PASS | 17 | HTTP_POSTGRESQL |
| acceptance/chromium | PASS | 11 | MIXED_COMPONENT_API_SQL_BROWSER_MOCK |
| journey/chromium | PASS | 17 | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY |
| journey/webkit | FAIL_OR_BLOCKED | 17 | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY |
| responsive/chromium | PASS | 1055 | SYNTHETIC_BROWSER_EMULATION_UI_WRITES |
| responsive/webkit | PASS | 1055 | SYNTHETIC_BROWSER_EMULATION_UI_WRITES |

Це13 software gates, а не13 однаково наскрізних сценаріїв. Journey Chromium — один completed continuous visible UI scenario,17assertions PASS. Journey WebKit — такий самий required scenario,15PASS/1FAIL/1BLOCKED_DEPENDENCY;16виконаних checks,17required. Він не completedPASS. Teachers/groups/lifecycle/date/async є mixedUI/API/SQL, attendance/series — HTTP+PostgreSQL, acceptance містить явно позначені component/mock перевірки.1055 responsive probes на engine — DOM/геометрія/стилі, а не1055 journeys. Duration permutations30/45/60/90 доведені окремим lifecycle suite. Physical emulation не підміняє фізичний пристрій.

Матриця: output/education-ready/close06-followup-20261008/final-r5/matrix-final.json та matrix-validation.json. PASS records містять full inventories, exact attempt, required IDs, completion marker та proof/log hashes. Failed runner record має null proof pointer; raw17-case verification.json незалежно прив’язано до його exact attempt/source/log у selected-matrix-result.json, оригінальний record не змінено. Strict matrix validator повернув exit1. npm test: exit0/sourceStable=true, 2026-10-08T09:54:48.628Z → 2026-10-08T10:04:02.806Z; logSHA256 3cf428d8fb1401adff3896292eca3ac368476be51e523cec7620c6781a834d26.31 negative component/guard checks PASS, skips0;22evidence +9DB safety. General npm counts не називаються education journeys.

## WebKit FAIL — поточний відкритий blocker

Selected attempt: final-r5/final-matrix/attempt-2026-10-08T10-12-30-349Z-journey-webkit-b5ee98. no-page-errors FAIL на same-origin /api/settings/timeline-visibility?businessContext=dar; останній birthday check BLOCKED_DEPENDENCY. Бізнес-кроки до gate пройшли, але весь journey неPASS. Не визначено, чи це native navigation transport diagnostic, чи дефект loader, тому він лишається release blocker; це не доведений production failure.

Первинний installed Playwright WebKit source перетворює javascript console-error у pageerror; отже назва event не є самостійним доказом uncaught exception. Controlled loopback read/navigation і beforeunload diagnostics не відтворили pageerror. Transparent actual-app observer отримав89fetch responses, error/unhandledrejection0,17checksPASS; цей timing-sensitive diagnostic також не відтворив збій і НЕ замінює FAIL final source. Не додано blanket exemption, force/API repair чи guessed keepalive product fix. Наступна перевірка має керовано відтворити failing phase з exception/fetch/navigation telemetry і довести narrow fix або точну класифікацію; лише потім свіжа mandatory matrix.

## Візуал і доступність

| Engine | Profiles | Probes | Мін. звичайний текст | Мін. великий текст | Мін. межі input |
|---|---:|---:|---:|---:|---:|
| chromium | 7 | 1055 | 4.68 | 3.48 | 3.08 |
| webkit | 7 | 1055 | 4.68 | 3.48 | 3.08 |

Контраст виміряно за computed CSS:4.5для звичайного тексту/3для великого/3для input boundaries. Є nonempty control inventory, focus/touch/reflow/light-dark checks. Samples охоплюють workspace/forms/modals/settings/line headers; це не повний WCAG certificate і не physical acceptance. Особисто переглянуті actual before/after та final кадри перелічено в visual-review-final.json, screenshot hashes збережені. Generic card duplication/menu0 залишаються видимим відкритим дефектом, не прихованим PASS.

Physical42 cases — BLOCKED_DEVICE/0PASS; немає model/OS/browser/per-case action/actual/evidence/native keyboard/pickers/VoiceOver/TalkBack. Current preview не підготовлено: старий fixed eventgenix_education_close_devices належить retained іншій сесії, його не reseed/reuse; потрібен окремий owned current preview та оператор. Anchor2026-10-08 у checklist є planned, не fabricated prepared manifest. LAN3015/3016 не відкривався.

## Production / CI / delivery

На 2026-10-08T10:31:32.1984556Z: live0.82.72/9667c381781e83f6a484f3718ad6c36a2ac07fc9/codex/eventgenix-production; remote9667c381781e83f6a484f3718ad6c36a2ac07fc9; baseCurrent=true, convergence=true. Fresh read-only smoke: READONLY_OBSERVATION_COMPLETE, pageerrors0/failedChecks0,5educationtabs/visible schedule/nonempty styled controls/canonical card/Park.32outbound hold,2business write hold,2expected legacy-staff403; кожна причина/роль/бізнес/вплив класифіковані у JSON. Writes blocked до login; локальний outbound hold не production failure і не synchronization PASS. Це pre-release smoke вже deployed0.82.72, не кандидата0.82.73.

Base CI:8/8success для9667c381…; CI URL у base-ci-current-readonly.json. Старийf87 fixture relation trusted_qa_run_entities missing закрито production-base commit128815411; історичний FAIL збережений. Candidate exact-SHA CI NOT RUN, немає release commit. Railway read-only target-current.json підтверджує fortunate-appreciation/production/8223324090 і поточнийSUCCESSdeployment; CLI configured Git branch не exposed. Exact deployed branch/SHA з valid /api/version manifest не є доказом configured Git source settings; перед delivery повторна перевірка обов'язкова. Settings/secrets/auto-deploy policy не змінено.

Product/generated commits NOT RUN, push/deploy/post-release QA NOT RUN черезNO-GO. Release proof — HOLD, не delivered PASS. Rollback reference current live9667c381781e83f6a484f3718ad6c36a2ac07fc9; старий non-destructive rollback branch збережений. Expired Yellow envelope не поновлювався автоматично; release attempts0.

## Відкриті blockers

- WEBKIT_JOURNEY: FAIL — unclassified native optional-read pageerror; no-page-errors FAIL, dependent birthday assertion BLOCKED; diagnostic PASS cannot replace selected attempt
- EDU-CARD-PRESENTATION: FAIL_OPEN_PROTECTED_PRESENTATION — duplicate generic rows / empty menu0; exact protected-block approval missing
- EDU-HR-LINK: BLOCKED_DESIGN — no trustworthy ownership for existing global HR staff; exact manager-assignment policy decision missing
- PHYSICAL_DEVICE: BLOCKED_DEVICE — 42 cases, 0 PASS; no operator/device evidence or explicit owner deferral

Конкретні reviewable proposals: output/education-ready/close06-followup-20261008/protected-presentation-proposal.md, hr-membership-proposal.md та OWNER_DECISIONS_UK.md. Card: лише booking-detail-safe-open + необхідний protected hash/focused regression, зберігши notes/representative/actions/nonempty paid data/Park. HR: explicit manager existingstaffID assignment під hr.staff.manage AND education write, чинна membership/audit, без duplicate staff/schema/backfill/globalroles/legacy staff access для educator. Потрібне конкретне рішення цієї ownership policy до реалізації.

Чинний AGENTS.md вимагає: «Red - always require separate explicit approval»; «Stop with an exact blocker before a Red action, even when a Yellow envelope exists». Auto-review не відхиляв дій; ці blockers походять із repository rule і відсутньої фактичної device session. Owner deferral не отриманий; непроведені сценарії не сталиPASS.

## Збереження доказів і даних

Три retained DB мають по39bookings; усі table fingerprints збігаються з первиннимbaseline. Disposable public tables0 після runner cleanup. 2566 історичних артефактів незмінні; лише відомий старий runtime postgres-resume.log має575-byte append crash/shutdown7жовтня. Exact original prefix hash доведений; immutable test proofs не переписано. Main checkout diff змінився під час перерви за незмінного dirtylist: зовнішня/невідома причина, без reset/revert/overwrite. З resumed checkpoint старі4 checkouts стабільні; r2/r3 frozen inventories і окремо r4 full source/diff/status збережені. СтаріFAIL/stale/12-of13 матриці залишені history, не використані як currentPASS.

## Наступний крок

Закрити WebKit loader/harness instability керованим відтворенням та fresh regression, погодити конкретні EDU-CARD-PRESENTATION та EDU-HR-LINK blocks, провести фактичну42-case device session на окремому owned final preview. Після scoped fixes — нова final source/harness-bound acceptance. При дозволеномуGO: свіжіlive/remote/Railway/version guards і чинний bounded envelope; separate product/version commits→push confirmed production branch→all required exact-SHA greenCI→helper explicit project/branch deploy→fresh read-only Dar/Park proof. До цьогоreleaseHOLD.
