-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotent scoped rename for the Maysternya Doli default consultation line only; park timeline lines and custom line names are untouched.
-- ROLLBACK: UPDATE lines_by_date SET name = 'Таймлайн МД' WHERE business_context = 'maysternya_doli' AND line_id = 'md-consult-room' AND name = 'Олександр';
-- DATA_SCOPE: lines_by_date rows where business_context='maysternya_doli', line_id='md-consult-room', and name is an old generic label.

UPDATE lines_by_date
SET name = 'Олександр'
WHERE business_context = 'maysternya_doli'
  AND line_id = 'md-consult-room'
  AND name IN ('Таймлайн МД', 'Майстерня долі');
