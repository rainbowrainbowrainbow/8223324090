# CHANGELOG — Event Genix CRM

> Журнал змін. Останні версії зверху, детально. Старі — коротко внизу.

---

## v0.66.30 - CRM 66.30: превʼю сертифікатів без стискання

### Сертифікати / detail modal / 26.05.2026 [codex]
- **Legacy detail modal став ширшим** - `#certDetailModal` отримав certificate-specific modal width, тому превʼю більше не стискається у стандартний вузький `modal-content`.
- **Canvas показується ratio-safe** - preview canvas отримує окремий клас і CSS з природним співвідношенням `3 / 2`, `height: auto` та без inline resize-стилів.
- **Mobile стискання прибрано** - mobile CSS більше не ставить `max-height: 42dvh` прямо на canvas, щоб не ламати aspect ratio; touch fallback для iPhone лишився.
- **Regression coverage** - UI smoke перевіряє legacy cert modal class, ratio-safe canvas styling і заборону повернення старого mobile max-height blocker.

---

## v0.66.29 - CRM 66.29: надійні задачі

### Задачі / створення / видача / 26.05.2026 [codex]
- **Refresh-aware створення задач** - `Tasks`, `Alerts`, `Assistant`, `Copilot` і `Kleshnya` використовують спільний auth fetch з одним refresh retry, тому валідна refresh-сесія більше не виглядає як "неавторизовано" під час створення чи оновлення задач.
- **Typed owner для автоматичних джерел** - Kleshnya й chat reminders нормалізують `assigned_to`, `owner`, `owner_user_id`, `created_by_user_id`, `task_mode`, `visibility` і `workflow_state`, щоб задачі не створювались "невидимими" для відповідального.
- **Чесні помилки й статуси** - duplicate create більше не перекривається generic error, фільтри підтримують архівні/скасовані статуси, PATCH status повертає нормалізовану задачу, а review/reward використовує реальний `owner_user_id`.
- **Regression coverage** - додано фокусні тести для refresh-aware protected task mutations, відсутності legacy-token precheck, typed-owner джерел, chat reminders, normalized status payload і reward target resolution.

---

## v0.66.28 - CRM 66.28: стабільні auth-сесії

### Auth / session repair / 26.05.2026 [codex]
- **Повна сесія після login** - frontend зберігає accessToken, refreshToken і refresh expiry поруч із legacy `pzp_token`, тому нові акаунти працюють через той самий login contract після створення.
- **Refresh після reload або expired token** - `apiVerifyToken()` робить один bounded refresh через `/api/auth/refresh`, оновлює localStorage і повторює verify без нескінченного loop.
- **Logout закриває серверну сесію** - shared logout викликає `/api/auth/logout` з refresh token і чистить усі auth/session keys на клієнті.
- **Regression coverage** - додано `tests/auth-account-lifecycle.test.js` і `tests/auth-frontend-session.test.js` для create -> login -> verify -> protected route -> refresh -> logout і frontend refresh behavior.

---

## v0.66.27 - CRM 66.27: безпечне закриття HR ролей

### HR / оргструктура / safe dismiss / 26.05.2026 [codex]
- **Backdrop більше не закриває редактор ролі** - випадковий клік по затемненню у HR -> Структура лишає вікно відкритим і повертає фокус у форму.
- **Закриття стало навмисним** - кнопки `×`, `Скасувати` і Escape йдуть через один guarded close path.
- **Dirty guard збережено** - при змінених полях CRM питає підтвердження перед закриттям без збереження.
- **Regression coverage додано** - `tests/hr-org-node-modal-dismiss.test.js` і UI smoke guard фіксують поведінку від випадкового повернення backdrop-close.

---

## v0.66.26 - CRM 66.26: регресійні guard-и таймлайну

### Таймлайн / invisible blockers / 26.05.2026 [codex]
- **Невидимі блокери закрито тестами** - додано поведінковий guard, який перевіряє, що drag конфліктує тільки з бронюванням на цільовій лінії, а блоки на інших лініях не можуть помилково червонити перенос.
- **Main і linked secondary покрито окремо** - regression matrix тепер перевіряє cross-line drag для основного та пов'язаного блоку з однаковим часом на нецільовій лінії.
- **Контекстна ізоляція Maysternya Doli** - `linked-atomic` тест доводить, що `/maysternya-doli` не блокується бронями з основного Event Genix таймлайну на тій самій лінії й часі.
- **Повний baseline пройдено** - `npm test` проходить із новими guard-и, тому цей клас помилок ловиться до деплою.

---

## v0.66.25 - CRM 66.25: системний guard hosts таймлайну

### Таймлайн / hosts semantics / 26.05.2026 [codex]
- **Системний guard для `hosts`** - додано `tests/booking-hosts-semantics.test.js`, який блокує runtime query/joins, де `bookings.hosts` знову використовують як staff id.
- **Visibility scope виправлено** - акаунти аніматорів більше не отримують видимість бронювань через збіг `hosts = staff_id`; працюють реальні `line_id` та `second_animator`.
- **HR/Payroll вирівняно** - рейтинги, auto-assign і payroll рахують зайнятість через лінію таймлайну або second animator, не через кількість ведучих у продукті.
- **Regression coverage підключено в baseline** - новий guard-test додано до `npm run test:unit`, тому `npm test` ловить повернення цього класу бага.

---

## v0.66.24 - CRM 66.24: фікс hosts-конфлікту таймлайну

### Таймлайн / drag conflict / 26.05.2026 [codex]
- **Cross-line drag fix** - прибрано помилкову server-side перевірку, яка трактувала `bookings.hosts` як ID аніматора під час `linked-atomic` збереження.
- **Правда по зайнятості** - основна зайнятість аніматора знову перевіряється через реальну лінію `line_id`, а не через кількість ведучих у продукті.
- **False conflict Pin+1L закрито** - перенос на іншу лінію більше не має блокуватись чужим бронюванням з таким самим `hosts: 1` на іншій лінії.
- **Regression guard** - додано тест `linked-atomic cross-line move does not treat hosts count as animator identity`.

---

## v0.66.23 - CRM 66.23: release guardrails таймлайну

### Таймлайн / deploy + cache proof / 26.05.2026 [codex]
- **Timeline release proof** - додано `npm run release:timeline-proof -- <live-url>`, що перевіряє `/`, `/maysternya-doli`, live timeline assets і Service Worker cache names.
- **Stale asset blocker** - proof окремо читає `timeline-context.js`, `timeline-interaction-model.js`, `timeline.js` і ловить старі `?v=` на timeline contexts.
- **Rollback path задокументовано** - `docs/TIMELINE_RELEASE_GUARDRAILS.md` описує `git ls-remote origin deployed`, `git revert`, повторний deploy і post-rollback proof.
- **Regression guardrail** - додано `tests/timeline-release-proof.test.js`, включений у `test:unit`, з негативним кейсом stale asset на `/maysternya-doli`.

---

## v0.66.22 - CRM 66.22: UAT matrix таймлайну

### Таймлайн / browser UAT + regression matrix / 26.05.2026 [codex]
- **Executable regression matrix** - додано `tests/timeline-regression-matrix.test.js` для main/linked, same-line/cross-line, free/occupied, drag/resize, undo і context parity.
- **Authenticated browser UAT blocker задокументовано** - Phase 4 не видає login screen за перевірений timeline: live drag/resize UAT потребує реальної сесії або `TEST_USER`/`TEST_PASS`.
- **Операторський UAT checklist** - додано `docs/TIMELINE_UAT_REGRESSION_MATRIX.md` з production сценаріями для `/` і `/maysternya-doli`, очікуваними результатами та evidence points.
- **Proof stack guardrail** - `tests/ui-check.js` перевіряє, що матриця, lifecycle coverage і UAT-документ лишаються підключеними до fast baseline.

---

## v0.66.21 - CRM 66.21: lifecycle таймлайну

### Таймлайн / lifecycle + cancel / 26.05.2026 [codex]
- **Єдиний cleanup для interaction state** - drag, resize, graduation segments, banquet-link draft і afisha drag тепер мають спільний teardown перед rerender/date/zoom/visibility interruptions.
- **Pointer lifecycle закрито** - `pointercancel`, `lostpointercapture`, `visibilitychange` і `window.blur` прибирають ghost preview, target highlight, resize classes і body lock без завислого стану.
- **Save lock тримається до render/rollback** - drag і resize не відпускають critical interaction lock до завершення save result handling, rerender або rollback.
- **Lifecycle regression tests** - додано `tests/timeline-lifecycle.test.js` для pointercancel rollback, lost pointer capture, save-lock blocking, render cleanup і resize cancel parity.

---

## v0.66.20 - CRM 66.20: undo/resize truth таймлайну

### Таймлайн / resize + undo / 26.05.2026 [codex]
- **Undo snapshot бере persisted result** - drag і resize тепер формують undo metadata після успішного `linked-atomic` save з фактично збережених main/linked rows.
- **Undo payload централізовано** - rollback для drag і resize будується через shared interaction model, а не через окрему ad hoc реконструкцію у `timeline.js`.
- **Interaction lock закриває undo path** - під час undo save/render новий drag або resize не стартує, щоб не створювати overlap між async persistence і UI state.
- **Resize conflict regression** - поведінкові тести покривають free resize, occupied resize rejection, group-safe resize payload і undo payload truth.

---

## v0.66.19 - CRM 66.19: стабілізація таймлайну

### Таймлайн / interaction engine / 26.05.2026 [codex]
- **Єдина модель drag/resize** - додано `js/timeline-interaction-model.js`, щоб preview, validation, save payload і undo брали main/linked/group booking state з одного джерела.
- **Linked secondary drag закрито матрицею** - перетягування пов'язаного блоку через лінії тепер формує atomic payload на main booking, але переносить саме dragged linked booking на target line.
- **Resize вирівняно з group rules** - resize перевіряє всю linked-групу, виключає sibling bookings з власних конфліктів і зберігає main + linked через той самий `linked-atomic` контракт.
- **Regression guardrail** - додано `tests/timeline-interaction-model.test.js` для main/secondary, same-line/cross-line, conflict і undo snapshot сценаріїв.

---

## v0.66.18 - CRM 66.18: git-деплой актуального стану

### Release / deploy / 26.05.2026 [codex]
- **Актуальний стан задеплоєно через git** - поточний `HEAD` був синхронний з `origin/deployed`, реліз фіксує повторний deploy-marker для live-середовища.
- **Cache-busting оновлено** - усі HTML/CSS/JS asset tags переведено на `?v=0.66.18`, щоб браузер і Service Worker не тримали старі файли.
- **Service Worker cache оновлено** - cache names піднято до `event-genix-v0.66.18` і `event-genix-api-v0.66.18`.
- **Без нової бізнес-логіки** - реліз не змінює API, DB, auth, timeline drag/drop або assistant runtime; це контрольний git-деплой актуального стану.

---

## v0.66.17 - CRM 66.17: Помічник таймлайну як на інших сторінках

### Таймлайн / AI-помічник / 26.05.2026 [codex]
- **Таймлайн примусово бере shared command bar** - фінальний CSS reset перекриває старі `.timeline-dashboard-page` правила, які стискали і зсували Помічника нижче header.
- **Сітка як на інших сторінках** - rail знову має `grid-template-areas: "command mic stop voice replay expand"`, 48px висоту і стандартні 40px action-кнопки.
- **Без наїзду на controls** - host стоїть у `.header-content` як `position: static`, а focus-only command panel більше не відкриває підказки поверх кнопок дат.
- **Regression guardrail** - `tests/ui-check.js` перевіряє hard reset для timeline, shared grid, absolute panel і заборону повернення `timeline-main`.

---

## v0.66.16 - CRM 66.16: стандартний Помічник на таймлайні

### Таймлайн / AI-помічник / 26.05.2026 [codex]
- **Таймлайн повернуто на стандартний shared topbar** - `js/assistant-rail.js` більше не має окремого `timeline-main` mount і монтує Помічника у header так само, як інші CRM-сторінки.
- **Старі timeline override-и прибрано** - видалено CSS-блоки, які переносили command bar у grid/header-special або в `main-content`.
- **Header-контракт один для всіх сторінок** - таймлайн тепер використовує той самий `flex-flow: row nowrap`, `position: static` і стандартну ширину topbar host.
- **Regression guardrail** - `tests/ui-check.js` забороняє повернення `timeline-main`, `isTimelineAssistantPage` і монтажу перед `.control-panel`.

---

## v0.66.15 - CRM 66.15: Помічник без overlay на таймлайні

### Таймлайн / AI-помічник / 26.05.2026 [codex]
- **Помічник прибрано з overlay/header-геометрії таймлайну** - на таймлайні `js/assistant-rail.js` монтує AI command bar у `main-content` перед `.control-panel`, а не в header поверх кнопок дат.
- **Панель дат фізично нижче Помічника** - `css/assistant-rail.css` задає `position: static` для `timeline-assistant-main-host`, стабільні 48px висоти та звичайний нижній відступ.
- **Header більше не бореться з Помічником** - timeline branch прибирає `assistant-rail-mounted` із header, щоб старі topbar/flex/grid override-и не могли знову зсунути command bar.
- **Regression guardrail** - `tests/ui-check.js` фіксує монтаж перед `.control-panel`, static positioning і refresh stale CSS link.

---

## v0.66.14 - CRM 66.14: реальний dock Помічника

### Таймлайн / AI-помічник / 26.05.2026 [codex]
- **Dock Помічника прив'язано до реального mount-стану** - `js/assistant-rail.js` ставить `assistant-rail-timeline-mounted` на фактичний `.header-content` і `data-crm-page="timeline"` на host, тому timeline CSS більше не залежить тільки від body-селектора.
- **Старий CSS link примусово оновлюється** - `js/auth.js` міняє stale `assistant-rail.css` href на поточний version tag, якщо вже авторизована сторінка мала старий link після deploy.
- **Помічник стає в normal topbar flow** - `css/assistant-rail.css` кладе command bar у ліву зону header grid, залишає пошук/user controls справа і не дає помічнику нависати над timeline controls.
- **Regression guardrail** - `tests/ui-check.js` перевіряє mount-клас, `data-crm-page="timeline"`, CSS grid contract і refresh stale CSS link.

---

## v0.66.13 - CRM 66.13: фікс позиції Помічника

### Таймлайн / AI-помічник / 26.05.2026 [codex]
- **Помічник жорстко закріплено всередині header таймлайну** - `css/assistant-rail.css` задає окремий hard-dock контракт для `body.timeline-dashboard-page`, щоб command bar стояв у тій самій шапці, що й на інших CRM-сторінках.
- **Панель дат більше не перекривається** - header резервує 76px висоти, а сам помічник має стабільні 48px і координату всередині topbar, тому timeline controls не потрапляють під overlay.
- **Повний topbar не обрізано** - ширина повернута під стандартний командний рядок із кнопками дій, без урізаного варіанту.
- **Regression guardrail** - `tests/ui-check.js` фіксує hard-dock селектори, topbar-висоту, мобільний wrap і заборону випадково suppress-ити timeline assistant.

---

## v0.66.12 - CRM 66.12: акаунти та скидання паролів

### HR / акаунти / 26.05.2026 [codex]
- **Створення акаунтів з HR/Staff знову проходить через бекенд** - `/api/users` використовує спільний `ACCOUNT_MANAGER_ROLES`, тому дозволені оператори не впираються в старий creator/director-only guard.
- **Скидання пароля вирівняно з центром акаунтів** - `/api/users/:id/reset-password` приймає той самий набір account-manager ролей і перевіряє protected-акаунти перед reset/reissue.
- **HR-доступ став явним і безпечним** - HR може створювати та скидати паролі для непідвищених ролей, але не може зачепити creator/director/vice_director/senior_manager; профіль і доступ лишені для creator/director.
- **Staff-options не блокує створення з привʼязкою** - `/api/users/staff-options` відкрито для account-manager ролей, щоб модалка створення могла підставити HR staff-профіль.
- **Regression guardrail** - `tests/backoffice-foundation-v2.test.js` фіксує маршрути create/reset/staff-options і HR protected-role контракт.

---

## v0.66.11 - CRM 66.11: Timeline assistant topbar alignment

### Таймлайн / AI-помічник / 26.05.2026 [codex]
- **Помічник повернуто у header як на інших сторінках** - shared AI command bar на таймлайні знову монтується, але стоїть зліва в стандартному topbar перед пошуком і user controls.
- **Toolbar таймлайну не перекривається** - дата, статуси й перемикач періоду лишаються нижче header, без плаваючого AI overlay поверх робочої панелі.
- **Regression guardrail** - UI smoke перевіряє left-docked timeline topbar contract і забороняє випадково suppress-ити timeline assistant.

---

## v0.66.7 - CRM 66.7: Smart credential paste

### Auth / credentials UX / 25.05.2026 [codex]
- **Вхід став стійким до copy-paste блоків** - форму входу можна заповнити вставкою всього тексту `Логін: ...` / `Пароль: ...`; frontend сам розкладає значення по полях.
- **Backend приймає той самий формат без ручної чистки** - `/api/auth/login` нормалізує credential block, invisible characters, зайві пробіли та перенос рядка перед bcrypt-перевіркою.
- **Manual create/reset/change password очищає типові оболонки** - якщо оператор випадково вставив `Пароль: ...`, у hash потрапляє сам пароль, а не підпис поля.
- **Issued credential verification не розходиться з login flow** - перевірка виданого пароля використовує ті самі password candidates, що й реальний login.
- **Regression guardrail** - `tests/account-issued-credential.test.js` покриває parser/normalizer, labeled-password verify та copy-paste login payload; UI smoke фіксує smart paste на формі входу.

---

## v0.66.6 - CRM 66.6: Issued credential verification tests

### HR / staff accounts / password verification / 25.05.2026 [codex]
- **Додано динамічний тест виданих паролів** - `tests/account-issued-credential.test.js` реально генерує bcrypt hash і перевіряє `verifyIssuedCredential` через мокнутий SQL-клієнт, а не тільки шукає рядки в коді.
- **Перевірено той самий login identity contract** - тест фіксує, що read-after-write перевірка використовує `users.username`, `users.login_aliases` і той самий пріоритет username, що й `/api/auth/login`.
- **Перевірено fail-closed сценарії** - wrong password, inactive account, missing user і порожній логін/пароль повертають `loginReady: false` з явною причиною.
- **Генератор one-time паролів покритий повторними пробами** - тест 250 разів генерує довгі паролі й блокує повернення неоднозначних символів `I`, `L`, `O`, `0`, `l`, `1`.
- **Regression guardrail підключено до `npm test`** - новий тест додано в `test:unit`, тому CI тепер ловить регресію автоматично.

---

## v0.66.5 - CRM 66.5: Password readiness guard

### HR / staff accounts / password readiness / 25.05.2026 [codex]
- **One-time паролі більше не містять візуально небезпечну `L`** - генератор прибрав символ, який легко плутається з `l`, `I` або українською `І` при ручному переписуванні пароля.
- **Create/reset акаунта тепер перевіряє пароль після запису в БД** - backend робить read-after-write перевірку через той самий login identity lookup, яким користується `/api/auth/login`, і не повертає "готовий" пароль, якщо він не проходить bcrypt/login check.
- **HR і Staff показують оператору login-ready статус** - модалки one-time/manual reset тепер прямо пишуть, чи сервер підтвердив, що логін і пароль готові до входу.
- **Bulk staff account creation отримав той самий guardrail** - масове створення акаунтів перевіряє кожен виданий пароль до commit і повертає `loginReady` у результаті.
- **Regression guardrail** - `tests/backoffice-foundation-v2.test.js` фіксує безпечний alphabet для one-time паролів і серверну login-ready перевірку для create/reset/bulk flows.

---

## v0.66.4 - CRM 66.4: Detailed menu tech cards

### Products / menu tech cards / warehouse / procurement / 25.05.2026 [codex]
- **Меню-позиції отримали детальний режим техкарти** - для кухонного меню можна перемкнутися з legacy text-поля на структуровані рядки інгредієнтів з кількістю на порцію, одиницею, відсотком втрат і нотаткою.
- **Інгредієнти привʼязуються до складу без паралельної складської правди** - детальна техкарта використовує розширений `product_stock_requirements`, підтягує активні `warehouse_stock` позиції та лишає fallback-назву тільки для підготовки, не для сліпого списання.
- **Додано явне списання по техкарті** - менеджер може списати кількість порцій, а backend блокує неповні/неактивні складські привʼязки, перевіряє залишки, лочить складські рядки і пише рухи у `warehouse_history` та `warehouse_stock_movements`.
- **Закупки бачать кухонний попит** - low-stock suggestions збагачені меню-звʼязками, а вкладка закупок показує окремий блок інгредієнтів, які використовуються детальними техкартами.
- **Проста техкарта лишилась сумісною** - старі меню-позиції з текстовими `ingredients`/`tech_card` не примусово мігруються в детальний режим і працюють як раніше.
- **Regression guardrail** - додано `tests/products-detailed-tech-card.test.js`, UI smoke перевірив детальну форму, складські рядки, explicit write-off result і procurement demand block.

---

## v0.66.3 - CRM 66.3: Timeline toolbar layout fix

### Timeline / header controls / 25.05.2026 [codex]
- **Верхній тулбар таймлайну більше не накладає контроли** - дата, статуси, період, zoom/utility-кнопки й праві дії отримали стабільні grid-areas для desktop і laptop ширин.
- **Меню `Дії` не обрізається всередині тулбара** - timeline control panel більше не кліпить dropdown через laptop `overflow: hidden`, а contextual action menu має власний stacking layer над сіткою.
- **Праві дії лишилися доступними** - `Продажі`, `Експорт` і contextual `Дії` розведені по явних рядках/колонках без приховування функцій.
- **Regression guardrail** - UI smoke фіксує новий responsive-контракт: visible overflow для тулбара, явні grid areas і високий z-index для action menu.

---

## v0.66.2 - CRM 66.2: Account password reset activation

### HR Accounts / password reset activation / 25.05.2026 [codex]
- **Reset пароля тепер може одразу активувати вимкнений акаунт** - `/api/users/:id/reset-password` приймає `activateOnReset`, оновлює `users.is_active` і повертає `wasActive`, `isActive` та `activated`.
- **HR-інтерфейс більше не видає "робочий" пароль до заблокованого акаунта мовчки** - для вимкнених акаунтів модалка пароля показує селектор статусу й за замовчуванням активує акаунт після reset-а.
- **One-time credential modal показує статус** - якщо backend повертає неактивний акаунт, оператор бачить попередження перед передачею пароля.
- **Login-діагностика стала кориснішою без витоку даних** - користувач і далі бачить єдину помилку, але серверні логи розрізняють `inactive_account`, `password_mismatch` і `user_not_found`.
- **Regression guardrail** - backoffice contract test фіксує `activateOnReset`, а users API smoke покриває перевипуск пароля для вимкненого акаунта.

---

## v0.66.1 - CRM 66.1: Dashboard assistant cleanup

### Dashboard / assistant rail cleanup / 25.05.2026 [codex]
- **З дашборда прибрано верхній widget Помічника** - shared `CrmAssistantRail` більше не монтується на сторінці `data-crm-page="dashboard"`.
- **Прибрано overlay з контекстними chips** - блок `Екран / Роль / Фокус` і швидкі команди `/brief`, `/leads`, `/shift` більше не перекривають перший екран дашборда.
- **Інші сторінки не зачеплені** - shared assistant rail лишився доступним на решті CRM-сторінок.
- **Regression guardrail** - UI smoke перевіряє suppress-контракт dashboard, щоб assistant top widget не повернувся випадково.

---

## v0.66.0 - CRM 66.0: Chat AI model selectors

### Chat settings / AI model selectors / 25.05.2026 [codex]
- **Поле моделі в налаштуваннях чату стало selector-ом** - `chatAiModel` і `guardianModel` більше не вводяться вручну, а підтягують готовий список моделей під вибраний provider.
- **OpenAI отримав актуальний список і mini-default** - у selector є `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` та сумісні fallback-и, але для Chat AI і Guardian дефолтною моделлю лишилась дешевша `gpt-5.4-mini`.
- **Захищено від provider/model mismatch** - backend більше не приймає комбінацію на кшталт `OpenAI + claude-haiku-*`; якщо модель не належить provider, вона замінюється на provider default.
- **Налаштування стали простішими для користувача** - при зміні provider модель автоматично перебудовується, а ключі лишаються в одному shared source `crm_ai_default`.
- **OpenAI-виклик переведено на Responses API** - shared Chat AI більше не залежить від старого `chat/completions` контракту для нових `gpt-5.4-*` моделей.
- **Regression guardrail** - `tests/chat-ai-model-selectors.test.js` і UI smoke фіксують `gpt-5.4-mini` default, model selector UI і блокування неправильних model id.

---

## v0.65.0 - CRM 65.0: Omni AI sales operating layer

### OmniClaw / AI sales operating layer / 25.05.2026 [codex]
- **AI-панель Omni стала конструктором продажного сценарію** - окрім draft ліда, вона визначає сценарій запиту, рахує lead score, показує блокери і підказує наступні дії менеджеру.
- **Каталоги і вкладення підвʼязані до існуючої CRM** - backend підтягує активні `products` для програм, тортів і меню, а також `catalog_items`; релевантні матеріали можна вставити в чат одним кліком.
- **Сценарії, guardrails і шаблони відповідей редагуються в drawer** - senior manager+ може налаштувати keywords, required fields, catalog tags, цілі наступного кроку, правила “не вигадувати ціни/знижки/доступність” і готові reply templates.
- **Тестовий режим скрипту працює без реального діалогу** - у налаштуваннях можна вставити приклад переписки й одразу побачити scenario, score, missing needs і рекомендовані каталоги.
- **Аналіз тепер лишає слід у Omni-розмові** - останній AI summary, scenario, score, missing needs і рекомендовані action/material ids записуються в `conversations.meta.leadAssistant`, не затираючи вже привʼязаний lead.
- **Follow-up задача створюється з того самого drawer** - менеджер може одним кліком поставити задачу повернутись до ліда; Tasker отримує `source_type='omni_lead_followup'`, дедуплікацію і посилання назад на Omni-діалог.
- **Налаштування скриптів отримали revision history** - кожне збереження фіксує `revision`, автора, час і snapshot попередньої конфігурації, а UI показує історію й базову аналітику AI лідів.
- **Створений лід отримує більше контексту продажу** - у notes/raw payload зберігаються scenario, score, рекомендовані матеріали, а перший рекомендований program product привʼязується як `program_id`.
- **Regression guardrail** - `tests/omni-lead-assistant.test.js` і `tests/omni-lead-assistant-materials.test.js` покривають нормалізацію скриптів, історію конфігів, follow-up draft, каталоги, recommendation logic і AI score/actions.

---

## v0.64.8 - CRM 64.8: Omni AI lead intake

### OmniClaw / AI lead intake / 25.05.2026 [codex]
- **AI-панель у діалозі OmniClaw створює draft ліда з переписки** - кнопка `AI` у відкритій розмові аналізує історію повідомлень, витягує імʼя, контакт, тип події, дату, кількість дітей, вік, бюджет і побажання до програми.
- **Закріплений чеклист потреб показує, що вже зібрано і що ще треба дізнатись** - менеджер бачить required/optional поля, наступне найкраще питання і готову відповідь, яку можна одразу вставити в поле повідомлення.
- **Створення ліда привʼязує CRM-кейс до Omni-розмови** - backend створює `lead`, додає customer card draft, записує `conversations.meta.lead_id`, а existing context після цього відкриває точний кейс у воронці.
- **Скрипти і required-поля налаштовуються без коду** - у drawer є редактор полів виявлення, питань, правил скрипту, tone і OpenAI model; збереження доступне senior manager+.
- **OpenAI boundary лишається серверним** - фронт не бачить ключ, аналіз іде через `/api/omni/conversations/:id/lead-assistant/*`, а без `OPENAI_API_KEY` сервіс повертає локальний fallback draft замість падіння UI.
- **Regression guardrail** - `tests/omni-lead-assistant.test.js` покриває нормалізацію скрипту, fallback extraction, pinned needs checklist і draft створення ліда з Omni conversation.

---

## v0.64.7 - CRM 64.7: Omni dialog channel badges

### OmniClaw / inbox / 25.05.2026 [codex]
- **Діалоги в Omni inbox отримали явну ідентичність каналу** - кожен рядок у списку розмов тепер показує компактний бейдж соцмережі та маленький маркер на аватарі, щоб Telegram, Viber, SMS, Facebook, Instagram і телефонія не змішувалися в однакові картки.
- **Відкритий діалог використовує той самий channel contract** - шапка активної переписки показує той самий канал, а статус "очікуємо відповідь" лишається поруч і не перекриває джерело розмови.
- **Фільтри та дані не змінювались** - UI бере іконку з наявного `conversation.channel`, без нової схеми, бекенд-міграцій або зміни логіки inbox-фільтрів.
- **Regression guardrail** - `tests/omni-send-truth.test.js` фіксує, що рядки діалогів і шапка активної розмови рендерять унікальний channel badge.

---

## v0.64.6 - CRM 64.6: Telegram inbox send and webhook lock

### OmniClaw / Telegram inbox / 25.05.2026 [codex]
- **Відповіді з CRM у приватний Telegram inbox більше не падають через thread id** - Omni-відправка явно вимикає глобальний `message_thread_id`, який потрібен для групових форум-тредів, але ламає приватні діалоги з помилкою `Bad Request: message thread not found`.
- **Startup більше не повертає inbox-бот на legacy webhook** - якщо в CRM є активне Telegram inbox-підключення, legacy Telegram auto-setup пропускається навіть тоді, коли токен не вдалося порівняти напряму.
- **Групові Telegram-нотифікації не зламані** - спільний `sendTelegramMessage` зберігає стару поведінку з налаштованим thread id для службових груп, а `skipThread` використовується тільки для прямих inbox-чатів.
- **Regression guardrail** - `tests/omni-send-truth.test.js` перевіряє і private-reply без forum-thread, і захист від повторного legacy webhook ownership drift.

---

## v0.64.5 - CRM 64.5: Telegram inbox private replies

### OmniClaw / Telegram inbox / 25.05.2026 [codex]
- **Відповіді з CRM у приватний Telegram inbox більше не падають через thread id** - Omni-відправка тепер явно вимикає глобальний `message_thread_id`, який потрібен для групових форум-тредів, але ламає приватні діалоги з помилкою `Bad Request: message thread not found`.
- **Групові Telegram-нотифікації не зламані** - спільний `sendTelegramMessage` зберігає стару поведінку з налаштованим thread id для службових груп, а новий `skipThread` використовується тільки там, де треба писати напряму в inbox-чат.
- **Regression guardrail** - `tests/omni-send-truth.test.js` перевіряє, що manual Telegram inbox replies передаються в провайдер без глобального forum-thread.

---

## v0.64.4 - CRM 64.4: Telegram inbox webhook ownership

### OmniClaw / Telegram inbox / 25.05.2026 [codex]
- **Telegram inbox webhook відкрито для Telegram provider updates** - `/api/omni/webhook/telegram` додано в централізований public auth boundary, щоб Telegram міг доставляти повідомлення без CRM user JWT.
- **Startup більше не перетирає Omni webhook** - якщо той самий bot token уже збережений як Omni Telegram inbox, legacy Telegram auto-setup не повертає його на старий `/api/telegram/webhook` після деплою або рестарту.
- **Report bot і Omni inbox лишаються розділеними** - webhook нового `@Park_Dialog_Bot` виставлено на production Omni endpoint `/api/omni/webhook/telegram`, а не на `/api/report-bot/webhook`.
- **Regression guardrail** - `tests/auth-boundary.test.js` перевіряє, що Omni Telegram webhook проходить без JWT, а `tests/omni-send-truth.test.js` фіксує ownership guard для startup webhook setup.

---

## v0.64.2 - CRM 64.2: виконані перенесені задачі у віджетах

### Профіль / Мій день / task widgets / 25.05.2026 [codex]
- **Виконані перенесені задачі одразу відображаються у віджетах** - після виконання задачі з `Мій день`, `Tasks` або work queue клієнт шле спільний `crm:tasks-updated` сигнал, а sidebar і dashboard task widgets перераховуються без очікування старого таймера чи ручного reload.
- **Підрахунок "виконано сьогодні" переведено на київський день** - profile day progress і dashboard `personal_tasker` рахують `completed_at AT TIME ZONE 'Europe/Kyiv'`, тому перенесена з прострочених задача не випадає з денного completed-віджета через UTC/date mismatch.
- **Dashboard personal tasker більше не залежить від обрізаного списку** - `done_today`, `done`, `active`, `todo`, `in_progress` і `overdue` беруться окремим DB-level агрегатом, а не з перших 180 рядків display payload.
- **Regression guardrail** - UI/static checks фіксують refresh contract між profile, tasks page, sidebar і dashboard, а також Kyiv/date-backed done-today stats.

---

## v0.64.1 - CRM 64.1: підзадачі у dashboard widgets

### Dashboard / task widgets / декомпозиція задач / 25.05.2026 [codex]
- **Віджети задач показують реальну декомпозицію** - `Мої задачі`, `Мій фокус`, `Особистий tasker`, `Задачі команди` і work queue тепер отримують `task_subtasks` з canonical task truth, а не тільки shell батьківської задачі.
- **Підзадачі мають progress-preview прямо у dashboard** - картки показують `done/total`, відсоток, компактний список перших кроків і overflow-індикатор, без перетворення widget на повну сторінку задач.
- **Payload синхронізовано з counts** - dashboard endpoints і `services/workQueue.js` віддають `subtasks`, `subtaskCount`, `subtaskDoneCount`, `subtaskProgress` та `subtaskProgressPercent` з одного агрегату `task_subtasks`.
- **Plain tasks не ламаються** - якщо підзадач немає, додатковий блок не рендериться і стара компактна картка лишається чистою.
- **Regression guardrail** - `tests/work-queue.test.js`, `tests/task-subtasks.test.js` і `tests/ui-check.js` перевіряють backend contract, triage rendering і статичний UI contract.

---

## v0.64.0 - CRM 64: перенос задач у Мій день

### Профіль / Мій день / drag-and-drop задач / 25.05.2026 [codex]
- **Перетягування з `Прострочено` в `Сьогодні` більше не падає** - виправлено backend reschedule SQL, який змішував різні типи для одного PostgreSQL placeholder і давав `inconsistent types deduced for parameter $2`.
- **Перенесення реально оновлює дедлайн і дату задачі** - `POST /api/tasks/:id/reschedule` тепер типізує `tasks.deadline` як `timestamp`, а scheduling/date-логіку веде через окремий `timestamptz` placeholder.
- **Статус простроченої задачі очищається при переносі** - якщо `status` або `workflow_state` були `overdue`, після перенесення задача повертається в робочий `todo` і має зʼявлятися в колонці `Сьогодні`.
- **DnD-контракт у профілі збережено** - frontend `Мій день` і далі викликає той самий route з `sourceSurface=profile_my_cabinet_overdue_to_today_drop`, але тепер серверна мутація проходить без SQL-конфлікту.
- **Regression guardrail** - `tests/task-scheduling.test.js`, `tests/profile-tasker-segments.test.js` і `tests/work-queue.test.js` покривають typed reschedule SQL, profile overdue-to-today drop contract і execution rails.

---

## v0.63.58 - CRM 63.58: dashboard AI shell

### Dashboard / AI assistant shell / 25.05.2026 [codex]
- **AI assistant на dashboard отримав окремий shell-контракт** - додано `data-crm-page="dashboard"` і scoped final layer у `css/assistant-rail.css`, щоб dashboard не наслідував зламану cross-page геометрію.
- **Prompt surface став головним елементом** - команда `Запитати CRM або /команда` тепер має стабільну 58px input-капсулу, чистий AI mark, readable state chip і фокус без стрибків.
- **Кнопки зібрано в єдину control group** - mic, stop, voice, replay і expand отримали однакові розміри, hover/focus і не розсипаються поруч з input.
- **Зайву meta-density прибрано з dashboard shell** - signal/engine chip приховано саме для dashboard, а відповідь/context panel відкривається як охайна secondary surface.
- **Responsive і light/dark polish** - додано правила для laptop/mobile width і окремий light-mode contract без зміни assistant runtime.
- **Regression guardrail** - `tests/ui-check.js` перевіряє dashboard marker і scoped assistant shell repair.

---

## v0.63.57 - CRM 63.57: Telegram фото для складу

### Склад / Telegram photo intake / vision / 25.05.2026 [codex]
- **Telegram став реальним intake-каналом складу** - фото з webhook створює durable чернетку `warehouse_photo_intakes` із Telegram source id, фото-референсами, draft JSON, confidence, статусом і дедуплікацією по `chat_id + message_id`.
- **Blind write заблоковано** - vision/підпис тільки готують чернетку; `warehouse_stock`, `warehouse_history` і `warehouse_stock_movements` оновлюються лише після явного підтвердження з Telegram або CRM.
- **Vision path підключено серверно** - OpenAI Responses vision читає фото через Telegram `getFile`, повертає структуровані поля складу, а без `OPENAI_API_KEY` чесно переводить intake у ручну перевірку без фейкового успіху.
- **CRM `Склад` отримав control center для бота** - сторінка показує стан Telegram/vision, чергу intake, останні фото-операції, inline-редагування draft, вибір існуючої позиції або створення нової.
- **Safety rules зафіксовано** - match candidates, ambiguous-match блокування, required name/quantity/unit/category, cancel/confirm callbacks і окрема інструкція `docs/warehouse-telegram-bot-instructions.md`.
- **Regression guardrail** - додано unit/static тест `tests/warehouse-photo-intake.test.js`, який фіксує нормалізацію draft, API/webhook/UI точки входу та заборону витоку OpenAI secret у статус.

---

## v0.63.56 - CRM 63.56: таймлайн 30 хв

### Таймлайн / default granularity / 25.05.2026 [codex]
- **30 хв стало дефолтним кроком таймлайну** - чистий старт без збереженого вибору відкриває розклад у режимі `30хв`, а не `15хв`.
- **Active state і сітка синхронні** - `CONFIG.TIMELINE.CELL_MINUTES`, `AppState.zoomLevel` і кнопка `30хв` тепер беруть один canonical fallback.
- **Ручне перемикання збережено** - якщо користувач явно обрав `15хв`, `30хв` або `60хв`, валідний localStorage preference лишається робочим; невалідне старе значення очищається.
- **Regression guardrail** - UI smoke перевіряє default `30`, fallback boot logic і те, що responsive density читає нормалізований zoom.

---

## v0.63.55 - CRM 63.55: компактний таймлайн

### Таймлайн / compact mode / usability density / 25.05.2026 [codex]
- **`Компакт` став справжнім density-режимом** - compact тепер застосовується як окремий клас на timeline shell, тому стискає не тільки ширину клітинок, а й верхню панель, row headers, time scale, рядки та booking-картки.
- **Верхній control strip займає менше місця** - date controls, zoom/status/period сегменти, business selector і utility-кнопки отримали щільніші висоти, padding і icon rhythm саме в compact mode.
- **У сітці видно більше корисного розкладу** - compact зменшує ширину клітинок, header width, висоту lane, gap між рядками, chrome карток і внутрішні відступи без зміни drag/click hooks.
- **Normal mode не стискали** - звичайний режим лишився з попередніми розмірами, а 30/60-хв zoom readability rules отримали compact-safe fallback.
- **Regression guardrail** - UI smoke перевіряє клас `timeline-compact-mode`, fit-screen compact path і CSS-контракт для toolbar/cards density.

---

## v0.63.54 - CRM 63.54: кнопки таймлайну

### Таймлайн / toolbar / visual polish / 25.05.2026 [codex]
- **Кнопки `Компакт`, `Кімнати` і `Дії` вирівняно за основним toolbar-стилем** - однакова висота 36px, шрифт 12px, вага, border radius, icon slot і line-height.
- **`Дії` перенесено в доречний utility-ряд** - контекстне меню тепер живе поруч із `Компакт` і `Кімнати`, притиснуте до правого краю нижнього control strip замість відірваної позиції посередині.
- **Порожній action-блок не лишає декоративну рамку** - якщо `Продажі` та `Експорт` приховані, контейнер action-buttons не показує пусту панель.
- **Regression guardrail** - UI smoke перевіряє нове місце `adminDropdown`, icon markup для `Дії` і CSS-контракт однакових utility-кнопок.

---

## v0.63.53 - CRM 63.53: стабільний помічник

### Header / AI-помічник / стабільність shell / 25.05.2026 [codex]
- **AI-помічник закріплено в потоці header на всіх CRM-сторінках** - прибрано стартову absolute-геометрію, через яку command bar міг “плавати” над контентом.
- **Прибрано lift/scale з topbar-режиму** - hover/focus і робочі стани більше не витягують помічника поверх toolbar, таймлайну чи інших сторінкових контролів.
- **Responsive поведінку стабілізовано** - на середніх ширинах помічник стискається в header, а на вузьких переходить у зарезервований другий ряд без перекриття контенту.
- **Regression guardrail** - UI smoke перевіряє фінальний docking contract: `position: static`, `flex-flow: row nowrap`, відсутність drift-анімацій і `transform: none`.

---

## v0.63.52 - CRM 63.52: центр керування

### Центр керування / data truth / modern shell / 25.05.2026 [codex]
- **Сторінку `Центр керування` переведено в сучасний CRM shell** - додано операційний hero, truth strip з актуальністю даних, ARIA-стан вкладок, чистіші секції, KPI-карти й responsive guardrails.
- **KPI вирівняно з реальними CRM-джерелами** - підтверджена виручка рахується з main bookings (`linked_to IS NULL`) без скасованих бронювань, планова сума з попередніми бронюваннями показується окремо, а періоди `Сьогодні / Тиждень / Місяць` повертаються з backend metadata.
- **Операційні задачі стали чесним списком дій** - `/api/center/tasks` за замовчуванням показує відкриті неархівні задачі, підсвічує прострочені, а `/api/center/overview` повертає open/overdue/dueToday summary.
- **Виправлено застарілі джерела даних** - worker activity більше не читає неіснуючі `history.changed_*` поля, дні народження в центрі беруть канонічний `pzp_token`, а видимі секції отримали явні loading/error/empty стани замість мовчазного старого UI.
- **Regression guardrail** - UI smoke перевіряє новий truth header, ARIA-вкладки, token для birthdays і frontend wiring для metadata/freshness; API smoke контракт `tests/center.test.js` доповнено полями source/periods/tasks truth.

---

## v0.63.51 - CRM 63.51: документи продуктів

### Products / document-link modal / 25.05.2026 [codex]
- **Modal `Документ програми` приведено до сучасного CRM UI** - додано polished shell, header, mode note, field rhythm, checkbox cards, inline feedback і responsive action footer.
- **Create/edit/save flow став робочим до backend-запиту** - URL, назва й тип документа валідовуються у frontend, помилки показуються біля полів українською, а backend validation errors нормалізуються для користувача.
- **Стан після save/unlink синхронний із карткою** - успішний `PATCH /api/products/:id/source-document` одразу оновлює product card, edit mode відкривається з prefilled values, unlink проходить через shared confirm.
- **Захист від випадкової втрати змін** - backdrop click більше не закриває modal мовчки, Escape/close/cancel лишаються явними шляхами виходу, loading state блокує повторні save/unlink натискання.
- **Regression guardrail** - `products-ia.test.js` фіксує modal shell, validation/feedback hooks, loading state, guarded unlink і document-link API wiring.

---

## v0.63.50 - CRM 63.50: єдиний toolbar таймлайну

### Таймлайн / toolbar / visual system / 25.05.2026 [codex]
- **Toolbar-кнопки уніфіковано** - `Компакт`, `Кімнати`, `Продажі`, `Експорт`, `Дії` і `Бізнес` приведено до одного CRM glass-control стилю.
- **`Бізнес` більше не окремий темний блок** - injected `timeline-business-switch` отримав той самий font, height, radius, border, hover/focus і select rhythm, що й решта панелі.
- **Open/active/focus стани вирівняні** - `Дії` з `aria-expanded="true"`, checked `Компакт`, active `Кімнати` і keyboard focus читаються в одній візуальній мові.
- **Функціональність не змінювалась** - HTML hooks і JS handlers для toggle, dropdown, export, sales і business switch лишилися без перейменувань; UI smoke закріплює новий styling contract.

---

## v0.63.49 - CRM 63.49: меню 2026 у продуктах

### Продукти / кухня / меню 2026 / 25.05.2026 [codex]
- **Меню 2026 додано в Products** - 85 позицій з `Меню 2026.docx` заведено як реальні кухонні `products` з `domain='kitchen'` і `kitchen_type='menu'`.
- **Збережено структуру розділів** - холодні й гарячі закуски, салати, бургери, піца, додатки до піци, мангал, основні/перші страви, гарніри та напої мають власні `menu_section`.
- **Картки отримали операційні поля** - перенесено вагу або обʼєм, склад, ціну, одиницю продажу, технічне джерело та variant price notes для позицій із кількома цінами.
- **Idempotent seed і price rules** - міграція оновлює існуючі меню-позиції за назвою або створює відсутні, а також синхронізує product-linked `price_rules`.
- **Regression guardrail** - products catalog test перевіряє кількість позицій, розподіл за секціями, ключові позиції та контракт kitchen/menu seed.

---

## v0.63.48 - CRM 63.48: вирівнювання ліній таймлайну

### Таймлайн / лінії / drag geometry / 25.05.2026 [codex]
- **Pending/new assistant lane вирівняно зі звичайними лініями** - рядок очікування додавання аніматора тепер рендерить ті самі time-grid cells, тому не стискається і не з'їжджає відносно розкладу.
- **Позиційна математика читає фактичну ширину клітинки** - booking, afisha, drag ghost, resize і graduation-сегменти більше не покладаються на жорсткі `50px`, а беруть реальний `--timeline-cell-w` або виміряну grid-cell ширину.
- **Lane height contract закріплено CSS-ом** - header і grid у кожному `.timeline-line` успадковують одну висоту, pending overlay лежить поверх grid без зміни геометрії.
- **Regression guardrail** - UI smoke перевіряє measured-cell helper, pending grid cells і responsive `min-height: inherit`, щоб нова лінія аніматора не поверталась до зміщеного layout.

---

## v0.63.47 - CRM 63.47: нижча кнопка підзадач

### Задачі / підзадачі / layout polish / 25.05.2026 [codex]
- **Кнопку `+ Підзадача` опущено до списку редагування** - у Tasks composer action більше не сидить у header-рядку блоку, а стоїть нижче біля реальної зони підзадач.
- **Профільний task composer вирівняно тим самим патерном** - дубльований My Cabinet subtask builder отримав окремий toolbar перед editable list.
- **Поведінку збережено** - `taskSubtaskAddBtn` і `addCabinetSubtask()` лишилися чинними hooks, тому створення підзадач не змінює API чи payload.
- **Responsive guardrail** - на вузьких екранах toolbar розтягує кнопку на ширину секції, а UI smoke фіксує нову структурну позицію.

---

## v0.63.46 - CRM 63.46: продуктові кнопки в меню

### Продукти / меню / торти / анімації / 25.05.2026 [codex]
- **Повернуто продуктові кнопки в sidebar** - у групі `Продукт` знову є прямі переходи `Продукти`, `Анімації`, `Торти`, `Меню` і `Каталоги продуктів`.
- **Direct links відкривають правильний стан** - `/programs#animation`, `/programs#kitchen-cakes` і `/programs#kitchen-menu` одразу ставлять потрібну категорію або кухонну підвкладку.
- **Пошук знає продуктові переходи** - глобальний пошук і feature registry знаходять продукти, анімації, торти, меню та каталоги за українськими й англійськими alias.
- **Guardrail оновлено** - products IA test, UI smoke і access matrix тепер перевіряють, що продуктові entrypoints не зникають з меню.

---

## v0.63.45 - CRM 63.45: афіша подій і матеріали

### Афіша / event workspace / матеріали події / 25.05.2026 [codex]
- **Афіша стала event-centric workspace** - головна поверхня тепер розділена на індекс подій, workspace вибраної події, папку матеріалів і службові інструменти.
- **Кожна подія має власну папку матеріалів** - додано event-scoped матеріали з нотатками, посиланнями та файлами, привʼязаними до конкретного `afisha` event.
- **Матеріали мають реальне збереження** - нова таблиця `afisha_event_materials` зберігає metadata і file `BYTEA`, API дає list/create/upload/download/delete маршрути.
- **Існуючі Afisha-флоу збережено** - створення, редагування, генерація задач, імпорт/експорт, recurring шаблони і розподіл по аніматорах залишилися в новій IA.
- **Guardrail** - UI smoke перевіряє event-centric shell, матеріальну папку, upload route і DB-backed persistence contract.

---

## v0.63.44 - CRM 63.44: сертифікати з унікальним отримувачем

### Сертифікати / активна вкладка / обов'язковий отримувач / 25.05.2026 [codex]
- **Активна вкладка сертифікатів стала маршрутною** - header на `/certificates`, `/certificates/new` і `/certificates/batch` тепер синхронізує `is-active` та `aria-current="page"` із реальним mode.
- **Видача перейменована на сертифікат або абонемент** - оновлено активні entry points у сторінці сертифікатів, sidebar quick access, пошуку, feature registry та legacy launcher.
- **Single-create вимагає отримувача** - frontend і API більше не приймають порожній або whitespace-only `displayValue`, а повідомлення відповідає режиму `fio` або `number`.
- **Create/edit перевіряють унікальність отримувача** - нормалізація використовує trim і case-insensitive lookup, duplicate повертає `CERTIFICATE_RECIPIENT_NOT_UNIQUE`; batch-коди лишаються явними плейсхолдерами без отримувача.
- **Tests/API contract** - оновлено certificate contract tests, UI smoke guardrails, integration expectations і Swagger опис для нового required/unique контракту.

---

## v0.63.43 - CRM 63.43: перенос прострочених задач у Мій день

### Профіль / Мій день / overdue drag-and-drop / 25.05.2026 [codex]
- **Виправлено перенос прострочених задач у "Сьогодні"** - drag-and-drop і кнопка "На сьогодні" тепер коректно бачать `deadline`, `scheduled_start_at`, `remind_at` або `date` задачі перед перевіркою overdue-стану.
- **Прибрано хибний блокер "Ця задача вже не прострочена"** - прострочена задача більше не зупиняється локально через порожній due state і доходить до `/api/tasks/:id/reschedule`.
- **Збережено існуючу модель перепланування** - перенос використовує чинний endpoint reschedule, оновлює дедлайн на сьогодні та лишає source surface для drop/button аналітики.
- **Regression test** - додано перевірку, що `moveCabinetTaskToToday(..., 'drag')` викликає `/tasks/:id/reschedule` для реально простроченої задачі.

---

## v0.63.42 - CRM 63.42: utility rail для згорнутого меню

### Sidebar / collapsed utility rail / 25.05.2026 [codex]
- **Згорнуте меню стало utility rail** - замість повного списку однакових іконок rail показує швидкий доступ, основні маршрути і один контекстний вхід до інших розділів.
- **Швидкий доступ бере участь у collapsed mode** - rail використовує існуючі favorites з quick access і не створює другу систему налаштувань.
- **Preview cards і flyout замінили label-only tooltip** - hover і keyboard focus відкривають короткий опис маршруту або керований flyout із доступними групами CRM.
- **Guardrail** - UI smoke перевіряє utility rail contract, відсутність raw `.nav-tooltip`, preview/flyout класи і незмінний fixed-width collapsed rail.

---

## v0.63.41 - CRM 63.41: AI Command Bar з живою відповіддю

### Помічник / command bar / live reply panel [codex]
- **Розведено `AI`-маркер і search-іконку** - іконка більше не накладається на `AI`, має власну grid-колонку і стабільну позицію.
- **Текстова відповідь відкривається в діалоговому panel** - після відповіді rail переходить у live `streaming`-стан, щоб користувач бачив зміст, а не тільки `Готова`.
- **Panel тримає відповідь видимою** - відповідь лишається відкритою на короткий час і потім акуратно повертається у спокійний стан.
- **Guardrail** - UI smoke перевіряє окрему search-іконку, live text panel і streaming-mode для текстових відповідей.

---

## v0.63.40 - CRM 63.40: компактний AI Command Bar

### Помічник / header geometry / hotfix [codex]
- **Виправлено розвалений topbar layout** - `AI Command Bar` більше не створює великий темний блок у шапці.
- **Поле і кнопки знову в одному рядку** - input, mic, stop, voice, replay і expand зафіксовані в єдиній compact grid-геометрії.
- **Dropdown лишився dropdown** - quick/context panel відкривається під полем і не займає постійне місце у header.
- **Guardrail** - UI smoke перевіряє hotfix geometry для command/actions row.

---

## v0.63.39 - CRM 63.39: фінальний деплой AI Command Bar

### Реліз / деплой / cache-bust [codex]
- **Піднято релізний маркер до `0.63.39`** - виконано окремий patch-реліз після впровадження `AI Command Bar`.
- **Оновлено cache-bust для live assets** - HTML entrypoints, service worker і lock-файли синхронізовані з новою версією.
- **Збережено попередній функціональний пакет** - зміни `AI Command Bar` з `0.63.38` залишаються активними, цей реліз фіксує фінальну delivery-версію.

---

## v0.63.38 - CRM 63.38: AI Command Bar у шапці

### Помічник / topbar / command bar [codex]
- **Прибрано стару видиму плашку `Помічник` з avatar/presence-блоком** - у шапці більше немає окремої лівої картки з аватаркою, назвою і шумним статусом.
- **Додано новий `AI Command Bar`** - головна взаємодія тепер починається з одного сильного поля `Запитати CRM або /команда` з AI-маркером і status-chip.
- **Швидкі дії переїхали у focus/dropdown layer** - контекст сторінки, роль, фокус і `/brief` / `/leads` / `/shift` відкриваються біля поля, а не займають постійний рядок.
- **Голосові й service-кнопки лишилися компактними** - mic/stop/voice/replay/expand збережені праворуч як tools без старого візуального блоку.
- **Guardrail** - UI smoke перевіряє, що shared assistant rail використовує command bar contract і більше не рендерить `crmAssistantRailAvatar`.

---

## v0.63.37 - CRM 63.37: різні ролі Мого дня і задач

### Профіль / Мій день / Мої задачі [codex]
- **`Мої задачі` більше не дублює `Мій день`** - прибрано daily quick strip і task composer з вкладки широкого списку задач.
- **`Мій день` лишився денним cockpit** - там залишилися quick cards, створення задач, сьогодні/прострочено/очікування/приватне і вечірній огляд.
- **`Мої задачі` стала списком/проекцією** - вкладка тепер фокусується на сегментах, filtered list, діях на картках і переході в повний task workspace.
- **Швидке додавання не загублено** - у toolbar `Мої задачі` є дія `Додати в Мій день`, яка веде до daily composer без дублювання форми.
- **Guardrail** - профільні тести й UI smoke перевіряють, що `mytasks` не монтує `renderCabinetPulseCluster()` і `renderCabinetTaskComposer()`.

---

## v0.63.36 - CRM 63.36: перенос прострочених задач

### Профіль / Мій день / задачі [codex]
- **Прострочені задачі можна перенести у `Сьогодні` напряму** - картки в блоці `Прострочено` отримали drag/drop у колонку `Сьогодні` та запасну дію `На сьогодні`.
- **Перенос є реальним reschedule, а не DOM-перестановкою** - дія викликає `/api/tasks/:id/reschedule`, ставить deadline/date на поточний київський день, а для вже запланованих задач переносить і `scheduled_start_at`.
- **Drop target видно в робочому місці** - секція `Сьогодні` має зрозумілу підказку та стан підсвічування під час перетягування.
- **Audit trail не губиться** - whitelist `sourceSurface` розширено для профільного badge/drop/button сценаріїв, щоб історія task execution знала реальне місце дії.
- **Guardrail** - профільні тести перевіряють draggable-картку, drop target, `today` reschedule option і payload з дедлайном на сьогодні; UI smoke фіксує новий drag/drop контракт.

---

## v0.63.35 - CRM 63.35: компактне створення задач

### Профіль / Мій день / task composer [codex]
- **Composer задач стартує згорнутим** - у `Мій день` та `Мої задачі` початково видно тільки заголовок, поле назви, швидкий вибір дати й кнопки створення/параметрів.
- **Advanced-поля відкриваються явно** - категорія, режим, тип, дата, пріоритет, видимість, звітність і підзадачі сховані за кнопкою `Більше параметрів`.
- **Швидке створення не зламано** - приховані поля залишаються в DOM з дефолтами сегмента, тому задачу можна створити одразу з компактного стану.
- **Custom date відкриває форму автоматично** - вибір `Інша дата` розгортає composer і ставить фокус у поле дати.
- **Guardrail** - профільний тест перевіряє collapsed/expanded HTML-контракт, а UI smoke фіксує `data-cabinet-composer-advanced` і toggle ownership.

---

## v0.63.34 - CRM 63.34: чесний лічильник Мого дня

### Профіль / Мій день / задачі [codex]
- **Лічильник виконаних задач став денним** - `Мій день` більше не показує історичний `done_total`; quick-картка бере `done_today` з `/api/tasks/my-cabinet`.
- **Контракт став явним у UI** - підпис у профільному quick strip і sidebar тепер каже `виконано сьогодні`, щоб не плутати денну поверхню з all-time статистикою.
- **Fallback у sidebar теж виправлено** - якщо cabinet endpoint недоступний, sidebar рахує тільки задачі зі статусом `done` і `completed_at` за поточний київський день.
- **Алерти отримали чистіший стан** - нульовий стан алертів більше не виглядає як червона тривога; copy і tone відрізняють `немає критичних`, `є активні`, `критичні`.
- **Guardrail** - профільні тести й UI smoke перевіряють `completedToday`, `completed: quickStats.done_today` і явний підпис `виконано сьогодні`.

---

## v0.63.33 - CRM 63.33: Мої професії у профілі

### Профіль / вкладки / професійний hub [codex]
- **`Огляд` прибрано з primary tab strip профілю** - перша вкладка тепер називається `Мої професії`, а старий deep-link `?tab=profile` безпечно відкриває новий професійний hub.
- **Додано професійний контекст ролі** - вкладка показує поточну CRM-роль, позицію/зону зі staff/shift context, Telegram-стан і фокус ролі.
- **Чекліст став частиною професії** - hub підтягує checklist-like задачі з існуючих задач/cabinet даних, а якщо таких задач немає, показує чесний рольовий first-pass checklist без окремої фейкової системи.
- **Старий generic cockpit не перейменовано сліпо** - віджети, ризики й активність не звалені під нову назву; вкладка перегрупована навколо ролі, операційного стану, задач і пов'язаних маршрутів.
- **Guardrail** - UI smoke перевіряє `Мої професії`, fallback для `?tab=profile`, професійний layout і checklist/next-shift джерела.

---

## v0.63.32 - CRM 63.32: чистіший Помічник у шапці

### Помічник / topbar / avatar polish [codex]
- **Виправлено avatar/control shell Помічника** - верхній `CrmAssistantRail` отримав чистіший glass-шар, акуратніший avatar-core і спокійніший border/background у темній та світлій темі.
- **Прибрано поганий hover/focus halo** - великий кільцевий `box-shadow` з presence-контейнера більше не з'являється при наведенні або `focus-within`.
- **Focus залишився доступним, але став контрольованим** - keyboard focus тепер показується маленьким нижнім акцентом на avatar-кнопці та компактним inset-станом на кнопках керування, без грубого зовнішнього кільця.
- **Legacy assistant не оживлявся** - зміна лишається на canonical shared rail, а старий `kleshnya-widget` продовжує бути bridge до `CrmAssistantRail`.
- **Guardrail** - UI smoke перевіряє новий polish-блок, відключення avatar halo і наявність компактного focus ownership.

---

## v0.63.31 - CRM 63.31: зрозумілі системні помилки

### Системна якість / error UX / frontend guardrails [codex]
- **API-помилки стали зрозумілішими для оператора** - спільний `CrmApiErrors` нормалізує `error`, `message`, `status` і `requestId`, щоб замість голого `Internal server error` у UI можна було бачити робочий текст і код звернення.
- **Notification-шар показує trace code** - `showNotification()` тепер приймає `Error` або JSON-помилку й додає `код: requestId`, коли бекенд повертає метадані для розслідування.
- **Додано спільні стани loading/error/empty** - `CrmUiState` дає єдиний HTML-контракт для помилок, порожніх станів і повторної спроби, щоб нові модулі не збирали різні випадкові error-блоки.
- **Reports і Profile краще зберігають бекенд-помилки** - локальні API wrappers більше не викидають `requestId` при невдалих запитах і можуть показати зрозумілу помилку у звітах та профільному cockpit.
- **Guardrail** - UI smoke перевіряє наявність requestId-aware error kit, shared UI-state renderer і збереження metadata у shared API wrappers.

---

## v0.63.30 - CRM 63.30: системні guardrails

### Системна якість / UX guardrails / API traceability [codex]
- **Прибрано native browser dialogs із production JS** - задачі, профіль, HR/staff credential flow, task report gate і звіти більше не використовують сирі `window.prompt`, `window.alert` або `window.confirm`; робочі сценарії йдуть через CRM-модалки або notification-шар.
- **Звіти бухгалтера отримали нормальний comment flow** - затвердження й повернення звіту беруть коментар через спільний `promptModal`, без системного браузерного вікна.
- **500-відповіді API отримали trace metadata** - новий middleware додає `requestId` і `success: false` до JSON-помилок, які route handlers повертають напряму, щоб production debug не закінчувався безликим `Internal server error`.
- **Postgres-only runtime guard** - UI smoke перевіряє, що live runtime не повертає Supabase client path у `js/`, `routes/`, `services/`, `middleware`, `server.js` або `db/index.js`.
- **Guardrail** - додано unit test для error metadata і frontend smoke-guard, який не дає native browser dialogs повернутись у production JS.

---

## v0.63.29 - CRM 63.29: красивіший Помічник

### Помічник / topbar / interactive panel [codex]
- **Перероблено верхній Помічник** - shared `assistant-rail` став стабільним command cockpit у шапці: статус, аватар, поле `Запитати або /команда` і службові кнопки вирівняні в один спокійний робочий блок.
- **Прибрано дивне hover-виділення** - наведення більше не піднімає плашку Помічника і не витягує випадковий subtitle-рядок; відповідь відкривається тільки через focus/live-state або явну дію.
- **Оновлено велике інтерактивне вікно** - expanded panel перероблено у двоколонковий workspace: зліва жива сцена стану Помічника, справа чат, snapshot, режими й швидкі дії.
- **Темна і світла тема вирівняні** - нові поверхні, borders, фон, composer і workspace-картки мають окремі dark/light правила без брудного підсвічування.
- **Guardrail** - UI smoke фіксує новий `v0.63.29` cockpit-шар, заборону hover-only subtitle шуму і нове розташування expanded workspace.

---

## v0.63.28 - CRM 63.28: чистіший профільний день

### Профіль / Мій день [codex]
- **Прибрано зайвий ряд підказок дій** - блок `✓ Виконати / ⏰ Відкласти / ↗ Відкрити` більше не займає окремий ряд у вкладках `Мій день` і `Мої задачі`.
- **Реальні дії задач залишені** - кнопки виконання, відкладання і відкриття на самих картках задач продовжують працювати.
- **Прибрано мертвий CSS** - видалено стилі `.cabinet-action-legend`, включно з dark-mode варіантами.
- **Guardrail** - UI smoke перевіряє, що redundant legend row не повернувся, а функціональні task actions лишилися.

---

## v0.63.27 - CRM 63.27: відновлена сторінка Афіші

### Афіша / standalone shell [codex]
- **Виправлено чорний екран `/afisha`** - сторінка більше не лишає `mainApp` прихованим після завантаження.
- **Підключено стандартний auth bootstrap** - Afisha тепер перевіряє користувача через `apiVerifyToken()`, записує його в `AppState.currentUser` і відкриває CRM shell через `showAuthenticatedPageShell()`.
- **Прибрано хибний shell-ready сценарій** - сторінка більше не викликає тільки `Sidebar.markShellReady()` без реального відкриття основного застосунку.
- **Guardrail** - UI smoke перевіряє, що Afisha як standalone-сторінка має auth bootstrap перед рендером робочої поверхні.

---

## v0.63.26 - CRM 63.26: стабільні embedded-вкладки Art

### Art / Випускний / embedded shell [codex]
- **Виправлено вузький layout у вкладці `Випускний` всередині Art** - embedded-сторінка більше не резервує ширину під власний sidebar, коли sidebar схований iframe-режимом.
- **Додано спільний embedded-shell контракт** - `layout.css` тепер системно скидає sidebar/header, `margin-left` і `width` для iframe-поверхонь із `embed-mode`.
- **Захищено схожу вкладку `Дизайни`** - сторінка дизайнів теж вмикає `embed-mode` до завантаження layout CSS і явно розтягує workspace на всю ширину iframe.
- **Standalone-сторінки не змінені** - прямі переходи `/graduation` і `/designs` зберігають звичайний CRM sidebar, а embedded-режим працює тільки для iframe/deep embed.
- **Guardrail** - UI smoke перевіряє, що Art iframe-джерела мають ранній embedded mode і що shared shell більше не залишає sidebar-резерв усередині iframe.

---

## v0.63.25 - CRM 63.25: фінальна передача звіту бухгалтеру

### Звіти / UX фінального етапу [codex]
- **Передачу бухгалтеру винесено з дрібного toolbar** - дія більше не губиться поруч із CSV, XLSX, імпортом і чернетками.
- **Додано великий фінальний CTA під таблицею** - блок `Фінальний етап` явно пояснює, що це останній крок роботи зі звітом.
- **Кнопка показує наслідки перед натисканням** - оператор бачить, що після передачі таблиця блокується, створюється задача на перевірку, а стан видно у загальному списку.
- **Locked state читається краще** - після закриття блок показує, що звіт уже передано бухгалтеру на перевірку.
- **Guardrail** - UI smoke перевіряє, що handoff лишається окремим фінальним CTA і не повертається у технічний ряд дій.

---

## v0.63.24 - CRM 63.24: погодження звітів бухгалтером

### Звіти / задачі / бухгалтерія [codex]
- **Додано окремий workflow погодження звіту бухгалтером** - звіт тепер має власний `approval_status`, посилання на задачу перевірки, відповідального бухгалтера, дату постановки, дату рішення та коментар.
- **Маршрут задачі налаштовується прямо на сторінці звітів** - у блоці `Погодження бухгалтером` можна вибрати CRM-користувача, якому приходить задача перевірити звіт; якщо нікого не вибрано, лишається fallback на бухгалтера на зміні.
- **Закриття табличного звіту ставить задачу в Tasks** - дія `Закрити і передати бухгалтеру` тепер оновлює статус погодження, створює task із джерелом `report` та показує номер задачі у списку звітів.
- **Бухгалтер отримав швидкі дії у списку та деталях** - доступні кнопки `Поставити задачу`, `Взяти в перевірку`, `Затвердити` і `Повернути`, без необхідності шукати прихований сценарій.
- **Загальний список показує реальний стан погодження** - поруч зі статусом звіту видно `Задача бухгалтеру`, `На перевірці`, `Затверджено` або `Повернуто`, включно з номером задачі та відповідальним.
- **Guardrail** - додано міграцію `218_report_accountant_approval_workflow.sql`, оновлено reports UI smoke і focused workspace-тест закриття звіту з task-backed handoff.

---

## v0.63.23 - CRM 63.23: без окремої вкладки Програми

### UI / навігація / Programs compatibility [codex]
- **Прибрано окрему вкладку `Програми` з Art Director** - Art більше не показує самостійний tab `Програми` і не монтує embedded iframe `/programs?embedded=1`.
- **Sidebar більше не промотує `/programs` як модуль** - з продуктової групи прибрано прямі входи `Продукти` та `Каталоги`, без видалення сумісного маршруту.
- **Глобальний пошук не веде в standalone Programs** - Cmd+K, feature registry і API search більше не повертають результатів/shortcut-ів з переходом на `/programs`.
- **Role quick access очищено** - ролі, які мали `/programs` у швидких діях або стартовій сторінці, тепер ведуть у чинні CRM-поверхні на кшталт `/art`, `/tasks` і `/warehouse`.
- **Compatibility guardrail** - `programs.html`, `/programs`, `/embed/programs`, product API та статистика програм залишені для старих посилань і бізнес-даних.

---

## v0.63.22 - CRM 63.22: контентна sandbox-дошка

### Dashboard Board / sandbox workspace [codex]
- **Палітра стала ближчою до реальної content-workspace логіки** - у dock додано окрему групу `Контент` з пресетами `Ідея`, `Production`, `Approved`, `Blocked` і `Storyboard`, щоб дошка не була лише набором випадкових кнопок.
- **Пресети створюють готові робочі сцени** - кожен пресет додає semantic frame, набір нотаток і зв'язки між ними, тож команда може швидко зібрати idea cluster, production map, publish-ready зону або storyboard.
- **Збереження не втрачає семантику** - board state тепер безпечно нормалізує і зберігає коротке поле `tone` для frame/note/text/space через canonical Postgres dashboard config.
- **Dark/light polish** - додано тональні стилі для content-зон, пресетів, frame/note поверхонь і toolbar states у світлій та темній темах без повернення фігур у card-like shell.
- **Guardrail** - board-тести покривають true primitive geometry, connector draft/follow та новий content preset path з persistent tone.

---

## v0.63.21 - CRM 63.21: єдина воронка лідів

### Ліди / Customers / навігація [codex]
- **Залишено один канонічний kanban лідів** - робочою воронкою для лідів є `/sales-funnel`, а дублююча вкладка `Воронка` на сторінці клієнтів прибрана з UI.
- **Старі переходи більше не відкривають неправильну поверхню** - `/customers?tab=journey` автоматично переводиться на `/sales-funnel?view=kanban`, щоб користувач не потрапляв у другий псевдо-kanban.
- **Переходи з dashboard/work queue приведені до canonical query** - stage chips тепер ведуть на `pipeline_stage`, а `/sales-funnel` також приймає старий `stage` як сумісний fallback.
- **Клієнтські lifecycle-зрізи не втрачено** - старі `journey` deep links лишаються як фільтр списку клієнтів, але більше не виглядають як окрема воронка лідів.
- **Guardrail** - UI smoke перевіряє, що Customers більше не експонує duplicate journey funnel, а sales funnel читає canonical і legacy stage-параметри.

---

## v0.63.20 - CRM 63.20: чистий HR без legacy блоку

### HR / кеш сторінок та legacy guard [codex]
- **Прибрано причину повторної появи “Зміни аніматорів” у вкладках HR** - extensionless route `/hr` тепер отримує `Cache-Control: no-cache, no-store, must-revalidate`, як і прямі `.html` сторінки, щоб браузер не тримав старий HR DOM.
- **Додано runtime guard для старого DOM** - `js/hr-page.js` прибирає legacy `shiftsSummarySection`, `shiftsSummaryContainer` і `shiftsMonthPicker`, якщо вони прилетіли зі stale сторінки або старого кешу.
- **Покрито не тільки “Структура”** - guard виконується під час старту HR та при перемиканні вкладок, тому `Резерв`, `Онбординг`, `Чорний список` та інші вкладки не повинні показувати цей сторонній блок.
- **Guardrail** - UI smoke перевіряє відсутність legacy summary та no-store політику для `/hr`.

---

## v0.63.19 - CRM 63.19: інтерактивна HR структура

### HR / Кадри / Структура [codex]
- **Структуру компанії переосмислено як редаговану карту** - вузли тепер мають власні координати на полотні, їх можна перетягувати, а схема більше не залежить від жорстких CSS-рядків.
- **Лінії підпорядкування стали системними** - зв’язки будуються з `parentId` через SVG-шар, їх можна змінювати через дію `Змінити лінію`, прибирати для обраного вузла або повертати авто-впорядкуванням.
- **Збереження структури розширено без втрати старих даних** - `/api/hr/company-structure` зберігає `x/y` координати вузлів, санітизує цикли і лишає сумісність зі старими структурами без координат.
- **Прибрано глючний нижній блок “Зміни аніматорів”** - legacy summary більше не висить під вкладкою `Структура` як сторонній блок.

---

## v0.63.18 - CRM 63.18: SQL замість Supabase runtime

### Архітектура / Postgres та upload storage [codex]
- **Supabase SDK прибрано з runtime** - залежність `@supabase/supabase-js` видалена з `package.json` / `package-lock.json`, а спільний `db/supabase.js` вилучено.
- **Клієнти остаточно читаються з Postgres** - customer communication hub і Customers CRUD більше не мають server-side Supabase-клієнта або міграційного шляху в Supabase.
- **Uploads переведені на CRM `/uploads` + Postgres metadata** - chat файли, аудіо, профільні аватари та catalog images більше не намагаються писати у Supabase Storage.
- **Storage governance оновлено** - `config/storageSurface.js`, `docs/STORAGE_SURFACE.md` і `check:storage-surface` тепер описують локальні upload paths з Postgres-метаданими та 0 remote buckets.
- **Guardrail** - focused storage тести перевіряють local metadata для chat/audio/avatar/catalog image, а UI smoke фіксує Postgres-only шлях клієнтів без legacy Supabase migration.

---

## v0.63.17 - CRM 63.17: Збереження нових клієнтів через Postgres

### Клієнти / створення та CRUD [codex]
- **Виправлено збереження нового клієнта** - модалка `Новий клієнт` більше не падає з `Internal server error`, коли в середовищі є Supabase-конфіг, але таблиця `customers` не доступна через Supabase REST.
- **Канонічний шлях збереження повернуто в Postgres** - звичайні операції Customers CRUD тепер використовують існуючий CRM Postgres за замовчуванням, а не перемикаються в Supabase лише через наявність ключа.
- **Supabase для клієнтів став явним opt-in** - legacy Supabase-гілка для `customers` активується тільки через `CUSTOMERS_SUPABASE_ENABLED=true`, щоб інші Supabase-залежності не ламали клієнтську базу.
- **Міграційний endpoint залишився явним** - `/api/customers/migrate-to-supabase` і далі напряму використовує Supabase як операторський шлях міграції, але не впливає на щоденне створення клієнтів.
- **Guardrail** - UI smoke перевіряє, що Customers CRUD має Postgres-default і не повернеться до неявного Supabase-шляху без явного прапорця.

---

## v0.63.16 - CRM 63.16: Клієнтська воронка з drill-down

### Клієнти / journey funnel [codex]
- **Воронка перестала бути декоративною** - вкладка `Клієнти -> Воронка` тепер рендерить стадії як повноцінні clickable/focusable controls з hover/focus станом.
- **Ліди ведуть у робочу Sales Funnel поверхню** - стадія `Ліди` відкриває `/sales-funnel?view=kanban&pipeline_stage=new`, а сторінка лідів читає query-параметри й застосовує pipeline-фільтр.
- **Lifecycle-сегменти лишилися в Customers** - `Нові`, `Повторні`, `Лояльні` та `Перспективні` відкривають список клієнтів із точними visit-bound фільтрами, а не міксуються з pipeline-stage лідів.
- **Prospects стали видимими** - прихований backend-сегмент `prospects` оформлено як `Перспективні (0 візитів)` із drill-down на `minVisits=0&maxVisits=0`.
- **Фільтр візитів підтримує нуль** - `/api/customers` більше не викидає `0` через `parseInt(...) || 0`; fallback Postgres-шлях фільтрує через реальний `booking_count`.
- **Guardrail** - UI smoke перевіряє clickable journey contract, prospects-сегмент, zero-visit filter і query-driven Sales Funnel drill-down.

---

## v0.63.15 - CRM 63.15: Профільний cockpit огляду

### Профіль / Overview cockpit [codex]
- **Огляд став особистим cockpit** - top strip і вкладка `Огляд` тепер рендерять згруповані картки фокусу, сьогоднішнього виконання, графіка, бронювань, сертифікатів і досягнень.
- **Прибрано розмитий "Робочий стан"** - головний блок перейменовано в `Особистий фокус`, а слабкий shift-state замінено на конкретну картку `Наступна зміна`.
- **Next shift читає реальний staff schedule** - `/api/auth/profile` повертає `nextShift`, відфільтрований від day-off/vacation/sick станів, а сертифікати отримали точний total-запит замість розміру recent-list.
- **Віджети стали клікабельними й пояснюваними** - кожна картка має hover/focus tooltip, touch-кнопку `i` і веде у відповідний CRM-розділ: tasks, my day, HR schedule, timeline, certificates або achievements.
- **Набір віджетів налаштовується** - додано `user_profiles_ext.profile_cockpit_widgets` і endpoint `PATCH /api/auth/profile/cockpit-widgets`, щоб користувач міг зберігати видимість і порядок карток.
- **Guardrail** - UI smoke перевіряє configurable cockpit widgets, tooltip contract, відсутність старого `Робочий стан` і backend-поля `profile_cockpit_widgets` / `nextShift`.

---

## v0.63.14 - CRM 63.14: Банкетні зв'язки таймлайну

### Таймлайн / банкетні зв'язки та toolbar [codex]
- **Банкетні активності можна зв'язувати напряму в таймлайні** - на картці бронювання з'явився компактний круглий handle: оператор клікає джерело, потім цільове бронювання, і CRM створює зв'язок "частини одного банкету".
- **Зв'язок став durable, а не DOM-декорацією** - додано `booking_banquet_links` у Postgres, API `POST/DELETE /api/bookings/:id/banquet-links`, історію дій та повернення `banquetLinks` разом із бронюваннями.
- **Конектори рендеряться як timeline-native SVG overlay** - лінії не блокують кліки по бронюваннях, перераховуються після rerender, фільтрів, drag/resize і zoom-змін у видимому денному таймлайні.
- **Керування зв'язком доступне з деталей бронювання** - у modal details показується блок "Банкетні зв'язки" з цільовими активностями та кнопкою `Прибрати`.
- **Toolbar приведено до одного CRM glass стилю** - дата, фільтри статусів, period/zoom та службові кнопки отримали узгоджені розміри, hover/active state і dark-mode поведінку.
- **Guardrail** - додано route-тест `tests/booking-banquet-links.test.js` і UI smoke-перевірки на durable модель, SVG layer та єдину мову toolbar controls.

---

## v0.63.13 - CRM 63.13: Вільний Dashboard Board

### Dashboard Board / residual shapes and movement [codex]
- **Line/arrow прибрано з framed chrome** - legacy thin-geometry shapes більше не рендерять службову card-панель над фігурою і залишаються чистою сценовою геометрією.
- **Arrow рухається вільно у 2D** - static arrow/line shape більше не перехоплюється горизонтальними endpoint-кнопками, тому drag переносить об'єкт по X і Y.
- **Drag/resize без remount віджетів** - завершення move/resize підтверджує DOM geometry локально, оновлює connectors/inspector і не викликає повний `renderBoard()`, який змушував live widgets блимати.
- **Один interaction model замість view/edit split** - прибрано видимі кнопки `Перегляд/Планувати`; дошка лишається читабельною і водночас маніпульованою через active tool, selection, hover і handles.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` перевіряє unified mode, unframed line/arrow, 2D arrow movement і стабільну DOM-ідентичність widget subtree після drag.

---

## v0.63.12 - CRM 63.12: Чистий selector сертифікатів

### Сертифікати / batch quantity selector [codex]
- **Прибрано зайве кільце у batch selector** - selected state більше не малює другу внутрішню обводку навколо кількості сертифікатів.
- **Фокус відділено від вибраного стану** - keyboard focus лишається видимим, але тепер це окремий focus-visible шар, який не накладається на checked border як випадковий подвійний ring.
- **Legacy modal і standalone `/certificates/batch` вирівняно** - виправлено і старий `batchQty` control у `index.html`, і новий `certPageBatchQty` control у standalone certificates flow.
- **Native radio не ламає доступність** - legacy radio більше не ховається через `display:none`; він візуально прихований, але зберігає keyboard/focus поведінку.
- **Guardrail** - UI smoke перевіряє, що native radio chrome не повернувся, `display:none` не використовується, а checked state не має `inset` ring.

---

## v0.63.11 - CRM 63.11: Скоро-вкладки профілю

### Профіль / gamification lockdown [codex]
- **Інвентар і Магазин стали Creator-only** - вкладки залишаються видимими, але для всіх ролей крім `Creator` відкривають контрольований soon-стан замість робочого контенту або покупок.
- **Щоденні, Сезон, Команди та Реферали закриті для всіх** - незавершені gamification-розділи більше не показують напівготову логіку, а чесно маркуються як `скоро`.
- **Скоро-маркер став явним** - кнопки отримали діагональний бейдж `скоро`, а клік веде у єдиний coming-soon panel із темною темою і без вигляду зламаного UI.
- **Інвентар без backpack-візуалу** - порожній стан інвентарю прибрано від тестової backpack-картинки, а прямі renderer/action guards не дають обійти lockdown через стан вкладки.
- **Legacy popup теж закрито** - старий profile game шар у `js/auth.js` отримав той самий Creator-only guard для інвентарю і магазину, щоб не лишати другий шлях доступу.
- **Guardrail** - додано focused unit smoke для ролей профілю та UI-check, який фіксує soon badges, рольові guard-и і legacy fallback.

---

## v0.63.10 - CRM 63.10: Редагована HR структура

### HR / структура компанії [codex]
- **Оргструктура стала editable node model** - `HR -> Структура` більше не залежить від hardcoded HTML-картинки: вузли рендеряться з JSON-моделі `nodes[]`.
- **Картки замість picture-like вузлів** - схема отримала чисті CRM-картки з рівнями, підписами, групами/стеками та адаптивним горизонтальним полотном.
- **Директор без корони** - crown-елемент прибрано повністю, а Director отримав gear-style treatment як системний root-вузол.
- **Кожен вузол редагується** - вибір вузла відкриває деталі, а кнопка редагування дозволяє змінити назву, опис, тип, рівень, parent, групу, порядок і підпис.
- **Збереження сумісне зі старим contract** - старі `structure`/`instructions` залишилися в тому ж `/api/hr/company-structure`, а структуровані вузли додано поруч у `settings.value` без нової таблиці.
- **Guardrail** - route smoke перевіряє `GET/PUT /api/hr/company-structure` з node payload, а UI smoke блокує повернення crown/hardcoded-only org chart.

---

## v0.63.9 - CRM 63.9: Резюме у вакансіях HR

### HR / вакансії та резюме кандидатів [codex]
- **Резюме можна додати текстом** - у flow `HR -> Вакансії -> + Кандидат` з'явився окремий intake-modal з полем для вставленого тексту резюме/анкети.
- **Резюме можна завантажити файлом** - кандидат створюється як звичайний `job_applications` запис, після чого файли прив'язуються до нього через multipart endpoint `/api/hr/applications/:id/resume-files`.
- **Файли зберігаються в Postgres** - додано `job_application_resume_files` з метаданими, `BYTEA`-вмістом, статусом extraction і без нового локального `/uploads` сегмента.
- **Текстові файли імпортуються чесно** - TXT/MD/CSV/JSON читаються у `raw_application_text`, а PDF/DOC/DOCX/RTF/ODT зберігаються як вкладення з видимою fallback-підказкою для ручного тексту.
- **Кандидатська картка стала кориснішою** - kanban показує бейдж резюме, detail-modal відкриває текст, extracted content і кнопки авторизованого завантаження файлів.
- **Guardrail** - route smoke перевіряє pasted text, upload, metadata і download, а UI smoke фіксує новий intake/detail contract.

---

## v0.63.8 - CRM 63.8: Костюмерна в Арті

### Art / перенесення костюмерної [codex]
- **Костюмерна переїхала в Art Director** - `/art` отримав окрему вкладку `Костюмерна` з native Art surface, кнопкою додавання і списком костюмів.
- **HR більше не володіє видимим модулем** - з HR прибрано top-level tab, старий `costumes` deep-link мʼяко веде на `/art?tab=costumes`.
- **Data flow не зламано** - таблиця `costumes` і старий `/api/hr/costumes` залишились сумісними, а новий `/api/art-director/costumes` використовує спільний `services/costumeInventory.js`.
- **Доступ вирівняно з Art** - `art_director` і `marketer` можуть відкривати Art workspace та працювати з костюмерною без доступу до HR-сторінки.
- **Guardrail** - UI smoke перевіряє відсутність HR tab, наявність Art tab, handoff deep-link, а route smoke перевіряє list/create через Art API.

---

## v0.63.7 - CRM 63.7: Dashboard Board Postgres

### Dashboard Board / canonical Postgres persistence [codex]
- **Джерело правди зафіксовано** - board state офіційно лишається у `dashboard_configs.layout.boardState` через `/api/dashboard/config`, без окремої Supabase-гілки.
- **Supabase не в live board path** - перевірено `routes/dashboard.js` і `js/dashboard-page.js`: вони не імпортують `db/supabase`, не викликають `getSupabase` і не створюють паралельний source of truth.
- **Postgres contract став явним** - `routes/dashboard.js` має `DASHBOARD_CONFIG_PERSISTENCE` і єдині SQL-константи для read/upsert `dashboard_configs`.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` перевіряє canonical Postgres path, `/api/dashboard/config`, JSONB `layout`, save/reload нормалізацію і відсутність Supabase у touched path.

---

## v0.63.6 - CRM 63.6: Мобільний таймлайн live

### Release / git deploy [codex]
- **Окремий git-deploy реліз** - піднято видиму версію до `0.63.6`, оновлено cache-bust посилання, service worker cache і `/api/version`, щоб live точно віддавав найсвіжіший мобільний таймлайн.
- **Зміни зібрані в одному live-маркері** - реліз включає попередні hardening-и для Android, iPhone 11, інших iPhone та iPad без додаткового переписування логіки бронювань.
- **Що перевірено перед деплоєм** - version sync, UI smoke і повний локальний baseline мають підтвердити, що таймлайн і release metadata не роз'їхались.

---

## v0.63.5 - CRM 63.5: iOS та iPad таймлайн

### Timeline / iOS та iPad responsive hardening [codex]
- **iPhone 11 та інші iPhone тримають мобільну геометрію** - таймлайн синхронізує `--eg-viewport-width` і `--eg-viewport-height` з `visualViewport` / `innerWidth`, тому Safari address bar не залишає старі розміри клітинок.
- **iPad не розтягує всю сторінку вправо** - root timeline отримав `timeline-dashboard-root`, а tablet CSS ховає тільки page-level overflow; внутрішній горизонтальний скрол таймлайну лишився в `.timeline-scroll`.
- **Touch-safe прокрутка для iOS/iPadOS** - timeline scroll має явні `touch-action`, `-webkit-overflow-scrolling` та dynamic viewport height fallback.
- **Guardrail** - `tests/ui-check.js` перевіряє iOS/iPad viewport hardening, root class і tablet shell overflow guards.

---

## v0.63.4 - CRM 63.4: Android таймлайн

### Timeline / Android responsive density [codex]
- **Таймлайн знову стискається на Android** - `applyTimelineResponsiveDensity()` тепер читає реальний lexical `CONFIG`, а не `window.CONFIG`, тому JS-геометрія клітинок запускається на мобільних браузерах.
- **Бронювання видно без ручного пошуку** - на вузькому Android viewport клітинки переходять до мобільної щільності, і перші блоки бронювань не від'їжджають за межу першого видимого екрана.
- **Viewport реагує на Android address bar** - responsive resize тепер слухає `visualViewport.resize` і `visualViewport.scroll`, щоб таймлайн перераховував ширину після зміни мобільної панелі браузера.
- **Guardrail** - `tests/ui-check.js` перевіряє, що timeline density більше не залежить від `window.CONFIG` і має visualViewport hooks.

---

## v0.63.3 - CRM 63.3: Dashboard для Android

### Dashboard Board / Android openability hardening [codex]
- **Shell відкривається до важкого board-render** - `DashboardPage.init()` тепер показує authenticated shell одразу після верифікації сесії, тому Android/WebView не лишає користувача на прихованому `#mainApp`, якщо board-сцена стартує повільно або падає.
- **Init без подвійного старту** - додано idempotent init promise, щоб inline auth flow і `DOMContentLoaded` не запускали dashboard одночасно на повільних мобільних браузерах.
- **Безпечний fallback замість blank screen** - помилка config/render більше не блокує весь dashboard: board shell відкривається з попередженням, а CRM shell лишається доступним.
- **Touch-safe взаємодія** - `setPointerCapture` загорнуто в guarded helper для Android Chromium/WebView, а board shell, canvas, anchors і resize handles отримали явні touch-action/scroll rules.
- **Мобільний viewport** - dashboard використовує `--eg-viewport-height` з `visualViewport` / `innerHeight` fallback та responsive висоти для board shell на вузьких екранах.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` покриває init guard, viewport fallback, touch-safe pointer capture і mobile board shell CSS.

---

## v0.63.2 - CRM 63.2: Вільна dashboard-дошка

### Dashboard Board / freeform interaction model [codex]
- **Вільніша сцена за замовчуванням** - нові й неповні `boardState` тепер стартують у `freeform` snap mode без примусової прив'язки до сітки; toolbar і settings показують цей стан чесно.
- **Коло й квадрат без овального дрейфу** - `circle` і `square` лишаються з рівними `w`/`h` під час створення, нормалізації та resize; для них показуються тільки кутові ручки, щоб інтерфейс не підказував прямокутне розтягування.
- **Planner не блокує об'єкти** - planning overlay опущено під board items, тому зайняті зони більше не перехоплюють drag/select над фігурами чи віджетами.
- **Конектори йдуть за об'єктами під час руху** - SVG-шар конекторів тепер перераховує endpoint-и ще під час drag/resize під'єднаного item, а не тільки після відпускання миші.
- **М'якше anchor snapping** - connector mode має більший безпечний радіус пошуку anchor-ів для старту, preview, завершення й редагування endpoint-а, без введення нового free-point persistence-контракту.
- **Сумісність без міграції схеми** - backend і frontend sanitizer-и синхронно нормалізують `freeform`/`snapToGrid`, а наявні shapes/connectors лишаються в поточному evolutionary board JSON.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` покриває equal resize для circle/square, live connector rerender під час руху, near-anchor canvas snapping і дефолтний freeform state.

---

## v0.63.1 - CRM 63.1: Оновлений арт-модуль

### Art / standalone shell refresh [codex]
- **Shell без зайвого лівого зазору** - `/art` отримав окремий `art-shell`: внутрішній `.artdir-page` більше не центрується як стара плита всередині `page-container`, тому контент сидить рівно в CRM workspace.
- **Сучасний верх модуля** - голий `h1` замінено на компактний module hero з `page-kicker`, описом і швидкими діями для конвеєра та афіші.
- **Оновлені tabs і surfaces** - навігація стала `tablist` з `aria-selected`, а overview, recent changes, pipeline, templates, Brand Book і iframe-tabs отримали чистіші standalone surfaces.
- **Сумісність iframe-вкладок** - `/programs?embedded=1`, `/designs?embedded=1` і `/graduation?embedded=1` лишилися lazy-loaded через наявний `data-src` контракт.
- **Нормалізація назв** - у sidebar сторінка тепер називається `Арт`, а роль показується як `Арт-директор`.
- **Guardrail** - `tests/ui-check.js` перевіряє `art-shell`, hero, accessible tabs, iframe contracts, breakpoint guards і відсутність старого sidebar label.

---

## v0.63.0 - CRM 63: Новий дашборд задач

### CRM 63 / задачі, підзадачі та перенесення [codex]
- **Підзадачі прямо в картці** - `Tasks` і `Profile / My Cabinet` тепер отримують реальні subtask rows у спискових API-відповідях, тому декомпозовані задачі відкривають підпункти inline без полювання за дрібним toggle.
- **Клікабельне `Прострочено`** - overdue-бейдж `Прострочено · дата` став дією у задачах і профілі: меню пропонує `Завтра`, `Післязавтра` або власну дату.
- **Чесний дозвіл на перенесення** - у створенні задач додано прапорець `Дозволити перенесення`; backend зберігає це в `control_meta` і блокує reschedule/schedule, якщо дозвіл вимкнено.
- **Стабільне перенесення** - canonical reschedule оновлює не тільки `deadline`, а й робочу `date`, скидає snooze/reminder і виводить задачу зі старого overdue bucket після reload.
- **Guardrail** - додано фокусні тести для inline підзадач, profile overdue menu, `canReschedule` policy, list projection з subtask rows та UI guardrails для нових кнопок.

---

## v0.62.31 - Dashboard Board: sandbox UX

### Dashboard Board / sandbox usability [codex]
- **Зрозуміла сім’я інструмента** - board тепер веде явний `toolFamily` для navigate/insert/draw/shape/connect і синхронізує це в toolbar, canvas та stage dataset-станах.
- **Палітра без debug-відчуття** - компактний rail показує людські назви груп, активну групу та hover-підказки для іконок, не роздуваючи CRM shell.
- **Контекстні canvas hints** - сцена показує коротку підказку для активного інструмента, а connector draft окремо нагадує завершити зв’язок або скасувати через Esc.
- **Esc/cancel guardrail** - transient-стани connector draft, draw/resize/endpoint/drag тепер централізовано очищаються і повертають оператора до `select`.
- **М’якші affordances** - selection ring, resize hover, cursor states і empty state стали виразнішими, але без переходу в чужий whiteboard-стиль.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` перевіряє active tool family, canvas hint, active palette state і cancel reset.

---

## v0.62.30 - Dashboard Board: зв’язки-стрілки

### Dashboard Board / connector interaction [codex]
- **Стрілка стала connector-режимом** - активний інструмент `arrow` більше не створює статичну shape-фігуру; він входить у `board:connect` і використовує наявний `boardState.connectors`.
- **Два кліки з live preview** - перший клік обирає стартовий anchor, рух курсора показує SVG-прев’ю, другий клік по валідному об’єкту зберігає connector.
- **Anchor snapping** - під час наведення підсвічується найближча доступна точка прив’язки; endpoint-и лишаються item-anchor парою без небезпечного free-point розширення контракту.
- **Connector-и рухаються з об’єктами** - шлях зв’язку перераховується з bounds під’єднаних board items після переміщення, включно з primitive shapes.
- **Сумісність legacy arrow** - старі `shape: "arrow"` записи продовжують рендеритися як legacy static geometry, але новий toolbar flow не додає такі об’єкти.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` перевіряє arrow draft flow, snapping preview, persisted connector creation і rerender після руху об’єкта.

---

## v0.62.29 - Dashboard Board: сценові фігури

### Dashboard Board / scene-native primitives [codex]
- **Фігури без карткової оболонки** - `shape`-обʼєкти тепер мають окремий primitive renderer без `workspace-module`, title bar і widget-style actions; widgets, notes і text лишаються на своєму framed-шляху.
- **Справжнє коло** - додано явний shape/tool `circle`, створення й нормалізація тримають рівні `w`/`h`, тому коло не є CSS-овалом на прямокутних bounds.
- **Справжній квадрат** - додано явний shape/tool `square` з рівними сторонами за замовчуванням і ratio-safe resize/normalization.
- **Сумісність board state** - backend/frontend sanitizer продовжує приймати старі `rect` та `ellipse`, а `circle`/`square` додано як вузьке розширення поточного JSON-контракту.
- **Guardrail** - `tests/dashboard-board-ergonomics.test.js` перевіряє scene-native DOM path для primitives, рівні розміри circle/square і збереження framed shell для notes.

---

## v0.62.28 - Профіль: фото і сесії без шуму

### Profile / налаштування акаунта [codex]
- **Аватар без emoji-шуму** - у налаштуваннях профілю прибрано швидкий emoji-вибір; fallback тепер використовує літеру з імені та колір, а не випадковий emoji.
- **Нормальне фото з пристрою** - upload з комп'ютера або телефона став одним зрозумілим блоком із вибором файлу, preview, розміром файлу, кнопкою збереження і скиданням вибору.
- **URL як додатковий шлях** - вставка прямого посилання на фото лишилась доступною, але винесена в окремий компактний розділ, щоб не ламати основний сценарій завантаження.
- **Сесії без зайвих повторів** - список активних сесій групує refresh-token повтори за пристроєм/IP і показує активні пристрої, а не десятки однакових рядків браузера.

---

## v0.62.27 - Надійне скидання пароля акаунта

### HR Accounts / керування доступом [codex]
- **Стійкий reset пароля** - `/api/users/:id/reset-password` приймає основний `newPassword` і сумісні manual payload-и `password` / `manualPassword`, тому старий або кешований frontend більше не губить ручну зміну пароля.
- **Перевірка hash перед записом** - новий пароль одразу перевіряється через bcrypt перед оновленням `users.password_hash`; при неможливому збої route не показує фальшивий успіх.
- **Операторський proof після зміни** - HR Accounts після ручного reset-а показує точний логін для входу, статус акаунта і факт скидання старих сесій, без показу або зберігання старого пароля.
- **Безпека audit** - account security audit додатково чистить `manualPassword`, щоб сирі паролі не потрапляли у журнал подій.

---

## v0.62.26 - Швидке перенесення прострочених задач

### Profile / Мій день overdue quick actions [codex]
- **Прострочено як дія** - у вкладці `Мій день` фраза `Прострочено` на overdue-задачі відкриває компактне меню перенесення прямо в профільному cockpit.
- **Канонічний reschedule** - варіанти `На сьогодні`, `На завтра`, `На вечір` і `На іншу дату` пишуть через `POST /api/tasks/:id/reschedule`, без profile-only локального стану.
- **Правдиве оновлення** - після успішного перенесення профіль заново підтягує дані, щоб прострочений список і counters не залишались застарілими.
- **Без втрати швидких дій** - кнопки `Готово` і `В роботу` залишились на overdue-рядках, а меню має світлу/темну стилізацію та закривається по кліку назовні або Escape.

---

## v0.62.25 - Темна тема за замовчуванням

### Dark-first CRM shell [codex]
- **Темна тема за замовчуванням** - користувачі без ручного вибору теми тепер відкривають CRM у темній темі на всіх основних і standalone-сторінках.
- **Ручний вибір збережено** - явне `pzp_dark_mode=false` і далі вмикає світлу тему, тому персональний вибір не перетирається релізом.
- **Єдиний bootstrap-контракт** - inline anti-flash snippets, `config.js`, Chat, Profile, HR, Leads, Shop і mini-game bootstrap переведено на dark-first правило.
- **Guardrail** - UI smoke тепер перевіряє, що темна тема лишається default-контрактом і не відʼїжджає назад у system/light fallback.

---

## v0.62.24 - Сертифікати: реєстр і preview

### Довіра до реєстру сертифікатів [codex]
- **Джерело видачі** - додано durable metadata `issue_source` / `batch_group_id`, одинична й пакетна видача проходять через різні row-level маркери без слабких UI-евристик.
- **Картки реєстру** - кожен сертифікат показує джерело, точний день/час видачі та оператора, який його видав; пошук також враховує тип і видавця.
- **Preview повернуто** - standalone result/detail flow отримав shared canvas-preview на базі старої сезонної логіки, а detail modal має візуальний сертифікат, метадані й `Скачати PNG`.
- **Чесні counters** - `/api/certificates` повертає status/source breakdown для поточного фільтра, тому UI більше не рахує статистику з перших 200 карток.
- **Shell polish** - прибрано локальний дубль `profileModal` із certificates page і перероблено batch quantity picker без native radio-ring.

---

## v0.62.23 - Повноширинний профіль

### Профіль як повноцінний CRM-модуль [codex]
- **Ширший shell** - Profile / Мій кабінет більше не обмежений вузькою centered-сторінкою: основний wrapper використовує доступну ширину CRM shell і має desktop cap для читабельності.
- **Сильніша шапка і вкладки** - profile header, summary-картки та primary tabs отримали більший ритм, чистіші активні стани й менш popup-подібну композицію.
- **Адаптивний overview** - головний огляд профілю переведено на контрольований desktop grid із окремими зонами для статусу, задач, ризиків, прогресу й активності.
- **Responsive / dark mode** - додано breakpoint-и для laptop/tablet/mobile і dark-mode фон, щоб розширення desktop-версії не створювало горизонтального зламу.

---

## v0.62.22 - Чистий кабінет і досягнення

### Кабінет без зайвої productivity-панелі [codex]
- **Мій день** - прибрано великий блок `Особиста продуктивність`, який дублював задачі, графіки й окремі derived-досягнення та перевантажував кабінет.
- **Канонічні досягнення** - task/decomposition milestone-и перенесено в існуючу систему `/api/achievements`, щоб прогрес за задачі, підзадачі, AI і шаблони жив у вкладці `Досягнення`, а не в окремому дашборді.
- **Менше зайвих запитів** - Profile більше не тягне `/api/tasks/productivity` для `Мій день` / `Мої задачі`; задачі, підзадачі, швидкі картки й split-count залишаються без змін.
- **Guardrail** - додано статичну перевірку, що productivity-панель не повертається в Profile, а decomposition achievements залишаються під канонічним achievements route.

---

## v0.62.21 - Задачі: виконано/активні

### Розділена картка задач у кабінеті та sidebar [codex]
- **Split-картка задач** - швидкий блок `Задачі` в My Cabinet тепер показує два сегменти в одній картці: зліва виконані задачі, справа активні.
- **Sidebar widget** - focus chip задач у sidebar використовує той самий completed/active contract і має компактний split-вигляд із візуальним розділенням.
- **Сьогодні або без дати** - активний workload у quick-віджеті рахує тільки задачі на сьогодні або без дати; задачі, заплановані на завтра чи пізніше, не збільшують цей показник.
- **Guardrail** - `profile-tasker-segments` і UI smoke перевіряють split-card markup та забороняють повернення широкого `assigned + in_progress` підрахунку в sidebar.

---

## v0.62.20 - Нові задачі зверху

### Нові задачі у "Мій день" [codex]
- **My Day ordering** - задачі, створені з Profile / "Мій день", більше не падають униз списку: щойно створена задача піднімається першою у видимому slice.
- **Стабільний refetch** - `/api/tasks/my-cabinet` отримав newest-first tie-breaker для задач з однаковим денним bucket, тому порядок після перезавантаження не залежить від випадкового SQL-порядку.
- **Guardrail** - `profile-tasker-segments` перевіряє, що декомпозовані групи зберігаються зверху, а новіші задачі всередині slice йдуть вище старіших.

---

## v0.62.19 - Українські тексти задач

### Українські тексти задач і нагадувань [codex]
- **Tasks/Profile copy** - прибрано видимі `canonical Tasks`, `cockpit`, `Completion`, `review` і `board` з tasker/productivity поверхонь; користувач бачить природні українські назви.
- **Типи задач** - `Follow-up`, `Deep work` і `Checklist` у бейджах, create-flow та detail editor замінено на `Дотиск`, `Глибока робота` і `Чеклист`.
- **Нагадування і Copilot** - follow-up/reminder тексти в Copilot і chat reminder API повертають українські повідомлення без англійських службових фраз.
- **Guardrail** - UI-smoke перевіряє, що скріншотні регресії `canonical Tasks` / `cockpit` і видимі follow-up англіцизми не повертаються.

---

## v0.62.18 - Центр керування акаунтами

### Центр керування акаунтами [codex]
- **Canonical binding** - `users` лишається правдою акаунта, `employee_profiles` стає єдиним safe-bridge для звʼязку акаунта зі staff/person, а staff/schedule працюють як helper launcher-и.
- **HR Accounts backbone** - у HR Accounts додано контроль conflict-state: unlinked users, unlinked staff, inactive links, duplicate Telegram identities і ambiguous profiles.
- **Embedded actions** - HR Team і Staff graph отримали швидкі дії: відкрити linked account, привʼязати існуючий акаунт, створити акаунт для staff-профілю та повернутись у canonical HR Accounts.
- **One-time credentials** - створення акаунта і reset/reissue пароля підтримують одноразову видачу логіна/пароля без показу старих паролів; legacy CSV/PDF export паролів для bulk-create вимкнено.
- **Guardrail** - linkage writes у `users`, `staff` і `employees` заведено через shared `services/accountLinking.js`, додано contract-test для linkage, conflict report і credential policy.

---

## v0.62.17 - Підпункти задач у списку

### Підпункти задач у списку [codex]
- **Inline checklist** - декомпозовані задачі у Tasks і Profile / My Cabinet отримали компактне розгортання підпунктів прямо в картці, без переходу в detail modal.
- **Послідовне виконання** - підпункти можна закривати у будь-якому порядку, але parent task стає доступною для виконання тільки після закриття всіх підпунктів.
- **API guardrail** - `completeTask` і bulk done більше не закривають decomposed parent task з відкритими `task_subtasks`; повертається `SUBTASKS_INCOMPLETE`.
- **Пріоритет у списку** - активні задачі з підпунктами піднімаються вище у Tasks і My Cabinet, щоб робочі checklist-и не губилися серед звичайних задач.
- **Guardrail** - додано unit-перевірку `subtaskCompletionState`, оновлено UI без native browser dialogs.

---

## v0.62.16 - Шаблони декомпозиції задач

### Шаблони декомпозиції задач [codex]
- **Live baseline** - production smoke підтвердив `v0.62.15` на Railway, `/api/health` з підключеною БД та `/api/version`; повний authenticated UAT заблокований відсутністю `TEST_USER` / `TEST_PASS` або live session token у workspace.
- **Збережені шаблони** - додано персональні `task_decomposition_templates` і `task_decomposition_template_items` з owner scope, ordered items, source metadata, usage counter та soft-delete.
- **Canonical flow** - Tasks і Profile / My Cabinet отримали однакові дії: зберегти поточні підзадачі як шаблон, застосувати шаблон у editable draft, оновити шаблон з поточного списку або видалити його.
- **Розумні підказки** - `/api/tasks/decomposition-suggestions` ранжує saved templates і повторювані історичні структури задач за title/category/history signal без AI-магії та без автозбереження.
- **Guardrail** - додано `tests/task-decomposition-library.test.js`, міграцію `212_task_decomposition_saved_templates.sql` і збережено Phase 1-3 contract: persisted subtasks і прогрес лишаються через `task_subtasks`.

---

## v0.62.15 - Продуктивність задач

### Продуктивність задач [codex]
- **Personal cockpit** - у Profile / My Cabinet додано компактну поверхню продуктивності з completed today, 7/30 days, completion rate, overdue, підзадачами та task streak.
- **Аналітика задач** - новий `/api/tasks/productivity` рахує метрики тільки для поточного користувача з canonical `tasks` і `task_subtasks`, без окремої shadow-аналітики.
- **Декомпозиційні insights** - cockpit показує decomposed vs non-decomposed completion, AI/template usage і source split, де `template_ai` чесно виводиться лише з persisted child source mix.
- **Досягнення** - starter milestones для 10 задач, 7-day streak, parent tasks, decomposition usage, AI-assisted і template-assisted completions працюють як derived/idempotent стан без дублювання game achievement tables.
- **Guardrail** - додано `tests/task-productivity.test.js` для summary metrics, streak calculation, source grouping і starter achievements.

---

## v0.62.14 - AI-декомпозиція задач

### AI-декомпозиція задач [codex]
- **AI draft** - канонічний task creator отримав `/api/tasks/decompose-draft`, який пропонує підзадачі через shared `ai-config` без прихованого збереження.
- **Шаблони** - додано реальні starter-сімейства для побутових задач, підготовки події, контенту та CRM/sales follow-up; template-assisted режим має чесний fallback, якщо AI недоступний.
- **Human review** - Tasks і Profile / My Cabinet показують згенеровані підзадачі як editable draft rows: їх можна прийняти, змінити, видалити, додати свої або згенерувати повторно перед save.
- **Phase 1 contract** - збереження йде через існуючий `subtasks` payload і `task_subtasks.source_type` (`manual`, `template`, `ai`), а прогрес лишається equal-weight.
- **Guardrail** - додано `tests/task-decomposition.test.js` для шаблонів, AI JSON parsing, duplicate cleanup, fallback і empty/error states.

---

## v0.62.13 - Підзадачі та прогрес задач

### Підзадачі та прогрес задач [codex]
- **Модель** - `task_subtasks` отримала source metadata для ручних, шаблонних і майбутніх AI draft-підзадач; існуючі задачі без підзадач не змінюють поведінку.
- **Canonical Tasks** - `POST /api/tasks` і `PUT /api/tasks/:id` приймають `subtasks`, а detail/API payload повертає `subtaskCount`, `subtaskDoneCount` і `subtaskProgress`.
- **Tasks + Profile** - швидке створення задач у Tasks і My Cabinet підтримує ручне розбиття на підзадачі, а картки показують однаковий прогрес з canonical task truth.
- **Detail editor** - task detail modal дозволяє додавати, перейменовувати, видаляти, чекати і переставляти підзадачі з durable save через основний task update flow.
- **Guardrail** - додано `tests/task-subtasks.test.js` для нормалізації payload, source type і equal-weight progress.

---

## v0.62.12 - Сертифікати: пакет одноразових

### Сертифікати: пакет одноразових [codex]
- **Пакет сертифікатів** - сторінку перейменовано на `Пакет сертифікатів на одноразовий вхід`.
- **UX** - з пакетної видачі прибрано вибір типу сертифіката; оператор бачить фіксований тип `На одноразовий вхід`.
- **Backend** - `/api/certificates/batch` примусово зберігає batch-сертифікати як `на одноразовий вхід`, навіть якщо старий клієнт передасть інший тип.
- **Guardrail** - UI-smoke перевіряє, що batch-форма не має selector типу і користується фіксованим one-time entry контрактом.

---

## v0.62.11 - Таймлайн: кімнати і видимість

### Таймлайн: кімнати і видимість [codex]
- **Кімнати** - панель навантаження кімнат тепер відкривається у темному стилі CRM, без білого drawer у dark theme.
- **Закриття** - у панелі кімнат додано явну кнопку `Закрити`, підтримку `Esc` і закриття кліком поза панеллю.
- **Видимість** - `Продажі` та `Експорт` більше не конфліктують між auth-permission і конструктором видимості.
- **Guardrail** - UI-smoke перевіряє темізацію панелі кімнат, close affordance і permission-клас для visibility constructor.

---

## v0.62.10 - МД: лінія Олександр

### МД: лінія Олександр [codex]
- **Таймлайн МД** - основна лінія консультацій тепер показується як `Олександр`, а не як технічний `Таймлайн МД`.
- **Дані** - додано scoped migration `210_maysternya_doli_oleksandr_line_label.sql`, яка перейменовує лише дефолтну лінію `md-consult-room` у бізнес-контексті `maysternya_doli`.
- **Fallback** - frontend нормалізація також підхоплює старі назви `Майстерня долі` і `Таймлайн МД`, щоб UI одразу показував правильний label.

---

## v0.62.9 - Profile tasker: виконання зі звітом

### Profile tasker: виконання зі звітом [codex]
- **Profile** - сегмент `Чекаю` у меню задач замінено на робочий сегмент `Виконати`, щоб primary flow був про завершення задачі.
- **Звіт перед виконанням** - задачі з `control_meta.reportRequired` не можна закрити без звіту; UI одразу відкриває форму звіту.
- **Backend rule** - canonical `POST /api/tasks/:id/complete`, quick status close і work-queue done перевіряють report-required контракт на сервері.
- **Reports linkage** - звіт зберігається у існуючій таблиці `reports`, а прив'язка фіксується в `tasks.control_meta.reportId`.
- **Guardrail** - додано route smoke на блокування задачі без звіту і успішне виконання після прив'язаного report.

---

## v0.62.8 - Таймлайн: Парк за замовченням

### Таймлайн: Парк за замовченням [codex]
- **Меню** - основна кнопка таймлайну тепер називається просто `Таймлайн`, без зайвого бізнес-суфікса.
- **Дефолт** - швидкий доступ для `creator` теж веде на парковий таймлайн `/`, а не на МД.
- **Доступ** - контекст `Таймлайн МД` і перемикання бізнес-таймлайну доступні тільки ролі `creator`; `pageAllowlist` більше не відкриває цей контекст.

---

## v0.62.7 - Profile: фільтри задач

### Profile: фільтри задач [codex]
- **Мої задачі** - фільтри `Особисті`, `Приватні`, `Чекаю` та `Ідеї` тепер читають canonical task fields ширше і не гублять задачі.
- **Сегменти** - `me_only` входить в особисті, `waiting` працює через workflow/kind/status, а `improvement` входить в ідеї.
- **Guardrail** - додано `tests/profile-tasker-segments.test.js`, який прямо перевіряє всі profile tasker chips.

---

## v0.62.6 - МД: бізнес-контексти CRM

### МД: бізнес-контексти CRM [codex]
- **Business context** - клієнти, ліди, customer cards, mailing та глобальний пошук працюють з активним `business_context`, щоб МД не змішувалась із ПАРК.
- **Бронювання → CRM** - non-park бронювання продовжують scoped customer/lead handoff через існуючий CRM pipeline без дублювання між бізнесами.
- **Таймлайн** - конструктор видимості знову відкривається, має компактну gear-кнопку, серверне збереження налаштувань і ширший registry елементів.
- **Звіти** - close-flow зберігає locked snapshot і покритий guardrail-ом на accountant handoff task, а не тільки на візуальний статус.
- **Guardrail** - UI-smoke і timeline/booking unit tests перевіряють бізнес-контексти, пошук, constructor trigger і scoped lead handoff.

---

## v0.62.5 - Profile: tasker cockpit

### Profile: tasker cockpit [codex]
- **Мої задачі** - вкладка профілю отримала повноцінний daily cockpit із видимим створенням задачі, кращою ієрархією і читабельнішими рядками.
- **Категорії** - chips `Всі мої`, `Особисті`, `Приватні`, `Робочі`, `Чекаю` та `Ідеї` мають реальні count-и і фільтруються через ту саму семантику, що Tasks page.
- **Створення** - Profile більше не має окремого локального create-шляху: payload будується через shared `TaskCreate` adapter і йде у canonical `/api/tasks`.
- **Guardrail** - UI-smoke перевіряє shared adapter, composer, truthful segment counts і нову структуру Profile tasker.

---

## v0.62.4 - Changelog: логічна історія релізів

### Changelog: логічна історія релізів [codex]
- **Версії** - видимий changelog більше не стрибає з `v0.62.x` одразу на `v0.61.51`.
- **Історія релізів** - у модалку "Що нового" повернуто пропущені записи `v0.62.2`, `v0.62.0` та проміжні `v0.61.56`-`v0.61.52`.
- **Порядок** - релізи у `index.html` тепер ідуть послідовно згори вниз: найновіший першим, старіші нижче.
- **Guardrail** - version sync лишається прив'язаний до `package.json`, щоб поточна версія, кнопка changelog і перший запис модалки не роз'їжджались.

---

## v0.62.3 - Дашборд: зручне вікно віджетів

### Дашборд: зручне вікно віджетів [codex]
- **Вікно віджетів** - налаштування дашборду перероблено у повноцінний двопанельний workspace замість вузького списку на один рядок.
- **Каталог** - праворуч додано великий каталог віджетів із пошуком, фільтрами `Усі` / `Увімкнені` / `Приховані`, лічильником і видимим порядком активних віджетів.
- **Board/сцена** - налаштування сцени і board-поведінки перенесені в окрему ліву колонку, щоб вони не з'їдали місце у списку віджетів.
- **Mobile** - на вузьких екранах каталог віджетів показується першим, а кнопки збереження залишаються доступними внизу.
- **Guardrail** - UI-smoke перевіряє нову структуру settings workspace, пошук, фільтри і мінімальну висоту списку.

---

## v0.62.2 - Швидкий доступ: порядок за ролями

### Швидкий доступ: порядок за ролями [codex]
- **Швидкий доступ** - `/afisha` додано у role-aware quick-access contract як окремий target, а не як ізольовану кнопку.
- **Animator** - для ролі `animator` перший quick-access пункт тепер `/afisha`, другий - таймлайн `/`.
- **Менеджери** - `manager`, `senior_manager`, `vice_director`, `director` і `creator` мають прямий quick-access на видачу сертифіката `/certificates/new`.
- **Sidebar** - fallback quick-access список включає `/afisha` і таймлайн, а access-фільтр таймлайну дозволяє `animator`, щоб рольовий пресет не відсікався на рендері.
- **Guardrail** - UI-smoke перевіряє рольовий порядок quick access, canonical `/afisha` target і shortcut видачі сертифіката.

---

## v0.62.0 - CRM 62: фіналізація пакету

### CRM 62: фіналізація пакету [codex]
- **Доставка** - зафіксовано фінальний релізний маркер `v0.62.0` після серії змін для Reports, Maysternya Doli, бізнес-контекстів, сертифікатів, таймлайнів і клієнтського CRM.
- **Reports** - стандартний звіт, compact picker, locked close-flow і бухгалтерський handoff входять у релізний пакет як завершений governed workflow.
- **Майстерня Долі** - CRM-ліди, клієнти, customer cards, mailing і бронювання працюють через `business_context`, без змішування з ПАРК.
- **Таймлайн** - ПАРК і МД мають окремі назви/контексти, МД не рендерить афішу, консультація МД заведена як 90 хв, продукти вантажаться за бізнес-контекстом.
- **Клієнти** - створення/оновлення клієнта має контрольований `409 customer_duplicate` для duplicate-випадків замість сирого `500 Internal server error`.
- **UI shell** - `/certificates`, `/certificates/new` і `/certificates/batch` вирівняні під shared CRM shell/assets; темний глобальний пошук має читабельний fallback.
- **Verification** - version refs, cache tags, service worker cache names і live smoke перевіряються як `v0.62.0`.

---

## v0.61.56 - UI: залишкові фікси

### UI: залишкові фікси [codex]
- **Пошук** - темний глобальний пошук отримав фінальний fallback у `dark-mode.css`, щоб підказки, результати й бейджі не ставали блідими на standalone/CRM сторінках.
- **Клієнти** - duplicate-помилки при створенні або оновленні клієнта тепер повертають контрольований `409 customer_duplicate` замість `500 Internal server error`.
- **Таймлайн МД** - рендер афіші додатково заблоковано на рівні staff-ліній, щоб у МД не виникали приховані/застарілі афішні слоти над графіком.
- **Guardrails** - додано UI/API контрактні перевірки для dark-search fallback, МД без афіші та duplicate-safe клієнтів.

---

## v0.61.55 - Bookings: CRM handoff МД

### Bookings: CRM handoff МД [codex]
- **Бронювання МД** - non-park бронювання без `leadId` тепер idempotent створюють або підхоплюють lead у тому ж `business_context`.
- **CRM-зв'язок** - після створення консультації система лінкує `leads.booking_id` і `customers.lead_id`, щоб клієнт і воронка МД не розходились.
- **Воронка** - підтверджені консультації потрапляють у `deposit_received`, попередні - у `waiting`, зі статусом `booked`.
- **Guardrail** - `lead-booking-link` unit test покриває створення нового scoped lead і повторне використання існуючого lead.

---

## v0.61.54 - Timeline: продукти з каталогу

### Timeline: продукти з каталогу [codex]
- **Таймлайн** - `getProducts()` тепер вантажить активні продукти з `/api/products` за поточним `businessContext`.
- **Майстерня долі** - консультації на `/maysternya-doli` беруться з серверного каталогу `maysternya_doli`, а `MAYSTERNYA_DOLI_PROGRAMS` лишається fallback.
- **Кеш** - продукти кешуються з ключем бізнес-контексту, щоб ПАРК і МД не підхоплювали чужий каталог.
- **Оновлення карток** - rebuild програм у формі бронювання реагує не тільки на зміну id, а й на назву, label, тривалість, ціну, ведучих і `updatedAt`.
- **Guardrail** - UI smoke перевіряє, що МД більше не байпасить API-завантаження продуктів.

---

## v0.61.53 - Products: бізнес-контекст

### Products: бізнес-контекст [codex]
- **Products** - `products` отримали durable `business_context`, scoped indexes і backfill у legacy `event_genix`.
- **Майстерня долі** - додано окремі consultation products у `maysternya_doli`; повна консультація зафіксована як `90 хв`.
- **API** - list/detail/create/update/document/deactivate потоки продуктів тепер фільтруються за бізнес-контекстом і не змішують ПАРК/МД.
- **UX** - сторінка Products передає активний бізнес-контекст у API і рендерить продукти МД з серверного каталогу.
- **Guardrail** - оновлено products IA тест і migration governance під нову межу продуктів.

---

## v0.61.52 - Certificates: ремонт shell меню

### Certificates: ремонт shell меню [codex]
- **Сертифікати** - закрито причину raw-shell на `/certificates/new`: legacy nested asset paths більше не провалюються в HTML fallback.
- **Сумісність кешу** - старі кешовані посилання `/certificates/css/...`, `/certificates/js/...` і `/certificates/images/...` редіректяться на кореневі assets.
- **Guardrail** - UI smoke перевіряє root-relative assets для standalone certificates routes і server-side redirect для старих nested asset URL.

---

## v0.61.51 - CRM: бізнес-контексти МД

### CRM: бізнес-контексти МД [codex]
- **Business context** - `leads`, `customers`, `customer_cards` і `mailing_list` отримали durable `business_context`, scoped indexes і backfill у legacy `event_genix`.
- **МД без змішування CRM** - списки, пошук, картки, воронка, customer-card, mailing і lead workspace тепер фільтруються за бізнес-контекстом, щоб Майстерня Долі не ділила клієнтів і лідів з парком.
- **Бронювання → CRM** - non-park бронювання знову можуть створювати/лінкувати клієнтів і лідів, але scoped до свого `business_context`; park-only finance/certificate/warehouse side effects лишились обмежені парком.
- **Конструктор видимості** - timeline visibility отримав server-backed settings endpoint для спільних налаштувань бізнес-контексту, а localStorage лишився кешем/fallback.
- **Звіти** - close-flow створює duplicate-safe task для бухгалтерського handoff, а не лише ставить lock-бейдж.
- **Guardrails** - оновлено route-smoke і lead-booking-link тести під scoped SQL; `test:unit`, `test:ui`, `check:syntax` і `check:migrations` проходять у доступному локальному runtime.

---

## v0.61.50 - Таймлайн: бізнес-перемикач і конструктор видимості

### Таймлайн: бізнес-перемикач і конструктор видимості [codex]
- **Єдиний таймлайн** - додано компактний перемикач бізнес-контексту між `Таймлайн ПАРК` і `Таймлайн МД` для користувачів, які мають доступ до обох просторів.
- **Конструктор видимості** - у таймлайні з'явився режим конструктора, де можна вимикати кнопки, блоки верхньої панелі, елементи форми бронювання, легенду, статистику та службові панелі.
- **Окремі налаштування бізнесів** - видимість зберігається через `TimelineBusinessContext.storageKey()`, тому ПАРК і МД мають незалежні конфігурації.
- **Guardrail** - UI smoke фіксує підключення `timeline-visibility.js`, registry елементів, permission-gate через `settings` і CSS для прихованих елементів.

---

## v0.61.49 - Таймлайн: прибирання фантомних аніматорів

### Таймлайн: прибирання фантомних аніматорів [codex]
- **Графік аніматорів** - під час синхронізації зі Staff порожні legacy-лінії `Аніматор 1/2` більше не лишаються поруч із реальними працівниками.
- **Збереження подій** - стару лінію не видаляємо, якщо на ній уже є активне бронювання або афіша, щоб не сховати реальний слот.
- **Regression guard** - контракт backoffice v2 фіксує cleanup для legacy default/manual ліній після появи Staff-графіка.

---

## v0.61.48 - Таймлайн МД: консультація 90 хв

### Таймлайн МД: консультація 90 хв [codex]
- **Таймлайн МД** - повна консультація у Майстерні Долі тепер має тривалість `90 хв` замість `40 хв`.
- **Картка бронювання** - label і опис програми оновлено до `Повна консультація(90)`, щоб у правій панелі не показувалась стара тривалість.
- **Regression guard** - UI smoke перевіряє, що консультаційний набір МД лишається тільки з демо `15 хв` і повною консультацією `90 хв`.

---

## v0.61.47 - Reports: стандартний звіт + close flow (Клешня, 23.05.2026)

### Reports: стандартний звіт + close flow [codex]
- **Звіти** - додано шаблон `Стандартний звіт` з фіксованими колонками `Дата`, `Категорія`, `Документ`, `Сума`, `Коментар` для парку.
- **Підсумки** - стандартний звіт рахує загальне `Ітого` та умовне `Ітого ДАР` для рядків категорії `дар`.
- **UX** - шаблони звітів переведено в компактний picker замість розростання ряду кнопок.
- **Lifecycle** - close-flow зберігає locked snapshot, блокує редагування закритого звіту і передає його в бухгалтерський контур через наявний reports/accountants workflow.
- **Regression guard** - jsdom reports workspace і UI smoke фіксують стандартний шаблон, subtotal `дар`, compact picker і locked close state.

---

## v0.61.46 - Customer Create Fallback

### Customer Create Fallback [codex]
- **Клієнти** - створення нового клієнта більше не падає `Internal server error`, якщо поле `customers.social_identities` у базі або Supabase має legacy-схему чи неочікуваний тип.
- **Збереження даних** - основні поля клієнта (`name`, `phone`, `instagram`, дитина, дата народження, джерело, нотатки) записуються навіть тоді, коли додаткові соц-ідентичності тимчасово недоступні.
- **Regression guard** - контракт operations-flow тепер фіксує fallback для legacy storage соц-ідентичностей клієнта.

---

## v0.61.45 - Timeline MD PARK Cleanup

### Timeline MD PARK Cleanup [codex]
- **Таймлайни** - навігація, пошук і feature registry тепер розділяють `Таймлайн МД` та `Таймлайн ПАРК` замість старих неоднозначних назв.
- **Таймлайн МД** - паркову афішу прибрано з MD-контексту: рядок `АФІША`, афішні блоки й API-запит не рендеряться на `/maysternya-doli`.
- **Default-лінія MD** - fallback-лінія записів і prompt швидкого додавання спеціаліста більше не повертають стару назву `Майстерня долі`.
- **Regression guard** - `test:ui` фіксує окремі назви таймлайнів і заборону афіші в MD-контексті.

---

## v0.61.44 - Search Dark Theme Contrast

### Search Dark Theme Contrast [codex]
- **Темна тема пошуку** - глобальна `Ctrl+K`-модалка більше не використовує світлий text-token як фон, тому результати, підказки й empty-state читаються на темній поверхні.
- **Підказки та навігація** - placeholder, підзаголовки, badges, `Esc`/`Enter` і стрілка переходу отримали явний dark contrast у `layout.css` та `features.css`.
- **Regression guard** - `test:ui` фіксує dark contrast contract, щоб сторінки з `features.css` не повертали світлий контейнер із блідим текстом.

---

## v0.61.43 - Reports Workspace Stabilization

### Reports Workspace Stabilization [codex]
- **Звіти** - стабілізовано create-flow: `Створити звіт з таблиці` тепер створює або оновлює реальний запис звіту і переводить workspace у режим редагування цього звіту.
- **Табличний builder** - додано назву звіту, режим `Новий звіт / Чернетка / Редагування`, dirty-state, блокування кнопок під час submit та підтвердження перед втратою незбережених змін.
- **Керування таблицею** - додано дублювання рядка, видалення колонок, live-перерахунок total-рядка і стабільні row/column handlers без повторних listener-regression.
- **Менше хаосу** - технічні `table-*` hashtags більше не створюють видимі toggle-картки/фільтри після створення табличного звіту.
- **Regression guard** - додано jsdom-тест reports workspace для dirty guard, row/column controls, create request і приховання технічних hashtags.

---

## v0.61.42 - Graduation Catalog Link Fix

### Graduation Catalog Link Fix [codex]
- **Products -> Випускний** - кнопка каталогу тепер відкриває канонічний красивий graduation catalog у `Designs`, а не окрему стару поверхню.
- **Designs deep-link** - `/designs#catalog-graduation` одразу відкриває viewer з пакетами випускного, як на дизайн-борді.
- **Менше плутанини** - з картки випускного прибрано другий дублюючий шлях “У Designs”, бо основна дія вже веде в правильний каталог.
- **Regression guard** - тест фіксує, що graduation catalog у Products веде в Designs viewer, а не в `/graduation`.

---

## v0.61.41 - Assistant Topbar Consistency

### Assistant Topbar Consistency [codex]
- **Помічник у шапці** - вирівняно shared topbar, щоб dashboard, timeline та інші CRM-сторінки показували одну компактну гарну версію Помічника.
- **Command row** - поле `Запитати або /команда` отримало стабільну центральну ширину й більше не стискається біля службових кнопок.
- **Header controls** - alert/search/theme/logout зафіксовані як єдиний utility cluster без зсуву Помічника на сторінках з різним набором кнопок.
- **Regression guard** - UI smoke check фіксує cross-page geometry contract для mounted assistant rail.

---

## v0.61.40 - Reports Template Backend Workflow

### Reports Template Backend Workflow [codex]
- **Звіти** - Excel-like workspace отримав backend registry шаблонів, персональні чернетки та повторне відкриття табличного звіту в редакторі.
- **Шаблони** - додано durable таблиці `report_templates` і `report_table_drafts` зі стандартними форматами для фінансів, операцій, payroll та кастомних звітів.
- **Експорт** - додано серверний XLSX export для поточної таблиці, CSV import у workspace і стабільний CSV path без нового dependency.
- **Контракт** - `submitted_via` розширено для `web-template`, щоб табличні звіти не падали на реальному DB constraint.
- **Пошук / Асистент** - `/reports` тепер знаходиться за “шаблони звітів”, “excel звіт”, “табличний звіт”, а асистент пояснює новий template/draft/export workflow.

---

## v0.61.39 - Reports Template Workflow

### Reports Template Workflow [codex]
- **Звіти** - додано Excel-like workspace: оператор обирає шаблон, редагує структуровану таблицю, експортує CSV або створює запис звіту.
- **Шаблони** - перший набір покриває фінансовий підсумок дня, операційний чекліст, payroll/команду та кастомну таблицю.
- **Upload templates** - JSON-шаблони з власними колонками, рядками, категорією й підказкою можна завантажити у Reports workspace без нового dependency.
- **Raw data contract** - таблична структура зберігається в існуючому `rawData` звіту; backend `PUT` тепер також приймає оновлення `rawData` без DB-міграції.
- **Regression guard** - UI smoke check фіксує template workspace, upload control, CSV export path і rawData save contract.

---

## v0.61.38 - Topbar Assistant Motion Polish

### Topbar Assistant Motion Polish [codex]
- **Topbar** - шапку CRM зібрано в один coherent product header: компактний статус Помічника, центральна command-строка та єдиний utility cluster.
- **Помічник** - зменшено візуальну домінантність rail: прибрано важкий неоновий контейнер, залишено компактний assistant status і slim contextual hint без layout jump.
- **Анімації** - додано state-based micro-interactions для idle, hover, listening, thinking/loading, success і error; motion обмежений transform/opacity та поважає `prefers-reduced-motion`.
- **Theme / Exit** - theme toggle використовує SVG glyphs замість emoji-style символів, а `Вийти` вирівняно з пошуком і theme як менш домінантний ghost-control.
- **Regression guard** - UI smoke check фіксує компактний topbar contract, unified 40px controls, assistant motion tokens і SVG theme glyphs.

---

## v0.61.37 - Profile Task Workflow Polish

### Profile Task Workflow Polish [codex]
- **Профіль** - верхні картки `Задачі / Алерти / Воронка` отримали явні підказки дії й залишились клікабельними як швидкі робочі переходи.
- **Мої задачі** - рядки задач отримали кольорові бейджі стану/строку: сьогодні, прострочено, чекаю, відкладено або без дати.
- **Будильник** - кнопка `⏰` відкриває меню відкладення на 15 хв, 1 год, 4 год, завтра або власний час.
- **Виконання** - після `✓` показується toast `Скасувати`, щоб випадкове виконання можна було одразу відкотити.
- **Regression guard** - UI smoke check фіксує undo-toast, snooze menu, due badges, action legend і hint-first quick cards.

---

## v0.61.36 - Profile Task Tooltip Fix

### Profile Task Tooltip Fix [codex]
- **Профіль** - кнопки задач у вкладці `Мої задачі` отримали зрозумілі українські hover/focus підказки.
- **Виконання задач** - кнопка `✓` тепер явно підписана як `Виконати задачу` і лишається привʼязаною до канонічного `/api/tasks/:id/complete`.
- **Будильник** - кнопка `⏰` пояснює дію як `Відкласти задачу на 60 хвилин`, без англійського `Snooze`.
- **Regression guard** - UI smoke check фіксує українські tooltip labels, зелений done-action styling і відсутність старого `title="Snooze"`.

---

## v0.61.35 - Profile Task Action Fix

### Profile Task Action Fix [codex]
- **Профіль** - робочий профіль на широких екранах закріплено ближче до лівого краю CRM-контенту, а не по центру всього полотна.
- **Мої задачі** - кнопки `готово`, `snooze` і `відкрити` у профілі переведено на delegated action contract з валідними `type="button"` і busy/error станом.
- **Tasks deep-link** - відкриття задачі з профілю тепер веде на канонічний `/tasks?view=my&open=...`, який реально читає Tasks page.
- **Regression guard** - UI smoke check фіксує left-anchored profile shell і новий data-action контракт кнопок задач.

---

## v0.61.34 - Design Catalog Add Item Cleanup

### Design Catalog Add Item Cleanup [codex]
- **Design catalog editor** - кнопка `+ Додати елемент` у full edit modal більше не генерує рядок через крихкий inline `insertAdjacentHTML`.
- **Catalog item rows** - нові елементи створюються через DOM API з валідними полями `icon/name/detail`, нормальними стилями і стабільним remove button.
- **Regression guard** - UI smoke check блокує повернення старого inline generator з `border:1px+solid` та сирим `_feItems.insertAdjacentHTML`.

---

## v0.61.33 - Safe New Tab Cleanup

### Safe New Tab Cleanup [codex]
- **New-tab navigation** - додано shared `openSafeNewTab()` для простих переходів у нову вкладку з `noopener,noreferrer`.
- **Demo player** - кнопка відкриття target page більше не вставляє raw `target_url` у inline `onclick`, тому лапки/URL не ламають кнопку.
- **Graduation/Booking/Chat/Finance** - прості new-tab переходи переведено на safe opener contract, а print/export popup-и з `document.write` лишились сумісними.
- **Regression guard** - UI smoke check фіксує safe opener helper і відсутність raw demo target URL у inline handler.

---

## v0.61.32 - Native Prompt Audit Cleanup

### Native Prompt Audit Cleanup [codex]
- **Copilot** - створення нового кейсу більше не падає у native browser `window.prompt`, якщо CRM prompt modal helper недоступний.
- **Settings / Майстерня долі** - додавання спеціаліста або кабінету використовує тільки CRM `promptModal`; без helper-а дія fail-closed із toast-повідомленням.
- **Regression guard** - UI smoke check фіксує, що Copilot і Settings prompt flows не повертають native prompt fallback.

---

## v0.61.31 - Native Dialog Audit Cleanup

### Native Dialog Audit Cleanup [codex]
- **Leads** - dirty-close для додаткових модалок і картки клієнта більше не падає у старий browser `window.confirm`; використовується CRM confirm modal або fail-closed toast.
- **Lead → customer** - створення нового клієнта з ліда тепер має той самий контрольований confirmation path без native dialog fallback.
- **Tasks** - закриття detail overlay із незбереженими змінами більше не відкриває грубий browser confirm, якщо shared modal helper тимчасово недоступний.
- **System cleanup** - профіль, auth dirty-close, Afisha/Certificates, Dashboard board, HR account toggle і assistant action confirmations тепер fail-closed через CRM toast/helper замість native browser confirm.
- **Regression guard** - UI smoke check фіксує, що CRM frontend confirmation flows не повертають native browser dialogs.

---

## v0.61.30 - Personal Task Pinning

### Personal Task Pinning [codex]
- **Мої задачі** - особисті задачі, які користувач створив сам для себе, тепер мають явний top-priority у змішаних списках.
- **Сортування** - додано deterministic relationship-rank: self-created personal -> вхідні мені -> делеговані мною -> інші задачі, при цьому `done/archived/cancelled` не піднімаються над активними.
- **Візуальна ясність** - такі задачі отримують badge `Моя особиста`, окремий summary chip і тихий pinned-тон картки у light/dark темах.
- **Regression guard** - UI smoke check перевіряє наявність self-created personal predicate, rank у comparator і видимий pin-treatment.

---

## v0.61.29 - Graduation Diplomas Menu Clarity

### Graduation Diplomas Menu Clarity [codex]
- **Дипломи** - хаотичний ряд однакових action-кнопок замінено на стабільний workflow із трьох зон: випускний, список дітей, preview/export.
- **Список дітей** - основні дії `Додати дитину` та `Вставити списком` тепер видимі одразу, а керування списком винесено в службовий action-row.
- **Preview/export** - preview, PDF і табличні експорти згруповано окремо; disabled-стан лишається явним, поки список дітей порожній.
- **Regression guard** - додано UI smoke check, який не дає повернути старий `grad-diploma-toolbar` як одну хаотичну панель кнопок.

---

## v0.61.28 - Deployment Version Marker

### Deployment Version Marker [codex]
- **Релізний маркер** - піднято видиму версію CRM з `v0.61.27` до `v0.61.28` за запитом оператора.
- **Cache/version sync** - оновлено HTML asset tags, service-worker cache names, `package.json`, `package-lock.json` і release badge, щоб live CRM явно показував найсвіжіший deployment marker.
- **Без функціональної зміни** - реліз не змінює бізнес-логіку після Sound upload fallback; це окремий deploy/version marker.

---

## v0.61.27 - Sound Upload Fallback

### Sound Upload Fallback [codex]
- **Sound** - активну заглушку `Створити музику (скоро)` замінено на реальний upload-flow для аудіофайлів у бібліотеку звуків.
- **Бібліотека звуків** - оператор може вибрати MP3/WAV/OGG/M4A/AAC, задати назву й категорію, завантажити файл через `/api/music/library/upload` і одразу оновити список.
- **AI-музика** - поки Suno/Kie.ai недоступний, кнопка показується як disabled-стан і більше не відкриває dead-click повідомлення.
- **Regression guard** - додано UI smoke checks, які ловлять повернення активної `скоро`-кнопки без реальної дії.

---

## v0.61.26 - Modal Interaction Cleanup

### Modal Interaction Cleanup [codex]
- **CRM-модалки** - Afisha, Certificates, Copilot, Settings і Dashboard work queue більше не відкривають грубі native `confirm/prompt/alert` у нормальному UI-потоці.
- **Dashboard queue** - підтвердження бронювання, виконання задач і очищення reply expectations перейшли на shared `confirmModal`, а помилки показуються через CRM notification замість blocking `alert`.
- **Afisha / Certificates** - destructive delete actions використовують shared confirm helper з fallback-ом лише для аварійного режиму без `ui.js`.
- **Copilot / Settings** - створення кейсу та додавання лінії `Майстерні долі` використовують `promptModal` перед native fallback-ом.
- **Regression guard** - додано UI smoke checks на повернення старих blocking dialogs у цих сценаріях.

---

## v0.61.25 - Interaction Contract Fixes

### Interaction Contract Fixes [codex]
- **Copilot workflow** - виправлено відносні workflow/cases запити, які оминали mounted backend і йшли у неіснуючі `/workflow/...` та `/cases...`; тепер вони нормалізуються в `/api/copilot/...`.
- **Copilot case history** - збереження історії кейсу після AI-відповіді використовує серверний `PUT /api/copilot/cases/:id` контракт замість помилкового `POST /cases/:id`.
- **Налаштування** - automation rules та Telegram bot username знову ходять на реальні mounted routes: `/api/automation-rules` і `/api/settings/bot_username`.
- **Chat / Guardian** - кнопка `Згенерувати зараз` у digest більше не рендериться як `onclick="void(0)"`; робота лишилась на існуючому delegated listener.
- **Regression guard** - додано UI checks на Copilot route normalization, settings API routes і відсутність legacy void-stub кнопки.

---

## v0.61.24 - UI Cleanup Audit Fixes

### UI Cleanup Audit Fixes [codex]
- **Биті asset-посилання** - виправлено root CRM сторінки, які посилалися на неіснуючий `images/favicon.ico`; тепер використовують наявний `images/favicon-32.png`.
- **Піньята / бронювання** - прибрано биті encoding-рядки з деталей бронювання і Telegram-шаблонів; labels знову читаються як `Піньята`, `Піньята парку`, `Нотатка`, `Наповнювач`.
- **Omni / клієнти** - виправлено зіпсовані error messages у CRM-context endpoint та порожній маркер соц-ідентичностей клієнта.
- **Regression guard** - додано UI smoke-перевірки, які ловлять повернення missing favicon і битих pinata/template labels.

---

## v0.61.23 - Sidebar USD Widget Settings Fix

### Sidebar USD Widget Settings Fix [codex]
- **USD у профілі** - перемикач USD більше не ховає чіп одразу під час редагування Quick Access; зміна застосовується тільки після `Зберегти`.
- **Налаштування віджетів** - у редакторі `Швидкий доступ` відокремлено блок `Налаштування віджетів` від списку сторінок, щоб сторінки і profile widgets не змішувалися.
- **Клік по USD** - сам USD-чіп залишається зрозумілим entrypoint для курсів валют і не зникає “невідомо куди” від випадкового кліку в редакторі.

---

## v0.61.22 - Sidebar Theme Refresh + Legacy Menu Cleanup

### Sidebar Theme Refresh + Legacy Menu Cleanup [codex]
- **Sidebar** - покращено візуальну систему global navigation для dark/light theme: поверхні, active/hover стани, іконки, group headers, identity card і collapsed rail стали спокійнішими та контрастнішими.
- **Світла тема** - sidebar більше не спирається на бежевий washed-out вигляд; додано чистіші нейтральні поверхні, сильніший текстовий контраст і чіткі teal/blue акценти.
- **Темна тема** - зменшено декоративний шум і glow, підсилено читабельність та контрольовані стани hover/focus/active.
- **Timeline menu** - legacy small-menu більше не дублює sidebar navigation; залишено тільки контекстні дії таймлайну `Історія змін` і `Дайджест дня`, з self-hide якщо дій немає.

---

## v0.61.21 - Graduation Timeline Nested Blocks

### Graduation Timeline Nested Blocks [codex]
- **Випускний таймлайн** - graduation booking тепер рендериться як parent-block зі вкладеним track для складових програми.
- **Package composition** - дефолтні child-сегменти будуються з `graduation_package_items` / `graduation_services` і зберігають snapshot пакета для відновлення.
- **Інтерактивні складові** - сегменти можна drag/resize, додавати вручну, перейменовувати, видаляти та регенерувати з package source.
- **Duration sync** - parent duration автоматично розширюється до останньої складової, а ручне shrink нижче child extent заблоковано min-duration логікою.

---

## v0.61.20 - Graduation Diplomas Typography Refinement

### Graduation Diplomas Typography Refinement [codex]
- **Дипломи** - покращено типографіку, ієрархію тексту та читабельність preview/print для випускних дипломів.
- **Локальні шрифти** - HTML preview/print використовує bundled Noto Serif і Nunito з `assets/fonts`, без крихкої залежності від Google Fonts.
- **Чіткість тексту** - прибрано blur-prone `transform`, `text-shadow`, stroke і повторне PDF-малювання псевдо-bold, які робили літери змазаними.
- **Print/PDF parity** - PDFKit export отримав той самий чіткіший serif/sans hierarchy для заголовка, імені, опису, побажання, року і класу.

---

## v0.61.19 - Assistant silent fix

### Assistant silent fix [codex]
- **Без auto-open** - legacy `kleshnya-widget` більше не відкриває canonical assistant rail з programmatic/init path; `expand()` дозволений тільки після trusted user click/tap.
- **Без random voice** - proactive page help у `assistant-rail` вимкнений за замовчуванням, а speech playback запускається тільки через явний mic/replay flow.
- **Idle hints opt-in** - shell більше не стартує `IdleHints.init()` автоматично; idle nudges доступні лише через explicit feature flag/localStorage opt-in.
- **Менше flaky fallback** - browser `speechSynthesis` fallback вимкнений за замовчуванням, щоб не було обрізаних або часткових фраз після TTS failure.

---

## v0.61.18 - Assistant page knowledge

### Assistant page knowledge [codex]
- **Page-aware payload** - assistant rail і Kleshnya chat передають компактний `pageContext`: сторінку, path, заголовок, активний tab, selected entity, фільтри і related hints без DOM dump.
- **Канонічний registry сторінок** - додано структуроване знання для `timeline`, `dashboard`, `customers`, `sales-funnel`, `tasks`, `finance`, `staff/hr`, `programs`, `certificates`, `chat/omni`, `center` та інших основних поверхонь.
- **Cross-page відповіді** - `/customers` тепер розуміє питання про воронку як модуль `Ліди / Воронка`, пояснює звʼязок client base ↔ lead pipeline і не вигадує live-цифри без даних.
- **Prompt і fallback** - `crm-assistant` і старий `kleshnya` engine використовують один page knowledge source, мають dev debug контекст і локальну відповідь для концептуальних питань без зміни backend auth.

---

## v0.61.17 - Dashboard single role switcher

### Dashboard single role switcher [codex]
- **Один перемикач ролі** - preview ролей перенесено в компактну кнопку на dashboard shell, без окремого header/debug switcher і без кліку по ролі в sidebar.
- **Реальна роль окремо від preview** - sidebar показує реальну роль акаунта, а dashboard-кнопка показує effective preview роль і дає скинути режим.
- **Shell без zombie UI** - старий `RoleSwitcher` переведено в compatibility tombstone без DOM, а CSS-хак для прихованого `#roleSwitcher` прибрано.
- **Без зміни backend auth** - preview і далі керується `RolePreview` та змінює тільки shell, меню, dashboard, quick access і стартову сторінку.

---

## v0.61.16 - Account center list recovery

### Account center list recovery [codex]
- **Акаунти** - вкладка `Акаунти` більше не виглядає порожньою після редагування запису: після create/profile/access змін список повертається до всіх активних акаунтів.
- **Фільтри** - додано явний стан активного пошуку/фільтрів, кнопку `Скинути фільтри` і зрозумілу порожню підказку, коли список обмежений пошуком.
- **Безпека** - прибрано персональний destructive control `Вимкнути акаунти Каріни`; масові дії по конкретній людині не мають жити в загальному account center.
- **Оновлення списку** - додано явну дію `Оновити список`, а не прихований reload через редагування.

---

## v0.61.15 - Dashboard workshop redesign

### Dashboard workshop redesign + guided layout planning [codex]
- **Dashboard UX** - робочу сцену перебудовано в спокійніший workshop/control-room workspace з чистішою ієрархією, меншою кількістю постійного builder-шуму і сильнішим dark-mode характером.
- **Configure Mode** - normal mode лишається чистим для щоденної роботи, а planning mode показує слоти, інструменти розкладки, підказки та дії для композиції.
- **Layout Planning** - додано планувальні зони для розміщення віджетів і explicit `Порожня зона`, яку можна зберегти як reserved/breathing space.
- **Persistence** - `space` items і `showPlanner` проходять frontend/backend board-state sanitizer, тому навмисно пусті місця переживають save/reload.
- **Inspector Cleanup** - у режимі перегляду прибрано зайвий інспектор, а в плануванні контролі згруповано навколо композиції, віджетів і пустих зон.

---

## v0.61.14 - Profile account security

### Profile account security [codex]
- **Особистий кабінет** - у налаштування профілю додано account security панель із паролем, сесіями та журналом акаунта.
- **Пароль** - власна зміна пароля тепер оновлює security metadata і пишеться в окремий audit stream без збереження паролів у логах.
- **Сесії** - додано відкликання всіх активних сесій із `session_revoked_at`, щоб legacy JWT теж мав централізований invalidate-контракт.
- **Account audit** - create/reset/role/profile/activate/deactivate дії з HR account center пишуться в `account_security_events` і доступні користувачу в профілі.

---

## v0.61.13 - Account lifecycle completion

### Account lifecycle completion [codex]
- **Профіль акаунта** - додано редагування імені, логіна і HR staff-привʼязки прямо з центру акаунтів.
- **Staff binding** - створення акаунта тепер може одразу привʼязати користувача до реального staff-профілю без ручного обходу.
- **Backend contract** - додано `/api/users/staff-options` і `/api/users/:id/profile` для повного account lifecycle.
- **Security** - посилено guard-и: director/HR не можуть змінювати creator-акаунти через profile, password reset або activate/deactivate.

---

## v0.61.12 - Account management menu

### Account management menu [codex]
- **Акаунти** - у HR додано меню керування акаунтами зі створенням користувачів, пошуком, ролями та активністю.
- **Паролі** - creator/director можуть змінювати пароль користувача через контрольований reset flow без збереження паролів у коді.
- **Доступ** - редагування ролей і додаткових сторінок перенесено з prompt у нормальну форму.
- **Безпека** - HR бачить тільки safe controls, а створення акаунтів і зміна паролів приховані від неавторизованих ролей.

---

## v0.61.11 - Products page business selector

### Products page business selector + brand-aware naming [codex]
- **Products** - на сторінку продуктів додано selector бізнесу з варіантами `Парк Закревського` і `Майстерня долі`.
- **Preferences** - останній обраний бізнес зберігається в `pzp_products_business_context` і відкривається за замовчуванням.
- **Naming** - park surface перейменовано з вузької назви `Розважальні програми` на чесний продуктовий контекст Парку Закревського.
- **UX** - header, tabs, sidebar label і first-pass `Майстерня долі` state узгоджені в одному products hub без дублювання сторінки.

---

## v0.61.10 - Graduation products shell layout hardening

### Graduation products shell/layout hardening [codex]
- **Sidebar** - прибрано небажане auto-collapse / fullscreen chrome loss у graduation products/catalog flow.
- **Shell** - graduation catalog viewer у Designs тепер відкривається всередині CRM workspace і не ховає sidebar/header.
- **Layout** - `/graduation` і graduation package viewer вирівняно ближче до робочого content lane замість надмірно центрованої вітрини.

---

## v0.61.9 - Chat Guardian moderation hardening

### Chat + Guardian moderation hardening [codex]
- **Chat** - виправлено позиціонування context menu біля повідомлень: меню clamp/flip тримається в межах viewport і не втікає за правий край.
- **Security log** - журнал безпеки отримав окремий читабельний operational event-row layout з actor, action, status, time і detail.
- **Pinned messages** - додано pin/unpin через message actions, видимий pinned bar у shell і синхронізацію з existing backend pin API.
- **Guardian Analytics** - лічильник блокувань тепер рахує реальні `block_precheck` події й оновлюється після moderation events.
- **Privacy** - public moderation reply більше не показує конкретний мат; точні слова лишаються у внутрішніх Guardian logs/actions.

---

## v0.61.8 - Certificates page recovery

### Certificates standalone page recovery [codex]
- **Certificates** - відновлено standalone auth/bootstrap для сторінки сертифікатів без повернення до legacy panel flow.
- **Routing** - підтверджено й закріплено явні маршрути `/certificates`, `/certificates/new`, `/certificates/batch` на `certificates.html`.
- **Deploy safety** - перед release перевірено live/frontend sync, щоб не деплоїти старіший frontend snapshot поверх live.

---

## v0.61.7 - Майстерня долі booking cleanup

### Maysternya Doli booking panel cleanup [codex]
- **Майстерня долі** - booking panel більше не підтягує стандартні event/program пакети в консультаційному timeline.
- **Консультації** - у режимі `/maysternya-doli` доступні тільки `Демо консультація` на 15 хв і `Повна консультація` на 40 хв.
- **Booking UX** - presets, category chips і panel labels синхронізовано під консультаційний сценарій без впливу на основний Event Genix timeline.

---

## v0.61.6 - Відновлення нумерації версій

### Changelog continuity [codex]
- **Видимий changelog** - у login modal відновлено пропущені release-блоки між `v0.61.5` і `v0.60.0`, щоб версії більше не стрибали з `v0.61.5` на `v0.61.0` або з `v0.60.39` на `v0.60.23`.
- **Джерело правди** - `CHANGELOG.md` і `index.html` тепер мають однаковий верхній release chain для активної гілки `0.61.x` / `0.60.x`.
- **Version guard** - додано статичну перевірку безперервності видимого changelog, щоб такі загублені версії не повертались.

---

## v0.61.5 - Graduation ops automation

### Graduation timeline positions + special control [codex]
- **Timeline** - усі релевантні позиції випускного тепер зберігаються у booking `extra_data.graduationTimelineItems` і відображаються всередині timeline-блока як операційні chips.
- **Roster control** - якщо у випускному є дипломи, але список дітей ще порожній, CRM idempotently створює менеджеру задачу `grad_roster_missing` з режимом `special_control`.
- **Special control** - задачі особливого контролю отримали явні поля `control_mode`, `critical_reason`, `control_meta` і leadership observers через існуючу task visibility policy.
- **Print reminder** - за день до події створюється/оновлюється задача арт-директору з посиланням на PDF дипломів або явним blocker-state, якщо roster ще не готовий.
- **Capsule flow** - сервіс "Капсула часу" автоматично створює внутрішню prep/order задачу і зберігає future adapter event `graduation_capsule_requested` для майбутнього contractor bot.
- **Lifecycle** - automation state централізовано в `graduation_automation_state`: задачі не дублюються на save, закриваються при готовому roster, reschedule-яться при зміні дати і cancelled при знятті сервісу.

---

## v0.61.4 - OmniClaw Telegram inbox recovery

### OmniClaw / Telegram binding recovery [codex]
- **OmniClaw** - Telegram inbox binding відокремлено від report bot контуру, щоб бот звітів більше не створював фальшивий стан "inbox already connected".
- **Channels** - додано явний disconnect / rebind / test flow для Telegram inbox з окремими API alias endpoints і зрозумілими CTA у вкладці каналів.
- **Recovery** - legacy Telegram rows із report-bot семантикою нормалізуються у `report_bot`, а inbox переводиться у `needs_rebind` без втрати окремого контуру звітів.
- **Test flow** - Telegram inbox test перевіряє Bot API, webhook route `/api/omni/webhook/telegram` і за наявності test chat ID виконує silent test send.

---

## v0.61.3 - Dashboard віджети + tasker

### Dashboard widgets recovery + Creator tasker [codex]
- **Dashboard widgets** - повернуто повний registry у керування віджетами, відновлено приховані блоки на кшталт `my_focus`, `finance_today`, `reports_today`, `account_stats`, `week_bookings` і `task_health`.
- **Flexible builder** - live widget guardrail піднято зі старого 6/8 до 18/24, щоб creator міг зібрати насичену персональну dashboard-панель без silent drops.
- **Creator tasker** - додано creator-only `personal_tasker` через canonical `/api/dashboard/widgets/:type` із режимами `assigned_to_me`, `created_by_me` і `all_tasks`.
- **Tasker fullscreen** - compact widget і fullscreen work mode використовують один data contract, показують лічильники, progress/achievement chips і не дублюють tasks app.

---

## v0.61.2 - Каталог тортів

### Products Kitchen/Cakes: заповнення каталогу [codex]
- **Каталог тортів** - у Products -> Кухня -> Торти додано 18 узгоджених позицій із curated назвами, описами, цінами та порядком 1..18.
- **Ціна за 100 г** - тортам задано numeric `price`, `serving_unit='100г'` і linked `price_rules.unit='грн/100г'`, щоб UI не показував ціну як за штуку.
- **Canonical storage** - дані заведено в existing `products` model і linked price rules, без окремого mock-каталогу або паралельної таблиці.
- **Idempotent seed** - міграція оновлює існуючі cake records за stable id або назвою, не створює дублі на повторному прогоні й зберігає operator-added decoration/promo/ingredients/tech-card поля.

---

## v0.61.1 - Ергономіка board

### Dashboard board: direct manipulation [codex]
- **Direct move** - у dashboard workspace shapes і frames можна рухати напряму в edit/select flow без окремого ритуалу з інструментами; widgets лишаються захищеними від випадкового drag через live content.
- **Лінії та стрілки** - standalone `line` / `arrow` більше не виглядають як важкі картки: chrome став легким, а endpoints отримали окремі drag handles для зміни довжини.
- **Connectors** - SVG-звʼязки отримали видимі endpoint handles і retarget до найближчого anchor, тож стрілки/лінії редагуються як графічні обʼєкти.
- **Pan contract** - `hand` tool, middle mouse і `Space + drag` тепер реально панорамують board shell, а не лише міняють курсор.
- **Widget safety** - click/scroll/buttons усередині live widgets не перехоплюються новим drag/pan contract.

---

## v0.61.0 - Кухня

### Кухонний контур Products [codex]
- **Кухня в Products** - у продуктовому контурі є окрема вкладка `Кухня` поруч із розважальними програмами, без другого паралельного CRUD.
- **Торти** - доступна підвкладка `Торти` зі структурованими полями `short_description`, `promo_description`, `ingredients`, `tech_card` і окремим `cake_decoration` для оформлення.
- **Меню** - доступна підвкладка `Меню` для повного внесення позицій із секціями, ціною, вагою або обʼємом, одиницею подачі, варіантами ціни, статусом доступності та складом.
- **Розділи меню** - підтримуються реальні кухонні групи: холодні закуски, салати, гарячі закуски, бургери, піца, додатки до піци, мангальне меню, основні страви, перші страви, гарніри, гарячі напої, коктейлі та холодні напої.
- **Операторський UX** - у Menu є фільтр по секціях, кнопка `Зберегти і додати ще`, картки з ключовими полями та completeness-станом для швидкого масового внесення.
- **Completeness logic** - CRM показує, чи позиція заповнена повністю, чи бракує критичних даних; напої й додатки не змушують вводити зайвий склад.
- **Products API/schema** - кухня працює на canonical products model: пере використано наявні product-поля й додано тільки відсутні menu-колонки через керовану міграцію.

---

## v0.60.46 - Структуроване меню Products

### Products Menu: повне внесення меню [codex]
- **Menu workflow** - у Products -> Кухня -> Меню доведено робочий сценарій повного структурованого внесення меню-позицій без окремого паралельного модуля.
- **Schema reuse** - пере використано наявні product-поля `short_description`, `promo_description`, `ingredients`, `tech_card`, `price`, `sort_order` і додано лише відсутні menu-поля.
- **Menu sections** - меню отримало секції для реальних груп на кшталт холодних закусок, салатів, піци, гарячих напоїв і коктейлів.
- **Structured menu data** - позиції меню підтримують вагу або обʼєм, одиницю подачі, варіанти ціни, статус доступності та склад.
- **Operator UX** - картки й detail/edit flow показують completeness-стан, щоб менеджер бачив повністю та частково заповнені позиції.

---

## v0.60.45 - Живий dashboard builder

### Живий dashboard builder [codex]
- **Widget runtime** - dashboard-віджети більше не отримують dead overlay після перемикання tools і автоматично лишаються в live-стані.
- **Workspace lifecycle** - уточнено use/edit contract: widget content лишається всередині board, а переміщення й resize мають власний frame та handles.
- **Free layout builder** - додано picker віджетів, швидке створення нотаток, resize handles і явну кнопку збереження для персонального dashboard layout.
- **Persistence guard** - freeform x/y/w/h/z layout стабільно проходить через наявний boardState / dashboard config flow без нового runtime.

---

## v0.60.44 - Рольовий preview shell

### Рольовий preview shell [codex]
- **Profile role switcher** - роль у profile summary card стала керованим entrypoint: creator/director можуть відкрити меню й переглянути CRM як іншу роль.
- **RoleShell runtime** - додано спільний контракт `RolePreview` / `RoleShell` для реальної ролі, preview-ролі, effective UI role, стартових сторінок і quick access.
- **Role-aware surfaces** - sidebar, quick access і dashboard-сцена читають effective role з одного runtime, тому preview змінює shell-композицію, а не тільки текст бейджа.
- **Security boundary** - preview впливає лише на frontend shell; backend/API лишаються на реальному JWT і реальній авторизації користувача.

---

## v0.60.43 - Жива сцена Помічника

### Жива сцена Помічника [codex]
- **Motion system** - Помічник отримав різні motion-стани для idle, hover, thinking, listening, speaking, guiding, success, warning і muted замість одного повторюваного pulse.
- **Expanded stage** - повне вікно Помічника тепер має окрему сцену зі статусом, орбітою, meter-ритмом і state-aware анімаціями.
- **State truth** - до runtime додано реальні `guide` та `warning` стани, а CSS читає їх через `data-ai-state`, `data-mode`, `data-playback-state`.
- **Reduced motion** - для користувачів із reduced-motion рухи вимикаються, але стан лишається видимим через спокійний фокус і кольоровий акцент.

---

## v0.60.42 - Products Kitchen: торти, меню та кухонні поля

### Products Kitchen: торти, меню та кухонні поля [codex]
- **Kitchen surface** - у Products додано окремий контур Кухня з підвкладками Торти та Меню поруч із розважальними програмами.
- **Kitchen schema** - canonical products model/API розширено полями `short_description`, `promo_description`, `ingredients`, `tech_card`, `domain` і `kitchen_type`.
- **Cake decoration** - для тортів додано явне поле `cake_decoration`, яке показується тільки для kitchen subtype `cake`.
- **Products UX** - create/edit форма, картки, empty states і фільтрація тепер працюють для кухонних позицій без другого kitchen CRUD.

---

## v0.60.41 - Assistant Guided Click Safety

### Assistant Guided Click Safety [codex]
- **Підказка кліку** - помічник тепер показує реальну guide-line до видимого UI-елемента і підсвічує ціль, коли користувач питає, де натискати.
- **Безпечний голос** - озвучення більше не стартує зненацька: нові й невідомі сесії починаються у текстовому режимі, голос вмикається явно.
- **Target safety** - якщо точну кнопку або посилання неможливо підтвердити у DOM, CRM не малює фейкову лінію й лишає чесну текстову відповідь.
- **Reduced motion** - для користувачів із reduced-motion guide-line переходить у спокійний фокус без агресивної анімації.

---

## v0.60.40 - Dashboard Photoshop Tool Dock

### Dashboard Photoshop Tool Dock [codex]
- **Dashboard tools** - широкий верхній toolbar перезібрано у компактний вертикальний dock біля сцени, ближче до Photoshop/FigJam-патерну.
- **Менше шуму** - зверху лишилась компактна options bar для активного інструмента, snap/grid/guides/кольору, а не багато великих груп-меню.
- **Tool UX** - інструменти стали icon-first з `title`/`aria-label`, збережено групи вибору, навігації, додавання, малювання, фігур, зв’язків, AI-шаблонів і дій.
- **Responsive** - на вузьких екранах dock переходить у горизонтальний скрол-ряд без розвалу сцени.

---

## v0.60.39 - UI Polish And Modal Fixes

### UI Polish And Modal Fixes [codex]
- **Sidebar** - остаточно прибрано малий овальний артефакт під іменем у profile summary card, без втрати metrics strip і role indicator.
- **Dashboard** - workspace-палітру зроблено зрозумілішою українською: групи інструментів, підказки, inspector і AI-board тексти більше не виглядають як англомовний debug toolbar.
- **Graduation lists** - модалка «Створити список дітей» стала компактнішою, без зайвих optional-полів у create-flow.
- **Modal safety** - shared `formModal()` отримав scroll-safe layout: поля скроляться всередині вікна, а кнопки «Створити/Зберегти» більше не вилітають за низ екрана.

---

## v0.60.38 - Omni SMS Provider Selector

### Omni SMS Provider Selector [codex]
- **OmniClaw** - SMS-підключення більше не зашите під одного провайдера: у модалці додано вибір між `TurboSMS` і `FlySMS`.
- **FlySMS** - додано provider-aware поля `FlySMS API key`, `sender/source`, webhook secret і endpoint, щоб менеджер не бачив TurboSMS-копірайт у FlySMS-сценарії.
- **Backend truth** - SMS send/test/recheck тепер проходять через provider registry: legacy TurboSMS конфіг читається як `turbosms`, а нові FlySMS налаштування зберігаються як `flysms`.
- **Webhook lifecycle** - SMS delivery callbacks класифікуються як generic provider webhooks із source для FlySMS або TurboSMS, без хардкоду одного шлюзу.

---

## v0.60.37 - Dashboard Unified Workspace

### Dashboard Unified Workspace [codex]
- **Єдиний workspace** - режим `Сцена` і `Сцена + Board` зведено в один canonical `workspace`: старі `grid`/`board` конфіги нормалізуються без втрати widgets, notes, drawings і connectors.
- **Модульна сцена** - dashboard тепер стартує з board-native modules для widgets, notes, text, shapes і frames, а старі scene-only віджети автоматично піднімаються в workspace як керовані модулі.
- **Професійна палітра** - flat toolbar замінено на grouped tool families: interaction, navigate, insert, draw, shape, connect, templates і actions, із snap preset-ами `strict / soft / freeform`.
- **Чисті overlap states** - selection, hover, active edit і widget-inspect отримали shared workspace tokens замість грубих рамок, щоб перетини об'єктів не виглядали як debug boxes.

### Tasks Multi-Create Plus Flow [codex]
- **Масове створення задач** - canonical quick composer у Tasks отримав кнопку `+ Ще задача`, яка додає окремі task-рядки без перетворення їх на subtasks або checklist.
- **Наслідування дефолтів** - новий рядок копіює відповідального, категорію, режим, дату, слот і службові прапорці з попередньої задачі, але назва лишається порожньою, щоб не створювати випадкові дублікати.
- **Per-task overrides** - кожен доданий рядок має власну назву, пріоритет, дату, час і тривалість, а submit послідовно створює незалежні записи через існуючий `POST /api/tasks`.
- **Regression guardrail** - UI-smoke перевіряє наявність batch panel, plus-button flow, remove-row contract і пер-task priority/date controls.

### Sidebar Profile Summary Polish [codex]
- **Профільна картка чистіша** - прибрано випадковий овальний glow під іменем у sidebar summary card, щоб блок не виглядав як артефакт.
- **Metrics strip** - USD, час і день зібрані в один рівний desktop-ряд із консистентними розмірами, spacing і hierarchy.
- **Role indicator** - `Creator` та інші ролі більше не сидять у важкому pill-чипі: роль стала тонким typographic indicator із акцентною лінією.
- **Guardrail** - UI-smoke фіксує новий контракт: без oval-псевдоелемента, без pill-radius для ролі і з 3-up metrics layout.

---

## v0.60.36 - Graduation List Packs Booking Linkage

### Graduation List Packs Booking Linkage [codex]
- **Списки дітей** - у випускних додано first-class списки/набори дітей із назвою, контекстом закладу/класу та режимом wording для дипломів.
- **Прив'язка до flow** - graduation quote/booking тепер зберігає `child_pack_id`, а при створенні бронювання контекст списку потрапляє в `extra_data`.
- **Дипломи по списку** - preview, PDF, CSV, XLSX і print sheet використовують linked list як джерело дітей та рядка закладу без повторного ручного вибору.
- **Wording toggle** - у вкладці «Дипломи» додано перемикач «Випускник закладу», який змінює текст диплома для batch generation.

---

## v0.60.35 - Graduation Diploma Formal PDF Typography

### Graduation Diploma Formal PDF Typography [codex]
- **PDF title contrast** - заголовок `ДИПЛОМ ВИПУСКНИКА` у PDF export більше не друкується жовтим на жовто-зеленому шаблоні: він став темно-синім, із тонкою світлою обводкою та стриманою тінню.
- **Строгіші PDF-шрифти** - дипломний PDF перейшов на embedded Noto Serif Regular/Bold/Black для кирилиці, щоб заголовок, ПІБ, опис, побажання, рік і клас виглядали більш урочисто, а не як декоративний rounded-font.
- **Visual PDF smoke** - згенеровано локальний PDF диплома, відрендерено першу сторінку в PNG через `pypdfium2` і перевірено реальний output після експорту.
- **Regression coverage** - тест дипломів перевіряє, що batch PDF лишається multi-page і embed-ить `NotoSerif-Black` та `NotoSerif-Bold`.

---

## v0.60.34 - Graduation Diploma PDF Typography

### Graduation Diploma PDF Typography [codex]
- **PDF title contrast** - заголовок `ДИПЛОМ ВИПУСКНИКА` у серверному PDF export тепер друкується товстим шаром із реальним Nunito Black, жовтим fill і помаранчевою обводкою, тому не губиться на жовто-зеленому шаблоні.
- **PDF font weights** - для імені, опису, побажання, року і класу додано Nunito Bold/Black assets та реєстрацію у PDFKit замість одного тонкого regular-font fallback.
- **Visual PDF smoke** - згенеровано і відрендерено локальний PDF диплома у PNG через `pypdfium2`, щоб перевірити саме output після експорту, а не лише HTML preview.
- **Regression coverage** - тест дипломів перевіряє, що batch PDF лишається multi-page і справді embed-ить `Nunito-Black` та `Nunito-Bold`.

---

## v0.60.33 - Light Theme Sidebar Density

### Light Theme Sidebar Density [codex]
- **Light Theme** - світлий режим зібрано в тепліший, чистіший і візуально дорожчий design system замість блідого admin-look.
- **Sidebar Density** - лівий CRM shell зменшено приблизно на третину через shared width contract і ущільнено без втрати читабельності.
- **Timeline Scene** - таймлайн у light mode отримав кращу surface hierarchy, контраст сітки, читабельніші рядки і сильніший фокус на робочій області.
- **Dark mode guardrail** - зміни світлої теми scoped через `body:not(.dark-mode)`, тому темний режим не отримує випадкових token-regression.

---

## v0.60.32 - Graduation Diplomas Batch PDF

### Graduation Diplomas Batch PDF [codex]
- **Один файл для всіх дипломів** - кнопка дипломів тепер завантажує справжній багатосторінковий PDF, де кожна дитина має окрему A4-сторінку.
- **Серверний PDF export** - `/api/graduation/quotes/:id/diplomas/export/pdf` повертає `application/pdf`, а не HTML-сторінку для ручного друку через браузер.
- **Кирилиця у PDF** - додано bundled Nunito font із підтримкою українських літер, щоб імена, класи та побажання коректно друкувались у файлі.
- **Regression coverage** - додано тест, який перевіряє, що batch export створює один PDF із потрібною кількістю сторінок.

---

## v0.60.31 - Graduation Diploma Copy Spacing

### Graduation Diploma Copy Spacing [codex]
- **Між описом і побажанням додано повітря** - червоний wish-блок у дипломі зміщено нижче, щоб він не торкався синього опису навіть на 4 рядках тексту.
- **Довгі тексти стискаються контрольовано** - diploma renderer додає density-класи для довгого опису, довгого побажання і сумарно великої кількості тексту, з меншим шрифтом та line-height.
- **Regression coverage** - додано тест, який перевіряє compact layout для long description + long wish, щоб синій і червоний блоки не повертались до накладання.

---

## v0.60.30 - Graduation Diploma Print Margins

### Graduation Diploma Print Margins [codex]
- **Друк диплома без зайвих полів** - print contract для diploma export тепер жорстко задає A4 210x297mm, нульові `@page` margins та нульові `html/body` поля в print mode.
- **Дата скорочена до року** - замість повної дати на дипломі рендериться тільки рік, щоб блок не вилазив і не створював зайвий шум.
- **Regression coverage** - оновлено diploma helper та static UI checks, які фіксують новий A4/print contract і формат року.

---

## v0.60.29 - Graduation Diploma Template Overlay

### Graduation Diploma Template Overlay [codex]
- **Готовий PNG-шаблон став основою диплома** - diploma export тепер використовує наданий comic-шаблон як повноформатний фон, а engine накладає лише контрольовані текстові шари.
- **Текст розкладено по безпечній зоні** - заголовок, "Нагороджується", ПІБ, опис, побажання, дата і клас позиціонуються поверх центрального світлого аркуша без перекриття персонажів та декоративних зірок.
- **Шрифти і переноси посилено** - додано friendly font stack для кирилиці, нерозривні дефіси в ПІБ, компактні long-name розміри та помітніший стиль дати.
- **Лого парку внизу по центру** - круглий логотип Парку Закревського періоду рендериться в нижній центральній зоні шаблону як окремий шар поверх готового макета.

---

## v0.60.28 - Graduation Diploma Comic Visual

### Graduation Diploma Comic Visual [codex]
- **Комікс-стиль замість офіційної грамоти** - diploma template перебудовано під яскравий A4 portrait макет у стилі пригодницького коміксу з pop-art фоном, halftone dots, зірками та супергеройською енергією.
- **Персонажі в шаблоні** - додано підтримку `characterTopUrl` / `characterBottomUrl` у `layout_json`; поки використані наявні `mr-zak` assets, а нові персонажі можна буде підставити без переписування engine.
- **Footer і дата чистіші** - зверху немає тексту парку чи галочки, службова інформація типу організатора/GRAD-номера не рендериться, дата стала помітним badge всередині рамки.
- **Production template migration** - додано idempotent migration для seeded template `classic-graduation-2026`, щоб live DB отримала той самий comic visual contract.

---

## v0.60.27 - Auth Login Alias Recovery

### Auth Login Alias Recovery [codex]
- **Auth lookup став гнучкішим без зміни паролів** - login route тепер шукає користувача не тільки за `users.username`, а й за контрольованими `users.login_aliases`, залишаючи password hash і єдиний user record джерелом правди.
- **Zhenia відновлено через alias до Zhenya** - додано idempotent migration, яка додає `Zhenia` / `Женя` як aliases для існуючого акаунта `Zhenya`, якщо він є в production DB.
- **Без duplicate user і blind reset** - пароль, hash, ролі, refresh tokens і активність користувача не перезаписуються; fix працює на canonical auth layer.
- **Regression coverage** - додано unit-перевірки для нормалізації login identifier і SQL-contract alias lookup.

---

## v0.60.26 - Graduation Diploma Brand Visual Polish

### Graduation Diploma Brand Visual Polish [codex]
- **Кольори наближено до стилю парку** - дипломний шаблон отримав palette на основі логотипа Парку Закревського: бірюза, синій, зелений, рожевий та теплий жовто-помаранчевий акцент замість попередньої коричнево-золотої схеми.
- **Верх диплома очищено** - прибрано напис `ПАРК ЗАКРЕВСЬКОГО ПЕРІОДУ` зверху та декоративну галочку/медальйон, щоб перший екран диплома був чистішим і не дублював бренд.
- **Footer став акуратнішим** - прибрано `організатор випускного`, номер замовлення на кшталт `GRAD-2026-006` і службовий meta-row; унизу лишився круглий логотип парку та помітна дата в межах рамки.
- **A4/PDF перевірено повторно** - preview і PDF лишаються A4 portrait, а дата, рамка, логотип і довгі ПІБ не виходять за межі диплома.

---

## v0.60.25 - Graduation Diploma A4 Portrait Refinement

### Graduation Diploma A4 Portrait Refinement [codex]
- **Дипломи зафіксовано під A4 portrait** - graduation diploma print/export template тепер використовує 210x297mm, `@page A4 portrait` і portrait preview замість старого landscape contract.
- **Візуал наближено до державної грамоти** - оновлено SVG-рамку, офіційну композицію, золоту рамкову систему, headline/name hierarchy і теплий паперовий стиль без дитячого флаєрного вайбу.
- **Footer очищено** - повністю прибрано блок `Класний керівник`, а нижню зону перебудовано навколо круглого логотипа Парку Закревського як seal/emblem.
- **Live template data-fix** - додано idempotent migration для seeded template `classic-graduation-2026`, щоб production DB не залишила старий `a4-landscape` layout.

---

## v0.60.24 - Assistant Feature Locator Afisha Page

### Assistant Feature Locator Afisha Page [codex]
- **AI-провідник навчився знаходити функції** - додано shared `js/crm-feature-registry.js`, який відповідає на запити типу `де видати грамоту` через точний шлях `/certificates/new` і підтримується одним registry для майбутніх функцій.
- **Глобальний пошук використовує той самий registry** - пошук CRM підтягує aliases із feature registry, тож `грамота`, `видати сертифікат`, `створити афішу` і схожі запити ведуть у правильні сторінки.
- **Афіша стала окремою сторінкою** - `/afisha` більше не redirect у timeline modal, а відкриває standalone workspace для подій, імпорту/експорту, recurring шаблонів, розподілу і генерації задач.
- **Art не змішує макети з operational афішею** - в Art категорія уточнена як `Макети афіш`, а кнопка `Афіша подій` веде на `/afisha`.

---

## v0.60.23 - Certificates Page Creation Flow

### Certificates Page Creation Flow [codex]
- **Окремі сторінки видачі** - створення одного сертифіката перенесено з legacy panel/modal flow на `/certificates/new`, а пакетну видачу - на `/certificates/batch`.
- **Канонічний реєстр сертифікатів** - `/certificates` тепер відкриває повноцінну сторінку списку, фільтрів, статусів, деталей і дій замість redirect у timeline shell.
- **Швидкий доступ оновлено** - у quick access додано дії `Видати сертифікат` і `Пакет сертифікатів`, а старі launcher-и `openCertificatesPanel`, `showCreateCertificateModal` і `showBatchCertificateModal` ведуть у нові routes.

---

## v0.60.22 - Sidebar Alert Card Cleanup

### Sidebar Alert Card Cleanup [codex]
- **Панель стала чистішою** - з shared sidebar command deck прибрано великий overdue/critical alert-card з `КРИТИЧНО`, pager `1 / N` і CTA `Відкрити`.
- **Alerts data layer збережено** - focus chip `Алерти`, badge/count стан і повний alerts center продовжують працювати через існуючий `js/alerts.js`.
- **Мертвий carousel state прибрано** - з sidebar renderer видалено current-alert/pager/hero navigation JS, щоб після cleanup не лишався недосяжний widget-code.

---

## v0.60.21 - Graduation Diplomas Child Roster

### Graduation Diplomas Child Roster [codex]
- **Дипломи всередині Graduation** - у модулі випускних додано вкладку `Дипломи` з прив'язкою до конкретного quote/booking, щоб список дітей, побажання і export не жили окремо від graduation flow.
- **Children roster** - додано таблиці та API для списку дітей: ПІБ, gender, джерело gender, клас/група, власне побажання, автопобажання, фінальне побажання і статус диплома.
- **Wish engine** - додано gender-aware пул побажань для girl/boy/neutral, manual override, import parser і генерацію без повторів у межах batch, де це можливо.
- **HTML/SVG дипломи та print/PDF export** - додано класичний A4 landscape диплом з SVG-рамкою, урочистою композицією, preview одного диплома, batch print/PDF HTML, CSV/XLSX і print sheet.
- **Гнучкий таймінг випускного** - graduation quote отримав event date/start/end/manual timing contract, а конвертація в booking переносить довільний час і service timing в `extra_data`.

---

## v0.60.20 - Unified Finance Analytics Control Page

### Unified Finance Analytics Control Page [codex]
- **Фінанси стали канонічним control page** - `/finance` тепер об'єднує executive overview, операційні фінанси та управлінські insights без окремого живого модуля `/analytics`.
- **Аналітика переїхала в unified shell** - `/analytics` редіректить у `/finance?mode=insights`, а sidebar показує один пункт `Фінанси та аналітика` замість двох дубльованих входів.
- **KPI без дублювання** - верхній екран має один merged executive strip: виручка бронювань, доходи/витрати/прибуток, бронювання + середній чек, нові клієнти, HR і risk/margin card.
- **Операції згруповано за рішеннями** - транзакції, каса, рахунки, борги, бюджет, P&L, зарплати, прогноз і місяці більше не йдуть одним довгим таб-рядом, а зібрані в логічні групи.
- **Reuse analytics renderer** - існуючі chart/render helpers з `js/analytics-page.js` експоновано як shared widgets для finance shell без третьої копії графіків.

---

## v0.60.19 - Products IA Documents Catalogs

### Products IA Documents Catalogs [codex]
- **Products IA зібрано логічніше** - у продуктовому модулі вкладку програм винесено як `Розважальні програми`, а каталоги отримали окрему вкладку `Каталоги` всередині `/programs`.
- **Ручна прив'язка документів до програм** - на картках розважальних програм з'явився блок `Документ` з URL, назвою, типом `google_doc` / `pdf` / `link`, діями `Прив'язати`, `Відкрити`, `Змінити / відв'язати` та двома ручними прапорцями перевірки.
- **Мінімальний backend contract без зайвого engine** - додано nullable document-linkage поля в `products`, PATCH `/api/products/:id/source-document` з валідацією URL/type і аудитом користувача.
- **Каталоги переекспоновано без дублювання** - Products -> Каталоги використовує існуючі `catalog_definitions` / `catalog_pages`, а старий Designs viewer лишається робочим deep-link target для піньят, меню, костюмів та інших готових каталогів.
- **Sidebar веде через Products** - product-група тепер має `Розважальні програми` і `Каталоги`, де каталоги відкриваються з `/programs#catalogs`, а backward-compatible Designs catalog viewer не дублюється.

---

## v0.60.18 - Telegram Animator Webhook Guard

### Telegram Animator Webhook Guard [codex]
- **Запит на додавання аніматора більше не створює мертві кнопки** - `/api/telegram/ask-animator` тепер перевіряє, що Telegram webhook для callback реально готовий, перш ніж створювати pending-запит і відправляти inline-кнопки `Так` / `Ні`.
- **Зрозумілий fallback замість silent fail** - якщо webhook не встановився або Telegram повернув помилку, CRM повертає `webhook_unavailable` і `manual_line`, щоб інтерфейс не чекав відповідь з кнопок, які live CRM не зможе отримати.
- **Target і callback path стали видимими в логах** - додано точкові логи для вибору chat/thread, результату відправки повідомлення, отримання approve/reject callback і фактичного додавання/відхилення лінії аніматора.
- **Guardrail для ask-animator flow** - тест покриває дві критичні гілки: кнопки не відправляються без готового webhook, а при готовому webhook ідуть у правильний chat/topic з callback payload `add_anim` / `no_anim`.

---

## v0.60.17 - Task Assistant Summary Scope

### Task Assistant Summary Scope [codex]
- **Нотатка по задачах стала конкретною** - питання про задачі тепер отримують коротку сводку з розділами `Останні додані`, `Мої активні` і `Поставлені мною`, а не загальну відповідь без прив'язки до реального списку.
- **Помічник бачить мої та делеговані задачі** - backend-контекст задач враховує поточного користувача, власника/assignee і автора задачі, щоб відповідати окремо по моїх задачах і по тих, які я поставив іншим.
- **Останні додані задачі у фокусі** - active tasks сортуються за `created_at`, дедуплікуються між зрізами і передаються в assistant context з назвами, дедлайнами, пріоритетами, власниками та авторами.
- **Tasks page snapshot розширено** - `/tasks` тепер віддає у shared assistant snapshot `recentTasks`, `myTasks` і `delegatedByMeTasks`, щоб уточнення після короткої сводки мали конкретний контекст.
- **Guardrail для відповідей** - додано focused тест, який перевіряє, що task-summary питання відповідає локально з реальних видимих задач і не йде в generic OpenAI path без потрібних деталей.

---

## v0.60.16 - Maysternya Doli Timeline Surface

### Maysternya Doli Timeline Surface [codex]
- **Окремий timeline для Майстерні долі** - додано приватний route `/maysternya-doli`, який повторно використовує основний timeline UX, але має власні психологічні labels, програми консультацій і стартову лінію/кабінет.
- **Доступ через whitelist і додаткові ролі** - користувачі отримали `page_allowlist` та `extra_roles`; видимість сторінок і sidebar тепер перераховується з урахуванням основної ролі, додаткових ролей і конкретного allowlist.
- **Role-aware кнопки всередині нового timeline** - створення, редагування, експорт, налаштування та destructive actions для Майстерні контролюються окремою action matrix, а не показуються всім дозволеним користувачам однаково.
- **Ізоляція storage/API/data** - bookings, linked updates, lines, filters, compact/zoom state, drafts і localStorage ключі отримали business context `maysternya_doli`, щоб записи Майстерні не читались і не перезаписувались у Event Genix timeline.
- **Основний timeline збережено** - Event Genix залишається default context `event_genix`, а side effects на кшталт Telegram, finance, leads, products і warehouse не запускаються з нового психологічного surface.

---

## v0.60.15 - CRM Assistant Formatting Post-Release Hardening

### CRM Assistant Formatting Post-Release Hardening [codex]
- **Dashboard verification noise cleaned up** - виправлено legacy `showToast` alias collision між `js/ui.js` і `js/catalogs.js`, через який dashboard smoke міг падати з `Identifier 'showToast' has already been declared`.
- **Formatter rollout не розширювався** - safe assistant formatter з `v0.60.14` лишився тим самим escape-first контрактом; зміна не додає нові markdown-функції, typography controls або backend formatting behavior.
- **Canonical/fallback parity підтверджено** - canonical assistant rail і dashboard fallback продовжують використовувати один `CrmAssistantOutputFormat` helper для inline bold, readable paragraphs/lists і escaped HTML-like text.
- **UAT boundary зафіксовано чесно** - live `v0.60.14` було підтверджено перед fix, а реальний authenticated UAT потребує дійсної live-сесії/облікових даних; локальний authenticated-shell smoke використано як substitute для formatter DOM contract.

---

## v0.60.14 - CRM Assistant Safe Formatting Rail

### CRM Assistant Safe Formatting Rail [codex]
- **Помічник більше не показує сирий markdown** - canonical assistant rail рендерить `**акценти**` як контрольований bold emphasis у ticker/subtitle lane, без видимих `**` у відповіді.
- **Readable expanded history** - expanded panel отримав безпечні абзаци, unordered/ordered списки та компактні line breaks, щоб довші відповіді не виглядали як один plain text blob.
- **Escape-first без raw HTML** - додано shared `CrmAssistantOutputFormat`, який спочатку екранує HTML-подібний текст, а вже потім застосовує тільки дозволені transforms; raw model HTML не вставляється в DOM.
- **Canonical rail і fallback вирівняні** - `js/assistant-rail.js` і legacy dashboard fallback у `js/dashboard-page.js` використовують один formatter contract, а `auth.js` автовантажить helper разом із rail assets.
- **Покриття safety cases** - додано focused Node test для plain text, `**bold**`, paragraphs, bullets, ordered lists і HTML-like input, щоб форматування не відкривало XSS-like path.

---

## v0.60.13 - Tasks Kanban Drag And Drop Status Flow

### Tasks Kanban Drag And Drop Status Flow [codex]
- **Kanban drag-and-drop став реальним flow** - у `/tasks?view=board` картки тепер мають native draggable contract, а колонки `До виконання`, `В роботі`, `Готово` приймають drop як валідні status targets.
- **Статус зберігається в backend** - drop викликає canonical `PATCH /api/tasks/:id/status` з `todo` / `in_progress` / `done`, тому `status`, `workflow_state`, history/version і reload consistency лишаються в одному джерелі правди.
- **Optimistic UI без брехні** - картка одразу переїжджає в нову колонку, показує saving state, а при reject/timeout повертається назад і показує зрозумілу помилку.
- **DnD не ламає actions** - кнопки всередині task card не запускають drag випадково, click/open після drag не спрацьовує фантомно, delegated row actions з попереднього релізу збережені.
- **Візуальний feedback додано** - active dragging state, drop-zone highlight і dark/light styling роблять kanban взаємодію очевидною без додавання нових залежностей.

---

## v0.60.12 - Tasks Menu Actions Composer Layout Hardening

### Tasks Menu Actions Composer Layout Hardening [codex]
- **Меню і actions ожили** - у `/tasks` row actions переведено на єдиний delegated handler замість крихких inline `onclick`, тому статус, waiting, smart-slot, snooze, restore і delete не гублять handlers після перерендеру.
- **Quick add став щоденним capture flow** - category, priority, assignee і due presets (`Сьогодні`, `Завтра`, `Без дати`, `Інша дата`) винесено у компактний composer над списком; advanced поля лишились у блоці `Ще`.
- **Ghost surfaces прибрано** - operation pack bar більше не показується як порожній контейнер у звичайних зрізах і відкривається тільки для operational categories `Замовлення` / `Чек-листи`.
- **Layout зміцнено** - сторінка тримає порядок summary -> filters -> composer -> list, task row actions мають більші hit areas, а 1440/1920/1024px smoke не дає горизонтального розриву composer/operation pack.
- **Без зміни бізнес-логіки** - API, auth, routes, schema, task scheduling math, drag/drop і deployment config не змінювались; реліз продовжує ланцюг `v0.60.11 -> v0.60.12`.

---

## v0.60.11 - Timeline Theme Polish

### Timeline Theme Polish [codex]
- **Таймлайн став головною робочою зоною** - екран бронювань отримав спільні dark/light токени для фону, панелей, grid, рядків, тексту, borders, focus states і поточного часу.
- **Світла тема більше не вимита** - sidebar, topbar, панель керування, timeline grid, event blocks, legend і scrubber отримали чіткішу ієрархію поверхонь та контраст без pale mint haze.
- **Темна тема спокійніша** - прибрано зайву neon/glow вагу з ordinary panels, assistant rail, sidebar widgets, controls, legend і minimap без зміни поведінки бронювань.
- **Категорії подій нормалізовано** - `Квести`, `Анімація`, `Шоу`, `Фото`, `МК`, `Піньята`, `Інше` і `Попереднє` мають сталі кольори як dot/stripe/border, а не великі насичені заливки.
- **Без зміни логіки** - API, auth, routes, DB, booking drag/drop/resize, filters, date controls, assistant actions і deploy config не змінювались; реліз продовжує ланцюг `v0.60.10 -> v0.60.11`.

---

## v0.60.10 - Scheduling Docs QA Sync

### Scheduling Docs QA Sync [codex]
- **Документи smart scheduling** - додано системний аналіз і окремий implementation task для наступного handoff без змішування з продакшн-кодом.
- **Approved defaults guardrail** - task-файл фіксує approved first-pass defaults як робочі дефолти і не повертає їх у hard-stop product gate.
- **Без втрати релізів** - visible changelog зберігає послідовність `v0.60.9 -> v0.60.10` і попередній Smart Task Scheduling запис.

---

## v0.60.9 - Smart Task Scheduling

### Smart Task Scheduling [codex]
- **4 швидкі слоти дня** - задачі можна планувати через компактні слоти з дефолтною тривалістю 30 хв і backend-пошуком найближчого вільного вікна.
- **Єдиний scheduling contract** - створення, перенесення, profile/my-cabinet, alerts і work queue отримали спільну логіку розкладу, історії та сортування.
- **Історія та accountability** - перенесення, manual override, proposal state і missed-slot події пишуться в durable history; discipline event і штраф обробляються idempotent, без подвійного нарахування.
- **Версійна послідовність** - реліз продовжує ланцюг `v0.60.8 -> v0.60.9` без пропущеного visible changelog.

---

## v0.60.8 - Assistant Fix Rollup

### Assistant Fix Rollup [codex]
- **Повний rollup Помічника** - зафіксовано всі останні зміни без пропусків у версіях: full rethink, timeline context, voice fallback, light mode, українська озвучка та scroll у міні-вікні.
- **Версії без дірок** - changelog тримає послідовний ланцюг `v0.60.8 -> v0.60.7 -> v0.60.6 -> v0.60.5 -> v0.60.4 -> v0.60.3 -> v0.60.2 -> v0.60.1 -> v0.60.0`.
- **Guardrail** - UI-smoke перевіряє весь актуальний `v0.60.x` порядок, щоб жодне оновлення Помічника знову не випало з modal changelog.

---

## v0.60.7 - Assistant Chat Scroll Fix

### Assistant Chat Scroll Fix [codex]
- **Чат у міні-вікні** - історія діалогу Помічника отримала власну вертикальну прокрутку в expanded panel і більше не обрізає старі повідомлення.
- **Стабільний scroll** - прибрано `align-content: end` для scrollable history, додано `overscroll-behavior`, `scrollbar-gutter` і touch-scroll, щоб прокрутка не перехоплювалась зовнішньою панеллю.
- **Guardrail** - UI-smoke перевіряє scroll-контракт expanded assistant chat.

---

## v0.60.6 - Assistant Ukrainian Voice Polish

### Assistant Ukrainian Voice Polish [codex]
- **Українська озвучка** - Помічник чистить текст перед TTS: прибирає markdown, emoji, URL і службові символи, щоб голос не читав зайвий шум.
- **Кращий voice preset** - дефолтний OpenAI TTS voice змінено на `nova` для м'якшого звучання української.
- **Browser fallback без кривої української** - якщо в браузері немає нормального українського або близького voice, система лишає чистий текст замість англомовної ламаної озвучки.
- **Guardrail** - тести перевіряють speech text cleanup, TTS voice fallback і захист від поганого browser speech fallback.

---

## v0.60.5 - Assistant Light Mode Polish

### Assistant Light Mode Polish [codex]
- **Світлий режим Помічника** - верхній rail більше не тягне темну compact-плашку у light theme, а використовує чисту світлу CRM-поверхню.
- **Читабельність** - avatar, subtitle lane, input і control buttons отримали окремі light-mode кольори, тіні, hover/focus та disabled states.
- **Guardrail** - UI-smoke перевіряє фінальний light-theme override після старих dark-first compact rules, щоб дизайн знову не регреснув.

---

## v0.60.4 - Assistant Voice Fallback Fix

### Assistant Voice Fallback Fix [codex]
- **Голос Помічника стабілізовано** - відповідь більше не зависає у speaking-анімації без реального старту аудіо.
- **TTS fallback** - backend пробує резервну speech-модель, якщо основна модель озвучення недоступна або відхилена OpenAI.
- **Browser voice fallback** - якщо mp3-відтворення заблоковане, зависло або не стартує, Помічник пробує озвучити відповідь через браузерний `speechSynthesis`.
- **Guardrail** - тести покривають timeout, fallback-стани голосу і безпечний TTS fallback без unsupported-параметрів для legacy speech model.

---

## v0.60.3 - Assistant Timeline Context Fix

### Assistant Timeline Context Fix [codex]
- **Помічник бачить відкриту дату** - питання про розклад у таймлайні тепер беруть дату з `AppState.selectedDate` / `#timelineDate`, а не автоматично з поточного календарного дня.
- **Бронювання не губляться** - якщо API не повернуло записи, але на видимому таймлайні є картки бронювань, Помічник підмішує DOM-зріз і не каже помилково, що бронювань немає.
- **Афіша рахується окремо** - fallback-зчитування з таймлайна не схлопує різні події афіші в один пункт, якщо вони стоять у різний час.
- **Guardrail** - UI-smoke перевіряє selected-date контракт і DOM fallback для видимих booking blocks у shared assistant rail.

---

## v0.60.2 - Assistant Full Rethink

### Assistant Full Rethink [codex]
- **Один canonical avatar** - shared assistant rail більше не рендерить face/glasses/dot-cloud stack; видимий presence зібраний в один компактний avatar path зі спокійними state-кільцями.
- **Читабельний subtitle lane** - відповідь асистента винесена у широку flat-лінію під presence, короткий текст стоїть статично, довгий scroll-иться тільки при overflow і паузиться на hover/focus.
- **Ергономічні controls** - mic, stop, voice, replay і expand отримали однакові hit targets, SVG-іконки, focus-visible стани, disabled states і мобільну перестановку без дрібних кнопок.
- **Auto-pause voice turn** - голосовий запис тепер має аналіз тиші, max-duration fallback, explicit stop/cancel і queue guard, щоб швидкі послідовні turns не губилися.
- **Guardrail** - UI-smoke перевіряє single-avatar DOM, subtitle lane contract і auto-pause/turn queue захист.

---

## v0.60.1 - Tasks Truth Canonical Board

### Tasks Truth Canonical Board [codex]
- **Правда у списку задач** - звичайний `/api/tasks` більше не віддає пізніші active-дублі: backend лишає один canonical active row, а повний duplicate state доступний через governance/dedup.
- **Duplicate policy v2** - duplicate signature тепер спирається на title/day/category/subcategory/owner/checklist і stable source anchor, а не на випадкові source-поля, які різні writers могли заповнювати по-різному.
- **Cleanup без видалення** - міграція `188_tasks_canonical_active_dedup_v2.sql` архівує duplicate active rows як `auto_duplicate_v2`, привʼязує їх до canonical задачі й не видаляє історію.
- **Completed lifecycle** - виконані задачі лишаються в системі, мають `completed_at`, показуються закресленими й доступні в окремому board `Виконано сьогодні`.
- **Меню “Життєвий цикл”** - governance menu отримало dry-run duplicate report, точний count перед cleanup і централізовані дії для виконаних та архівних задач.
- **Guardrail** - UI-smoke перевіряє default duplicate collapse, v2 source anchor, migration marker і dry-run cleanup перед архівацією.

---

## v0.60.0 - Dashboard Scene Board Tools

### Dashboard Scene Board Tools [codex]
- **Сцена і Board зведені в один UX-режим** - кнопка Dashboard тепер явно веде у `Сцена + Board`, а стан дошки лишається одним джерелом правди.
- **Toolbar працює через active tool** - Note, Text, Frame, Widget, Line, Arrow, Rect, Ellipse, Brush, Eraser і Connector активуються одним шляхом `setBoardTool()`.
- **Створення по точці canvas** - create/shape інструменти додають обʼєкти у місце кліку на дошці замість старого одноразового додавання у випадкову позицію.
- **Board settings у налаштуваннях** - додано snap, сітку, напрямні, колір і товщину лінії в settings modal та live tool panel.
- **Backend не губить Board state** - dashboard config тепер приймає всі активні tools, `connector`, `connectors`, `connectorStyle` і `relationType`.
- **Guardrail** - UI-smoke перевіряє active-tool контракт, settings persistence і backend connector preservation.

---

## v0.59.12 - Task Confirm Modal Cleanup

### Task Confirm Modal Cleanup [codex]
- **Один confirm на екрані** - shared `confirmModal()` тепер закриває попередній confirm перед відкриттям нового, тому delete і bulk action більше не накладаються один на одного.
- **Задачі не пробивають клік у сусідні дії** - кнопка видалення зупиняє bubbling, очищає bulk selection і не відкриває додатковий confirm під основним вікном.
- **Без дратівливої анімації** - confirm-вікна для небезпечних дій зафіксовані по центру і без slide/bounce/wave руху.
- **Повторні toast приглушено** - однакові повідомлення протягом короткого інтервалу більше не засмічують екран пачкою дубльованих notification.
- **Guardrail** - UI-smoke перевіряє singleton confirm, motion-free CSS і безпечний delete flow у задачах.

---

## v0.59.11 - Assistant Ukrainian Label Guardrails

### Assistant Ukrainian Label Guardrails [codex]
- **Помічник говорить мовою CRM** - action labels на кшталт `Show overdue tasks`, `Focus work queue` і `FILTER` більше не показуються користувачу англійською.
- **Технічні id приховано** - `team_online`, `staff_today`, `dashboard.focus-work-queue` та схожі ключі перетворюються на людські назви: «Команда онлайн», «Хто на зміні», «робоча черга», «фільтр».
- **Backend guardrail** - prompt і нормалізація відповіді тепер прямо забороняють моделі цитувати внутрішні enum/widget keys у чаті.
- **UI guardrail** - картка рекомендованої дії перекладає типи дій у короткі українські бейджі: «фільтр», «фокус», «оновлення».
- **Тести** - `test:ui` перевіряє локалізацію action/target labels і заборону технічних id у assistant output.

---

## v0.59.10 - HR Account Center And Team Online Truth

### HR Account Center And Team Online Truth [codex]
- **Команда онлайн стала правдивою** - віджет за замовчуванням показує тільки людей, які реально онлайн зараз, без старих last-seen записів у стандартному вигляді.
- **Історія активності тільки за галочкою** - додано тихий перемикач `історія`, який за потреби показує останню активність людей зі зміни.
- **OpenClaw прибрано з команди** - системний інтеграційний акаунт більше не відображається як реальний співробітник у віджеті.
- **HR-центр акаунтів** - у розділі HR додано вкладку `Акаунти` з пошуком, статусами, HR-профілем і безпечним вимкненням акаунтів.
- **Каріна Крамаренко soft-disabled** - додано міграцію, яка вимикає знайдені акаунти й активні employee profiles без фізичного `DELETE`, щоб не ламати історію.
- **Guardrail** - `test:ui` перевіряє live-only default, history toggle, приховування OpenClaw і наявність HR account center.

---

## v0.59.9 - Modal Sweep Animation Kill Switch

### Modal Sweep Animation Kill Switch [codex]
- **Прибрано laggy sweep/shine на CRM-вікнах** - модальні вікна більше не отримують хвилюючий відблиск або repaint-heavy entrance animation поверх контенту.
- **`Продажі програм` стабілізовано** - заголовок звіту більше не підпадає під глобальний sticky `modal-content h3`, тому не малює темний блок у верхній частині модалки.
- **Захист від майбутніх overlay-псевдоелементів** - `modal-content::after` і споріднені window surfaces примусово не створюють sweep/shine overlay.
- **Функціонал звіту збережено** - Excel/CSV, фільтри, таблиці, сортування і виписка продажів лишились без зміни бізнес-логіки.
- **Guardrail** - `test:ui` перевіряє modal motion kill switch і product-sales title override.

---

## v0.59.8 - Tasks Assistant Live Snapshot

### Tasks Assistant Live Snapshot [codex]
- **Помічник читає live snapshot сторінки задач** - `/tasks` тепер експортує `TasksPage.getAssistantSnapshot()` з поточним view, категорією, assistant-фільтром, count-ами вкладок і верхніми задачами зі зрізу.
- **Відповіді більше не спираються на хибні "видимі 6 задач"** - assistant foundation бере live board snapshot перед `/api/tasks/my-cabinet`, тому бачить реальні `Інбокс`, `Сьогодні`, `Наступні`, `Чекаю`, `Командні` і `Мої`.
- **API fallback став чесним** - старий `/api/tasks/my-cabinet` лишився резервом, але тепер названий персональною проєкцією, а не повним видимим task board.
- **Ризики задач grounded у board state** - прострочка, waiting, найближчі дедлайни і задачі без owner тепер формуються з тієї ж логіки, що і екран `/tasks`.
- **Guardrail** - `test:ui` перевіряє live snapshot contract у `tasks-page.js` і пріоритетне використання `TasksPage.getAssistantSnapshot` у `assistant-foundation.js`.

---

## v0.59.7 - Task Observer Visibility Policy

### Task Observer Visibility Policy [codex]
- **Додано політику спостерігачів задач** - у задачі тепер можна вказати людей, які мають право спостерігати за виконанням без перепризначення власника.
- **Повний read-доступ до матеріалів** - спостерігачі проходять через canonical `task_observers` policy і бачать detail, опис, чеклісти, історію дій, logs та робочий контекст задачі.
- **Без зайвих прав на зміну** - observer-доступ не дає виконувати, перепризначати або переносити задачу; mutation лишається за власником і ролями з task authority.
- **UI у detail задачі** - у картці задачі додано блок `Спостерігачі і матеріали` з мультивибором людей і окремим збереженням доступу.
- **Audit trail** - зміна списку спостерігачів пишеться в `task_action_history` як `task_observers_updated`.
- **Guardrail** - тести фіксують durable schema, canonical visibility scope, observer endpoints і UI-контракт доступу до матеріалів.

---

## v0.59.6 - Assistant Chat Input Truth

### Assistant Chat Input Truth [codex]
- **Помічник тепер відповідає на конкретне повідомлення користувача** - backend prompt явно піднімає останній `userMessage` над загальним CRM snapshot, щоб чат не повторював старий briefing замість відповіді на питання.
- **Запит "які саме задачі?" став grounded** - для таких фраз Помічник підтягує видимі активні задачі з `tasks`, повертає назви, відповідальних і терміни, не вигадуючи список із загального dashboard count.
- **OmniClaw `# Помічник` синхронізує той самий діалог** - chat route передає `userId`, `username`, `chatHistory`, сторінку і return context у той самий assistant reply path.
- **Зменшено stale-відповіді** - якщо користувач просить конкретику або список, модель отримує пряму інструкцію відповідати на цю фразу, а не на попередній page-summary.
- **Guardrail** - unit-тест фіксує прямий task-list сценарій і перевіряє, що він повертає фактичні задачі без fallback на старий `Show reply backlog`.

---

## v0.59.5 - Sidebar Passive Time Widgets

### Sidebar Passive Time Widgets [codex]
- **Час у профілі став пасивним індикатором** - клік по чіпу `Час` більше не відкриває жодних панелей і не запускає перехід у профіль.
- **Додано міні-віджет `День`** - у компактній картці користувача тепер видно короткий день тижня і дату без додаткового API-запиту.
- **USD лишився єдиним клікабельним сигналом у цьому блоці** - валютний чіп і далі відкриває курси у фінансах, а службові чіпи не крадуть фокус.
- **Guardrail** - `test:ui` перевіряє, що time/date мають `data-sidebar-static` і що sidebar не повертає стару поведінку з time popup.

---

## v0.59.4 - Assistant Rail Animated Output

### Assistant Rail Animated Output [codex]
- **Відповідь у верхній AI-панелі стала читабельною** - довгі репліки Помічника тепер переходять у рухомий ticker раніше, а не обрізаються трьома крапками.
- **Різні animation states для дій** - idle, thinking, working, listening, speaking/streaming, action, success і error отримали окремі спокійні motion-патерни.
- **Ticker не блокується compact-override правилами** - фінальний CSS contract повертає `assistantTicker` навіть після пізніх topbar overrides.
- **Повний текст доступний без вгадування** - subtitle має `title` і `aria-label`, а клік по рядку й далі відкриває діалог Помічника.
- **Guardrail** - `test:ui` перевіряє ticker threshold, animated state keyframes і те, що ticker запускається з `!important`.

---

## v0.59.3 - Sidebar Alert Exact Open

### Sidebar Alert Exact Open [codex]
- **Конкретний alert відкриває свою ціль** - кнопка `Відкрити` у sidebar carousel тепер веде на поточний alert: задачу, бронювання, склад, ліди, фінанси або Omni-налаштування.
- **Carousel більше не губить контекст** - при гортанні `1 / 12`, `2 / 12` і далі CRM зберігає `alertId` та `targetHref` саме активного слайда.
- **Fallback без хаосу** - якщо alert не має прямого маршруту, відкривається центр сповіщень і CRM скролить до конкретного alert-а.
- **Прочитання синхронізується** - alert, відкритий із sidebar, позначається прочитаним у `crm_alerts_read_v2`.
- **Guardrail** - `test:ui` перевіряє current-alert routing, target href і підсвітку fallback-елемента.

---

## v0.59.2 - Training Shell Recovery

### Training Shell Recovery [codex]
- **Навчання повернуто у спільний CRM shell** - сторінка більше не ховає sidebar, header, пошук, тему і кнопку виходу після входу в режим навчання.
- **Відновлення завислих станів переходу** - training bootstrap знімає старі `page-exiting`, `embed-mode`, `hidden` і busy-стани, якщо попередній fullscreen-перехід залишив сторінку без меню.
- **Session truth збережено** - `/training` перевіряє токен, відновлює `AppState.currentUser`, синхронізує ім'я в header і user card у sidebar.
- **Без дублювання sidebar** - сторінка користується спільним `Sidebar.init()` contract і тільки повертає видимість shell, якщо браузер прийшов із застарілого стану.
- **Guardrail** - `test:ui` перевіряє, що Training не стає ізольованим екраном і не бере direct ownership над logout-кнопкою.

---

## v0.59.1 - Graduation Catalog A4 Recovery

### Graduation Catalog A4 Recovery [codex]
- **Каталог випускних на екрані відновлено** - desktop viewer більше не відкриває пакет як маленьку 680px mobile-card всередині великого темного полотна.
- **Print/PDF відокремлено від viewer DOM** - graduation-друк тепер відкриває dedicated `/api/graduation/catalog/export`, а не друкує interactive viewer shell.
- **Справжній A4 export** - print route отримав `@page A4`, сторінки `210mm x 297mm`, deterministic page breaks і правило один пакет = одна A4-сторінка.
- **Без blank preview** - print document має власний print-safe білий layout, без app chrome, темних overlay, nav buttons і clipped fullscreen viewer.
- **Single-package print** - export підтримує `?package=<slug>` для друку конкретного пакета з designs viewer, а повний export лишає cover + всі package pages.
- **Guardrail** - `test:ui` перевіряє новий screen/print contract, щоб каталог знову не скотився в tiny-card або live-DOM print path.

---

## v0.59.0 - Tasks Truth & Completed Day Board

### Tasks Truth & Completed Day Board [codex]
- **Canonical duplicate policy для задач** - manual create, шаблони, recurring, booking/rule automation, afisha, leads, catalogs, notes і Svitlana тепер проходять через спільний creator або власну source-idempotency, щоб не плодити активні дублікати.
- **Manual duplicate більше не засмічує pool** - повторне створення задачі з тією ж active signature повертає `409 duplicate` і підказує відкрити існуючу задачу, а `force=true` лишився тільки для manual flow і високих ролей.
- **Non-destructive cleanup** - існуючі активні дублікати архівуються з `archive_reason='auto_duplicate'` і `duplicate_of_task_id`, без `DELETE`.
- **Виконані задачі мають явний стан** - `done` проставляє `completed_at`, rollback очищає його, картка має badge `Виконано` і закреслену назву.
- **Board `Виконано сьогодні`** - додано окремий зріз із count badge, часом завершення і сортуванням newest-first.
- **Governance menu** - над Tasks додано компактне керування: показати виконані, перейти в done-today/archive, bulk done/archive/restore, dedup report і cleanup.

---

## v0.58.16 - Calm Modal Windows

### Calm Modal Windows [codex]
- **Прибрано переливи з CRM-вікон** - модалки бронювань, лідів і системні діалоги більше не отримують діагональний shine/sweep поверх контенту.
- **Вимкнено assistant window bridge-анімацію** - JS-спостерігач більше не запускає магічні burst/перелив-ефекти на відкритих вікнах після refresh або перемикання.
- **CSS guardrail для старих класів** - якщо `crm-assistant-linked-window` або `is-window-bridge` лишаться на DOM-елементі, псевдо-overlay примусово не малюється.
- **Збережено самі вікна й дії** - прибрано тільки дратівливий візуальний ефект; кнопки, модалки, бронювання і Помічник лишаються на своїх робочих flow.
- **Guardrail** - `test:ui` перевіряє, що window bridge shimmer вимкнений і старі sweep keyframes не повернулися.

---

## v0.58.15 - Finance Currency Rates Panel

### Finance Currency Rates Panel [codex]
- **Курси валют перенесено у фінанси** - повний список курсів USD/EUR/GBP/PLN/CZK відкривається окремим модальним вікном у модулі `Фінанси`, а не як нижня sidebar-менюшка.
- **Sidebar більше не відкриває незручний нижній блок курсів** - короткий USD-сигнал у профілі веде на `/finance?currency=rates` і одразу відкриває фінансове вікно курсів.
- **Додано перемикач показу USD-чипа** - у шестерні швидкого доступу можна увімкнути або вимкнути показ валютного сигналу в лівому профілі.
- **Стабілізовано task composer** - перемикання `Собі` / `Команді` більше не пересуває кнопки `Деталі` та `+ Додати`, бо колонка відповідального зарезервована.
- **Guardrails** - `test:ui` перевіряє фінансове вікно курсів, sidebar-перемикач і стабільну сітку створення задач.

---

## v0.58.14 - Animator Telegram Target Restore

### Animator Telegram Target Restore [codex]
- **Повернуто робочий Telegram target для `+ Додати аніматора`** - `/api/telegram/ask-animator` тепер шукає окремі `telegram_animator_*` / `telegram_notifications_*` налаштування перед загальним каналом.
- **Omni config став частиною Telegram truth** - якщо Telegram підключений через центр каналів, `getConfiguredChatId()` підхоплює `defaultChatId` з Omni runtime, а не падає на старому порожньому `telegram_chat_id`.
- **Автопідбір topic `Сповіщення` / animator** - коли webhook уже бачив group topic, backend може відправити запит у відому гілку без ручного дублювання thread id.
- **Старий Telegram flow з inline-кнопками збережено** - якщо Telegram реально доступний, натискання `Так` у Telegram знову переводить pending request в approved і додає нову лінію аніматора.
- **Fallback лишився тільки страховкою** - якщо Telegram недоступний, CRM все ще додає лінію локально, але не ховає проблему під фейковим успіхом.

---

## v0.58.13 - Timeline Animator Telegram Fallback

### Timeline Animator Telegram Fallback [codex]
- **Додавання аніматора більше не залежить від Telegram** - якщо Telegram не налаштований, недоступний або повертає помилку, CRM додає нову лінію аніматора локально.
- **Прибрано суперечливі toast-и** - UI більше не показує `Запит надіслано в Telegram...` до фактичного успішного відправлення.
- **Чесний fallback reason** - `/api/telegram/ask-animator` повертає `no_chat_id`, `no_bot_token`, `telegram_circuit_open` або інший зрозумілий reason замість безкорисного 500 для Telegram-збоїв.
- **Pending-запит не зависає** - якщо Telegram-відправка впала після створення pending request, backend позначає його як `failed`.
- **Guardrail** - `test:ui` перевіряє, що timeline add animator flow має локальний fallback і не малює pending-line до підтвердження Telegram.

---

## v0.58.12 - Changelog History Restore

### Changelog History Restore [codex]
- **Відновлено повний ланцюжок `0.58.x` у `Що нового`** - модалка більше не стрибає з `v0.58.10` на `v0.58.6` і `v0.58.0`.
- **Повернуто пропущені записи** - у видимій історії знову є `v0.58.11`, `v0.58.9`, `v0.58.8`, `v0.58.7`, `v0.58.5`, `v0.58.4`, `v0.58.3`, `v0.58.2` і `v0.58.1`.
- **Синхронізовано релізний опис** - верхній запис `v0.58.12` пояснює саме відновлення changelog, а не дублює попередній реліз задач.
- **Guardrail** - `test:ui` перевіряє неперервність видимого ланцюжка `v0.58.12` ... `v0.58.0`, щоб історія знову не загубилась.

---

## v0.58.11 - Task Ownership Clarity

### Task Ownership Clarity [codex]
- **Зрозуміло, коли задача поставлена собі** - картки задач показують людські бейджі `Собі`, `Мені`, `Я поставив: ...`, `Для: ...` замість технічного `assigned`.
- **Вкладка `Мої` стала реальною робочою зоною** - у ній видно і задачі, призначені вам, і задачі, які ви створили для інших людей.
- **Короткий підсумок у `Мої`** - над списком показано, скільки задач зараз на вас, скільки ви поставили собі і скільки делегували команді.
- **Прибрано сирі технічні підказки** - intelligence-бейджі більше не виводять `[object Object]`, а технічні значення перетворюються на читабельний текст.
- **Guardrails** - `test:ui` перевіряє ownership-бейджі, delegated/self логіку вкладки `Мої` і захист від сирих object labels.

---

## v0.58.10 - Task Composer UX

### Task Composer UX [codex]
- **Швидке створення задач стало зрозумілішим** - довгу форму з купою селектів замінено на компактний composer із назвою, вибором `Собі` / `Команді` та основною кнопкою додавання.
- **Задача для себе за замовченням** - нова задача автоматично призначається поточному користувачу; список відповідальних відкривається тільки коли обрано режим `Команді`.
- **Деталі винесені в другий шар** - категорія, пріоритет, дедлайн, видимість, тип і службові режими сховані в блок `Деталі`, щоб основний flow не був перевантажений.
- **Нова задача завжди піднімається нагору** - після створення задача фіксується як найновіша у поточному зрізі, а несумісні фільтри скидаються, щоб вона не зникала.
- **Guardrails** - `test:ui` перевіряє self-first composer, прихований assignee select і клієнтське сортування нових задач нагору.

---

## v0.58.9 - Staff HR Profile Links

### Staff HR Profile Links [codex]
- **HR-профіль з графіка роботи** - клік по конкретній людині, аватару або імені в таблиці графіка відкриває `/hr?employee=<id>` і одразу показує її HR-профіль.
- **Редагування змін збережено** - клітинки дат і змін залишились окремою дією та й далі відкривають модалку редагування зміни.
- **Зв’язування акаунта не конфліктує** - кнопка `Зв'язати` в режимі акаунтів не перехоплюється профільним кліком і продовжує відкривати прив’язку користувача.
- **Доступність** - рядок співробітника отримав `role="link"`, `tabindex`, hover/focus-стан і відкривається з клавіатури через `Enter` або `Space`.
- **Guardrails** - `test:ui` перевіряє HR profile link, keyboard behavior і розділення кліків між профілем, зміною та account-link дією.

---

## v0.58.8 - Schedule Modal Layer Fix

### Schedule Modal Layer Fix [codex]
- **Вікно зміни у графіку роботи завжди зверху** - `schModalOverlay` і `fillWeekOverlay` більше не залишаються під Помічником, smart-menu, каталогами або іншими overlay-шарами.
- **Shared ModalLayer** - у `js/ui.js` додано єдиний guard, який відстежує активні модалки та піднімає їх у системний верхній шар без локальних випадкових `z-index`.
- **Стабільна z-index шкала** - `--z-modal`, `--z-modal-confirm`, notification і tooltip tokens піднято вище assistant/drawer surfaces, щоб ця проблема не повторювалась на інших діалогах.
- **Confirm не губиться** - `confirm-overlay` тепер використовує `--z-modal-confirm`, тому попередження про незбережені зміни відкривається поверх форми.
- **Guardrails** - `test:ui` перевіряє staff schedule modal, fill-week modal, shared modal tokens і прямий виклик `ModalLayer.ensureTopLayer()`.

---

## v0.58.7 - Assistant Dialog Continuity

### Assistant Dialog Continuity [codex]
- **Один актуальний діалог Помічника** - `CrmAssistantRail` перейшов на стабільний user-scoped `conversationId`, щоб поточна розмова не створювала нові випадкові діалоги між сесіями.
- **CRM Chat відкриває правильну гілку** - перехід у `Мої чати` тепер створює або знаходить канал `# Помічник`, синхронізує bridge payload і автоматично вибирає саме цей канал навіть без попередніх повідомлень.
- **Старі сесії позначені сірим** - expanded assistant panel і CRM Chat показують повідомлення зі старих browser-сесій як `стара сесія`, щоб оператор бачив історію, але не плутав її з актуальною гілкою.
- **Enter надсилає повідомлення** - у великому вікні Помічника `Enter` відправляє запит, а `Shift+Enter` лишає перенос рядка.
- **Quick Access без подвійного режиму** - шестерня відкриває тільки меню налаштувань з галочками, а оригінальний список швидкого доступу розгортається лише через стрілку.
- **Guardrails** - `test:ui` фіксує один assistant-dialog, session metadata, old-session styling, Enter-submit і розділену поведінку quick access.

---

## v0.58.6 - Assistant Chat and Alert Actions

### Assistant Chat and Alert Actions [codex]
- **Один діалог Помічника у CRM Chat** - перехід з великого вікна Помічника у `Мої чати` тепер продовжує той самий LLM-діалог, а не залишає користувача у мертвому каналі без відповіді.
- **Історія синхронізується назад** - відповіді, написані у CRM Chat-каналі Помічника, зберігаються у bridge-транскрипті, щоб повернення у вікно Помічника не втрачало контекст.
- **Сповіщення ведуть до місця виправлення** - Omni-alerts на кшталт Viber/SMS/Facebook тепер відкривають `/omni?panel=accounts&channel=...` і підсвічують потрібний канал замість відкриття нецільової форми задачі.
- **Менше шуму від оновлень** - notification center не перемальовує відкриту панель від websocket-події, якщо список сповіщень фактично не змінився.
- **Ширший topbar Помічника** - команда у верхньому меню отримала більше місця, нормальне вирівнювання і дворядкову відповідь без обрізання у вузький банер.
- **Guardrails** - `test:ui` перевіряє chat bridge, actionable Omni alerts, стабільне websocket-оновлення сповіщень і розширену геометрію topbar.

---

## v0.58.5 - Top Menu Assistant Rail

### Top Menu Assistant Rail [codex]
- **Помічник у верхньому меню** - shared `CrmAssistantRail` тепер монтується прямо всередину `.header-content`, перед пошуком і user controls, а не окремою смугою під шапкою.
- **Без накладання аватарів** - фінальний CSS guardrail обрізає дубльовані decorative layers, ripple і particles, щоб залишався один чистий avatar core без наїзду на текст.
- **Lift-out motion** - при hover/focus/робочому стані rail, avatar, input і кнопки м'яко “виходять” зі свого місця через translate/scale-анімації без зсуву layout.
- **Responsive topbar** - на вужчих екранах Помічник стискається у верхньому меню, а зайві action-controls ховаються замість створення другого рядка.
- **Guardrails** - `test:ui` перевіряє, що rail більше не вставляється після header, має top-menu mount і не повертає дубльований avatar overlay.

---

## v0.58.4 - Chat Task Assignment Signals

### Chat Task Assignment Signals [codex]
- **Задача автору повідомлення** - кнопка `Поставити задачу` у чаті тепер за замовчуванням вибирає автора повідомлення, якщо його можна надійно зіставити з доступним виконавцем.
- **Self-task лишився явним** - кнопка `Собі` залишилась, але більше не перетягує default-вибір на поточного користувача без наміру оператора.
- **Звуковий сигнал виконавцю** - після створення або перепризначення задачі CRM шле `task:assigned` конкретному виконавцю через WebSocket і програє `task-new`.
- **Без зайвого шуму** - якщо задача створена самому собі, додатковий WebSocket-сигнал не дублюється.
- **Guardrails** - контрактні тести фіксують default owner з автора повідомлення, typed-owner flow і звуковий `task:assigned` шлях.

---

## v0.58.3 - Unified Assistant Surface

### Unified Assistant Surface [codex]
- **Єдиний Помічник на сторінці** - старий floating widget більше не створює окрему кнопку, чат і панель поверх канонічного верхнього `CrmAssistantRail`.
- **Legacy bridge** - старі виклики `KleshnyaWidget.open()` або кліки по legacy-тригерах тепер відкривають той самий shared rail, а не другий assistant.
- **Timeline safety** - старий `initKleshnyaWidget()` на таймлайні не може повторно показати прихований legacy FAB, якщо вже працює канонічний Помічник.
- **Каталоги без декоративного AI topbar** - у fullscreen/print режимах каталогів `CrmAssistantRail` ховається разом із shell-навігацією, щоб не висіти зверху як нефункціональний елемент.
- **Компактні сторінки каталогів** - hero, статистика, блок послуг, footer і кнопки стали нижчими та щільнішими, щоб сторінка каталогу вміщалась у viewport без довгого прокручування.
- **Guardrail** - `test:ui` перевіряє, що legacy widget делегує у shared rail і не малює другий assistant через `document.body.appendChild(fab)` або старий `/api/kleshnya/chat` flow.

---

## v0.58.2 - Mobile Certificate and Sidebar Stability

### Mobile Certificate and Sidebar Stability [codex]
- **Сертифікати на iPhone** - після видачі нового сертифіката CRM більше не намагається автоматично будувати важкий canvas-preview на мобільному Safari; замість цього відкриває безпечний fallback і лишає завантаження доступним окремою дією.
- **Закриття модалок** - `×`, backdrop і touch-close тепер закривають найближче активне вікно, а не всі модалки одразу, щоб на iPhone не зависали перекриття після помилки або повторного кліку.
- **Експорт таймлайна** - PNG-експорт таймлайна і multi-day view отримали mobile Safari fallback: якщо canvas/download блокується, CRM відкриває зображення у новому вікні замість тихого падіння.
- **Sidebar collapse** - стрілка лівого меню має одного власника стану `Aurora`; подвійний клік більше не перемикає між новим меню і старим legacy-виглядом.
- **Guardrails** - `test:ui` фіксує iPhone certificate flow, shared modal close, timeline image fallback і єдиний collapse owner для sidebar.

---

## v0.58.1 - Assistant Chat and Sidebar Hotfix

### Assistant Chat and Sidebar Hotfix [codex]
- **Помічник у чатах** - діалог із AI можна переносити в CRM-інструмент `Чати` з історією запитів і відповідей.
- **Рекомендовані дії** - фільтри backlog/overdue від Помічника ведуть у реальні dashboard/tasks поверхні, а не лишаються декоративною кнопкою.
- **Sidebar hotfix** - профільна картка більше не накладає ім'я, алерти, USD і час; `Швидкий доступ` знову нормально розгортається.
- **Живий avatar** - верхній Помічник отримав м'які анімації орбіт, точок, очей і speaking/thinking станів без шуму на всю сторінку.
- **Guardrail** - UI-smoke перевіряє assistant filter route і chat transcript bridge.

---

## v0.58.0 - Enterprise Sidebar Navigation

### Enterprise Sidebar Navigation [codex]
- **Sidebar Shell** - ліве меню переведено на компактний enterprise layout із цільовою desktop-шириною `320-340px`, мобільним drawer `min(92vw, 360px)` і стабільним collapsed rail.
- **User Summary** - профільна картка стала чистою: аватар, ім'я, role badge, алерт-рядок, USD і час; weather-блок та декоративні зайві елементи прибрані з sidebar.
- **Метрики** - `Задачі`, `Алерти` і `Ліди` отримали reusable `getMetricTone()` із семантичними станами `neutral/success/warning/danger/info/accent`.
- **Alert Preview** - карусель алертів лишилась робочою, але стала нижчою, спокійнішою і з одним severity marker.
- **Quick Access і секції** - швидкий доступ, `Продажі`, `Команда`, `Продукт`, `Система` вирівняні в одному компонентному стилі без зміни доступів, route config або поведінки редактора.
- **Accessibility** - акордеони отримали `aria-expanded`/`aria-controls`, активні навігаційні пункти отримали `aria-current`, focus states посилені для dark/light тем.
- **Guardrail** - `test:ui` фіксує відсутність sidebar weather fetch, component contracts, metric tones, ARIA і нові width targets.

---

## v0.57.15 - Light Header Contrast

### Light Header Contrast [codex]
- **Пошук у світлій темі** - верхній пошук знову має темний читабельний текст, видиму іконку та контрастний `⌘K`.
- **Перемикач теми** - сонце й місяць у світлому режимі стали помітними на білому фоні.
- **Вікно Помічника** - у світлій темі додано чіткіші рамки для головного вікна, чат-зони, карток дій і поля вводу.
- **Єдиний стиль topbar** - пошук, тема й кнопка виходу тепер виглядають як один набір контролів у світлій оболонці.
- **Guardrail** - `test:ui` фіксує light-theme контраст для shared header search, theme toggle і expanded assistant window.

---

## v0.57.14 - Sidebar Identity Signals

### Sidebar Identity Signals [codex]
- **Повне ім'я у профілі** - картка sidebar більше не обрізає коротке ім'я, а професія лишається компактним бейджем поруч.
- **Без шумного "критично"** - статус алертів залишає тон/крапку, але не забирає місце видимим текстом.
- **Погода стійкіша** - sidebar читає погоду через dashboard API і має прямий Open-Meteo fallback.
- **Клікабельні сигнали** - USD, час і погода відкривають деталізацію; валюта показує кілька курсів і перехід у фінанси.

---

## v0.57.13 - Guardian Private Profanity Details

### Guardian Private Profanity Details [codex]
- **Мат без публічного повтору** - коли Guardian блокує лайку, звичайний користувач бачить тільки безпечну причину без конкретного слова.
- **Деталі тільки власнику** - точні заблоковані слова доступні лише для owner/creator-контексту та службового аудиту Guardian.
- **Чистіший чат** - системне повідомлення більше не дублює значок щита перед текстом блокування.
- **Аудит збережено** - moderation log усе ще містить приватні деталі для розбору інцидентів без показу їх усім у чаті.

---

## v0.57.12 - Search Navigation Hub

### Search Navigation Hub [codex]
- **Пошук сторінок CRM** - глобальний `Ctrl+K` тепер знаходить доступні користувачу сторінки й розділи CRM з реального `Sidebar.NAV_ITEMS`, включно з dashboard, timeline, tasks, leads, chat, finance, reports і profile.
- **Секції теж у результатах** - пошук вміє знаходити вкладки/секції на кшталт каталогів, бібліотеки звуку, афіші, сертифікатів і налаштувань, а не тільки записи з API.
- **Помічник у пошуку** - фрази типу "відкрий фінанси" або "перекинь у ліди" отримують AI-дію через існуючий command router Помічника з fallback на прямий перехід.
- **AI Window Bridge** - велике вікно Помічника і CRM-вікна тепер мають короткий focus-link перехід з м'якими частинками, glow і reduced-motion fallback.
- **Entity-пошук збережено** - бронювання, клієнти, задачі, програми й команда продовжують шукатися через `/api/search`, але навігаційні результати доступні навіть якщо API-пошук тимчасово недоступний.
- **Guardrails** - `test:ui` фіксує navigation hub, assistant redirect commands і стилі нового пошукового результату.

---

## v0.57.11 - Compact Shell Layout

### Compact Shell Layout [codex]
- **Ліве меню вужче** - shared sidebar тепер резервує менше місця через той самий shell token: desktop-ширина стислилась до компактного діапазону `196-220px`, а laptop-режим до `184-210px`.
- **Щільніша навігація** - картка профілю, швидкий доступ, групи меню, іконки та рядки навігації отримали менші відступи й висоту, щоб більше таймлайна вміщалось в один екран.
- **Верхній Помічник без службового шуму** - у верхньому header лишається тільки status-dot, а в rail прибрано видимі `Тиша`, `claude · помічник v3.2`, chips `Екран / Роль / Фокус` і quick prompts; лишається ім'я, коротка відповідь, пошук і керування.
- **Нижчий topbar** - аватар, пошук і кнопки Помічника стали компактнішими, щоб верхній блок не забирав зайву висоту над робочою зоною.
- **Guardrails** - `test:ui` фіксує компактну ширину sidebar і приховані зайві контекстні елементи верхнього rail.

---

## v0.57.10 - Assistant Chat Bridge

### Assistant Chat Bridge [codex]
- **Велике вікно як чат** - у expanded-вікні Помічника історія винесена в окремий chat-workspace з нормальними бульбашками повідомлень, щоб діалог не читався як стиснута бокова колонка.
- **Перехід у CRM Chat** - додано кнопки "Мої чати" у шапці та всередині діалогу Помічника; вони відкривають `/chat?assistantReturn=1` і зберігають сторінку, з якої користувач прийшов.
- **Повернення назад у Помічника** - сторінка CRM Chat показує bridge-плашку "Відкрито з Помічника" з кнопкою повернення; після повернення велике вікно Помічника відкривається знову.
- **Чистіший layout** - action/teaching cards лишаються зліва, а чат займає праву робочу зону з адаптивним fallback на мобільних екранах.
- **Guardrails** - `test:ui` перевіряє chat bridge, return session keys, новий chat-workspace і плашку повернення в CRM Chat.

---

## v0.57.9 - Quick Access Save Cleanup

### Quick Access Save Cleanup [codex]
- **Тільки одна дія в редакторі** - у меню "Швидкий доступ" прибрані службові кнопки "Усі сторінки", "Стандартні" та "Очистити"; лишилася тільки зрозуміла кнопка "Зберегти".
- **Збереження згортає панель** - після натискання "Зберегти" редактор закривається і сам блок швидкого доступу згортається, щоб ліва панель не залишалась роздутою.
- **Чистіший layout** - поле пошуку тепер займає всю ширину, а нижня зона дій не тримає порожні місця під прибрані кнопки.
- **Guardrails** - `test:ui` фіксує, що quick access editor має тільки save-flow і collapsed state після збереження.

---

## v0.57.8 - Sidebar Profile Signals Rail

### Sidebar Profile Signals Rail [codex]
- **USD / час / погода справа** - швидкі сигнали профілю перенесені у праву вертикальну рейку, щоб вони не висіли окремим нижнім рядом.
- **Акуратніший профільний блок** - ім'я, статус, роль і алерти тепер мають власну ліву колонку, а live-сигнали не забирають простір під основним текстом.
- **Компактний role badge** - роль лишається поруч з іменем як малий бейдж з унікальним патерном, але більше не конкурує з правими сигналами.
- **Легший visual rhythm** - додано тонкий розділювач, м'який glow і щільніші signal chips, щоб картка виглядала як один premium cockpit-блок.
- **Guardrails** - `test:ui` фіксує right-side signal rail layout для sidebar identity card.

---

## v0.57.7 - Assistant Chat Text Launcher

### Assistant Chat Text Launcher [codex]
- **Клік по відповіді Помічника** - обрізаний текст у верхньому rail тепер відкриває повне чатове вікно з історією, а не лишається статичним рядком.
- **Chat-format без нового дубля** - використовується вже існуючий expanded assistant chat, тому відповідь видно у нормальних повідомленнях і можна одразу продовжити діалог.
- **Keyboard доступність** - той самий сценарій працює через `Enter` або `Space`, бо subtitle отримав роль інтерактивного елемента.
- **Візуальний affordance** - hover/focus стан показує, що текст клікабельний, але не додає важкої нової кнопки.
- **Guardrails** - `test:ui` фіксує відкриття chat panel з subtitle text і стилі клікабельного стану.

---

## v0.57.6 - Timeline Assistant Schedule Query

### Timeline Assistant Schedule Query [codex]
- **Запити по таймлайну без command-mode** - питання на кшталт “які заходи на завтра” тепер розпізнається як read-only перегляд розкладу, а не як дія для виконання.
- **Реальні дані розкладу** - Помічник на таймлайні читає видимі `/api/bookings/:date` і `/api/afisha/:date` для сьогодні, завтра або післязавтра.
- **Чесний fallback** - якщо розклад недоступний або подій немає, Помічник прямо каже це і не запускає випадкові команди.
- **Guardrails** - `test:ui` фіксує, що timeline schedule query обробляється до command router, а foundation-router лишає такі питання read-only.

---

## v0.57.5 - Profile Layout Polish

### Profile Layout Polish [codex]
- **Компактніший профіль** - верхня картка профілю більше не тримає зайву порожнечу: desktop-метрики зібрані в один щільний ряд, а внутрішні відступи зменшені приблизно втричі.
- **Акуратніша рамка** - profile hero отримав тонкий внутрішній контур, м'який зелений акцент і спокійний об'єм без важкої декоративності.
- **Живіші поля метрик** - картки задач, дня, досягнень і зміни мають власний top-accent, легкий hover lift і кращий border/shine, щоб блок виглядав зібраним, а не плоским.
- **Менше шуму в табах і панелях** - tabs, overview panels і внутрішні метрики стали нижчими, з меншими gap/padding, щоб профіль краще влазив в один екран.
- **Адаптивність без поломки** - на вужчих екранах profile summary переходить у дві колонки, а на мобільному лишається безпечна одна колонка.

---

## v0.57.4 - Quick Access Editor Fix

### Quick Access Editor Fix [codex]
- **Шестерня швидкого доступу** - gear-кнопка тепер стабільно відкриває редактор і не конфліктує з розгортанням секції.
- **Явне збереження** - перемикання сторінок більше не губиться: вибір збирається у редакторі й застосовується кнопкою `Зберегти`.
- **Будь-яка CRM-сторінка** - список для швидкого доступу тепер бере всі внутрішні сторінки системи з sidebar navigation, а не урізаний role-filtered набір.
- **Пошук і масове додавання** - додано пошук по сторінках і кнопку `Усі сторінки`, щоб швидко зібрати потрібне меню.
- **Стандартні / Очистити без сюрпризів** - ці кнопки змінюють поточний вибір у редакторі, а фінальне застосування робить тільки `Зберегти`.
- **Guardrails** - `test:ui` фіксує explicit save, пошук, select-all і стилі нового quick-access editor.

---

## v0.57.3 - Customer Create Link Fix

### Customer Create Link Fix [codex]
- **Створення клієнта без 500 після save** - пошук і список клієнтів тепер умовно підключають `social_identities`, щоб стара або частково оновлена БД не падала на `Internal server error`.
- **Source select у стилі CRM** - chevron і поле `Звідки дізналися` отримали власний темний/світлий стиль без нативного сірого select.
- **Швидке зв'язування в модалці** - форма клієнта має кнопки `Telegram`, `Viber`, `Instagram`, `Телефон`, `Facebook`, які одразу додають правильний канал у соц. ідентичності.
- **Після створення видно інструментарій** - новий клієнт одразу відкривається в detail hub з дзвінком, Telegram/Omni, workspace/бронюваннями і зв'язками.
- **Захист від подвійного save** - кнопка збереження блокується на час запиту, щоб не створювати дублікати й не ловити кілька toast-помилок.
- **Guardrails** - UI-smoke фіксує styled source select, linking tools і відкриття detail hub після створення.

---

## v0.57.2 - Assistant Presence Animations

### Assistant Presence Animations [codex]
- **Нове обличчя Помічника** - rail-avatar отримав окремі очі, окуляри й mouth layer замість одного статичного світлого ядра.
- **Крапки збираються у фігури** - constellation dots перебудовуються під стани thinking, listening, speaking, action, success і error.
- **Голосова міміка** - під час відповіді mouth layer рухається як спокійний voice equalizer, а частинки активніше обертаються навколо avatar.
- **State-aware анімації** - listening розширює очі й пульсує точками, thinking збирає ромб/нейронну фігуру, action показує стрілку, success - check-like shape, error - X-pattern.
- **Expanded panel polish** - у великому вікні Помічника додано малу constellation-анімацію в header, щоб presence виглядав цілісно.
- **Доступність** - `prefers-reduced-motion` вимикає нові рухи без приховування самого avatar.
- **Guardrail** - `test:ui` фіксує face/glasses/dot-cloud markup і state animation CSS, щоб не повернути статичну кульку.

---

## v0.57.1 - Sidebar Identity Polish

### Sidebar Identity Polish [codex]
- **Компактніша профільна картка** - верхній блок у лівому меню став нижчим і акуратнішим, щоб не з'їдати стільки місця в sidebar.
- **USD зліва і реальний fallback** - курс USD тепер стоїть першим у швидких сигналах і, якщо dashboard currency widget недоступний, добирається через `/api/finance/currency/rates`.
- **Роль як бейдж біля імені** - професія/роль показується малим lowercase-бейджем поруч з іменем, а не окремим великим рядком.
- **Унікальні патерни ролей** - для основних CRM-професій додані власні кольори й мікропатерни бейджа: creator, director, manager, hr, art_director, accountant, animator, security, kitchen, service та інші.
- **Швидкий доступ** - секцію `Додатково` перейменовано на компактний `Швидкий доступ`, а текстову кнопку редагування замінено на gear-кнопку з мікроанімацією.
- **Підменю стало очевидним** - розгорнутий швидкий доступ тепер виглядає як вкладена панель з лівим акцентом, м'якшим фоном і компактнішими пунктами.
- **Hover polish** - картка, аватар, role badge і quick signal chips отримали стримані hover-анімації без зайвого шуму.
- **Guardrail** - `test:ui` фіксує USD-first layout, role badge dataset/patterns, quick-access gear editor і currency fallback.

---

## v0.57.0 - Assistant Action Commands

### Assistant Action Commands [codex]
- **Command router** - Помічник тепер спочатку розпізнає безпечні команди дій у rail, а вже потім віддає запит у generic AI reply.
- **Навігація і shell actions** - можна просити відкрити CRM-сторінку, пошук, фінансові борги/аналітику, згорнути меню, змінити тему, відкрити велике вікно, перемкнути голос або compact timeline.
- **Create-task flow** - створення задачі або чекліста працює тільки після явного підтвердження і йде через існуючий `/api/tasks` contract.
- **Safety boundary** - видалення, паролі, токени, права доступу, фінансові мутації та відправка повідомлень заблоковані для прямого виконання Помічником.
- **Ticker fix** - довгі відповіді Помічника в rail більше не застигають обрізаними: compact CSS не вимикає `assistantTicker`, duplicate text у `::after` і nowrap-режим.
- **Guardrails** - `test:ui` фіксує command router, safe/confirmed command boundary, pending navigation actions і захист від повернення CSS override, який зупиняв ticker.

---

## v0.56.8 - Header: пошук і Помічник

### Header Search + Assistant Naming [codex]
- **Пошук на всіх вкладках** - global search тепер монтується через shared authenticated header, тому кнопка `Пошук` є на всіх CRM-сторінках, а не тільки на timeline/index.
- **Єдина search-модалка** - сторінки без старого `#searchModal` отримують спільну модалку автоматично, а `js/search.js` підвантажується з актуальним cache-bust.
- **Стиль header controls** - пошук візуально з'єднаний з theme toggle і `Вийти`: одна висота, радіус, фон, тінь, focus/hover і dark-mode contract.
- **Assistant naming** - user-facing assistant у rail, expanded window, sidebar, chat, landing і bot-відповідях перейменований на `Помічник` без старого crab branding.
- **Безпечні контракти** - внутрішні `/api/kleshnya`, DB tables, file names і service ids лишились без перейменування, щоб не ламати інтеграції.
- **Guardrails** - `test:ui` фіксує і shared header search, і те, що основні visible assistant surfaces використовують `Помічник`.

---

## v0.56.7 - Assistant: неймінг Помічник

### Assistant Rename [codex]
- **Єдиний неймінг** - видимий AI-assistant у rail, expanded window, sidebar, chat surfaces, landing і bot-відповідях тепер називається `Помічник`.
- **Без старого бренду у UI** - legacy `Клешня` прибрано з user-facing assistant текстів, aria-labels, підказок, заголовків, placeholder-ів і промптів.
- **Нейтральний образ** - crab-іконки у видимих assistant-поверхнях замінені на нейтральний helper/robot образ, щоб назва і візуальний сигнал не конфліктували.
- **Технічні контракти збережені** - внутрішні `/api/kleshnya`, DB tables, file names і service identifiers не перейменовувались, щоб не ламати існуючі інтеграції.
- **Guardrail** - `test:ui` фіксує, що основні visible assistant surfaces використовують `Помічник` і не повертають legacy crab branding.

---

## v0.56.6 - Header: пошук всюди

### Shared Header Search [codex]
- **Пошук на всіх сторінках** - global search тепер створюється через спільний `auth.js`, тому кнопка з'являється в header на всіх authenticated CRM-вкладках, а не тільки на таймлайні.
- **Спільна модалка** - search modal автоматично додається на сторінки, де її не було, і підвантажує `js/search.js` з актуальним cache-bust.
- **Візуальна єдність** - кнопка пошуку отримала той самий розмір, радіус, фон і тінь, що theme toggle та `Вийти`, щоб правий header виглядав одним блоком.
- **Темна тема** - search button і search modal мають окремий dark-mode contract без сірих системних контролів.
- **Guardrail** - `test:ui` фіксує, що shared authenticated header інжектить global search і має стилі в `layout.css`.

---

## v0.56.5 - Timeline: компактний екран

### Timeline Compact Fit [codex]
- **Компактний режим** - перемикач тепер синхронізується зі збереженим станом і реально вмикає compact-density, а не просто міняє checkbox.
- **Один екран** - ширина клітинок рахується від видимої ширини таймлайна, тому день у compact-режимі намагається влізти без зайвого горизонтального розтягування.
- **Висота таймлайна** - основна сітка отримала обмеження по висоті і власний скрол всередині, щоб сторінка не роздувалась через багато ліній.
- **Zoom + compact** - режими `15хв`, `30хв`, `60хв` більше не перебивають compact-стилі завеликими рядками.
- **Guardrail** - `test:ui` фіксує fit-screen контракт, синхронізацію toggle state і compact zoom overrides.

---

## v0.56.4 - Помічник: зручне вікно

### Assistant Panel Layout Fix [codex]
- **Нижня панель** - поле запиту і кнопка `Запитати` винесені в окремий стабільний ряд, тому більше не налазять на prompt-картки та історію.
- **Робоча зона** - snapshot, action proposal, guided teaching, режими, quick prompts і історія тепер живуть у власній scroll-зоні всередині вікна.
- **Кнопки дій** - довгі labels на action/teaching buttons переносяться нормально і не ламають картки.
- **Guardrail** - `test:ui` фіксує окремий workspace/composer contract для expanded assistant window.

---

## v0.56.3 - Sidebar: меню і статус

### Sidebar Menu Polish [codex]
- **Профільне вікно** - верхня sidebar-картка стала компактним статус-блоком з часом Києва, погодою і курсом USD з існуючих dashboard widgets.
- **Додатково** - блок швидких сторінок став нормальною клікабельною плашкою з чітким `+`, кращим hover/focus і компактною кнопкою редагування.
- **Групи меню** - `Продажі`, `Команда`, `Продукт` і `Система` отримали менші іконки, стабільне вирівнювання і більше не наїжджають на текст.
- **Візуальний ритм** - меню стало спокійнішим: менше зайвих квадратних плям, коротші проміжки між групами, читабельніший active/open стан.
- **Guardrail** - `test:ui` фіксує новий sidebar readability contract, щоб компактні density-оверрайди знову не ламали `Додатково` і заголовки груп.

---

## v0.56.2 - CRM UI-виправлення

### Lead Cards + Reports Modal + Header UI Fix [codex]
- **Картки лідів** - quick action buttons у Kanban більше не пробивають клік у батьківську картку, тому редагування/дзвінок не відкривають випадково весь кейс.
- **Робоче вікно ліда** - hero-блок більше не стискає ім'я клієнта в колонку по одному символу; дії переносяться рядками без ламання тексту.
- **Модалки поверх workspace** - редагування, картка клієнта, причина втрати та прив'язка клієнта відкриваються вище за drawer ліда, а не під ним.
- **Форма звіту** - поля `Тип`, `Категорія` і `Хештеги` отримали єдиний темний стиль з рештою форми, без системних сірих select-ів.
- **Правий header** - ім'я профілю прибрано з topbar, а перемикач теми і кнопка `Вийти` стали компактними, рівно вирівняними й в одному стилі.
- **Guardrail** - `test:ui` фіксує z-index, layout-контракт workspace, ізоляцію кліків на action-кнопках Kanban, polished controls у формі звіту і компактний правий header.

---

## v0.56.1 - AI Assistant: пострелізне зміцнення

### Assistant Post-Release Hardening [codex]
- **Telemetry diagnostics** - додано low-noise `/api/crm-assistant/telemetry` для blocked playback, snapshot failures, missing teaching targets, voice/transcription failures і unavailable actions.
- **Безпечні логи** - telemetry payload санітизується на backend, не пише токени/секрети і зберігає тільки page, module, assistant state, reason та fallback fact.
- **Frontend observability** - shared rail і foundation контракти тепер репортують реальні fallback/failure paths без нового assistant framework.
- **Guardrail** - `dashboard-assistant` route test і `test:ui` фіксують telemetry route, redaction і frontend emitters.

---

## v0.56.0 - AI Assistant: флагманський провідник

### CRM Assistant Flagship Layer [codex]
- **Єдиний assistant layer** - Помічник працює через shared rail, foundation store, page adapters, action registry, teaching targets і нормалізовану reply schema без dashboard-only fork.
- **Core-page intelligence** - dashboard/work queue, tasks, finance, leads і chat беруть сигнали з реальних CRM API snapshots і мають safe next actions там, де є стабільний handler.
- **Strategic advisor** - відповіді тримають формат "що бачу -> чому важливо -> одна дія" з role-aware framing для director, manager, hr, art_director і creator.
- **Voice UX** - озвучення має replay/interruption lifecycle, blocked-playback fallback у текстовий режим, читабельні subtitles і спокійні presence states.
- **Guided teaching** - assistant-safe highlights і короткі 2-3 крокові сценарії для dashboard queue, прострочених задач, боргів, follow-up лідів і unread chat.
- **Release guardrails** - `npm test` фіксує contracts, API snapshot hooks, action proposal UI, teaching runner, role/session boundary, voice lifecycle і core-page flagship coverage.

---

## v0.55.45 - Timeline: drag ведучих

### Timeline / Linked Host Drag [codex]
- **Переміщення ведучих** - блоки першого і другого ведучого тепер мають однаковий drag-контракт: тягнути можна будь-який пов'язаний блок бронювання на таймлайні.
- **Групове збереження** - drag пов'язаного ведучого зберігається через головне бронювання, тому backend більше не відхиляє переміщення linked-позиції.
- **Лінії та час** - якщо рухається один linked-блок, його нова лінія зберігається окремо, а час усієї групи бронювання синхронно зсувається.
- **Guardrail** - `npm run test:ui` фіксує, що linked host blocks можуть ініціювати груповий drag, але resize лишається тільки на основному блоці.

---

## v0.55.44 - Timeline: фільтр аніматорів

### Timeline / Animator Picker [codex]
- **Список аніматорів** - select у модалці `Редагувати аніматора` тепер бере активних працівників зі `Staff`, а не старий ручний localStorage-список.
- **Фільтр ролей** - у списку лишаються тільки штатні аніматори та фріланс-аніматори: `role_type=animator`, позиція "аніматор/animator" або фріланс у відділі аніматорів.
- **Лінії таймлайну** - джерело `staff_schedule` більше не підтягує весь відділ `animators` гуртом, щоб батутисти/адміни не просочувались у лінії.
- **Guardrail** - додано тест, який фіксує staff-based picker і забороняє повернення до `getSavedAnimators()` у select.

---

## v0.55.43 - Sidebar: згортання з іконками

### Sidebar / Collapse Rail [codex]
- **Кнопка меню** - кнопка згортання/розгортання повернена у верхній brand-блок sidebar і працює для обох станів.
- **Mini rail** - у згорнутому меню з'явився вертикальний icon rail зі сторінками CRM, активним станом, бейджами й title-підказками.
- **Shell geometry** - collapsed-стан більше не розгортається сам на hover і не перекриває сторінку, ширина лишається `--eg-sidebar-collapsed-w`.
- **Guardrail** - `npm run test:ui` фіксує shared collapse contract, щоб кнопку або icon rail не прибрали наступними правками.

---

## v0.55.42 - Timeline: адаптивний малий екран

### Timeline / Responsive Layout [codex]
- **Панель керування** - toolbar таймлайна на laptop/small viewport тепер стискається рівномірно й переносить дії по рядках без розпору сторінки.
- **Сітка таймлайна** - ширина клітинок і лівих підписів ліній адаптується до viewport через єдиний JS/CSS contract, тому бронювання, now-line і grid залишаються синхронними.
- **Sidebar** - ширина лівого меню на вузьких desktop-екранах зменшена, щоб робоча зона таймлайна не ховалась за shell offset.
- **Guardrail** - `npm run test:ui` тепер фіксує responsive density contract для timeline/sidebar і не дає повернути стару розпираючу геометрію.

---

## v0.55.41 - Sidebar: простий вибір додаткових сторінок

### Sidebar / Additional Pages [codex]
- **Checklist editor** - редагування блоку `Додатково` спрощено до списку CRM-сторінок із галочками замість ручних полів URL, опису та іконки.
- **One-click selection** - галочка одразу додає або прибирає сторінку з quick menu; список будується з доступних для ролі сторінок CRM.
- **Defaults** - кнопка `Стандартні` повертає Дашборд, Таймлайн, Задачі й Чат, а `Очистити` знімає всі вибрані сторінки.
- **Guardrail** - `npm run test:ui` тепер перевіряє checklist contract і відсутність старої форми редагування в `Додатково`.

---

## v0.55.40 - Header: перемикач теми

### Header / Theme Toggle [codex]
- **Header control** - перемикач світлої/темної теми перенесено з sidebar у правий header біля імені користувача.
- **Sun / moon states** - тумблер показує сонце у світлій темі й луну у темній, з рухомим thumb, `aria-pressed` і focus-visible станом.
- **Cleanup** - sidebar більше не інжектить `.sidebar-theme-btn`, а таймлайн не показує старий checkbox `Тема` в toolbar.
- **Guardrail** - `npm run test:ui` перевіряє ownership перемикача в header/auth layer, щоб theme control не повернувся в sidebar або timeline controls.

---

## v0.55.39 - Sidebar: без дубля меню дня

### Sidebar / Navigation Cleanup [codex]
- **Меню дня** - прибрано окремий блок швидких кнопок `Брифінг / Таймлайн / Задачі`, бо він дублював секцію `Додатково`.
- **Додатково** - блок лишився єдиним місцем для швидкого доступу до Дашборда, Таймлайна, Задач, Чату і користувацьких сторінок.
- **Layout contract** - порядок sidebar зафіксовано як command deck -> `Додатково` -> основна навігація; старий `sidebarTodayDock` видаляється при кожному рендері.
- **Guardrail** - `npm run test:ui` тепер перевіряє, що дубль `Меню дня` не повертається в JS contract і порядок секцій лишається стабільним.

---

## v0.55.38 - Клієнти: створення без 500

### Customers / Create Flow [codex]
- **Create customer** - виправлено створення нового клієнта з модалки `Клієнти`, яке могло завершуватись `Internal server error`.
- **Schema resilience** - backend тепер безпечно працює з `customers.social_identities`: додає колонку additive шляхом або повторює legacy-write без цього поля, якщо live-схема ще не оновлена.
- **Supabase parity** - Supabase write path отримав `social_identities` і fallback для старого schema cache, щоб create/update не блокували операторів.
- **UX** - frontend save-flow читає error JSON з API та показує зрозуміліший текст помилки при невдалому збереженні.
- **Guardrail** - `operations-flow-v2` тест перевіряє fallback path для customer social identities, щоб create/update не повернувся до 500 через schema drift.

---

## v0.55.37 - Sidebar: листання алертів

### Sidebar / Alert Carousel [codex]
- **Alert paging** - картка критичного алерту в sidebar тепер тримає список активних алертів і реальний cursor замість декоративного `1 / N`.
- **Controls** - додано кнопки `‹` / `›` для перемикання alert hero, а основна дія `Відкрити` лишилась окремою кнопкою для повної панелі алертів.
- **State stability** - після оновлення даних sidebar намагається лишити поточний алерт активним, якщо він ще є у списку.
- **Guardrail** - `npm run test:ui` перевіряє JS/CSS contract alert carousel, щоб лічильник не повернувся у статичний текст.

---

## v0.55.36 - Помічник: нормальне вікно

### Assistant / Expanded Window [codex]
- **AI Workspace** - відкрите вікно Помічника перероблено з вузького drawer у ширшу workspace-картку з нормальними зонами контексту, режимів, історії і форми.
- **Layout** - snapshot, режими роботи, quick prompts, історія та поле запиту розкладені по двоколонковій сітці на desktop і переходять у одну колонку на mobile.
- **Theme** - додано окремий dark/light surface contract для overlay, panel, history, prompt buttons і textarea.
- **Guardrail** - `npm run test:ui` перевіряє, що expanded assistant window більше не є cramped drawer і має responsive fallback.

---

## v0.55.35 - Sidebar: компактний верхній блок

### Sidebar / Compact Command Deck [codex]
- **Compact profile block** - верхню командну картку sidebar ущільнено: менші внутрішні відступи, компактніший avatar, коротший health badge і нижча profile card без обрізання імені.
- **Focus chips** - лічильники задач, алертів і лідів стали нижчими, щоб блок не забирав перший екран меню.
- **Alert card** - primary alert hero зменшено по висоті: компактніший kicker, title, meta і кнопка `Відкрити`, але сценарій швидкої дії лишився видимим.
- **Guardrail** - `npm run test:ui` перевіряє фінальний `v0.55.35` CSS override, щоб старі sidebar-стилі не перебивали компактність.

---

## v0.55.34 - Клієнти: темна тема

### Customers / Dark Theme [codex]
- **Dark surfaces** - сторінку `Клієнти` переведено на темний surface contract для KPI-карток, вкладок, фільтрів, таблиці, empty-state, RFM/NPS/bulk блоків і customer detail modal.
- **Text contrast** - виправлено ієрархію тексту в dark mode: primary заголовки й імена стали світлими, secondary-дані читаються через `#CBD5E1`, helper/muted текст через `#94A3B8`.
- **Theme compatibility** - dark overrides тепер працюють і для `body.dark-mode`, і для `html[data-theme="dark"]`, щоб сторінка не залишалась напівсвітлою при різних шляхах перемикання теми.
- **Guardrail** - `npm run test:ui` перевіряє наявність customers dark surface contract і readable empty-state text.

---

## v0.55.33 - Changelog: послідовність релізів

### Release Notes / Version History [codex]
- **Що нового** - виправлено видиму історію релізів у модалці: після актуального релізу більше немає стрибка з `v0.55.32` одразу на `v0.55.8`.
- **Послідовність** - повернено проміжні записи `v0.55.31 -> v0.55.9`, включно з останніми sidebar, AI, OmniClaw, графіком, warehouse і reports змінами.
- **Guardrail** - UI-smoke перевіряє, що changelog modal має неперервний верхній ланцюжок `v0.55.33 -> v0.55.32 -> v0.55.31 -> v0.55.30` і не перескакує прямо на `v0.55.8`.

---

## v0.55.32 - Sidebar: стабільне меню дня

### Sidebar / Day Menu Stability [codex]
- **Меню дня** - закріплено явний порядок секцій sidebar: command deck, `Меню дня`, `Додатково`, основна навігація. Тепер часткові перерендери не можуть викидати меню дня нагору.
- **Додатково** - блок отримав persist-згортання через localStorage і окрему дію редагування; редагування завжди розгортає секцію, а згортання закриває editor.
- **Темна тема профілю** - профільний блок із іменем користувача має окремий dark override після світлого pass, без залишків light-theme surfaces.
- **CSS contract** - додано order/position guard для sidebar-секцій, щоб layout не залежав від випадкового DOM-порядку після кліків.
- **Guardrail** - UI-smoke перевіряє стабільні slots, collapsed-state для `Додатково` і dark cleanup профільної картки.

---

## v0.55.31 - Світла тема: sidebar і AI shell

### Sidebar / Light Theme Fix [codex]
- **Profile name** - статус `критично/готово` більше не стискає ім'я в одну вузьку колонку, тому `Сергій` не переноситься по літерах.
- **Light sidebar** - для світлої теми додано окремий surface contract для sidebar: фон, профіль, алерт, навігація, додаткові сторінки і меню дня більше не виглядають як напівтемний shell.
- **AI topbar** - header і AI rail отримали світлі surfaces, контрастний текст, поля пошуку і кнопки під light mode.
- **Dark parity** - темний режим не зламано: нові light overrides працюють тільки через `body:not(.dark-mode)`.
- **Guardrail** - UI-smoke перевіряє light-theme sidebar і assistant rail contract, а також стабільний layout імені.

---

## v0.55.25 - Навігація: повна профільна картка

### Sidebar / Profile Card [codex]
- **Full name** - ім'я в sidebar profile card більше не обрізається через ellipsis і може переноситись у межах картки.
- **Long position** - роль/посада винесена в окрему читабельну лінію з normal wrap, щоб довгі назви посад не ламали layout.
- **Health badge** - статус `критично/готово` отримав власну праву колонку й більше не забирає ширину в імені.
- **Visual polish** - профільна картка отримала більш зібраний premium surface, більшу аватарку й стабільну типографіку.

---

## v0.55.24 - Навігація: без накладання меню

### Sidebar / Interaction Contract [codex]
- **Collapsed rail** - згорнуте меню на desktop більше не розкривається поверх сторінки від hover; повний sidebar відкривається тільки явною дією користувача.
- **Shell offsets** - `header`, `main-content` і `page-container` у collapsed/full states використовують ті самі ширини, що й фактичний sidebar.
- **Visual bleed** - прибрано широкий правий shadow/veil, який затемнював графік і виглядав як накладання меню на контент.
- **Guardrail** - додано UI-smoke перевірки для collapsed rail, hover-поведінки й однакових offsets у shell.

---

## v0.55.23 - Навігація: стабільне меню на сторінках

### Sidebar / Cross-page Geometry [codex]
- **Page-container shell** - сторінки з `main.page-container`, включно з `/graduation`, тепер отримують той самий sidebar offset і ширину, що й `main-content`.
- **Brand layout** - `Event Genix` у sidebar більше не переноситься у дві криві колонки й не стискає шестерню.
- **Identity card** - ім'я, роль і статус користувача отримали bounded overflow contract, щоб картка не ламала меню на вузьких сторінках.
- **Guardrail** - додано UI-smoke перевірку для page-container geometry і nowrap-контракту бренду.

---

## v0.55.22 - Навігація: повернено шестерню

### Sidebar / Brand Mark [codex]
- **Event Genix logo** - у sidebar повернено справжню шестерню `images/gear-logo.svg` замість Claude-style shield mark.
- **Brand CSS** - вимкнено псевдо-іконки `.sidebar-brand::before` / `.sidebar-brand::after`, які перекривали реальний логотип.
- **Motion** - для брендового логотипа прибрано зайву анімацію й glow, щоб шестерня виглядала стабільно та не відволікала.
- **Guardrail** - додано UI-smoke перевірку, яка фіксує, що шестерня показується, а shield-псевдоелементи вимкнені.

---

## v0.55.21 - Навігація: повний sidebar shell

### Shared Shell / Cross-page Guardrail [codex]
- **Content page** - сторінку `/content` підключено до стандартного CRM shell: sidebar, header, `mainApp`, `main-content`, login overlay і mobile overlay тепер є в DOM так само, як на решті сторінок.
- **Sidebar contract** - прибрано розрив, коли сторінка завантажувала `sidebar-aurora.css` / `sidebar.js` і викликала `Sidebar.init("#sidebarLinks")`, але не мала `#sidebarNav` та `#sidebarLinks`.
- **Cross-page audit** - перевірено сторінки зі спільним sidebar: `Меню дня` рендериться як 3 кнопки, `+ Додатково` як 4 CRM-пункти без зовнішніх лінків, дублікати shell-елементів не створюються.
- **Release safety** - додано UI guard, який ловить сторінки з підключеним sidebar script без реального sidebar shell.

---

## v0.55.20 - Навігація: CRM extras і меню дня

### Sidebar / IA Cleanup [codex]
- **Додатково** - прибрано зовнішні лінки Notion, Google Calendar і Mono; блок тепер показує внутрішні вкладки CRM: Дашборд, Таймлайн, Задачі, Чат.
- **Меню дня** - замість старого `Сьогодні` зі списком і налаштуваннями додано компактну менюшку на 3 кнопки: Брифінг, Таймлайн, Задачі.
- **Access logic** - пункти в `+ Додатково` будуються з існуючого role-aware sidebar contract, тому не показуються ролям без доступу.
- **Guardrail** - додано UI-smoke перевірку, щоб зовнішні лінки не повернулися в sidebar випадково.

---

## v0.55.19 - Навігація: compact sidebar і AI fix

### Shared Shell / Geometry Fix [codex]
- **Sidebar geometry** - зменшено ширину й вертикальні розміри sidebar, щоб контент не стискався і блоки не роз'їжджались.
- **Сьогодні / Додатково** - dock-секції `Сьогодні` і `+ Додатково` стиснуто до компактних рядків без гігантських карток.
- **AI panel** - AI-панель стала нижчою й рівніше вбудованою під topbar, без зайвого розпору сторінки.
- **AI avatar** - зелену плямку/ядро в аватарі AI піднято вище, щоб вона не виглядала обрізаною або з'їханою.

---

## v0.55.18 - Навігація: Today dock і calm AI shell

### Shared Shell / Claude Design Parity [codex]
- **Сьогодні** - вкладку `Сьогодні` винесено зі старої accordion-групи в окремий dock-блок за принципом `+ Додатково`.
- **Налаштування** - у `Сьогодні` додано локальне налаштування видимих швидких пунктів: Дашборд, Таймлайн, Задачі, Чат.
- **Calm motion** - прибрано decorative pulse/ripple/stagger анімації sidebar, щоб shell був ближчий до статичного Claude Design.
- **AI panel** - вбудовану AI-панель зроблено спокійнішою: без ripple/ticker-анімацій, з рівнішим surface і менш нав'язливим glow.

---

## v0.55.17 - Навігація: closer Claude Design shell

### Shared Shell / Claude Design Parity [codex]
- **Sidebar** - sidebar наближено до Claude Design: ширший matte shell, shield-style brand, operator card, alert hero і блок `+ Додатково`.
- **AI topbar** - Помічника винесено з floating overlay у широку AI-панель під topbar, як у дизайн-макеті.
- **Header** - topbar отримав компактний status `Помічник · готовий`, темні controls, search і user block у стилі макету.
- **Responsive** - ширина sidebar і AI panel адаптуються через clamp; prompts/inline controls стискаються на середніх екранах.

---

## v0.55.15 - Звіти: без зайвих графіків

### Reports / UI Cleanup [codex]
- **Звіти** - з основної вкладки прибрано зайві графіки `Динаміка прибутку`, `Витрати по категоріях` і `Доходи vs Витрати (по днях)`.
- **Фокус сторінки** - залишено операційні KPI, блок чергових, фільтри, таблицю звітів, статуси й дії без важких chart-карток унизу.
- **Frontend cleanup** - видалено Chart.js CDN, chart canvas markup, CSS для chart-карток і JS-рендер `renderCharts`, щоб сторінка не тягнула непотрібну бібліотеку.
- **Safety** - додано UI guard, який перевіряє, що ці графіки та Chart.js не повернуться у `reports.html`.

---

## v0.55.14 - OmniClaw: чистий inbox і канали окремо

### OmniClaw / Communications [codex]
- **Inbox UX** - сторінку `Комунікації` очищено від setup/debug блоку в лівій колонці: список розмов більше не змішується з підключеннями каналів.
- **Канали** - підключення Telegram, Viber, SMS, соцмереж і телефонії винесено в окремий режим `Канали` з картками стану, CTA і перевіркою.
- **Стан** - додано окремий режим `Стан` з KPI по готових, обмежених і непідключених каналах та human-readable діями.
- **Empty state** - центральний порожній стан перероблено: замість велетенського `Om` є акуратна картка з діями `Канали` і `Стан`.
- **Dark layout** - темний інтерфейс вирівняно для topbar, режимів, cards і health rows, щоб сторінка не виглядала як зламана debug-панель.

---

## v0.55.13 - Графік: вчора, сьогодні і наступні дні

### Staff Schedule / UX [codex]
- **Графік роботи** - стартовий вигляд більше не відкривається жорстко на понеділок-неділю; тепер одразу показує 9-денне вікно від учора через сьогодні до найближчих наступних днів.
- **Today flow** - кнопка `Сьогодні` повертає користувача в той самий практичний діапазон `вчора → сьогодні → наступні дні`, щоб актуальний день не був притиснутий до краю таблиці.
- **Діапазони** - підвантаження графіка, підрахунок годин, навантаження та CSV-експорт беруть фактичний кінець видимого періоду, а не захардкожений сьомий день.
- **UX copy** - навігацію графіка перейменовано з тижня на період там, де це більше не календарний понеділок-неділя.

---

## v0.55.12 - Таймінги: аніматори зі зміни

### Timeline / HR Schedule [codex]
- **Таймінг** - рядки аніматорів тепер синхронізуються з `staff_schedule` для вибраної дати й автоматично створюються з реальними іменами працівників на зміні.
- **HR schedule** - джерелом правди стали активні аніматори зі статусом `working` або `remote`; якщо змін на дату немає, лишається старий fallback з дефолтними лініями.
- **UX** - під іменем аніматора в таймлайні показується час зміни, наприклад `10:00-20:00 · зі зміни`.
- **Safety** - порожні старі дефолти `Аніматор 1/2` прибираються тільки коли є реальні зміни; ручні або зайняті бронюваннями/афішею рядки не видаляються.

---

## v0.55.11 - Warehouse: склади, закупки і підрядники

### Warehouse / Procurement / Contractors [codex]
- **Warehouse** - склад перебудовано в multi-location модель з фізичними локаціями, default режимом `Склади`, картками складів і фільтрацією stock по `location_id`.
- **Procurement** - закупки тепер мають `target_location_id`, `contractor_id`, source `low_stock`, receiving flow і оприбуткування в конкретний склад через movement journal.
- **Contractors** - підрядники розширені contact card, каналом звʼязку, шаблонами першого/повторного повідомлення, reliability/price memory і endpoint `GET /api/contractors/:id/order-context`.
- **Pinata** - піньяти та матеріали піньят привʼязані до локації `Аніматорська`, але лишаються доступні в окремому операційному табі.
- **Transfers** - додано `warehouse_stock_movements`, переміщення між складами, історію рухів і звʼязку `stock item → low stock → закупка → підрядник → receiving`.
- **Deploy** - версійні маркери, cache-bust теги, changelog і `/api/version` піднято на `v0.55.11` для production smoke.

---

## v0.55.9 - Рахунки: системний checkbox у модалці

### Finance UI / Release [codex]
- **Опис релізу** - видиму назву і release notes переписано конкретніше: тепер одразу зрозуміло, що зміна стосується checkbox у модалці створення рахунку.
- **Finance UI** - опис фіксує CRM-style checkbox contract для модалки рахунку без нативного browser-control вигляду.
- **Deploy** - версійні маркери, cache-bust теги, changelog і `/api/version` піднято на `v0.55.9` для чистого production smoke.

---

## v0.55.8 - Рахунки: системна галочка у формі

### Finance UI / Forms [codex]
- **Finance UI** - checkbox у модалці створення рахунку приведено до системного стилю CRM замість нативної browser-галочки.
- **Form Controls** - додано reusable `fin-check` / `form-check` contract для unchecked, checked, hover, focus, disabled і dark-mode станів.
- **Accounts API** - toggle `Особистий рахунок` тепер передає `isPersonal` і зберігає `finance_accounts.is_personal`, щоб control був не декоративним, а частиною data contract.

---

## v0.55.7 - Аналітика: темна тема без білих фонів

### Analytics / Release [codex]
- **Опис релізу** - назву і видимий опис analytics-релізу переписано конкретніше: тепер одразу видно, що fix прибирає білі фони в темній Аналітиці.
- **Dark Theme** - release notes явно описують темні KPI, charts, tables, period tabs і segment blocks як одну систему без light-mode поверхонь.
- **Deploy** - версійні маркери, cache-bust теги, changelog і `/api/version` піднято на `v0.55.7` для чистого production smoke.

---

## v0.55.6 - Аналітика: темна тема і контраст

### Analytics / Dark Theme [codex]
- **Dark Theme** - вкладку `Аналітика` переведено на власний dark surface contract без білих карток, світлих chart-поверхонь і light-mode table/segment плям.
- **Typography** - вирівняно primary, secondary і muted text для KPI, charts, tables, helper text і segment blocks, щоб тексти читалися впевнено в dark mode.
- **Charts & Tables** - period tabs, KPI cards, chart containers, table headers, horizontal tracks, legends і customer segments отримали єдині dark-aware кольори.
- **Maintainability** - критичні inline color styles у `js/analytics-page.js` замінено semantic classes; динамічні кольори фінкатегорій проходять через safe CSS color fallback.

---

## v0.55.5 - Зарплатні схеми, калькулятор і звіти

### Payroll / Release [codex]
- **Опис релізу** - назву і видимий опис зарплатного релізу переписано нормальною українською, щоб на першому екрані було зрозуміло, що саме змінилося.
- **Зарплати** - реліз явно описує новий workspace для схем зарплат, простого сценарію `сума за вихід`, калькулятора preview і місячних звітів.
- **Deploy** - версійні маркери, cache-bust теги, changelog і `/api/version` піднято на `v0.55.5` для чистого production smoke.

---

## v0.55.4 - Salary Schemes & Payroll Workspace

### Payroll / Finance [codex]
- **Payroll Workspace** - вкладку `Фінанси → Зарплати` перезібрано з плоского погодинного звіту в робочий простір із режимами огляду, конструктора і звіту.
- **Salary Schemes** - додано foundation для схем `per_shift`, `hourly`, `monthly_fixed`, `percent`, `hybrid` і `manual` з окремим backend contract.
- **Calculator Preview** - для простих кейсів є сценарій “сума за вихід”, а для складних - блоки бази, бонусів, відсотків, утримань і авансів із payslip preview.
- **Reports** - додано payroll snapshot layer для майбутніх автоматичних зарплатних звітів зі статусами `draft / reviewed / approved / paid`.

---

## v0.55.3 - Profile Nav Polish + Reward Claim Contract

### Profile / Rewards [codex]
- **Profile** - верхню навігацію профілю перероблено в чистішу system-aligned menu surface з розділенням primary і secondary tab layers.
- **Rewards** - claim/reward flow у профілі уніфіковано для daily quests, seasonal quests і achievement-related surfaces.
- **UX** - кнопки `Забрати` мають pending/success/error state, а баланс і статус нагород оновлюються одразу.
- **Backend** - виправлено reward lookup у daily quest claim route, щоб отримання нагороди не ламалось на некоректному SQL.

---

## v0.55.2 - Chat Settings Auth UAT Hardening

### Chat Settings / Auth [codex]
- **Settings Auth** - `/chat-settings` більше не показує робочий shell до успішної auth/API-перевірки.
- **UAT Flow** - неавторизований production smoke тепер переходить у нормальний login flow замість зависання на статусі `Завантаження`.
- **Visibility** - помилки завантаження settings отримали явний статус у AI/Guardian блоках без сирих ключів у frontend.

---

## v0.55.1 - Chat Guardian / AI / Settings / Verification Sweep

### Chat / Guardian / Settings [codex]
- **Chat UX** - виправлено visibility ключових Guardian stats, стабілізовано date divider і прибрано panel overlay collisions.
- **Guardian** - digest, security log та analytics переведені під єдиний panel-state manager замість незалежних накладених surface-ів.
- **Settings** - AI, integration та Guardian configuration винесено в окрему сторінку `/chat-settings`.
- **AI Contract** - chat summary і Guardian використовують unified provider/key configuration із shared key source `crm_ai_default`.
- **Verification** - додано UI/API guardrails для chat verification sweep і фіксації known gaps після deploy.

---

## v0.55.0 - Tasks Taxonomy + Checklist Infrastructure

### Tasks / Operations [codex]
- **Tasks** - плоскі category filters розширено до taxonomy infrastructure з top-level categories `Замовлення` та `Чек-листи`.
- **Operations** - додано контури `Кухня / Кондитерка / Торти / Прикраси` для order-production задач і checklist-паків.
- **Checklist Packs** - чек-листи піднято до шаблонних operational пакетів із підкроками, прогресом і preset-driven creation.
- **Workflow** - пакети отримують власний lifecycle, dependencies, blocked-стани, role ownership і SLA/escalation.
- **Data Model** - задачі й шаблони підтримують `subcategory`, durable template linkage, source entity binding і pack grouping.

---

## v0.54.10 - Leads Kanban Card Text Layout Fix

### Leads / Kanban UI Fix [codex]
- **Leads / Kanban** - виправлено баг, через який текст у картці міг стискатись і виглядати майже вертикальним у вузькому flex-сценарії.
- **Layout contract** - name/meta зони перебудовано на стабільний text-vs-badge layout: текст отримав власний wrapper, badge і days-pill більше не стискають контент у вузьку колонку.
- **UI stability** - довгі імена, телефони та contact strings тепер або коректно переносяться, або акуратно обрізаються еліпсисом без псевдо-вертикального тексту.

---

## v0.54.9 - Sidebar/Tasks Visual Stability Fix

### Sidebar / Tasks UI Stability [codex]
- **Sidebar** - прибрано ghost seams, glow bleed і миготливі 1px лінії в Aurora-меню: decorative connectors, group dividers і white inset highlights більше не накладаються на структурні surface states.
- **Tasks** - dark surfaces для kanban columns, task cards, quick-add і inputs переведено на стабільний solid contract без heavy `backdrop-filter` і напівпрозорого білого скла.
- **Debug workflow** - додано CSS-перемикачі `html.debug-no-seams`, `html.debug-no-glow` і `html.debug-no-blur`, щоб швидко ізолювати seams, glow layers і blur-композицію під час UAT.

---

## v0.54.8 - Sidebar Role Switch Fix

### Sidebar / Role-aware Navigation [codex]
- **Role switch** - sidebar тепер пріоритезує runtime role з `getUserRole()` над stored profile role, щоб перемикання ролей одразу змінювало доступні групи, funnel chip і primary action.
- **Guardrail** - додано UI-check, який не дозволить повернути старий порядок ролей і знову показувати sales/funnel для неактуальної ролі.

---

## v0.54.7 - Sidebar AI Cockpit Hardening

### Sidebar / AI-first Navigation [codex]
- **Command deck** - верхній блок sidebar отримав явний маркер `Помічник · операційний стан`, role-aware summary і clean empty state без повернення старих pills.
- **Role focus** - стартовий стан груп переведено на `ai-cockpit-v2`, щоб користувачі отримували role-preferred секції замість успадкованого all-open меню.
- **Focus deck** - ролі без доступу до воронки більше не бачать порожню третю колонку: deck перебудовується у дві корисні дії.
- **Visual control** - вимкнено magnetic/ripple ефекти в навігації, щоб sidebar читався як спокійний AI-first cockpit, а не декоративний rail.

---

## v0.54.6 - Tasks Taxonomy Polish

### Tasks / Operations [codex]
- **Tasks** - нові taxonomy labels для pack/workflow states приведено до нормального українського тексту замість сирих `draft`, `in_production`, `blocked`.
- **Dark Mode** - підсилено контраст submenu chips, category chips `Замовлення / Чек-листи`, hot summary cards і operation badges.
- **QA** - додано UI guardrails для нових Tasks taxonomy controls і dark-mode contrast states.

---

## v0.54.5 - Tasks Taxonomy + Checklist Infrastructure

### Tasks / Operations [codex]
- **Tasks** - плоскі category filters розширено до taxonomy infrastructure з top-level categories `Замовлення` та `Чек-листи`.
- **Operations** - додано контури `Кухня / Кондитерка / Торти / Прикраси` для order-production задач і checklist-паків.
- **Checklist Packs** - чек-листи піднято до шаблонних operational пакетів із підкроками, прогресом і preset-driven creation.
- **Workflow** - пакети отримали lifecycle, dependencies, blocked-стани, role ownership і SLA/escalation поля.
- **Data Model** - задачі й шаблони підтримують `subcategory`, durable template linkage, source entity binding і pack grouping.

---

## v0.54.4 - My Cabinet Quick Cluster Redesign

### My Cabinet / Quick Menu [codex]
- **My Cabinet** - кластер `Задачі / Алерти / Воронка` перероблено з іконкових badge-плиток у цілісний segmented quick-menu.
- **Visual System** - прибрано icon-first treatment, додано tinted segment surfaces, інтегровані count surfaces і виразний active state.
- **UX** - quick cluster тепер працює як вибір робочого режиму з selected-state логікою, dark/mobile/print підтримкою і без окремих floating badges.

---

## v0.54.3 - Match-3 Game Over CTA Visibility Fix

### Match-3 / Game Over CTA [codex]
- **3 в ряд** - кнопки `Профіль` і `Кімната` у фінальному overlay отримали видимий secondary glass style замість слабкого ghost-тексту.
- **CTA hierarchy** - `Ще раз` лишається primary, а post-game навігація тепер читається як активні, клікабельні дії.
- **Mobile UX** - action group винесено в `.go-actions` з mobile layout `1 + 2`, щоб кнопки не зливалися на вузьких екранах.

---

## v0.54.2 - Chat token bootstrap & dialog auto-open fix

### Chat / Bootstrap [codex]
- **Chat** - після авторизації по токену чат тепер відкриває релевантний діалог замість порожнього shell-стану.
- **Bootstrap** - додано єдиний resolver стартового каналу з пріоритетом URL `channelId`, interaction-created dialog, `chatLastActiveChannelId` і fallback на перший доступний канал.
- **UX Recovery** - область повідомлень отримала loading, empty і retry states, щоб недоступний або ще не створений діалог не виглядав як зависання.

---

## v0.54.1 - Leads Funnel Below Kanban (Помічник, 2026-05-17)

### Ліди / Kanban Layout [codex]
- **Ліди** - різнокольоровий funnel summary перенесено під kanban-дошку, щоб primary focus лишався на роботі з картками.
- **Layout** - додано стабільний нижній summary-slot замість крихкої вставки funnel перед kanban.
- **UX** - funnel-аналітика тепер працює як вторинний summary footer після дошки, а не як header-блок перед нею.

---

## v0.54.0 - Sidebar AI-first full rethink

### Sidebar / Navigation IA [codex]
- **Navigation** - sidebar повністю переосмислено як AI-first command cockpit замість перевантаженого декоративного rail.
- **IA** - модулі перегруповано у сценарні секції: Сьогодні, Продажі, Команда, Продукт, Система.
- **Focus deck** - верхній блок перезібрано в єдиний command deck зі статусом, focus chips і primary action.
- **UX** - зменшено шум, прибрано зайві сигнали, dashboard smart-menu і старі pills, вирівняно візуальну ієрархію меню.

---

## v0.53.1 - Tasks Cleanup

### Tasks / UI Cleanup [codex]
- **Без рядка балів** - сторінка задач більше не рендерить верхній рядок `Бали` і не робить окремий `/api/points/:username` запит для нього.
- **Без user-facing Focus** - верхній Tasks UI не має Focus-вкладки, CTA або лічильників, а старі `view=focus` переходи безпечно відкривають звичайний зріз `today`.
- **Чисті залишки** - прибрано dead CSS для рядка балів і orphan `_tdFocusRank` зі стану detail-модалки, без змін до внутрішньої моделі `focus_rank`.

---

## v0.53.0 - Connection Center Control

### Omni / Connections / Provider Truth [codex]
- **Центр підключень** - в Omni додано повноцінний адмінський центр для Telegram, Viber, SMS, Facebook, Instagram, Binotel і Report Bot зі зрозумілими станами, наслідками для бізнесу та наступними діями.
- **Ручний setup без сирих секретів** - connect/update flow приймає обовʼязкові поля провайдерів, маскує збережені секрети, шифрує їх у backend-сховищі та не повертає raw tokens у браузер.
- **Test / Recheck / Disconnect** - кожен канал має перевірку стану, безпечний тест без неконтрольованих платних відправок і підтверджене відключення з попередженням про наслідки.
- **Єдина runtime-правда** - відправка з Omni блокується до реального connected/send-capable стану, а помилки ведуть менеджера назад у центр підключень.
- **Операційна видимість** - деградовані або відключені канали потрапляють в alerts rail і показуються на сторінці з summary: готові, частково, зламані.
- **Mobile UX** - на вузьких екранах центр підключень більше не ховається разом із Omni sidebar і лишається доступним для адміністратора.

---

## v0.52.5 - Sidebar Active Frame Removal

### Sidebar / Menu Polish [codex]
- **Без плаваючої рамки** - декоративний `sidebarActiveIndicator` більше не створюється і примусово прихований CSS-ом, тому при кліку в групах `АРТ`, `CRM` та інших меню не зʼявляється зелена рамка навколо пунктів.
- **Активний пункт без шуму** - активний розділ лишається зрозумілим через колір тексту й іконки, але без зсунутої рамки поверх сусідніх пунктів.

---

## v0.52.4 - Staff Schedule Dark Theme Fix

### Staff Schedule / Dark Theme [codex]
- **Кнопка "Всі"** - активний фільтр відділів на сторінці "Графік роботи" отримав темний контрастний фон, світлий текст і hover-стан у dark mode.
- **Cache Safe Release** - asset/cache теги піднято до `0.52.4`, щоб браузери забрали оновлений CSS для графіка роботи.

---

## v0.52.3 - Dark UI Price Center Polish

### Dark UI / Chat / Dashboard / Price Center [codex]
- **Темна тема** - швидке меню, додаткові налаштування дашборда і екран вибору отримали контрастні темні поверхні, читабельні підписи та помітні активні стани.
- **Чат як dashboard surface** - чат оновлено в стилі дашборда: спокійніші панелі, виразні bubble-повідомлення, кращий dark mode і стабільні кнопки введення.
- **Журнал безпеки** - події Guardian тепер рендеряться структурованими рядками з переносами, прокруткою і захистом від довгих текстів.
- **Без фокусу дня** - віджет "Мій фокус" прибрано з дашборда, lane/кнопки фокусу прибрані зі сторінки задач, а профіль більше не показує окремий блок фокусів.
- **Лічильники sidebar** - quick counters отримали нові бейджі для сповіщень, задач і досягнень із кращим контрастом у dark mode.
- **Прайс із Центру ціни** - прайс-лист на дизайн-борді читає привʼязані `price_rules`, показує ярлики позицій і позначає fallback там, де продукт ще не має центральної привʼязки.

---

## v0.52.2 - Sidebar Compact Rhythm Polish

### Sidebar / Compact Rhythm [codex]
- **Compact Rhythm** - sidebar brand, user card, status pills, smart menu, nav rows and group headers use tighter spacing so more items fit vertically.
- **Calmer Surface** - smart menu and quick counters are smaller and quieter while keeping active, frequent and pinned states readable.
- **Responsive Safety** - collapsed and dark sidebar states keep icon-only behavior, readable contrast and no horizontal overflow.

---

## v0.52.1 - Sidebar Custom Smart Menu Guard

### Sidebar / Custom Smart Menu [codex]
- **Duplicate Hidden For Real** - duplicate `Дашборд` inside the CRM group now loses to the stronger sidebar CSS and is actually hidden.
- **Cache Safe Release** - patch release bumps asset tags so the corrected smart menu CSS is fetched by browsers.
- **Custom Menu Preserved** - fixed Dashboard, frequent auto tab, and up to two pinned tabs remain the active smart-menu contract.

---

## v0.52.0 - Sidebar Custom Smart Menu

### Sidebar / Custom Smart Menu [codex]
- **Fixed Dashboard** - `Дашборд` is always the first smart-menu tab and cannot be removed.
- **Frequent Auto Tab** - one accessible most-visited tab is selected automatically, excluding Dashboard and manually pinned tabs.
- **Pinned Tabs** - users can pin up to two accessible tabs, with localStorage persistence and safe cleanup after role changes.

---

## v0.51.13 - Sidebar Smart Menu Loader Stabilization

### Sidebar / Smart Menu Loading [codex]
- **Shared Loader** - smart menu assets now load from the authenticated shell, so pages without `notification.js` also mount the quick menu.
- **Duplicate Dashboard Guard** - duplicate `Дашборд` inside the CRM group stays hidden after sidebar rerenders and role switches.
- **Idempotent Assets** - smart menu CSS/JS are injected once with retry-safe guards, preventing duplicate style/script tags.

---

## v0.51.12 - Sidebar Quick Menu Repair (2026-05-16)

### Sidebar / Quick Menu [codex]
- **Readable Quick Menu** - швидке меню отримало власні світлі й темні стилі з нормальним контрастом, щоб назви вкладок більше не тонули в sidebar.
- **Working Modal Actions** - налаштування швидкого меню більше не залежить від dashboard-кнопок; кнопки `Скасувати` і `Зберегти` мають власний стабільний стиль.
- **Sticky Save** - футер модального вікна закріплено знизу, тому `Зберегти` видно навіть коли список вкладок довгий або екран вузький.

---

## v0.51.11 - Sidebar Group Hierarchy Polish (2026-05-16)

### Sidebar / Group Hierarchy [codex]
- **Connected Groups** - відкриті групи CRM, Управління та інші accordion-блоки більше не виглядають як окремі капсули над підменю.
- **Submenu Guides** - додано тонкі вертикальні guide-лінії та короткі відводи до пунктів, щоб було зрозуміло де головна група, а де вкладені пункти.
- **Compact Rhythm** - smart compact sidebar отримав той самий зв'язаний ритм без зміни доступів, ролей або структури лівої навігації.

---

## v0.51.10 - Right Panel Removal (2026-05-16)

### Navigation Shell / Right Panel [codex]
- **Right Panel Removed** - застарілий правий floating drawer з вертикальною кнопкою `ПАНЕЛЬ` прибрано з активного shell mount path на всіх CRM-сторінках.
- **Clean Render Path** - видалено `js/role-panel.js`, старі role-panel стилі та HTML-підключення, щоб drawer не міг повернутись через responsive, portal або cached script path.
- **Role Switcher Preserved** - creator-only role preview залишився через окремий `css/role-switcher.css`, без правого drawer chrome і без втручання в лівий sidebar.

---

## v0.51.9 - Dark Shell Prepaint Fix (2026-05-16)

### Sidebar / Dark First Paint [codex]
- **Dark Prepaint** - HTML сторінки виставляють `data-theme="dark"` ще в `<head>`, щоб при переході між сторінками не мигав білий кадр.
- **Designs Dark Surface** - у вкладці Дизайни темні картки, пошук і drop-zone більше не використовують прозорий backdrop-filter, який давав світлий прямокутний шлейф.
- **Sidebar Clip Guard** - sidebar додатково зафіксовано через hidden horizontal overflow і clip-path, щоб декоративні aurora-шари не могли виходити в контент.

---

## v0.51.8 - Sidebar Shell Bleed Fix (2026-05-16)

### Sidebar / Shell Stability [codex]
- **Bleed Guard** - sidebar отримав жорсткий paint containment і horizontal clipping, щоб декоративний шар не залишав світлий шлейф у контенті.
- **Stable Width** - ширина меню більше не стрибає при відкритті груп CRM, Управління, HR та інших accordion-блоків.
- **Reserved Signals** - group-badge тепер має зарезервований слот і не змінює геометрію кнопки при появі або зникненні лічильника.

---

## v0.51.7 - Sidebar Operational Rail Polish (2026-05-16)

### Sidebar / Operational Rail [codex]
- **Operational Counters** - quick-картки задач, алертів і воронки отримали стани zero, live, hot і critical замість однакового декоративного вигляду.
- **Smart Groups** - групи CRM та Управління тепер показують компактний індикатор, якщо всередині є активні задачі, алерти або ліди.
- **Light Theme Polish** - світлу тему sidebar зроблено менш стерильною, з сильнішим фоном, контрастом і спокійнішим premium rhythm.

---

## v0.51.6 - Sidebar Quick Tooltip Fix (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Readable Tooltips** - підказки quick-карток винесено з вузького sidebar-блока в один floating tooltip біля правого краю меню.
- **No Overlap** - tooltip більше не накладається на іконки, лічильники та сусідні quick-картки.
- **Pointer + Keyboard** - підказки працюють на hover, focus і hold, та закриваються при leave, blur, scroll або resize.

---

## v0.51.5 - Sidebar Quick Icons Clean Surface (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Outer Cards Removed** - quick-кнопки задач, алертів і воронки більше не мають власних card-рамок поверх загального контейнера.
- **Clean Icon Orbs** - видимими лишились чисті іконки та числові капсули, без вкладених прямокутників і візуальних накладок.
- **State Safety** - alert/action стани більше не можуть домальовувати старий background або border поверх нового icon-only дизайну.

---

## v0.51.4 - Sidebar Quick Icons Layer Fix (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Layer Cleanup** - прибрано зайві внутрішні рамки та старі alert/action backgrounds, які накладались поверх нових icon-only плиток.
- **Cleaner Surface** - quick-картки задач, алертів і воронки тепер мають один чистий glass-surface без подвійних контурів і випадкових плям.
- **Counter Alignment** - іконки та нижні числові капсули вирівняно стабільніше, щоб блок виглядав зібрано у темному sidebar.

---

## v0.51.3 - Sidebar Quick Icons Polish (2026-05-16)

### Sidebar / Quick Counters [codex]
- **Text Removed** - прибрано обрізані підписи з верхніх quick-карток задач, алертів і воронки, щоб блок читався як чистий icon-only counter rail.
- **Unified Icons** - SVG-іконки перезібрано в один спільний stroke-style: задачі, сповіщення і воронка тепер виглядають як одна система, а не три різні випадкові символи.
- **Counter Polish** - лічильники перенесено в охайні нижні капсули, підсилено hover/focus стани й темний режим без втрати читабельності.

---

## v0.51.2 - Sidebar Logo Animation Polish (2026-05-16)

### Sidebar / Brand Logo [codex]
- **Logo Frame Removed** - прибрано глобальну рамку/outline з верхнього sidebar-логотипа, щоб значок Event Genix не виглядав як випадкова framed-картинка.
- **Soft Animation** - додано спокійну анімацію логотипа з легким підйомом, поворотом і glow, без агресивного миготіння.
- **Reduced Motion** - анімація логотипа вимикається через `prefers-reduced-motion`, щоб не ламати accessibility.

---

## v0.51.1 - Sidebar Dashboard Jump Polish (2026-05-16)

### Sidebar / Dashboard Jump [codex]
- **Label Cleanup** - прибрано малий підпис `Головний екран` із швидкої sidebar-кнопки, щоб блок не читався як дворядковий обрізаний віджет.
- **Readable Dashboard Title** - у плитці залишено тільки `Дашборд`, з більшим і стабільнішим title rhythm без зайвого uppercase-шуму.
- **Compact Button** - кнопку, іконку та arrow-control трохи зменшено, щоб вона займала менше вертикального місця й не обрізала текст у вузькому sidebar.

---

## v0.51.0 - AI Rail Live Center (2026-05-16)

### CRM Assistant Rail [codex]
- **Centered Header Slot** - верхній AI rail перенесено в окремий центрований host у header, щоб він не з'їжджав через різну ширину лівих і правих блоків.
- **Live Speaking Ticker** - speaking-стан тепер запускає живу subtitle-стрічку як поведінку комунікації, а не тільки як overflow-патч для довгого тексту.
- **Presence States** - thinking, listening і speaking отримали виразніші active states, glow і readable ticker у світлій та темній темі.
- **Text-Only Fallback** - якщо голос вимкнений або TTS недоступний, rail все одно показує відповідь як активну speaking-репліку й лишає останній текст видимим після завершення.

---

## v0.50.41 - Profile Cabinet Notes Panel Cleanup (2026-05-16)

### Profile / My Cabinet [codex]
- **Notes Removed** - блок `Нотатки` прибрано з власного профілю/кабінету, щоб нижня частина сторінки не показувала зайву порожню панель.
- **Right Panel Removed** - глобальний `role-panel` більше не підключається на `profile.html`, тому права floating-панель не перекриває і не дублює кабінет.
- **Data Safety** - нотатки не видалялись із backend/API; прибрано саме UI surface і зайвий fetch у профілі.

---

## v0.50.40 - Price List Categories Print Redesign (2026-05-16)

### Designs / Price List [codex]
- **Category Logic** - прайс-лист перебудовано у фіксований порядок `Меню -> Торти -> Розважальні програми -> Піньяти -> Костюми` з normalization layer для фактичних `products`.
- **Visual Hierarchy** - вкладка `Прайс-лист` отримала документний sales-flow з hero, category/subcategory блоками, item cards, ціною, деталями та fallback-сигналами для неповних даних.
- **Dark + Print** - screen view має окремий dark-mode pass, а друк/PDF отримав A4-friendly light layout без CRM chrome, з контрольованими page breaks.
- **Catalog Flow** - випускний каталог вбудовано в той самий sales-контур через bridge-блок із переходом до існуючого catalog viewer/PDF flow без дублювання даних.

---

## v0.50.39 - Dashboard Remove My Focus Widget (2026-05-16)

### Dashboard [codex]
- **Widget Cleanup** - `Мій фокус` retired from dashboard scene/grid/settings surfaces so it no longer renders as a separate widget.
- **Saved Config Safety** - old saved dashboard configs that still contain `my_focus` are filtered by the widget normalization layer.
- **Data Semantics Preserved** - task focus data and `focus_rank` logic remain intact for task/profile flows; only the dashboard widget surface is removed.

---

## v0.50.38 - Sidebar Stack Overlap Fix (2026-05-16)

### Sidebar / Aurora [codex]
- **Layout Contract** - dashboard jump, quick status block and accordion groups now keep separate vertical slots so sidebar cards do not visually stack on top of each other.
- **Accordion Spacing** - sidebar links and category rows use an explicit flex column rhythm with stable gaps and no negative/animated overlap between neighboring blocks.
- **Interaction Polish** - active dashboard jump no longer moves upward on hover/active state, preventing it from touching the first `CRM` accordion surface on compact heights.

---

## v0.50.37 - Dashboard Board Creative Workspace & AI Upgrade (2026-05-16)

### Dashboard / Board [codex]
- **Workspace Logic** - board отримав явний interaction contract для view, edit, draw, connect, text-edit і widget-inspect режимів, щоб widget click, drag, text edit і connector flow не билися між собою.
- **Creative Palette** - toolbar зібрано в grouped navigation, insert, draw, connect, AI і action flows, а не в один довгий ряд рівноправних кнопок.
- **Connectors** - додано connector model у board state, anchor buttons на об'єктах, relation types, line/arrow/curve styles і live reroute після move/resize.
- **AI Board** - додано Suno-style board-native presets: expand idea, mood pack, auto cluster, summarize, extract tasks, remix, name frame і prompt-to-board generation.
- **Visual Polish** - selected/editing/widget-inspect/connector/anchor states приведено до чистішої premium-мови без грубих обводок.

---

## v0.50.36 - My Cabinet Cluster Visual Polish (2026-05-16)

### Profile / My Cabinet [codex]
- **Cluster** - у верхньому My Cabinet cluster прибрано захист від усічених підписів і зафіксовано clean icon-only face.
- **Counts** - цифри піднято з нижнього badge-кута в центральний rhythm плитки та зроблено більшими й читабельнішими.
- **Notifications** - центральна плитка лишається bell-first shortcut для сповіщень, з окремим alert count акцентом.

---

## v0.50.35 - Catalog Viewer Wide-Screen Stability Fix (2026-05-16)

### Catalogs / Designs [codex]
- **Catalog UI Modes** - list, inline editor і fullscreen viewer зведено в один явний mode contract, щоб режими не лишали ghost-surfaces поверх каталогу.
- **Viewer Isolation** - fullscreen catalog viewer отримав `catalog-viewer-open` body-state, вищий stacking layer і блокування fixed/floating CRM panels під час перегляду.
- **Responsive Viewer** - catalog page lane стабілізовано для wide desktop, laptop, tablet і mobile через safe gutters, overflow isolation і ширший контрольований content width.

---

## v0.50.34 - Sidebar Category Density & Chevron Polish (2026-05-16)

### Sidebar / Aurora [codex]
- **Category Density** - category headers у sidebar стали компактнішими за висотою, padding і gap, щоб navigation rail виглядав щільніше та спокійніше.
- **Chevron** - legacy border-arrow замінено на SVG control chevron у власній mini-control зоні з акуратним open/closed станом.
- **Visual Rhythm** - hover, active і open surfaces для accordion groups зібрані в чистіший premium-патерн без зміни role/access logic.

---

## v0.50.33 - Version System Hardening (2026-05-16)

### Release / Version [codex]
- **Version Truth** - `package.json` тепер містить не тільки canonical `version`, а й canonical `eventGenix.releaseLabel`, з якого синхронізуються видимі release labels.
- **Hard Gate** - `scripts/version-sync.js` тепер ловить drift у login release badge, tagline, changelog CTA, modal heading, `CHANGELOG.md`, `?v=` asset tags, service-worker cache names і `/api/version` route contract.
- **Deploy Smoke** - додано `npm run version:smoke`, який звіряє live `/api/version` і login HTML з очікуваною версією перед завершенням релізу.

---

## v0.50.32 - HR Interactive Company Structure (2026-05-16)

### HR / Structure [codex]
- **Структура компанії** - замість порожнього текстового поля додано інтерактивну org-chart схему за затвердженою ієрархією з фото.
- **Інтерактивність** - кожен блок ролі клікабельний і показує коротку зону відповідальності у правій інформаційній панелі.
- **Сумісність** - збереження нотаток та інструкцій через існуючий `/api/hr/company-structure` залишилось без окремої нової системи.

---

## v0.50.31 - HR Schedule Dark Theme Polish (2026-05-16)

### HR / Schedule [codex]
- **Темний режим** - прибрано світлу заливку поточного дня у вкладці **Розклад**, щоб таблиця не вибивалась із dark theme.
- **Контраст** - кнопки навігації, дії, select шаблону та символи отримали темні стани й світлий текст.
- **Зміни** - shift-плашки та порожні клітинки отримали читабельні dark-mode кольори без білих плям.

---

## v0.50.30 - Dashboard New Leads Widget Links (2026-05-16)

### Dashboard / Leads [codex]
- **Нові ліди** - елементи віджета стали клікабельними і ведуть прямо у workspace конкретного ліда через `/sales-funnel?lead=<id>`.
- **UX** - додано зрозумілий hover/focus стан для списку, щоб було видно, що кожен лід відкривається.
- **Fallback** - якщо у рядка немає id, клік безпечно відкриває загальну воронку лідів.

---

## v0.50.29 - My Cabinet Icon Cluster Redesign (2026-05-16)

### Profile / My Cabinet [codex]
- **Icon Cluster** - верхній блок My Cabinet перезібрано в три великі icon-only плитки для задач, сповіщень і воронки без урізаних текстових підписів.
- **Notifications** - центральна плитка тепер використовує bell-іконку і відкриває наявну alerts-панель CRM.
- **Counters** - лічильники стабілізовано для `0..99`, зі зрозумілим `99+` для великих значень і без приховування нуля.

---

## v0.50.28 - Sound Log Dark Theme Contrast Fix (2026-05-16)

### Sound / Log [codex]
- **Dark Theme** - виправлено контраст вкладки **Лог подій**, щоб заголовок, subtitle, фільтри, дати, статистика, записи та теги були читабельні в чорній темі.
- **Action Labels** - для типів подій додано яскраві dark-mode accent-и, тому `Програвання`, `TTS`, `Створення`, `Зміни` та інші написи більше не зливаються з фоном.
- **Form Controls** - date-фільтри та chip-кнопки отримали стабільні темні стани hover/active без втрати видимості.

---

## v0.50.27 - Sidebar Group Animation Polish (2026-05-16)

### Sidebar / Navigation [codex]
- **Group Header** - виправлено active/open стан груп sidebar, щоб зелена підсвітка не виглядала так, ніби вилітає за межі картки.
- **Arrow Sync** - прибрано конфлікт двох chevron-систем, через який стрілка групи виглядала кривою та несинхронною.
- **UI Polish** - групи меню отримали рівний contained border, стабільне вирівнювання і спокійніший hover/active ритм у світлій та темній темах.

---

## v0.50.26 - Timeline Animator Visibility Fix (2026-05-16)

### Timeline / Booking Visibility [codex]
- **Animator Timeline** - виправлено видимість бронювань для акаунтів аніматорів: staff scope тепер враховує `bookings.line_id`, тобто реальну лінію таймлайну.
- **Женя / Staff Accounts** - додано fallback через зв'язку `users` -> `staff`, щоб прив'язані staff-акаунти не отримували порожній таймлайн через стару перевірку по `hosts`.
- **Regression Test** - додано тест, який гарантує, що аніматор бачить івенти своєї primary line навіть коли `hosts` є кількістю аніматорів, а не staff id.

---

## v0.50.25 - Omni Account Connections & Alerts (2026-05-15)

### Omni / Account Connectivity [codex]
- **Omni Accounts** - в Omni додано control-panel підключень каналів зі статусом Telegram, Viber, SMS, Facebook, Instagram і Binotel.
- **Alerts** - непідключені або обмежені канали тепер показують local alarm у Omni і додаються в global alerts bell як operational issue.
- **Guided Recovery** - `channel_unavailable` та disabled compose більше ведуть користувача до блоку **Підключення каналів**, а не лишають його з глухою помилкою.

---

## v0.50.24 - Chat Runtime Audit & Theme Stabilization (2026-05-15)

### Chat / Runtime Audit [codex]
- **Chat Audit** - виконано системний audit bootstrap, theme, overlay і right-panel interaction зон чату замість точкового cosmetic fix.
- **Theme** - стабілізовано manual/auto theme contract у chat: `pzp_dark_mode`, `pzp_autoNight`, нічне вікно, `body.dark-mode`, `body.night-auto` і `data-theme` тепер синхронізуються.
- **Stability** - додано відсутній runtime title node для right info panel, уніфіковано close behavior для status/theme/modals через outside click та Escape.

---

## v0.50.23 - Tasks Top Cleanup (2026-05-15)

### Tasks / UI Cleanup [codex]
- **Tasks UI** - прибрано окрему вкладку **Фокус** з верхньої навігації задач, щоб верх сторінки був спокійнішим.
- **Top Summary** - прибрано картки **Прострочено**, **Чекаю** та **Швидкі перемоги** з верхньої summary-lane; лишився компактний **Фокус дня**.
- **Safe Fallback** - старі переходи на `tasks.html?view=focus` більше не лишають сторінку в прибраному режимі й тихо відкривають `today`.

---

## v0.50.22 - Global CRM Assistant Rail (2026-05-15)

### CRM / Assistant Rail [codex]
- **All Pages** - верхня AI-строка стала shared CRM-компонентом і монтується у header на всіх authenticated сторінках без копіювання HTML.
- **Proactive Help** - якщо користувач лишається на сторінці 5 секунд і не починає активну роботу, асистент сам коротко пропонує допомогу з урахуванням сторінки та ролі.
- **Voice + Text** - одна й та сама підказка показується субтитрами і, якщо voice mode увімкнений, паралельно озвучується через TTS.
- **Global API** - додано `/api/crm-assistant/*` як основний namespace для reply, transcription і speech; dashboard namespace лишився legacy alias.

---

## v0.50.21 - Dashboard AI Guide Voice Mode (2026-05-15)

### Dashboard / Assistant Rail [codex]
- **Assistant Rail** - верхня AI-панель дашборду підключена до server-side OpenAI Responses API і тепер дає короткі CRM-підказки з урахуванням ролі, сторінки, widgets і role preview.
- **Voice Mode** - додано голосовий цикл: мікрофон у браузері, server-side transcription через OpenAI audio, AI-відповідь, TTS-озвучення і субтитри в rail.
- **CRM Guidance** - створено окремий instruction pack для Event Genix CRM, щоб асистент працював як in-product провідник, а не generic chat.
- **Secret Safety** - `OPENAI_API_KEY` використовується тільки на backend; frontend відправляє лише dashboard context і не отримує ключ.

---

## v0.50.20 - Dashboard Mixed Scene by Role (2026-05-15)

### Dashboard / Role Scenes [codex]
- **Dashboard Scene** - дашборд став єдиною змішаною сценою з логічно розкладеними widgets, контрольним центром і зонами для нотаток.
- **Role Logic** - для `creator`, `admin`, `manager`, `senior_manager`, `director`, `vice_director`, `hr` і `art_director` додано власні scene presets; creator може preview-ити сцену інших ролей.
- **Workspace Feel** - права writing lane, стабільний center control і керовано асиметричний лівий кластер формують dashboard як робочий простір, а не плоский список карток.

---

## v0.50.19 - Assistant Rail Expansion & Sidebar Status Polish (2026-05-15)

### Dashboard / Sidebar [codex]
- **Assistant rail** - центральний AI-блок у header розтягнуто на всю доступну зону, щоб субтитри та живий статус читалися як повноцінна інформаційна панель, а не як вузька смуга.
- **Текстова зона** - subtitle-track тепер має значно більше місця, показує дві строки перед ticker-режимом і краще працює для довших реплік.
- **Sidebar cells** - верхні картки `Задачі / Алерти / Воронка` перезібрані у чистіший формат з сильнішою іконкою, короткою назвою і менш шумною типографікою.

---

## v0.50.18 - Sidebar Dashboard Badge Cleanup (2026-05-15)

### Sidebar / Navigation [codex]
- **Dashboard badge** - прибрано помилковий лічильник alert-ів з кнопки `Дашборд` у sidebar.
- **Badge truth** - alerts лишаються тільки там, де їм місце: у сповіщеннях і відповідних dashboard surfaces, без фальшивого дублювання на jump-кнопці.

---

## v0.50.17 - Sidebar Dashboard Jump (2026-05-15)

### Sidebar / Navigation [codex]
- **Дашборд-кнопка** - повернуто окрему кнопку швидкого переходу на Dashboard над основним accordion-списком меню.
- **Дизайн** - кнопка винесена з status rail, має власну іконку, підпис `Головний екран / Дашборд`, активний стан і спокійно вписується в Aurora sidebar.
- **UX** - навіть коли групи меню згорнуті, головний екран лишається швидко доступним без розкриття CRM-розділу.

---

## v0.50.16 - Dashboard Assistant Voice Rail (2026-05-15)

### Dashboard / Assistant Rail [codex]
- **Header rail** - у центральній зоні dashboard header додано постійну assistant-панель для статусу, голосу й субтитрів.
- **Voice presence** - rail підтримує стани `Готовий`, `Думаю`, `Зайнятий`, `Слухаю`, `Говорю`, `Тиша` і `Помилка`, щоб користувач бачив, що робить асистент.
- **Subtitles ticker** - довгі репліки плавно прокручуються тільки коли не влазять у рядок; на hover/focus рух ставиться на паузу.
- **Hooks** - додано frontend-контракт `setAssistantRailState`, `toggleAssistantVoice`, `replayAssistantLine` і `demoAssistantSpeak` для майбутнього підключення реального голосового/LLM pipeline.

---

## v0.50.15 - Profile Photo Upload (2026-05-15)

### Profile / Avatar [codex]
- **Фото з пристрою** - у налаштуваннях профілю додано завантаження власної аватарки з комп'ютера або телефона.
- **Storage** - фото профілю проходить через documented storage surface: Supabase Storage `profile-avatars` із локальним fallback `/uploads/profile-avatars`.
- **Safety** - дозволені тільки JPG, PNG, WebP і GIF до 5 МБ; SVG та невідповідні MIME-типи блокуються до збереження.
- **UX** - preview аватарки оновлюється одразу після вибору файлу, а після збереження оновлюються профіль, header і sidebar.

---

## v0.50.14 - Dashboard Board Tools & Notes Repair (2026-05-15)

### Dashboard / Board Mode [codex]
- **Board tools** - у dashboard board mode додано text, frame, brush/highlighter/eraser foundation і кілька типів фігур: line, arrow, rect, round rect, ellipse, diamond.
- **Legacy notes repair** - старі board notes з payload keys `kind`, `content`, `body`, `noteText`, `label` тепер мігруються в canonical `text` і залишаються редагованими.
- **Clear all** - додано дію `Очистити все` з confirm flow, очищенням items/drawings і undo snapshot.
- **Config round-trip** - frontend і backend dashboard config тепер зберігають `boardState.drawings` та `activeTool`, не відрізаючи drawing state при save/load.

---

## v0.50.13 - Sidebar Status Cell Clarity (2026-05-15)

### Sidebar / Status Cells [codex]
- **Статусні комірки** - задачі, алерти й воронка отримали великі кастомні SVG-іконки, щоб призначення кнопок читалось без здогадок.
- **Підказки** - при hover/focus або утриманні відкривається опис, що саме робить комірка і куди веде клік.
- **UX** - лічильники стали більшими, а статусний rail лишився компактним і не забирає зайве місце в меню.

---

## v0.50.12 - Profile Dark Contrast (2026-05-15)

### Profile / Dark Mode [codex]
- **Темна тема профілю** - виправлено низький контраст у робочому профілі: ім'я, заголовки, метрики, задачі й активність тепер читаються на темному фоні.
- **Profile surfaces** - профільні картки, таби, бейджі, рядки задач і My Cabinet отримали окремі темні text/surface tokens замість помилкового `gray-100`.
- **UI guard** - додано static smoke check, який перевіряє наявність читабельних dark-mode правил для профілю.

---

## v0.50.11 - Dashboard Widget Cleanup (2026-05-15)

### Dashboard / Widget Density [codex]
- **Removed widgets** - з головного dashboard прибрано великі службові картки `finance_today`, `reports_today`, `account_stats` і `week_bookings`.
- **Compact widgets** - погода й курси валют стали нижчими та більше не виглядають як великі порожні блоки.
- **Layout** - dashboard grid тепер вирівнює віджети по природній висоті, без розтягування всього рядка до найвищої картки.

---

## v0.50.10 - Sidebar Profile Cleanup (2026-05-15)

### Sidebar / Dashboard Cleanup [codex]
- **Profile duplicate** - прибрано зайву окрему профільну картку, яка дублювала інформацію про користувача.
- **Dashboard menu** - sidebar став нижчим і чистішим: лишається один основний профільний блок.
- **UI guard** - додано static smoke check проти повернення `sidebar-now-card`.

---

## v0.50.9 - Sidebar Status Rail (2026-05-15)

### Sidebar / Status Rail [codex]
- **Status rail** - задачі, алерти й воронку зібрано в один горизонтальний segmented-блок замість трьох рядків.
- **Compact info** - кожен сегмент показує власний лічильник і короткий стан, а повний опис доступний через hover/assistive label.
- **Navigation** - сегменти лишились окремо клікабельними: задачі відкривають tasks, алерти відкривають сповіщення, воронка відкриває funnel.

---

## v0.50.8 - Sidebar Role Line (2026-05-15)

### Sidebar / Profile Card [codex]
- **Profile card** - прибрано обрізаний time-based greeting `Доброго...` біля імені користувача.
- **Roles** - під іменем тепер показується роль або ролі акаунта без привʼязки до часу доби.
- **UI guard** - додано static smoke check, який не дасть повернути greeting-рядок у sidebar.

---

## v0.50.7 - Sidebar AI Placeholder Cleanup (2026-05-15)

### Sidebar / Dashboard Surface [codex]
- **AI placeholder** - прибрано зайвий demo/AI-блок `Імітація / Почати` з верхньої частини меню.
- **Dashboard UX** - sidebar більше не витрачає місце на підготовчий блок, який не був потрібен у поточному dashboard flow.
- **Cleanup** - видалено рендер, таймери, CSS і публічний handler placeholder-картки.

---

## v0.50.6 - Sidebar Status Stack (2026-05-15)

### Sidebar / Compact Status [codex]
- **Status stack** - задачі, алерти й воронку згруповано в один компактний блок замість трьох великих окремих карток.
- **UX** - верхня частина меню стала нижчою, швидше сканується і не забирає стільки вертикального місця.
- **Visual polish** - статусні рядки отримали спільну рамку, щільні лічильники справа і мʼякі hover/critical-стани.

---

## v0.50.5 - Dashboard Board Notes Fix (2026-05-15)

### Dashboard / Board Notes [codex]
- **Нотатки** - board notes переведено з крихкого `contenteditable` на стабільний textarea-редактор.
- **Редагування** - клік у текст більше не запускає повний rerender board і не скидає фокус під час набору.
- **Накладання** - активна нотатка тимчасово піднімається над іншими board-обʼєктами, тому накладені нотатки можна нормально редагувати.

---

## v0.50.4 - Sidebar Dashboard Jump (2026-05-15)

### Sidebar / Navigation [codex]
- **Dashboard jump** - пасивний напис `Зараз` у верхній панелі sidebar замінено на інтерактивну кнопку переходу на Dashboard.
- **UX** - кнопка має компактний pill-стиль, hover/focus-стани і не конфліктує з кліком по профілю.
- **Навігація** - швидкий перехід на Dashboard тепер доступний прямо з верхньої картки sidebar.

---

## v0.50.3 - Sidebar AI Companion Placeholder (2026-05-15)

### Sidebar / AI Companion [codex]
- **AI-помічник** - у верхню картку sidebar додано компактне вікно майбутнього AI-чату з кнопкою старту розмови.
- **Режими індикатора** - помаранчевий означає демо/імітацію, зелений зарезервований для реального LLM-режиму.
- **Підготовка до LLM** - додано placeholder-фрази по ключових сторінках і стабільний frontend-контракт `mock|live` для майбутнього підключення справжнього аналізу.

---

## v0.50.2 - Sidebar Metrics Rail Polish (2026-05-15)

### Sidebar / Metrics [codex]
- **Метрики sidebar** - блок задач, алертів і воронки перероблено з трьох тісних колонок у компактний вертикальний rail.
- **Читабельність** - назви, числа і короткий опис більше не стискаються у вузьких картках і не виглядають як випадкові “вікна”.
- **Теми** - новий rail використовує ті самі CSS-змінні Aurora sidebar, тому лишається акуратним у світлій і темній темі.

---

## v0.50.1 - Dashboard Board Foundation Engine (2026-05-15)

### Dashboard / Board Foundation [codex]
- **Board mode** - додано керований режим board поверх існуючого dashboard config без окремого сховища або заміни grid dashboard.
- **Engine contract** - закладено `grid|board`, `view|edit`, `boardMeta.version`, нормалізований `boardState`, базову selection/object discipline та widget click-vs-drag контракт.
- **Надійність** - додано dirty-state indicator, debounced autosave, local recovery draft, undo/redo foundation і safe fallback для несумісного board config.
- **Governance** - phase 1 лишається personal-first: без realtime collaboration, без Miro-overreach і з performance cap для live widgets.

---

## v0.50.0 - Sidebar Aurora Redesign (2026-05-15)

### Sidebar / Navigation [codex]
- **Aurora UI** - sidebar винесено в окремий `css/sidebar-aurora.css` з живим aurora glow, spotlight за курсором, ripple-кліками та плавним активним індикатором.
- **Now card** - стара user-картка замінена на робочу картку "Зараз" з аватаром, живим часом і поточною/наступною подією з бронювань.
- **Pill-статистика** - задачі, алерти й воронка стали компактними pill-метриками замість великих stacked widgets.
- **Темна/світла тема** - новий sidebar працює через CSS-змінні та має однакову читабельність у двох темах.
- **Сумісність** - `NAV_ITEMS`, `SIDEBAR_ACCESS`, `data-page-access`, hash-action handlers і збережений стан груп лишилися на старих контрактах.

---

## v0.49.26 - Dashboard Funnel Widget Simplification (2026-05-15)

### Dashboard / Widgets [codex]
- **Dashboard** - велику панель "Робоча черга" прибрано з основного потоку dashboard, щоб головний екран не виглядав як операційна консоль.
- **Воронка** - замість важкого work queue slab додано компактний widget "Воронка" у форматі звичайних dashboard cards.
- **Архітектура** - widget бере дані з наявного `funnelInsights` через dashboard endpoint, без дублювання нового джерела даних.

---

## v0.49.25 - Sidebar Modern Icon System (2026-05-15)

### Sidebar / Navigation [codex]
- **Меню** - іконки sidebar приведено до єдиної сучасної SVG-системи з однаковими плитками, рамками й hover/active станами.
- **Кнопки** - віджети задач, сповіщень, воронки, quick-переходи та перемикач теми отримали спільну action-card мову без різнокаліберного вигляду.
- **Теми** - світла й темна тема тепер мають однакові контрасти, кольорові акценти і читабельні іконки без залежності від emoji-стилю ОС.

---

## v0.49.24 - Lead Customer Linking Dropdown (2026-05-15)

### Leads / Customers [codex]
- **Воронка** - привʼязка клієнта до ліда більше не просить вручну вводити ID.
- **Клієнти** - додано пошук і випадаючий список існуючих клієнтів з іменем, телефоном, Instagram і кількістю візитів.
- **UX** - оператор може або привʼязати існуючого клієнта, або окремою дією створити нового з даних ліда.

---

## v0.49.23 - Team Presence Clarity (2026-05-15)

### Dashboard [codex]
- **Команда онлайн** - зеленим тепер показуються тільки користувачі з реальним online-підключенням.
- **Присутність** - не-online користувачі у віджеті стали сірими: аватарка, статус-крапка і CRM-бейдж більше не виглядають як онлайн.
- **Теми** - light/dark режим отримали однакову логіку offline/recent станів без хибного зеленого сигналу.

---

## v0.49.22 - Sidebar Professional Polish (2026-05-15)

### Sidebar [codex]
- **Меню** - sidebar приведено до єдиної професійної системи карток для профілю, задач, сповіщень, воронки та швидких переходів.
- **Компактність** - верхній блок став щільнішим: коротші підписи віджетів, нижчі quick-кнопки та менше випадкового візуального шуму.
- **Теми** - світла й темна тема отримали однакову ієрархію, видимі стрілки, рамки, hover/active стани та спокійніші акценти.

---

## v0.49.21 - Work Queue Funnel Summary (2026-05-15)

### Dashboard / Leads [codex]
- **Робоча черга** - `Лід без руху` більше не показується як окремий пункт черги з дією `Відкрити кейс`.
- **Воронка** - у робочій черзі додано компактний блок стану funnel: активні ліди, скільки чекає дії та етапи з найбільшим навантаженням.
- **Інтеграція** - довідкові lead-сигнали тепер ведуть у нормальний модуль воронки, а не створюють паралельний формат ліда.

---

## v0.49.20 - Staff Schedule Dark Theme (2026-05-15)

### Staff Schedule [codex]
- **Графік** - темну тему вкладки `Графік роботи` перероблено для всієї schedule-сітки.
- **Таблиця** - темні стилі тепер покривають sticky-колонки, заголовки, групи відділів, статуси змін і hover-стани.
- **Стабільність** - dark mode працює і через `body.dark-mode`, і через `data-theme="dark"`, без світлого flash таблиці.

---

## v0.49.19 - Custom Sidebar Icons (2026-05-15)

### Sidebar Icons [codex]
- **Меню** - системні emoji замінено на власний SVG-набір іконок для sidebar.
- **Теми** - іконки отримали контрольовані кольори для світлої й темної теми без залежності від emoji-шрифту ОС.
- **Стиль** - віджети задач, сповіщень, воронки, quick-кнопки та accordion-групи тепер виглядають більш професійно й однаково.

---

## v0.49.18 - Sidebar Top Block Density (2026-05-15)

### Sidebar Top Block [codex]
- **Меню** - верхній блок із профілем, задачами, сповіщеннями та воронкою зроблено компактнішим.
- **Щільність** - зменшено висоту профільної картки, іконки, лічильники, padding і вертикальні проміжки віджетів.
- **Баланс** - блок займає менше місця, але ключові числа й назви лишаються читабельними.

---

## v0.49.17 - Sidebar Quick Buttons Density (2026-05-15)

### Sidebar Quick Nav [codex]
- **Меню** - кнопки `Графік`, `Таймлайн` і `Чат` зроблено трохи нижчими та компактнішими.
- **UX** - зменшено іконку, padding і проміжки, щоб quick-блок не займав забагато місця під віджетами.
- **Читабельність** - текст лишився достатньо жирним і контрастним у світлій та темній темах.

---

## v0.49.16 - Sidebar Accordion State Fix (2026-05-15)

### Sidebar Accordion [codex]
- **Меню** - кілька відкритих розділів sidebar тепер зберігаються одночасно, а не перетираються останнім кліком.
- **Стабільність** - стан accordion нормалізується, навіть якщо в `localStorage` лишився старий або битий формат.
- **UX** - після перемальовування меню попередньо відкриті розділи не зникають самі.

---

## v0.49.15 - Sidebar Action Trap Hardening (2026-05-15)

### Sidebar Legacy Actions [codex]
- **Меню** - старий блок `Дії` більше не може лишати користувача внизу sidebar без нормального виходу.
- **Стабільність** - додано JS-guard, який видаляє legacy action-кнопки навіть зі старого DOM або кешованої розмітки.
- **Навігація** - прибрано відновлення старого scroll-положення sidebar, щоб меню завжди стартувало з нормальної верхньої зони.

---

## v0.49.13 - Notification Center Redesign (2026-05-15)

### Notification Center [codex]
- **Сповіщення** - кнопка в лівому меню більше не відкриває маленький popover справа від header.
- **Меню** - верхній дзвіночок прибрано з shared header-flow, а sidebar відкриває окремий центр подій.
- **UX** - нова панель сповіщень має backdrop, більший робочий простір і постійно видимі дії для алертів.

---

## v0.49.12 - Sidebar Quick Navigation (2026-05-15)

### Sidebar Quick Nav [codex]
- **Меню** - над основними accordion-групами додано окремий блок швидких переходів.
- **Швидкий доступ** - `Графік`, `Таймлайн` і `Чат` винесені в компактний список для всіх користувачів.
- **UX** - блок має власні рамки, hover/active стани та читабельний вигляд у світлій і темній темах.

---

## v0.49.11 - Sidebar Funnel Widget (2026-05-15)

### Sidebar Funnel [codex]
- **Меню** - у pinned-зоні sidebar додано віджет "Воронка" для швидкого контролю лідів.
- **Алерти** - якщо є лід, що чекає дії, віджет підсвічується і показує червоний лічильник.
- **Навігація** - клік по віджету відкриває воронку, а при hot lead веде одразу в конкретний лід.

---

## v0.49.10 - Profile Avatar Settings (2026-05-15)

### Profile Avatar [codex]
- **Профіль** - у вкладці "Налаштування" додано робочий редактор аватарки.
- **Avatar** - підтримано emoji-аватар, колір фону, повернення до літери з імені та фото через URL.
- **Sidebar** - після збереження аватарка синхронізується з header/sidebar, AppState і localStorage.

---

## v0.49.9 - Light Sidebar Readability Fix (2026-05-15)

### Sidebar Light Mode [codex]
- **Меню** - у світлій темі підсилено контраст стрілок accordion-груп, щоб їх було видно так само впевнено, як у темній темі.
- **Рамки** - зроблено помітнішими межі між групами меню та active group border.
- **UX** - labels, arrows і active marker більше не губляться на білому sidebar-фоні.

---

## v0.49.8 - Tasks OS Foundation + Sidebar/Профіль Polish (2026-05-15)

### Tasks OS + My Cabinet [codex]
- **Tasks model** - додано foundation для `task_mode`, `task_kind`, `visibility`, `workflow_state`, focus/reminder/snooze metadata, subtasks і personal task preferences через міграцію `179_tasks_os_my_cabinet.sql`.
- **Tasks API** - розширено `/api/tasks`: фільтри personal/private/focus/workflow, `/api/tasks/my-cabinet`, focus/snooze endpoints і checklist endpoints.
- **My Cabinet** - у профілі додано вкладки "Мій день" і "Мої задачі" як персональну проекцію задач без дублювання повного board.
- **Tasks page** - додано OS views `Інбокс`, `Фокус`, `Наступні`, `Чекаю`, `Командні`, `Рутини`, focus lane і quick capture з personal/private/waiting/focus intent.
- **Dashboard** - додано snapshot-віджет "Мій фокус" поверх існуючої dashboard architecture.
- **Chat/Alerts** - task capture передає personal-aware payload; chat підтримує self-task flow, а alert-created tasks ідуть у canonical task model.

### Sidebar + Profile [codex]
- **Профіль** - особистий кабінет впорядковано як серйозний робочий профіль; клік по імені в header веде на новий `/profile`, а не на стару модалку.
- **Меню** - групи меню стартують згорнутими, профіль у sidebar клікабельний, аватарка підтримує фото, а pinned task mini-widget показує активні задачі.
- **Сповіщення** - pinned "Фокус дня" у sidebar замінено компактним дублем alerts з кількістю нових і preview, який відкриває існуючу панель сповіщень.
- **Dark mode** - виправлено контраст імені користувача, ролі, pinned-віджетів і груп меню в sidebar.

---

## v0.49.7 - Sidebar Alerts Duplicate (2026-05-15)

### Sidebar Alerts [codex]
- **Меню** - прибрано pinned-пункт "Фокус дня" з sidebar.
- **Сповіщення** - замість нього додано компактний дубль alerts з кількістю нових і коротким preview.
- **UX** - sidebar alerts відкриває існуючу панель сповіщень, не створюючи другого alert workflow.

---

## v0.49.6 - Professional Profile Workspace (2026-05-15)

### Profile Workspace [codex]
- **Профіль** - особистий кабінет впорядковано як робочий профіль працівника: identity, role, Telegram status, задачі, зміна, дедлайни й остання активність винесені в чистий overview.
- **Navigation** - клік по імені користувача в правому хедері більше не відкриває стару profile-модалку, а веде на нову сторінку `/profile`.
- **Design** - gamification-first hero прибрано з першого екрану; ігрові механіки лишаються другорядними вкладками, не основним робочим станом.
- **UX** - вкладки профілю отримали стриманіші назви без зайвого візуального шуму.

---

## v0.49.5 - Sidebar Task Widget + Profile Link (2026-05-15)

### Sidebar Navigation [codex]
- **Меню** - групи навігації стартують згорнутими за замовчуванням і зберігають вибір користувача після відкриття.
- **Профіль** - імʼя та картка користувача в sidebar стали клікабельними й відкривають особистий профіль.
- **Задачі** - у меню закріплено міні-віджет "Мої задачі" з кількістю активних задач і позначкою протермінованих.
- **Avatar** - sidebar підтримує фото профілю в аватарці та компактну аватарку для вузького меню.

---

## v0.49.4 - Timeline + Chat Self-Task Flow (2026-05-15)

### Timeline First-Screen Flash [codex]
- **Navigation** - прибрано короткий flash стартового/login екрана при переході з Tasks на Timeline.
- **Shell** - timeline landing page вирівняно до shared authenticated first-paint contract: login shell більше не visible-by-default.
- **UX** - route transitions на Timeline відкривають робочий інтерфейс без проміжного першого екрана, а unauthenticated login показується тільки explicit auth flow.

### Chat Self-Task Flow [codex]
- **Chat** - додано швидкий сценарій "створи таску собі" прямо з task form у чаті.
- **Commands** - `/task` тепер підтримує self-формати: `/task собі ...`, `/task self ...`, `/task me ...`.
- **UX** - task form preselect-ить поточного користувача, лишаючи старий delegated flow через вибір іншого виконавця.

---

## v0.49.3 - Dashboard + Tasks Bootstrap Hardening (2026-05-15)

### Dashboard Work Queue [codex]
- **UI** - робочу чергу на dashboard ущільнено як справжній віджет: блок більше не розтягується на широку сторінкову секцію.
- **UX** - bucket-и винесено у власний scroll-контейнер, права зона вирішення стала коротшою, а рядки черги не створюють окремих високих action-блоків.
- **Density** - аналітика черги, chips, кнопки, картки тріажу й empty-state стиснуті для швидкого сканування без втрати мобільного fallback.
- **Follow-up** - видимий `v1`/службові пояснення з аналітики прибрано з основного шару віджета, ширину й висоту bucket-rail додатково зменшено.
- **Widget mode** - порожня права зона більше не резервує колонку до вибору пункту, а кнопка оновлення в шапці отримала компактний widget-size.

### Tasks Bootstrap + Standalone Audit [codex]
- **Tasks** - знайдено й закрито root cause класу `auth/runtime conflation`: runtime-помилки після успішної авторизації більше не редіректять користувача на головну як fake auth failure.
- **Chat** - додано fatal bootstrap boundary і boot markers, щоб сценарій "є звук, але білий екран" залишав видимий error state замість часткового background init без UI.
- **Stability** - додано shared standalone fatal error contract для page-local runtime failures; auth failure і init/render failure тепер розведені.
- **Audit** - перевірено standalone modules Tasks, Chat, HR, Analytics, Finance, Warehouse, Customers, Leads, Programs, Staff, Dashboard, Training, Designs, Graduation; critical same-class redirect risks закрито для HR, Finance та Analytics.

---

## v0.49.2 - Dashboard Work Queue + Navigation First Paint Fix (2026-05-15)

### Dashboard Work Queue [codex]
- **UI** - повністю українізовано блок робочої черги на dashboard: операції з відповідями, аналітика черги, робоча зона вирішення, історія дій і execution actions більше не показують англомовні службові заголовки.
- **UX** - work queue перебудовано в щільніший desktop master/detail layout: bucket-и лишаються зліва, а робоча зона вирішення стала компактною sticky-панеллю справа з mobile fallback в одну колонку.
- **Polish** - технічні risk/action keys на кшталт `missing_deadline`, `reply_escalated` і backend action labels мапляться у людиночитні українські назви перед показом у UI.

### Navigation First Paint [codex]
- **Shell** - `Sidebar.init()` ?????? ?? ?????? `shell-ready` ??????????; ????? shell ????? ???????? auth/page layer ????? explicit `showAuthenticatedPageShell()` / `Sidebar.markShellReady()`.
- **Pages** - top-level CRM pages ????????? ?? ??????????? `mainApp` baseline, ??? sidebar/header/content ?? ?????? ?? ?????????? auth ? ???????????? page bootstrap.
- **Chat** - ?????? hack `Show main app FIRST` ????????; chat shell ????????????? ????? ???????? first-paint ???????? ????? token/user bootstrap.

---

## v0.49.1 - Navigation Page Switch Flicker Fix (2026-05-15)

### Navigation Stability [codex]
- **Navigation** - прибрано visible old-shell delay під час переходів між CRM pages: sidebar click більше не тримає попередній DOM на 180ms.
- **Shell** - додано shared `shell-ready` lifecycle, який ховає broken intermediate shell до завершення sidebar baseline init.
- **Stability** - `Sidebar.init()` зроблено idempotent, прибрано дубльовані page-local sidebar toggle/init paths, а page-group animations запускаються тільки після shell readiness.

---

## v0.49.0 - Release 49 Rollout (2026-05-15)

### Release Marker [codex]
- **Visibility** - scoped visibility, reporting, parity and notification contours зібрані на canonical booking visibility без нового shadow engine.
- **Operations** - operations flow cluster зафіксовано в release 49 state: task assignment truth, chat-to-task rails, lead/customer identity, queue і accepted-vs-closed analytics.
- **Backoffice** - org/HR/inventory/pricing foundation піднято як стабільний release marker: staff department UI guidance, HR schedule truth, warehouse owner partition і Price Center product linkage.
- **Navigation Audit** - page-switch flicker root-cause audit виконано analysis-only; production fix лишається окремою наступною задачею.

---

## v0.48.15 - Org / HR / Inventory / Pricing Foundation v2 Comprehensive (2026-05-14)

### Backoffice Foundation Completion [codex]
- **Departments** - org/dept image-source у workspace не знайдено, тому фінальну taxonomy не вигадано; add-employee form переведено на наявний `StaffState.departments` legacy source з fallback, а role options стали department-aware тільки як UI guidance.
- **HR** - v1 source truth збережено: company structure/instructions, employee profile fields, reserve/blacklist, manual attendance fallback і task KPI лишаються на чинних HR/staff/task джерелах без auth-role redesign.
- **Warehouse** - існуючий `warehouse_stock.owner` явно оформлено як bounded owner partition (`park`, `dar`, `shared`) з `transferSemantics: missing-truth`, без fake multi-warehouse transfers або accounting semantics.
- **Pricing** - Price Center отримав `/api/center/prices/positions`, product-position audit у UI і виправлену привʼязку `price_rules.product_id`, яка більше не вимагає одночасної зміни value/name.
- **Tests** - додано `tests/backoffice-foundation-v2.test.js` для department fallback, department-aware form modal, price linkage і warehouse owner-partition stop-rules.

---

## v0.48.14 - Operations Flow Cluster v2 Comprehensive (2026-05-14)

### Operations Flow Completion [codex]
- **Tasks** - canonical `tasks.owner_user_id` лишається source of truth; chat-originated tasks повертають explicit source/notification meta, а bulk assignment більше не робить no-op update і не дублює assignment notifications.
- **Lead / Customer** - додано additive `leads.celebrants` і `customers.social_identities`; старі single-child/Instagram поля лишаються legacy projection, без auto-merge або fake duplicate engine.
- **Workspace Scope** - lead workspace рахує customer booking aggregates через canonical booking visibility, щоб customer context не розширював видимість поза дозволеним booking scope.
- **Analytics** - accepted-vs-closed deals report зафіксовано як snapshot-only semantics із `COUNT(DISTINCT leads.id)` duplicate protection і явною missing stage timestamp truth.
- **Tests** - додано `tests/operations-flow-v2.test.js` для schema governance, no-op assignment, celebrants/social identities, lead/customer link truth і reporting semantics.

---

## v0.48.13 - Org / HR / Inventory / Pricing Foundation v1 (2026-05-14)

### Backoffice Foundation [codex]
- **Departments** - org/dept image-source у workspace не знайдено, тому фінальну department taxonomy і registry не вигадано; hardcoded reuse points зафіксовані як legacy/UI/auth-sensitive.
- **HR** - `/hr#team` став canonical route для команди, profile deep-link відкриває картку співробітника, профіль підтримує адресу, дату народження, резерв і чорний список.
- **Schedule** - HR shifts синхронізуються у legacy `staff_schedule`, додано явну підміну зміни з audit context, а manual attendance fallback збережено.
- **Operations** - додано HR-owned структуру/інструкції, reserve/blacklist списки, структуровану анкету кандидата і task KPI на `tasks.owner_user_id` без нового task engine.
- **Warehouse / Pricing** - multi-warehouse promotion зупинено без durable stock-movement/location truth; price center лишився на існуючій working truth без fake link semantics.

---

## v0.48.12 - Operations Flow Cluster v1 (2026-05-14)

### Operations Flow [codex]
- **Задачі** - chat-to-task тепер створює canonical `tasks` з явним operator-selected `ownerUserId`; slash `/task` більше не створює окрему legacy chat-task і дубль у main tasks.
- **Notifications** - assignment/reassignment notifications стали typed-owner aware, bulk/reassign hooks використовують існуючу task notification доріжку, а no-op update більше не дублює повідомлення.
- **Lead/Customer** - lead workspace отримав explicit link/create-link клієнта; duplicate handling лишається suggest-only без auto-merge, а Telegram entry points ведуть у CRM Omni.
- **Analytics** - додано accepted-vs-closed deals report за вибраний date range із явною позначкою, що durable stage timestamp truth ще відсутня.
- **Stop-rules** - multi-social identity schema, multi-celebrant storage і task multi-responsible model не промоутяться без доведеної durable truth.

---

## v0.48.11 - Scoped Visibility & Operations Mega Completion v1 (2026-05-14)

### Visibility & Operations [codex]
- **Reporting** - booking-derived reporting, stats, center, board, settings fallback і helper/chat summaries доведено на canonical `services/bookingVisibility.js` rails без другого visibility engine.
- **Parity** - global search, customer booking aggregates/details і lead workspace shortcuts тепер не розширюють видимість поза booking/task/page scope.
- **Notifications** - Telegram digest/reminder/manual helper summaries і scheduled booking alerts отримали actor/system-scoped booking visibility та safe recipient checks.
- **Operational Scope** - підтверджено durable staff-host assignment; `team`, `line` і `location` лишаються explicit missing truth/deny-safe без fake promotion.
- **Tests** - додано regression coverage для route parity, notification scope, stable `reasonCode` contracts і заборони duplicate visibility systems.

---

## v0.48.10 - Scoped Reporting & Analytics Booking Visibility Hardening v1 (2026-05-14)

### Reporting Scope & Cache Safety [codex]
- **Reporting Scope** - booking-derived analytics, stats, center, board, settings fallback, room availability і Kleshnya/chat helper summaries тепер повторно використовують canonical `services/bookingVisibility.js`.
- **Role Guards** - `/api/stats`, `/api/center` і settings stats fallback вирівняно з page/sidebar semantics перед scoped aggregation, щоб auth-only маршрути не відкривали broad totals.
- **Cache Safety** - analytics/stats aggregates отримали actor-scoped cache keys; finance creator/director/accountant reporting лишився явно privileged full-role без redesign ролей.
- **Tests** - додано reporting visibility proof test, який блокує дубльовану reporting visibility engine і перевіряє guards/cache/finance semantics.

---

## v0.48.9 - Booking Visibility Scope v1.1 (2026-05-14)

### Durable Scope & Linked Entity Parity [codex]
- **Bookings** - розширено існуючий `services/bookingVisibility.js` без створення другої visibility-системи.
- **Scope Truth** - додано durable staff-host visibility через `employee_profiles.staff_id`, `bookings.hosts` і numeric `second_animator`; `team`, `line` і `location` лишаються явно missing durable dimensions.
- **Linked Parity** - booking-derived task routes ведуть в exact task context, а lead/customer route-outs використовують safe parent booking fallback, якщо linked entity visibility не доведена.
- **Tests** - додано перевірки staff-host scope, linked-route hierarchy і no-duplicate booking visibility system.

---

## v0.48.8 - Booking Visibility & Event Risk Scope Hardening (2026-05-14)

### Booking Visibility & Event Risk Scope Hardening v1 [codex]
- **Bookings** - додано канонічну object-level visibility policy для бронювань із full-role, operational compatible fallback, legacy exact-match fallback і deny-safe unknown scope.
- **Event Risk** - Work Queue, dashboard event-risk summaries, alerts, timeline list/occupancy та booking-derived route-outs тепер будуються тільки з visible booking scope.
- **Authz** - confirmation, linked-atomic update, PUT, payment update і delete більше не покладаються лише на page/action access, а повторно перевіряють booking object permission.
- **Compatibility** - legacy `created_by` / `second_animator` підтримуються тільки як exact compatible fallback; team/location scope явно позначено як missing durable dimension.
- **Tests** - додано booking visibility policy тести та fail-closed перевірку hidden booking confirmation route.

---

## v0.48.7 - 🛡️ 0.48 Unsafe Dismiss Full Legacy & Dynamic Cluster (2026-05-14)

### Unsafe Dismiss Hardening v2 Full Cluster [codex]
- **Lead Cluster Completion** - secondary lead overlays for lost reason and mailing entry now use guarded close semantics, and lead workspace switches respect active dirty lead surfaces before changing context.
- **Profile Safety** - profile password/settings modal close, backdrop, Escape and tab switches now route through shared dirty-state confirmation instead of direct hide.
- **Browser-Behavior Coverage** - unsafe-dismiss behavior tests now cover backdrop, Escape, route/selection transition, direct `closeModal()` bypass, confirmed discard, and read-only viewer dismissal.

---

## v0.48.6 - 🛡️ 0.48 Unsafe Dismiss Hardening v2 (2026-05-14)

### Unsafe Dismiss Hardening v2 [codex]
- **Guard Adoption** - lead customer card, art-director content/brand editors, finance account, warehouse quantity, sound announcement/project, dashboard pickers/settings та certificate flows тепер проходять через shared `UnsafeDismissGuard` там, де є editable або локально змінений state.
- **Bypass Removal** - certificates/settings більше не ховають dirty booking panel напряму, а generic `closeModal()` маршрутизує dirty editable surfaces через guarded close перед hide/remove.
- **Regression Safety** - додано behavior-level `jsdom` тест, який перевіряє dirty backdrop/direct close, rejected discard і confirmed discard без reliance тільки на static grep.

---

## v0.48.5 - 🪅 0.48 Client Pinata Operational Numbers (2026-05-14)

### Client Pinata as Service Separation v1 [codex]
- **Operations** - додано окремі поля `pinata_number` і `pinata_filler_number`, щоб номер піньяти та номер наповнювача жили як структуровані операційні атрибути.
- **Booking UI** - форма бронювання показує спільні поля номера для режимів `park` і `client`, але очищає їх у режимі `none`.
- **Server Truth** - create/update/recurring paths нормалізують номери разом із `pinata_mode`, щоб клієнтська піньята лишалась сервісом, а stale park/client поля не змішувались.
- **Operations Output** - booking detail, recurring generation, scheduler and warehouse pinata surfaces now carry the separate pinata/filler numbers where relevant.

---

## v0.48.4 - 🪅 0.48 Client Pinata as Service Separation v1 (2026-05-14)

### Client Pinata as Service Separation v1 [codex]
- **Booking Logic** - розділено піньяти парку та клієнтські піньяти через `pinata_mode` (`none`, `park`, `client`) і серверну нормалізацію stale-полів.
- **Services** - клієнтська піньята тепер зберігається як сервісна опція з ціною/нотаткою, а не як park pinata filler/catalog item.
- **Analytics** - pinata demand, складські pinata counters, scheduler tasks і product-sales категорії більше не рахують `client` mode як попит на піньяти парку.
- **UI** - форма бронювання явно показує сценарії `Без піньяти`, `Піньята парку`, `Клієнтська піньята (послуга)` і відповідні поля.

---

## v0.48.3 - ✅ 0.48 Confirmation & Event Risk Operations Cluster v1 (2026-05-14)

### Confirmation & Event Risk Operations Cluster v1 [codex]
- **Confirmation** - додано вузьку операцію підтвердження бронювання через `POST /api/bookings/:id/confirm` з `confirmed_at`, `confirmed_by`, note/source і audit trail.
- **Queue rails** - `needs_confirmation` отримав чесний inline confirm через narrow endpoint, а `event_soon` лишився окремим timing cue без fake readiness score.
- **Prep linkage** - booking-origin automation tasks тепер пишуть `source_type='booking'` і `source_id`, а prep summaries рахують тільки реально linked overdue tasks.
- **Dashboard** - додано visible-scope `event_risk_summary` для непідтверджених сьогодні/завтра, late preliminary, booking-linked overdue prep і resource warnings без universal risk score.

---

## v0.48.2 - 🛡️ 0.48 UX: unsafe dismiss hardening (2026-05-14)

### Unsafe Dismiss Hardening v1 [codex]
- **Єдина guarded-close policy** - додано shared `UnsafeDismissGuard`, який змушує editable modal/panel/overlay проходити dirty-state перевірку перед backdrop, Escape, cancel або close-all dismiss.
- **Критичні форми захищені** - lead edit, booking create/edit panel, task detail overlay, customer edit, finance transaction, design/catalog, staff/HR та content edit surfaces більше не мають прямого silent-close шляху для dirty state.
- **Booking/date/selection safety** - зміна дати або вибір іншої клітинки таймлайна тепер поважають dirty booking panel і не скидають форму без підтвердження.
- **Повторювані overlay patterns закриті** - catalog/design automation/page/image overlays, staff schedule/fill-week, HR shift/staff/correction і content business-card/post modals отримали guarded cancel/backdrop/Escape semantics.
- **Regression shield** - `tests/ui-check.js` тепер перевіряє shared unsafe-dismiss guardrails, щоб dirty critical forms не поверталися до direct backdrop/remove behavior.

---

## v0.48.1 - ✅ 0.48 Tasks: operations cluster hardening (2026-05-14)

### Task Operations Cluster v1 [codex]
- **Dashboard presence** - віджет `Команда онлайн` тепер розрізняє live WebSocket online та durable last-seen активність із `users.last_seen_at` / `employee_profiles.last_activity_at`.
- **Last seen UX** - dashboard показує readable стани `онлайн зараз`, `був N хв тому`, `сьогодні`, `вчора` або дату для старішої активності без reload усього dashboard.
- **Task dismiss safety** - task detail overlay більше не знищується напряму через backdrop/cancel; dirty form закривається тільки через guarded close confirmation.
- **Task stale guard UX** - task detail save передає поточний `version`, щоб backend optimistic-locking міг чесно відхилити stale write.

---

## v0.48.0 - ✅ 0.48 Tasks: operations cluster v1 (2026-05-14)

### Task Operations Cluster v1 [codex]
- **Typed ownership як source of truth** - task owner тепер ведеться через canonical `tasks.owner_user_id`; legacy `assigned_to/owner` лишаються display/compatibility fallback без fuzzy mapping.
- **Object-level visibility** - task list/detail/history/actions, dashboard widgets і Work Queue task buckets проходять через спільну task visibility policy, щоб hidden tasks не потрапляли в queue або mutation routes.
- **Safe task execution rails** - Tasks page і manager queue підтримують durable complete, typed reassign і deadline reschedule з object-level authz, stale-write guard, feedback та refetch після mutation.
- **Task action accountability** - `task_action_history` фіксує `task_completed`, `task_owner_reassigned` і `task_rescheduled`; open-context/route-out не логуються як execution.
- **Task-local intelligence** - task items отримали пояснювані `priorityBand`, `riskTypes`, `recommendedAction`, `why`, `confidence` і visible-scope summary без універсального cross-domain score.
- **Operational UI** - Tasks detail modal показує owner state, task-local intelligence і compact Task Action History з loading/empty/error states.

---

## v0.47.23 - ✅ 0.47 Tasks: visibility, ownership & execution rails v2 (2026-05-14)

### Task Visibility, Ownership & Execution Rails v2 [codex]
- **Typed task ownership** - додано canonical `tasks.owner_user_id`, а legacy `assigned_to/owner` лишаються display/compatibility snapshot без fuzzy owner mapping.
- **Object-level visibility** - task list/detail/mutation і manager queue task buckets використовують централізовану policy з typed owner, department scope і чесним legacy fallback тільки для unmapped задач.
- **Task execution rails** - overdue/task items у Work Queue отримали перші safe inline actions: mark done, reassign typed owner і deadline +24h, з refetch після durable mutation.
- **Task action history** - додано вузький `task_action_history` для `task_completed`, `task_owner_reassigned` і `task_rescheduled` без глобальної audit-платформи й без логування open-context.
- **Manager workspace UX** - resolution workspace показує task owner state, task execution actions, compact `Task Action History`, loading/error/empty states і без stale history leak.

---

## v0.47.22 - 🧾 0.47 Черга: reply execution action history v1 (2026-05-14)

### Reply Execution Audit Trail / Action History v1 [codex]
- **Durable reply action history** - manager `waiting_reply` execution actions тепер пишуть вузький audit trail у `reply_action_history` з actor snapshot, source surface, old/new JSON і timestamp.
- **Reply-first event model** - clear expectation, SLA snooze, owner reassignment, manual escalation і linked escalation closure мають єдиний queryable формат без глобальної CRM audit-платформи.
- **Manager-only history endpoint** - Work Queue отримала bounded newest-first API для останніх reply execution events по conversation, з тими самими manager-up auth boundaries.
- **History panel у workspace** - resolution workspace показує компактний `Reply Action History` для reply items, із loading/empty/error/data станами і без stale history leak після refetch/next-item.
- **Regression shield** - оновлено work-queue тести для audit write/read, source surface, manager-only access, bulk actions і jsdom rendering.

---

## v0.47.21 - ⚙️ 0.47 Черга: execution engine v6 reply-first core (2026-05-14)

### Manager Queue Execution Engine v6 [codex]
- **Reply-first execution core** - Work Queue resolution workspace отримав bucket-aware execution shell: глибокі inline дії доступні лише для `waiting_reply`, де є canonical reply truth.
- **Durable reply outcomes** - clear expectation, `SLA +24г`, reassign owner і overdue escalation працюють через наявні canonical поля `reply_expected`, `reply_sla_at`, `reply_owner_user_id` та `conversation_reply` escalation anchor.
- **Safe next-item flow** - після успішної durable reply mutation черга refetch-иться, selection перевіряється заново і фокус переходить тільки до наступного видимого item, якщо попередній більше не є коректним фокусом.
- **Route-out rails для слабших bucket-ів** - task/callback/confirmation/event/idle items показують exact-context route-out і пояснення, чому inline execution тут ще не вмикається.
- **Без fake universal workflow** - `open exact context` не вважається resolution, а `event_soon` і `idle_lead` не отримують generic `done/defer/delegate` кнопок.

---

## v0.47.20 - 🧠 0.47 Черга: bucket-aware intelligence v1 (2026-05-14)

### Manager Queue Intelligence v1 [codex]
- **Priority bands без fake score** - Work Queue тепер збагачує видимі manager queue items структурою `intelligence` з `critical`, `action_today`, `watch` і `suggested` замість універсального числового score.
- **Bucket-aware рекомендації** - `waiting_reply`, overdue tasks, `callback_due`, `needs_confirmation`, `event_soon` і `idle_lead` отримують різну глибину рекомендацій, `riskTypes`, `why` і `confidence` відповідно до сили їхніх реальних сигналів.
- **Visible-scope summary** - `queue.meta.intelligence` рахує priority bands, top risks і bottleneck-и тільки з уже повернутих manager-visible queue items, без окремого глобального DB scan.
- **Weak buckets contained** - `idle_lead` лишається `suggested` / `summary_only` і не може обігнати canonical overdue reply або task pressure.
- **Dashboard surfacing** - Work Queue показує compact intelligence strip, band pills на items і сильніший selected-item intelligence snapshot у resolution workspace.

---

## v0.47.19 - 🧭 0.47 Черга: triage & resolution workspace v4 (2026-05-14)

### Manager Triage & Resolution Workspace v4 [codex]
- **Resolution workspace у Work Queue** - менеджер може вибрати пункт черги й одразу бачити причину, owner/risk snapshot, exact-context links і доступні дії без втрати фільтрів.
- **Bucket-specific глибина** - `waiting_reply` отримує inline reply actions, а callback/task/booking/idle buckets чесно лишаються inspect + route-out без фейкового універсального редактора.
- **Навігація по черзі** - workspace підтримує next/previous/return-to-queue flow і очищає stale selection після зміни scope/filter state.
- **Explainability без нової truth model** - панель використовує наявні queue fields, `meta.signal`, SLA/owner/escalation дані та exact hrefs без schema змін.
- **UI safety** - додані empty/no-selection/selected стани, focus handling, dark-mode styling і jsdom перевірка bucket-specific rendering.

---

## v0.47.18 - 💬 0.47 Комунікації: reply operations console v2 (2026-05-13)

### Reply Operations Console v2 [codex]
- **Console для reply debt** - Work Queue отримала єдиний manager-facing блок для `waiting_reply`: summary chips, preset-и, SLA/owner/escalation фільтри та швидкий reset.
- **Bulk selection** - менеджер може обрати видимі reply items або окремі розмови; hidden rows не потрапляють у bulk action після зміни фільтрів.
- **Bulk actions без нової truth model** - bulk reassign, `SLA +24г` і bulk clear працюють через canonical поля `reply_owner_user_id`, `reply_sla_at`, `reply_expected`.
- **Escalation coherence** - bulk дії повторно використовують існуючі reply helpers, тому escalation tasks синхронізуються або закриваються без дублів.
- **Без schema/RBAC розширення** - saved views зберігаються локально як preset/filter state; `reply_owner` лишається display label і не використовується для фільтрації чи mutation authority.

---

## v0.47.17 - 💬 0.47 Комунікації: reply owner picker v1 (2026-05-13)

### Reply Owner Picker / Assignee UX v1 [codex]
- **Picker замість ID prompt** - у Work Queue перепризначення відповідального для `waiting_reply` відкриває компактний список активних assignable users замість ручного введення numeric id.
- **Canonical user id** - вибір і збереження працюють тільки через `users.id`; display label `reply_owner` лишається snapshot/fallback, але не стає authority для reassignment.
- **Manager-safe source** - додано вузький manager-up endpoint для активних reply owner candidates; inactive/non-assignable користувачі не потрапляють у список і блокуються серверною перевіркою.
- **Interaction safety** - picker має loading/error/empty/disabled стани, Escape/Cancel close та фокус на select, без fallback на free-text label.
- **Без schema змін** - зміна використовує наявні `reply_owner_user_id`, `reply_owner` і manager-only backlog actions.

---

## v0.47.16 - 💬 0.47 Комунікації: reply backlog actions v1 (2026-05-13)

### Reply Backlog Actions v1 [codex]
- **Дії з черги** - Work Queue отримала manager-only дії для `waiting_reply`: змінити відповідального, перенести SLA на +24 години та явно очистити очікування відповіді.
- **Typed owner only** - перепризначення працює через `reply_owner_user_id` і активний `users.id`; display label `reply_owner` лишається лише snapshot/fallback.
- **SLA без callback coupling** - snooze змінює тільки `conversations.reply_sla_at`, не редагує `follow_up_date`, callback чи generic task deadlines.
- **Escalation coherence** - clear/snooze скасовують stale reply-escalation task, а reassign синхронізує її display assignee без переходу на повну task ownership migration.
- **Без нового schema** - зміна використовує вже наявні reply expectation / SLA / owner поля, старі рядки лишаються null-safe.

---

## v0.47.15 - 💬 0.47 Комунікації: reply backlog filters v1 (2026-05-13)

### Reply Backlog Filters v1 [codex]
- **Owner-aware backlog** - Work Queue отримала `replyScope=mine|team|all` для bucket `waiting_reply`, побудований тільки на `reply_owner_user_id`.
- **Мої відповіді** - `mine` показує лише розмови, де `conversations.reply_owner_user_id = current user id`; `reply_owner` label не використовується для фільтрації.
- **Команда без overclaim** - `team` означає поточний manager-visible backlog без моїх typed owner items, а не новий department/RBAC режим.
- **Null-safe legacy** - старі рядки без typed owner не потрапляють у `mine`, але лишаються видимими в `team/all`, якщо їх уже дозволяє поточна manager visibility.

---

## v0.47.14 - 💬 0.47 Комунікації: typed reply owner v1 (2026-05-13)

### Reply Owner Typing v1 [codex]
- **Typed reply owner** - `conversations.reply_owner_user_id` тепер зберігає канонічний `users.id` для власника активного reply expectation.
- **Display snapshot сумісність** - `reply_owner` лишається людською міткою для UI, історичних рядків і старих клієнтів.
- **Без фейкового backlog** - Work Queue, Customer Hub, workspace ліда та Omni payload віддають typed owner id, але не вводять owner-only фільтри чи нові permissions.
- **Межа задач** - reply escalation task і далі використовує чинну string ownership модель; повне retyping задач відкладено окремо.

---

## v0.47.13 - 💬 0.47 Комунікації: reply auto-escalation v2 (2026-05-13)

### Reply Auto-Escalation v2 [codex]
- **Idempotent escalation task** - overdue explicit `waiting_reply` тепер може створити одну task з `source_type='conversation_reply'` і `source_id=<reply_expected_message_id>`, без дублювання при повторних scheduler runs.
- **Race-safe linkage** - додано вузький partial unique index для reply-escalation anchors, щоб одна reply expectation не породжувала кілька відкритих або повторних задач.
- **Stale close** - inbound reply, delivery failure або explicit clear скасовують активну escalation task для відповідного reply anchor, не змішуючи це з `callback_due`.
- **Чесний trigger** - escalation стартує тільки з active overdue `replySlaState`; unread, звичайний outbound, provider accepted/read або `due_soon` не створюють задач.

---

## v0.47.12 - 💬 0.47 Комунікації: reply SLA severity v1 (2026-05-13)

### Reply SLA Severity v1 [codex]
- **Центральний SLA state** - додано `replySlaState` для активного `waiting_reply`: `none`, `on_track`, `due_soon`, `overdue`.
- **Work Queue severity** - bucket `waiting_reply` показує compact SLA cues з `reply_sla_at`, сортує SLA-очікування перед розмовами без SLA і не змішує їх із `callback_due`.
- **Контекстні бейджі** - Dashboard Work Queue, Omni, Customer Communication Hub і workspace ліда показують "SLA в нормі", "SLA скоро спливає" або "SLA прострочено" тільки для активного explicit очікування.
- **Без automation/schema** - auto callback/task escalation навмисно не створюється; старі розмови без `reply_sla_at` лишаються без fake severity.

---

## v0.47.11 - 💬 0.47 Комунікації: waiting reply queue + UI v1 (2026-05-13)

### Waiting Reply Queue + UI Surfacing v1 [codex]
- **Manager-visible waiting reply** - Work Queue тепер показує `waiting_reply` як окремий bucket із exact переходом у відповідну Omni-розмову.
- **Тільки explicit model** - bucket і UI-індикатори беруться з `reply_expected` / `awaiting_reply_since`, а не з unread, будь-якого outbound або provider accepted/read.
- **Контекстні індикатори** - Omni list/header, Customer Communication Hub і workspace ліда компактно показують "Очікуємо відповідь з..." там, де є активне explicit очікування.
- **Clear/failure truth** - surfaced стан поважає later inbound після `awaiting_reply_since` і delivery failure, щоб не лишати фейкове очікування відповіді.
- **Без нового schema/backfill** - зміна спирається на Canonical Reply Expectation v1; старі розмови без explicit поля не потрапляють у `waiting_reply`.

---

## v0.47.10 - 💬 0.47 Комунікації: canonical reply expectation v1 (2026-05-13)

### Canonical Reply Expectation v1 [codex]
- **Explicit waiting-reply model** - `conversations` тепер має явні поля `reply_expected`, `awaiting_reply_since`, `reply_expected_message_id`, `reply_owner` і `reply_sla_at`, щоб CRM не виводила очікування відповіді з unread/outbound евристик.
- **Manual Omni intent** - менеджер може позначити "Очікуємо відповідь" під час ручної відправки; звичайний outbound, provider accepted/delivered/read і unread самі по собі не створюють `waiting_reply`.
- **Safe clear/invalidate** - вхідне повідомлення після `awaiting_reply_since` очищає активне очікування, а immediate/later delivery failure не залишає фейковий waiting-reply.
- **Work Queue bucket** - черга отримала окремий `waiting_reply` bucket на основі durable reply expectation fields, при цьому `callback_due` і `follow_up_due` не змішуються з очікуванням відповіді.
- **Без backfill** - старі розмови лишаються `reply_expected=false`, бо історичний бізнес-намір очікувати відповідь не можна чесно відновити заднім числом.

---

## v0.47.9 - 📬 0.47 Комунікації: lifecycle receipts v1 (2026-05-13)

### Provider Lifecycle v1: Viber + TurboSMS [codex]
- **Viber receipts** - webhook callbacks `delivered`, `seen` і `failed` тепер класифікуються як provider lifecycle події та оновлюють оригінальний outbound row за `message_token`.
- **TurboSMS DLR** - статуси `DELIVRD`, `UNDELIV`, `REJECTD` і `EXPIRED` мапляться в durable delivery truth за `message_id`, без створення фейкових inbound SMS.
- **Нові durable стани** - `conversation_messages.delivery_status` розширено на `delivered`, `read` і `later_failed`, а provider event timestamp/source/type зберігаються окремими nullable полями.
- **Manager-safe Omni UI** - Omni показує confirmed delivery/read/late failure лише тоді, коли ці стани реально прийшли від Viber або TurboSMS; Telegram, Meta і Binotel залишаються без фейкових lifecycle claims.
- **Без backfill** - старі outbound повідомлення не отримують delivery/read статус заднім числом, бо provider receipt truth для них не доведений.

---

## v0.47.8 - 🛰️ 0.47 Комунікації: durable truth schema (2026-05-13)

### Durable Communication Truth Schema v1 [codex]
- **Durable delivery foundation** - `conversation_messages` тепер має nullable поля для provider ID, delivery status, помилки, часу спроби, provider acceptance і immediate failure без вигаданого final delivery.
- **Мінімальна модель статусів** - додано компактні стани `saved`, `attempted`, `accepted`, `failed`, `unknown`; `accepted` означає тільки прийнятий provider request, а не підтверджену доставку клієнту.
- **Timestamp-и для майбутнього reply logic** - `conversations.last_inbound_at` і `last_outbound_at` зберігають durable напрямок останньої комунікації, але `waiting_reply` ще не робиться канонічним станом.
- **Без фейкового backfill** - історичні outbound повідомлення не отримують delivery status, бо стару provider truth неможливо довести заднім числом.
- **Backward compatible Omni UI** - Omni читає durable поля, коли вони є, і лишає fallback на `meta.sendTruth` для старих рядків.

---

## v0.47.7 - 📡 0.47 Комунікації: чесна відправка в Omni (2026-05-13)

### Communication Send Truth v1 [codex]
- **DB save не маскується під доставку** - Omni send flow тепер повертає чесний `sendTruth`, щоб менеджер бачив різницю між "збережено в CRM" і immediate-result провайдера.
- **Нормалізація provider result** - Telegram `{ ok: false }`, Viber/SMS/Facebook/Instagram `success: false` та невизначені відповіді зводяться до зрозумілих станів `provider_attempted`, `provider_failed_immediate`, `provider_unknown`.
- **Inbound-only guard** - Binotel та інші не send-capable канали блокуються до створення outbound row і показують зрозуміле пояснення в Omni UI.
- **Чесні bubble/feedback стани** - outbound повідомлення показують, що фінальна доставка у v1 не підтверджується без durable delivery schema.
- **Без schema changes** - реліз використовує наявний `conversation_messages.meta`; `provider_message_id`, `delivery_status` і canonical `waiting_reply` лишаються окремим schema/task boundary.

---

## v0.47.6 - 🌙 0.47 Ліди: видимі списки вибору в темній темі (2026-05-13)

### Dark Stage Dropdown Fix [codex]
- **Темна тема для native dropdowns** - shared `css/dark-mode.css` тепер задає темний color scheme і контрастні `option` для відкритих `<select>`.
- **Етапи видно повністю** - у Manager Action Strip emoji та назви pipeline stages більше не зникають на білому option-фоні.
- **Схожі поля теж закрито** - фікс покриває інші select/date/time controls у dark mode, зокрема задачі, клієнтів, фінанси, модалки та фільтри.
- **Без зміни workflow** - логіка `pipeline_stage`, quick actions і права доступу не змінювались.

---

## v0.47.5 - ⚡ 0.47 Ліди: швидкі дії менеджера у workspace (2026-05-13)

### Manager Action Strip v1 [codex]
- **Швидкі дії в workspace ліда** - у `/sales-funnel?lead=ID` додано Manager Action Strip з дзвінком, exact Omni-переходом, карткою клієнта, exact бронюванням, callback-задачею, відкриттям/виконанням exact task і підтвердженням preliminary booking.
- **Канонічний stage без дублювання** - зміна етапу в action strip використовує `pipeline_stage` через наявний lead stage flow, не створюючи паралельну workflow-логіку.
- **Exact-first дисципліна** - Omni, booking і task actions показуються як активні тільки коли є точний контекст; fallback-збіги лишаються навігаційними/недоступними й не маскуються під готові дії.
- **Callback-задачі з durable linkage** - створення callback із workspace тепер передає `source_type='lead'` і `source_id`, а backend `/api/tasks` зберігає цей зв'язок.
- **Без dead `cancelled` action** - task detail більше не пропонує статус `cancelled`, який не підтримувався поточним backend three-state flow.
- **Без fake-send UX** - strip не додає прямого надсилання повідомлень, щоб не обіцяти delivery там, де поточна provider-модель гарантує лише відкриття каналу або CRM-навігацію.

---

## v0.47.4 - 💬 0.47 Клієнти: комунікаційний хаб у картці (2026-05-13)

### Customer Communication Hub v1 [codex]
- **Картка клієнта як старт комунікації** - додано read-only communication hub у detail/card flow клієнта: дзвінок, Omni-перехід, кейс ліда та релевантне бронювання зібрані в одному місці.
- **Exact / suggested / unavailable** - customer→Omni handoff чесно показує точну live-розмову через `conversations.customer_id`, ймовірний збіг за телефоном/іменем або відсутність live-каналу.
- **CRM-журнал не видається за live-чат** - внутрішні записи `communication_log` візуально й текстово відділені від історії Omni, щоб менеджер не плутав нотатки з реальною перепискою.
- **Навігація без fake delivery** - хаб не додає пряме надсилання з картки й не обіцяє доставку там, де поточна система гарантує лише навігацію або CRM-персистентність.
- **Захист від регресій** - додано focused tests для exact/suggested/unavailable resolver, inbound-only каналів і статичний UI smoke для customer hub.

---

## v0.47.3 - 🧭 0.47 Ясність: фільтри й порожні стани без здогадок (2026-05-13)

### Explainability Kit v1 [codex]
- **Фільтри видно одразу** - додано reusable Explainability Kit для активних фільтрів, reset-дій і cause-aware empty states на manager-facing поверхнях.
- **Задачі без оманливих лічильників** - вкладки Tasks тепер рахують задачі у тому самому category-scope, який бачить менеджер, а порожній стан пояснює активну категорію або рольову видимість.
- **Ліди, клієнти, Omni** - `/sales-funnel`, `/customers` і `/omni` показують активний зріз, пошук/канал/дату/тип і дають швидкий шлях повернути повний список.
- **Робоча черга чесніше пояснює себе** - Dashboard Work Queue показує omitted/heuristic/warning meta з endpoint, щоб manager не плутав "порожньо" з unsupported або частково недоступним bucket.
- **Доступ не розширено** - role/access модель не змінювалась; UI лише краще пояснює, коли видимість або дія обмежена поточною роллю.

---

## v0.47.2 - ⚡ 0.47 Черга: робочі пріоритети менеджера (2026-05-13)

### Work Queue v1 [codex]
- **Канонічна робоча черга** - додано read-only endpoint `/api/work-queue`, який збирає існуючі durable сигнали в єдині buckets: `overdue`, `today`, `tomorrow`, `callback_due`, `needs_confirmation`, `event_soon`, `idle_lead`.
- **Джерела сигналів** - черга використовує `tasks.deadline/date/source_type/source_id`, `lead_interactions.follow_up_date`, `bookings.date/time/status`, `leads.event_date`, `leads.last_contact_at` і canonical `pipeline_stage`.
- **Dashboard UI** - для manager-up ролей додано компактний блок "Робоча черга" з лічильниками, короткими пунктами і переходами в кейс ліда, таймлайн бронювання або задачу.
- **Без fake waiting reply** - `waiting_reply` не додано як канонічний bucket, бо в поточній моделі це ще не durable стан; `idle_lead` позначається як suggested сигнал.
- **Захист від регресій** - додано focused tests для access gating, bucket generation, корисних href та заборони повертатися до legacy `status='new'` як джерела cold lead логіки.

---

## v0.47.1 - 🔗 0.47 Ліди: Omni Case Link і бронювання з ліда (2026-05-13)

### Omni Case Link v1 + Lead→Booking Repair [codex]
- **Omni Case Link v1** - `/omni?conversation=ID` тепер відкриває конкретну розмову і показує CRM-контекст із чесним статусом `exact`, `suggested` або `unresolved`.
- **Точні переходи** - Omni дає посилання на `/sales-funnel?lead=ID`, `/customers?open=ID` і таймлайн бронювання тільки коли ці ID реально відомі.
- **Workspace → Omni** - робочий простір ліда відкриває точну Omni-розмову через `conversation`, а `search` лишається fallback для сумісності.
- **Лід → бронювання** - конвертація ліда тепер переносить `leadId`, ім'я, телефон і дату в таймлайн/форму, а після створення бронювання записує `leads.booking_id`.
- **Захист від регресій** - додано focused-тести для exact/suggested Omni context і repair логіки `leads.booking_id`.

---

## v0.47.0 - ✨ 0.47 Ліди: видимий релізний milestone (2026-05-13)

### Релізна лінія 0.47 [codex]
- **Перший екран** - login-блок тепер показує помітний бейдж `✨ 0.47 Ліди`, щоб актуальний milestone було видно одразу.
- **Назва релізу** - кнопка "Що нового" оновлена до `🚀 Що нового у v0.47.0: Ліди` з акцентом на новому робочому просторі менеджера.
- **Версійна політика** - активну лінію переведено на `0.47.x`, а `package.json` лишається джерелом істини для синхронізації.
- **UI polish** - релізний акцент додано без зміни сценарію входу, прав доступу чи workspace-логіки `/sales-funnel`.

---

## v0.46.15 - Єдиний робочий простір менеджера для ліда (2026-05-13)

### Unified Manager Workspace Stage 2 [codex]
- **Sales Funnel Workspace** - на `/sales-funnel` додано lead-centric drawer, який стабільно відкривається через `?lead=ID` і збирає кейс менеджера в одному робочому просторі.
- **Case composition** - `GET /api/leads/:id/workspace` повертає lead, linked customer, customer card, active/related bookings, tasks/next actions, interactions, communication log, conversation summary та urgency/date cues.
- **Канонічний статус** - workspace читає етап з `pipeline_stage`; старі Copilot/workflow статуси не стали джерелом правди для менеджерського кейсу.
- **Навігація без втрати контексту** - додано відкриття `/customers?open=ID`, `/tasks?open=ID`, контекстний `/omni?search=...`, а `/omni` з'явився у sidebar для manager-up ролей.
- **Захист від регресій** - route smoke перевіряє case composition, UI smoke перевіряє workspace shell/deep links, access matrix перевіряє новий sidebar item.

---

## v0.46.14 - Видима кнопка продажів на Timeline (2026-05-13)

### Timeline: контраст кнопки продажів [codex]
- **Кнопка продажів** - виправлено колір тексту `📊 Продажі`, щоб напис був читабельним і у світлій, і у темній темі.
- **Теми** - додано окремі light/dark стилі для нейтральної action-кнопки, без повернення до вигляду перемикача режиму.
- **Захист від регресії** - UI smoke тепер перевіряє, що кнопка продажів має контрастний текст для обох тем.

---

## v0.46.13 - Чистий експорт і зручніша модалка продажів програм (2026-05-13)

### Продажі програм: UX та експорт [codex]
- **Модалка продажів** - перебудовано звіт на Timeline: компактні фільтри, зрозумілий блок експорту, повноширинна виписка та читабельні підсумки.
- **Експорт CSV** - файл тепер відкривається як одна чиста таблиця без секційних заголовків і без зайвих колонок.
- **Експорт Excel** - XLSX отримав форматовані таблиці з freeze row, autofilter, ширинами колонок і числовим форматом сум.
- **Оплати й борги** - прибрано `Оплачено` та `Борг` зі звіту продажів програм, бо фінансову звірку буде реалізовано окремо.
- **Захист від регресій** - smoke-тести перевіряють, що CSV/XLSX більше не містять оплат/боргів, а скасовані й пов'язані бронювання не потрапляють у вибірку.

---

## v0.46.12 - Продажі програм на Timeline (2026-05-13)

### Місячний звіт продажів програм [codex]
- **Timeline** - додано кнопку "Продажі", яка відкриває місячний звіт по проданих розважальних програмах без переходу в окремий модуль.
- **Аналітика** - `GET /api/analytics/product-sales` рахує тільки підтверджені бронювання за датою події, без скасованих і без дублювання пов'язаних бронювань другого аніматора.
- **Піньяти** - додано швидкий фільтр категорії `pinata`, щоб раз на місяць швидко отримати виписку з датами й сумами.
- **Експорт** - додано CSV та XLSX вивантаження з підсумком по програмах і детальною випискою продажів.
- **Захист від регресій** - route smoke і UI smoke перевіряють доступ manager-up, антидублювання `linked_to`, кнопку, фільтри та експортні заголовки.

---

## v0.46.11 - Виправлення layout gap у shell-сторінках CRM (2026-05-13)

### Layout gap cluster fix [codex]
- **Ліди** - прибрано structural duplicated shell offset: сторінка більше не вкладає `.main-content` всередину `.page-container`, тому контент стартує біля sidebar з нормальним відступом.
- **Designs** - прибрано крихкий inline `margin-left: 220px` на `main.page-container`; сторінка тепер покладається на shared layout rules.
- **Timeline/Помічник** - старий collapse path у `js/app.js` більше не пише inline `marginLeft/width`, а лишає геометрію shared CSS-класам.
- **UI Guard** - UI smoke тепер ловить nested shell anti-pattern, inline shell offsets і недокументовані `.main-content` shell pages.
- **Перевірка layout** - Chromium-заміри підтвердили, що Leads повернувся до нормального gap на 1440/1024/1000/768px і не зачепив standard shell pages.

---

## v0.46.10 - Єдиний вихід зі сторінок CRM (2026-05-13)

### Shared logout binding [codex]
- **Авторизація** - `js/auth.js` тепер централізовано прив'язує кнопку "Вийти" до canonical `logout()` на всіх сторінках, де є `#logoutBtn`.
- **Ліди** - виправлено сторінку лідів, де кнопка виходу була присутня в DOM, але не мала click handler без `js/app.js`.
- **CRM Shell** - локальні page-specific logout handlers замінено на shared binding, щоб не було розсинхрону між сторінками.
- **Сесія** - вихід всюди проходить через однаковий cleanup token/current user/session/private caches.
- **Захист від регресій** - UI smoke перевіряє, що сторінки з `#logoutBtn` підключають `auth.js`, а direct logout ownership лишається в shared auth layer.

---

## v0.46.9 - Аудит контрасту темної теми (2026-05-13)

### Аудит контрасту темної теми [codex]
- **Токени теми** - темна тема тепер явно задає shared `--text*`, `--surface`, `--card-bg`, `--bg-*` і `--border-color` aliases, щоб нові картки, форми, dropdowns і модалки не падали у світлі fallback-кольори.
- **Приглушений текст** - підсилено читабельність secondary/helper тексту в каталогах, контент-картках, нотатках профілю, порожніх станах, placeholders і task/notification muted controls.
- **Компонентні групи** - перевірено сповіщення, картки/списки, badges/pills, модалки/overlays, таблиці/рядки, форми, sidebar/topbar widgets і status states на очевидні dark-mode contrast провали.
- **Захист від регресій** - UI smoke тепер контролює shared dark-mode contrast tokens і найризиковіші muted selectors.

---

## v0.46.8 - Контраст сповіщень у темній темі (2026-05-13)

### Dropdown сповіщень [codex]
- **Primary text** - виправлено темний fallback у notification dropdown, через який заголовки карток майже зливалися з dark mode фоном.
- **Secondary/meta text** - додано окремий muted-рівень для описів, лічильників і заголовків груп без втрати читабельності.
- **Варіанти карток** - warning, critical та info елементи зберігають акцентні фони, але отримують контрастні foreground states.
- **Read state** - прочитані сповіщення більше не затемнюють всю картку через opacity, тому текст не провалюється в фон.
- **Захист від регресій** - UI smoke перевіряє dark-mode text tokens і variant coverage для notification dropdown.

---

## v0.46.7 - Українські релізні нотатки (2026-05-13)

### Мова релізних описів [codex]
- **Українська в UI** - записи модалки "Що нового" для актуальної релізної лінії переведені українською.
- **Правило на майбутнє** - `AGENTS.md` тепер прямо вимагає українські релізні описи для `index.html` і `CHANGELOG.md`.
- **Технічні назви** - endpoints, file paths, role ids, package names і API names залишаються у канонічному написанні, коли це потрібно для точності.
- **Контроль версії** - перший екран, cache tags і service worker cache names оновлюються через стандартний version sync.

---

## v0.46.6 - Виправлення відповідального в ліді (2026-05-13)

### Потік відповідального менеджера ліда [codex]
- **Список відповідальних для лідів** - модалка ліда тепер завантажує менеджерів з `/api/leads/assignees`, а не з creator/director-only endpoint керування користувачами.
- **Доступ без адмінки** - manager і marketer користувачі, які працюють з лідами, можуть завантажувати assignable users без відкриття `/api/users`.
- **Валідація відповідального** - lead create/update перевіряє `assigned_to` як активного assignable user і повертає зрозумілий 400 для неправильних значень.
- **Захист від регресій** - route smoke та UI checks покривають завантаження й оновлення відповідального ліда.

---

## v0.46.5 - Відновлення кнопок модалки ліда (2026-05-13)

### Дії модалки редагування ліда [codex]
- **Раннє підключення кнопок** - controls модалки ліда прив'язуються до async user/lead loading, тому save/cancel не губляться через повільний або невдалий data request.
- **Підтримка тапів iPad** - кнопки "Зберегти" і "Скасувати" обробляють touchend taps із захистом від duplicate synthetic click.
- **Захист від подвійного збереження** - save вимикається, поки триває lead update request, щоб не було повторних submissions.
- **Захист від регресій** - UI smoke checks покривають кнопки edit modal і їхній touch binding.

---

## v0.46.4 - Одноколонкові рядки ліда на iPad Safari (2026-05-13)

### Фікс модалки ліда для iPad Safari [codex]
- **Резервне правило Touch WebKit** - рядки форми ліда складаються в одну колонку на touch/WebKit пристроях.
- **Підтверджений фікс поля** - бажана дата й кількість дітей більше не ділять один рядок на iPad, що прибирає paint-overlap нативного Safari date-control.
- **Безпека картки клієнта** - customer-card form rows успадковують таку саму iPad-safe layout behavior.
- **Захист від регресій** - UI smoke checks прямо перевіряють touch/WebKit row-stacking rules.

---

## v0.46.3 - Посилення tablet/WebKit розмітки модалок (2026-05-13)

### Адаптивні форми модалок [codex]
- **Суміжні модалки** - customer, finance, art-director і Copilot two-column form rows використовують shrink-safe grid tracks.
- **Межі нативних контролів** - date, number, select і text controls у цих рядках залишаються всередині grid columns на tablet WebKit layouts.
- **Покриття регресій** - UI smoke checks покривають додаткові modal form surfaces, щоб майбутні релізи ловили stale `1fr 1fr` regressions.
- **Браузерна перевірка** - iPad-sized layout verification покриває lead, customer-card, customer edit, transaction edit і content edit modals.

---

## v0.46.2 - Виправлення iPad-розмітки модалки ліда (2026-05-12)

### Адаптивний UI для лідів [codex]
- **Фікс поля дати на iPad** - date inputs у lead edit modal залишаються всередині своєї grid column замість накладання на поле кількості дітей у tablet WebKit layouts.
- **Захист спільної сітки модалок** - двоколонкові рядки модалки ліда використовують shrink-safe grid tracks і form controls з явними min/max widths.
- **Покриття суміжної форми** - customer-card modal rows, які повторно використовують ту саму lead modal layout, покриті тим самим responsive fix.
- **Захист UI smoke** - static UI checks перевіряють поля date/children у lead/customer і WebKit-safe grid rules.

---

## v0.46.1 - Інструменти ремонту Guardian moderation (2026-05-12)

### Guardian repair and reconciliation [codex]
- **Ремонт із попереднім поясненням** - додано preview moderation-state для одного користувача, який порівнює durable event facts із derived `guardian_moderation_counters`.
- **Обмежене застосування** - privileged operators можуть ремонтувати тільки missing/mismatched `repeat_offender` / `hourly_blocks` counter rows для одного користувача за раз.
- **Безпечні межі** - stale/orphan counter rows показуються у звіті, але не видаляються автоматично, щоб історичні state changes лишалися явними.
- **Контроли Ops-консолі** - Guardian Ops має user-id repair panel із preview/apply actions, loading/error states і поясненнями issues.
- **Аудит відновлення** - applied repairs записують Guardian ops audit record з issue і applied-row counts.

---

## v0.46.0 - Узгодження Guardian delivery (2026-05-12)

### Guardian reliability convergence [codex]
- **Явні стани життєвого циклу** - Guardian delivery events розрізняють delivered, duplicate no-op, retryable failure, terminal failure, replayed і dead-letter outcomes.
- **Класифікація помилок** - Telegram/director delivery paths класифікують malformed payloads, missing targets, missing configuration, provider rejection і transient provider failures.
- **Dead-letter metadata** - `event_queue` і `event_dead_letter` зберігають Guardian convergence status, failure class, attempts, idempotency key, terminal reason і replay linkage.
- **Replay для оператора** - Guardian Ops окремо показує dead-lettered Guardian delivery events і дозволяє один privileged single-event replay.
- **Цільові тести** - додано convergence, delivery classification і ops replay coverage для retry, terminal, duplicate/no-op і dead-letter behavior.

---

## v0.45.9 - Консоль Guardian Ops (2026-05-12)

### Операторська поверхня Guardian [codex]
- **Захищена консоль** - додано `/guardian-ops` як internal operator page для Guardian reliability state.
- **Операційна видимість** - консоль показує pending/failed Guardian outbox work, event-queue failures, active mutes, durable escalation counters і recent Guardian actions.
- **Обмежене відновлення** - operators можуть requeue один Guardian outbox або failed event-queue item з консолі без bulk replay.
- **Вирівнювання доступу** - backend page access, frontend access і sidebar metadata відкривають Guardian Ops тільки ролям creator/director/admin/security.
- **Безпечні стани UI** - додано loading, empty, error, disabled і live-region states для operator surface.

---

## v0.45.8 - Операторські контроли надійності Guardian (2026-05-12)

### Guardian reliability phase 3 [codex]
- **Операторський знімок** - додано protected Guardian reliability inspection для pending/failed Guardian outbox events, event-queue failures, active mutes, recent actions і durable moderation counters.
- **Обмежене відновлення** - operators можуть requeue один unpublished Guardian outbox row або failed event-queue item без bulk replay controls.
- **Межа прав** - Guardian ops endpoints обмежені ролями creator/director/admin/security і відхиляють non-Guardian recovery targets.
- **Аудит** - requeue actions пишуть Guardian ops admin-audit entry з previous attempts/error context.
- **Цільові тести** - додано authz і recovery coverage для inspection, outbox requeue, event-queue requeue і unsafe target rejection.

---

## v0.45.7 - Стійкий стан Guardian moderation (2026-05-12)

### Guardian reliability phase 2 [codex]
- **Стійкі лічильники** - repeat-offender і hourly-block escalation tracking використовують database-backed moderation events і counters замість module-scoped memory.
- **Безпечний replay** - Guardian mute events записують stable source identities, щоб repeated processing того самого mute не збільшував escalation counters.
- **Зв'язка escalation** - repeat-offender і hourly-block Telegram alert requests публікуються з тієї самої mute transaction, коли перетинаються durable thresholds.
- **Restart-safe baseline** - додано focused tests для duplicate source suppression, rolling-window reset і one-alert-per-window behavior.

---

## v0.45.6 - Фундамент доставки Guardian alerts через outbox (2026-05-12)

### Guardian delivery reliability [codex]
- **Стійкий delivery envelope** - Guardian critical alert requests використовують явні outbox/event types для director DM і Telegram alert delivery.
- **Зв'язка mute alerts** - successful Guardian mute claims публікують director DM і Telegram escalation requests у тій самій transaction, що й `chat_mutes` та `guardian_actions`.
- **Зв'язка action follow-up** - `/api/guardian/action` warning follow-ups додають director DM delivery всередині action transaction замість лише post-commit direct call.
- **Duplicate-safe processing** - director DM delivery використовує stable delivery keys у message metadata, щоб уникати duplicate user-visible alerts на retry.
- **Цільові тести** - додано mocked delivery coverage для enqueue semantics, duplicate suppression, provider failure і Telegram request handling без live provider calls.

---

## v0.45.5 - Одноразові action controls Guardian (2026-05-12)

### Guardian stale-tap safety [codex]
- **Одноразові контроли** - Guardian DM action buttons несуть per-alert action tokens, тому stale repeated taps поглинаються на server boundary.
- **UI-контракт** - chat UI надсилає action token з `/api/guardian/action` і замінює button group результатом сервера після завершення.
- **Duplicate-safe fallback** - старі клієнти без action tokens зберігають existing deterministic idempotency fallback.
- **Цільові тести** - додано coverage для consumed tokens, repeated taps і separate alerts із separate tokens.

---

## v0.45.3 - Ідемпотентність Guardian mute/action (2026-05-12)

### Цілісність Guardian [codex]
- **Duplicate-safe auto mute** - Guardian mute creation використовує advisory-lock transaction і пропускає duplicate side effects, коли active channel/user mute вже існує.
- **Одноразові дії директора** - repeated `/api/guardian/action` taps claim-яться через deterministic idempotency keys до запуску muting, warning, watching або unmuting side effects.
- **Зменшення side effects** - duplicate mute rows, duplicate director action logs, duplicate director warning alerts, repeated trust penalties і repeated heatmap updates зменшені в покритих flows.
- **Цільові тести** - додано helper і route coverage для repeated mute claims, rollback on action-log failure, stale `mute_both` taps і duplicate director warning taps.

---

## v0.45.2 - Цілісність Guardian director DM provisioning (2026-05-11)

### Guardian DM provisioning [codex]
- **Атомарний director DM** - Guardian/director DM creation використовує один transactional helper замість окремих check-then-insert paths.
- **Детерміноване повторне використання** - provisioning повторно використовує stable `dm-guardian-director` slug і зберігає legacy DM channels, які вже з'єднують Guardian і director.
- **Атомарний membership** - Guardian і director membership initialization комітиться в тій самій transaction, що й channel provisioning, з rollback on member setup failure.
- **Цільові тести** - додано deterministic coverage для repeated provisioning, legacy DM reuse, slug-shell repair і rollback behavior.

---

## v0.45.1 - Сумісність Guardian phase3 schema (2026-05-11)

### Guardian schema compatibility [codex]
- **Вирівнювання phase3** - Guardian service queries використовують column names, визначені phase3 migrations для mood, health, heatmap, weekly reports, escalation і trust scores.
- **Міграція сумісності** - додано guarded schema support для `guardian_trust_history` і `guardian_escalation_config.updated_at` без видалення чи переписування production data.
- **Фікс резервного health path** - Guardian health fallback читає current health з `guardian_channel_health`, а history з `guardian_health_history`.
- **Цільовий guardrail** - додано static Guardian phase3 schema compatibility test, щоб stale phantom-column patterns ловились у fast unit baseline.

---

## v0.45.0 - Старт релізної лінії 0.45 (2026-05-11)

### Політика версій [codex]
- **Нова релізна лінія** - Event Genix використовує `0.45.x` як активну version line.
- **Канонічне джерело** - `package.json` залишається version source of truth, а version-sync переносить реліз у UI labels, cache-bust tags і service-worker cache names.
- **Майбутні мініоновлення** - наступні releases мають піднімати тільки patch: `0.45.1`, `0.45.2`, `0.45.3` тощо до наступного explicit version-policy transition.
- **Історичні лінії** - `0.44.x` і старші changelog entries лишаються historical references, а не active release markers.

---

## v0.44.17 - Booking and room chat provisioning integrity (2026-05-11)

### Chat channel provisioning [codex]
- **Atomic booking channels** - booking-linked chat channel provisioning now uses one transactional helper and deterministic slug conflict handling.
- **Atomic room channels** - room/line channel initialization now uses the same duplicate-safe provisioning pattern instead of check-then-insert.
- **Unique support** - added guarded partial unique index migration for active booking and room channels when production data is already duplicate-free.
- **Membership initialization** - newly provisioned booking/room channels initialize creator membership in the same transaction as channel creation.
- **Focused tests** - added coverage for repeated booking provisioning, deterministic slug conflict reuse, repeated room init, and membership initialization.

---

## v0.44.16 - Chat poll transactional writes (2026-05-11)

### Chat polls [codex]
- **Transactional poll creation** - poll message and `chat_polls` rows now commit or roll back together.
- **Locked vote updates** - voting now locks the poll row with `FOR UPDATE` before delete/insert/recount/update work.
- **Recount safety** - single-choice vote replacement and option vote counts are recalculated and stored inside the same transaction.
- **Rollback coverage** - focused tests prove poll creation rollback and vote replacement rollback do not leave split message/poll or vote/count state.

---

## v0.44.15 - Scheduled chat dispatch atomic claim (2026-05-11)

### Scheduled chat messages [codex]
- **Atomic claim** - due scheduled chat messages are now claimed with a transactional `FOR UPDATE SKIP LOCKED` update before dispatch.
- **Duplicate-send safety** - concurrent scheduler workers skip already claimed rows instead of selecting and sending the same message twice.
- **Failure semantics** - DB claim failures roll back so messages can retry; websocket broadcast failures after claim leave the message visible in DB and are not retried to avoid duplicate sends.
- **Focused tests** - added deterministic coverage for successful claim/broadcast, claim rollback, and post-claim broadcast failure behavior.

---

## v0.44.14 - Chat reminder idempotency (2026-05-11)

### Chat reminders [codex]
- **Stable source identity** - reminder-created tasks now use a deterministic `chat_reminder` `source_id` based on message, user, and canonical reminder time.
- **Duplicate-safe reminders** - repeating the same reminder request reuses the active task instead of creating a second task.
- **Transactional write path** - reminder task creation and task log creation now run in one DB transaction with an advisory lock.
- **No ambiguous fallback** - the old Kleshnya/direct-insert fallback path was removed for chat reminders, so partial failures roll back instead of creating duplicate follow-up work.
- **Focused tests** - added coverage for duplicate reminders, distinct reminder times, and rollback after simulated partial failure.

---

## v0.44.13 - Chat task authz and duplicate-safe creation (2026-05-11)

### Chat tasks [codex]
- **Update authorization** - chat-task status changes now require the assignee, creator, or an elevated chat-task manager role (`creator`, `director`, `admin`, `senior_manager`).
- **No broad task mutation** - unrelated authenticated users no longer update `chat_tasks` by id alone.
- **Duplicate-safe message tasks** - repeated task creation from the same chat message, title, creator, and assignee returns the existing active task instead of creating a duplicate.
- **Scoped repeatability** - channel-only tasks remain repeatable so legitimate recurring operational tasks are not blocked by title alone.
- **Focused tests** - added unit coverage for allow/deny update paths, elevated-role updates, duplicate message-task creation, and repeatable channel-only tasks.

---

## v0.44.12 - Guardian RBAC hardening for control routes (2026-05-11)

### Guardian authz [codex]
- **Exact-role guards** - Guardian admin/control routes now use explicit `creator` / `director` / `admin` role sets instead of generic authentication or legacy role expansion.
- **Owner-only controls** - channel Guardian toggles are limited to `creator` and `director`, while emergency stop is limited to `creator`.
- **Mute safety** - regular users can only see and clear their own active mute; Guardian admins can still view and manage all active mutes.
- **Command context** - `/api/guardian/command` now passes the authenticated user identity and exact admin flag into the Guardian command handler.
- **Focused tests** - added Guardian RBAC coverage for non-admin denial, admin allow, owner-only controls, self-unmute behavior, and command identity propagation.

---

## v0.44.11 - Chat upload durability and file safety (2026-05-11)

### Chat uploads [codex]
- **Durable storage path** - new chat uploads now prefer Supabase Storage bucket `chat-uploads` and store explicit provider/bucket/key/url metadata on the chat message.
- **Legacy fallback** - if Supabase is not configured or temporarily unavailable, uploads fall back to the existing `/uploads/chat` path so current chat attachment behavior remains usable.
- **File safety policy** - upload validation now rejects SVG and extension/MIME mismatches before storage or message creation.
- **Cleanup coverage** - deleting a chat message now removes the Supabase object when available, while preserving legacy local-file cleanup.
- **Focused tests** - added storage and route tests for Supabase metadata, local fallback, SVG rejection, MIME mismatch rejection, member upload success, and non-member denial.

---

## v0.44.10 - Chat poll authz and realtime broadcast fix (2026-05-11)

### Chat polls [codex]
- **Poll broadcast contract** - poll create/vote/close paths now call `broadcastToChannel(channelId, eventType, payload)` with explicit `chat:message`, `chat:poll-update`, and `chat:poll-closed` events.
- **Poll create realtime** - new poll messages are broadcast with the same `chat:message` contract as regular chat messages and use mapped message fields.
- **Poll authz coverage** - added focused tests for poll create, vote, results visibility, close, non-member denial, and realtime payload shape.
- **Client event bridge** - `js/ws.js` now forwards poll update/close events through the existing `ws:chat` channel for chat listeners.

---

## v0.44.9 - Root media cleanup and landing-page redirects (2026-05-11)

### Static asset cleanup [codex]
- **Duplicate root media removed** - exact duplicate banner/branding PNGs were removed from repo root; canonical copies remain under `images/banners/` and `images/branding/`.
- **Loose HTML resolved** - `sales-deck.html` now lives under `landing/sales-deck.html`, matching the existing landing manager guide pattern.
- **Legacy URL compatibility** - `/manager-guide`, `/manager-guide.html`, `/sales-deck`, and `/sales-deck.html` now 302 to canonical `landing/` pages instead of depending on loose root files.
- **Cleanup coverage** - added `tests/static-cleanup.test.js` and wired it into `test:unit` to catch duplicate root media returning or landing guide/deck routes drifting.

---

## v0.44.8 - Historical docs archive and static doc guard (2026-05-11)

### Docs/static exposure hardening [codex]
- **Historical archive** - moved stale Claude/OpenClaw handoff docs into `docs/archive/` and marked them as non-authoritative history.
- **Current docs clarified** - `README.md` and `AGENTS.md` now point to active sources of truth first and label archived docs as context only.
- **Static doc guard** - root static serving now blocks direct public access to root/archive `.md` and `.txt` docs while leaving intended HTML/assets and upload-style paths available.
- **Focused coverage** - added `tests/static-doc-guard.test.js` to prove README/archive docs and root `.txt` proofs are not publicly served through broad static middleware.

---

## v0.44.7 - Chat render safety tests and URL guards (2026-05-11)

### Chat render safety [codex]
- **Render test harness** - added focused jsdom coverage for `js/chat-page.js` message rendering helpers without initializing the full chat app.
- **Plain text and links** - tests now cover escaping for core message text, markdown/link formatting, and injected tag payloads.
- **Bot content** - tests lock down the limited safe bot tags while keeping injected HTML escaped.
- **File and preview surfaces** - attachment names, unsafe attachment URLs, and link-preview metadata now have explicit XSS regression coverage.
- **Attribute safety** - chat escaping now also encodes quotes, preventing user text from breaking out of HTML attributes.
- **URL guard** - file, GIF, voice, and link-preview renderers now strip unsafe non-http/non-relative URLs such as `javascript:`.

---

## v0.44.6 - Report-bot submit transaction and idempotency (2026-05-11)

### Finance/report integrity [codex]
- **Transactional submit** - `POST /api/report-bot/submit` now writes the submission queue row, finance transaction, and legacy report row in one DB transaction.
- **Duplicate guard** - submit uses a durable idempotency key from explicit request/raw payload IDs, with a stable payload fallback for repeat deliveries.
- **Rollback safety** - if the legacy report write fails after the finance write, the whole submit is rolled back instead of leaving split finance/report state.
- **Kyiv date** - the submit path now uses an explicit request date or Europe/Kyiv today instead of UTC-only `toISOString()` day slicing.
- **Focused coverage** - added tests for success, duplicate submit, and partial failure rollback.

---

## v0.44.5 - Atomic linked booking move/resize/shift (2026-05-11)

### Booking integrity [codex]
- **Atomic linked endpoint** - added `POST /api/bookings/:id/linked-atomic` so main + linked timeline updates commit together or roll back together.
- **Timeline drag/resize** - drag, cross-line move, resize, and their undo paths now use the atomic server path instead of serial linked `PUT`s.
- **Time shift undo/redo** - booking time shift, undo shift, and redo shift now update linked bookings in one bounded transaction.
- **Conflict rollback** - server-side conflict checks validate main and linked targets before any update, preventing partial linked-booking moves.
- **Focused coverage** - added self-contained tests for success, linked conflict rollback, and incomplete linked payload rejection.

---

## v0.44.4 - Route guard hardening for designs, music, reports, and chat (2026-05-11)

### Authz [codex]
- **Designs API guard** - `routes/designs.js` now requires the same manager-up/art-director/marketer access used by the design/art pages.
- **Music API guard** - `routes/music.js` now requires sound-page access instead of accepting any authenticated role.
- **Reports API guard** - `routes/reports.js` now matches the reports page matrix: creator/director/vice-director/senior-manager/accountant only.
- **Chat API guard** - `routes/chat.js` now blocks waiter-level users at the API boundary, aligned with `/chat` page access.
- **Focused coverage** - route smoke now covers allow/deny cases for designs, music, reports, and the actual chat router.

---

## v0.44.3 - Access source-of-truth and sidebar drift guard (2026-05-11)

### Access/Auth [codex]
- **Access drift check** - added `npm run check:access` and wired it into `npm test` to compare backend `PAGE_ACCESS`, frontend `PAGE_ACCESS`, sidebar access keys, and role metadata.
- **Unknown page deny** - frontend `canAccessPage()` now rejects unknown routes instead of allowing them by default, while normalizing hash/page aliases safely.
- **Sidebar reconciliation** - `/sales-funnel` and `/leads` share the same lead access; tasks/chat/Помічник/Afisha/Certificates no longer use broad sidebar `all` access where waiter should not see them.
- **Security role metadata** - added `security` to role permissions/departments/default widgets and shared role UI metadata.
- **Focused coverage** - route smoke checks security role exposure, `/sales-funnel` alias parity, and waiter exclusion from task page access.

---

## v0.44.2 - Dashboard auth and version-sync guardrails (2026-05-11)

### Dashboard/Auth [codex]
- **Analytics access** - `/api/analytics` now uses manager-up access, aligned with frontend/sidebar page access.
- **Widget backend guard** - `/api/dashboard/widgets/:type` enforces server-side role checks for sensitive widgets, and saved dashboard config filters unauthorized widgets.
- **Version sync guard** - `scripts/version-sync.js` checks dashboard first-screen version/changelog labels so dashboard-specific stale markers are caught.
- **Focused coverage** - route smoke covers analytics manager-up access and sensitive widget 403s; UI smoke checks dashboard labels against `package.json`.

---

## v0.44.1 - Sound storage pilot on Supabase Storage (2026-05-11)

### Storage [codex]
- **Manual sound uploads** - `/api/music/library/upload` now attempts to store new manual audio files in Supabase Storage under the `audio-library` bucket instead of relying first on Railway-local `uploads/sounds`.
- **Legacy fallback** - if Supabase is not configured or upload fails, the route falls back to the existing local `/uploads/sounds` behavior so operators are not blocked during rollout.
- **Explicit storage metadata** - added nullable `sounds.storage_provider`, `storage_bucket`, `storage_key`, `storage_url`, and `storage_migrated_at` fields for backfill-safe tracking and remote delete cleanup.
- **Delete cleanup** - sound deletion now removes Supabase objects when a storage key exists and still removes legacy local files for old records.
- **Focused coverage** - added `tests/audio-storage.test.js` and wired it into `npm run test:unit` / CI.
- **First screen** - updated the login version marker and "Що нового" entry for the sound storage pilot.

---

## v0.44.0 - Versioning convention transition to 0.44.x (2026-05-11)

### Version policy [codex]
- **Canonical version reset** - `package.json` now starts the active release train at `0.44.0`; `package-lock.json`, visible UI markers, asset cache-bust strings, service-worker cache names, and `/api/version` derive from that source.
- **Mini-update rule** - future small releases on this train must increment patch as `0.44.1`, `0.44.2`, `0.44.3`, and so on. Do not return to `43.x.x` or jump to `44.x.x` without an explicit version-policy task.
- **History preserved** - existing `v43.*` changelog entries, code comments, and migration notes remain historical references to earlier CRM work; they are not the active version source.
- **Version-sync discipline** - `scripts/version-sync.js` continues to enforce the single source of truth from `package.json` across package-lock, HTML asset tags, first-screen labels, latest changelog marker, service-worker cache names, and inline asset refs.
- **First screen** - updated the login version marker and "Що нового" entry for the new `0.44.x` line.

---

## v43.20.0 - Service Worker privacy cache and offline replay guardrails (2026-05-11)

### Client safety [codex]
- **API cache allowlist** - Service Worker now caches only public non-user-specific `/api/version` and `/api/status/public` GET responses; authenticated or sensitive API GETs are network-only.
- **Sensitive CRM exclusions** - finance, chat, HR, customers, reports, dashboard, analytics, leads, staff, tasks, bookings, warehouse, settings, auth-adjacent, and bot endpoints are explicitly classified as sensitive.
- **Logout cache clearing** - logout/token invalidation now clears `event-genix-api-*` caches and asks the Service Worker to clear private API caches plus the offline mutation DB.
- **Offline replay boundary** - generic offline mutation replay is disabled by default until a route is explicitly reviewed and allowlisted; private mutation bodies/auth headers are not queued broadly.
- **Focused coverage** - added `tests/service-worker-policy.test.js` and wired it into `npm run test:unit` / CI.
- **First screen** - updated the login version marker and "Що нового" entry for the Service Worker privacy cache release.

---

## v43.19.0 - Telegram callback idempotency and keyboard cleanup (2026-05-11)

### Bot flow safety [codex]
- **Callback classification** - audited Telegram callback families and treated animator, certificate use, task transitions, training approval/rejection, review rating, and auto-order decisions as single-use; kept `pulse:*` multi-use for shared group mood collection.
- **Keyboard cleanup** - completed single-use callbacks now clear or rewrite inline keyboards after success, and stale callbacks clear old buttons where the message can still be edited.
- **Task stale guard** - new task inline buttons include expected status tokens (`todo` / `in_progress`) so stale buttons from older task states cannot trigger conflicting transitions.
- **Decision idempotency** - training, review, and auto-order callbacks now check pending/duplicate state before creating side effects or sending contractor notifications.
- **Focused tests** - added `tests/telegram-callbacks.test.js` and wired it into `npm run test:unit` / CI to cover stale/double taps and the intentionally multi-use pulse path.
- **First screen** - updated the login version marker and "Що нового" entry for the Telegram callback safety release.

---

## v43.18.0 - CI baseline guardrails for push and pull requests (2026-05-11)

### Verification and CI [codex]
- **GitHub Actions baseline** - added `.github/workflows/ci.yml` for push and pull request verification.
- **Runtime alignment** - CI uses Node 22 from `.node-version`, aligns npm to `10.9.8`, installs with `npm ci`, and runs `npm test`.
- **Safety checks automated** - the CI gate now covers runtime drift, version sync, migration duplicate/gap/governance checks, JavaScript syntax, unit/auth-boundary smoke, and static UI smoke.
- **Honest scope documented** - README and AGENTS now state that CI does not replace PostgreSQL integration tests, live Railway health checks, browser automation, or manual UX/accessibility review.
- **First screen** - updated the login version marker and "Що нового" entry for the CI baseline release.

---

## v43.17.0 - DB migration governance and static migration guard (2026-05-11)

### Database governance [codex]
- **Migration check** - added `npm run check:migrations` to detect new duplicate migration numbers, undocumented numbering gaps, invalid future migration filenames, and missing safety metadata.
- **Governance rules** - added `DB_MIGRATION_GOVERNANCE.md` to document the current `initDatabase()` vs `db/migrations/` split and the intended source of truth for future schema changes.
- **Legacy baseline** - documented the existing duplicate `026_*` migration number, known numbering gaps, and risky legacy data/date/user migrations as controlled debt instead of a pattern to copy.
- **Verification baseline** - `npm test` now includes the migration governance check so future Codex work cannot quietly add unsafe schema/data migrations.
- **First screen** - updated the login version marker and "Що нового" entry for the database governance release.

---

## v43.16.0 - Credential seed guard and safe user bootstrap (2026-05-11)

### Security [codex]
- **Default credentials removed** - startup no longer seeds shared user passwords from code or silently resets existing `users.password_hash` values.
- **Explicit bootstrap** - fresh environments must use `BOOTSTRAP_CREATOR_*` env vars for the first creator; local-only dev seed requires `ALLOW_DEV_USER_SEED=true` plus `DEV_SEED_ADMIN_PASSWORD`.
- **Legacy seed guardrails** - v12.5 user upsert, Anna/Artem, and OpenClaw seed paths are marked without password updates; OpenClaw JWT login now requires `OPENCLAW_BOOTSTRAP_PASSWORD`.
- **Docs/tests cleaned** - removed published shared credentials from repo docs and examples; live API tests now require explicit `TEST_USER` and `TEST_PASS`.
- **Focused coverage** - added `tests/user-seed-policy.test.js` to lock the production/dev seed boundary.

---

## v43.15.0 - Auth boundary fix for public landing and query tokens (2026-05-11)

### Security and behavior [codex]
- **Public landing access** - `POST /api/landing/demo-request` and the active landing form path `POST /api/leads/landing` now bypass JWT auth intentionally instead of being blocked by the global API guard.
- **Query-token hardening** - global `?token=` JWT fallback is restricted to the approved graduation proposal/export `window.open` endpoints instead of every protected API route.
- **Boundary tests** - added focused tests for public endpoints, protected no-auth rejection, generic query-token rejection, allowed query-token paths, and report-bot/Telegram missing or wrong secrets.
- **Abuse guard** - added a burst limiter for public landing/demo lead submissions.

---

## v43.14.0 - Node 22 runtime and Railway baseline (2026-05-11)

### Platform baseline [codex]
- **Canonical runtime** - pinned Event Genix to Node `22.x` and npm `10.x` through `package.json`, `.nvmrc`, and `.node-version`.
- **Railway alignment** - documented that Railway/Nixpacks must use Node 22 and that any fallback to Node 18 or EBADENGINE warnings is a deploy-blocking runtime drift.
- **Verification guard** - added `npm run check:runtime` and made `npm test` run it before version, syntax, unit, and UI checks.
- **First screen** - updated the login version marker and "Що нового" entry for the runtime baseline release.

---

## v43.13.0 - Codex stabilization pack (2026-05-11)

### Stabilization [codex]
- **Repo rules** - added `AGENTS.md` and refreshed `README.md` with Codex-ready rules for dirty worktrees, deploy boundaries, version/changelog discipline, verification, and shared UI/access patterns.
- **Version source of truth** - aligned package, package-lock, visible UI version, cache-bust tags, service-worker cache names, changelog markers, and inline asset refs around `package.json`.
- **Verification baseline** - made `npm test` an honest fast local baseline and split live server/database checks into `test:api` and `test:integration`.
- **Telegram callbacks** - isolated and committed the single-use inline callback fix for contractor and report-bot choices.

---

## v43.12.0 - Codex version source-of-truth sync (2026-05-11)

### Versioning [codex]
- **Canonical version** - `package.json` and `package-lock.json` now carry `43.12.0`, matching the visible first-screen Codex test marker.
- **Cache/version sync** - asset `?v=` tags, service-worker cache names, and the public catalog CSS reference are aligned through `scripts/version-sync.js`.
- **Guardrail** - `scripts/version-sync.js` now checks package-lock, latest changelog markers, `sw.js`, standalone pages, and the inline catalog asset reference in `server.js`.

### Verification [codex]
- **Package scripts** - `npm test` now runs the fast local verification baseline via `npm run verify`.
- **Honest scopes** - unit/UI/version/syntax checks are separate from server+DB API and integration suites.
- **Syntax guard** - `scripts/check-js-syntax.js` adds a dependency-free Node parser check for repository JavaScript.

---

## v38.17.0 — Leaderboard + Daily Badge + Tasks Preview (2026-03-26)

### Profile Leaderboard [claude-code]
- **Seed data** — рейтинг заповнений для всіх юзерів (XP, coins, level)
- **Daily badge pulse** — CSS `badge-pulse` анімація на табі щоденних завдань
- **Tasks preview** — блок попереднього перегляду завдань на профілі
- **Migration 129 fixes** — ALTER TABLE daily_quests ADD all columns (IF NOT EXISTS)

---

## v38.16.0 — Profile Redesign: Hero, Inventory, Shop, Quests (2026-03-26)

### Profile Page [claude-code]
- **Hero glassmorphism** — картка профілю зі скляним ефектом, контрастні шрифти
- **Inventory** — RPG ячейки замінено на картковий вигляд (card layout)
- **Shop seed** — 17 items: кава 200₴, піца 800₴ + 6 їжі + 9 косметики
- **Quests seed** — 8 щоденних квестів у daily_quests таблиці
- **Кімната прибрано** — таб "Кімната" видалено з profile page

---

## v38.15.0 — Match-3 Enhanced Special Effects + Profile (2026-03-26)

### Match-3 Game [claude-code]
- **Спецефекти** — bomb, lightning, cross, rainbow анімації по центру клітинки
- **Клітинки** — фіолетовий тінт на білому фоні (light mode fix)
- **Profile API** — `/profile/:userId` повертає JSON замість redirect

---

## v38.14.0 — Каталоги: Image Picker + Premium Viewer (2026-03-26)

### Catalog UX [claude-code]
- **Image Picker** — 4 варіанти: AI генерація, upload, галерея, URL (замість prompt())
- **Premium Catalog Viewer** — 7 пакетів випускних з повноекранним переглядом
- **openCatalog fix** — виправлено infinite recursion (Maximum call stack)
- **submitCreateCatalog** — додано відсутню функцію створення каталогу
- **Graduation seed** — inline button styles + graduation catalog seed data

---

## v38.13.0 — Catalog Pages + Supabase Storage (2026-03-26)

### Catalog Pages [claude-code]
- **catalog_pages таблиця** — Migration 127: HTML-сторінки для каталогу (обкладинка + товарні)
- **API** — GET/POST/PUT/DELETE endpoints для сторінок каталогу
- **Fullscreen viewer** — ← → навігація, Escape закриття
- **Створення сторінок** — "+ Обкладинка" та "+ Сторінка" кнопки
- **Вставка зображень** — кнопка "🖼 Зображення" на кожній сторінці
- **Редагування** — назва, опис, ціна через "✏️ Редагувати"

### Supabase Storage [claude-code]
- **Постійне збереження** — AI зображення завантажуються в Supabase Storage (bucket: catalog-images)
- **Транслітерація filename** — UA→ASCII для Supabase (фікс "Invalid key" помилки)
- **Fallback** — якщо Supabase недоступний, зберігає Kie.ai temp URL
- **CSP** — дозволено img-src для *.supabase.co та *.aiquickdraw.com

### AI Image Generation [claude-code]
- **nano-banana-2** — оновлено модель (google/nano-banana → nano-banana-2)
- **Role access** — всі catalog endpoints дозволяють creator/director/art_director/manager
- **Error feedback** — toast на старті/успіху/помилці генерації

### CSS Architecture [claude-code]
- **css/designs.css** — 342 рядків витягнуто з designs.html
- **css/catalog.css** — 483 рядків + стилі catalog pages
- **designs.html** — 1541 → 725 рядків (-53%)

---

## v38.11.0 — Systematic Frontend Improvements (2026-03-26)

### AI Image Generation [claude-code]
- **Kie.ai prompt fix** — transliterate Ukrainian→English (Gemini rejected cyrillic)
- **Fallback save** — if apply-image fails, saves via PATCH directly
- **Error feedback** — toast on start/success/failure

### Centralized Notifications [claude-code]
- **js/notification.js** — single showNotification() with aria-live, replaces 9 duplicates
- **alert() → toast** — 16 alert() calls replaced across hr, sound, settings, warehouse

---

## v38.10.0 — Sidebar Active Fix + Catalog Improvements (2026-03-26)

### Sidebar [claude-code]
- **Active state rewritten** — exact match only, no startsWith. Fixes double-active (/art + /art-director, /designs + /designs#catalogs)
- **Hash logic** — hash items active only when URL hash matches; default first hash only when no non-hash sibling
- **Scroll restore** — saves/restores scroll position between page navigations

### Catalogs [claude-code]
- **"+ Створити каталог" button** — modal with name, emoji, description; POSTs to /api/catalogs/definitions
- **Viewer overflow fixed** — removed max-height:80vh that cut off catalog page content
- **Hash tab switching** — /designs#catalogs now switches tab BEFORE async loads
- **Null checks** — apiFetch responses checked before .json() (12 places fixed)
- **UI split** — "Готові каталоги" and "Каталоги товарів" sections
- **Price bug** — totalPerChild was string concatenation; fixed with parseFloat

### Match-3 Game [claude-code]
- **Special indicators** — 10→16px, dark bg, hover tooltip with label + description
- **Pause button** — ⏸ in header, overlay with blur, resume button
- **Bonus banner** — animated slide-across on special activation

---

## v38.9.0 — Stability & Page Fixes (2026-03-25)

### Critical Fixes [claude-code]
- **art-director-page.js, center-page.js, demo-page.js** — відновлено оригінальні файли (помилковий "fix" ламав initPage функції → сторінки Арт, Центр, Демо не працювали)
- **copilot-page.js** — додано `showAddInteractionForm` і `loadTrackerAlerts` до window.CopilotPage (кнопки в Менеджер AI не реагували)
- **designs.html** — видалено misplaced `<script>` тег всередині JS функції + fix openCatalog() race condition
- **server.js** — `/designs` тепер показує designs.html напряму (було 302 redirect на /art)

### Sidebar & CSS [claude-code]
- **Центр цін → Центр керування** 🎛️ (перейменовано в sidebar)
- **embed-mode CSS** — ховає sidebar/header в iframe (фікс дублювання sidebar в Звіти tab)

### Tooling [claude-code]
- **tests/ui-check.js** — 106 автоматичних DOM/JS перевірок через jsdom (синтаксис, структура, exports)
- **jsdom** додано як dev dependency

---

## v38.8.0 — Авто-каталог Fix + Dashboard Widget (2026-03-25)

### Catalog Fixes [claude-code]
- **Шрифти зменшено** — cover icon 56→40px, year 28→22px, title clamp(20,4vw,28)px, price clamp(18,3vw,24)px, h3 16→15px
- **Viewer overflow** — catalog-pages-container max-height: 80vh
- **Dashboard widget** — каталоги повернено до списку доступних dashboard віджетів

---

## v38.7.0 — Sidebar: Арт + Дизайнер Split (2026-03-25)

### Sidebar Restructure [claude-code]
- **Група "Продукт" розділена** на два окремих блоки:
  - **🎨 Арт** — Програми, Арт директор, Випускний, Афіша, Сертифікати (все пов'язане з розважальними програмами)
  - **📐 Дизайнер** — Дизайн-борд, Каталоги, Стайлгайд (все по дизайну та візуалу)
- **Каталоги переміщено** з `/art` → `/designs#catalogs` (де живе авто-каталог viewer з AI генерацією та PDF експортом)
- **data-page-group** оновлено: art-director/programs/graduation → `"art"`, designer/designs → `"designer"`
- **CSS page transitions** — окремі анімації для груп art (rotateIn) та designer (fadeScale)

---

## v38.6.0 — Business Logic Hardening + Full System Audit (2026-03-25)

### Booking System Hardening [claude-code]
- **Status whitelist** — тільки `confirmed`, `preliminary`, `cancelled` приймаються; будь-який інший рядок ігнорується
- **Cancelled→confirmed blocked** — скасоване бронювання не можна відновити, потрібно створити нове
- **Midnight span prevention** — бронювання не може перевищувати 00:00 (time + duration > 1440 хв = помилка)
- **mapBookingRow on payment** — `PATCH /:id/payment` тепер повертає camelCase замість raw snake_case

### Wallet Race Conditions Fixed [claude-code]
- **Transfer deadlock prevention** — lock обох wallets в порядку ID (менший перший) при переказах
- **Daily login idempotency** — подвійний guard: перевірка `last_login_reward` + перевірка `coin_transactions` за сьогодні

### Database Migration 126 [claude-code]
- **5 нових indexes** — `leads(assigned_to)`, `leads(status, created_at)`, `bookings(program_id)`, `finance_transactions(category_id)`, `staff(hire_date)`
- **FK ON DELETE** — `bookings.customer_id` і `discount_usage.customer_id` → `ON DELETE SET NULL`

### Frontend Fixes [claude-code]
- **setInterval cleanup** — agents-panel, alerts, status-page: `clearInterval` on `beforeunload`
- **innerHTML XSS** — escaped user data в hr-page, center-page, chat-page
- **CSS iOS zoom** — 3 inputs з font-size 13px → 16px (controls.css: timeline-search, night-settings, template-select)

### Code Cleanup [claude-code]
- **3 unused imports** видалено — `requireRole` з decisions.js, designs.js, points.js

### Testing [claude-code]
- **+11 нових тестів** (424 → 435): wallet (2), shop (3), minigame (3), booking validation (3)

### System Audit Findings (documented for next session) [claude-code]
- **29 route files** без dedicated тестів (wallet, shop, minigame, personal-accounts, recurring, chat та інші)
- **Server startup**: DATABASE_URL missing = тільки warning (має бути fatal)
- **Graceful shutdown**: не чекає in-flight requests перед закриттям DB pool
- **Stale data on reconnect**: після тривалого offline клієнт бачить суміш старих і нових даних
- **Response format inconsistency**: 4 формати pagination, 3 формати errors across routes

---

## v38.5.0 — Deep QA Sweep (2026-03-25)

### Security Hardening [claude-code]
- **Hardcoded API ключі видалено** — KIE.ai (2 місця) + OpenRouter: graceful 503 якщо env var не задано
- **SQL injection fix** — `routes/backup.js`: table name interpolation → `safeTableName()` з allowlist
- **Telegram HTML injection** — `esc()` для всіх user-controlled полів у notification templates (notes, names, descriptions)
- **IDOR fix** — `PATCH /bookings/:id/payment` додано `requireAction('edit_booking')`
- **innerHTML XSS** — escaped user data в hr-page, center-page, chat-page (4 місця)
- **10 missing PAGE_ACCESS** — додано auth записи для art-director, designs, game, leads, profile, quiz, report-agent, reports, room, shop

### Race Conditions Fixed [claude-code]
- **awardXP** — atomic SQL `xp = xp + $1` замість read-modify-write
- **purchaseShopItem** — `FOR UPDATE` lock на shop_items запобігає oversell
- **updateStreak** — atomic UPSERT з CASE логікою, без read-modify-write

### Performance [claude-code]
- **N+1 achievements** — 500+ queries → 9 parallel batch queries (Promise.all)
- **N+1 bulk messaging** — 1000 INSERTs → single batch INSERT
- **N+1 meeting action items** — loop INSERT → multi-row INSERT
- **52+ unbounded SELECT*** — додано LIMIT на всі queries без обмежень
- **Pagination caps** — chat limit=200, summary limit=100, days=365

### Frontend QA [claude-code]
- **401 blank screen fix** — 13 сторінок: `loginOverlay` → `window.location.href='/'`
- **434 buttons** — додано `type="button"` (запобігає accidental form submit)
- **Sidebar hash nav** — нормалізація pathname для in-page tab switching
- **Dark mode flash** — prevention script на 20 сторінках
- **Null-safe getElementById** — demo-page, art-director-page tab switching
- **setInterval leaks** — agents-panel, alerts, status-page: clearInterval on beforeunload
- **CSS iOS zoom** — 3 inputs з font-size 13px → 16px

### Timezone DST Fixes [claude-code]
- **music-delivery.js** — hardcoded UTC+3 → DST-aware `toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })`
- **agentTracker.js** — hardcoded +02:00 → dynamic DST offset
- **8 toLocaleDateString()** — додано `timeZone: 'Europe/Kyiv'` (graduation, certificates, finance, bot, templates)

### Memory & Stability [claude-code]
- **Guardian.js** — periodic cleanup (5 хв) для 9 in-memory caches (запобігає ~20MB leak за 7 днів)
- **contextCache.js** — periodic cleanup (10 хв) + hard cap 500 entries
- **WebSocket heartbeat** — snapshot iteration запобігає iterator invalidation; `_removeClient()` для повного cleanup
- **unhandledRejection** — тепер `process.exit(1)` (запобігає corrupted state)
- **API 404** — JSON `{ error: 'Not found' }` замість HTML для `/api/*` routes

### Database [claude-code]
- **Migration 126** — 5 missing indexes (leads, bookings, finance, staff) + ON DELETE SET NULL для bookings.customer_id, discount_usage.customer_id

### Telegram [claude-code]
- **Message truncation** — `truncate()` helper для 4096 char Telegram limit
- **Silent catches** — 3 `.catch(() => {})` → logging (order notify, lead notify, chat ID reg)

### Testing [claude-code]
- **+78 нових тестів** (346 → 424): auth-refresh (15), sql-safety (13), decisions (11), vacancies (9), graduation (10), dashboard-widgets (10), our-fixes (10)

### Documentation [claude-code]
- **CHANGELOG.md** — відновлено 20+ пропущених версій (v35.1–v38.2)
- **PROJECT_PASSPORT.md** — v22.18 → v38.5, routes 61→74, services 30→41, CSS 17→22
- **SNAPSHOT.md** — оновлено architecture counts
- **Cache-bust** — `?v=38.5.0` на всіх 34 HTML сторінках
- **Accessibility** — aria-label на 11 inputs (analytics, customers, dashboard, art-director, chat, demo, center)

---

## v38.4.0 — Security & Reliability Hardening (2026-03-25)

### JWT Refresh Tokens [claude-code]
- **Refresh token rotation** — short-lived access tokens (15m) + long-lived refresh tokens (30d)
- **Replay detection** — reuse of revoked token automatically revokes ALL user sessions
- **Session management** — `/api/auth/sessions` endpoint to list active sessions
- **Logout** — `/api/auth/logout` revokes refresh token; `allDevices: true` revokes all
- **Backward compatible** — legacy 24h token still issued for existing clients
- **Auto-cleanup** — scheduler job removes expired/revoked tokens weekly

### Transactional Outbox [claude-code]
- **Outbox pattern** — `publishInTransaction()` writes events in the same DB transaction as business data
- **Outbox relay** — scheduler processes unpublished events every 5 seconds via `FOR UPDATE SKIP LOCKED`
- **Dual-write prevention** — eliminates risk of event loss when DB commits but event publish fails
- **Auto-cleanup** — published outbox events cleaned up after 7 days

### pg_stat_statements [claude-code]
- **Enabled** via migration — provides query performance statistics (planning time, execution time, calls)
- **Migration 125** — `refresh_tokens` table, `outbox_events` table, pg_stat_statements extension

### SQL Safety Utilities [claude-code]
- **`utils/sqlSafe.js`** — `safeOrderBy()`, `safeTableName()`, `safeSets()` helpers
- **Audit complete** — all 12+ dynamic SQL locations verified using allowlists (no actual injection vectors found)

---

## v38.3.0 — Operations Intelligence (2026-03-24)

### Exceptions Inbox [claude-code]
- **Новий dashboard віджет "Що потребує уваги"** — агрегує 6 типів операційних проблем:
  - 💥 Конфлікти кімнат (перекриття часу бронювань)
  - 🎭 Бронювання без аніматора
  - ⏰ Прострочена підготовка (event-задачі)
  - 😞 NPS детрактори (оцінка 1-2/5 без follow-up)
  - 🧹 Прибирання з перевищеним SLA
  - 🔴 Непідтверджені бронювання за <2 години до старту
- **Авто-додано** до дашбордів: creator, director, vice_director, senior_manager, manager, admin, reception

### Event Pipeline [claude-code]
- **Автоматичний lifecycle бронювання** через event bus:
  - `booking.t24` — за 24 години до події (нагадування + задача підготовки)
  - `booking.day_of` — в день події (чек-лист підготовки кімнати)
  - `booking.completed` — після завершення (тригер для прибирання)
- **booking_pipeline** таблиця — відстеження стадій кожного бронювання (idempotent)

### NPS Follow-Up Automation [claude-code]
- **Detractor follow-up** — при оцінці 1-2/5 автоматично:
  - Створюється high-priority задача менеджеру
  - Telegram-алерт директору
- **Promoter referral** — при оцінці 5/5 автоматично:
  - Telegram-повідомлення з пропозицією рекомендації
- Нові поля event_reviews: `nps_score`, `follow_up_status`, `follow_up_task_id`

### Cleaning Task Chain [claude-code]
- **cleaning_tasks** таблиця — автоматичне створення задач прибирання після завершення подій
- **SLA tracking** — дефолт 15 хвилин на прибирання, відстеження в exceptions inbox
- Прив'язка до кімнати та бронювання

### Event Bus Rules [claude-code]
- 5 нових default правил: `booking_t24_reminder`, `nps_detractor_followup`, `nps_promoter_referral`, `booking_cleaning_auto`, `booking_day_prep`
- Scheduler jobs: `checkEventPipeline` (5 хв), `checkNpsFollowUp` (hourly), `checkCleaningTasks` (5 хв)

---

## v38.2.0 — Тестовий деплой + Deep Research підготовка (2026-03-24)

### Research & Deploy [claude-code]
- **Deep Research** — підготовлено промпти для глибокого аналізу CRM (бізнес + технічний)
- **Тестовий деплой** — перевірка стабільності системи

---

## v38.1.0 — HR: Команда + Вакансії + Підбір персоналу (2026-03-22)

### Team Tab Fix [claude-code]
- **initTabs()** — null-safe panel lookup + loader object pattern
- **loadTeam()** — spinner, null-check для hrFetch, error states

### Roles Sync [claude-code]
- **ROLE_LABELS** — 7 → 15 ролей (+trampoline_instructor, waiter, bartender, cook, head_cook, director, vice_director, hr_manager)
- **teamRoleFilter** — optgroup структура (Керівництво/Аніматори/Кухня/Технічний)

### Vacancies Module [claude-code]
- **Migration 123** — `job_vacancies` + `job_applications` таблиці з індексами, тригер auto-update applications_count
- **routes/hr.js** — 8 нових ендпоінтів (vacancies CRUD, applications CRUD, hire з auto-staff creation)
- **hr.html** — новий таб "Вакансії" зі статус-фільтром, stat cards, канбан кандидатів

---

## v38.0.0 — Sound Module (2026-03-22)

### Sound Page [claude-code]
- **sound.html** — повний rewrite з 4 табами: Оголошення / Бібліотека / Плейлисти / Лог
- **Migration 122** — sounds.url column, extended category/type checks
- **routes/music.js** — POST /generate-tts (TTS), GET/POST/DELETE /library (file upload), GET/POST/DELETE /projects
- **js/sound-page.js** — логіка табів, API calls, модалки
- **css/sound.css** — Design System v4.0 токени, dark mode, мобільна адаптація

### v38.0.1 — Sidebar Fixes [claude-code]
- **Арт директор** — додано до окремої групи sidebar
- **Ukrainian labels** — локалізація sidebar меню

---

## v37.8.0 — Visual Polish (2026-03-22)

### UI Enhancement [claude-code]
- **Cards** — глибші тіні, hover-lift з border-glow
- **Buttons** — gradient backgrounds, glow-shadow, scale active
- **Inputs** — inset shadow, hover border, покращений focus ring
- **Login** — gradient кнопка, стильніші інпути, inner glow
- **Tooltip** — backdrop-blur, rounded 12px
- **Tabs/Filters** — gradient active, hover-lift
- **Dashboard** — widget hover-lift, stat-items gradient tint
- **Dark mode** — оновлено empty-state

---

## v37.7.0 — Page Transitions (2026-03-22)

### Animations [claude-code]
- **5 анімацій входу** — унікальна анімація для кожної групи sidebar (CRM, Управління, HR, Творче, Система)
- **Exit анімація** — 180ms fade-slide-down при навігації
- **prefers-reduced-motion** — вимикає всі переходи

---

## v37.6.0 — Sidebar Visual Upgrade (2026-03-22)

### Sidebar Redesign [claude-code]
- **Nav icons** — 28px rounded boxes з gray-50 background, colored on active
- **User card** — gradient card з border, shadow, 36px avatar
- **Active state** — gradient background + 4px glow indicator bar
- **Hover** — translateX(2px) slide animation
- **Custom scrollbar** — 4px thin (webkit + firefox)
- **Dark mode** — всі нові стилі адаптовано

---

## v37.5.0 — Cache Bust Fix (2026-03-22)

### Browser Cache [claude-code]
- **Проблема** — браузер кешував старі JS файли (config.js, sidebar.js) бо ?v= не змінився
- **Фікс** — оновлено ?v=37.5.0 на всіх 30 HTML сторінках

---

## v37.4.0 — Системний QA Чекап (2026-03-22)

### QA [claude-code]
- **Version bump** — 37.3.0 → 37.4.0
- **Changelog entry** — 13 пунктів всіх змін сесії
- **Cache-bust** — ?v=37.4.0 на всіх 30 HTML сторінках

---

## v37.3.0 — Sidebar Always Expanded (2026-03-22)

### UX Change [claude-code]
- **Collapse видалено** — display:none !important
- **Всі 5 груп відкриті** — defaultOpen: true (CRM, Управління, HR, Творче, Система)
- **localStorage очищено** — pzp_sidebar_collapsed + pzp_sidebar_groups removed on init

---

## v37.2.0 — HR Group in Sidebar (2026-03-22)

### Navigation [claude-code]
- **Нова 5-а група** — HR (🤝) з Графік, Команда, Кадри, Навчання
- **Навчання** — переміщено з CRM до HR групи
- **Управління** — залишено тільки бізнес-елементи (Клієнти, Ліди, Фінанси, Аналітика, Звіти, AI)

---

## v37.1.0 — Sidebar Responsive Fix (2026-03-22)

### Responsive [claude-code]
- **Root cause** — group labels з uppercase + letter-spacing:1.2px overflow 220px sidebar
- **layout.css** — letter-spacing 1.2→0.8px, text-overflow:ellipsis
- **Tablet (769-1023px)** — font 12px, group label 9px для 200px sidebar
- **Mobile (≤768px)** — accordion groups в collapsed off-canvas sidebar 280px

---

## v37.0.0 — UI Polish Bundle (2026-03-22)

### 7 Improvements [claude-code]
- **Profile** — null-safe getElementById для currentUser
- **Афіша** — 🎭 кнопка додана до timeline top-bar
- **Statistics** — приховано з dropdown menu
- **History** — видалено дублікат з dropdown (залишено тільки sidebar)
- **sound.html** — нова сторінка з Library/Projects/Upload табами
- **routes/sound-library.js** — CRUD API для звуків
- **designer.html** — нова сторінка з 5 табами (Catalogs, Guideline, Brand Book, Styleguide, Templates)

---

## v36.0.0 — Decision Screen (2026-03-22)

### Центр прийняття рішень [claude-code]
- **decisions.sql** — PostgreSQL таблиця з пріоритетами, джерелами, індексами
- **routes/decisions.js** — 4 ендпоінти: GET pending, POST create, PUT approve/reject/defer, GET history
- **js/decision-screen.js** — IIFE модуль з локальними утилітами, блокуючий overlay на Dashboard
- **css/decision-screen.css** — overlay z:99999, sticky header, card animations
- **Priority cards** — critical (red), important (yellow), normal (blue)
- **Dark mode** — повна підтримка

### v36.1.0 — Decision Screen for All Roles [claude-code]
- Зняте обмеження по ролях для /pending, /:id/:action, /history

### v36.2.0 — Seed Decisions [claude-code]
- **Migration 116** — 3 тестових рішення (critical/important/normal) для першого деплою

---

## v35.1.0–v35.11.0 — Sidebar Polish & Site Health (2026-03-22)

### Sidebar Improvements [claude-code]
- **v35.1.0** — чисті emoji іконки (прибрано gray badge box), додано /reports до Управління
- **v35.2.0** — compact nav-links (padding 10→7px, font 14→13px), smart defaultOpen (тільки активна група)
- **v35.3.0** — додано Каталоги до Творче групи, фікс user card onclick
- **v35.4.0** — видалено improvementFab (перекривав Помічника)
- **v35.5.0** — 🌙/☀️ theme toggle кнопка в sidebar

### API & Page Fixes [claude-code]
- **v35.6.0** — API bugfixes: copilot columns (updated_at→last_contact_at, full_name→name), warehouse route ordering
- **v35.7.0** — додано /copilot до PAGE_ACCESS в auth.js
- **v35.8.0** — unified sidebar на всіх 24 сторінках
- **v35.9.0** — фікс blank copilot page (auth flow broken — тепер робить свій apiVerifyToken)

### Site Health [claude-code]
- **v35.10.0** — CSS cache bust + Nunito font на всіх 27 сторінках
- **v35.11.0** — full site health fix: overlays, scripts, fonts, versions (0 remaining issues)

---

## v35.0.0 — Sidebar Full Rebuild (2026-03-22)

### Sidebar Accordion Groups [claude-code]
- **Accordion Navigation** — 4 групи (CRM, Управління, Творче, Система) з CSS grid-template-rows анімацією
- **Unified Nav** — однакове sidebar меню на всіх 24 сторінках замість різних hub-dropdown
- **Collapse Button** — `sidebarCollapseBtn` додано на всі 23 standalone сторінки
- **Nav Icons** — збільшено emoji розмір (15px → 17px collapsed), scale(1.08) анімація при hover

### Cross-Page Actions [claude-code]
- **Афіша/Сертифікати/Налаштування** — кнопки працюють з будь-якої сторінки через `?open=` auto-open
- **`sidebarOpen*` helpers** — якщо на таймлайні → модалка, якщо на іншій сторінці → redirect `/?open=`
- **`_checkAutoOpen()`** — app.js читає `?open=` параметр і відкриває панель після ініціалізації

### New Routes [claude-code]
- **`/afisha`** → redirect 302 → `/?open=afisha`
- **`/certificates`** → redirect 302 → `/?open=certificates`
- **`/designer`** → sendFile або redirect → `/art`
- **`/sound`** → sendFile або redirect → `/`
- **PAGE_ACCESS** — додано `/designer`, `/sound`, `/afisha`, `/certificates`

### Bugfixes (E1-E11) [claude-code]
- **E1** — `sidebar-group-inner { min-height: 0 }` для grid collapse анімації
- **E2/E6** — `#sidebarActions` приховано `display:none` (не видалено — app.js/auth.js мають обробники)
- **E3** — collapse button на всіх сторінках
- **E4/E5** — `showAfishaModal` / `openCertificatesPanel` graceful з redirect
- **E7** — `/staff` двічі → `noActive: true` на "Команді" запобігає подвійному підсвічуванню
- **E8** — collapsed sidebar: `.sidebar-group-items { display: none }`
- **E9** — спрощений onclick без зайвого `window.X` дублювання
- **E10** — collapsed nav-link padding override
- **E11** — `toggleGroup` додано в `return {}`

### Dark Mode [claude-code]
- Accordion стилі: border, hover, arrow, group icon, vertical track
- Nav icon active: `box-shadow: 0 2px 8px rgba(16,185,129,0.25)`

### Infrastructure [claude-code]
- **8 unclosed `<div>` tags** — виправлено в changelog секції index.html (v20.0.0 → v12.3.0)
- **346/346 тестів pass**, 0 fail
- **31 файл змінено**, 654 insertions, 310 deletions

---

## v32.0.0 — Premium Каталог Випускних (2026-03-16)
- **Premium Catalog Redesign** — повний редизайн каталогу випускних на рівні друкованих каталогів 2025 [claude-code]
- **Geometric Mosaic** — CSS полігональний фон з унікальною пастельною палітрою для кожного з 7 пакетів [claude-code]
- **Info Cards** — нова структура: "ВИПУСКНИЙ" label + назва великим текстом + іконки ⏱ тривалість / 👥 діти / ₴ ціна [claude-code]
- **Services Card** — кольоровий акцентний блок з переліком послуг UPPERCASE [claude-code]
- **Description Card** — детальні описи кожної послуги (catalog_description) з DB [claude-code]
- **Fullscreen Viewer** — immersive перегляд з sticky topbar, навігація ◀▶, Escape/Arrow/Swipe [claude-code]
- **7 Package Themes** — лавандовий (best-dj), золотий (super-party), блакитний (science), м'ятний (handmade), жовтий (pizza), червоний (squid-game), рожевий (neon) [claude-code]
- **Print A4** — 1 пакет = 1 сторінка, geometric mosaic зберігається при друку, компактна типографіка [claude-code]
- **Export** — повний каталог (обкладинка + 7 сторінок) з premium дизайном для друку/PDF [claude-code]
- **Share** — Web Share API + clipboard fallback для поширення пакету [claude-code]
- **DB Migration 086** — min_kids/max_kids для пакетів, catalog_description для послуг [claude-code]
- **automation.test.js fix** — 28 тестів виправлено: додано 'auto_complete' до valid task type filter [claude-code]
- **Version sync** — всі 360 cache-bust ?v= тегів синхронізовані [claude-code]
- **SNAPSHOT.md** — повне оновлення з v24.3 до v31.8 з актуальними метриками [claude-code]

## v30.3.0 — Пошук, Шаблони, Повтори (2026-03-14)
- **Пошук по таймлайну** — Ctrl+F відкриває search bar, підсвітка знайдених блоків, навігація ▲▼ по результатах, авто-скрол, dimming непотрібних блоків [claude-code]
- **Redo + Hotkeys** — Ctrl+Z скасувати, Ctrl+Shift+Z / Ctrl+Y повторити, повний redo стек (до 10 дій) [claude-code]
- **Шаблони бронювань** — DB таблиця `booking_templates`, CRUD API `/api/booking-templates`, dropdown + кнопка 💾 у формі бронювання, лічильник використань, сортування по popular+favorites [claude-code]
- **Повторювані бронювання UI** — модалка з вибором патерну (щотижня, через тиждень, будні, вихідні, щомісяця), дні тижня, дата завершення. Кнопка 🔄 в деталях бронювання [claude-code]
- **Bulk-операції** — Shift+Click для multi-select блоків на таймлайні, floating action bar (видалити, підтвердити, зробити попередніми) [claude-code]
- **PDF експорт** — кнопка "Друк PDF" з print stylesheet (ховає UI, зберігає кольори блоків) [claude-code]
- **Міграція 075** — `booking_templates` таблиця з індексами на favorite та usage_count [claude-code]

## v24.4.0 — QA Mega Fix + Adaptive Layout (2026-03-12)
- **8 сторінок виправлено** — додано відсутній ui.js (customers, chat, dashboard, leads, profile, shop, quiz, room) — confirmModal/showNotification були undefined [claude-code]
- **Адаптивний layout** — прибрано max-width обмеження (1800/1400/1200px), контент розтягується на повну ширину коли панель закрита [claude-code]
- **Smart hyperlinks** — в деталі бронювання: клікабельний tel:, Instagram, Telegram, CRM-картка клієнта з hover-actions [claude-code]
- **Copy-on-hover** — кнопки 📋 на рядках деталі бронювання + "Скопіювати все" [claude-code]
- **Sidebar gap fix** — прибрано візуальну дірку між навігацією і кнопками дій (flex:1 → margin-top:auto) [claude-code]
- **22 сторінки очищено** — видалено дубльовані script/CSS теги після merge conflicts [claude-code]
- **Script order fix** — profile.html, shop.html: page JS тепер завантажується після залежностей [claude-code]
- **showToast()** — додано alias в ui.js для chat-page.js [claude-code]
- **Version sync** — `scripts/version-sync.js` — один скрипт для синхронізації версій скрізь [claude-code]
- **Service Worker** — кеш v12→v24 для інвалідації застарілих версій [claude-code]
- **Afisha cascade** — DELETE тепер зберігає done таски [claude-code]
- **295 тестів pass** (api.test.js), 82 certificates, 51 automation [claude-code]

## v23.4.0 — Lead Capture Integration (2026-03-11)
- **Telegram Lead Capture** — приватні повідомлення в бот автоматично створюють лід в CRM, автовідповідь юзеру [claude-code]
- **Universal Webhook** — `POST /api/leads/webhook/universal?source=tiktok|turbo|bnderoga` з Bearer token auth [claude-code]
- **Facebook Lead Ads** — webhook + Graph API v21.0 для отримання даних лідів [claude-code]
- **Instagram DM** — webhook для нових DM повідомлень → автоматичний лід [claude-code]
- **Viber Business** — webhook з HMAC-SHA256 signature verification [claude-code]
- **Lead Notifier** — `services/leadNotifier.js` — Telegram сповіщення менеджерам при новому ліді [claude-code]
- **UI оновлення** — 12 джерел у sourceFilter (TG, FB, IG, Viber, TikTok, Turbo, BnD, Google, Рек, Повтор, Ручний, Інше) [claude-code]
- **Source badges** — кольорові бейджі для кожного джерела (customers + leads pages) [claude-code]
- **DB Migration 053** — `external_id`, `raw_payload`, `source_channel` + unique index для дедуплікації [claude-code]
- **JWT bypass** — webhook paths відкриті без автентифікації [claude-code]

## v23.3.0 — OmniClaw Security Hardening (2026-03-11)
- **Webhook Signature Verification** — Viber HMAC-SHA256 (X-Viber-Content-Signature), Meta X-Hub-Signature-256 з timingSafeEqual, SMS/Binotel X-Webhook-Secret header [claude-code]
- **API Token Security** — FB/IG access_token перенесено з URL query string в Authorization: Bearer header [claude-code]
- **Graph API Update** — v18.0 → v21.0, конфігурується через FB_API_VERSION / IG_API_VERSION env [claude-code]
- **Pool Safety** — pool.connect() обгорнуто в try-catch у 5 функціях omni-hub.js (запобігає unhandled rejection при вичерпаному пулі) [claude-code]
- **Input Validation** — senderName/phone truncate до DB limits (255/50), getConversations whitelist status/channel, assignedTo type+length check, parseId на всіх route :id params [claude-code]
- **HTTP Status Checks** — перевірка statusCode в fbRequest, igRequest, turboSmsRequest, viberRequest (розрізняє 429/401/500) [claude-code]
- **Normalizer Hardening** — safeCoords() перевіряє Number.isFinite, safeString() з maxLen, isValidUrl() protocol check, JSON.stringify cap для unknown channels [claude-code]
- **Phone Validation** — normalizePhone() E.164 cap (15 digits max), reject < 7 digits [claude-code]
- **getUserProfile Security** — fields array sanitized з regex whitelist /^[a-z_]+$/i + encodeURIComponent [claude-code]
- **Нові env vars** — META_APP_SECRET, SMS_WEBHOOK_SECRET, BINOTEL_WEBHOOK_SECRET (всі опціональні, graceful skip) [claude-code]

## v23.0.0 — Major Release: Full Version Sync (2026-03-11)
- **Version Sync** — повна синхронізація версій по всіх 25+ HTML файлах, package.json, swagger.js, SNAPSHOT, CHANGELOG [claude-code]
- **Landing Carousel** — команда з каруселлю, Anli Lektor, swipe/dots/arrows [kleshnya]
- **Manager Guide** — нова сторінка landing/manager-guide.html для менеджерів з продажу [kleshnya]
- **Cache Busting** — ?v=23.0.0 на всіх CSS/JS ресурсах (25 HTML файлів)
- **Swagger API** — версія OpenAPI spec оновлена з 20.12.0 до 23.0.0
- **Dashboard fix** — версія в login subtitle оновлена (було v22.18.1)
- **game.html fix** — нормалізований ?v= тег (було 22.20.0.1)

## v22.20.0 — Guardian Phase 3: Analytics & Intelligence (2026-03-11)
- **14 Guardian chat commands** — /g help, status, stats, mood, health, top, history, mute, unmute, trust, report, rules, learn, config [claude-code]
- **Channel Health Score** — real-time 0-100, 🟢🟡🔴 indicator, auto-calculation, history [claude-code]
- **Sentiment Tracking** — keyword-based mood analysis per message, per-user summaries [claude-code]
- **Guardian Analytics Panel** — 5 tabs: overview, health, mood, heatmap, trust [claude-code]
- **Activity Heatmap** — 7×24 hourly grid [claude-code]
- **Trust Score System** — 0-100, 4 levels (trusted/normal/watched/restricted) [claude-code]
- **Auto-Escalation** — 5-level: warn → mute 1m → 10m → 30m+TG → ban 1 day [claude-code]
- **Weekly Reports** — Monday digest with trends + Telegram delivery [claude-code]
- **29 API endpoints + 8 DB tables** — migration 051 [claude-code]

## v22.19.0 — Guardian Contour System Phase 2 (2026-03-11)
- **Telegram алерти** — критичні події Guardian → директору в Telegram [claude-code]
- **Inline action buttons** — дії з Guardian DM (мютити обох, попередження, спостерігаю) [claude-code]
- **Security Panel UI** — статистика, активні мути, unmute кнопки [claude-code]
- **Conflict detector** — вікно 15 повідомлень + reply chain awareness [claude-code]
- **Sensitive patterns** — паролі, JWT, API ключі, адреси, дати народження [claude-code]
- **Repeat offender tracking** + **Spam detection** [claude-code]

## v22.18.0 — CRM Tech Debt + Features (2026-03-10)
- Issues #18–#26: технічний борг та нові фічі
- Version bump та синхронізація

## v22.12.0–v22.17.0 — Match-3 Candy Crush Edition (2026-03-09–10)
- **v22.17.0** — UI polish: contrast, style, mystical vibe [kleshnya]
- **v22.16.0** — Candy Crush icons + idle/combo/special animations [kleshnya]
- **v22.15.0** — Icon fix: replace v4 icons with consistent v3/final candy style [kleshnya]
- **v22.12.0** — Match-3 custom art assets [kleshnya]

## v22.10.0–v22.11.0 — Dark Mode Polish + Mystic Edition (2026-03-09)
- **v22.11.0** — Match-3 Mystic Edition: tarot cards, bosses, events, modern UI [claude-code]
- **v22.10.0** — Dark Mode Polish: 92 нових overrides + JS color fixes [claude-code]
- Security Hardening — input validation, race conditions, error disclosure [claude-code]
- Gamification Hardening — DB integrity, bug fixes, tests [claude-code]

## v22.4.0–v22.9.0 — Gamification V2 + Match-3 Epic (2026-03-09)
- **v22.9.0** — Match-3 Epic Edition: 9x9 grid, frozen tiles, cross special, combo system [claude-code]
- **v22.8.0** — Redesigned confirm dialogs, replaced native confirm()/alert() [claude-code]
- **v22.7.0** — Match-3 upgrade: special pieces, scoring fix, dashboard & profile fixes [claude-code]
- **v22.6.0** — Stability audit + version bump [claude-code]
- **v22.5.0** — Custom confirm modals, purchase effects, cooldown reset, chat fix [claude-code]
- **v22.4.0** — Gamification V2: Quiz, Streaks, Room page, Match-3 improvements [claude-code]

---

## v22.0.0–v22.3.0 — Dashboard, Gamification, Game Profile (2026-03-08–09)

### v22.3.0 — Game Profile (09.03.2026)
- Таб "Гра" в профілі (клік на нікнейм) — досягнення, магазин, інвентар, лідерборд
- XP progress bar, рівень, титул, монети в шапці
- Купівля предметів і екіпування з профілю
- Dashboard dark mode fix — картки #2A2A4A з видимими бордерами
- 8 API helper функцій для gamification, 300 рядків CSS

### v22.2.0 — Gamification MVP (09.03.2026)
- Gamification service (727 рядків): XP, рівні, монети, стріки
- Achievement catalog — 20 досягнень з рідкостями та нагородами
- Character items — backgrounds, frames, hats, weapons, shields, outfits, effects, badges
- Shop — магазин предметів за монети з інвентарем
- Leaderboard — таблиця лідерів по XP/монетах/досягненнях
- API: /api/gamification/* (10 ендпоінтів)
- DB: міграція 039_gamification.sql (10 нових таблиць)
- Standalone profile.html + profile-page.js

### v22.1.0 — Messenger UX (09.03.2026)
- Пошук емодзі з фільтрацією по ключових словах
- Lightbox для зображень з галереєю
- Unread separator, scroll badge, reaction popup, drag overlay
- ARIA, keyboard navigation, touch/mobile, safe-area-inset
- Dashboard SQL fix (price, label, staff_schedule)

### v22.0.0 — Dashboard + 25 Roles + Navigation (08.03.2026)
- Персоналізована HOME-сторінка /dashboard з віджетами
- 25 ролей (було 10): бухгалтер, арт-директор, маркетолог, IT, HR, шеф-кухар, кондитер, рецепція та ін.
- Тест-панель creator для переключення ролей
- Onboarding wizard, Widget API з кешем
- role_definitions таблиця з departments та parent_role

---

## v21.12.0–v21.15.0 — Navigation, Polish, Accessibility (2026-03-08)

### v21.15.0 — Unified Navigation
- Sidebar NAV_ITEMS: 9 → 18 пунктів навігації
- Sidebar.init() на всіх 15 standalone-сторінках
- Уніфікована toast система на всіх page-JS файлах

### v21.14.0 — Polish + A11y + Tablet
- Синхронізація ?v= тегів на 13 standalone-сторінках
- iOS zoom prevention (16px на input/select/textarea)
- Touch targets 44px+ (WCAG 2.1)
- Tablet breakpoint 769-1023px
- Dark mode auto-init на всіх standalone-сторінках

### v21.12.0–v21.13.0 — Dark Mode Fix + Role Hierarchy
- Виправлено dark mode toggle + auto night theme
- Configurable night time (start/end)
- Role hierarchy display, dashboard в sidebar

---

## v20.9.12–v20.9.15 — CRM Big Sprint (2026-03-03)

**Supabase міграція, Ліди, Банкети, Staff Extension**

### v20.9.15 — Staff Extension
- `staff.contract_type` VARCHAR(20) — fulltime/parttime/contract
- `staff.skills` TEXT[] — масив навичок
- HR модалка: telegram_username, тип контракту, навички
- Міграція: 026_leads_banquet_staff.sql (частина 26.3)

### v20.9.14 — Banquet Booking
- `bookings.banquet_menu` TEXT, `banquet_guests` INT, `banquet_tables` INT
- Форма бронювання: автоматичне показ/приховання банкетних полів при category=banquet
- Таймлайн: банкетні блоки з amber стилем (border-left #F59E0B, gradient)
- POST/PUT бронювань включають банкетні дані

### v20.9.13 — Leads Page
- Standalone сторінка `/leads` з воронкою, фільтрами, пошуком
- `leads.instagram`, `leads.source`, `leads.lost_reason`, `leads.booking_id` (FK)
- GET `/api/leads/stats` — статистика по статусах
- Кнопка "Конвертувати в бронювання" з pre-fill
- Sidebar: додано навігацію "Ліди"

### v20.9.12 — Supabase Customers
- `db/supabase.js` — Supabase клієнт з lazy init та fallback
- `routes/customers.js` — повний CRUD через Supabase (fallback на Railway DB)
- POST `/api/customers/migrate-to-supabase` — ендпоінт для міграції існуючих клієнтів
- Inline створення клієнтів у бронюваннях — також через Supabase

---

## v20.7.0 — Sales Features (2026-02-26)

**Продажні фічі за Якубою ч.2 — ліди, конверсія, рекомендації, скрипти**

### Hot Leads (Гарячі ліди)
- Таблиця `leads` — трекінг запитів від клієнтів
- API: GET/POST/PATCH/DELETE `/api/leads`, GET `/api/leads/hot`
- Крон 09:00 та 15:00 — автоматичне створення задач для лідів без відповіді 24+ год
- Telegram алерт при наявності гарячих лідів
- UI блок "🔥 Гарячі ліди" в /center Overview

### Manager Conversion (Конверсія менеджерів)
- GET `/api/analytics/conversion` — бронювань/підтверджено/конверсія%/середній чек по менеджерах
- Таблиця з прогрес-барами конверсії в /center Overview

### Age Recommendations (Рекомендації по віку)
- AGE_RECOMMENDATIONS: 3-5 / 6-8 / 9-12 / 12+ → відповідні програми
- Показуються в модалці бронювання після введення дати народження дитини
- Клік на рекомендовану програму → автоматичний вибір

### Sales Scripts (Скрипти продажів)
- Таблиця `sales_scripts` (7 seed фраз: заперечення, закриття, апсейл)
- API: GET/POST/PUT/DELETE `/api/scripts`
- Quick-access в модалці бронювання — вкладки по категоріях + кнопка "Копіювати"

### Auto Follow-up Tasks
- При створенні бронювання автоматично створюється задача
- Дедлайн: за 2 дні до події
- Текст: "Підтвердити свято: [клієнт] [дата]"

### Other
- `bookings.source` — нова колонка для джерела бронювання
- Міграція: 024_page_statuses_leads_scripts.sql

## v20.6.0 — Status Badges + Menu Refactor (2026-02-26)

**Статус-бейджики на sidebar + рефакторинг timeline menu**

### Status Badges
- Таблиця `page_statuses` — 5 статусів: building (🔴), testing (🟠), updated (🟡), in_tests (🔵), ready (🟢)
- API: GET `/api/page-statuses`, PATCH `/api/page-statuses/:path`
- sidebar.js автоматично завантажує статуси і рендерить бейджики
- CSS: крапка (collapsed) або pill з текстом (expanded)

### Menu Refactor
- Видалено дублюючі навігаційні посилання з timeline dropdown (Програми, Задачі — вже є в sidebar)

### Bugfixes
- `/auth/verify` тепер читає роль з БД а не з JWT (фікс для кешованих ролей після міграції)
- `routes/center.js` — замінено hardcoded `role !== 'admin'` на `requireMinRole('senior_manager')`
- Cache-busting: всі HTML `?v=` бампнуті до 20.70

---

## v17.1.0 — AI Team & Contractor Cards (2026-02-22)

**Редизайн AI-команди: акордеон-панелі, журнал, відправка на завдання**

### AI Team картки (HR → AI Команда)
- **Повний редизайн** — замінено зламану grid-сітку на повноширинні картки
- **Акордеон-панелі** — Можливості, Інтеграція, Журнал розкриваються по кліку
- **Відправка на завдання** — ручна форма для відправки AI-працівника
- **Журнал виконання** — in-session трекінг завдань з таймстемпами
- **Dark mode** — повна підтримка темної теми для всіх елементів

### Виправлення
- **Changelog CSS** — змінено `changelog-entry` → `changelog-section` (існуючий клас з CSS)
- **Версійний workflow** — повне оновлення 5 точок (package.json, CSS/JS tags, tagline, button, entry)

---

## v17.0.0 — Export, Budget & Procurement (2026-02-22)

**3 великі фічі: Export Excel/PDF, Бюджетне планування, Система закупок**

### Export Excel/PDF
- **Excel (.xlsx)** — експорт фінансів, клієнтів, закупок через `exceljs`
- **3 ендпоінти** — `/api/finance/export-xlsx`, `/api/customers/export-xlsx`, `/api/procurement/export-xlsx`
- **PDF** — print-friendly CSS на сторінці складу та закупок (Ctrl+P → PDF)
- **Стилізовані файли** — заголовки, формат, автоширина колонок

### Бюджетне планування (план vs факт)
- **Таблиця `budget_plans`** — план по категоріях × місяцях, UNIQUE(year, month, category_id)
- **Upsert API** — `PUT /api/finance/budget` (створення або оновлення)
- **Порівняння** — `GET /api/finance/budget/comparison?year=2026&month=2` з % виконання
- **Фронтенд** — новий таб «Бюджет» в Фінансах з KPI-картками та таблицею план/факт/різниця/%

### Система планування закупок
- **2 таблиці** — `procurement_lists` (списки) + `procurement_items` (позиції)
- **Відділи** — аніматорська, хозка, кафе, техніка, адміністрація
- **Статуси** — чернетка → затверджено → в процесі → закуплено → доставлено
- **Повний CRUD** — 10 API-ендпоінтів для списків та позицій
- **Авто-поповнення** — `GET /api/procurement/suggestions/low-stock` генерує списки з нестач
- **Авто-реstock** — `POST /api/procurement/:id/complete` поповнює склад + записує в історію
- **Фронтенд** — новий таб «Закупки» на сторінці складу з фільтрами, картками, деталями
- **Excel export** — вивантаження списків закупок з фільтрами

### Технічне
- **Міграція 009** — `budget_plans`, `procurement_lists`, `procurement_items` + індекси
- **routes/procurement.js** — новий маршрутний модуль (300+ рядків)
- **exceljs** — нова залежність
- **22 нові тести** — budget CRUD, procurement CRUD, items, suggestions, complete, excel export
- **288 тестів** загалом (287 pass)
- Cache bust: `?v=17.0` all files

---

## v16.2.0 — Swagger API Docs (2026-02-22)

**Інтерактивна документація API — /api-docs**

- **Swagger UI** — інтерактивна документація на `/api-docs` з можливістю тестувати ендпоінти
- **OpenAPI 3.0** — повна специфікація: 136 ендпоінтів, 54 схеми, 25 тегів
- **Нові модулі в spec** — Customers, Finance, Analytics, HR, Designs, Contractors, Warehouse (раніше не задокументовані)
- **JSON spec** — `/api-docs.json` для автогенерації клієнтських бібліотек
- **Публічний доступ** — Swagger UI не потребує авторизації
- **swagger-ui-express** — нова залежність
- Cache bust: `?v=16.2` all files

---

## v16.1.0 — Analytics v2 (2026-02-22)

**Єдиний дашборд — бронювання + фінанси + HR + CRM**

- **Сторінка «Аналітика»** — `/analytics` з KPI-картками, графіками, порівнянням
- **KPI-дашборд** — 6 карток: виручка, бронювання, середній чек, фінанси (дохід/витрати/прибуток), нові клієнти, HR (години/працівники)
- **Порівняння періодів** — автоматичний розрахунок vs попередній період з % зміни (▲/▼)
- **Графіки** — доходи бронювань по днях, фінансові потоки по днях, топ-10 програм, навантаження по днях тижня
- **Фінансові категорії** — горизонтальні бари з кольорами та іконками
- **Сегменти клієнтів** — чемпіони (5+), лояльні (3-4), нові (1-2), неактивні
- **Періоди** — сьогодні, тиждень, місяць, квартал, рік, довільний діапазон
- **API** — 3 ендпоінти: `/api/analytics/overview`, `/charts`, `/comparison` (5-хвилинний кеш)
- **Навігація** — посилання «Аналітика» на всіх 11 сторінках
- **Нові файли:** `analytics.html`, `js/analytics-page.js`, `routes/analytics.js`
- **Тести:** 8 нових тестів (overview, charts, comparison, static page)
- Cache bust: `?v=16.1` all files

---

## v16.0.0 — Finance Module (2026-02-22)

**Фінансовий модуль — каса, P&L, зарплати**

- **Сторінка «Фінанси»** — `/finance` з 4 табами (дашборд, транзакції, місячний звіт, зарплати)
- **Дашборд** — доходи/витрати/прибуток за період, графік по днях, розбивка по категоріях, методи оплати
- **Транзакції CRUD** — створення/редагування/видалення операцій, фільтри по типу/категорії/оплаті/даті
- **P&L звіт** — щомісячна таблиця доходів/витрат/прибутку за рік + графік по місяцях
- **Зарплатний звіт** — розрахунок зарплат з HR (ставка × години), таблиця працівників
- **Категорії фінансів** — 12 початкових (5 доходу + 7 витрат), CRUD для користувацьких категорій
- **Автозапис з бронювань** — підтверджені бронювання автоматично створюють транзакцію доходу
- **Спосіб оплати** — `bookings.payment_method` (готівка/картка/переказ/змішаний)
- **Вартість сертифікатів** — `certificates.value_uah` поле
- **CSV-експорт** — вивантаження фінансових операцій (UTF-8 BOM, `;` separator)
- **Навігація** — посилання «Фінанси» на всіх 10 сторінках
- **Нові файли:** `finance.html`, `js/finance-page.js`, `routes/finance.js`
- **БД:** `finance_categories`, `finance_transactions` + індекси
- **Тести:** 21 новий тест (categories, CRUD, dashboard, monthly, CSV, static page)
- Cache bust: `?v=16.0` all files

---

## v15.1.0 — CRM Phase 2 (2026-02-22)

**Повна клієнтська база з аналітикою**

- **Сторінка CRM** — `/customers` з таблицею клієнтів, пошуком, пагінацією
- **Фільтри клієнтів** — по джерелу (Instagram, Google, рекомендація), візитах, даті, сортування
- **RFM-аналітика** — Recency/Frequency/Monetary з 5 сегментами: чемпіони, лояльні, потенційні, під загрозою, втрачені
- **Автопривітання ДН** — щоденний Telegram о 09:00 з іменинниками та контактами батьків
- **Зв'язок сертифікатів** — `certificates.customer_id` + відображення в картці клієнта
- **CSV-експорт** — вивантаження бази клієнтів з усіма полями (UTF-8 BOM, роздільник `;`)
- **Stats API** — `/api/customers/stats` — огляд бази (кількість, джерела, топ клієнти, середні)
- **Навігація** — посилання «Клієнти» на всіх 9 сторінках
- **Нові файли:** `customers.html`, `js/customers-page.js`
- **Тести:** 11 нових тестів (filters, stats, RFM, CSV, certificates)
- Cache bust: `?v=15.1` all files

---

## v15.0.0 — HR Module (2026-02-22)

**Повноцінний HR-блок**

- **HR-модуль** — нова сторінка `/hr` з 4 табами
- **Хто зараз** — live-табло присутності з кнопками clock-in / clock-out
- **Розклад** — планування змін на тиждень/місяць, шаблони, копіювання тижня, bulk-операції
- **Команда** — картки профілів, контакти, екстрений контакт, ставки, фільтрація за ролями
- **Звіти** — місячна аналітика відвідуваності, підрахунок зарплат, CSV-експорт
- **Cron-jobs** — авто-закриття незакритих змін (23:55 Kyiv), no-show детектор (13:00 Kyiv)
- **Міграція 007** — hr_shifts, hr_time_records, hr_shift_templates, hr_audit_log + розширення staff
- **API** — 20+ ендпоінтів `/api/hr/*` (staff, shifts, clock-in/out, reports, templates)
- **Навігація** — HR-лінк додано у всі сторінки

---

## v14.4.0 — Тест 35 (2026-02-22)

**Тест 35**

---

## v14.3.0 — Тест 34 (2026-02-22)

**Тест 34**

---

## v14.2.0 — Тест 33 (2026-02-21)

**Тест 33**

---

## v13.0.0 — Помічник Chat v2 (2026-02-18)

**Помічник Chat v2 — ChatGPT-style multi-session redesign:**
- Sidebar сесій (desktop 280px, mobile overlay по свайпу/кнопці)
- Multi-session: створення, перемикання, перейменування, pin, emoji, видалення
- Context menu (right-click / long press): rename, pin, clear, delete
- Media bubbles: image, audio, video з proxy через /api/kleshnya/media/file/:fileId
- Reactions (👍/👎) toggle на assistant повідомленнях
- Generation indicator з animated progress bar (~30 сек)
- WebSocket real-time: kleshnya:thinking, kleshnya:reply, kleshnya:media
- Voice input (Web Speech API)
- FAB на мобільному для "Новий чат"
- Rename modal з emoji picker
- Повна dark mode підтримка для всіх нових компонентів
- JS виділено в окремий файл js/kleshnya-page.js

**Smart Chat engine (12 навичок):**
- 📊 Бронювання — деталі, клієнти, кімнати, ціни по датах/тижням/місяцям
- 📋 Задачі — мої/всі/прострочені з пріоритетами та статусами
- ✏️ Створення задач — "Створи задачу купити серветки" прямо з чату
- 🔥 Стрік і бали — стрік, бали, лідерборд команди
- 👥 Команда — хто на зміні по відділах з часами
- 💰 Фінанси — виручка, середній чек, % росту порівняно з минулим періодом
- 🎪 Афіша — заплановані події по датах
- 🎭 Програми — каталог з категоріями, цінами, деталями
- 🎫 Сертифікати — активні, що скоро спливуть
- 🏠 Кімнати — завантаженість по кімнатах
- 📈 Аналітика — порівняння місяців, топ програм
- ❓ Допомога — повний список навичок з прикладами

**Фільтр по категоріях послуг:**
- "Скільки піньят за тиждень?" → кількість, виручка, список по кожному бронюванню
- Підтримує: піньяти, квести, шоу, анімації, майстер-класи, фото
- Розуміє періоди: сьогодні/завтра/тиждень/місяць/вихідні

**Suggestion chips:**
- Після кожної відповіді 2-4 кнопки follow-up запитів
- Контекстні — залежать від теми відповіді
- Анімоване з'явлення, dark mode підтримка

**Backend:**
- `services/kleshnya-chat.js` — новий skill engine з реальними DB запитами
- `services/kleshnya-bridge.js` — Telegram Bridge для OpenClaw (227 рядків)
- `routes/kleshnya.js` — повний CRUD sessions, paginated messages, reactions, media proxy
- `services/websocket.js` — kleshnya:thinking, kleshnya:reply, kleshnya:media events
- `db/migrations/005_kleshnya_chat_v2.sql` — chat_sessions, kleshnya_media

**Cache bust:** `?v=13.0` на всіх CSS/JS всіх 7 сторінок

---

## v12.1.0 — Розумна тема + UX (2026-02-17)

**Авто Dark Mode:**
- Темна тема автоматично з 20:00 до 07:00, світла вдень
- Спільна функція `initDarkMode()` в config.js — єдине джерело правди
- Працює на всіх 6 сторінках (таймлайн, задачі, програми, графік, дизайни, помічник)
- Ручний вибір через toggle зберігається в localStorage і перезаписує авто

**Dark mode на /designs:**
- Повне покриття: картки, фільтри, drop zone, таби, прайс-лист, календар, модалки
- Інтегровано і `body.dark-mode` і `[data-theme]` для повної сумісності

**Мобільний UX /designs:**
- Картинки: `object-fit: contain` — повний дизайн без обрізання
- Таби: горизонтальний скрол (нічого не обрізається)
- Фільтри: один компактний рядок замість 3
- Drop zone: тонкий бар замість великого блоку
- Кнопки: `min-height: 36px` для зручного натискання

**Фікс авторизації /designs:**
- Прибрана залежність від `pzp_session` (ніколи не записувався)
- Тепер використовує `/api/auth/verify` як tasks/programs/staff

**Фікс горизонтального скролу:**
- `overscroll-behavior-x: contain` на всіх scroll-контейнерах
- Жест на мобільному більше не зсуває всю сторінку

**Cache bust:** всі HTML файли оновлені до `?v=12.1`

---

## v11.0.6 — Помічник знає твоє ім'я (2026-02-15)

- **Персоналізація:** привітання тепер звертаються по імені з акаунту користувача
- **Фікс:** "Денний" більше не з'являється — displayName передається з JWT токена
- **Шаблони:** GREETINGS тепер функції з параметром імені
- **Кеш:** очистка кешу привітань при кожному старті сервера

---

## v11.0.4 — Помічник без пафосу (2026-02-15)

- **Привітання:** жива українська замість "сканування завершено" / "системи активовано"
- **Відповіді:** просто та корисно без "місій", "оперативників", "сенсорів"
- **Кнопки:** Задачі (замість Місії), Аніматори (замість Оперативники)
- **Divider:** "ШВИДКІ ЗАПИТИ" замість "МОДУЛІ ЗАПИТІВ"
- **Footer:** "Відкрити чат" замість "Повний термінал"

---

## v11.0.3 — Голографічний Термінал (2026-02-15)

- **FAB:** radial gradient + обертове dashed-кільце + sonar pulse з neon glow
- **Popup:** темний термінал (#1a1520), scan line overlay, monospace шрифт (Courier New)
- **Header:** блимаючий зелений status dot, "KLESHNYA v3.0 / ONLINE" в стилі командного центру
- **Greeting:** typing-анімація (символ за символом) з блимаючим курсором █
- **Answer:** термінальний блок з `>>` prompt, зеленим акцентом, typing ефект
- **Buttons:** sweep-ефект (gradient пролітає по кнопці), ◈ іконки з обертанням на hover
- **Divider:** "МОДУЛІ ЗАПИТІВ" з gradient-лініями
- **Footer:** "Повний термінал →" з ⬡ іконкою
- **Dark mode:** посилений glow на FAB/popup/buttons
- **Responsive:** адаптовано для 480px

---

## v11.0.2 — Футуристична Помічник (2026-02-15)

- **Floating widget:** інтерактивна кнопка 🦀 (FAB) замість статичного банера в stats bar
- **Popup:** привітання + 4 кнопки швидких питань (бронювання, задачі, стрік, аніматори) + посилання на повний чат
- **Футуристичний стиль:** всі привітання та відповіді переписані в стилі командного центру (скан, місії, оперативники, модулі аналізу)
- **Dark mode + responsive:** повна підтримка для нового віджету
- CSS: layout.css, dark-mode.css, responsive.css — нові стилі для FAB + popup
- JS: timeline.js — initKleshnyaWidget(), handleKleshnyaQuestion()

---

## v11.0.1 — Документація та Swagger (2026-02-15)

- **PROJECT_PASSPORT.md:** повна актуалізація до v11.0 (30 таблиць, 17 routes, 13 services, Kleshnya greeting/chat, особистий кабінет, schedulers)
- **CLAUDE.md:** виправлені невідповідності (19 JS, 11 CSS, 364 тести, повна файлова структура)
- **swagger.js:** v8.6.1 → v11.0.0 (+25 endpoints, +10 schemas: points, kleshnya, recurring, stats, auth profile/achievements/password, task logs)
- **SNAPSHOT.md:** коректна кількість тестів (364)

---

## v11.0.0 — Дофамінові покращення (2026-02-15)

**Kleshnya Greeting & Chat:**
- Quick stats bar → two-column layout: статистика ліворуч, Kleshnya banner праворуч
- Персоналізовані привітання на основі бронювань, задач, стріків, часу доби
- Greeting cache в БД (4h TTL) для rate-limit майбутніх AI agent викликів
- Повна чат-сторінка `/kleshnya` з історією повідомлень
- Template-based responses (agent-ready hook для майбутньої AI інтеграції)
- API: GET/POST `/api/kleshnya/greeting`, GET/POST `/api/kleshnya/chat`
- Dark mode + responsive support

**Особистий кабінет — повна перебудова:**
- 4 таби: Сьогодні / Задачі / Стати / Налашт.
- **Сьогодні:** shift block, SVG progress ring, actionable inbox (прострочені + майбутні задачі з done/start), admin team overview grid
- **Задачі:** inline status actions (start/done), blocked task indicators, dependency awareness, priority highlighting, animated task completion
- **Стати:** stat cards з week-over-week deltas, бали з task links, escalation history, certificate details, 12 achievements grid
- **Налашт.:** зміна пароля, user details, logout
- 12 досягнень (first_task, streak_3/7/30, booking_pro тощо) з auto-grant логікою
- `user_action_log` таблиця + POST/GET endpoints для UI click tracking
- `user_achievements` + `user_streaks` таблиці
- PATCH `/tasks/:id/quick-status` для inline task actions з профілю
- 23 паралельні SQL запити у `/profile` endpoint (Promise.allSettled)
- ~500 рядків нових CSS стилів (tabs, progress ring, shift block, inbox, team grid, achievements)

**БД (+3 таблиці):**
- `kleshnya_messages` (greeting cache), `kleshnya_chat` (chat history)
- `user_action_log`, `user_achievements`, `user_streaks`

**Файли:**
- `kleshnya.html` — нова сторінка чату
- `services/kleshnya-greeting.js` — новий (greeting engine)
- `routes/kleshnya.js` — новий (API greeting + chat)
- `routes/auth.js` — розширений `/profile` з 23 queries
- `js/auth.js` — перебудований profile modal з 4 табами
- `js/api.js` — +kleshnya API methods
- `js/timeline.js` — kleshnya banner на головній
- `css/modals.css` — +500 рядків profile styles
- `css/layout.css`, `css/dark-mode.css`, `css/responsive.css` — kleshnya layout

---

## v10.5.0 — Verification Bump (2026-02-15)

- **Profile modal на суб-сторінках:** tasks.html, programs.html, staff.html — додані modals.css та profile modal HTML
- **Modal UX:** close (×), backdrop click, Escape key в initProfileHandler
- **Auto-init:** profile click handler через DOMContentLoaded на всіх сторінках
- Всі 221 тестів пройдено

---

## v10.4.0 — Особистий кабінет PRO (2026-02-15)

- **Кабінет PRO:** повна переробка з 15+ SQL запитами через Promise.allSettled (паралельні)
- **Увага:** блок "Потребують уваги" — прострочені задачі, дедлайни < 24 год
- **Мої задачі:** inline-список з пріоритетами, дедлайнами, статусами (overdue виділені)
- **Бали:** транзакції останніх нарахувань з причинами (ON_TIME, EARLY, LATE тощо)
- **Лідерборд:** ранг #N серед усіх користувачів
- **Бронювання:** розбивка по статусах (підтверджені/попередні/скасовані), виручка (admin only), топ-3 програми
- **Сертифікати:** видані по статусах (активні/використані)
- **Задачі:** середній час виконання, кількість ескалацій, розбивка по категоріях
- **Зміна пароля:** PUT /api/auth/password з валідацією та bcrypt
- **Активність:** збільшено до 20 записів + пагінація "Показати ще"
- **Telegram:** статус підключення у профілі (badge)
- **UX:** мобільний responsive (3+2 grid на малих екранах), 5 stat cards замість 4

---

## v10.3.0 — Особистий кабінет (2026-02-15)

- **Особистий кабінет:** клік по імені користувача відкриває модальне вікно з персональною інформацією
- **API:** GET /api/auth/profile — консолідований профіль (user info + points + tasks + bookings + activity)
- **Профіль:** аватар, роль, дата реєстрації, статистика (бронювання, задачі, бали), остання активність
- **UX:** username кликабельний з underline hint, повна keyboard accessibility

---

## v10.2.0 — Reliability (2026-02-15)

- **Logging:** замінені всі `/* non-blocking */` catch блоки на log.warn з context (scheduler, afisha)
- **ROLLBACK safety:** distributeAfishaForDate — ROLLBACK з .catch() і логуванням помилки
- **Graceful shutdown:** drain in-flight Telegram запитів перед закриттям DB pool (drainTelegramRequests)
- **Body limit:** /api/backup/restore збільшений до 50mb (великі SQL дампи)

---

## v10.1.0 — Data Integrity (2026-02-15)

- **Migration 004:** unique partial indexes для дедуплікації recurring bookings, tasks, afisha (template_id + date)
- **Migration 004:** додані відсутні індекси: bookings(status), tasks(assigned_to), tasks(assigned_to, date)
- **Atomic dedup:** scheduler recurring tasks і afisha використовують INSERT ON CONFLICT замість SELECT → INSERT (race condition fix)
- **Optimistic locking:** updateTaskStatus перевіряє version column перед UPDATE (захист від конкурентних змін)
- **DB:** додана колонка `tasks.version` (INTEGER DEFAULT 1) для optimistic locking

---

## v10.0.1 — Security Hotfix (2026-02-15)

- **RBAC:** tasks write-операції (POST/PUT/PATCH/DELETE) обмежені ролями admin/user, viewer = read-only
- **RBAC:** points leaderboard = admin/user, individual points = own + admin, history = own + admin
- **Security:** parseInt валідація в Telegram callback handlers (NaN guard з early return)
- **Security:** приховані DB error messages у backup endpoints (no schema leakage)
- **Security:** валідація `type` параметра в tasks GET query filter
- **Security:** обмежений offset в points history (max 10000, DoS prevention)

---

## v10.0.0 — Tasker & Kleshnya (2026-02-15)

**Tasker — операційний центр:**
- Централізований задачник з двома типами: `human` (людина) / `bot` (система)
- Дві ролі: `owner` (менеджер, ескалація) + `assigned_to` (виконавець)
- Дедлайни, вікна виконання, залежності між задачами
- `control_policy` (JSONB) — правила нагадувань та ескалації на рівні задачі
- `source_type` — відстеження джерела задачі (booking, trigger, recurring, kleshnya)

**Помічник (services/kleshnya.js) — центральний інтелект:**
- Створення задач з логуванням + нотифікацією
- 4-рівнева ескалація: м'яке → жорсткіше → увага → директор
- Автоматичне нарахування балів при завершенні задач
- Персональні Telegram-повідомлення (chat_id) + групові (@mention)
- Журнал змін (task_logs) з повною історією

**Система балів:**
- `user_points` — постійні (накопичувальні) + місячні (обнуляються 1-го)
- `point_transactions` — повна історія нарахувань
- Правила: вчасно +5/+2, з запасом +7/+3, high priority +10/+5, прострочено -2..-5
- API: GET /api/points (leaderboard), GET /api/points/:username/history

**Scheduler (3 нові, всього 11):**
- `checkTaskReminders` — щохвилинна перевірка дедлайнів + ескалація
- `checkWorkDayTriggers` — тригери початку дня (10:00/12:00), автозадачі піньят/футболок
- `checkMonthlyPointsReset` — обнулення місячних балів 1-го числа

**Telegram бот (+3 команди, всього 10):**
- `/tasks` — мої задачі на сьогодні (з визначенням юзера через telegram_username)
- `/done <id>` — завершити задачу з нарахуванням балів
- `/alltasks` — всі задачі команди, згруповані по виконавцях
- Inline-кнопки: `task_confirm`/`task_reject` для підтвердження

**БД (+4 таблиці, +15 колонок):**
- tasks: +task_type, +owner, +deadline, +time_window_start/end, +dependency_ids, +control_policy, +escalation_level, +source_type, +source_id, +last_reminded_at
- users: +telegram_chat_id, +telegram_username
- Нові: task_logs, user_points, point_transactions

**Файли:**
- `services/kleshnya.js` — новий (центральний процесор)
- `routes/points.js` — новий (API балів)
- `services/bot.js` — +3 команди (/tasks, /done, /alltasks)
- `services/scheduler.js` — +3 scheduler функції
- `routes/tasks.js` — інтеграція з Помічником (logs, owner, task_type)
- `routes/telegram.js` — +task_confirm/reject callbacks, auto-register chat_id
- `server.js` — +points route, +3 schedulers
- `db/index.js` — +4 таблиці, +15 колонок, +12 індексів

---

## v9.1.0 — Live-Sync (2026-02-15)

**WebSocket підключено:**
- `services/websocket.js` підключено до `server.js` через `initWebSocket(server)`
- Graceful shutdown: WSS закривається перед DB pool
- `routes/bookings.js`: broadcast після create/create-full/update/delete
- `routes/lines.js`: broadcast після зміни ліній
- `js/auth.js`: ParkWS.connect() при логіні, disconnect() при logout
- userId coerced to String для коректного excludeUser

**SessionStart hook:**
- `.claude/hooks/session-start.sh`: старт PostgreSQL + npm install + env vars
- Працює тільки в remote (Claude Code на вебі)

---

## v9.0.2 — Доступність (2026-02-15)

- Skip-links на всіх 5 сторінках
- `@media (prefers-reduced-motion: reduce)` — вимкнення анімацій
- programs.html: cache bust v7.9.2 → v9.0.2

---

## v9.0.1 — Стабілізація (2026-02-15)

- Staff toolbar: кнопки винесені в окремий `.schedule-toolbar`
- Cache bust staff.html і tasks.html

---

## v9.0.0 — Розумна платформа (2026-02-15)

- **Drag-and-drop** на таймлайні (мишка/палець + resize + undo)
- **Повторювані бронювання** (шаблони щотижня/через тиждень/щомісяця, авто-генерація 14 днів)
- **Аналітика** (дашборд виручки, топ програм, завантаженість)
- **Оптимістичне блокування** (updated_at + PL/pgSQL тригер + HTTP 409)
- **Offline режим** (Service Worker + IndexedDB mutation queue)
- **Міграції БД** (db/migrate.js + 3 міграції)
- **Тести:** certificates.test.js (82) + automation.test.js (51)

---

## v8.6.1 — Оновлений дизайн сертифікатів (2026-02-14)

- Новий фон + QR у лівий нижній кут (150px замість 216px)

---

## v8.6.0 — Розумний розподіл (2026-02-14)

- Birthday blocks: pill-форма з градієнтом + 🎂 + пульсуюча анімація
- Авто-розподіл афіші перед дайджестами та нагадуваннями

---

## v8.5.0–v8.5.2 — Сертифікати (2026-02-13)

- v8.5.0: Панель сертифікатів (slide-in, статистика, градієнтні картки)
- v8.5.1: Графічні сертифікати (Canvas PNG, Містер Зак)
- v8.5.2: Сезонний маскот (4 seasonal ілюстрації)

---

## v8.4.0 — Сертифікати MVP (2026-02-13)

- Реєстр CERT-YYYY-NNNNN, Telegram-сповіщення, scheduler expiry

---

## v8.3.0–v8.3.3 — Автоматизація + Bugfixes (2026-02-12)

- v8.3.0: Automation rules engine + Drag-to-Move афіша
- v8.3.1: МК Футболки (розміри XS-XL в extra_data, 2 автоматизації)
- v8.3.2: Фікс історії (афіша/автоматизація рендеринг) + extra_data в linked bookings
- v8.3.3: Bugfixes (undo в історії, share/copy invite crash fix)

---

## v7.8–v7.9.2 — Задачі & Програми & Мобільна адаптація (2026-02-11–12)

- v7.8: Standalone Tasks & Programs pages + recurring task templates
- v7.8.1–v7.8.9: Мобільна адаптація (свайп, CSS Grid toolbar, glassmorphism, WCAG 44px touch targets)
- v7.8.10: Дайджест для 2го ведучого + афіша ±1год
- v7.9.0: Дошка задач (5 вкладок, канбан, авто-задачі з афіші, категорії)
- v7.9.2: Стилізовані емодзі іконки з градієнтними колами

---

## v7.0–v7.6.1 — Каталог, Бот, Афіша, Задачник (2026-02-11)

- v7.0: Product Catalog MVP (products таблиця, API, кеш 5хв, seed 40 програм)
- v7.1: Admin CRUD каталогу (create/edit/deactivate, requireRole middleware)
- v7.2: Clawd Bot (7 команд: today/tomorrow/programs/find/price/stats/menu)
- v7.3: Афіша в Telegram (дайджест + нагадування з подіями)
- v7.4: Типи подій (event/birthday/regular), іменинники в Telegram
- v7.5: Задачник MVP (tasks CRUD, статуси todo/in_progress/done, пріоритети)
- v7.6: Афіша → Задачі (генерація, шаблони, каскадне видалення)
- v7.6.1: Переключення ліній аніматорів + z-index bugfix

---

## v6.0 — Test Mode (2026-02-08)

- Безпарольний login: будь-який username → admin role, token 24h
- **УВАГА:** тимчасова версія для тестування

---

## v5.30–v5.51 — UI/UX Overhaul & Design System (2026-02-07–08)

| Версія | Що |
|---|---|
| v5.30 | Design System v4.0 (emerald, CSS tokens, 10-file architecture) |
| v5.31–v5.33 | Segmented controls, program cards, booking panel mobile |
| v5.34–v5.35 | Responsive (4 breakpoints, tablet overlay, desktop grid) |
| v5.36–v5.38 | Афіша/Історія UI, dark mode coverage, favicon/PWA |
| v5.39–v5.41 | Bugfixes, security headers, rate limiting, performance (indexes) |
| v5.42–v5.48 | Design tokens, modals polish, dashboard, invite overhaul, inline cleanup |
| v5.49 | Program search |
| v5.50 | Duplicate booking |
| v5.51 | Undo for edit & shift |

---

## До v5.30

- v5.29: Modular backend (routes/, services/, middleware/)
- v5.28: Structured logging, request IDs
- v5.19: Free rooms, booking linking
- v5.18: Room selection

---

*Формат: останні версії детально, старі — коротко.*
