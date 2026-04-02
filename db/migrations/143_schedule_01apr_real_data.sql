-- Migration 143: Real schedule data for 01.04 from paper records
-- Source: handwritten attendance sheet dated 01.04

-- Add missing shifts
INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
SELECT id, '2026-04-01', 'working', '10:55', '21:00'
FROM staff WHERE name = 'Гнатівська Анна' AND department = 'cafe'
ON CONFLICT (staff_id, date) DO UPDATE SET status = 'working', shift_start = '10:55', shift_end = '21:00';

INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
SELECT id, '2026-04-01', 'working', '11:00', '21:00'
FROM staff WHERE name = 'Митрофаненко' AND department = 'cafe'
ON CONFLICT (staff_id, date) DO UPDATE SET status = 'working', shift_start = '11:00', shift_end = '21:00';

INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
SELECT id, '2026-04-01', 'working', '11:00', '21:00'
FROM staff WHERE name = 'Шевченко' AND department = 'cafe'
ON CONFLICT (staff_id, date) DO UPDATE SET status = 'working', shift_start = '11:00', shift_end = '21:00';

-- Fix real arrival times from paper
UPDATE staff_schedule SET shift_start = '10:30'
WHERE staff_id = (SELECT id FROM staff WHERE name = 'Атаманенко Анна Михайлівна' LIMIT 1) AND date = '2026-04-01';

UPDATE staff_schedule SET shift_start = '10:45'
WHERE staff_id IN (SELECT id FROM staff WHERE name = 'Виниченко Алла') AND date = '2026-04-01';

UPDATE staff_schedule SET shift_start = '10:00'
WHERE staff_id = (SELECT id FROM staff WHERE name = 'Кім' AND department = 'cleaning' LIMIT 1) AND date = '2026-04-01';

UPDATE staff_schedule SET shift_start = '10:35'
WHERE staff_id = (SELECT id FROM staff WHERE name = 'Дащенко' LIMIT 1) AND date = '2026-04-01';
