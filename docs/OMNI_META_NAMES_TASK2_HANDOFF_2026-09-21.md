# Meta names: передача задачі 3

## Результат і межі

Задача 2 підготувала один операторський інструмент
`scripts/repair-omni-meta-names.js`. Production impact: yes — лише майбутній
`--apply`; у цій задачі production UPDATE не виконувалися.

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\omni-meta-profile-names`.
- Branch: `codex/omni-meta-profile-names`.
- Попередній commit задачі 1: `d93581289eb6c430ad1a2794897175e4429bb129`.
- Commit задачі 2 містить цей документ; точний SHA наведено у фінальному
  повідомленні. Перед продовженням звірити `git log -2` і `git status`.
- Гілка базується на `593b75611f3bf8f2f250a18e0a15fa22dc28eb41`.
  Відомий upstream уже просунувся; задача 3 має інтегрувати обидва scoped commits
  з актуальною production-гілкою та перевірити live SHA перед релізом.
- Root checkout та чужі зміни не редагувалися. Push/deploy, release bump,
  schema/auth/permissions, залежності, secrets/settings не змінювалися.

## Санітизований production dry-run

Новий дозвіл задачі 2: максимум 2 profile GET на чат, 6 загалом.
Використано **3 GET загалом, по 1 на кожен чат**. Автоматичних повторів не було.
Попередній дозвіл із діагностики не використовувався повторно.

| Слот | Канал | Результат | Записів |
| --- | --- | --- | --- |
| 1 | Facebook | `PROFILE_OBJECT_UNAVAILABLE` — Graph 100/33 | 0 |
| 2 | Facebook | `READY` — перевірене ім'я доступне | 0 |
| 3 | Instagram | `READY` — перевірене ім'я/username доступне | 0 |

План: **2 доступні імені, 1 недоступний профіль, 0 production UPDATE**.
Результат є знімком перевірки, а не гарантією майбутньої доступності Meta.
`apply` повторно запитує профіль; імена з dry-run не зберігаються й не приймаються
як вхідні дані для запису.

Перед GET виконано окремий `--inspect-only`: рівно три записи знайдено за
business `event_genix`, каналом і точним `created_at::text`. Час не проходив через
JavaScript Date або локальну timezone. Після звірки точні внутрішні ID,
external ID, native timestamps і налаштовані Page bindings закріплено хешем:

```text
be325834004b2e5fbce55c80cc52ddf865fa20c15487199708472eb15fd7b21f
```

Сирі ID не записувалися в документи/вивід; вони існували в пам'яті процесу.
Хеш зберігає точну ідентичність набору для наступного запуску. Зміна ID,
business/channel/timestamp/Page або неоднозначний збіг зупиняють інструмент
до profile GET/UPDATE. `LIMIT 2` у кожному точному SELECT — лише виявлення
неоднозначності, а не спосіб вибрати довільні чати.

## Недоступний Facebook-профіль

Для слота 1 перевірено два збережені inbound metadata records:

- webhook sender присутній і збігається з conversation external ID;
- recipient збігається з Page ID чинного Facebook connection;
- webhook message ID збігається зі збереженим external message ID;
- echo-ознаки немає.

Інший Facebook-чат через той самий business/channel connection успішно отримав
профіль. Повторний канонічний lookup слота 1 дав `PROFILE_OBJECT_UNAVAILABLE`,
який у класифікаторі означає Graph code 100 / subcode 33.

Доведено узгодженість збережених ідентифікаторів. Конкретну причину недоступності
об'єкта Meta не встановлено. Це не доказ загальної несправності токена,
нестачі конкретного permission або необхідності виправляти external ID.

Наступна адресна перевірка — за окремим дозволом read-only зіставити саме цей
діалог у Meta Business Suite з відповідною Page та перевірити доступність цього
scoped користувача для чинного застосунку. Не змінювати ID, токен або permissions
за припущенням; не перебирати інші ID чи токени. Два доступні імені можна готувати
до відновлення незалежно від цього профілю.

Для Instagram перевірено шість inbound metadata records: sender/message ID
узгоджені, echo немає, recipient присутній. Recipient відрізняється від configured
Page ID. Зв'язок Page ↔ Instagram recipient окремим Graph-запитом не перевірявся:
дозвіл охоплював лише profile GET. Канонічний Instagram lookup через чинний
Page-token connection повернув доступний профіль із точним requested ID.
Інструмент не прирівнює Instagram recipient до Facebook Page ID; він показує цю
відмінність у діагностиці та зберігає перевірки sender/message/business/connection.

## Як працює інструмент

- Без `--apply` режим завжди read-only. `--inspect-only` додатково вимикає GET.
- Обов'язкові business і точний scope: diagnostic cohort або `--scope-stdin`.
- Жорсткий ліміт 1–3 чати; `--limit` має дорівнювати кількості explicit targets.
  Diagnostic cohort дозволяє лише три зафіксовані записи `event_genix`.
- Один послідовний lookup на eligible чат за запуск, жодних retry/scheduler/queue.
  Канонічні adapter bounds: 3 секунди / 64 KiB.
- Канонічні `lookupMetaName` і `updateMetaName` спільні з inbound enrichment.
  Старі enrichment entry points, cooldown/dedup/concurrency залишилися сумісними.
- Provider config читається через той самий operator DB client із strict
  business/channel scope; app startup, migrations і фонові процеси не запускаються.
- Перед записом повторно читаються current name, identity, timestamps і connection.
  Умовний UPDATE додатково порівнює `created_at::text` і `updated_at::text` зі snapshot.
  Конкурентна зміна дає `CONCURRENT_CHANGE`; її не обходять повторною спробою.
- Змінюються тільки `customer_name` і `updated_at`; лише для порожнього/Unknown
  імені й перевіреного profile ID. Історія, external ID та customer links незмінні.
- Повторний apply пропускає вже задані імена без GET. Невдалий профіль не блокує
  наступні чати. Записи незалежні: при DB failure після часткового apply CLI
  повертає помилку з `partialApplyPossible`; звірити стан перед новим запуском.
- Звіт містить лише slots, channels, лічильники, allowlisted codes, булеві ознаки
  та scope hash. Тексти Meta/DB errors, повідомлення, імена й ID не виводяться.
- CLI не надсилає WebSocket events. Після майбутнього apply перевірити список
  і відкритий чат після звичайного оновлення сторінки.

## Точні команди для задачі 3

Запускати з цього worktree або інтегрованого release checkout на Node 22/npm 10.
Спочатку завантажити чинні connection secrets лише в пам'ять процесу:
`OMNI_CONNECTION_SECRET_KEY` або `JWT_SECRET`, та потрібні `FB_*`/`IG_*`
environment values чинних підключень. Не друкувати й не зберігати їх у файли.

Для read-only встановити process-local `PRODUCTION_READONLY_DATABASE_URL` із
чинного секретного джерела. Інструмент примусово використовує PostgreSQL
`default_transaction_read_only=on`, `BEGIN READ ONLY` та перевіряє цей режим.
`DATABASE_URL` ніколи не використовується як fallback.

Перевірка scope/provenance без profile GET:

```powershell
node scripts/repair-omni-meta-names.js --business-context event_genix --cohort diagnosis-2026-09-21 --limit 3 --expected-scope-digest be325834004b2e5fbce55c80cc52ddf865fa20c15487199708472eb15fd7b21f --inspect-only
```

Повторний dry-run — до трьох нових GET; запускати лише всередині відповідного
погодженого бюджету задачі 3:

```powershell
node scripts/repair-omni-meta-names.js --business-context event_genix --cohort diagnosis-2026-09-21 --limit 3 --expected-scope-digest be325834004b2e5fbce55c80cc52ddf865fa20c15487199708472eb15fd7b21f --dry-run
```

**Майбутній apply потребує явного дозволу задачі 3 на зміну імен саме цього
набору та нові profile GET. Дозвіл задачі 2 не дозволяє production-запис.**
Установити `META_NAMES_APPLY_DATABASE_URL` лише в пам'ять процесу з погодженого
джерела write connection. CLI не бере write URL із Railway автоматично й не
підвищує привілеї read-only підключення. Після exact-SHA CI/deploy та дозволу:

```powershell
node scripts/repair-omni-meta-names.js --business-context event_genix --cohort diagnosis-2026-09-21 --limit 3 --expected-scope-digest be325834004b2e5fbce55c80cc52ddf865fa20c15487199708472eb15fd7b21f --apply
```

Очікування за поточними даними: два `APPLIED`, один `PROFILE_OBJECT_UNAVAILABLE`.
Якщо ім'я вже задане, очікувати `NAME_ALREADY_SET`, а не перезаписувати його.
При `SCOPE_DIGEST_MISMATCH` зупинитися й розібрати зміну; не підставляти новий
хеш автоматично й не розширювати набір. Не виконувати автоматичний rollback
реальних імен: будь-яке коригування — окремий погоджений точний запис.

Для іншого явно погодженого bounded набору `--scope-stdin` приймає JSON-масив
із `channel`, string `conversationId` і точним string `createdAt`; жодних імен
або токенів. `--business-context`, `--limit` і apply digest обов'язкові.
Private selectors подавати через stdin з пам'яті, не через командний рядок/логи.
На цьому Windows host для stdin використовувати реальний Node executable,
бо `node.ps1` shim не передає stdin дочірньому процесу.

## Перевірка й змінені файли

Node `22.23.1`, npm `10.9.8`: `npm run check:runtime` passed.

```text
node --test tests/omni-meta-name-repair.test.js tests/omni-facebook-profile.test.js tests/omni-meta-profile-adapters.test.js tests/omni-workspace-behavior.test.js tests/omni-send-truth.test.js tests/omni-provider-lifecycle.test.js tests/omni-hardening.test.js
```

Результат: **217 tests, 217 pass, 0 fail, 0 skipped**; Meta і write-DB замінені
заглушками. Перевірено dry-run без UPDATE, apply/repeat guards, concurrent rename
до reread і перед UPDATE, ID/context/channel/Page/token drift, scope digest,
native timestamps, mismatch/empty profile, 100/33/timeout/exception, секрети у
виводі, strict readonly CLI та відсутність fallback на DATABASE_URL.

`npm run check:version` passed без зміни маркерів. `npm run check:syntax` passed
для 1 290 JS-файлів; `git diff --check` passed. Sandbox спочатку блокував дочірній
`node --check` через `spawnSync EPERM`; повтор із дозволом на локальний process
spawn успішний.
Повний `npm test`, CI, deploy і production apply у задачі 2 не виконувалися.

Файли:

- `scripts/repair-omni-meta-names.js` — новий CLI;
- `services/omni-facebook-profile.js` — спільні lookup/update без дублювання правил;
- `services/omni-facebook.js`, `services/omni-instagram.js` — передача strict ownership client;
- `tests/omni-meta-name-repair.test.js` — focused regressions;
- `package.json` — лише включення нового тесту в чинний unit list;
- `docs/OMNI_FACEBOOK_PROFILE.md` — документація операторського recovery;
- цей handoff.

Наступний крок: задача 3 — інтеграція з актуальною production-гілкою, scoped
release/versioning, exact-SHA CI, deploy і погоджене відновлення доступних імен.
Не подавати недоступний Facebook-профіль як виправлений.
