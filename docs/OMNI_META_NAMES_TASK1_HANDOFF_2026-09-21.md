# Meta conversation names — передача задачі 2

## Стан задачі 1

Реалізацію отримання імен для Facebook та Instagram завершено локально.
Push/deploy, production profile GET та записи production-даних у цій задачі
не виконувалися. Release bump відкладений до задачі 3.

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\omni-meta-profile-names`.
- Branch: `codex/omni-meta-profile-names`.
- Base: `593b75611f3bf8f2f250a18e0a15fa22dc28eb41` з актуального на старті
  `origin/codex/eventgenix-production`.
- Точний commit задачі 1 наведено у фінальному повідомленні; цей файл входить
  до того самого scoped commit. Для продовження перевір `git log -1` та `git status`.
- На старті live `/api/version` підтвердив `0.82.2`, branch
  `codex/eventgenix-production`, SHA `f2e4dac078838165cf96e0e28db2dd140337b473`.
- Upstream просунувся під час роботи. Перед інтеграцією/релізом повторно звірити
  upstream та live SHA; не переносити зміни dirty root у цю гілку.

Root checkout залишено без змін. Вихідна діагностика доступна за шляхом:
`C:\Users\Plotva\OneDrive\Документи\EventGenix\docs\OMNI_META_NAMES_DIAGNOSIS_2026-09-21.md`.
Її результати — історичні факти, а не поточний дозвіл на production-операції.

## Що реалізовано

- Instagram `getUserProfile(userId, fields, options)` через чинний Page-token
  Facebook Login механізм; типовий запит `name,username`.
- Facebook API збережено, включно з типовими fields та firstName/lastName aliases.
- Обидва адаптери вимагають явний business context, strict runtime resolution,
  Page token та Page ID; результат приймається лише за точного string profile ID.
- `enrichMetaConversation` обслуговує обидва канали. Старий
  `enrichFacebookConversation` лишився сумісним Facebook-only wrapper.
- Instagram використовує непорожнє ім'я, інакше username.
- Умовний UPDATE перевіряє conversation/business/channel/external ID та
  поточне порожнє/Unknown ім'я. Ручне перейменування не перезаписується.
- Повідомлення зберігається до lookup; hub не очікує завершення enrichment.
  Duplicate webhook не створює повідомлення або новий lookup.
- Збережено 3 секунди / 64 KiB для профілю, загальні 16 активних lookup,
  1 000 cooldown entries, 5 хвилин між завершеною спробою й наступною.
- Повернення enrichment лишається `{ id, businessContext }` або null.
  Чинне повідомлення про зміну оновлює список/заголовок без профілю в event payload.
- `100/33` тепер `PROFILE_OBJECT_UNAVAILABLE`, інші `100` —
  `PROFILE_REQUEST_INVALID`, а не автоматичне припущення про permissions.
  Повна таблиця кодів — у `docs/OMNI_FACEBOOK_PROFILE.md`.
- Мережеві Buffer chunks декодуються разом: кириличне ім'я більше не псується,
  коли UTF-8 символ розділений між частинами відповіді.

## Файли

- `services/omni-facebook.js`
- `services/omni-instagram.js`
- `services/omni-meta-profile-errors.js` — новий спільний класифікатор
- `services/omni-facebook-profile.js` — спільний enrichment і сумісний wrapper
- `services/omni-hub.js`
- `tests/omni-facebook-profile.test.js`
- `tests/omni-meta-profile-adapters.test.js` — нові adapter regressions
- `tests/omni-workspace-behavior.test.js`
- `package.json` — лише включення нового тесту в наявний explicit unit list
- `docs/OMNI_FACEBOOK_PROFILE.md`
- цей handoff

Залежності, lockfile, version markers, schema, auth, permissions, UI/API routes,
scheduler, токени та production settings не змінювалися.

## Виконана перевірка

Node `22.23.1`, npm `10.9.8`; `npm run check:runtime` — passed.

```text
node --test tests/omni-facebook-profile.test.js tests/omni-meta-profile-adapters.test.js tests/omni-workspace-behavior.test.js tests/omni-send-truth.test.js tests/omni-provider-lifecycle.test.js tests/omni-hardening.test.js
```

Фінальний результат: **195 tests, 195 pass, 0 fail, 0 skipped**.
Тести використовують заглушки Meta/DB. Перевірено нові й існуючі Unknown-чати,
IG username fallback, ID mismatch, порожні профілі, 100/33, timeouts, size limit,
UTF-8, isolation, cooldown/concurrency, ручне перейменування, duplicate inbound,
доставку та оновлення списку/відкритого заголовка зі збереженням чернетки.

- `npm run check:version` — passed, маркери не змінювалися.
- `npm run check:syntax` — passed для 1 288 JS-файлів; після фінального UTF-8
  та UI test change повторні `node --check` змінених файлів теж passed.
- `git diff --check` — passed.
- Незалежний review виявив UTF-8 chunk defect; його відтворено, виправлено й
  закріплено двома adapter regression tests.
- Початковий test runner зупинявся через sandbox `spawn EPERM`; остаточні тести
  виконано стандартним ізольованим Node runner з дозволом на локальний process spawn.
- Повний `npm test`, CI, deploy, browser live QA не виконувалися в задачі 1.

## Залишок для задачі 2

1. Старі Unknown без нового inbound автоматично не відновлюються. Потрібен
   операторський dry-run/apply у погодженому обсязі; нового endpoint/UI не додано.
2. Попередні три дозволені production profile GET вже використані до задачі 1:
   один Facebook дав first_name/last_name, Instagram — name/username,
   інший Facebook — HTTP 400 / code 100 / subcode 33.
3. Для недоступного Facebook-профілю спочатку read-only зіставити збережений
   webhook sender/recipient зі scoped conversation та Page. Не змінювати ID
   або токен навмання; поточна відповідь не встановлює конкретну причину.
4. Для визначення саме діагностованого набору використовувати точну ідентичність
   трьох чатів, business `event_genix`, channel та native DB timestamp як текст.
   `created_at` — timestamp without time zone, DB timezone Etc/UTC:
   - Facebook: `2026-09-20 15:12:32.92626` — профіль повернув 100/33;
   - Facebook: `2026-09-20 16:00:15.952587` — ім'я доступне;
   - Instagram: `2026-09-20 17:31:00.791277` — ім'я/username доступні.
   Ці мітки — для read-only звірки; перед apply закріпити точні internal IDs
   і повторно перевірити записи. Не підміняти це запитом LIMIT 3 або всі Unknown.
5. Task 2 має запускатися окремим повідомленням із власним bounded дозволом
   на нові profile GET. Цей handoff не дозволяє нових production дій.
6. Task 3 відповідає за release/versioning, exact-SHA CI, deploy та погоджене
   відновлення production-імен. Недоступність одного профілю не можна приховувати
   під твердженням про відновлення всіх трьох.
