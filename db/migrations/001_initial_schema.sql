-- Migration: 001_initial_schema
-- Description: Baseline schema — all 20 tables, columns, and indexes as of v8.7
-- Date: 2025-05-01
-- Note: Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout.
--       This migration is a safe no-op on an existing database
--       but creates everything needed on a fresh one.

-- ============================================================
-- 1. bookings
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR(50) PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    time VARCHAR(10) NOT NULL,
    line_id VARCHAR(100) NOT NULL,
    program_id VARCHAR(50),
    program_code VARCHAR(20),
    label VARCHAR(100),
    program_name VARCHAR(100),
    category VARCHAR(50),
    duration INTEGER,
    price INTEGER,
    hosts INTEGER,
    second_animator VARCHAR(100),
    pinata_filler VARCHAR(50),
    room VARCHAR(100),
    notes TEXT,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    linked_to VARCHAR(50)
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'confirmed';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS kids_count INTEGER;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS costume VARCHAR(100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS telegram_message_id INTEGER;
-- v8.3
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS extra_data JSONB;

-- ============================================================
-- 2. lines_by_date
-- ============================================================
CREATE TABLE IF NOT EXISTS lines_by_date (
    id SERIAL PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    line_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20),
    from_sheet BOOLEAN DEFAULT FALSE,
    UNIQUE(date, line_id)
);

-- ============================================================
-- 3. history
-- ============================================================
CREATE TABLE IF NOT EXISTS history (
    id SERIAL PRIMARY KEY,
    action VARCHAR(20) NOT NULL,
    username VARCHAR(50),
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 4. settings
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT
);

-- ============================================================
-- 5. pending_animators
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_animators (
    id SERIAL PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    note TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 6. afisha
-- ============================================================
CREATE TABLE IF NOT EXISTS afisha (
    id SERIAL PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    time VARCHAR(10) NOT NULL,
    title VARCHAR(200) NOT NULL,
    duration INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT NOW()
);

-- v7.4
ALTER TABLE afisha ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'event';
-- v8.0
ALTER TABLE afisha ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE afisha ADD COLUMN IF NOT EXISTS template_id INTEGER;
-- v8.3
ALTER TABLE afisha ADD COLUMN IF NOT EXISTS original_time VARCHAR(10);
-- v8.6
ALTER TABLE afisha ADD COLUMN IF NOT EXISTS line_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_afisha_date ON afisha(date);

-- ============================================================
-- 7. afisha_templates (v8.0)
-- ============================================================
CREATE TABLE IF NOT EXISTS afisha_templates (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    time VARCHAR(10) NOT NULL,
    duration INTEGER DEFAULT 60,
    type VARCHAR(20) DEFAULT 'event',
    description TEXT,
    recurrence_pattern VARCHAR(20) NOT NULL DEFAULT 'weekly',
    recurrence_days VARCHAR(50),
    date_from VARCHAR(20),
    date_to VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 8. telegram_known_chats
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_known_chats (
    chat_id BIGINT PRIMARY KEY,
    title VARCHAR(200),
    type VARCHAR(50),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 9. telegram_known_threads
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_known_threads (
    thread_id INTEGER NOT NULL,
    chat_id BIGINT NOT NULL,
    title VARCHAR(200),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (chat_id, thread_id)
);

-- ============================================================
-- 10. users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 11. booking_counter
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_counter (
    year INTEGER PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 12. products (v7.0)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    label VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    icon VARCHAR(10),
    category VARCHAR(50) NOT NULL,
    duration INTEGER NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    hosts INTEGER NOT NULL DEFAULT 1,
    age_range VARCHAR(30),
    kids_capacity VARCHAR(30),
    description TEXT,
    is_per_child BOOLEAN DEFAULT FALSE,
    has_filler BOOLEAN DEFAULT FALSE,
    is_custom BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- ============================================================
-- 13. tasks (v7.5)
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    date VARCHAR(20),
    status VARCHAR(20) DEFAULT 'todo',
    priority VARCHAR(20) DEFAULT 'normal',
    assigned_to VARCHAR(50),
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- v7.6
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS afisha_id INTEGER;
-- v7.8
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'manual';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id INTEGER;
-- v7.9
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'admin';

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
CREATE INDEX IF NOT EXISTS idx_tasks_afisha_id ON tasks(afisha_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_template_id ON tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

-- ============================================================
-- 14. task_templates (v7.8)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_templates (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'normal',
    assigned_to VARCHAR(50),
    recurrence_pattern VARCHAR(20) NOT NULL,
    recurrence_days VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- v7.9
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'admin';

-- ============================================================
-- 15. scheduled_deletions (v7.10)
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_deletions (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    message_id INTEGER NOT NULL,
    delete_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_deletions_delete_at ON scheduled_deletions(delete_at);

-- ============================================================
-- 16. staff (v7.10)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(50) NOT NULL,
    position VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    hire_date VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    color VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

-- v7.10.1
ALTER TABLE staff ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_staff_department ON staff(department);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(is_active);

-- ============================================================
-- 17. staff_schedule (v7.10) — FK to staff
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_schedule (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date VARCHAR(20) NOT NULL,
    shift_start VARCHAR(10),
    shift_end VARCHAR(10),
    status VARCHAR(20) DEFAULT 'working',
    note TEXT,
    UNIQUE(staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedule_date ON staff_schedule(date);
CREATE INDEX IF NOT EXISTS idx_staff_schedule_staff ON staff_schedule(staff_id);

-- ============================================================
-- 18. automation_rules (v8.3)
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    trigger_type VARCHAR(30) NOT NULL DEFAULT 'booking_create',
    trigger_condition JSONB NOT NULL,
    actions JSONB NOT NULL,
    days_before INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 19. certificates (v8.4)
-- ============================================================
CREATE TABLE IF NOT EXISTS certificates (
    id SERIAL PRIMARY KEY,
    cert_code VARCHAR(20) UNIQUE NOT NULL,
    display_mode VARCHAR(10) NOT NULL DEFAULT 'fio',
    display_value VARCHAR(200) NOT NULL,
    type_text VARCHAR(200) NOT NULL DEFAULT 'на одноразовий вхід',
    issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
    valid_until DATE NOT NULL,
    issued_by_user_id INTEGER,
    issued_by_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    used_at TIMESTAMP,
    invalidated_at TIMESTAMP,
    invalid_reason TEXT,
    notes TEXT,
    telegram_alert_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- v8.7
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS season VARCHAR(10) DEFAULT 'winter';

CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status);
CREATE INDEX IF NOT EXISTS idx_certificates_cert_code ON certificates(cert_code);
CREATE INDEX IF NOT EXISTS idx_certificates_valid_until ON certificates(valid_until);

-- ============================================================
-- 20. certificate_counter (v8.4)
-- ============================================================
CREATE TABLE IF NOT EXISTS certificate_counter (
    year INTEGER PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- Bookings indexes (created after all tables)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings(date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_line_date ON bookings(line_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_linked_to ON bookings(linked_to);
CREATE INDEX IF NOT EXISTS idx_lines_by_date_date ON lines_by_date(date);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at);
