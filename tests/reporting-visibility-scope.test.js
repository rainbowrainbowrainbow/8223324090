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
