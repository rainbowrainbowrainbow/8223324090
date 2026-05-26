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
