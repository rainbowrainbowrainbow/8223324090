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
    const reports = read('routes/reports.js');
    const reportsMigration = read('db/migrations/235_reports_business_context_scope.sql');

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

    assert.match(reports, /ensureReportBusinessScope/);
    assert.match(reports, /reportScopeCondition\(params, businessScope, 'r'\)/);
    assert.match(reports, /INSERT INTO reports \(business_context/);
    assert.match(reports, /INSERT INTO report_table_drafts \([\s\S]*business_context/);
    assert.match(reports, /INSERT INTO finance_transactions \(business_context, type/);
    assert.match(reports, /COALESCE\(business_context, \$\d+\) = \$\d+/);
    assert.match(reportsMigration, /ALTER TABLE reports[\s\S]*business_context TEXT NOT NULL DEFAULT 'event_genix'/);
    assert.match(reportsMigration, /ALTER TABLE report_table_drafts[\s\S]*business_context TEXT NOT NULL DEFAULT 'event_genix'/);
    assert.match(reportsMigration, /idx_reports_business_context_created/);
});

test('dashboard and analytics aggregates include selected business scope', () => {
    const analytics = read('routes/analytics.js');
    const stats = read('routes/stats.js');
    const board = read('routes/board.js');
    const migration = read('db/migrations/236_dashboard_analytics_business_context_scope.sql');

    assert.match(analytics, /analyticsBusinessScope/);
    assert.match(analytics, /scopedAnalyticsCacheKey/);
    assert.match(analytics, /pushBusinessScopeCondition\(params, businessScope, 'b'\)/);
    assert.match(analytics, /FROM finance_transactions ft[\s\S]*AND \$\{businessCondition\}/);
    assert.match(analytics, /FROM customers c[\s\S]*AND \$\{businessCondition\}/);
    assert.match(analytics, /FROM leads l[\s\S]*AND \$\{totalsBusiness\}/);
    assert.match(analytics, /FROM hr_time_records tr[\s\S]*AND \$\{businessCondition\}/);
    assert.match(analytics, /businessScope: businessScopeMeta\(businessScope\)/);
    assert.doesNotMatch(analytics, /actorScopedCacheKey\(req, 'overview'/);
    assert.doesNotMatch(analytics, /actorScopedCacheKey\(req, 'charts'/);
    assert.doesNotMatch(analytics, /actorScopedCacheKey\(req, 'comparison'/);

    assert.match(stats, /statsBusinessScope/);
    assert.match(stats, /scopedStatsCacheKey/);
    assert.match(stats, /pushBusinessScopeCondition\(hourParams, businessScope, 'b2'\)/);
    assert.match(stats, /LEFT JOIN lines_by_date l[\s\S]*COALESCE\(l\.business_context, 'event_genix'\) = COALESCE\(b\.business_context, 'event_genix'\)/);
    assert.match(stats, /FROM event_reviews er[\s\S]*WHERE \$\{summaryBusiness\}/);
    assert.match(stats, /FROM team_pulse[\s\S]*AND \$\{dailyBusiness\}/);
    assert.match(stats, /businessScope: businessScopeMeta\(businessScope\)/);

    assert.match(board, /resolveBusinessScope/);
    assert.match(board, /pushBusinessScopeCondition\(bookingParams, businessScope, 'b'\)/);
    assert.match(board, /FROM staff_schedule[\s\S]*AND \$\{staffBusinessCondition\}/);
    assert.match(board, /businessScope: \{/);

    assert.match(migration, /ALTER TABLE hr_time_records[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /ALTER TABLE staff_schedule[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /ALTER TABLE event_reviews[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /ALTER TABLE team_pulse[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /idx_hr_time_records_business_date/);
    assert.match(migration, /idx_event_reviews_business_created/);
    assert.match(migration, /idx_team_pulse_business_date/);
});

test('task engine reads, writes, duplicates, and dashboard task widgets are business-scoped', () => {
    const migration = read('db/migrations/237_tasks_business_context_scope.sql');
    const taskScope = read('services/taskBusinessScope.js');
    const tasksRoute = read('routes/tasks.js');
    const kleshnya = read('services/kleshnya.js');
    const duplicates = read('services/taskDuplicatePolicy.js');
    const execution = read('services/taskExecution.js');
    const scheduling = read('services/taskScheduling.js');
    const productivity = read('services/taskProductivity.js');
    const board = read('routes/board.js');
    const dashboard = read('routes/dashboard.js');
    const auth = read('routes/auth.js');
    const sidebar = read('js/components/sidebar.js');

    assert.match(migration, /ALTER TABLE tasks[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /SET business_context = COALESCE\(b\.business_context, t\.business_context, 'event_genix'\)/);
    assert.match(migration, /SET business_context = COALESCE\(l\.business_context, t\.business_context, 'event_genix'\)/);
    assert.match(migration, /SET business_context = COALESCE\(c\.business_context, t\.business_context, 'event_genix'\)/);
    assert.match(migration, /SET business_context = COALESCE\(r\.business_context, t\.business_context, 'event_genix'\)/);
    assert.match(migration, /SET business_context = COALESCE\(cnv\.business_context, t\.business_context, 'event_genix'\)/);
    assert.match(migration, /idx_tasks_business_status_date/);
    assert.match(migration, /idx_tasks_business_owner_active/);
    assert.match(migration, /idx_tasks_business_source/);

    assert.match(taskScope, /ensureTaskBusinessScope/);
    assert.match(taskScope, /ensureWritableTaskBusinessScope/);
    assert.match(taskScope, /pushBusinessScopeCondition\(params, scopeOrContext/);
    assert.match(taskScope, /taskBusinessScopeMeta/);

    assert.match(kleshnya, /INSERT INTO tasks \(business_context/);
    assert.match(kleshnya, /businessContext: taskBusinessContext/);
    assert.match(duplicates, /COALESCE\(t\.business_context, '\$\{DEFAULT_TASK_BUSINESS_CONTEXT\}'\) = \$8/);
    assert.match(duplicates, /COALESCE\(\$\{alias\}\.business_context, '\$\{DEFAULT_TASK_BUSINESS_CONTEXT\}'\)/);

    assert.match(tasksRoute, /requireTaskReadScope/);
    assert.match(tasksRoute, /requireTaskWriteScope/);
    assert.match(tasksRoute, /conditions\.push\(pushTaskBusinessScopeCondition\(params, businessScope, 't'\)\)/);
    assert.match(tasksRoute, /businessScope: taskBusinessScopeMeta\(businessScope\)/);
    assert.match(tasksRoute, /completeTask\(req\.params\.id, req\.user,[\s\S]*businessScope/);
    assert.match(tasksRoute, /scheduleTask\(id, \{ \.\.\.b, date \}, req\.user,[\s\S]*businessScope/);
    assert.match(tasksRoute, /DELETE FROM tasks WHERE id = \$1 \$\{businessCondition\}/);
    assert.match(tasksRoute, /UPDATE tasks t[\s\S]*\$\{businessCondition\}/);

    assert.match(execution, /appendTaskBusinessScopeSql/);
    assert.match(execution, /getVisibleTask\(taskId, actor, \{ pool: query, businessScope/);
    assert.match(execution, /AND COALESCE\(business_context, 'event_genix'\) = \$5/);
    assert.match(scheduling, /appendTaskBusinessScopeSql/);
    assert.match(scheduling, /loadScheduledIntervals\(query, \{ ownerUserId, start, end, excludeTaskId = null, businessContext = null \}/);
    assert.match(scheduling, /AND COALESCE\(business_context, 'event_genix'\) = \$15/);
    assert.match(productivity, /taskBusinessScopeMeta/);

    assert.match(board, /pushBusinessScopeCondition\(taskParams, businessScope, 't'\)/);
    assert.match(dashboard, /dashboardBusinessScope/);
    assert.match(dashboard, /appendDashboardBusinessScope\(params, businessScope, 't'\)/);
    assert.match(dashboard, /buildEventRiskSummary\(req\.user, businessScope\)/);
    assert.match(auth, /requireWritableBusinessScope/);
    assert.match(auth, /pushBusinessScopeCondition\(ownerParams, businessScope, 'tasks'\)/);
    assert.match(auth, /WHERE id = \$2 AND \$\{updateBusinessCondition\}/);
    assert.match(sidebar, /getAuthHeaders\(false\)/);
    assert.match(sidebar, /CrmBusinessContext\?\.apiUrl/);
});
