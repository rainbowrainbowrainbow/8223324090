const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('warehouse and finance routes scope operational data by selected business context', () => {
    const warehouse = read('routes/warehouse.js');
    const finance = read('routes/finance.js');
    const products = read('routes/products.js');
    const bookings = read('routes/bookings.js');
    const migration = read('db/migrations/227_business_context_operational_scopes.sql');

    assert.match(warehouse, /requestWarehouseBusinessContext/);
    assert.match(warehouse, /businessScopeSql\('ws', '\$1'\)/);
    assert.match(warehouse, /INSERT INTO warehouse_stock \([\s\S]*business_context/);
    assert.match(warehouse, /INSERT INTO warehouse_history \(stock_id, change, reason, created_by, business_context\)/);
    assert.match(warehouse, /warehouse_stock_movements \([\s\S]*business_context/);
    assert.match(warehouse, /COALESCE\(business_context, `?\$\{BUSINESS_SQL_DEFAULT\}`?\) = \$1|COALESCE\(business_context, \$\{BUSINESS_SQL_DEFAULT\}\) = \$1/);

    assert.match(finance, /requestFinanceBusinessContext/);
    assert.match(finance, /INSERT INTO finance_transactions \(business_context/);
    assert.match(finance, /ON CONFLICT \(business_context, year, month, category_id\)/);
    assert.match(finance, /cash_register_shifts WHERE status = 'open' AND \$\{businessScopeSql/);
    assert.match(finance, /SELECT \* FROM finance_accounts WHERE is_active = true AND \$\{businessScopeSql/);
    assert.match(finance, /COALESCE\(b\.business_context, \$\{BUSINESS_SQL_DEFAULT\}\) = \$1/);

    assert.match(products, /loadMenuAiWarehouseItems\(pool, businessContext\)/);
    assert.match(products, /COALESCE\(ws\.business_context, '\$\{DEFAULT_BUSINESS_CONTEXT\}'\) = \$2/);
    assert.match(products, /INSERT INTO warehouse_history \(stock_id, change, reason, created_by, business_context\)/);

    assert.match(bookings, /INSERT INTO finance_transactions \(business_context, type/);
    assert.match(bookings, /COALESCE\(business_context, 'event_genix'\) = \$6/);

    assert.match(migration, /ALTER TABLE warehouse_stock[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /ALTER TABLE finance_transactions[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /COALESCE\(b\.business_context, receipts\.business_context, 'event_genix'\)/);
    assert.match(migration, /COALESCE\(b\.business_context, currency_conversions\.business_context, 'event_genix'\)/);
    assert.doesNotMatch(migration, /COALESCE\(b\.business_context, business_context, 'event_genix'\)/);
    assert.match(migration, /budget_plans_business_year_month_category_key/);
    assert.match(migration, /idx_cash_shifts_one_open_per_business/);
});
