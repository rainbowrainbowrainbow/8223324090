-- Migration 078: HR Improvements v30.7.0
-- Leave requests, certifications, onboarding, costumes, availability, ratings

-- 1. Leave requests
CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('vacation', 'sick', 'day_off', 'unpaid')),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  days INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_staff ON leave_requests(staff_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(date_from, date_to);

-- 2. Staff certifications
CREATE TABLE IF NOT EXISTS staff_certifications (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) DEFAULT 'general',
  issued_at DATE,
  expires_at DATE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  training_id INTEGER,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_certs_staff ON staff_certifications(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_certs_expires ON staff_certifications(expires_at);

-- 3. Onboarding checklists
CREATE TABLE IF NOT EXISTS onboarding_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  department VARCHAR(50),
  items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES onboarding_templates(id),
  items JSONB NOT NULL DEFAULT '[]',
  completed_items INTEGER DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_staff ON onboarding_progress(staff_id);

-- 4. Costumes / wardrobe
CREATE TABLE IF NOT EXISTS costumes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) DEFAULT 'general',
  size VARCHAR(20),
  condition VARCHAR(20) DEFAULT 'good' CHECK (condition IN ('new', 'good', 'worn', 'damaged', 'retired')),
  assigned_to INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP,
  photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_costumes_assigned ON costumes(assigned_to);

-- 5. Staff availability (real-time status)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) DEFAULT 'offline';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS availability_updated_at TIMESTAMP;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS current_booking_id VARCHAR(50);

-- 6. Staff ratings
ALTER TABLE staff ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS total_events INTEGER DEFAULT 0;

-- 7. Salary bonuses/deductions tracking
CREATE TABLE IF NOT EXISTS salary_adjustments (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  month VARCHAR(7) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('bonus', 'deduction', 'penalty', 'tip')),
  amount INTEGER NOT NULL,
  reason TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salary_adj_staff ON salary_adjustments(staff_id, month);

-- Seed default onboarding template
INSERT INTO onboarding_templates (name, department, items) VALUES
('Стандартний онбординг', NULL, '[
  {"title": "Ознайомлення з правилами парку", "description": "Прочитати та підписати правила"},
  {"title": "Пожежна безпека", "description": "Пройти інструктаж з пожежної безпеки"},
  {"title": "Перша допомога", "description": "Базовий курс першої допомоги"},
  {"title": "Знайомство з командою", "description": "Представлення колегам"},
  {"title": "Навчання по касі", "description": "Робота з касовим апаратом"},
  {"title": "Знання програм", "description": "Вивчити всі програми розваг"},
  {"title": "Пробний день", "description": "Провести зміну під наглядом наставника"},
  {"title": "Робота з CRM", "description": "Навчитися працювати з системою бронювання"}
]'::jsonb)
ON CONFLICT DO NOTHING;
