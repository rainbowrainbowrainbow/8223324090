-- Migration: 023_sales_techniques
-- Description: Sales techniques — upsell tracking, reviews support
-- Date: 2026-02-26
-- Version: v20.5.0

-- Upsell add-ons attached to bookings
CREATE TABLE IF NOT EXISTS booking_upsells (
    id SERIAL PRIMARY KEY,
    booking_id VARCHAR(50) REFERENCES bookings(id) ON DELETE CASCADE,
    upsell_name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_upsells_booking ON booking_upsells(booking_id);

-- Call script templates
CREATE TABLE IF NOT EXISTS call_scripts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upsell suggestions (reusable catalog)
CREATE TABLE IF NOT EXISTS upsell_catalog (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    default_price DECIMAL(10,2) DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default upsell suggestions
INSERT INTO upsell_catalog (name, description, default_price, sort_order) VALUES
    ('Торт від партнера', 'Святковий торт на замовлення', 350.00, 1),
    ('Фотосесія 30 хв', 'Професійна фотосесія на святі', 500.00, 2),
    ('Тематичний декор', 'Прикраса зали за тематикою', 200.00, 3),
    ('Додатковий аніматор', 'Другий ведучий свята', 700.00, 4),
    ('Сувеніри для гостей', 'Подарунки для кожної дитини', 150.00, 5)
ON CONFLICT DO NOTHING;

-- Seed default call script
INSERT INTO call_scripts (name, steps) VALUES
    ('Стандартний скрипт дзвінка', '[
        {"step": 1, "title": "Привітання", "text": "Доброго дня! Мене звати [ім''я], парк Закревського Періоду. Вам зручно зараз говорити?"},
        {"step": 2, "title": "Три Так", "text": "Скільки років виповнюється імениннику? Скільки діток буде на святі? Яку дату розглядаєте?"},
        {"step": 3, "title": "Презентація", "text": "Чудово! Для [вік] років рекомендую програму [назва]. Вона включає [опис]. Діткам дуже подобається!"},
        {"step": 4, "title": "Закриття", "text": "Субота чи неділя Вам зручніше? [Чекаємо відповідь]"},
        {"step": 5, "title": "Заперечення", "text": "Розумію. Можу уточнити — що саме Вас бентежить? [Працюємо із запереченням]"},
        {"step": 6, "title": "Апсейл", "text": "До речі, багато батьків також замовляють торт та фотосесію — хочете додати?"},
        {"step": 7, "title": "Підтвердження", "text": "Чудово! Бронюю [дата], [час], програма [назва]. Передоплата [сума] для підтвердження. Надсилаю реквізити?"}
    ]'::jsonb)
ON CONFLICT DO NOTHING;
