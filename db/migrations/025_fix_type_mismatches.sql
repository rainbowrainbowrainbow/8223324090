-- Migration 025: Fix type mismatches
-- v20.7.1: Fix leads.program_id INT→VARCHAR(50) to match products.id
--          Fix training tables telegram_id BIGINT→VARCHAR(20) to match staff.telegram_id

-- 25.1: leads.program_id should be VARCHAR(50) to match products.id
ALTER TABLE leads ALTER COLUMN program_id TYPE VARCHAR(50) USING program_id::VARCHAR(50);

-- 25.2: training tables telegram_id should be VARCHAR(20) to match staff.telegram_id
ALTER TABLE staff_training_inputs ALTER COLUMN telegram_id TYPE VARCHAR(20) USING telegram_id::VARCHAR(20);
ALTER TABLE training_prompts_sent ALTER COLUMN telegram_id TYPE VARCHAR(20) USING telegram_id::VARCHAR(20);
