const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const staffRoute = fs.readFileSync('routes/staff.js', 'utf8');
const staffPage = fs.readFileSync('js/staff-page.js', 'utf8');
const staffHtml = fs.readFileSync('staff.html', 'utf8');
const staffCss = fs.readFileSync('css/pages-hr-staff.css', 'utf8');

function routeBlock(path) {
    const start = staffRoute.indexOf(`router.get('${path}'`);
    assert.notEqual(start, -1, `Missing GET ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

describe('staff schedule safety guards', () => {
    it('keeps schedule read endpoints free of hidden write-backfills', () => {
        assert.doesNotMatch(routeBlock('/schedule'), /backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(routeBlock('/schedule/hours'), /backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(routeBlock('/schedule/check/:date'), /backfillStaffScheduleFromHrShifts/);
    });

    it('logs schedule write history into existing HR audit log', () => {
        assert.match(staffRoute, /router\.get\('\/schedule\/history\/:staffId\/:date'/);
        assert.match(staffRoute, /INSERT INTO hr_audit_log \(action, staff_id, performed_by, details, ip_address\)/);
        assert.match(staffRoute, /staff_schedule_update/);
        assert.match(staffRoute, /staff_schedule_bulk_update/);
        assert.match(staffRoute, /staff_schedule_copy_week/);
        assert.match(staffRoute, /staff_schedule_replacement_set/);
    });

    it('does not treat empty schedule cells as working in UI summaries and export', () => {
        assert.doesNotMatch(staffPage, /entry \? entry\.status : 'working'/);
        assert.match(staffPage, /entry \? normalizeScheduleStatus\(entry\.status\) : 'unset'/);
    });

    it('renders explicit cell history UI and fetches it from the staff API', () => {
        assert.match(staffHtml, /id="schHistoryList"/);
        assert.match(staffHtml, /Історія клітинки/);
        assert.match(staffPage, /function renderScheduleHistoryList/);
        assert.match(staffPage, /fetchScheduleHistory/);
        assert.match(staffPage, /\/api\/staff\/schedule\/history\/\$\{encodeURIComponent\(staffId\)\}/);
    });
    it('marks partial shifts with durable load classes and theme-safe colors', () => {
        assert.match(staffPage, /const STAFF_FULL_SHIFT_MINUTES = 8 \* 60/);
        assert.match(staffPage, /function scheduleShiftLoadMeta/);
        assert.match(staffPage, /bucket = 'half'/);
        assert.match(staffPage, /bucket = 'three-quarter'/);
        assert.match(staffPage, /bucket = 'long'/);
        assert.match(staffPage, /className: `shift-load-\$\{bucket\}`/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}/);
        assert.match(staffPage, /data-shift-load="\$\{loadMeta\.bucket \|\| ''\}"/);
        assert.doesNotMatch(staffPage, /class="sch-load-badge"/);
        assert.match(staffCss, /\.sch-cell \.sch-load-badge/);
        assert.match(staffCss, /display: none !important/);
        assert.match(staffCss, /--sch-load-marker/);
        assert.match(staffCss, /\.sch-cell\[class\*="shift-load-"\]::after/);
        assert.match(staffCss, /\.sch-cell\.shift-load-half/);
        assert.match(staffCss, /\.sch-cell\.shift-load-three-quarter/);
        assert.match(staffCss, /\.sch-cell\.shift-load-long/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-half/);
        assert.match(staffCss, /\[data-theme="dark"\] body\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-three-quarter/);
    });
});
