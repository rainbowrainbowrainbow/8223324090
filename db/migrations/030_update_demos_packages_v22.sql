-- Migration 030: Update demo scenarios + packages to v22.3
-- Reflects new features: Dashboard, Messenger, Gamification, Finance, HR improvements
-- Updated pricing model per business plan 09.03.2026

-- ==========================================
-- UPDATE PACKAGES (new pricing model)
-- ==========================================

-- Starter → Базовий (2000₴)
UPDATE packages SET
    name = 'Базовий',
    description = 'CRM, месенджер, графік змін, задачі, центр цін, бронювання, клієнтська база, сертифікати',
    price_monthly = 2000,
    features = '{"bookings_limit": -1, "workers_limit": 5, "crab_calls_day": 10, "modules": ["timeline", "bookings", "tasks", "programs", "staff", "customers", "certificates", "messenger", "center"], "storage_gb": 10}',
    sort_order = 1
WHERE code = 'starter';

-- Lite → Базовий + HR (4000₴)
UPDATE packages SET
    code = 'hr',
    name = 'Базовий + HR',
    description = 'Найм, навчання, зарплати, премії/депремії, аналітика по персоналу, контроль функцій',
    price_monthly = 4000,
    features = '{"bookings_limit": -1, "workers_limit": 10, "crab_calls_day": 50, "modules": ["timeline", "bookings", "tasks", "programs", "staff", "customers", "certificates", "messenger", "center", "hr", "finance", "training"], "storage_gb": 25}',
    sort_order = 2
WHERE code = 'lite';

-- Business → Повний (9000₴)
UPDATE packages SET
    name = 'Повний',
    description = 'Все включено: Базовий + HR + Art Director + Dashboard + Gamification',
    price_monthly = 9000,
    features = '{"bookings_limit": -1, "workers_limit": -1, "crab_calls_day": -1, "modules": ["timeline", "bookings", "tasks", "programs", "staff", "hr", "designs", "customers", "finance", "analytics", "warehouse", "center", "art-director", "messenger", "training", "gamification", "dashboard"], "storage_gb": 100}',
    sort_order = 3
WHERE code = 'business';

-- Add Art Director package if not exists
INSERT INTO packages (code, name, description, price_monthly, features, sort_order) VALUES
    ('art_director', 'Базовий + Art Director', 'Каталоги (автоціни), афіші, квести, автопіньята, брендинг, сценарії, програми', 7000,
     '{"bookings_limit": -1, "workers_limit": 10, "crab_calls_day": 100, "modules": ["timeline", "bookings", "tasks", "programs", "staff", "customers", "certificates", "messenger", "center", "art-director", "designs"], "storage_gb": 50}',
     4)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    price_monthly = EXCLUDED.price_monthly,
    features = EXCLUDED.features,
    sort_order = EXCLUDED.sort_order;

-- ==========================================
-- UPDATE DEMO SCENARIOS (v22.3 features)
-- ==========================================

-- 1. Бронювання від А до Я — оновлені кроки з месенджером та CRM
UPDATE demo_scenarios SET
    description = 'Повний цикл: створення → CRM-картка → месенджер → оплата → аніматор',
    steps = '[
        {"order":1,"title":"Створення бронювання","description":"Натисніть + на таймлайні, оберіть час і кімнату. Dashboard покаже нове бронювання у віджеті.","action":"navigate","target_url":"/","highlight":"#addBookingBtn"},
        {"order":2,"title":"Заповнення форми","description":"Введіть ім\u0027я, телефон, оберіть програму та аніматора. CRM автоматично створить картку клієнта.","action":"fill_form","target_url":"/"},
        {"order":3,"title":"Підтвердження та сповіщення","description":"Бронювання з\u0027являється на таймлайні. Аніматор отримує повідомлення в Telegram та месенджер.","action":"observe","target_url":"/"},
        {"order":4,"title":"Автозадачі","description":"Система автоматично створила задачі на підготовку кімнати та сповістила відповідальних.","action":"navigate","target_url":"/tasks"},
        {"order":5,"title":"Завершення та XP","description":"Після події аніматор отримує XP та монети в системі гейміфікації.","action":"navigate","target_url":"/"}
    ]'
WHERE code = 'booking_flow';

-- 2. Друк сертифікату — без змін, тільки опис
UPDATE demo_scenarios SET
    description = 'Створення іменного сертифікату з QR-кодом та автоматичним обліком'
WHERE code = 'print_cert';

-- 3. Робочі зміни — оновлено з навчанням та гейміфікацією
UPDATE demo_scenarios SET
    title = 'HR та Робочі зміни',
    description = 'Clock-in/out, табелі, навчання, зарплати, гейміфікація персоналу',
    steps = '[
        {"order":1,"title":"Графік роботи","description":"Розклад змін на тиждень з drag-and-drop розподілом аніматорів","action":"navigate","target_url":"/staff"},
        {"order":2,"title":"HR панель","description":"Clock-in/out, контроль запізнень, статистика по кожному працівнику","action":"navigate","target_url":"/hr"},
        {"order":3,"title":"Навчання","description":"База знань з матеріалами, категоріями та топ-контриб\u0027юторами","action":"navigate","target_url":"/training"},
        {"order":4,"title":"Зарплати та фінанси","description":"Автоматичний розрахунок зарплат, доходи/витрати, бюджет по місяцях","action":"navigate","target_url":"/finance"}
    ]'
WHERE code = 'hr_shift';

-- 4. Центр керування — оновлено з Dashboard та AI Team
UPDATE demo_scenarios SET
    description = 'Dashboard з віджетами, KPI, Digital Workers, цінова матриця',
    steps = '[
        {"order":1,"title":"Dashboard","description":"Головна сторінка з віджетами: бронювання на сьогодні, дохід, команда, задачі","action":"navigate","target_url":"/"},
        {"order":2,"title":"Центр керування","description":"Єдине вікно для бос-рівня: KPI, статистика, управління","action":"navigate","target_url":"/center"},
        {"order":3,"title":"AI Команда","description":"Digital Workers — статус усіх AI-воркерів в реальному часі, задачі для них","action":"observe","target_url":"/hr"},
        {"order":4,"title":"Аналітика","description":"Графіки виручки, бронювань, середнього чека по дням/тижнях/місяцях","action":"navigate","target_url":"/center"}
    ]'
WHERE code = 'boss_kpi';

-- 5. Art Director — оновлено з квестами та автопіньятою
UPDATE demo_scenarios SET
    description = 'Контентний конвеєр: Brand Book → шаблони → створення → публікація',
    steps = '[
        {"order":1,"title":"Brand Book","description":"Кольори, шрифти, тон комунікації, логотипи — все в одному місці","action":"navigate","target_url":"/art-director"},
        {"order":2,"title":"Каталоги та ціни","description":"Автоматичне оновлення цін у каталогах програм та послуг","action":"navigate","target_url":"/art-director"},
        {"order":3,"title":"Створення контенту","description":"Оберіть шаблон (афіша, соцмережі, банер), заповніть поля","action":"fill_form","target_url":"/art-director"},
        {"order":4,"title":"Approval → Публікація","description":"Чернетка → Перевірка → Затвердження → Відправка в Telegram/друк","action":"observe","target_url":"/art-director"},
        {"order":5,"title":"Друк через партнера","description":"Затверджені матеріали можна замовити на друк прямо з системи","action":"observe","target_url":"/art-director"}
    ]'
WHERE code = 'art_content';

-- 6. NEW: Gamification scenario
INSERT INTO demo_scenarios (code, title, description, category, icon, duration_minutes, sort_order, steps) VALUES
    ('gamification', 'Гейміфікація команди', 'XP, рівні, монети, досягнення, магазин нагород, лідерборд', 'hr', '🎮', 4, 6,
     '[
        {"order":1,"title":"Профіль гравця","description":"Натисніть на нікнейм — відкриється профіль з табом Гра: рівень, XP, монети, досягнення","action":"navigate","target_url":"/"},
        {"order":2,"title":"Досягнення","description":"20 досягнень за різні дії: бронювання, задачі, навчання, командна робота","action":"observe","target_url":"/"},
        {"order":3,"title":"Магазин нагород","description":"Обмін монет на реальні нагороди: вихідні, бонуси, мерч","action":"observe","target_url":"/"},
        {"order":4,"title":"Лідерборд","description":"Таблиця лідерів серед команди — хто найбільше XP зібрав","action":"observe","target_url":"/"}
     ]')
ON CONFLICT (code) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    steps = EXCLUDED.steps,
    duration_minutes = EXCLUDED.duration_minutes,
    sort_order = EXCLUDED.sort_order;

-- 7. NEW: Finance scenario
INSERT INTO demo_scenarios (code, title, description, category, icon, duration_minutes, sort_order, steps) VALUES
    ('finance_flow', 'Фінанси та звіти', 'Доходи, витрати, P&L, зарплати, бюджет по категоріях', 'boss', '💰', 4, 7,
     '[
        {"order":1,"title":"Дашборд фінансів","description":"Загальні показники: доходи, витрати, прибуток, бронювання за місяць","action":"navigate","target_url":"/finance"},
        {"order":2,"title":"Транзакції","description":"Повний журнал з фільтрами по типу, категорії, даті та способу оплати","action":"observe","target_url":"/finance"},
        {"order":3,"title":"Звіт по місяцях","description":"Графік доходів/витрат/прибутку з таблицею за рік","action":"observe","target_url":"/finance"},
        {"order":4,"title":"Бюджет","description":"Плановий vs фактичний бюджет по категоріях витрат","action":"observe","target_url":"/finance"}
     ]')
ON CONFLICT (code) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    steps = EXCLUDED.steps,
    duration_minutes = EXCLUDED.duration_minutes,
    sort_order = EXCLUDED.sort_order;

-- ==========================================
-- UPDATE FEATURE FLAGS (add new features)
-- ==========================================

INSERT INTO feature_flags (code, name, description, is_enabled, package_min) VALUES
    ('gamification', 'Гейміфікація', 'XP, рівні, монети, досягнення, магазин, лідерборд', true, 'business'),
    ('messenger', 'Месенджер', 'Внутрішній чат з емодзі, реакціями, lightbox', true, 'starter'),
    ('dashboard', 'Dashboard', 'Головна сторінка з віджетами та статистикою', true, 'starter'),
    ('training_module', 'Навчання', 'База знань, матеріали, weekly prompts', true, 'business')
ON CONFLICT (code) DO NOTHING;
