-- Migration 012: Art Director v1 — brand memory, content pipeline, approval workflow
-- v18.2.0

-- Brand guidelines (стилі, правила, фото-банк)
CREATE TABLE IF NOT EXISTS brand_guidelines (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,        -- 'color', 'font', 'logo', 'tone', 'rule'
    title VARCHAR(200) NOT NULL,
    value TEXT NOT NULL,                   -- color hex, font name, rule text, logo URL
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Content templates (шаблони: афіша, сертифікат, пост, банер...)
CREATE TABLE IF NOT EXISTS content_templates (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,      -- 'poster_a4', 'ig_story', 'cert_birthday'
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL,         -- 'poster', 'social', 'certificate', 'banner', 'print'
    description TEXT,
    format VARCHAR(20) DEFAULT 'png',      -- 'png', 'jpg', 'pdf', 'svg'
    width INTEGER,                         -- px
    height INTEGER,                        -- px
    fields JSONB DEFAULT '[]',             -- [{name, type, label, default, required}]
    preview_design_id INTEGER REFERENCES designs(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    use_count INTEGER DEFAULT 0,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Content pipeline (конвеєр: задача → шаблон → прев'ю → підтвердження → публікація)
CREATE TABLE IF NOT EXISTS content_items (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    template_id INTEGER REFERENCES content_templates(id) ON DELETE SET NULL,
    template_code VARCHAR(50),
    category VARCHAR(50) NOT NULL,         -- same as template categories
    status VARCHAR(30) DEFAULT 'draft',    -- draft, in_review, approved, rejected, published, archived
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
    field_values JSONB DEFAULT '{}',       -- filled template fields
    design_id INTEGER REFERENCES designs(id) ON DELETE SET NULL,
    notes TEXT,
    due_date VARCHAR(20),                  -- YYYY-MM-DD
    publish_date VARCHAR(20),              -- YYYY-MM-DD
    published_to TEXT,                     -- 'telegram', 'instagram', 'print', comma-separated
    created_by VARCHAR(50),
    assigned_to VARCHAR(50),
    reviewed_by VARCHAR(50),
    reviewed_at TIMESTAMP,
    review_comment TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Content approval log (історія змін статусу)
CREATE TABLE IF NOT EXISTS content_approvals (
    id SERIAL PRIMARY KEY,
    content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    comment TEXT,
    user_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_brand_guidelines_category ON brand_guidelines(category);
CREATE INDEX IF NOT EXISTS idx_content_templates_category ON content_templates(category);
CREATE INDEX IF NOT EXISTS idx_content_templates_code ON content_templates(code);
CREATE INDEX IF NOT EXISTS idx_content_items_status ON content_items(status);
CREATE INDEX IF NOT EXISTS idx_content_items_category ON content_items(category);
CREATE INDEX IF NOT EXISTS idx_content_items_template ON content_items(template_id);
CREATE INDEX IF NOT EXISTS idx_content_items_due ON content_items(due_date);
CREATE INDEX IF NOT EXISTS idx_content_approvals_content ON content_approvals(content_id);

-- Seed: Brand guidelines
INSERT INTO brand_guidelines (category, title, value, description, sort_order) VALUES
    ('color', 'Primary', '#10B981', 'Основний зелений — акценти, кнопки, посилання', 1),
    ('color', 'Primary Dark', '#059669', 'Темний зелений — hover, активні стани', 2),
    ('color', 'Secondary', '#6366F1', 'Індіго — додатковий акцент', 3),
    ('color', 'Background', '#F0FDF4', 'Фон сторінок — світлий зелений', 4),
    ('color', 'Danger', '#EF4444', 'Червоний — помилки, видалення', 5),
    ('font', 'Primary Font', 'Nunito', 'Google Fonts — основний шрифт всюди', 1),
    ('font', 'Heading Weight', '800', 'Extra Bold для заголовків', 2),
    ('font', 'Body Weight', '400', 'Regular для тексту', 3),
    ('tone', 'Стиль комунікації', 'Дружній, веселий, дитячий', 'Тон парку — завжди позитивний, без канцеляризмів', 1),
    ('tone', 'Цільова аудиторія', 'Батьки дітей 3-12 років', 'Основна ЦА для всіх матеріалів', 2),
    ('rule', 'Лого', 'Логотип завжди зверху або зліва', 'Не змінювати пропорції, мін розмір 80px', 1),
    ('rule', 'Емоджі', 'Використовувати помірно', 'Максимум 3 емоджі на пост, не починати з емоджі', 2),
    ('rule', 'Ціни', 'Формат: 1 000 ₴', 'Завжди з пробілом для тисяч, символ ₴ після числа', 3)
ON CONFLICT DO NOTHING;

-- Seed: Content templates (10 шаблонів парку)
INSERT INTO content_templates (code, name, category, description, format, width, height, fields) VALUES
    ('poster_a4', 'Афіша A4', 'poster', 'Стандартна афіша для друку A4', 'pdf', 2480, 3508,
     '[{"name":"title","type":"text","label":"Заголовок","required":true},{"name":"date","type":"date","label":"Дата","required":true},{"name":"time","type":"text","label":"Час","required":true},{"name":"price","type":"text","label":"Ціна"},{"name":"description","type":"textarea","label":"Опис"}]'),
    ('ig_story', 'Instagram Story', 'social', 'Вертикальний формат для Stories', 'png', 1080, 1920,
     '[{"name":"title","type":"text","label":"Заголовок","required":true},{"name":"subtitle","type":"text","label":"Підзаголовок"},{"name":"cta","type":"text","label":"Call to Action","default":"Бронюй зараз!"}]'),
    ('ig_post', 'Instagram Post', 'social', 'Квадратний формат для стрічки', 'png', 1080, 1080,
     '[{"name":"title","type":"text","label":"Заголовок","required":true},{"name":"body","type":"textarea","label":"Текст"},{"name":"hashtags","type":"text","label":"Хештеги"}]'),
    ('tg_post', 'Telegram Post', 'social', 'Горизонтальний банер для Telegram', 'png', 1280, 720,
     '[{"name":"title","type":"text","label":"Заголовок","required":true},{"name":"body","type":"textarea","label":"Текст"},{"name":"link","type":"text","label":"Посилання"}]'),
    ('cert_birthday', 'Сертифікат ДН', 'certificate', 'Іменинний сертифікат для гостей', 'pdf', 2480, 1748,
     '[{"name":"child_name","type":"text","label":"Ім''я дитини","required":true},{"name":"age","type":"text","label":"Вік"},{"name":"date","type":"date","label":"Дата","required":true}]'),
    ('cert_gift', 'Подарунковий сертифікат', 'certificate', 'Подарунковий сертифікат на суму', 'pdf', 2480, 1748,
     '[{"name":"amount","type":"text","label":"Сума","required":true},{"name":"recipient","type":"text","label":"Кому"},{"name":"valid_until","type":"date","label":"Дійсний до"}]'),
    ('banner_site', 'Банер для сайту', 'banner', 'Широкий банер 1920x600', 'png', 1920, 600,
     '[{"name":"title","type":"text","label":"Заголовок","required":true},{"name":"subtitle","type":"text","label":"Підзаголовок"},{"name":"cta","type":"text","label":"Кнопка","default":"Дізнатись більше"}]'),
    ('flyer_a5', 'Флаєр A5', 'print', 'Рекламний флаєр для роздачі', 'pdf', 1748, 2480,
     '[{"name":"title","type":"text","label":"Заголовок","required":true},{"name":"offer","type":"text","label":"Пропозиція"},{"name":"contacts","type":"text","label":"Контакти"}]'),
    ('menu_board', 'Меню-борд', 'print', 'Дошка з цінами/програмами для парку', 'pdf', 3508, 2480,
     '[{"name":"items","type":"textarea","label":"Пункти меню","required":true},{"name":"footer","type":"text","label":"Нижній текст"}]'),
    ('sticker_pack', 'Стікер-пак', 'print', 'Набір наклейок з персонажами парку', 'png', 512, 512,
     '[{"name":"character","type":"text","label":"Персонаж","required":true},{"name":"text","type":"text","label":"Текст на стікері"}]')
ON CONFLICT (code) DO NOTHING;
