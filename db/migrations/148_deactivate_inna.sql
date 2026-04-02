-- Migration 148: Deactivate Інна Владимирівна
UPDATE staff SET is_active = false WHERE name = 'Інна Владимирівна' AND department = 'admin';
DELETE FROM staff_schedule WHERE staff_id IN (SELECT id FROM staff WHERE name = 'Інна Владимирівна') AND date::date >= CURRENT_DATE;
