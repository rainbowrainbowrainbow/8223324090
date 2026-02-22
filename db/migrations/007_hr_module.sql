-- 007_hr_module.sql
-- HR Module: staff extensions, shifts, time records, templates, audit log

-- ============================================
-- 1. Розширення таблиці staff
-- ============================================
ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(100);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(20);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role_type VARCHAR(30) DEFAULT 'animator';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(8,2) DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS telegram_id VARCHAR(20);

-- ============================================
-- 2. Графік змін (планові)
-- ============================================
CREATE TABLE IF NOT EXISTS hr_shifts (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  planned_start TIME NOT NULL,
  planned_end   TIME NOT NULL,
  break_minutes INTEGER DEFAULT 0,
  shift_type VARCHAR(20) DEFAULT 'regular',
  notes TEXT,
  created_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_id, shift_date)
);

-- ============================================
-- 3. Записи часу (фактичні check-in / check-out)
-- ============================================
CREATE TABLE IF NOT EXISTS hr_time_records (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  clock_in  TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  planned_start TIME,
  planned_end   TIME,
  late_minutes        INTEGER DEFAULT 0,
  early_leave_minutes INTEGER DEFAULT 0,
  overtime_minutes    INTEGER DEFAULT 0,
  total_worked_minutes INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'absent',
  auto_closed BOOLEAN DEFAULT FALSE,
  corrected_by VARCHAR(50),
  corrected_at TIMESTAMPTZ,
  correction_reason TEXT,
  original_clock_in  TIMESTAMPTZ,
  original_clock_out TIMESTAMPTZ,
  ip_address VARCHAR(45),
  user_agent TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(staff_id, record_date)
);

-- ============================================
-- 4. Шаблони змін
-- ============================================
CREATE TABLE IF NOT EXISTS hr_shift_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  planned_start TIME NOT NULL,
  planned_end   TIME NOT NULL,
  break_minutes INTEGER DEFAULT 0,
  shift_type VARCHAR(20) DEFAULT 'regular',
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO hr_shift_templates (name, planned_start, planned_end, break_minutes, is_default) VALUES
  ('Будні', '12:00', '20:00', 30, TRUE),
  ('Вихідні', '10:00', '20:00', 30, FALSE),
  ('Ранкова', '09:00', '15:00', 15, FALSE),
  ('Вечірня', '15:00', '22:00', 15, FALSE),
  ('Подія (повна)', '09:00', '22:00', 60, FALSE)
ON CONFLICT DO NOTHING;

-- ============================================
-- 5. Лог дій HR
-- ============================================
CREATE TABLE IF NOT EXISTS hr_audit_log (
  id SERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,
  staff_id INTEGER REFERENCES staff(id),
  performed_by VARCHAR(50),
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Індекси
-- ============================================
CREATE INDEX IF NOT EXISTS idx_hr_time_date ON hr_time_records(record_date);
CREATE INDEX IF NOT EXISTS idx_hr_time_staff ON hr_time_records(staff_id);
CREATE INDEX IF NOT EXISTS idx_hr_time_status ON hr_time_records(status);
CREATE INDEX IF NOT EXISTS idx_hr_shifts_date ON hr_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_hr_shifts_staff ON hr_shifts(staff_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_hr_audit_date ON hr_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_hr_audit_staff ON hr_audit_log(staff_id);
