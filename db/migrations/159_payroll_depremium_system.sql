-- v43.0: Payroll Compliance Layer — depremium templates, audit log, salary_adjustments enrichment
-- Система депреміювання з 19 офіційними шаблонами порушень

-- 1. Каталог шаблонів депреміювань
CREATE TABLE IF NOT EXISTS depremium_templates (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    title TEXT NOT NULL,
    official_reason TEXT NOT NULL,
    amount NUMERIC(10,2),
    penalty_mode VARCHAR(30) DEFAULT 'fixed',
    discipline_category VARCHAR(50) DEFAULT 'general',
    severity VARCHAR(20) DEFAULT 'medium',
    is_repeat_offense BOOLEAN DEFAULT false,
    repeat_of_template_id INTEGER,
    requires_manual_review BOOLEAN DEFAULT false,
    can_be_edited BOOLEAN DEFAULT true,
    active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_depremium_templates_active ON depremium_templates(active, sort_order);

-- 2. Розширення salary_adjustments для compliance
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES depremium_templates(id);
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS rule_code VARCHAR(20);
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS discipline_category VARCHAR(50);
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS severity VARCHAR(20);
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS repeat_index INTEGER DEFAULT 0;
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS decision_mode VARCHAR(20) DEFAULT 'custom';
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'applied';
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100);
ALTER TABLE salary_adjustments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_salary_adj_template ON salary_adjustments(template_id);
CREATE INDEX IF NOT EXISTS idx_salary_adj_type_staff ON salary_adjustments(staff_id, type, month);

-- 3. Журнал кадрових рішень
CREATE TABLE IF NOT EXISTS discipline_actions_log (
    id SERIAL PRIMARY KEY,
    adjustment_id INTEGER REFERENCES salary_adjustments(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL,
    action_type VARCHAR(30) NOT NULL,
    actor_username VARCHAR(100),
    actor_role VARCHAR(50),
    template_id INTEGER REFERENCES depremium_templates(id),
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discipline_log_staff ON discipline_actions_log(staff_id, created_at DESC);

-- 4. Seed 19 офіційних шаблонів
INSERT INTO depremium_templates (code, title, official_reason, amount, penalty_mode, discipline_category, severity, is_repeat_offense, repeat_of_template_id, requires_manual_review, can_be_edited, sort_order) VALUES
('DP-01', 'Запізнення до 10 хв', 'Запізнення на роботу без поважної причини до 10 хвилин', 50, 'fixed', 'attendance', 'low', false, NULL, false, true, 10),
('DP-02', 'Запізнення до 30 хв', 'Запізнення на роботу без поважної причини до 30 хвилин', 75, 'fixed', 'attendance', 'low', false, NULL, false, true, 20),
('DP-03', 'Запізнення до 1 години', 'Запізнення на роботу без поважної причини до 1 години', 100, 'fixed', 'attendance', 'medium', false, NULL, false, true, 30),
('DP-04', 'Невихід без попередження', 'Невихід на роботу без попередження Адміністратора', 1000, 'fixed', 'attendance', 'high', false, NULL, true, true, 40),
('DP-05', 'Самовільне залишення місця', 'Самовільне залишення робочого місця', 50, 'fixed', 'workplace', 'low', false, NULL, false, true, 50),
('DP-06', 'Неналежне виконання обов''язків', 'Невиконання або неналежне виконання посадових обов''язків', 100, 'fixed', 'service', 'medium', false, NULL, false, true, 60),
('DP-07', 'Сп''яніння на роботі', 'Вихід на роботу в стані алкогольного або наркотичного сп''яніння', 1000, 'no_premium', 'substance', 'critical', false, NULL, true, false, 70),
('DP-08', 'Повторне сп''яніння', 'Повторний вихід на роботу в стані алкогольного або наркотичного сп''яніння', NULL, 'no_premium_or_dismissal', 'substance', 'critical', true, NULL, true, false, 80),
('DP-09', 'Вживання заборонених речовин', 'Вживання алкогольних або наркотичних засобів на робочому місці', NULL, 'no_premium_or_dismissal', 'substance', 'critical', false, NULL, true, false, 90),
('DP-10', 'Куріння у невстановленому місці', 'Куріння в невстановленому місці або без дозволу Адміністратора', 100, 'fixed', 'safety', 'medium', false, NULL, false, true, 100),
('DP-11', 'Неохайний зовнішній вигляд', 'Неохайний зовнішній вигляд (форма, волосся, бейдж)', 150, 'fixed', 'appearance', 'medium', false, NULL, false, true, 110),
('DP-12', 'Крики / лайка в Парку', 'Голосний сміх, крики, ненормативна лексика у Парку', 200, 'fixed', 'behavior', 'medium', false, NULL, false, true, 120),
('DP-13', 'Телефон при відвідувачі', 'Користування мобільним телефоном під час обслуговування відвідувача', 150, 'fixed', 'phone', 'medium', false, NULL, false, true, 130),
('DP-14', 'Споживання не призначених продуктів', 'Вживання персоналом напоїв або продуктів, не призначених для персоналу', 200, 'fixed', 'behavior', 'medium', false, NULL, false, true, 140),
('DP-15', 'Ігнорування відвідувача', 'Ігнорування відвідувача або некоректна поведінка щодо нього', 200, 'fixed', 'service', 'high', false, NULL, false, true, 150),
('DP-16', 'Приховування конфлікту', 'Спроба приховати від Адміністратора конфлікт з відвідувачем', 300, 'fixed', 'service', 'high', false, NULL, false, true, 160),
('DP-17', 'Брудне робоче місце', 'Брудне або непідготовлене робоче місце', 100, 'fixed', 'workplace', 'low', false, NULL, false, true, 170),
('DP-18', 'Крадіжка', 'Крадіжка', NULL, 'no_premium_or_dismissal', 'theft', 'critical', false, NULL, true, false, 180),
('DP-19', 'Телефон у неробочих цілях', 'Використання телефону в неробочих цілях (перегляд відео, ігри тощо)', 150, 'fixed', 'phone', 'medium', false, NULL, false, true, 190)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title, official_reason = EXCLUDED.official_reason, amount = EXCLUDED.amount,
  penalty_mode = EXCLUDED.penalty_mode, discipline_category = EXCLUDED.discipline_category,
  severity = EXCLUDED.severity, is_repeat_offense = EXCLUDED.is_repeat_offense,
  requires_manual_review = EXCLUDED.requires_manual_review, can_be_edited = EXCLUDED.can_be_edited,
  sort_order = EXCLUDED.sort_order, updated_at = NOW();

-- Link DP-08 to DP-07 (repeat offense)
UPDATE depremium_templates SET repeat_of_template_id = (SELECT id FROM depremium_templates WHERE code = 'DP-07') WHERE code = 'DP-08';
