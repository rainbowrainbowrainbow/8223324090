# EDU-READY-02 — реалістичний локальний навчальний центр

Набір підготовлено в worktree `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`, branch `codex/education-ready-pack-20261003`, base SHA `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`. Це локальні вигадані дані, без копіювання production. Продуктові файли, схема, auth/roles, package/lock, версія та protected manifests не змінювалися. Commit/push/deploy не виконувалися.

## Preview та збереження

- Адреса: [локальний навчальний центр](http://127.0.0.1:3012/?businessContext=dar&educationSchedule=today&date=2026-10-03).
- Увійди приватним тестовим акаунтом, переданим через дозволений локальний secrets-файл. Значення логіна/пароля не записано в цей документ або artifacts; bootstrap зберігає тільки звичайний password hash у власній БД.
- Manual DB: `eventgenix_education_ready_manual`; host `127.0.0.1`, PostgreSQL port `55469`.
- Automated DB: `eventgenix_education_ready_fixture_test`, на тому самому власному кластері.
- Ручна БД має назву без `test/ci/disposable`. Чинний reset guard відхиляє її; це окремо перевірено тестом.
- Datadir: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix/output/education-ready/02/postgres-data`.
- Preview і PostgreSQL слухають лише loopback. Через телефон у локальній мережі ця адреса недоступна; пристрої залишаються в scope EDU-READY-07.

Назви ключів `dar`, `maysternya_doli`, `event_genix` використовуються лише як чинні локальні partitions цього застосунку. Sidebar показує штатні назви Дар/МД/Парк. Це не доступ до production бізнесів. Нова організація, membership чи роль не створювалися.

## Склад набору

| Об'єкти | Основний центр, local `dar` | Контрольні partitions |
|---|---:|---|
| Активні викладачі | 4 | Staff глобальний у чинній схемі; окремого ownership за бізнесом немає |
| Групи | 6 | 1 навчальна група в `maysternya_doli`; 0 у non-education `event_genix` |
| Діти | 24 | 2 у другому центрі, з тими самими іменами, але іншими IDs |
| Представники | 12 | 1 у другому центрі; 1 для контрольної сімейної події |
| Кабінети | 3 | 1 у другому центрі |
| Навчальні заняття | 36 | 2 у другому центрі |
| Інші bookings | 0 | 1 non-education подія без `educationLesson` |
| Stored attendance rows | 78 | 2 у другому центрі |
| History events | 61 | 2 у другому центрі |

Викладачі: Олена Ковальчук — англійська; Максим Левченко — робототехніка; Ірина Бондар — творчість; Софія Мельник — підготовка до школи.

Групи:

1. «Англійська: Перші слова» — повна, 6/6 на anchor date. Теми: «Знайомимося англійською», «Моя сім’я», «Слова ввічливості».
2. «Юні винахідники» — 6/8. Теми: «Будуємо світлофор», «Робот-помічник», «Місто майбутнього».
3. «Творча майстерня: об’ємні композиції та історії, які діти створюють власноруч» — 6/8. Довга українська назва та тема «Аплікація з природних матеріалів: об’ємна композиція «Осіннє місто»».
4. «Готуємося до школи» — 6/8. Теми: «Лічба та геометричні фігури», «Уважність і пам’ять», «Читаємо короткі слова».
5. «Розмовний клуб: перші кроки до впевненого спілкування» — порожня, 0/6.
6. «Літня творча майстерня» — архівна; історичний склад і чотири минулі уроки збережені, поточна зайнятість 0/8.

Є повторне ім'я «Софія» у різних представників, апострофи різних написань, по двоє дітей кожного основного представника. Марта Романюк завершила членство в англійській групі за 10 днів до anchor; наступного дня її місце зайняла Софія з іншої родини. Старий frozen journal містить Марту, новий — Софію. Дитина може відвідувати дві різні групи; це не дубль customer-child record.

Три кабінети: мовний «Веселка», лабораторія «Винахідник», творчий простір «Палітра». Уроки мають 30/45/60/90 хвилин; є чотири weekly series по три occurrences, чотири скасування, усі attendance statuses, null marks і журнали, які ще не відкривали. Одна історія має послідовність `null → absent → present` із двома вигаданими авторами.

History — валідна SQL fixture, прочитана через реальний API та UI. Це не доказ двох автентифікованих операторів, які справді зробили ці записи; такий сценарій залишається для задач05/08.

## Дати та незалежні очікування

`demo` бере дату першого завантаження через `Intl` у `Europe/Kyiv`; поточний manifest має anchor **2026-10-03**. Повторний запуск зберігає цей anchor і ручні правки, не пересуває історію автоматично. Для запланованого оновлення demo dates потрібен окремий контрольований rollover; цей seed нічого не видаляє.

`fixed` завжди має anchor **2026-10-03**. Unit перевірки включають зимовий/літній UTC offset та перехід через місцеву північ. Full-period service contract використовує явний Kyiv noon. У HTTP/UI прогонах системний годинник не підміняється: історичний HTTP report перевіряється за минулий період, а fixed-noon service proof позначено окремим рівнем.

Незалежний історичний період: **2026-08-04 — 2026-10-02**.

| Підсумок | Очікування |
|---|---:|
| Проведено | 18 |
| Скасовано | 2 |
| Заплановано | 0 |
| Журналів ще немає | 5 |
| Присутні | 38 |
| Відсутні | 13 |
| Поважна причина | 9 |
| Не відмічено | 18 |

Oracle формується зі специфікації набору до читання продуктового report. Окремий SQL aggregate перевіряє ті самі значення. Manifest містить per-group, second-business, non-education та full-period fixed-noon очікування. Скасовані/майбутні уроки не додають attendance totals; нерозпочаті журнали рахуються окремо від збережених null marks.

## Preflight, ownership та повторність

Seed вимагає exact database allowlist, port55469, loopback, explicit local confirmation та відсутність production/Railway/DB URLs у child environment. Власний кластер і створені ним БД мають файлові ownership markers; сам набір має marker у чинній `settings` таблиці. Нової схеми немає.

Preflight перевіряє IDs, кількості, назви, teacher assignments, контексти представників/дітей, FK-зв'язки, membership dates, status/duration/title занять, відмітки, контрольні totals і відсутність reachable contact channels. Виявлена невідповідність завершує перевірку з FAIL; повторний seed не ремонтує її й не перезаписує ручні правки.

Чинні `db/index.js` та історичні migrations створюють 97 staff rows і один contractor у порожній локальній БД. Fixture визнає лише цей точний source-generated набір: перейменовує staff у архівні локальні записи, деактивує їх і прибирає контактні канали; contractor теж стає вигаданим без контактів. Нічого не видаляється. Залишається **4 активні synthetic teachers**, а не 4 загальні staff rows. Якщо startup inventory зміниться, guard зупинить seed для перевірки, замість приймати невідомі дані.

Прогін через чинний disposable runner доводить: після його cleanup public tables у automated DB дорівнюють0, а manual manifest, owned39 bookings та повний незалежний preflight збігаються до/після. Кластери55439/55449/55459 інших задач не запускалися й не зупинялися.

## Запуск і зупинка

Виконуй у цьому worktree на Node22/npm10. Наявні PostgreSQL binaries і cached Playwright використовуються без додавання dependencies або lockfile edits.

```powershell
Set-Location -LiteralPath 'C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix'
npm run check:runtime
. 'C:/Users/Plotva/.eventgenix/codex-crm-secrets.ps1'
node scripts/start-education-ready-preview.js
```

Launcher підхоплює приватні process-local credentials з `EDU_READY_USERNAME/EDU_READY_PASSWORD` або чинних `LIVE_CREATOR_*`/`LIVE_SMOKE_*`. Їх не слід копіювати в repo чи чат. Він не змінює вже наявний пароль користувача. Якщо порт3012 зайнятий, launcher відмовляє, не завершує невідомий процес.

Terminal `Ctrl+C` зупиняє app. Для перевіреної зупинки з іншого terminal:

```powershell
./scripts/stop-education-ready-preview.ps1
# Optional: stop only the owned PostgreSQL too; retained data is not deleted.
./scripts/stop-education-ready-preview.ps1 -StopPostgres
```

Stop helper перевіряє owner, exact worktree, command line, PID та listener. Перезапуск launcher повторно відкриває той самий ручний набір.

Якщо після ручного тесту змінено зареєстровані назви, status, duration або склад, strict preflight зупинить повторний launcher. Дані залишаться в БД; seed не відновлюватиме їх автоматично. Перевір зміни перед наступним запуском, не запускай disposable cleanup на manual DB.

Automated прогін потребує process-local `TEST_DATABASE_URL` саме для `eventgenix_education_ready_fixture_test` на127.0.0.1:55469, `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE` та `EDU_QA_PLAYWRIGHT`, що вказує на наявний cached Playwright.

```powershell
node --test tests/education-ready-dataset.test.js tests/education-ready-results.test.js
node tests/integration/run-education-ready-dataset.js
```

Не передавай manual DB до будь-якого reset runner. Новий dataset wrapper додатково вимагає точне automated ім'я. Expected exit1 до виправлення UI є чесним результатом, не причиною обходити assertions.

## Докази та обмеження

Evidence root: `output/education-ready/02/`. `demo-manifest.json`, `demo-preflight.json`, `preview.json`, `cluster-owner.json`, `database-owner.json` — ручний набір; `demo/verification.json` і `fixed/verification.json` — окремі рівні proof. `attempt-*` зберігають snapshots. Початковий помилковий series assertion збережено в `attempt-initial-series-assertion`: API правильно виключав cancelled occurrence; тест уточнено до `includeCancelled=true` плюс окремого active-only assertion.

Два UI дефекти лишаються FAIL: Dar teacher selector не отримує чотирьох наявних викладачів; direct Reports не відображає summary. Visible «Показати» відображає правильні історичні totals. Жодний UI failure не ремонтується API/SQL записом. Візуальні native buttons залишаються для задач06.

Кожен фінальний dataset suite має 14 checks: 12 PASS / 2 FAIL, exit1. Окремі PASS охоплюють fixture/preflight, повторність, HTTP reports, fixed-clock service contract, frozen/history API, isolation, series, Today, groups, видимий journal, visible report action і відсутність unhandled page errors. Це 14 перевірок змішаного рівня, не 14 повних lifecycle scenarios. Targeted unit/contracts: 30/30 PASS, з них нові dataset self-tests5. Повний parser прогін охопив1410 JS files; пізніше доданий verifier і уточнені діагностичні файли додатково перевірено через `node --check`. Protected surface і diff check — PASS. Загальний npm test у задачі02 не повторювався; CI не запускалася.

DB-startup surface guard та6 його contract tests, scheduler surface guard і PowerShell parser stop helper також PASS. Sandbox `spawn EPERM` у першому DB-startup contract запуску був environment failure; дозволений повтор пройшов. Dataset evidence verifier має7/7 PASS, перевіряє червоні UI verdicts та незалежний retained preflight, не оголошує продукт готовим.

Один проміжний manual attempt мав Today readiness timeout, а попередні й наступний діагностичний прогони показували4 cards. Failure залишено в attempt snapshot та `demo-final.log`; причина спорадичного збою не доведена й не вважається виправленою. Додано selected-date assertion і UI/SQL failure snapshot; область Today/races лишається для задач05/08.

Шість screenshot types відкрито й переглянуто: Today, full group, archive group, journal history, failed direct report, правильний historical report. Це desktop evidence; вони не доводять фізичні пристрої чи всі рядки довгої таблиці, які поза viewport.

Preview працює з чинним `BACKUP_OUTBOUND_HOLD`: зовнішні інтеграції та background jobs вимкнені, а цей ранній return також пропускає WebSocket initialization. Тому банер «Перепідключення…» є обмеженням локального preview, не production connectivity finding. Live-sync, real second-operator flow, phone/tablet/iPhone та повний create/edit/cancel UI lifecycle тут не зараховуються як PASS.

Production не запитувалася і не наповнювалася. Primary main checkout і вихідні EDU-READY-01 докази не змінювалися. Наступна задача — EDU-READY-03 у цьому самому worktree.
