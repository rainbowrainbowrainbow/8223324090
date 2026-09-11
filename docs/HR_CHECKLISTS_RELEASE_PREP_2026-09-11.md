# HR Checklists: кандидат і залишок доставки

Production impact: no для виконаної локальної підготовки; yes для майбутнього deploy.

## Кандидат

- Гілка: `codex/hr-checklists-release-20260911`.
- Worktree: `.codex-temp/hr-checklists-release-20260911`.
- База: `58c899de7ed1f856000760ba53c8e2dce9389c24`, v0.81.102.
- HR implementation: `3d26584a636d9ed1e302a86a48d20f9445b729fa` (cherry-pick `adbc120ccafcbd3c13ba9e1f18484e7acbb1e22d`, без конфліктів).
- Shared checkout і чужі worktrees не змінені. Нових migrations, dependencies, auth/role grants, API endpoints або settings у diff немає.
- CI workflow включений після точного дозволу «Дозволяю блок HR-CHK-CI-01»: окремий коміт `8a2e13291e93f4bf8635dcfed7e6b2ea37b57e35`, один файл, рівно 29 доданих рядків. Копія погодженого diff для review — `output/hr-checklists-quality/ci-proposal.patch`.
- Version/cache/changelog commit ще не створений: штатний production controller робить bump у дозволеному release-блоці. Не робити подвійний bump.

## Повторна перевірка саме на базі v0.81.102

| Перевірка | Результат | Доказ у release-копії |
|---|---|---|
| Node/npm | 22.23.1 / 10.9.8 | `output/hr-checklists-postgres-runtime/release-postgres.log` |
| `npm test` | PASS, 2647 основних + 334 My Day + 1312 UI; ownership/runtime/version/syntax/migrations gates PASS | `output/hr-checklists-quality/release-npm-test.log` |
| Checklist service | PASS 10/10 | `output/hr-checklists-quality/release-unit.log` |
| Browser interaction | PASS 52/52, defects=0 | `output/hr-checklists-quality/async/results.json` |
| Themes, shell, responsive | PASS, light/dark | `output/playwright/hr-checklists/after-shell/results.json` |
| Native zoom | PASS, 100/125/150/200%, light/dark | `output/playwright/hr-checklists/after-shell-zoom/results.json` |
| Actual app → PostgreSQL 16.15 | PASS, findings/apiFailures/pageErrors порожні | `output/playwright/hr-checklists/postgres/results.json` |
| Diff | `git diff --check` PASS | `output/hr-checklists-quality/release-evidence.json` |
| CI wiring після HR-CHK-CI-01 | PyYAML parse PASS; чотири нові steps, existing workflow незмінний, scripts/artifacts існують, test DB target збережений | `output/hr-checklists-quality/ci-validation.json` |

PostgreSQL прогін перевірив реальні HR edit/add/reorder/archive, staff card → Training/readiness, notes між HR/Training/alias і явне очищення, history/reload, filters, readonly та rejected writes, 201 synthetic assignments і обидві сторінки, archived/orphaned department search. БД нова, loopback, без production copy; outbound hold активний; PostgreSQL зупинено з exit 0.

Переглянуті screenshots: `output/playwright/hr-checklists/postgres/page-201-dark.png` та `page-201-light.png`. Вони містять лише synthetic QA записи. Runtime SHA під час тестів був `3d26584a6`; подальші зміни цього кандидата — лише документація й погоджений CI workflow.

## Доставка та зовнішня залежність

Read-only перевірка 2026-09-11 близько 09:13 UTC: live v0.81.101, SHA `cc85e3c3f4e4cc9bf4d8b06979d30efa7be755e3`, source branch `codex/eventgenix-production`. Remote production HEAD уже `58c899de7`, його CI [34582389809](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/34582389809) ще виконував останній HR/payroll job; інші п'ять jobs PASS. Це зовнішній реліз продуктів, не HR-публікація цієї задачі.

Оновлення під час виконання HR-CHK-CI-01: CI бази `58c899de7` завершився з conclusion=success. Live при повторній read-only перевірці ще v0.81.101 / `cc85e3c3f`; HR push/deploy не виконано. Це успіх CI базового релізу, не нових HR steps.

Railway read-only target підтверджений: project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production`, service `8223324090`, domain `8223324090-production.up.railway.app`. Source branch підтверджений `/api/version`; Railway source.repo=null через manual upload, налаштування не змінювались.

Не формувати дозвіл на HR-реліз із чужими ще не опублікованими продуктовими змінами. Після завершення базового релізу повторно прочитати live/origin SHA, перевірити ancestry і лише тоді створити актуальний manifest. Попередній дозвіл на старий HR-реліз не переноситься автоматично: runbook завершує envelope після виконання задачі або через 6 годин. Push, HR remote CI, merge у production і deploy цього кандидата NOT_RUN.

## Практичні залишкові задачі

### CHK-R05 · Підключити перевірки до CI — IMPLEMENTED LOCAL / REMOTE PENDING

Goal: запускати вже перевірені HR browser/DB тести в чинних jobs.

Scope: тільки 29 доданих рядків `.github/workflows/ci.yml`: theme/quality у HR Team, actual PostgreSQL у чинному disposable My Day DB job, uploads screenshots/results. Без settings, secrets, permissions або нового service.

Виконано: точний дозвіл отримано; diff перенесено, перевірено і зафіксовано окремим комітом. Залишилося запустити CI на точному SHA в дозволеному release-блоці. Штатний production controller відхиляє workflow paths; classifier не змінено. Перед доставкою потрібно врахувати зафіксований Red-дозвіл і звірити маршрут із runbook.

Done when: нові HR steps і uploads PASS на точному release SHA. Live-site QA: не потрібна для workflow самого по собі, входить у CHK-R06. Notes/Risks: більше часу CI; локальна перевірка структури не є виконанням GitHub Actions. Повний npm/browser/DB baseline повторно не запускався після CI-only зміни: runtime і тести незмінні від перевіреного SHA.

### CHK-R06 · Опублікувати перевірений HR-кандидат — PENDING

Goal: доставити виправлення без змішування з незавершеним зовнішнім релізом.

Scope: поточний HR diff, окремий version/cache/changelog commit, canonical production branch/service.

Steps: підтвердити завершену live-базу; перевірити свіжі diffs/міграції/конфлікти; підготувати manifest і rollback SHA; отримати один чинний Yellow envelope; commit/version → push → exact-SHA CI → manual helper deploy → version/assets proof.

Done when: CI PASS і live SHA/branch/version збігаються, HR smoke PASS. Live-site QA: теми, checklist filters, staff card/readiness, клавіатура та readonly UI без мутації реальних записів; write-сценарії вже пройшли локально. Notes/Risks: shared confirm впливає на інші споживачі; не створювати staff/assignments у production без окремого дозволеного QA scope.

### CHK-R04 · Ручна доступність — PENDING

Goal: підтвердити UX у screen reader і додаткових browser engines.

Scope: NVDA/VoiceOver, Firefox/Safari, shared confirm consumers.

Steps: перевірити озвучення заголовка/помилок/busy, Tab/Shift+Tab, Escape лише верхнього діалогу, повернення focus, disabled controls та zoom. Done when: є результати по кожній комбінації або точний список недоступних середовищ. Live-site QA: тільки test account/read-only або локальні fixtures. Notes/Risks: Chromium automation не є доказом screen-reader UX.

### SYS-R01 · Wallet — BLOCKED / поза HR

Goal: окремо виправити daily-login INSERT без обов'язкового username, помічений у локальному login.

Scope: спершу окрема авторизована задача з відтворенням writer/schema contract; без змін балансів і real records у HR-релізі.

Steps: отримати точний дозвіл на protected Wallet напрям; підтвердити root cause й мінімальне рішення; ізольований regression test. Done when: login не створює помилку, контракт і баланси збережені. Live-site QA: визначити в окремій задачі після локального доказу. Notes/Risks: Wallet/payments/schema межі; у цьому HR-кандидаті не змінено.

Інші неперевірені межі: screen-reader/додаткові engines, усі permission combinations, literal `%`/`_`, усі inactive/freelance/reserve набори та production load. Старі втрачені notes не відновлено; drafts не переживають reload; offset pagination може зміщуватися під час зовнішніх concurrent змін.
