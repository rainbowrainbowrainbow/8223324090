# Timeline UAT regression matrix

Дата: 26.05.2026  
Контексти: `/` і `/maysternya-doli`  
Призначення: Phase 4 proof layer для shared timeline engine після canonical drag intent, resize parity, undo truth і lifecycle hardening.

## Поточний proof stack

Сильне покриття:
- `tests/timeline-interaction-model.test.js` перевіряє shared drag/resize intent, linked secondary cross-line drag, conflict evaluation і undo payload.
- `tests/timeline-lifecycle.test.js` перевіряє `pointercancel`, `lostpointercapture`, save lock, rerender cleanup і resize cancel parity.
- `tests/timeline-regression-matrix.test.js` тримає явну матрицю main/linked, same-line/cross-line, free/occupied, drag/resize, undo і context parity.
- `npm run test:ui` перевіряє, що timeline HTML, shared engine assets і Phase 4 UAT артефакти не випали зі статичної поверхні.
- `npm run version:smoke -- <live-url>` після деплою перевіряє live API/login version.

Слабке або ручне покриття:
- Повністю authenticated browser UAT не можна чесно автоматизувати без реальної сесії або credentials.
- Repo-native live API helpers очікують `TEST_USER` і `TEST_PASS`; спільних паролів у репозиторії немає і не повинно бути.
- Codex in-app browser без авторизації бачить login screen, тому не може виконати реальний drag/resize у production workspace.

Блокер для автоматичного live-auth UAT:
- немає чинної production browser session у виконавця;
- немає безпечного repo-native login seed для production;
- немає доступу до production JWT secret і його не можна обходити;
- фейковий UAT через unauthenticated page не рахується.

## Regression matrix

| Сценарій | Executable proof | Live-auth UAT | Очікуваний результат | Доказ |
| --- | --- | --- | --- | --- |
| Main same-line drag | `timeline-regression-matrix.test.js` | Перетягнути основний блок в межах тієї ж лінії | Час змінився, лінія лишилась, після refresh стан збережений | before/after screenshot або коротке відео |
| Main cross-line drag | `timeline-regression-matrix.test.js` | Перетягнути основний блок на іншу вільну лінію | Main отримав нову лінію, linked блоки зсунулися по часу без неправдивої лінії | screenshot + refresh |
| Linked secondary same-line drag | `timeline-regression-matrix.test.js` | Перетягнути linked secondary блок в межах його лінії | Atomic save і undo йдуть через main booking, але actor лишається secondary | screenshot + refresh |
| linked secondary cross-line drag | `timeline-regression-matrix.test.js` | Перетягнути linked secondary блок на іншу вільну лінію | На target line переходить саме linked actor, main не підміняє його лінію | screenshot + refresh |
| Occupied target rejection | `timeline-regression-matrix.test.js` | Спробувати кинути linked secondary у зайняте вікно | Preview і final validation однаково блокують save, ghost/highlight прибираються | screenshot rejection state |
| Main resize free target | `timeline-regression-matrix.test.js` | Розтягнути booking у вільне вікно | Duration збережений, group payload узгоджений | screenshot + refresh |
| Main resize conflict | `timeline-regression-matrix.test.js` | Розтягнути booking у зайняте вікно | Resize заблокований без часткового save | screenshot rejection state |
| Linked resize conflict | `timeline-regression-matrix.test.js` | Перевірити resize linked/group booking поруч із зайнятим вікном | Conflict рахується на фактичній лінії candidate | screenshot rejection state |
| Drag undo | `timeline-regression-matrix.test.js` | Після успішного drag натиснути undo | Main і linked повернулися до старого часу/лінії; refresh не ламає стан | before/after + refresh |
| Resize undo | `timeline-regression-matrix.test.js` | Після успішного resize натиснути undo | Duration повернувся до persisted old value | before/after + refresh |
| Rapid repeated interaction | `timeline-lifecycle.test.js` | Одразу після save спробувати другий drag/resize | Interaction блокується або серіалізується, немає duplicate save/ghost state | коротке відео |
| Pointer interruption | `timeline-lifecycle.test.js` | Почати drag/resize і перервати pointer/session | Немає stuck dragging/resizing state, target highlight знятий | коротке відео |
| Context parity | `timeline-regression-matrix.test.js` | Повторити критичні сценарії на `/` і `/maysternya-doli` | Обидва контексти працюють через той самий shared engine | два URL + screenshots |
| Asset/version proof | `version:smoke`, live asset check | Відкрити DevTools/network або source | `timeline.js?v=<release>` і `timeline-interaction-model.js?v=<release>` відповідають release | URL/source screenshot |

## Linked / banquet click and inventory QA

Цей блок обов'язковий для релізів, які зачіпають `js/timeline.js`, `js/booking.js`, `routes/bookings.js`, `js/api.js`, Warehouse costumes або booking drawer.

| Сценарій | Executable proof | Live-auth UAT | Очікуваний результат | Доказ |
| --- | --- | --- | --- | --- |
| Linked booking click, parent visible | `node --test tests/timeline-resources.test.js` | У `Аніматори` натиснути linked/secondary блок, коли parent booking є у поточному view/cache | Відкривається booking details modal для parent/root booking, без silent dead click | browser, роль, дата, view, label/id блоку |
| Linked booking click, parent hidden | `node --test tests/booking-visibility.test.js tests/timeline-resources.test.js` | У `Аніматори` або `Кімнати` натиснути linked/banquet activity блок, коли parent/root прихований поточним view/projection | Якщо parent не відкрився, fallback відкриває власну visible booking; користувач бачить modal або явне warning, не мертвий клік | booking id, view, console warning за наявності |
| Room view banquet activity ownership | `node --test tests/timeline-resources.test.js` | У `Кімнати` натиснути activity/animation блок банкету поруч із kitchen/service marker | Activity block відкриває booking details modal; compact banquet inspector не перехоплює цей клік | screenshot modal або коротке відео |
| Animator view banquet activity ownership | `node --test tests/timeline-resources.test.js` | У `Аніматори` натиснути banquet-linked activity/ordinary booking block | Відкривається booking details modal через `openTimelineBookingDetailsFromBlock`, не inspector-only surface | screenshot modal |
| Warehouse costumes in booking drawer | `npm run test:ui` + `node --test tests/booking-drawer-encoding.test.js` | Відкрити create/edit/duplicate booking drawer і перевірити поле `Костюм` | Authenticated drawer підтягує `/api/warehouse/costumes`; saved custom costume не зникає; unavailable/deleted/damaged/retired не пропонуються як новий вибір | selected options або notes з booking id |
| Live version smoke | `npm run version:smoke -- <live-url>` | Після deploy перевірити `/api/version` і login HTML | Live version/release label збігаються з `package.json` | command output |
| Protected live smoke | `npm run smoke:live -- <live-url>` з `LIVE_SMOKE_TOKEN` або `LIVE_SMOKE_USER` + `LIVE_SMOKE_PASS` | Запустити після version smoke, не друкуючи секрети | Protected bookings/lines/leads contracts проходять; якщо credentials відсутні, release QA явно позначається blocked | command output або список відсутніх env vars |

Дані для ручного звіту: browser, user role, date, view, clicked block labels/ids, pass/fail result. Якщо клік усе ще мертвий, записати точний booking id, view, date, console error і reproduction notes.

## Exact live-auth UAT script

1. Відкрити production URL `/`.
2. Увійти реальним creator/operator акаунтом. Не використовувати shared password або тестові креденшали з репозиторію.
3. Перевірити release badge і `/api/version`: версія має збігатися з поточним релізом.
4. На main Event Genix timeline виконати:
   - main same-line drag;
   - main cross-line drag;
   - linked secondary same-line drag;
   - linked secondary cross-line drag;
   - occupied target rejection;
   - resize free target;
   - resize conflict;
   - drag undo;
   - resize undo;
   - rapid second interaction immediately after save;
   - pointer/session interruption cleanup.
5. Після кожного successful save оновити сторінку і перевірити persistence.
6. Відкрити `/maysternya-doli` у тій самій авторизованій сесії.
7. Повторити linked secondary cross-line drag, occupied target rejection, resize + undo і rapid interaction.
8. Зафіксувати докази: URL, release version, asset version, before/after screenshot або коротке відео для кожного high-risk сценарію.

## Acceptance notes

- Якщо UAT виконує оператор вручну, потрібно зафіксувати, який акаунт/роль використовувались, але не записувати пароль.
- Якщо live сторінка віддає старий `timeline.js?v=...`, це deploy/cache blocker, а не pass.
- Якщо браузер без авторизації бачить тільки login form, це не є failed timeline UAT; це означає, що interaction proof треба виконати в реальній authenticated session.
