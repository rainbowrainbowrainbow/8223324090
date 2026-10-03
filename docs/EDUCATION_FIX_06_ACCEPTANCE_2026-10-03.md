# EDU-FIX-06 — acceptance та реліз пакета

Production impact: yes. Робоче дерево: `C:/Users/Plotva/.codex/worktrees/education-qa-fixes/EventGenix`, гілка `codex/education-qa-fixes`. П'ять fixes збережені прямими предками merge commit `e663fee630d68c6c967880d2dc89fe1051098625`; другий батько merge — підтверджений production SHA `59d67e9916c0a6ce2f64fcafa08cc9e5ce0e5efc` (v0.82.56).

## Матриця acceptance

| Перевірка | Статус | Доказ |
| --- | --- | --- |
| F07: конкурентні create/create, create/edit, create/series одного викладача; інші бізнеси/викладачі, сусідні слоти, rollback серій | PASS | `output/edu-fix-06-acceptance-ui-7.log`: 13/13 базових PostgreSQL tests та 6/6 додаткових teacher-race пар із одним переможцем |
| F01: запізнілі groups/journal/report, A→B→A, draft і save | PASS | `output/edu-fix-06-education-context-browser.log`; context regressions у `npm test` |
| F02: direct URL, reload, back для п'яти вкладок; business/date handoff | PASS | `output/edu-fix-06-education-navigation-browser.log` |
| F03: пункт «Заняття» у default/custom menu Дар, відсутній у Park | PASS | той самий actual-app navigation smoke та Park acceptance |
| F04: подвійний клік і Enter при повільному POST дають один browser submit/SQL row; 403/409/500 зберігають draft і допускають retry | PASS | `output/edu-fix-06-education-group-submit-browser.log`, `output/edu-qa-01/synthetic-browser.json` |
| F05: канонічна Today/day/week картка, Escape, Tab/Shift+Tab, повернення фокусу й кнопка закриття | PASS | `output/edu-fix-06-education-modal-browser.log`; Park actual-app тест у розширеній suite |
| F06: dark/light, desktop 1440×900 та mobile 390×844, читабельні tabs без горизонтального overflow | PASS | modal browser smoke та 43/43 browser checks розширеної suite |
| Повний UI group→child→lesson create→edit→cancel | PASS | Розширена actual-app suite: форма, HTTP, канонічний detail і durable PostgreSQL state |
| Attendance: frozen roster, repeated marks, concurrent corrections/history, author/time | PASS | 11/11 розширених PostgreSQL tests та 13/13 базових; API/UI журнал |
| Report: period/group, held/cancelled/future/unmarked і незалежно пораховані totals | PASS | Очікування `held=1, present=1, absent=1, excused=1`, API/UI збігаються |
| Дати, teacher/cabinet/group filters, прямий маршрут і reload | PASS | 43/43 actual-app browser checks; Kyiv DST, місяць і рік у PostgreSQL tests |
| Creator та reader без `manage_settings` через UI/API; business isolation | PASS | Creator може підготувати незбережену зміну; reader save disabled або сторінка 403, PUT 403; business profile після UI незмінний |
| Park canonical detail і відсутність education entry | PASS | Synthetic Park booking із видимою лінією та каталогом кімнат; detail/Escape/focus return |
| Два незалежні API POST з однаковою назвою групи | PASS за чинним контрактом | 2 відповіді 201 і 2 SQL rows; окремий browser double-click regression вимагає 1 POST/1 row. API exactly-once не обіцяється. |
| Загальний локальний baseline Node22/npm10 | PASS | `output/edu-fix-06-npm-test.log`, exit 0 |
| Синтаксис фінального acceptance test/runner | PASS | `node --check` і `git diff --check`; повний `check:syntax` окремо |
| Exact release SHA CI | NOT RUN | Починається після version/changelog commit та push |
| Railway deploy, live version/SHA і read-only UI QA | NOT RUN | Лише після зеленого CI точного SHA |

Усі записи acceptance виконано лише в `127.0.0.1:55439/eventgenix_edu_disposable_test` через ізольований runner із підтвердженням reset. Runner очищає public schema після suite. Production write-QA, зміни бізнес-профілю/режиму Дар, schema, ролей, секретів і Railway settings не виконувалися.

## Production baseline до релізу

`GET /api/version`: v0.82.56, SHA `59d67e9916c0a6ce2f64fcafa08cc9e5ce0e5efc`, branch `codex/eventgenix-production`, complete manifest. Railway read-only: project `fortunate-appreciation`, environment `production`, service `8223324090`, domain `8223324090-production.up.railway.app`, deployment `b46d7c01-178c-4ff2-8e0f-24e4fb253cdf` SUCCESS. Read-only settings script: Creator login і GET cabinet 200; Дар `businessType=education`, `mode=education`, `resourceModel=cabinet`; projection до/після ідентична. Скрипт зафіксував фонові 401 на `/api/staff` і `/api/education/groups` та 403 на `/api/chat/unread`; жодного business write не було. Після релізу потрібен окремий read-only повторний прогін.
