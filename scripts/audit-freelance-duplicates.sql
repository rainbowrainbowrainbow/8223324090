\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH windows AS (
    SELECT shift.staff_id, segment.id, segment.work_mode,
           tsrange(
               shift.shift_date + segment.planned_start + COALESCE(segment.start_day_offset, 0) * INTERVAL '1 day',
               shift.shift_date + segment.planned_end + COALESCE(segment.end_day_offset,
                   CASE WHEN segment.planned_end < segment.planned_start THEN 1 ELSE 0 END) * INTERVAL '1 day',
               '[)'
           ) AS work_window
    FROM hr_shift_segments segment
    JOIN hr_shifts shift ON shift.id = segment.hr_shift_id
    WHERE shift.shift_date >= CURRENT_DATE - 90
      AND shift.shift_date <= CURRENT_DATE + 30
),
counts AS (
    SELECT 'legacy_slot_cards' AS finding, count(*) AS matches
    FROM staff WHERE is_freelance
    UNION ALL
    SELECT 'possible_duplicate_identity_keys', count(*) FROM (
        SELECT lower(btrim(unique_person_key))
        FROM staff
        WHERE NULLIF(btrim(unique_person_key), '') IS NOT NULL
        GROUP BY lower(btrim(unique_person_key))
        HAVING count(*) > 1 AND bool_or(COALESCE(is_freelance, false))
    ) keys
    UNION ALL
    SELECT 'same_person_overlapping_work_blocks', count(*)
    FROM windows a JOIN windows b ON b.staff_id = a.staff_id AND b.id > a.id
        AND a.work_window && b.work_window
        AND (a.work_mode = 'freelance' OR b.work_mode = 'freelance')
    UNION ALL
    SELECT 'duplicate_freelance_confirmation', count(*) FROM (
        SELECT hr_shift_id FROM hr_freelance_attendance_confirmations GROUP BY hr_shift_id HAVING count(*) > 1
    ) confirmations
    UNION ALL
    SELECT 'duplicate_finance_movement_key', count(*) FROM (
        SELECT idempotency_key FROM hr_freelance_payment_movements GROUP BY idempotency_key HAVING count(*) > 1
    ) movement_keys
    UNION ALL
    SELECT 'freelance_ledger_entries_without_movement', count(*)
    FROM finance_transactions ledger LEFT JOIN hr_freelance_payment_movements movement
        ON movement.finance_transaction_id = ledger.id
    WHERE ledger.source = 'hr_freelance' AND movement.id IS NULL
)
SELECT finding, matches FROM counts ORDER BY finding;

ROLLBACK;
