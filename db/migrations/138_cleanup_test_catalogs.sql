-- Migration 138: Cleanup test catalogs + fix prod data
-- Deactivate any catalogs that aren't the 5 known ones
UPDATE catalog_definitions SET is_active = false
WHERE id NOT IN ('graduation', 'pinyata', 'cake', 'menu', 'costume')
AND is_active = true;
