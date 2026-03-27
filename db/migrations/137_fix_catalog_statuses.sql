-- Migration 137: Fix catalog statuses + cleanup
-- Graduation should be 'ready', not 'draft'
UPDATE catalog_definitions SET status = 'ready' WHERE id = 'graduation';
