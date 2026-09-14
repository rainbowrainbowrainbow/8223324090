'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { projectParkStaffSchedulePayload } = require('../services/parkStaffScheduleProjection');

const root = path.resolve(__dirname, '..');
const apiCode = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
const staffCode = fs.readFileSync(path.join(root, 'js/staff-page.js'), 'utf8');
const dateRange = ['2026-09-13', '2026-09-21'];

function response(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get() { return null; } },
        async json() { return body; },
        clone() { return response(status, body); }
    };
}

function loadSchedule(fetchImpl, businessContext = 'event_genix') {
    const user = {
        id: 9701,
        role: 'director',
        activeBusinessContext: businessContext,
        businessContextPolicy: {
            allowed: ['event_genix', 'park_restaurant'],
            defaultContext: 'event_genix'
        }
    };
    const storage = new Map([
        ['pzp_token', 'test-access-token'],
        ['pzp_access_token', 'test-access-token'],
        ['pzp_current_user', JSON.stringify(user)]
    ]);
    const elements = new Map();
    for (const id of ['addStaffBtn', 'copyWeekBtn', 'fillWeekBtn', 'bulkCreateBtn', 'importExcelBtn', 'excelImportInput', 'exportExcelBtn', 'printBtn']) {
        elements.set(id, { style: {}, hidden: false, disabled: false, setAttribute() {} });
    }
    const context = {
        console: { warn() {}, error() {}, log() {} },
        URL,
        URLSearchParams,
        Date,
        AbortController,
        setTimeout,
        clearTimeout,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        AppState: { currentUser: user },
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        window: {
            location: { origin: 'http://localhost', pathname: '/staff', search: `?businessContext=${businessContext}`, href: `http://localhost/staff?businessContext=${businessContext}` },
            history: { replaceState() {} }
        },
        document: {
            documentElement: { classList: { contains() { return false; } } },
            addEventListener() {},
            getElementById: id => elements.get(id) || null,
            querySelector() { return null; }
        },
        fetch: fetchImpl,
        showNotification() {}
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(apiCode, context, { filename: 'js/api.js' });
    vm.runInContext(staffCode.replace('window.StaffSchedulePage = {', `
window.scheduleReads = {
    state: StaffState,
    fetchHrProfessions,
    fetchStaff,
    fetchSchedule,
    fetchScheduleAttendance,
    fetchScheduleHours,
    fetchScheduleHistory,
    syncScheduleRangeActionAvailability,
    validateSchedulePlan,
    schedulePaidRolePreview,
    schedulePaidRoleOptions,
    usePlan(entry) {
        const segments = scheduleEntrySegmentsForUi(entry, entry.profession_key);
        readSchedulePlanSegments = () => segments;
        return segments;
    }
};
window.StaffSchedulePage = {`), context, { filename: 'js/staff-page.js' });
    return { api: context.window.scheduleReads, elements, context, storage };
}

const reads = [
    ['fetchHrProfessions', [], '/api/hr/professions'],
    ['fetchStaff', [], '/api/staff?active=true'],
    ['fetchSchedule', dateRange, '/api/staff/schedule?'],
    ['fetchScheduleAttendance', dateRange, '/api/staff/attendance?'],
    ['fetchScheduleHours', dateRange, '/api/staff/schedule/hours?'],
    ['fetchScheduleHistory', [9701, dateRange[0]], '/api/staff/schedule/history/9701/']
];

for (const businessContext of ['event_genix', 'park_restaurant']) {
    test(`all schedule read dependencies send the selected ${businessContext} context`, async () => {
        const calls = [];
        const { api } = loadSchedule(async (url, options) => {
            calls.push({ url, options });
            return response(200, { success: true, data: [], departments: {} });
        }, businessContext);
        for (const [name, args, prefix] of reads) {
            const result = await api[name](...args);
            assert.equal(result.success, true, name);
            const call = calls.at(-1);
            assert.ok(call.url.startsWith(prefix), name);
            assert.equal(call.options.headers['X-Business-Context'], businessContext, name);
            assert.equal(call.options.headers.Authorization, 'Bearer test-access-token', name);
        }
        assert.equal(calls.length, reads.length);
    });
}

test('range and history reads preserve cancellation through the shared client', async () => {
    const controller = new AbortController();
    controller.abort();
    const { api } = loadSchedule(async (_url, options) => {
        assert.equal(options.signal, controller.signal);
        options.signal.throwIfAborted();
    });
    for (const [name, args] of reads.slice(2)) {
        const result = await api[name](...args, { signal: controller.signal });
        assert.equal(result.success, false, name);
        assert.equal(result.aborted, true, name);
    }
});

test('denied schedule reads retain the server error without retrying another business', async () => {
    const calls = [];
    const { api } = loadSchedule(async (url, options) => {
        calls.push({ url, options });
        return response(403, { success: false, code: 'staff_not_migrated', error: 'Staff unavailable for this business' });
    }, 'park_restaurant');
    for (const [name, args] of reads.filter(([name]) => ['fetchSchedule', 'fetchScheduleHours', 'fetchScheduleHistory'].includes(name))) {
        const result = await api[name](...args);
        assert.equal(result.success, false, name);
        assert.equal(result.error, 'Staff unavailable for this business', name);
    }
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.options.headers['X-Business-Context'] === 'park_restaurant'));
});

test('denied attendance remains unavailable and never supplies stale attendance', async () => {
    const { api } = loadSchedule(async () => response(403, { success: false, error: 'Denied' }));
    api.state.attendance = { '9701_2026-09-13': { staff_id: 9701 } };
    const result = await api.fetchScheduleAttendance(...dateRange);
    assert.equal(result.success, true);
    assert.equal(result.unavailable, true);
    assert.deepEqual(Object.keys(result.attendance), []);
    assert.equal(result.attendanceSummary, null);
});

for (const name of ['fetchStaff', 'fetchSchedule']) {
    test(`${name} applies server read-only access without granting denied capabilities or disabling print`, async () => {
        const { api, elements } = loadSchedule(async () => response(200, {
            success: true,
            data: [],
            departments: {},
            scheduleAccess: { readOnly: true, businessContext: 'event_genix' }
        }));
        Object.assign(api.state, {
            canViewSchedule: true,
            canViewStaff: false,
            canManageSchedule: true,
            canManageStaff: true,
            canExportSchedule: true,
            rangeStart: new Date(`${dateRange[0]}T00:00:00`),
            rangeEnd: new Date(`${dateRange[1]}T00:00:00`),
            scheduleLoadedRange: { from: dateRange[0], to: dateRange[1] },
            rangeLoadState: 'ready'
        });
        const result = await api[name](...dateRange);
        api.syncScheduleRangeActionAvailability();
        assert.equal(result.success, true);
        assert.equal(api.state.canManageSchedule, false);
        assert.equal(api.state.canManageStaff, false);
        assert.equal(api.state.canExportSchedule, false);
        assert.equal(api.state.recoveryReadOnly, true);
        assert.equal(api.state.canViewSchedule, true);
        assert.equal(api.state.canViewStaff, false);
        for (const [id, element] of elements) {
            if (id === 'printBtn') {
                assert.equal(element.hidden, false);
                assert.equal(element.disabled, false);
            } else {
                assert.equal(element.disabled, true, id);
            }
        }
    });
}

test('compatibility responses do not grant or remove existing capabilities', async () => {
    const { api } = loadSchedule(async () => response(200, { success: true, data: [], departments: {} }));
    Object.assign(api.state, { canManageSchedule: true, canManageStaff: false, canExportSchedule: false });
    await api.fetchStaff();
    await api.fetchSchedule(...dateRange);
    assert.equal(api.state.canManageSchedule, true);
    assert.equal(api.state.canManageStaff, false);
    assert.equal(api.state.canExportSchedule, false);
});

test('projected recovery plan preserves physical validation without inventing missing payroll rates', async () => {
    const projected = projectParkStaffSchedulePayload('staff', '/schedule', {
        success: true,
        data: [{
            staff_id: 9701,
            date: dateRange[0],
            profession_key: 'animator',
            shift_start: '10:00',
            shift_end: '18:00',
            status: 'working',
            segments: [{
                professionKey: 'animator',
                shiftStart: '10:00',
                shiftEnd: '18:00',
                breakMinutes: 0,
                additionalProfessionKeys: ['reception'],
                additionalRoles: [{ professionKey: 'reception', compensationMode: 'paid_hourly', payMultiplier: 1 }]
            }]
        }]
    });
    const { api, elements } = loadSchedule(async () => response(200, {
        ...projected,
        scheduleAccess: { readOnly: true, businessContext: 'event_genix' }
    }));
    api.state.staff = [{ id: 9701, role_type: 'animator', secondary_professions: ['reception'] }];
    api.state.editingCell = { staffId: 9701, date: dateRange[0] };
    elements.set('schStatus', { value: 'working' });
    elements.set('schPrimaryProfession', { value: 'animator' });
    const segments = api.usePlan(projected.data[0]);
    // Mirror the disabled editor fields populated from the physical segment.
    Object.assign(segments[0].additionalRoles[0], {
        payMultiplier: 1, intervalStart: segments[0].shiftStart, intervalEnd: segments[0].shiftEnd
    });
    assert.ok(api.validateSchedulePlan('schedule').errorCodes.includes('HR_SHIFT_PAID_ROLE_RATE_REQUIRED'),
        'compatibility editing still requires an explicit paid-role rate');
    await api.fetchSchedule(...dateRange);
    const validation = api.validateSchedulePlan('schedule');
    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.equal(validation.metrics.physicalMinutes, 480);
    assert.equal(validation.errorCodes.includes('HR_SHIFT_PAID_ROLE_RATE_REQUIRED'), false);
    assert.equal(api.schedulePaidRolePreview('schedule', segments[0].additionalRoles[0], segments[0]),
        'Дані оплати недоступні в режимі перегляду');
    assert.doesNotMatch(api.schedulePaidRoleOptions('schedule', [{ value: 'reception', label: 'Рецепція' }], segments[0]),
        /немає явної ставки/);
    segments[0].shiftEnd = segments[0].shiftStart;
    const invalidPhysicalPlan = api.validateSchedulePlan('schedule');
    assert.equal(invalidPhysicalPlan.valid, false);
    assert.match(invalidPhysicalPlan.errors.join('; '), /Початок і завершення не можуть збігатися/);
    assert.equal(api.state.canManageSchedule, false);
});
