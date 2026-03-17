# GRADUATION-QA-REPORT.md

## Дата перевірки: 14.03.2026
## Branch: claude/continue-project-work-EAhTA
## Commit: 5e6a38f (v30.1.0)
## Перевірив: Claude Code

---

### ✅ Працює коректно

- **Міграція DDL** — таблиці graduation_settings, graduation_services, graduation_packages, graduation_package_items, graduation_quotes створюються без помилок
- **Типи даних** — SERIAL, JSONB, TIMESTAMP, REAL — правильні для PostgreSQL 16
- **Індекси** — idx_grad_services_category, idx_grad_services_active, idx_grad_quotes_status, idx_grad_quotes_number створені
- **entry_rule** — JSONB `{"8":1,"16":2,"99":3}` парситься коректно, pg driver повертає JS object
- **Формули ціноутворення** — ROUNDUP(price_park / coefficient * markup, -1) працює коректно:
  - Анімація: 1300/6×1.15 = 249.17 → 250 ✓
  - Анімація 2г: 2400/6×1.15 = 460 ✓
  - Шоу Бульбашок: 2000/6×1.15 = 383.33 → 390 ✓
  - Тату: 640/6×1.15 = 122.67 → 130 ✓
- **GET /api/graduation/settings** — 5 параметрів повертаються коректно
- **PUT /api/graduation/settings** — оновлення з транзакцією (BEGIN/COMMIT/ROLLBACK) працює
- **PUT /api/graduation/services/:id** — оновлення з COALESCE працює
- **POST /api/graduation/quotes** — створення кошика, генерація GRAD-YYYY-NNN працює
- **GET /api/graduation/quotes** — список з фільтром по статусу працює
- **GET /api/graduation/quotes/:id** — деталі, selected_services парситься як JSONB (не подвійна серіалізація)
- **PUT /api/graduation/quotes/:id** — оновлення працює
- **PATCH /api/graduation/quotes/:id/status** — валідація 5 статусів працює
- **Авторизація endpoints** — requireRole працює на quotes (manager+), settings PUT (director+), services PUT (director+)
- **mapServiceRow / mapQuoteRow** — snake_case→camelCase маплення повне
- **pool / requireRole / createLogger** — імпорти коректні
- **server.js** — route `/api/graduation` підключений (line 165), GET `/graduation` (line 290)
- **Tab switching** — 4 таби працюють, settings прихований для не-director
- **Checkbox toggle** — вибір оновлює підсумки
- **Kids stepper** — +/- працює, min=1, max=99
- **Знижка** — перерахунок правильний
- **Коефіцієнт/Надбавка** — видно тільки director
- **Entry rule** — calcEntryCount: 8 дітей=1, 9-16=2, 17+=3 — логіка правильна
- **МК формула** — cost = total_svc × 80% — коректно
- **Динамічні витрати** — ШДМ=kids×5, аквагрим=kids×5, друк=kids×10, напої=kids×70 — включені
- **Мінімум 599₴** — валідація показує червону рамку і текст
- **Відкат 10%** — видно тільки creator
- **Info popup** — відкривається, показує опис, ціну, собівартість (director)
- **Збереження кошика** — POST працює
- **Завантаження кошика** — відновлює вибір, кількість дітей, знижку
- **CSS** — Dark theme (#0D0D0D, gold #C9A84C), glassmorphism, responsive breakpoints 768px/480px
- **Touch targets** — min-height: 44px на кнопках, табах, інпутах (WCAG 2.1)
- **Font-size inputs** — 16px (iOS zoom prevention)
- **Embedded mode** — `?embedded=1` ховає sidebar та header
- **toLocaleString('uk-UA')** — працює на сервері (node 22)
- **selected_services JSONB** — зберігається та читається правильно, без подвійного JSON.stringify

---

### ❌ Знайдені баги

#### 1. **[КРИТИЧНО]** Дублювання послуг — 50 замість 25
- **Де:** db/migrations/072_graduation.sql, строка 128
- **Опис:** `ON CONFLICT DO NOTHING` на INSERT для graduation_services не працює, бо немає UNIQUE constraint на name або sort_order. Є тільки `id SERIAL PRIMARY KEY`, тому кожен запуск міграції додає 25 нових рядків.
- **Відтворення:** Запустити міграцію двічі → 50 записів
- **Вплив:** Конструктор показує кожну послугу ДВІЧІ, пакети містять дублікати (10 сервісів замість 5)

#### 2. **[КРИТИЧНО]** Booking creation fails — column "room_id" doesn't exist
- **Де:** routes/graduation.js:444
- **Опис:** INSERT в bookings використовує `room_id`, але таблиця bookings має колонку `room` (varchar). Також `line_id` є NOT NULL, але не передається в INSERT.
- **Відтворення:** POST /api/graduation/quotes/:id/booking → 500 Internal Server Error
- **Помилка:** `column "room_id" of relation "bookings" does not exist`

#### 3. **[КРИТИЧНО]** КП proposal — 401 при відкритті в новому вікні
- **Де:** routes/graduation.js:480, js/graduation.js:631
- **Опис:** Frontend відкриває `window.open(url?token=...)`, але middleware/auth.js читає тільки `req.headers['authorization']`. Token в query string ігнорується → 401.
- **Відтворення:** Натиснути "КП клієнту" → зберігає кошик → відкриває пусту сторінку з 401

#### 4. **[СЕРЕДНЄ]** art-director.html — cache-bust desync v25.3.0
- **Де:** art-director.html, рядки 10-22, 565-571
- **Опис:** Всі `?v=` теги залишились на v25.3.0, тоді як проект вже v30.1.0. Браузер може показувати застарілий CSS/JS з кешу.

#### 5. **[СЕРЕДНЄ]** art-director.html — дублікат CSS includes
- **Де:** art-director.html, рядки 10-15 та 16-21
- **Опис:** 6 CSS файлів (base, layout, pages, modals, dark-mode, responsive) підключені ДВІЧІ

#### 6. **[СЕРЕДНЄ]** filterQuotes — implicit `event` object
- **Де:** js/graduation.js:730
- **Опис:** `event.target.classList.add('active')` використовує глобальний `event` замість параметра функції. Працює в Chrome, може не працювати в Firefox strict mode.
- **Код:** `onclick="GradPage.filterQuotes('draft')"` не передає event

#### 7. **[НИЗЬКО]** Duplicate CSS file references in graduation.html — css/role-panel.css loaded but role-panel.js conditionally loaded
- **Де:** graduation.html:17
- **Опис:** CSS для role-panel завантажується завжди, але JS тільки в standalone mode. Мінорна неефективність.

---

### ⚠️ Потенційні проблеми

1. **Коефіцієнт/Надбавка зміни локальні** — при зміні в конструкторі зберігаються тільки в JS об'єкт settings, НЕ на сервер. Це by design (не всі хочуть зберігати тестові зміни), але може збивати з пантелику.

2. **loadQuote → recalc після setTimeout(50ms)** — race condition теоретично можливий, але на практиці 50ms достатньо для DOM рендеру.

3. **"Скинути до стандартних" кнопка** — просто перезавантажує з сервера, але якщо ціни були змінені на сервері через PUT, "стандартні" будуть вже зміненими. Назва вводить в оману.

4. **formatUAH на сервері** — `toLocaleString('uk-UA')` працює в node 22, але може відрізнятись на інших серверах/Docker без ICU data.

---

### 📋 Рекомендації

1. Додати UNIQUE constraint на `(name, sort_order)` або `(name)` в graduation_services для запобігання дублів
2. Очистити дублікати з БД
3. Виправити INSERT в bookings: room замість room_id, додати line_id
4. Підтримати token в query string для proposal endpoint
5. Синхронізувати cache-bust версії в art-director.html
6. Передавати event як параметр у filterQuotes
