-- Migration 141: Staff cleanup — update names, deactivate dismissed staff
-- v39.11.0: Based on HR revision by Касян Катерина

-- Update incomplete names
UPDATE staff SET name = 'Атаманенко Анна Михайлівна' WHERE name = 'Атаманенко' AND department = 'cleaning';
UPDATE staff SET name = 'Сінгаєвська Валентина' WHERE name = 'Сінгаєвська' AND department = 'cleaning';

-- Deactivate dismissed staff (never DELETE, only deactivate)
UPDATE staff SET is_active = false WHERE name = 'Литвиненко Юлія' AND department = 'cleaning';
UPDATE staff SET is_active = false WHERE name = 'Супоребра' AND department = 'cleaning';
UPDATE staff SET is_active = false WHERE name = 'Туліка' AND department = 'cleaning';

-- Update cleaning schedule: weekdays 12-20, weekends 09-20
-- Only for active cleaning staff, current + next 2 weeks
DO $$
DECLARE
    s RECORD;
    d DATE;
    dow INTEGER;
BEGIN
    FOR s IN SELECT id FROM staff WHERE department = 'cleaning' AND is_active = true AND (is_freelance = false OR is_freelance IS NULL) LOOP
        FOR i IN 0..20 LOOP
            d := date_trunc('week', CURRENT_DATE)::date + i;
            dow := EXTRACT(ISODOW FROM d);
            IF dow <= 5 THEN
                -- Weekday: 12:00-20:00
                INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                VALUES (s.id, d, 'working', '12:00', '20:00')
                ON CONFLICT (staff_id, date) DO UPDATE SET shift_start = '12:00', shift_end = '20:00', status = 'working';
            ELSE
                -- Weekend: 09:00-20:00
                INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                VALUES (s.id, d, 'working', '09:00', '20:00')
                ON CONFLICT (staff_id, date) DO UPDATE SET shift_start = '09:00', shift_end = '20:00', status = 'working';
            END IF;
        END LOOP;
    END LOOP;
END $$;
