-- Migration 139: Sync schedule with real staff
-- v39.8.0: Generate schedule for real active staff (current + next 2 weeks)
-- Old schedule data was linked to deactivated test staff (IDs 1-30)

-- 1. Clear old schedule entries for inactive staff
DELETE FROM staff_schedule WHERE staff_id IN (SELECT id FROM staff WHERE is_active = false);

-- 2. Generate schedule for real active non-freelance staff
-- Pattern: Mon-Fri working 10:00-20:00, Sat-Sun rotating (every other works)
DO $$
DECLARE
    s RECORD;
    d DATE;
    week_start DATE;
    day_of_week INTEGER;
    staff_index INTEGER := 0;
BEGIN
    -- Generate 3 weeks: current week + next 2 weeks
    week_start := date_trunc('week', CURRENT_DATE)::date;

    FOR s IN
        SELECT id, department, name
        FROM staff
        WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL)
        ORDER BY department, name
    LOOP
        staff_index := staff_index + 1;

        FOR i IN 0..20 LOOP  -- 21 days = 3 weeks
            d := week_start + i;
            day_of_week := EXTRACT(ISODOW FROM d);  -- 1=Mon, 7=Sun

            -- Animators: Tue-Sun (off Monday)
            IF s.department IN ('animators') THEN
                IF day_of_week = 1 THEN
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'day_off', NULL, NULL)
                    ON CONFLICT (staff_id, date) DO NOTHING;
                ELSIF day_of_week <= 5 THEN
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'working', '10:00', '20:00')
                    ON CONFLICT (staff_id, date) DO NOTHING;
                ELSE
                    -- Weekend: alternate staff work Sat/Sun
                    IF (staff_index + (i / 7)) % 2 = 0 THEN
                        INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                        VALUES (s.id, d, 'working', '10:00', '20:00')
                        ON CONFLICT (staff_id, date) DO NOTHING;
                    ELSE
                        INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                        VALUES (s.id, d, 'day_off', NULL, NULL)
                        ON CONFLICT (staff_id, date) DO NOTHING;
                    END IF;
                END IF;

            -- Admin/managers: Mon-Fri
            ELSIF s.department IN ('admin') THEN
                IF day_of_week <= 5 THEN
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'working', '09:00', '18:00')
                    ON CONFLICT (staff_id, date) DO NOTHING;
                ELSE
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'day_off', NULL, NULL)
                    ON CONFLICT (staff_id, date) DO NOTHING;
                END IF;

            -- Cafe: shift rotation (2 days on, 1 day off)
            ELSIF s.department IN ('cafe') THEN
                IF (staff_index + i) % 3 != 0 THEN
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'working', '09:00', '21:00')
                    ON CONFLICT (staff_id, date) DO NOTHING;
                ELSE
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'day_off', NULL, NULL)
                    ON CONFLICT (staff_id, date) DO NOTHING;
                END IF;

            -- Cleaning/security/trampoline: daily shifts, alternating
            ELSE
                IF (staff_index + i) % 2 = 0 THEN
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'working', '08:00', '20:00')
                    ON CONFLICT (staff_id, date) DO NOTHING;
                ELSE
                    INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end)
                    VALUES (s.id, d, 'day_off', NULL, NULL)
                    ON CONFLICT (staff_id, date) DO NOTHING;
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Schedule generated for % staff over 3 weeks', staff_index;
END $$;
