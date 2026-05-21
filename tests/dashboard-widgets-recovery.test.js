const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('dashboard restores widget manager, full registry, and creator tasker contracts', () => {
    const pageJs = read('js/dashboard-page.js');
    const dashboardHtml = read('dashboard.html');
    const routes = read('routes/dashboard.js');
    const roles = read('config/roles.js');
    const css = read('css/dashboard.css');

    assert.match(pageJs, /const DASHBOARD_RETIRED_WIDGETS = new Set\(\)/);
    assert.match(pageJs, /const BOARD_LIVE_WIDGET_CAP = 18/);
    assert.match(pageJs, /maxLiveWidgets: safeNumber\(preferences\.maxLiveWidgets, BOARD_LIVE_WIDGET_CAP, 1, 24\)/);
    assert.match(routes, /maxLiveWidgets: safeNumber\(preferencesSource\.maxLiveWidgets, 18, 1, 24\)/);

    for (const key of ['my_focus', 'finance_today', 'reports_today', 'account_stats', 'week_bookings', 'task_health']) {
        assert.match(pageJs, new RegExp(`${key}:`), `${key} should be declared in the frontend widget registry`);
    }

    assert.match(dashboardHtml, /DashboardPage\.openWidgetManager\(\)/);
    assert.match(pageJs, /function openWidgetManager\(\)/);

    assert.match(roles, /personal_tasker: 'creator'/);
    assert.match(roles, /creator:\s*\[\s*'personal_tasker'/);
    assert.match(routes, /case 'personal_tasker'/);
    assert.match(routes, /req\.user\.role !== 'creator'/);
    assert.match(routes, /buildPersonalTaskerPayload/);

    assert.match(pageJs, /function renderPersonalTasker/);
    assert.match(pageJs, /assigned_to_me/);
    assert.match(pageJs, /created_by_me/);
    assert.match(pageJs, /all_tasks/);
    assert.match(pageJs, /function openPersonalTaskerFullscreen/);
    assert.match(pageJs, /function closePersonalTaskerFullscreen/);
    assert.match(css, /\.personal-tasker-fullscreen-overlay/);
});
