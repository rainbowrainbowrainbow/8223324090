-- Migration 081: Sync lead status with pipeline_stage
-- Fix bug where status stayed 'new' when pipeline_stage was changed

UPDATE leads SET status = 'contact' WHERE pipeline_stage IN ('contacted', 'info_sent') AND status = 'new';
UPDATE leads SET status = 'proposal' WHERE pipeline_stage = 'deal' AND status = 'new';
UPDATE leads SET status = 'booked' WHERE pipeline_stage IN ('deposit_received', 'waiting') AND status = 'new';
UPDATE leads SET status = 'completed' WHERE pipeline_stage IN ('completed', 'closed') AND status = 'new';
UPDATE leads SET status = 'lost' WHERE pipeline_stage = 'lost' AND status = 'new';
