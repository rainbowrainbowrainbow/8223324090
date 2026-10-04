'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js/hr-today-print.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'hr.html'), 'utf8');

function fixture(options = {}) {
    const dom = new JSDOM('<button id="btnHrTodayPrint" hidden></button>', {
        url: 'https://fixture.local/hr#today', runScripts: 'outside-only'
    });
    const { window: win } = dom;
    const calls = [];
    const today = options.today || {
        success: true, date: '2026-10-04', data: [
            { staff_id: 2, staff_name: '<Ірина>', shift: { shift_type: 'working', segments: [
                { professionKey: 'animator', shiftStart: '09:00', shiftEnd: '12:00' },
                { professionKey: 'host', shiftStart: '14:00', shiftEnd: '18:00' }
            ] }, record: { compensation_snapshot: { hourlyRate: 98765 } } },
            { staff_id: 3, staff_name: 'Позапланова', shift: null },
            { staff_id: 4, staff_name: 'Вихідний', shift: { shift_type: 'dayoff', segments: [] } }
        ]
    };
    const staff = options.staff || { success: true, data: [
        { id: 2, name: '<Ірина>', role_type: 'animator', secondary_professions: ['host', 'animator'], hourly_rate: 98765 }
    ] };
    win.getHrCurrentUser = () => ({ activeBusinessContext: 'event_genix' });
    win.resolveCrmBusinessScopeState = () => ({ mode: options.scope || 'single', activeContext: 'event_genix' });
    win.canExportHrReports = () => options.exportAllowed !== false;
    win.canUseHrCapability = capability => options.deniedCapability !== capability;
    win.professionTitle = key => ({ animator: 'Аніматор', host: 'Ведучий' }[key] || key);
    win.hrFetch = async endpoint => {
        calls.push(endpoint);
        return today;
    };
    win.apiFetchWithAuthRetry = async endpoint => {
        calls.push(endpoint);
        return { ok: staff.success === true, async json() { return staff; } };
    };
    win.eval(script);
    win.HrTodayPrint.init();
    return { dom, win, calls, today, staff };
}

test('Today print uses scheduled staff and preserves every planned segment and eligible role', () => {
    const { dom, win, today, staff } = fixture();
    try {
        const rows = win.HrTodayPrint.buildRows(today, staff);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].segments.length, 2);
        assert.equal(win.HrTodayPrint.plannedSegments({ planned_start: '09:00', planned_end: '18:00' }, 'animator')[0].profession, 'animator');
        assert.deepEqual(Array.from(rows[0].eligible), ['animator', 'host']);
        const html = win.HrTodayPrint.buildSheetHtml(today.date, rows, 3);
        assert.match(html, /Аніматор · 09:00–12:00/);
        assert.match(html, /Ведучий · 14:00–18:00/);
        assert.equal((html.match(/class="empty-row"/g) || []).length, 3);
        assert.equal((html.match(/class="paper-checkbox"/g) || []).length, 5);
        assert.match(html, /&lt;Ірина&gt;/);
        assert.doesNotMatch(html, /98765|Позапланова|Вихідний|compensation_snapshot/);
        assert.match(html, /<thead>/);
        assert.match(html, /Прихід<\/th><th>Вихід<\/th><th>Примітка<\/th><th>Підпис/);
        const longSheet = win.HrTodayPrint.buildSheetHtml(today.date, Array.from({ length: 36 }, (_, index) => ({
            ...rows[0], name: `Тест ${index + 1}`,
            segments: [{ profession: 'animator', start: '09:00', end: '18:00' }], eligible: ['animator']
        })), 5);
        assert.equal((longSheet.match(/class="sheet-page"/g) || []).length, 3);
        assert.equal((longSheet.match(/Бланк відмічалки на сьогодні<\/strong>/g) || []).length, 3);
    } finally { dom.window.close(); }
});

test('Today print only performs scoped reads and handles empty, loading, and failed reads', async () => {
    const { dom, win, calls } = fixture();
    try {
        win.document.getElementById('btnHrTodayPrint').click();
        const status = win.document.getElementById('hrTodayPrintStatus');
        assert.match(status.textContent, /Завантажуємо/);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, ['/today', '/api/staff']);
        assert.match(status.textContent, /1 людей за графіком/);
        assert.equal(win.document.getElementById('hrTodayPrintFrame').hidden, false);
        const input = win.document.getElementById('hrTodayPrintEmptyRows');
        input.value = '0';
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
        assert.doesNotMatch(win.document.getElementById('hrTodayPrintFrame').srcdoc, /class="empty-row"/);
        win.document.getElementById('hrTodayPrintClose').click();
        assert.equal(win.document.getElementById('hrTodayPrintDialog').hidden, true);
    } finally { dom.window.close(); }

    const empty = fixture({ today: { success: true, date: '2026-10-04', data: [] }, staff: { success: true, data: [] } });
    try {
        empty.win.document.getElementById('btnHrTodayPrint').click();
        await new Promise(resolve => setImmediate(resolve));
        assert.match(empty.win.document.getElementById('hrTodayPrintStatus').textContent, /Немає людей за графіком/);
        empty.win.document.getElementById('hrTodayPrintEmptyRows').value = '0';
        empty.win.document.getElementById('hrTodayPrintEmptyRows').dispatchEvent(new empty.win.Event('input'));
        assert.equal(empty.win.document.getElementById('hrTodayPrintGo').disabled, true);
    } finally { empty.dom.window.close(); }

    const failed = fixture({ staff: { success: false, error: 'Недоступно' } });
    try {
        failed.win.document.getElementById('btnHrTodayPrint').click();
        await new Promise(resolve => setImmediate(resolve));
        assert.match(failed.win.document.getElementById('hrTodayPrintStatus').textContent, /Недоступно/);
        assert.equal(failed.win.document.getElementById('hrTodayPrintGo').disabled, true);
        assert.equal(failed.win.document.getElementById('hrTodayPrintFrame').hidden, true);
    } finally { failed.dom.window.close(); }
});

test('Today print respects existing export and staff visibility and keeps integration narrow', () => {
    for (const options of [{ exportAllowed: false }, { deniedCapability: 'hr.today.view' }, { deniedCapability: 'hr.schedule.view' }, { scope: 'multi' }]) {
        const { dom, win, calls } = fixture(options);
        try {
            assert.equal(win.document.getElementById('btnHrTodayPrint').hidden, true);
            win.document.getElementById('btnHrTodayPrint').click();
            assert.deepEqual(calls, []);
        } finally { dom.window.close(); }
    }
    assert.match(page, /id="btnHrTodayPrint"/);
    assert.match(page, /js\/hr-today-print\.js/);
    assert.match(page, /css\/hr-today-print\.css/);
});
