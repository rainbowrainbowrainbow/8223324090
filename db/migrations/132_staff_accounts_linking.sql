-- Migration 132: Staff ↔ Account linking + Real staff from Excel (v39.1.0)
-- Part of: Графік — реальні співробітники + зв'язка акаунтів
-- IDEMPOTENT: uses unique_person_key + DO NOTHING to prevent duplicates

-- 1. Add is_freelance flag to staff
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_freelance BOOLEAN DEFAULT false;

-- 2. Add primary_role for staff with multiple departments
ALTER TABLE staff ADD COLUMN IF NOT EXISTS primary_role VARCHAR(50);

-- 3. Add excel_department to track original Excel department name
ALTER TABLE staff ADD COLUMN IF NOT EXISTS excel_department VARCHAR(100);

-- 4. Add unique_person_id for deduplication (same person in multiple depts)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS unique_person_key VARCHAR(200);

-- 5. Unique constraint on unique_person_key for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_unique_person_key ON staff(unique_person_key) WHERE unique_person_key IS NOT NULL;

-- 6. Index for linking queries
CREATE INDEX IF NOT EXISTS idx_staff_freelance ON staff(is_freelance);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_staff_user ON employee_profiles(staff_id, user_id);

-- 6. Deactivate all test staff (will be replaced by real ones)
UPDATE staff SET is_active = false WHERE id <= 30;

-- 7. Seed real staff from Excel (Лютий 2026)
-- Format: name, department, position, role_type, excel_department, is_freelance, unique_person_key

-- АДМІНІСТРАТОРИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Славицька Анна', 'admin', 'Адміністратор', 'admin', 'Адміністратор', false, 'slavytska.anna', true),
('Франчук Артем', 'admin', 'Адміністратор', 'admin', 'Адміністратор', false, 'franchuk.artem', true)
ON CONFLICT DO NOTHING;

-- АНІМАТОРИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Пасенко Женя', 'animators', 'Аніматор', 'animator', 'Аніматори', false, 'pasenko.zhenya', true),
('Телентюк Анна', 'animators', 'Аніматор', 'animator', 'Аніматори', false, 'telentyuk.anna', true)
ON CONFLICT DO NOTHING;

-- АНІМАТОРИ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'animators', 'Фріланс-аніматор', 'animator', 'Аніматори', true, NULL, true)
ON CONFLICT DO NOTHING;

-- АРТ ОТДЕЛ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Шарлай Сергій', 'admin', 'Арт-директор', 'art_director', 'Арт отдел', false, 'sharlai.serhiy', true)
ON CONFLICT DO NOTHING;

-- БАРМЕНИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Гнатівська Анна', 'cafe', 'Бармен', 'barista', 'Бармени', false, 'gnativska.anna', true),
('Ярова Софія', 'cafe', 'Бармен', 'barista', 'Бармени', false, 'yarova.sofiya', true)
ON CONFLICT DO NOTHING;

-- БАРМЕНИ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'cafe', 'Фріланс-бармен', 'barista', 'Бармени', true, NULL, true)
ON CONFLICT DO NOTHING;

-- БАТУТИСТИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Бугера Назар', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'bugera.nazar', true),
('Головатенко Аліна', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'holovatenko.alina', true),
('Горбаченко Павло', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'gorbachenko.pavlo', true),
('Лисенко Андрій', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'lysenko.andriy', true),
('Мігашко Назар', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'migashko.nazar', true),
('Росовський Артем', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'rosovskyi.artem', true),
('Стрельніков Нікіта', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'strelnikov.nikita', true),
('Шадрін Ілля', 'animators', 'Батутист', 'instructor', 'Батутисти', false, 'shadrin.illia', true)
ON CONFLICT DO NOTHING;

-- БАТУТИСТИ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'animators', 'Фріланс-батутист', 'instructor', 'Батутисти', true, NULL, true)
ON CONFLICT DO NOTHING;

-- БУХГАЛТЕРИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Скріпнік Вікторія', 'admin', 'Бухгалтер', 'accountant', 'Бухгалтер', false, 'skripnik.viktoriya', true),
('Шило Ірина', 'admin', 'Бухгалтер', 'accountant', 'Бухгалтер', false, 'shylo.iryna', true)
ON CONFLICT DO NOTHING;

-- ГАРДЕРОБ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Литвиненко Марія', 'cleaning', 'Гардеробниця', 'wardrobe', 'Гардеробщиці', false, 'lytvynenko.mariya', true),
('Новікова Наталія', 'cleaning', 'Гардеробниця', 'wardrobe', 'Гардеробщиці', false, 'novikova.nataliya', true)
ON CONFLICT DO NOTHING;

-- ГАРДЕРОБ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'cleaning', 'Фріланс-гардероб', 'wardrobe', 'Гардеробщиці', true, NULL, true)
ON CONFLICT DO NOTHING;

-- HR
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Касян Катерина', 'admin', 'HR-менеджер', 'hr', 'Ейчар', false, 'kasyan.kateryna', true)
ON CONFLICT DO NOTHING;

-- КЕРІВНИКИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Федорова Наталія', 'admin', 'Керівник', 'vice_director', 'Керівник', false, 'fedorova.nataliya', true),
('Ковтун Ірина', 'admin', 'Керівник', 'vice_director', 'Керівник', false, 'kovtun.iryna', true),
('Інна Владимирівна', 'admin', 'Керівник', 'vice_director', 'Керівник', false, 'inna.vladymyrivna', true)
ON CONFLICT DO NOTHING;

-- КУХНЯ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Берекешова', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'berekeshova', true),
('Гладій', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'gladiy', true),
('Гордієнко', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'gordiyenko', true),
('Завальний', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'zavalnyy', true),
('Завізіступ', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'zavizistup', true),
('Конон', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'konon', true),
('Митрофаненко', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'mytrofanenko', true),
('Ткаченко', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'tkachenko', true),
('Шевченко', 'cafe', 'Кухар', 'cook', 'Кухня повара', false, 'shevchenko', true)
ON CONFLICT DO NOTHING;

-- КУХНЯ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'cafe', 'Фріланс-кухар', 'cook', 'Кухня повара', true, NULL, true)
ON CONFLICT DO NOTHING;

-- МЕНЕДЖЕРИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Бойко', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'boyko', true),
('Горощенко Даша', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'goroshchenko.dasha', true),
('Єфремова', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'yefremova', true),
('Мирошниченко', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'myroshnychenko', true),
('Синепол Віталіна', 'admin', 'Топ-менеджер', 'senior_manager', 'Менеджер з продажу', false, 'synepol.vitalina', true)
ON CONFLICT DO NOTHING;

-- МЕНЕДЖЕРИ (дублі — ці люди вже є в інших відділах, додаємо запис для менеджерського відділу)
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Славицька Анна', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'slavytska.anna.mgr', true),
('Телентюк Анна', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'telentyuk.anna.mgr', true),
('Ярова Софія', 'admin', 'Менеджер з продажу', 'manager', 'Менеджер з продажу', false, 'yarova.sofiya.mgr', true)
ON CONFLICT DO NOTHING;

-- МЕНЕДЖЕРИ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'admin', 'Фріланс-менеджер', 'manager', 'Менеджер з продажу', true, NULL, true)
ON CONFLICT DO NOTHING;

-- МИЙКА
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Виниченко Алла', 'cleaning', 'Мийниця', 'dishwasher', 'Мийка біла та чорна', false, 'vynychenko.alla', true),
('Кім', 'cleaning', 'Мийниця', 'dishwasher', 'Мийка біла та чорна', false, 'kim', true),
('Коморна', 'cleaning', 'Мийниця', 'dishwasher', 'Мийка біла та чорна', false, 'komorna', true)
ON CONFLICT DO NOTHING;

-- МИЙКА — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'cleaning', 'Фріланс-мийка', 'dishwasher', 'Мийка біла та чорна', true, NULL, true)
ON CONFLICT DO NOTHING;

-- ОФІЦІАНТИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Володін', 'cafe', 'Офіціант', 'waiter', 'Офіціанти', false, 'volodin', true),
('Герценюк', 'cafe', 'Офіціант', 'waiter', 'Офіціанти', false, 'hertsenyuk', true),
('Дащенко', 'cafe', 'Офіціант', 'waiter', 'Офіціанти', false, 'dashchenko', true),
('Федорова Марія', 'cafe', 'Офіціант', 'waiter', 'Офіціанти', false, 'fedorova.mariya', true),
('Щербина', 'cafe', 'Офіціант', 'waiter', 'Офіціанти', false, 'shcherbyna', true),
('Яровий', 'cafe', 'Офіціант', 'waiter', 'Офіціанти', false, 'yarovyy', true)
ON CONFLICT DO NOTHING;

-- ОХОРОНА
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Охорона', 'security', 'Охоронець', 'maintenance', 'Охорона', false, 'okhorona', true)
ON CONFLICT DO NOTHING;

-- ТЕХ-ДИРЕКТОР
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Бондарь Валерій', 'tech', 'Тех-директор', 'it_specialist', 'Тех-директор', false, 'bondar.valeriy', true)
ON CONFLICT DO NOTHING;

-- ХОЗЯЮШКИ
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Атаманенко', 'cleaning', 'Хозяюшка залу', 'cleaning', 'Хозяюшки залу', false, 'atamanenko', true),
('Литвиненко Юлія', 'cleaning', 'Хозяюшка залу', 'cleaning', 'Хозяюшки залу', false, 'lytvynenko.yuliya', true),
('Сінгаєвська', 'cleaning', 'Хозяюшка залу', 'cleaning', 'Хозяюшки залу', false, 'singayevska', true),
('Супоребра', 'cleaning', 'Хозяюшка залу', 'cleaning', 'Хозяюшки залу', false, 'suporebra', true),
('Туліка', 'cleaning', 'Хозяюшка залу', 'cleaning', 'Хозяюшки залу', false, 'tulika', true)
ON CONFLICT DO NOTHING;

-- ХОЗЯЮШКИ — Дубль (Виниченко є також в мийці)
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Виниченко Алла', 'cleaning', 'Хозяюшка залу', 'cleaning', 'Хозяюшки залу', false, 'vynychenko.alla.clean', true)
ON CONFLICT DO NOTHING;

-- ХОЗЯЮШКИ — Фріланс
INSERT INTO staff (name, department, position, role_type, excel_department, is_freelance, unique_person_key, is_active)
VALUES
('Фріланс', 'cleaning', 'Фріланс-хозяюшка', 'cleaning', 'Хозяюшки залу', true, NULL, true)
ON CONFLICT DO NOTHING;

-- 8. Create employee_profiles for known linkable staff→users
-- Link by username (safe for any environment — no hardcoded IDs)
-- Сергій Шарлай → Sergey
-- Федорова Наталія → Natalia
-- Синепол Віталіна → Vitalina
-- Горощенко Даша → Dasha
-- Пасенко Женя → Zhenya
-- Телентюк Анна → Anli

-- First, clean up any existing test employee_profiles
UPDATE employee_profiles SET is_active = false WHERE staff_id <= 30;

-- Create profiles for real linked staff (JOIN on users by username — safe!)
INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s
CROSS JOIN users u
WHERE s.unique_person_key = 'sharlai.serhiy' AND s.is_active = true
  AND u.username = 'Sergey' AND u.is_active = true
ON CONFLICT DO NOTHING;

INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s
CROSS JOIN users u
WHERE s.unique_person_key = 'fedorova.nataliya' AND s.is_active = true
  AND u.username = 'Natalia' AND u.is_active = true
ON CONFLICT DO NOTHING;

INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s
CROSS JOIN users u
WHERE s.unique_person_key = 'synepol.vitalina' AND s.is_active = true
  AND u.username = 'Vitalina' AND u.is_active = true
ON CONFLICT DO NOTHING;

INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s
CROSS JOIN users u
WHERE s.unique_person_key = 'goroshchenko.dasha' AND s.is_active = true
  AND u.username = 'Dasha' AND u.is_active = true
ON CONFLICT DO NOTHING;

INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s
CROSS JOIN users u
WHERE s.unique_person_key = 'pasenko.zhenya' AND s.is_active = true
  AND u.username = 'Zhenya' AND u.is_active = true
ON CONFLICT DO NOTHING;

INSERT INTO employee_profiles (staff_id, user_id, full_name, role, department, is_active)
SELECT s.id, u.id, s.name, s.role_type, s.department, true
FROM staff s
CROSS JOIN users u
WHERE s.unique_person_key = 'telentyuk.anna' AND s.is_active = true
  AND u.username = 'Anli' AND u.is_active = true
ON CONFLICT DO NOTHING;
