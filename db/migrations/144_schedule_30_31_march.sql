-- Migration 144: Schedule 30-31 March + inactive status for absent staff
-- Real data: only staff from 01.04 paper were likely working 30-31 too

-- 1. Add 'inactive' as valid status concept — mark absent staff as day_off on 30-31 March
-- For 30.03 (Sunday) and 31.03 (Monday) — set everyone not from the paper list as day_off

-- 30.03 — weekend schedule (same people as 01.04 likely)
-- Set all active non-freelance staff to day_off first
UPDATE staff_schedule SET status = 'day_off', shift_start = NULL, shift_end = NULL
WHERE date = '2026-03-30' AND status = 'working';

UPDATE staff_schedule SET status = 'day_off', shift_start = NULL, shift_end = NULL
WHERE date = '2026-03-31' AND status = 'working';

-- Then set working for staff from the paper (01.04 crew likely same for 30-31)
-- Admin staff
UPDATE staff_schedule SET status = 'working', shift_start = '09:00', shift_end = '18:00'
WHERE date IN ('2026-03-30', '2026-03-31')
AND staff_id IN (SELECT id FROM staff WHERE name IN ('Синепол Віталіна', 'Горощенко Даша', 'Славицька Анна', 'Телентюк Анна') AND department = 'admin');

-- Animators
UPDATE staff_schedule SET status = 'working', shift_start = '10:00', shift_end = '20:00'
WHERE date IN ('2026-03-30', '2026-03-31')
AND staff_id IN (SELECT id FROM staff WHERE name = 'Телентюк Анна' AND department = 'animators');

-- Cafe
UPDATE staff_schedule SET status = 'working', shift_start = '09:00', shift_end = '21:00'
WHERE date IN ('2026-03-30', '2026-03-31')
AND staff_id IN (SELECT id FROM staff WHERE name IN ('Гладій', 'Гнатівська Анна', 'Митрофаненко', 'Шевченко', 'Дащенко') AND department = 'cafe');

-- Cleaning
UPDATE staff_schedule SET status = 'working', shift_start = '09:00', shift_end = '20:00'
WHERE date IN ('2026-03-30', '2026-03-31')
AND staff_id IN (SELECT id FROM staff WHERE name IN ('Атаманенко Анна Михайлівна', 'Виниченко Алла', 'Кім', 'Литвиненко Марія') AND department = 'cleaning');
