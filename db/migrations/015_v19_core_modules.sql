-- Migration 015: v19.0.0 — Event Queue, Rule Engine, Print & Assets,
--                          Employee Mapping, Support/SLA, Music Center
-- Date: 2026-02-25
-- Author: [claude-code]

-- ============================================
-- 1. EVENT QUEUE — internal pub/sub
-- ============================================
CREATE TABLE IF NOT EXISTS event_queue (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    next_retry_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_queue_status ON event_queue(status);
CREATE INDEX IF NOT EXISTS idx_event_queue_type ON event_queue(event_type);
CREATE INDEX IF NOT EXISTS idx_event_queue_retry ON event_queue(next_retry_at) WHERE status = 'pending';

-- Dead letter queue for failed events
CREATE TABLE IF NOT EXISTS event_dead_letter (
    id SERIAL PRIMARY KEY,
    original_event_id INTEGER,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    error TEXT,
    moved_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 2. RULE ENGINE v1 — configurable task rules
-- ============================================
CREATE TABLE IF NOT EXISTS rule_definitions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    trigger_event VARCHAR(50) NOT NULL,
    conditions JSONB DEFAULT '{}',
    actions JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rule_execution_log (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER REFERENCES rule_definitions(id) ON DELETE SET NULL,
    event_id INTEGER,
    trigger_event VARCHAR(50),
    result VARCHAR(20) DEFAULT 'success',
    output JSONB DEFAULT '{}',
    error TEXT,
    executed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_definitions_trigger ON rule_definitions(trigger_event);
CREATE INDEX IF NOT EXISTS idx_rule_execution_log_rule ON rule_execution_log(rule_id);

-- Seed rules
INSERT INTO rule_definitions (code, name, description, trigger_event, conditions, actions, priority) VALUES
    ('booking_created_tasks', 'Створити задачі при бронюванні',
     'Автоматично створює задачі підготовки при новому бронюванні',
     'booking.created',
     '{"status": "confirmed"}',
     '[{"type": "create_task", "title": "Підготувати зал {room}", "priority": "high"}, {"type": "create_task", "title": "Перевірити реквізит", "priority": "medium"}]',
     10),
    ('booking_cancelled_notify', 'Сповістити при скасуванні',
     'Надсилає повідомлення в Telegram при скасуванні бронювання',
     'booking.cancelled',
     '{}',
     '[{"type": "send_telegram", "template": "Бронювання {booking_number} скасовано"}]',
     5),
    ('task_overdue_escalate', 'Ескалація прострочених задач',
     'Створює ескалацію якщо задача прострочена більше 2 годин',
     'task.overdue',
     '{"hours_overdue": 2}',
     '[{"type": "escalate", "severity": "high", "notify": true}]',
     8),
    ('cert_created_log', 'Логувати створення сертифікату',
     'Фіксує подію створення сертифікату',
     'certificate.created',
     '{}',
     '[{"type": "log", "message": "Сертифікат {cert_number} створено"}]',
     1),
    ('shift_started_check', 'Перевірка при початку зміни',
     'Перевіряє готовність персоналу при початку робочого дня',
     'shift.started',
     '{"department": "animators"}',
     '[{"type": "create_task", "title": "Ранкова перевірка готовності", "assigned_to": "admin"}]',
     7)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 3. PRINT & ASSETS — template library, preflight
-- ============================================
CREATE TABLE IF NOT EXISTS print_templates (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50) DEFAULT 'certificate',
    format VARCHAR(20) DEFAULT 'A4',
    width_mm INTEGER DEFAULT 210,
    height_mm INTEGER DEFAULT 297,
    dpi INTEGER DEFAULT 300,
    color_space VARCHAR(20) DEFAULT 'CMYK',
    required_fields JSONB DEFAULT '[]',
    font_requirements JSONB DEFAULT '[]',
    version INTEGER DEFAULT 1,
    preview_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES print_templates(id),
    booking_id VARCHAR(50),
    certificate_id INTEGER,
    job_type VARCHAR(30) DEFAULT 'print',
    status VARCHAR(30) DEFAULT 'queued',
    target VARCHAR(30) DEFAULT 'local_printer',
    preflight_result JSONB DEFAULT '{}',
    preflight_passed BOOLEAN,
    data JSONB DEFAULT '{}',
    retry_count INTEGER DEFAULT 0,
    error TEXT,
    printed_by VARCHAR(100),
    queued_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS print_routing_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    condition_type VARCHAR(50) NOT NULL,
    condition_value VARCHAR(200),
    target VARCHAR(50) NOT NULL,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_template ON print_jobs(template_id);

-- Seed print templates
INSERT INTO print_templates (code, name, category, format, width_mm, height_mm, dpi, required_fields, font_requirements) VALUES
    ('cert_birthday', 'Сертифікат — День народження', 'certificate', 'A4', 210, 297, 300,
     '["child_name", "date", "program"]', '["Nunito"]'),
    ('cert_gift', 'Подарунковий сертифікат', 'certificate', 'A5', 210, 148, 300,
     '["value", "valid_until"]', '["Nunito"]'),
    ('invite_standard', 'Запрошення стандартне', 'invitation', 'A6', 148, 105, 300,
     '["child_name", "date", "time", "address"]', '["Nunito"]'),
    ('poster_a3', 'Афіша A3', 'poster', 'A3', 297, 420, 300,
     '["event_name", "date", "time"]', '["Nunito", "Inter"]'),
    ('flyer_a5', 'Флаєр A5', 'flyer', 'A5', 210, 148, 300,
     '["promo_text", "date"]', '["Nunito"]')
ON CONFLICT (code) DO NOTHING;

-- Seed routing rules
INSERT INTO print_routing_rules (name, condition_type, condition_value, target, priority) VALUES
    ('Сертифікати на локальний принтер', 'category', 'certificate', 'local_printer', 10),
    ('Постери великого формату', 'format', 'A3', 'contractor_print', 5),
    ('Флаєри масовий тираж', 'category', 'flyer', 'contractor_print', 3)
ON CONFLICT DO NOTHING;

-- ============================================
-- 4. EMPLOYEE MAPPING — unified identity
-- ============================================
CREATE TABLE IF NOT EXISTS employee_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    telegram_chat_id BIGINT,
    telegram_username VARCHAR(100),
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(200),
    phone VARCHAR(30),
    role VARCHAR(30) DEFAULT 'employee',
    department VARCHAR(50),
    access_modules JSONB DEFAULT '[]',
    permissions JSONB DEFAULT '{}',
    avatar_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    last_activity_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_profiles_user ON employee_profiles(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_profiles_staff ON employee_profiles(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_telegram ON employee_profiles(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_active ON employee_profiles(is_active);

-- ============================================
-- 5. SUPPORT / SLA — tickets, rules, retention
-- ============================================
CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    ticket_number VARCHAR(20) UNIQUE NOT NULL,
    subject VARCHAR(300) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'general',
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(30) DEFAULT 'open',
    source VARCHAR(30) DEFAULT 'manual',
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    assigned_to VARCHAR(100),
    sla_response_minutes INTEGER DEFAULT 120,
    sla_resolve_minutes INTEGER DEFAULT 480,
    first_response_at TIMESTAMP,
    resolved_at TIMESTAMP,
    sla_breached BOOLEAN DEFAULT false,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) DEFAULT 'agent',
    sender_name VARCHAR(100),
    message TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sla_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50),
    priority VARCHAR(20),
    response_minutes INTEGER NOT NULL DEFAULT 120,
    resolve_minutes INTEGER NOT NULL DEFAULT 480,
    escalation_after_minutes INTEGER DEFAULT 60,
    escalation_to VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retention_policies (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    retention_days INTEGER NOT NULL,
    condition_column VARCHAR(100) DEFAULT 'created_at',
    is_active BOOLEAN DEFAULT true,
    last_cleanup_at TIMESTAMP,
    rows_deleted_last INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_sla ON support_tickets(sla_breached);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id);

-- Ticket counter
CREATE TABLE IF NOT EXISTS support_counter (
    id SERIAL PRIMARY KEY,
    current_number INTEGER DEFAULT 0
);
INSERT INTO support_counter (current_number) VALUES (0) ON CONFLICT DO NOTHING;

-- Seed SLA rules
INSERT INTO sla_rules (name, category, priority, response_minutes, resolve_minutes, escalation_after_minutes, escalation_to) VALUES
    ('Критичний — система не працює', 'technical', 'critical', 15, 60, 10, 'admin'),
    ('Високий — функціонал зламаний', 'technical', 'high', 30, 120, 20, 'admin'),
    ('Середній — загальне питання', 'general', 'medium', 120, 480, 60, 'support'),
    ('Низький — побажання', 'feature_request', 'low', 480, 2880, 240, 'support')
ON CONFLICT DO NOTHING;

-- Seed retention policies
INSERT INTO retention_policies (table_name, retention_days, condition_column) VALUES
    ('event_queue', 30, 'created_at'),
    ('event_dead_letter', 90, 'moved_at'),
    ('rule_execution_log', 60, 'executed_at'),
    ('user_action_log', 90, 'timestamp'),
    ('kleshnya_messages', 14, 'created_at'),
    ('history', 180, 'created_at'),
    ('print_jobs', 90, 'queued_at')
ON CONFLICT DO NOTHING;

-- ============================================
-- 6. MUSIC CENTER — announcements & playlists
-- ============================================
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(300) NOT NULL,
    text_content TEXT NOT NULL,
    announcement_type VARCHAR(30) DEFAULT 'promo',
    voice_url VARCHAR(500),
    voice_provider VARCHAR(30) DEFAULT 'manual',
    schedule_type VARCHAR(20) DEFAULT 'once',
    scheduled_at TIMESTAMP,
    repeat_cron VARCHAR(50),
    duration_seconds INTEGER DEFAULT 30,
    priority INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    played_count INTEGER DEFAULT 0,
    last_played_at TIMESTAMP,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'background',
    tracks JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    schedule_start VARCHAR(10),
    schedule_end VARCHAR(10),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS music_log (
    id SERIAL PRIMARY KEY,
    action VARCHAR(30) NOT NULL,
    announcement_id INTEGER REFERENCES announcements(id) ON DELETE SET NULL,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled ON announcements(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_playlists_active ON playlists(is_active);

-- Seed playlists
INSERT INTO playlists (name, description, category, schedule_start, schedule_end, tracks) VALUES
    ('Фонова музика — Ранок', 'Легка музика для ранкових годин', 'background', '09:00', '12:00',
     '[{"title": "Happy Morning", "duration": 180}, {"title": "Sunny Day", "duration": 210}]'),
    ('Фонова музика — День', 'Енергійна музика для активних годин', 'background', '12:00', '18:00',
     '[{"title": "Party Time", "duration": 195}, {"title": "Fun Factory", "duration": 200}]'),
    ('Фонова музика — Вечір', 'Спокійна музика для вечірніх годин', 'background', '18:00', '21:00',
     '[{"title": "Evening Chill", "duration": 240}, {"title": "Calm Waves", "duration": 220}]')
ON CONFLICT DO NOTHING;

-- Seed announcements
INSERT INTO announcements (title, text_content, announcement_type, schedule_type, status, priority) VALUES
    ('Акція: День народження -20%', 'Шановні відвідувачі! Святкуйте день народження у нашому парку зі знижкою 20%!', 'promo', 'recurring', 'active', 5),
    ('Правила безпеки', 'Нагадуємо про правила безпеки. Діти до 5 років мають бути з дорослими.', 'safety', 'recurring', 'active', 10),
    ('Закриття через 30 хвилин', 'Увага! Парк закривається через 30 хвилин. Дякуємо за візит!', 'info', 'once', 'draft', 8)
ON CONFLICT DO NOTHING;
