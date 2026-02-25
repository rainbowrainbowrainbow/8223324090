-- Migration 013: Demo mode + Packages + Feature flags
-- v18.3.0

-- Service packages (Starter/Business/Lite)
CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,          -- 'starter', 'business', 'lite'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_monthly INTEGER DEFAULT 0,            -- UAH per month
    features JSONB DEFAULT '{}',                -- {bookings_limit, workers_limit, crab_calls_day, ...}
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Feature flags (per-instance feature toggling)
CREATE TABLE IF NOT EXISTS feature_flags (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN DEFAULT FALSE,
    package_min VARCHAR(50),                    -- minimum package required: 'starter', 'business'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Demo scenarios (guided walkthroughs for sales demos)
CREATE TABLE IF NOT EXISTS demo_scenarios (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,              -- 'booking', 'print', 'hr', 'boss', 'art-director'
    steps JSONB DEFAULT '[]',                   -- [{order, title, description, action, target_url, highlight}]
    duration_minutes INTEGER DEFAULT 5,
    icon VARCHAR(10) DEFAULT '🎯',
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    run_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Demo sessions (tracking demo playback)
CREATE TABLE IF NOT EXISTS demo_sessions (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER REFERENCES demo_scenarios(id) ON DELETE CASCADE,
    user_name VARCHAR(100),
    company_name VARCHAR(200),
    current_step INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'started',       -- started, in_progress, completed, abandoned
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    feedback TEXT,
    rating INTEGER                              -- 1-5
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_feature_flags_code ON feature_flags(code);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(is_enabled);
CREATE INDEX IF NOT EXISTS idx_demo_scenarios_category ON demo_scenarios(category);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_scenario ON demo_sessions(scenario_id);
CREATE INDEX IF NOT EXISTS idx_demo_sessions_status ON demo_sessions(status);

-- Seed: Packages
INSERT INTO packages (code, name, description, price_monthly, features, sort_order) VALUES
    ('starter', 'Starter', 'Базовий пакет для малих парків', 2990,
     '{"bookings_limit": 200, "workers_limit": 3, "crab_calls_day": 10, "modules": ["timeline", "bookings", "tasks", "programs", "staff"], "storage_gb": 5}',
     1),
    ('business', 'Business', 'Повний пакет для середніх та великих парків', 7990,
     '{"bookings_limit": -1, "workers_limit": 10, "crab_calls_day": 100, "modules": ["timeline", "bookings", "tasks", "programs", "staff", "hr", "designs", "customers", "finance", "analytics", "warehouse", "center", "art-director"], "storage_gb": 50}',
     2),
    ('lite', 'Lite', 'Без AI — тільки ядро + ролі', 990,
     '{"bookings_limit": 100, "workers_limit": 1, "crab_calls_day": 0, "modules": ["timeline", "bookings", "tasks", "programs", "staff"], "storage_gb": 2}',
     3)
ON CONFLICT (code) DO NOTHING;

-- Seed: Feature flags
INSERT INTO feature_flags (code, name, description, is_enabled, package_min) VALUES
    ('demo_mode', 'Demo режим', 'Дозволяє гостьовий вхід без реєстрації', false, null),
    ('crab_chat', 'Клешня Chat', 'AI-чат з Клешнею', true, 'starter'),
    ('art_director', 'Art Director', 'Контентний конвеєр + Brand Memory', true, 'business'),
    ('finance_module', 'Фінанси', 'Каса, P&L, зарплати', true, 'business'),
    ('analytics_module', 'Аналітика', 'Дашборд з графіками', true, 'starter'),
    ('hr_module', 'HR', 'Зміни, clock-in/out, табелі', true, 'business'),
    ('warehouse_module', 'Склад', 'Товари, інвентаризація', true, 'business'),
    ('center_module', 'Центр керування', 'Boss dashboard з KPI', true, 'business'),
    ('customers_module', 'CRM', 'Клієнтська база, RFM', true, 'business'),
    ('export_excel', 'Експорт Excel', 'Вивантаження даних у Excel', true, 'starter'),
    ('telegram_bot', 'Telegram Bot', 'Сповіщення та команди', true, 'starter'),
    ('auto_tasks', 'Авто-задачі', 'Автоматичне створення задач з бронювань', true, 'starter'),
    ('recurring_bookings', 'Повторні бронювання', 'Автоматичне створення за шаблоном', true, 'business'),
    ('certificates', 'Сертифікати', 'Генерація сертифікатів з QR', true, 'starter'),
    ('dark_mode', 'Темна тема', 'Автоматична та ручна темна тема', true, null)
ON CONFLICT (code) DO NOTHING;

-- Seed: 5 Demo scenarios
INSERT INTO demo_scenarios (code, title, description, category, icon, duration_minutes, sort_order, steps) VALUES
    ('booking_flow', 'Бронювання від А до Я', 'Повний цикл: створення → підтвердження → оплата → аніматор', 'booking', '📅', 5, 1,
     '[{"order":1,"title":"Створення бронювання","description":"Натисніть + на таймлайні, оберіть час і кімнату","action":"navigate","target_url":"/","highlight":"#addBookingBtn"},{"order":2,"title":"Заповнення форми","description":"Введіть ім\u0027я, телефон, оберіть програму та аніматора","action":"fill_form","target_url":"/"},{"order":3,"title":"Підтвердження","description":"Бронювання з\u0027являється на таймлайні, статус — підтверджене","action":"observe","target_url":"/"},{"order":4,"title":"Telegram сповіщення","description":"Аніматор отримує повідомлення в Telegram автоматично","action":"observe","target_url":"/"},{"order":5,"title":"Автозадачі","description":"Система автоматично створила задачі на підготовку кімнати","action":"navigate","target_url":"/tasks"}]'),

    ('print_cert', 'Друк сертифікату', 'Створення іменного сертифікату з QR-кодом', 'print', '🎓', 3, 2,
     '[{"order":1,"title":"Каталог сертифікатів","description":"Відкрийте розділ Сертифікати в налаштуваннях","action":"navigate","target_url":"/","highlight":"#settingsBtn"},{"order":2,"title":"Генерація","description":"Введіть ім\u0027я дитини, оберіть шаблон, згенеруйте","action":"fill_form","target_url":"/"},{"order":3,"title":"Перевірка QR","description":"QR-код містить унікальний номер для верифікації","action":"observe","target_url":"/"}]'),

    ('hr_shift', 'Робочі зміни', 'Clock-in/out, табелі, контроль запізнень', 'hr', '👥', 4, 3,
     '[{"order":1,"title":"Графік роботи","description":"Відкрийте розділ Графік — розклад змін на тиждень","action":"navigate","target_url":"/staff"},{"order":2,"title":"HR панель","description":"Зміни, clock-in/out, табелі, нарахування зарплат","action":"navigate","target_url":"/hr"},{"order":3,"title":"Контроль","description":"Система фіксує запізнення та повідомляє адміна","action":"observe","target_url":"/hr"},{"order":4,"title":"Зарплати","description":"Автоматичний розрахунок на основі відпрацьованих годин","action":"navigate","target_url":"/finance"}]'),

    ('boss_kpi', 'Центр керування', 'KPI дашборд, Digital Workers, цінова матриця', 'boss', '🧠', 4, 4,
     '[{"order":1,"title":"Огляд системи","description":"Центр керування — єдине вікно для бос-рівня","action":"navigate","target_url":"/center"},{"order":2,"title":"Digital Workers","description":"Статус усіх AI-воркерів в реальному часі","action":"observe","target_url":"/center"},{"order":3,"title":"KPI","description":"Виручка, бронювання, середній чек — сьогодні/тиждень/місяць","action":"observe","target_url":"/center"},{"order":4,"title":"Цінова матриця","description":"Централізоване управління цінами з миттєвим оновленням","action":"observe","target_url":"/center"}]'),

    ('art_content', 'Art Director — контент', 'Контентний конвеєр: шаблон → прев\u0027ю → публікація', 'art-director', '🎬', 5, 5,
     '[{"order":1,"title":"Brand Book","description":"Кольори, шрифти, тон комунікації — все в одному місці","action":"navigate","target_url":"/art-director"},{"order":2,"title":"Шаблони","description":"10 готових шаблонів: афіші, соцмережі, сертифікати, банери","action":"navigate","target_url":"/art-director"},{"order":3,"title":"Створення контенту","description":"Оберіть шаблон, заповніть поля, відправте на перевірку","action":"fill_form","target_url":"/art-director"},{"order":4,"title":"Approval workflow","description":"Чернетка → Перевірка → Затвердження → Публікація","action":"observe","target_url":"/art-director"},{"order":5,"title":"Публікація","description":"Затверджений контент можна відправити в Telegram чи на друк","action":"observe","target_url":"/art-director"}]')
ON CONFLICT (code) DO NOTHING;
