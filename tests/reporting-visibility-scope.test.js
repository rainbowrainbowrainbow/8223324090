const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('reporting and helper booking summaries reuse canonical booking visibility', () => {
    const files = [
        'routes/analytics.js',
        'routes/stats.js',
        'routes/center.js',
        'routes/board.js',
        'routes/settings.js',
        'routes/chat.js',
        'services/kleshnya-chat.js',
        'services/kleshnya-greeting.js'
    ];

    for (const file of files) {
        const source = read(file);
        assert.match(source, /getVisibleBookingScope/, `${file} should consume canonical booking visibility`);
        assert.doesNotMatch(source, /reportingBookingVisibility|analyticsScopeHelperV2/i, `${file} must not add a second reporting visibility engine`);
    }
});

test('stats center and settings fallback guards match reporting surface semantics', () => {
    const stats = read('routes/stats.js');
    assert.match(stats, /router\.use\(requireRole\('manager'\)\)/, 'stats API should be manager-up, not auth-only');

    const center = read('routes/center.js');
    assert.match(center, /router\.use\(requireMinRole\('manager'\)\)/, 'center API should follow manager-up page semantics');

    const settings = read('routes/settings.js');
    assert.match(settings, /router\.get\('\/stats\/:dateFrom\/:dateTo', requireRole\('creator', 'director'\)/, 'settings stats fallback should be settings-role guarded');
});

test('scoped reporting caches include actor dimensions', () => {
    for (const file of ['routes/analytics.js', 'routes/stats.js']) {
        const source = read(file);
        assert.match(source, /function actorScopedCacheKey/, `${file} should define actor-scoped cache keys`);
        assert.match(source, /actor=.*role=.*name=/s, `${file} cache key should include actor, role, and username/name dimensions`);
        assert.doesNotMatch(source, /const cacheKey = `(?:overview|charts|comparison|bookings|revenue|programs|load|trends|forecast):\$\{/, `${file} should not use actor-agnostic reporting cache keys`);
    }
});

test('finance reporting remains explicitly privileged full-role', () => {
    const finance = read('routes/finance.js');
    assert.match(finance, /FINANCE_BOOKING_REPORTING_SCOPE = 'finance-full-role'/, 'finance broad semantics should be explicit');
    assert.match(finance, /requireRole\('creator', 'director', 'accountant'\)/, 'finance should stay restricted to finance-privileged roles');
});

test('cross-entity search and workspace shortcuts cannot bypass booking/task visibility', () => {
    const search = read('routes/search.js');
    assert.match(search, /PAGE_ACCESS/, 'global search should only search non-booking surfaces that the actor can open');
    assert.match(search, /getVisibleBookingScope\(req\.user, bookingParams, 'b'\)/, 'booking search should use canonical booking scope');
    assert.match(search, /buildTaskVisibilityScope\(req\.user, taskParams, 't'\)/, 'task search should use canonical task scope');
    assert.match(search, /staff: staff\.rows\.map/, 'staff results should remain inside the typed results payload');

    const searchClient = read('js/search.js');
    assert.match(searchClient, /const order = \['bookings', 'customers', 'tasks', 'staff'\]/, 'frontend search should include staff results only when API returns them');
    assert.doesNotMatch(search, /\/programs\?highlight=/, 'global search should not promote the standalone Programs page');
    assert.match(searchClient, /if \(item\.href\)/, 'frontend search should honor server-provided safe route targets');

    const customers = read('routes/customers.js');
    assert.match(customers, /router\.use\(requireRole\('admin', 'reception'\)\)/, 'customer routes should match page/sidebar access');
    assert.match(customers, /function scopedBookingAggregateSql/, 'customer booking aggregates should be scoped in one reusable helper');
    assert.match(customers, /getVisibleBookingScope\(req\.user, bookingParams, 'b'\)/, 'customer booking history should reuse canonical booking visibility');

    const leads = read('routes/leads.js');
    assert.match(leads, /router\.use\(requireRole\('manager', 'marketer'\)\)/, 'lead workspace routes should match sales funnel access');
    assert.match(leads, /getVisibleBookingScope\(req\.user, bookingParams, 'b'\)/, 'lead workspace linked bookings should be booking-scoped');
    assert.match(leads, /buildTaskVisibilityScope\(req\.user, taskParams, 't'\)/, 'lead workspace linked tasks should be task-scoped');
});

test('task observers extend canonical task visibility without mutation authority', () => {
    const policy = read('services/taskPolicy.js');
    assert.match(policy, /function buildTaskObserverMatch/, 'task observer visibility should live in taskPolicy');
    assert.match(policy, /FROM task_observers task_observer_scope/, 'visibility scope should use durable task_observers table');
    assert.match(policy, /function observesTask/, 'row-level canViewTask should understand observer metadata');
    assert.match(policy, /function canAccessTaskMaterials/, 'materials access should be an explicit read policy');
    assert.match(policy, /function canManageTaskObservers/, 'observer management should remain behind mutation/reassign authority');

    const tasksRoute = read('routes/tasks.js');
    assert.match(tasksRoute, /router\.get\('\/:id\/observers'/, 'task observers should have a read endpoint');
    assert.match(tasksRoute, /router\.put\('\/:id\/observers'/, 'task observers should have an explicit management endpoint');
    assert.match(tasksRoute, /materialsAccess: 'detail_subtasks_history_logs'/, 'observer access should expose task materials, not only the card');
    assert.match(tasksRoute, /TASK_ACTION_TYPES\.OBSERVERS_UPDATED/, 'observer changes should leave task action history');

    const migration = read('db/migrations/186_task_observer_visibility.sql');
    assert.match(migration, /CREATE TABLE IF NOT EXISTS task_observers/, 'observer policy should be durable schema');
    assert.match(migration, /PRIMARY KEY \(task_id, user_id\)/, 'observer rows should be idempotent per task/user');
});

test('notification and helper summaries use canonical booking scope and safe actor context', () => {
    const scheduler = read('services/scheduler.js');
    assert.match(scheduler, /SYSTEM_BOOKING_NOTIFICATION_ACTOR/, 'scheduler should make privileged system broadcasts explicit');
    assert.match(scheduler, /function notificationActor\(actor\)/, 'scheduler should centralize notification actor selection');
    assert.match(scheduler, /async function buildAndSendDigest\(date, actor = null\)/, 'manual digest should accept an actor for scoped previews');
    assert.match(scheduler, /async function sendTomorrowReminder\(todayStr, actor = null\)/, 'manual reminder should accept an actor for scoped previews');
    assert.match(scheduler, /getVisibleBookingScope\(bookingActor, bookingParams, 'b'\)/, 'digest/reminder booking queries should use canonical visibility');
    assert.match(scheduler, /canViewBooking\(\{ role: 'animator', staffIds: \[s\.id\] \}, booking\)/, 'staff push notifications should verify each recipient can see the booking');

    const telegram = read('routes/telegram.js');
    assert.match(telegram, /buildAndSendDigest\(date, req\.user\)/, 'manual Telegram digest trigger should pass request actor');
    assert.match(telegram, /sendTomorrowReminder\(date, req\.user\)/, 'manual Telegram reminder trigger should pass request actor');

    const bot = read('services/bot.js');
    assert.match(bot, /resolveTelegramBookingActor/, 'bot day summaries should resolve Telegram users into booking actors');
    assert.match(bot, /handleDaySummary\([\s\S]*?await resolveTelegramBookingActor/, 'bot /today and /tomorrow should pass scoped booking actor into summaries');
});
