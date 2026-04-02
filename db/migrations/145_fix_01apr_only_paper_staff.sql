-- Migration 145: Only paper staff worked on 01.04
-- Everyone else → day_off (schedule wasn't running yet)

-- First set ALL to day_off on 01.04
UPDATE staff_schedule SET status = 'day_off', shift_start = NULL, shift_end = NULL
WHERE date = '2026-04-01' AND status = 'working';

-- Then restore ONLY people from the paper (14 people):

-- Славицька Анна (admin)
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '18:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Славицька Анна' AND department = 'admin');

-- Синепол Віталіна (менеджер)
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '18:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Синепол Віталіна' AND department = 'admin');

-- Горощенко Даша (менеджер+рецепція)
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '18:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Горощенко Даша' AND department = 'admin');

-- Телентюк Анна (рецепція+аніматор)
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '18:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Телентюк Анна' AND department = 'admin');

UPDATE staff_schedule SET status = 'working', shift_start = '10:00', shift_end = '20:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Телентюк Анна' AND department = 'animators');

-- Митрофаненко (кондитер/кухар) — 11:00
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '21:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Митрофаненко' AND department = 'cafe');

-- Гнатівська Анна (бар) — 10:55
UPDATE staff_schedule SET status = 'working', shift_start = '10:55', shift_end = '21:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Гнатівська Анна' AND department = 'cafe');

-- Шевченко (кухня) — 11:00
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '21:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Шевченко' AND department = 'cafe');

-- Гладій (кухня) — 11:00
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '21:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Гладій' AND department = 'cafe');

-- Дащенко (посудомийниця на папері / офіціант) — 10:35
UPDATE staff_schedule SET status = 'working', shift_start = '10:35', shift_end = '21:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Дащенко' AND department = 'cafe');

-- Атаманенко Анна Михайлівна (прибиральниця) — 10:30
UPDATE staff_schedule SET status = 'working', shift_start = '10:30', shift_end = '20:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Атаманенко Анна Михайлівна' AND department = 'cleaning');

-- Виниченко Алла (прибиральниця) — 10:45
UPDATE staff_schedule SET status = 'working', shift_start = '10:45', shift_end = '20:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Виниченко Алла' AND department = 'cleaning');

-- Кім (посудомийниця) — 10:00
UPDATE staff_schedule SET status = 'working', shift_start = '10:00', shift_end = '20:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Кім' AND department = 'cleaning');

-- Литвиненко Марія (гардероб) — 11:00
UPDATE staff_schedule SET status = 'working', shift_start = '11:00', shift_end = '20:00'
WHERE date = '2026-04-01'
AND staff_id IN (SELECT id FROM staff WHERE name = 'Литвиненко Марія' AND department = 'cleaning');
