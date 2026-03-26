-- v33.8.0: Product stock requirements (warehouse ↔ products link)
CREATE TABLE IF NOT EXISTS product_stock_requirements (
    id          SERIAL PRIMARY KEY,
    product_id  VARCHAR(50) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    stock_id    INTEGER NOT NULL REFERENCES warehouse_stock(id) ON DELETE CASCADE,
    quantity    INTEGER NOT NULL DEFAULT 1,
    UNIQUE(product_id, stock_id)
);
CREATE INDEX IF NOT EXISTS idx_psr_product ON product_stock_requirements(product_id);
