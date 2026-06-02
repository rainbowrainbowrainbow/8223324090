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

test('system automations create and mutate operational rows inside one business context', () => {
    const migration = read('db/migrations/238_system_automation_business_context_scope.sql');
    const templates = read('routes/task-templates.js');
    const scheduler = read('services/scheduler.js');
    const replyEscalation = read('services/replyEscalation.js');
    const taskScheduling = read('services/taskScheduling.js');
    const lifecycle = read('services/taskLifecycle.js');
    const hr = read('services/hr.js');
    const telegram = read('routes/telegram.js');

    assert.match(migration, /ALTER TABLE task_templates[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /ALTER TABLE auto_order_rules[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /ALTER TABLE auto_order_requests[\s\S]*business_context VARCHAR\(64\)/);
    assert.match(migration, /UPDATE auto_order_rules aor[\s\S]*COALESCE\(ws\.business_context/);
    assert.match(migration, /idx_task_templates_business_active_created/);
    assert.match(migration, /idx_auto_order_rules_business_active_stock/);
    assert.match(migration, /idx_auto_order_requests_business_status_created/);

    assert.match(templates, /ensureTaskBusinessScope/);
    assert.match(templates, /ensureWritableTaskBusinessScope/);
    assert.match(templates, /pushTaskBusinessScopeCondition\(params, businessScope, ''\)/);
    assert.match(templates, /INSERT INTO task_templates \(business_context/);
    assert.match(templates, /businessContext: row\.business_context \|\| 'event_genix'/);

    assert.match(scheduler, /COALESCE\(business_context, \$1\) AS business_context[\s\S]*FROM task_templates/);
    assert.match(scheduler, /businessContext: activeTaskBusinessContext\(tpl\.business_context/);
    assert.match(scheduler, /FROM tasks WHERE date = \$1 AND \$\{reportTaskBusinessScope\}/);
    assert.match(scheduler, /COALESCE\(l\.business_context, '\$\{DEFAULT_BUSINESS_CONTEXT\}'\) AS business_context/);
    assert.match(scheduler, /businessContext: activeTaskBusinessContext\(lead\.business_context/);
    assert.match(scheduler, /INSERT INTO auto_order_requests \(business_context, stock_id/);
    assert.match(scheduler, /COALESCE\(req\.business_context, '\$\{DEFAULT_BUSINESS_CONTEXT\}'\) = COALESCE\(ws\.business_context/);

    assert.match(replyEscalation, /DEFAULT_TASK_BUSINESS_CONTEXT/);
    assert.match(replyEscalation, /COALESCE\(c\.business_context, '\$\{DEFAULT_TASK_BUSINESS_CONTEXT\}'\) AS business_context/);
    assert.match(replyEscalation, /INSERT INTO tasks \([\s\S]*business_context, title/);
    assert.match(replyEscalation, /COALESCE\(business_context, '\$\{DEFAULT_TASK_BUSINESS_CONTEXT\}'\) = \$1/);

    assert.match(taskScheduling, /businessContext: taskBusinessContext/);
    assert.match(taskScheduling, /business_context: taskBusinessContext/);
    assert.match(lifecycle, /business_context/);
    assert.match(lifecycle, /COALESCE\(business_context, 'event_genix'\) = \$3/);

    assert.match(hr, /DEFAULT_BUSINESS_CONTEXT/);
    assert.match(hr, /COALESCE\(tr\.business_context, 'event_genix'\) = \$2/);
    assert.match(hr, /INSERT INTO hr_time_records \(business_context/);

    assert.match(telegram, /INSERT INTO event_reviews \(business_context/);
    assert.match(telegram, /INSERT INTO team_pulse \(business_context, date, score\)/);
    assert.match(telegram, /UPDATE auto_order_requests[\s\S]*COALESCE\(business_context, 'event_genix'\) = \$5/);
});

test('timeline booking and line mutations stay inside the active timeline business context', () => {
    const bookings = read('routes/bookings.js');
    const lines = read('routes/lines.js');
    const bookingService = read('services/booking.js');
    const api = read('js/api.js');
    const timelineContext = read('js/timeline-context.js');
    const timeline = read('js/timeline.js');
    const ws = read('js/ws.js');

    assert.match(bookings, /function bookingContextSql/);
    assert.match(bookings, /function getScopedBookingById/);
    assert.match(bookings, /attachTimelineIdentityToBooking/);
    assert.match(bookings, /extra\.timelineIdentity/);
    assert.match(bookings, /getScopedBookingById\(client, id, businessContext, \{ forUpdate: true \}\)/);
    assert.match(bookings, /UPDATE bookings[\s\S]*WHERE \(id = \$4 OR linked_to = \$4\)[\s\S]*bookingContextSql\('', '\$5'\)/);
    assert.match(bookings, /DELETE FROM bookings WHERE \(id = \$1 OR linked_to = \$1\) AND \$\{bookingContextSql\('', '\$2'\)\}/);
    assert.match(bookings, /DELETE FROM finance_transactions WHERE booking_id = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2/);
    assert.match(bookings, /Customer does not belong to this business context/);
    assert.match(bookings, /updateAtomicLinkedBookingFields\(client, id, mainPatch, businessContext\)/);
    assert.match(bookings, /SELECT \* FROM bookings[\s\S]*id = ANY\(\$1::text\[\]\)[\s\S]*bookingContextSql\('', '\$2'\)/);

    assert.match(lines, /COALESCE\(l\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
    assert.match(lines, /businessContext,\s*name: row\.name/);
    assert.match(lines, /resourceType: 'animator'/);
    assert.match(lines, /DELETE FROM lines_by_date WHERE date = \$1 AND COALESCE\(business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
    assert.match(bookingService, /COALESCE\(business_context, 'event_genix'\) = \$3/);
    assert.match(bookingService, /COALESCE\(b\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = COALESCE\(l\.business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\)/);

    assert.match(api, /timelineApiUrl\('\/bookings'\)/);
    assert.match(api, /timelineApiUrl\('\/bookings\/full'\)/);
    assert.match(api, /timelineApiUrl\(`\/bookings\/\$\{encodeURIComponent\(id\)\}\/confirm`\)/);
    assert.match(api, /timelineApiUrl\(`\/bookings\/\$\{encodeURIComponent\(id\)\}\/linked-atomic`\)/);

    assert.match(timelineContext, /function contextState/);
    assert.match(timelineContext, /state: contextState/);
    assert.match(timelineContext, /timeline:business-context-changed/);
    assert.match(timelineContext, /crmBusinessContextChanged/);
    assert.match(timeline, /contextState\?\.activeBusinessContext/);
    assert.match(timeline, /function handleTimelineBusinessContextChanged/);
    assert.match(timeline, /AppState\.cachedBookings = \{\}/);
    assert.match(timeline, /businessContext: line\?\.businessContext/);
    assert.match(ws, /function _payloadMatchesCurrentTimelineBusiness/);
    assert.match(ws, /Ignoring booking event for another business context/);
    assert.match(ws, /Ignoring line event for another business context/);
});

test('legacy history API is business-scoped and uses server-side actor identity', () => {
    const history = read('routes/history.js');
    const migration = read('db/migrations/245_backend_booking_timeline_hardening.sql');

    assert.match(history, /resolveBusinessScope/);
    assert.match(history, /requireBusinessScope/);
    assert.match(history, /requireWritableBusinessScope/);
    assert.match(history, /pushBusinessScopeCondition\(params, scope, 'h'\)/);
    assert.match(history, /INSERT INTO history \(business_context, action, username, data\)/);
    assert.match(history, /historyActor\(req\)/);
    assert.doesNotMatch(history, /const \{ action, user, data \} = req\.body/);
    assert.match(migration, /ALTER TABLE history[\s\S]*ADD COLUMN IF NOT EXISTS business_context/);
    assert.match(migration, /ALTER COLUMN action TYPE VARCHAR\(64\)/);
});

test('background booking notifications and legacy bot reads stay inside a timeline business context', () => {
    const scopeHelper = read('services/timelineBusinessScope.js');
    const telegram = read('services/telegram.js');
    const bookings = read('routes/bookings.js');
    const scheduler = read('services/scheduler.js');
    const bot = read('services/bot.js');
    const telegramRoute = read('routes/telegram.js');
    const afisha = read('routes/afisha.js');
    const kleshnyaChat = read('services/kleshnya-chat.js');
    const kleshnyaGreeting = read('services/kleshnya-greeting.js');

    assert.match(scopeHelper, /function timelineBusinessContextSql/);
    assert.match(scopeHelper, /function pushTimelineBusinessContext/);
    assert.match(scopeHelper, /function pushDefaultTimelineBusinessContext/);
    assert.match(scopeHelper, /function timelineBusinessContextJoinSql/);

    assert.match(telegram, /function bookingTelegramBusinessContext/);
    assert.match(telegram, /SELECT telegram_message_id FROM bookings WHERE id = \$1 AND \$\{timelineBusinessContextSql\('', '\$2'\)\}/);
    assert.match(telegram, /UPDATE bookings SET telegram_message_id = \$1 WHERE id = \$2 AND \$\{timelineBusinessContextSql\('', '\$3'\)\}/);
    assert.match(telegram, /businessContext: normalizeTimelineContext\(businessContext\)/);

    assert.match(bookings, /notifyTelegram\('create', notifyPayload,[\s\S]*businessContext: booking\.businessContext \|\| DEFAULT_TIMELINE_CONTEXT/);
    assert.match(bookings, /notifyTelegram\('delete', booking, \{ username: req\.user\?\.username, lineName, businessContext \}\)/);
    assert.match(bookings, /notifyTelegram\('edit', bookingForNotify, \{ username, bookingId: id, lineName, businessContext \}\)/);

    assert.match(scheduler, /pushDefaultTimelineBusinessContext\(bookingParams, 'b'\)/);
    assert.match(scheduler, /FROM bookings b[\s\S]*AND \$\{bookingBusinessScope\}/);
    assert.match(scheduler, /FROM lines_by_date[\s\S]*AND \$\{lineBusinessScope\}/);
    assert.match(scheduler, /COALESCE\(business_context, '\$\{DEFAULT_TIMELINE_CONTEXT\}'\) = \$2/);
    assert.match(scheduler, /businessContext: DEFAULT_TIMELINE_CONTEXT/);

    assert.match(bot, /timelineBusinessContextJoinSql\('b', 'l'\)/);
    assert.match(bot, /FROM bookings b[\s\S]*AND \$\{businessScope\}/);
    assert.match(bot, /FROM bookings WHERE date >= \$1 AND date <= \$2 AND \$\{businessScope\}/);

    assert.match(telegramRoute, /SELECT name FROM lines_by_date WHERE date = \$1 AND \$\{lineScope\}/);
    assert.match(telegramRoute, /INSERT INTO lines_by_date \(business_context, date, line_id, name, color\)/);
    assert.match(afisha, /SELECT \* FROM bookings WHERE date = \$1 AND status != 'cancelled' AND \$\{bookingScope\}/);

    assert.match(kleshnyaChat, /function scopedBookingVisibility/);
    assert.match(kleshnyaChat, /pushTimelineBusinessContext\(params, alias, actorTimelineBusinessContext\(targetActor\)\)/);
    assert.match(kleshnyaGreeting, /function scopedGreetingBookingVisibility/);
    assert.match(kleshnyaGreeting, /SELECT COUNT\(DISTINCT l\.line_id\) as cnt FROM lines_by_date l WHERE l\.date = \$1 AND \$\{animScope\}/);
});
