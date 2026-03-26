-- v33.5: Fix scheduler_executions.last_run_date varchar(10) too short for hourly dedup
-- Hourly key format: '2026-03-21T20' (13 chars), was failing with 'value too long'
ALTER TABLE scheduler_executions ALTER COLUMN last_run_date TYPE VARCHAR(20);
