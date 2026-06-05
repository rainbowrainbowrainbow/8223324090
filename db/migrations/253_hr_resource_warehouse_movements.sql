-- MIGRATION_KIND: schema
-- SAFETY: Additive HR resource tracking metadata only. Existing staff resource and warehouse movement rows are not rewritten.
-- ROLLBACK: Drop idx_staff_resource_assignments_issue_movement, idx_staff_resource_assignments_return_movement and the two movement link columns if this release is reverted.

ALTER TABLE staff_resource_assignments
    ADD COLUMN IF NOT EXISTS warehouse_issue_movement_id INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS warehouse_return_movement_id INTEGER REFERENCES warehouse_stock_movements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_resource_assignments_issue_movement
    ON staff_resource_assignments(warehouse_issue_movement_id)
    WHERE warehouse_issue_movement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_resource_assignments_return_movement
    ON staff_resource_assignments(warehouse_return_movement_id)
    WHERE warehouse_return_movement_id IS NOT NULL;
