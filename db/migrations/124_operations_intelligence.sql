-- v38.3.0: Operations Intelligence — exceptions inbox, event pipeline, NPS follow-up, cleaning chains
-- Based on market research: FEC best practices for AI-first CRM

-- 1. NPS follow-up tracking (extend event_reviews with nps_score + follow_up status)
ALTER TABLE event_reviews ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE event_reviews ADD COLUMN IF NOT EXISTS nps_score INTEGER CHECK (nps_score >= 0 AND nps_score <= 10);
ALTER TABLE event_reviews ADD COLUMN IF NOT EXISTS follow_up_status VARCHAR(20) DEFAULT 'none'; -- none, pending, completed
ALTER TABLE event_reviews ADD COLUMN IF NOT EXISTS follow_up_task_id INTEGER;
ALTER TABLE event_reviews ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_event_reviews_follow_up ON event_reviews (follow_up_status) WHERE follow_up_status != 'none';
CREATE INDEX IF NOT EXISTS idx_event_reviews_nps ON event_reviews (nps_score) WHERE nps_score IS NOT NULL;

-- 2. Event pipeline tracking (booking lifecycle stages)
CREATE TABLE IF NOT EXISTS booking_pipeline (
    id SERIAL PRIMARY KEY,
    booking_id VARCHAR(50) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL, -- lead, confirmed, t24_sent, t3_sent, day_of_prep, checkin, active, completed, nps_sent, nps_received
    completed_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_booking_pipeline_booking ON booking_pipeline (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_pipeline_stage ON booking_pipeline (stage);
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_pipeline_unique ON booking_pipeline (booking_id, stage);

-- 3. Cleaning schedule linked to bookings
CREATE TABLE IF NOT EXISTS cleaning_tasks (
    id SERIAL PRIMARY KEY,
    booking_id VARCHAR(50) REFERENCES bookings(id) ON DELETE SET NULL,
    room VARCHAR(100),
    scheduled_at TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, done, skipped
    assigned_to VARCHAR(200),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    sla_minutes INTEGER DEFAULT 15,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_date ON cleaning_tasks (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_status ON cleaning_tasks (status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_room ON cleaning_tasks (room);

-- 4. Seed event pipeline rules into rule_definitions
INSERT INTO rule_definitions (code, name, trigger_event, conditions, actions, priority, is_active)
VALUES
    -- T-24 reminder
    ('booking_t24_reminder', 'Нагадування за 24 години', 'booking.t24', '{}',
     '[{"type":"send_telegram","template":"📅 Нагадування! Завтра о {time} у вас заплановано свято \"{programName}\" в кімнаті {room}. Не забудьте взяти шкарпетки! 🧦","use_customer_chat":true},{"type":"create_task","title":"Підготовка до свята: {label}","description":"Перевірити готовність кімнати {room}, реквізит для програми {programName}","priority":"high","category":"event","assigned_to":null}]',
     80, true),
    -- Post-event NPS detractor follow-up
    ('nps_detractor_followup', 'NPS детрактор — задача менеджеру', 'review.detractor', '{}',
     '[{"type":"create_task","title":"⚠️ Незадоволений клієнт: {customerName}","description":"Оцінка: {rating}/5 за програму {programName}. Коментар: {comment}. Зателефонувати протягом 2 годин!","priority":"high","category":"admin","assigned_to":null},{"type":"send_telegram","template":"🔴 <b>NPS Detractor</b>\\n\\nКлієнт: {customerName}\\nОцінка: {rating}/5\\nПрограма: {programName}\\nКоментар: {comment}\\n\\nПотрібен зворотній зв''язок!"}]',
     90, true),
    -- Post-event NPS promoter → referral trigger
    ('nps_promoter_referral', 'NPS промоутер — запропонувати реферал', 'review.promoter', '{}',
     '[{"type":"send_telegram","template":"🎉 Дякуємо за оцінку {rating}/5! 💛\\n\\nМи дуже раді, що свято сподобалось!\\nПорекомендуйте нас друзям і отримайте бонус 🎁","use_customer_chat":true}]',
     70, true),
    -- Cleaning task auto-creation
    ('booking_cleaning_auto', 'Авто-прибирання після події', 'booking.completed', '{}',
     '[{"type":"create_task","title":"🧹 Прибирання: {room}","description":"Після програми {programName} ({label}). Перевірити чистоту, зібрати декор, протерти поверхні.","priority":"normal","category":"maintenance","assigned_to":null}]',
     60, true),
    -- Day-of prep checklist
    ('booking_day_prep', 'Чек-лист підготовки в день події', 'booking.day_of', '{}',
     '[{"type":"create_task","title":"📋 Підготовка кімнати {room}: {label}","description":"1. Перевірити реквізит для {programName}\\n2. Налаштувати звук\\n3. Підготувати декор\\n4. Перевірити чистоту","priority":"high","category":"event","assigned_to":null}]',
     85, true)
ON CONFLICT (code) DO NOTHING;
