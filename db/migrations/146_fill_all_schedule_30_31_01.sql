-- Migration 146: Fill schedule for ALL active staff on 30.03, 31.03, 01.04
-- Everyone gets day_off, then paper staff get working

-- 1. Create day_off entries for ALL active non-freelance staff who DON'T have a record yet
INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
SELECT s.id, d.dt, 'day_off', NULL, NULL
FROM staff s
CROSS JOIN (VALUES ('2026-03-30'::varchar), ('2026-03-31'::varchar), ('2026-04-01'::varchar)) AS d(dt)
WHERE s.is_active = true AND (s.is_freelance = false OR s.is_freelance IS NULL)
ON CONFLICT (staff_id, date) DO NOTHING;

-- 2. Set ALL to day_off on these 3 days
UPDATE staff_schedule SET status = 'day_off', shift_start = NULL, shift_end = NULL
WHERE date IN ('2026-03-30', '2026-03-31', '2026-04-01');

-- 3. Restore ONLY paper staff on 01.04
-- Admin
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '18:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name IN ('Славицька Анна', 'Синепол Віталіна', 'Горощенко Даша') AND department = 'admin'
);
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '18:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Телентюк Анна' AND department = 'admin'
);
-- Animator
UPDATE staff_schedule SET status = 'working', shift_start = '10:00', shift_end = '20:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Телентюк Анна' AND department = 'animators'
);
-- Cafe
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '21:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Митрофаненко' AND department = 'cafe'
);
UPDATE staff_schedule SET status = 'working', shift_start = '10:55', shift_end = '21:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Гнатівська Анна' AND department = 'cafe'
);
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '21:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name IN ('Шевченко', 'Гладій') AND department = 'cafe'
);
UPDATE staff_schedule SET status = 'working', shift_start = '10:35', shift_end = '21:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Дащенко' AND department = 'cafe'
);
-- Cleaning
UPDATE staff_schedule SET status = 'working', shift_start = '10:30', shift_end = '20:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Атаманенко Анна Михайлівна' AND department = 'cleaning'
);
UPDATE staff_schedule SET status = 'working', shift_start = '10:45', shift_end = '20:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Виниченко Алла' AND department = 'cleaning'
);
UPDATE staff_schedule SET status = 'working', shift_start = '10:00', shift_end = '20:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Кім' AND department = 'cleaning'
);
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '20:00'
WHERE date = '2026-04-01' AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Литвиненко Марія' AND department = 'cleaning'
);

-- 4. Same paper crew for 30.03 and 31.03 (same people, approximate times)
-- Admin
UPDATE staff_schedule SET status = 'working', shift_start = '09:00', shift_end = '18:00'
WHERE date IN ('2026-03-30', '2026-03-31') AND staff_id IN (
    SELECT id FROM staff WHERE name IN ('Славицька Анна', 'Синепол Віталіна', 'Горощенко Даша', 'Телентюк Анна') AND department = 'admin'
);
UPDATE staff_schedule SET status = 'working', shift_start = '10:00', shift_end = '20:00'
WHERE date IN ('2026-03-30', '2026-03-31') AND staff_id IN (
    SELECT id FROM staff WHERE name = 'Телентюк Анна' AND department = 'animators'
);
-- Cafe
UPDATE staff_schedule SET status = 'working', shift_start = '09:00', shift_end = '21:00'
WHERE date IN ('2026-03-30', '2026-03-31') AND staff_id IN (
    SELECT id FROM staff WHERE name IN ('Гладій', 'Гнатівська Анна', 'Митрофаненко', 'Шевченко', 'Дащенко') AND department = 'cafe'
);
-- Cleaning
UPDATE staff_schedule SET status = 'working', shift_start = '09:00', shift_end = '20:00'
WHERE date IN ('2026-03-30', '2026-03-31') AND staff_id IN (
    SELECT id FROM staff WHERE name IN ('Атаманенко Анна Михайлівна', 'Виниченко Алла', 'Кім', 'Литвиненко Марія') AND department = 'cleaning'
);
