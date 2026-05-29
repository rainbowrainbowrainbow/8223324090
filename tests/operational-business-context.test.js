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

test('OmniClaw follows the selected business context across UI, routes, and persistence', () => {
    const api = read('js/api.js');
    const omni = read('omni.html');
    const route = read('routes/omnichannel.js');
    const accounts = read('services/omni-accounts.js');
    const hub = read('services/omni-hub.js');
    const migration = read('db/migrations/228_omni_business_context_scope.sql');

    assert.match(api, /maysternya_doli:[\s\S]*modules:[\s\S]*'omni'/);
    assert.match(omni, /X-Business-Context[\s\S]*getOmniBusinessContext/);
    assert.match(omni, /CrmBusinessContext\.apiUrl\(relative, getOmniBusinessContext\(\)\)/);
    assert.match(omni, /CrmBusinessContext\.initPage\(\{[\s\S]*pageId:\s*'system'[\s\S]*onChange:\s*async/);
    assert.match(route, /businessContextFromRequest/);
    assert.match(route, /requireBusinessContext/);
    assert.match(route, /getConversations\(\{[\s\S]*businessContext/);
    assert.match(route, /processInboundMessage\(normalized, \{ businessContext \}\)/);

    assert.match(accounts, /ON CONFLICT \(business_context, channel\)/);
    assert.match(accounts, /WHERE channel = \$1[\s\S]*COALESCE\(business_context, '\$\{DEFAULT_BUSINESS_CONTEXT\}'\) = \$2/);
    assert.match(hub, /INSERT INTO conversations[\s\S]*business_context/);
    assert.match(hub, /COALESCE\(c\.business_context, '\$\{DEFAULT_BUSINESS_CONTEXT\}'\) = \$\$\{idx\+\+\}/);

    assert.match(migration, /ALTER TABLE conversations[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_business_channel_ext/);
    assert.match(migration, /PRIMARY KEY \(business_context, channel\)/);
});

test('shared CRM shell exposes safe read-only multi-business scope for core CRM lists', () => {
    const api = read('js/api.js');
    const service = read('services/businessContext.js');
    const server = read('server.js');
    const guard = read('middleware/businessScopeGuard.js');
    const customers = read('routes/customers.js');
    const leads = read('routes/leads.js');
    const products = read('routes/products.js');

    assert.match(service, /BUSINESS_SCOPE_ALL/);
    assert.match(service, /function resolveBusinessScope/);
    assert.match(service, /function pushBusinessScopeCondition/);
    assert.match(service, /requireWritableBusinessScope/);
    assert.match(service, /= ANY\(\$\$\{params\.length\}::text\[\]\)/);

    assert.match(api, /function getCrmBusinessState/);
    assert.match(api, /state: getCrmBusinessState/);
    assert.match(api, /function renderCrmBusinessShell/);
    assert.match(api, /document\.getElementById\('globalBusinessContextHost'\)\?\.remove|const existing = document\.getElementById\('globalBusinessContextHost'\)/);
    assert.match(api, /apiLogAction\('business_scope_switch'/);
    assert.doesNotMatch(api, /id="globalBusinessContextSelect"/);
    assert.doesNotMatch(api, /crm-business-multi-picker/);
    assert.match(api, /function assertCrmBusinessWritableRequest/);
    assert.match(api, /business_scope_read_only/);

    assert.match(server, /businessScopeWriteGuard/);
    assert.match(guard, /MUTATING_METHODS/);
    assert.match(guard, /business_scope_read_only/);
    assert.match(guard, /\/auth\/log-action/);

    assert.match(customers, /ensureBusinessScope/);
    assert.match(customers, /customerScopeCondition\(params, businessScope, 'c'\)/);
    assert.match(leads, /ensureBusinessScope/);
    assert.match(leads, /leadScopeCondition\(params, businessScope, 'l'\)/);
    assert.match(products, /requireProductBusinessScope/);
    assert.match(products, /pushBusinessScopeCondition\(params, businessScope, 'p'\)/);
});
