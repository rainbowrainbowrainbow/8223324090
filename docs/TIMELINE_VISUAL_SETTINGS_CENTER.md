# Timeline Visual Settings Center

Документ описує v1-правила для налаштувань візуального шару таймлайнів. Це не змінює бізнес-логіку бронювань, ролі, API, DB schema, міграції, env або deploy config.

## Scope

- `timeline:event_genix` - основний Event Genix / парк.
- `timeline:dar` - бізнес-контекст DAR.
- `timeline:maysternya_doli` - бізнес-контекст Майстерня долі.
- Нові бізнес-контексти отримують `timeline:<businessContext>` автоматично.

Налаштування зберігаються per business/timeline у наявному settings key `timeline_visibility:<context>`. Дані не є персональними для конкретного користувача.

## Змінні v1

- `visible` - ховає або показує тільки visual block. Не відкриває доступ до permission-hidden контролів і не блокує серверні права.
- `order` - змінює порядок блоку в межах його зони. Використовуйте невеликі кроки, щоб не змішувати unrelated controls.
- `density` - керує відступами. `compact` підходить для щільної операторської роботи, `comfortable` - для зон, які треба легше читати.
- `emphasis` - змінює візуальну вагу. `muted` робить блок тихішим, `accent` підсвічує важливий блок без зміни функції.
- `customLabel` - службова назва тільки в панелі налаштувань. Бойовий текст кнопок і полів не перейменовується.
- `adminNote` - внутрішня нотатка для причини або правила зміни. Видима тільки в налаштуваннях.

## Як змінювати безпечно

1. Відкрийте таймлайн потрібного бізнесу й натисніть `Налаштування`.
2. Оберіть блок у зоні `Блоки`.
3. У зоні `Візуал` змініть тільки потрібну змінну.
4. Перевірте `Опис і вплив`, особливо для блоків створення бронювання, продажів, експорту та booking drawer.
5. Дочекайтесь статусу `Збережено ...` внизу панелі.
6. Якщо зміна невдала, натисніть `Скинути` і підтвердьте reset тільки для поточного timeline.

## Що може вплинути на операторів

- Прихований `createBooking` прибирає швидку кнопку створення, але не забороняє створення через інші дозволені flow.
- Приховані `productSales` або `export` прибирають швидкі дії з toolbar, але не змінюють серверні права.
- Зміна `timelineGrid` може зробити основну сітку щільнішою або просторішою; після цього треба перевірити sticky шкалу часу й картки бронювань.
- Зміна `bookingPanel` може вплинути на читабельність форми, але не змінює валідацію або payload бронювання.
- `emphasis: accent` варто використовувати точково, інакше сторінка втрачає ієрархію.

## UAT

- Перевірити `timeline:event_genix`, `timeline:dar`, `timeline:maysternya_doli`.
- Перевірити, що кнопка `Налаштування` видима тільки для ролей із `settings` action.
- Перевірити save status: dirty, saving, saved, error.
- Перевірити reset confirmation і що reset не зачіпає інший timeline.
- Перевірити, що permission-hidden controls не стають видимими через `visible`, `order`, `density` або `emphasis`.
- Перевірити desktop/laptop toolbar: `Створити бронювання`, `Продажі`, `Експорт`, `Дії`.
- Перевірити booking drawer close button, sticky time scale і booking detail modal після зміни density/emphasis.

## Release and deploy hygiene

- Активна production/deploy branch у цьому репозиторії: `codex/room-timeline-hardening`.
- Feature work для hardening можна вести на окремій `codex/*` гілці, але release commit для production має бути явно перенесений/змерджений у deploy branch.
- Перед release потрібні `npm run test:ui`, `npm run check:syntax`, `npm run check:version`; для ширших змін - `npm test`.
- Після deploy перевірити `npm run version:smoke -- https://8223324090-production.up.railway.app` і, для таймлайну, `npm run release:timeline-proof` з правильним `RELEASE_DEPLOY_BRANCH`.
