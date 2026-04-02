-- Migration 148: Deactivate Інна Владимирівна (id=57)
UPDATE staff SET is_active = false WHERE id = 57;
DELETE FROM staff_schedule WHERE staff_id = 57 AND date::date >= CURRENT_DATE;
