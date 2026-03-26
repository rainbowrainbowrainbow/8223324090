-- v33.10.0: Warehouse stock owner (park/dar/shared)
ALTER TABLE warehouse_stock
    ADD COLUMN IF NOT EXISTS owner VARCHAR(20) DEFAULT 'park';
COMMENT ON COLUMN warehouse_stock.owner IS 'park = Парк Закревського, dar = Дар, shared = Спільне';
