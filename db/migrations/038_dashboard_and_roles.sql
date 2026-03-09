-- 038_dashboard_and_roles.sql
-- v22.0.0: Dashboard configs, cache, and role definitions

-- Dashboard user configuration
CREATE TABLE IF NOT EXISTS dashboard_configs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    layout JSONB DEFAULT '{}',
    widgets JSONB DEFAULT '[]',
    theme VARCHAR(20) DEFAULT 'default',
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id)
);

-- External data cache for dashboard widgets (weather, currency, etc.)
CREATE TABLE IF NOT EXISTS dashboard_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(100) UNIQUE NOT NULL,
    data JSONB DEFAULT '{}',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Role definitions reference table
CREATE TABLE IF NOT EXISTS role_definitions (
    id SERIAL PRIMARY KEY,
    role_key VARCHAR(50) UNIQUE NOT NULL,
    name_uk VARCHAR(100) NOT NULL,
    department VARCHAR(50),
    parent_role VARCHAR(50),
    level INTEGER NOT NULL DEFAULT 0,
    permissions JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Seed role definitions (22+ roles)
INSERT INTO role_definitions (role_key, name_uk, department, parent_role, level) VALUES
    ('creator',            'Творець',              'executive',   NULL,               24),
    ('director',           'Директор',             'executive',   'creator',          23),
    ('vice_director',      'Заст. директора',      'executive',   'director',         22),
    ('senior_manager',     'Старший менеджер',     'management',  'vice_director',    21),
    ('manager',            'Менеджер',             'management',  'senior_manager',   20),
    ('accountant',         'Бухгалтер',            'finance',     'senior_manager',   19),
    ('art_director',       'Арт-директор',         'creative',    'senior_manager',   18),
    ('marketer',           'Маркетолог',           'marketing',   'senior_manager',   17),
    ('it_specialist',      'IT-спеціаліст',        'it',          'senior_manager',   16),
    ('hr',                 'HR-менеджер',          'hr',          'senior_manager',   15),
    ('admin',              'Адміністратор',        'operations',  'manager',          14),
    ('senior_instructor',  'Старший інструктор',   'programs',    'admin',            13),
    ('instructor',         'Інструктор',           'programs',    'senior_instructor',12),
    ('head_chef',          'Шеф-кухар',            'kitchen',     'admin',            11),
    ('cook',               'Кухар',                'kitchen',     'head_chef',        10),
    ('head_pastry',        'Шеф-кондитер',         'kitchen',     'admin',            9),
    ('pastry_chef',        'Кондитер',             'kitchen',     'head_pastry',      8),
    ('animator',           'Аніматор',             'programs',    'instructor',       7),
    ('reception',          'Рецепція',             'operations',  'admin',            6),
    ('barista',            'Бариста',              'kitchen',     'head_chef',        5),
    ('wardrobe',           'Гардеробник',          'operations',  'admin',            4),
    ('cleaning',           'Клінінг',              'operations',  'admin',            3),
    ('maintenance',        'Технік',               'operations',  'admin',            2),
    ('dishwasher',         'Посудомийник',          'kitchen',     'head_chef',        1),
    ('waiter',             'Офіціант',             'service',     'admin',            0)
ON CONFLICT (role_key) DO NOTHING;

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_dashboard_cache_key ON dashboard_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_dashboard_cache_expires ON dashboard_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_dashboard_configs_user ON dashboard_configs(user_id);
