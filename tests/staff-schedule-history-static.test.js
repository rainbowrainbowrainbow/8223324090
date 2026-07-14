const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const staffDisplayGroups = require('../services/staffDisplayGroups');

const staffRoute = fs.readFileSync('routes/staff.js', 'utf8');
const hrRoute = fs.readFileSync('routes/hr.js', 'utf8');
const staffDisplayGroupService = fs.readFileSync('services/staffDisplayGroups.js', 'utf8');
const staffOperationalFilters = fs.readFileSync('services/staffOperationalFilters.js', 'utf8');
const staffScheduleMutations = fs.readFileSync('services/staffScheduleMutations.js', 'utf8');
const hrPage = fs.readFileSync('js/hr-page.js', 'utf8');
const staffPage = fs.readFileSync('js/staff-page.js', 'utf8');
const uiPage = fs.readFileSync('js/ui.js', 'utf8');
const staffHtml = fs.readFileSync('staff.html', 'utf8');
const staffScheduleShell = fs.readFileSync('js/staff-schedule-shell.js', 'utf8');
const staffCss = fs.readFileSync('css/pages-hr-staff.css', 'utf8');
const staffScheduleBrowserSmoke = fs.readFileSync('tests/browser/staff-schedule-custom-range-browser-smoke.js', 'utf8');
const liveStaffScheduleSmoke = fs.readFileSync('scripts/live-staff-schedule-smoke.js', 'utf8');

function namedFunctionBlock(source, functionName) {
    const markerPattern = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
    const marker = markerPattern.exec(source);
    assert.ok(marker, `Missing function ${functionName}`);
    const start = marker.index;
    const remainder = source.slice(start + marker[0].length);
    const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(remainder);
    return source.slice(start, nextFunction ? start + marker[0].length + nextFunction.index : source.length);
}

function routeBlock(path) {
    const start = staffRoute.indexOf(`router.get('${path}'`);
    assert.notEqual(start, -1, `Missing GET ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

function hrRouteBlock(path) {
    const start = hrRoute.indexOf(`router.get('${path}'`);
    assert.notEqual(start, -1, `Missing HR GET ${path}`);
    const nextRoute = hrRoute.indexOf('\nrouter.', start + 1);
    return hrRoute.slice(start, nextRoute === -1 ? hrRoute.length : nextRoute);
}

function routePostBlock(path) {
    const start = staffRoute.indexOf(`router.post('${path}'`);
    assert.notEqual(start, -1, `Missing POST ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

function routePutBlock(path) {
    const start = staffRoute.indexOf(`router.put('${path}'`);
    assert.notEqual(start, -1, `Missing PUT ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

function loadStaffScheduleBehaviorApi() {
    const marker = 'window.StaffSchedulePage = {';
    assert.ok(staffPage.includes(marker), 'Missing StaffSchedulePage export marker');
    const instrumented = staffPage.replace(marker, `
window.__staffScheduleBehaviorApi = {
    setState(patch = {}) { Object.assign(StaffState, patch); },
    buildScheduleHealth,
    resolveScheduleSubGroup,
    partitionScheduleStaffBySubGroup,
    scheduleProfessionKeyForDepartment,
    scheduleDepartmentCounts(staffList = StaffState.staff) {
        return Object.fromEntries(scheduleDepartmentCountMap(staffList));
    },
    visibleStaffIds() {
        return scheduleFinalVisibleStaffSnapshot(StaffState.staff, getScheduleDates()).visible
            .map(staff => normalizeScheduleStaffId(staff.id));
    },
    groupedStaffIds(staffList = StaffState.staff, options = {}) {
        return Object.fromEntries(
            Object.entries(groupStaffByScheduleDepartment(staffList, options))
                .map(([key, staff]) => [key, staff.map(item => normalizeScheduleStaffId(item.id))])
        );
    },
    scheduleEntrySegmentsForUi,
    renderScheduleCellSegments,
    scheduleCellAriaLabel,
    renderScheduleHealthBadges,
    buildScheduleWorkbookHtml
};
${marker}`);
    const context = {
        window: {},
        document: {
            addEventListener() {},
            querySelector() { return null; }
        },
        console,
        setTimeout,
        clearTimeout,
        URL,
        Blob,
        Date,
        Intl,
        Map,
        Set
    };
    vm.runInNewContext(instrumented, context, { filename: 'js/staff-page.js' });
    return context.window.__staffScheduleBehaviorApi;
}

function createFakeClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(...tokens) { tokens.forEach(token => values.add(token)); },
        remove(...tokens) { tokens.forEach(token => values.delete(token)); },
        contains(token) { return values.has(token); }
    };
}

function createFakeScheduleRangeElement(initial = {}) {
    const attributes = new Map();
    return {
        dataset: {},
        style: {},
        classList: createFakeClassList(),
        hidden: false,
        disabled: false,
        value: '',
        textContent: '',
        ...initial,
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
        removeAttribute(name) { attributes.delete(name); },
        hasAttribute(name) { return attributes.has(name); }
    };
}

function loadStaffScheduleRangeBehaviorApi() {
    const marker = 'window.StaffSchedulePage = {';
    assert.ok(staffPage.includes(marker), 'Missing StaffSchedulePage export marker');
    const instrumented = staffPage.replace(marker, `
renderWeekLabel = function () { syncScheduleRangeControls(); };
renderSchedule = function () {};
renderLoadView = function () {};
syncScheduleViewSwitch = function () {};
syncScheduleBulkActionLabels = function () {};
updateScheduleHeaderMetrics = function () {};
showNotification = function () {};
window.__staffScheduleRangeBehaviorApi = {
    reset(options = {}) {
        if (staffScheduleRangeAbortController) staffScheduleRangeAbortController.abort();
        staffScheduleRangeAbortController = null;
        staffScheduleRangeLoadSeq = 0;
        const start = parseScheduleDateInput(options.from || '2026-06-01');
        const end = parseScheduleDateInput(options.to || '2026-06-15');
        const loaded = options.loaded !== false;
        Object.assign(StaffState, {
            weekStart: start,
            rangeStart: start,
            rangeEnd: end,
            rangeMode: options.mode || 'first-half',
            rangeLoadState: loaded ? 'ready' : 'idle',
            rangePending: null,
            rangeRetry: null,
            schedule: options.schedule || {},
            scheduleRawEntries: options.scheduleRawEntries || [],
            scheduleLoadedRange: loaded ? { from: formatDateStr(start), to: formatDateStr(end) } : null,
            attendance: options.attendance || {},
            attendanceSummary: options.attendanceSummary || null,
            attendanceUnavailable: false,
            hoursData: options.hoursData || null,
            showHours: Boolean(options.showHours),
            showLoadView: false,
            displayGroups: options.displayGroups || [],
            staff: []
        });
        syncScheduleRangeControls();
        setScheduleRangeLoadState(loaded ? 'ready' : 'idle');
    },
    goToScheduleRange,
    retryScheduleRangeLoad,
    snapshot() {
        return JSON.stringify({
            rangeStart: StaffState.rangeStart ? formatDateStr(StaffState.rangeStart) : null,
            rangeEnd: StaffState.rangeEnd ? formatDateStr(StaffState.rangeEnd) : null,
            rangeMode: StaffState.rangeMode,
            rangeLoadState: StaffState.rangeLoadState,
            rangePending: StaffState.rangePending ? {
                from: StaffState.rangePending.from,
                to: StaffState.rangePending.to,
                mode: StaffState.rangePending.mode
            } : null,
            rangeRetry: StaffState.rangeRetry ? {
                from: StaffState.rangeRetry.from,
                to: StaffState.rangeRetry.to,
                mode: StaffState.rangeRetry.mode
            } : null,
            schedule: StaffState.schedule,
            scheduleRawEntries: StaffState.scheduleRawEntries,
            scheduleLoadedRange: StaffState.scheduleLoadedRange,
            attendance: StaffState.attendance,
            attendanceSummary: StaffState.attendanceSummary,
            hoursData: StaffState.hoursData,
            displayGroups: StaffState.displayGroups
        });
    }
};
${marker}`);

    const elements = {
        scheduleDataRegion: createFakeScheduleRangeElement(),
        scheduleWrapper: createFakeScheduleRangeElement(),
        loadViewWrapper: createFakeScheduleRangeElement(),
        scheduleRangeState: createFakeScheduleRangeElement({ hidden: true }),
        scheduleRangeStateTitle: createFakeScheduleRangeElement(),
        scheduleRangeStateMessage: createFakeScheduleRangeElement(),
        scheduleRangeRetryBtn: createFakeScheduleRangeElement({ hidden: true }),
        exportExcelBtn: createFakeScheduleRangeElement({ disabled: true }),
        printBtn: createFakeScheduleRangeElement({ disabled: true }),
        fillWeekBtn: createFakeScheduleRangeElement({ disabled: true }),
        copyWeekBtn: createFakeScheduleRangeElement({ disabled: true }),
        scheduleDateFrom: createFakeScheduleRangeElement(),
        scheduleDateTo: createFakeScheduleRangeElement(),
        weekLabel: createFakeScheduleRangeElement()
    };
    const pendingReads = [];
    const context = {
        window: {},
        document: {
            addEventListener() {},
            getElementById(id) { return elements[id] || null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        localStorage: { getItem() { return 'test-token'; } },
        fetch(url, options = {}) {
            return new Promise(resolve => {
                pendingReads.push({
                    url: String(url),
                    options,
                    respond(body, status = 200) {
                        resolve({
                            ok: status >= 200 && status < 300,
                            status,
                            json: async () => body
                        });
                    }
                });
            });
        },
        console,
        setTimeout,
        clearTimeout,
        URL,
        Blob,
        Date,
        Intl,
        Map,
        Set,
        AbortController
    };
    vm.runInNewContext(instrumented, context, { filename: 'js/staff-page.js#range-behavior' });
    return {
        api: context.window.__staffScheduleRangeBehaviorApi,
        elements,
        pendingReads
    };
}

function loadStaffScheduleHistoryBehaviorApi() {
    const marker = 'window.StaffSchedulePage = {';
    assert.ok(staffPage.includes(marker), 'Missing StaffSchedulePage export marker');
    const instrumented = staffPage.replace(marker, `
window.__staffScheduleHistoryBehaviorApi = {
    setEditingCell(editingCell) { StaffState.editingCell = editingCell; },
    resetHistory() {
        StaffState.scheduleHistory = {};
        StaffState.scheduleHistoryLoadSeq = 0;
        StaffState.shiftPreferences = {};
        StaffState.shiftPreferencesLoadSeq = 0;
    },
    snapshot() {
        return JSON.stringify({
            editingCell: StaffState.editingCell,
            scheduleHistory: StaffState.scheduleHistory,
            scheduleHistoryLoadSeq: StaffState.scheduleHistoryLoadSeq,
            shiftPreferences: StaffState.shiftPreferences,
            shiftPreferencesLoadSeq: StaffState.shiftPreferencesLoadSeq
        });
    },
    loadScheduleCellHistory,
    loadScheduleShiftPreferences,
    scheduleModalSessionIsCurrent,
    beginScheduleModalMutation,
    finishScheduleModalMutation,
    closeEditModal
};
${marker}`);

    const elements = {
        schHistoryList: {
            innerHTML: '',
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = String(value); },
            getAttribute(name) { return this.attributes[name] ?? null; }
        },
        schShiftPreferencePanel: {
            hidden: false,
            innerHTML: ''
        },
        schProfession: { value: 'manager', disabled: false },
        schStatus: { value: 'working', disabled: false },
        schStart: { value: '10:00', disabled: false },
        schEnd: { value: '20:00', disabled: false },
        schNote: { value: '', disabled: false },
        schModalOverlay: {
            classList: createFakeClassList(['visible']),
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = String(value); },
            getAttribute(name) { return this.attributes[name] ?? null; }
        },
        schSaveBtn: { disabled: false },
        schReplaceBtn: { disabled: false },
        schClearReplacementBtn: { disabled: false }
    };
    const pendingFetches = [];
    const context = {
        window: {},
        document: {
            activeElement: null,
            addEventListener() {},
            getElementById(id) { return elements[id] || null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        localStorage: { getItem() { return 'test-token'; } },
        fetch(url, options = {}) {
            return new Promise(resolve => {
                pendingFetches.push({
                    url: String(url),
                    options,
                    respond(body, status = 200) {
                        resolve({
                            ok: status >= 200 && status < 300,
                            status,
                            json: async () => body
                        });
                    }
                });
            });
        },
        console,
        setTimeout,
        clearTimeout,
        URL,
        Blob,
        Date,
        Intl,
        Map,
        Set,
        AbortController
    };
    vm.runInNewContext(instrumented, context, { filename: 'js/staff-page.js' });
    return {
        api: context.window.__staffScheduleHistoryBehaviorApi,
        elements,
        pendingFetches
    };
}

function createFakeModalElement() {
    const listeners = new Map();
    return {
        dataset: {},
        classList: createFakeClassList(['hidden']),
        isConnected: true,
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        listenerCount(type) { return listeners.get(type)?.size || 0; }
    };
}

function loadModalLifecycleBehaviorApi() {
    const start = uiPage.indexOf('const FOCUSABLE_SELECTOR = [');
    const end = uiPage.indexOf('function closeModalFromControl', start);
    assert.ok(start >= 0 && end > start, 'Missing canonical modal lifecycle source');
    const source = `${uiPage.slice(start, end)}
window.__modalLifecycleBehaviorApi = {
    openModal,
    closeModal,
    stackDepth() { return _focusTrapStack.length; },
    matchingStackDepth(modal) { return _focusTrapStack.filter(item => item.modal === modal).length; }
};`;
    const context = {
        window: {},
        document: {
            activeElement: null,
            querySelector() { return null; }
        },
        requestAnimationFrame() {},
        console,
        Set,
        Array
    };
    vm.runInNewContext(source, context, { filename: 'js/ui.js#modal-lifecycle' });
    return context.window.__modalLifecycleBehaviorApi;
}

describe('staff schedule safety guards', () => {
    it('keeps schedule read endpoints free of hidden write-backfills', () => {
        assert.doesNotMatch(routeBlock('/schedule'), /backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(routeBlock('/schedule/hours'), /backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(routeBlock('/schedule/check/:date'), /backfillStaffScheduleFromHrShifts/);
    });

    it('loads schedule periods atomically and rejects stale range responses', () => {
        const fetchScheduleBlock = namedFunctionBlock(staffPage, 'fetchSchedule');
        const fetchAttendanceBlock = namedFunctionBlock(staffPage, 'fetchScheduleAttendance');
        const rangeReadyBlock = namedFunctionBlock(staffPage, 'scheduleRangeDataReady');
        const rangeLoadStateBlock = namedFunctionBlock(staffPage, 'setScheduleRangeLoadState');
        const goToRangeBlock = namedFunctionBlock(staffPage, 'goToScheduleRange');
        const exportBlock = namedFunctionBlock(staffPage, 'handleExcelExport');
        const printBlock = namedFunctionBlock(staffPage, 'handlePrint');
        const initialFailureFlow = namedFunctionBlock(staffScheduleBrowserSmoke, 'runInitialRangeFailureFlow');
        const reliabilityFlow = namedFunctionBlock(staffScheduleBrowserSmoke, 'runPeriodReliabilityFlow');

        assert.match(staffPage, /let staffScheduleRangeLoadSeq = 0/);
        assert.match(staffPage, /let staffScheduleRangeAbortController = null/);
        assert.match(staffPage, /rangeLoadState:\s*'idle'/);
        assert.match(staffPage, /rangePending:\s*null/);
        assert.match(staffPage, /rangeRetry:\s*null/);

        assert.match(fetchScheduleBlock, /\bsignal\b/);
        assert.match(fetchScheduleBlock, /scheduleRawEntries/);
        assert.match(fetchScheduleBlock, /displayGroups/);
        assert.doesNotMatch(fetchScheduleBlock, /StaffState\.(?:schedule|scheduleRawEntries|displayGroups|scheduleLoadedRange)\s*=/);
        assert.match(fetchAttendanceBlock, /\bsignal\b/);
        assert.match(fetchAttendanceBlock, /attendanceSummary/);
        assert.doesNotMatch(fetchAttendanceBlock, /StaffState\.(?:attendance|attendanceSummary|attendanceUnavailable)\s*=/);

        assert.match(goToRangeBlock, /staffScheduleRangeLoadSeq\s*\+=\s*1|\+\+staffScheduleRangeLoadSeq/);
        assert.match(goToRangeBlock, /staffScheduleRangeAbortController\?\.abort\(\)|staffScheduleRangeAbortController\.abort\(\)/);
        assert.match(goToRangeBlock, /new AbortController\(\)/);
        assert.match(goToRangeBlock, /Promise\.all\(/);
        assert.match(goToRangeBlock, /staffScheduleRangeLoadSeq/);
        assert.match(goToRangeBlock, /StaffState\.schedule\s*=/);
        assert.match(goToRangeBlock, /StaffState\.scheduleRawEntries\s*=/);
        assert.match(goToRangeBlock, /StaffState\.attendance\s*=/);
        assert.match(goToRangeBlock, /StaffState\.attendanceSummary\s*=/);
        assert.match(goToRangeBlock, /StaffState\.hoursData\s*=/);
        assert.match(goToRangeBlock, /setScheduleRangeState\(/);
        assert.match(goToRangeBlock, /StaffState\.scheduleLoadedRange\s*=\s*\{/);
        assert.match(goToRangeBlock, /setScheduleRangeLoadState\('loading'/);
        assert.match(goToRangeBlock, /setScheduleRangeLoadState\('error'/);
        assert.match(goToRangeBlock, /'empty'/);
        assert.match(goToRangeBlock, /'ready'/);

        assert.match(rangeReadyBlock, /scheduleLoadedRange/);
        assert.match(rangeReadyBlock, /rangeLoadState/);
        assert.match(rangeLoadStateBlock, /aria-busy/);
        assert.match(rangeLoadStateBlock, /aria-disabled/);
        assert.match(rangeLoadStateBlock, /\.inert\s*=|setAttribute\('inert'/);
        assert.match(exportBlock, /scheduleRangeDataReady\(\)/);
        assert.match(printBlock, /scheduleRangeDataReady\(\)/);
        assert.match(staffPage, /function retryScheduleRangeLoad/);

        assert.match(staffScheduleShell, /id="scheduleDataRegion"[^>]*data-schedule-state="idle"[^>]*aria-busy="false"/);
        assert.match(staffScheduleShell, /id="scheduleRangeState"[^>]*role="status"[^>]*aria-live="polite"/);
        assert.match(staffScheduleShell, /id="scheduleRangeRetryBtn"[^>]*hidden/);
        assert.match(staffScheduleShell, /id="exportExcelBtn"[^>]*disabled/);
        assert.match(staffScheduleShell, /id="printBtn"[^>]*disabled/);
        assert.match(staffCss, /\.staff-schedule-range-state/);
        assert.match(staffCss, /\[data-schedule-state="loading"\]/);
        assert.match(staffCss, /\[data-schedule-state="error"\]/);

        assert.match(staffScheduleBrowserSmoke, /async function runPeriodReliabilityFlow/);
        assert.match(staffScheduleBrowserSmoke, /async function runInitialRangeFailureFlow/);
        assert.match(staffScheduleBrowserSmoke, /runPeriodReliabilityFlow\(/);
        assert.match(staffScheduleBrowserSmoke, /runInitialRangeFailureFlow\(/);
        assert.match(initialFailureFlow, /kind:\s*'http-error'/);
        assert.match(initialFailureFlow, /status:\s*500/);
        assert.match(initialFailureFlow, /scheduleRangeRetryBtn/);
        assert.match(initialFailureFlow, /'empty'/);
        assert.match(reliabilityFlow, /hold:\s*true/);
        assert.match(reliabilityFlow, /kind:\s*'invalid-json'/);
        assert.match(reliabilityFlow, /kind:\s*'network-error'/);
        assert.match(reliabilityFlow, /dispatchBlockedScheduleActions/);
        assert.match(reliabilityFlow, /data-schedule-range-preset="month"/);
        assert.match(reliabilityFlow, /nextWeekBtn/);
        assert.match(reliabilityFlow, /prevWeekBtn/);
    });

    it('commits only the latest completed range request', async () => {
        const { api, elements, pendingReads } = loadStaffScheduleRangeBehaviorApi();
        api.reset({
            from: '2026-06-01',
            to: '2026-06-15',
            showHours: true,
            hoursData: { 7: { totalHours: 80 } },
            schedule: {
                '7_2026-06-01': { staff_id: 7, date: '2026-06-01', status: 'working' }
            },
            scheduleRawEntries: [{ staff_id: 7, date: '2026-06-01', status: 'working' }]
        });

        const requestA = api.goToScheduleRange('2026-07-01', '2026-07-15', 'first-half');
        const requestB = api.goToScheduleRange('2026-07-16', '2026-07-31', 'second-half');
        assert.equal(pendingReads.length, 6, 'all three required reads start for both navigations');
        assert.equal(elements.scheduleDataRegion.dataset.scheduleState, 'loading');
        assert.equal(elements.scheduleDataRegion.getAttribute('aria-busy'), 'true');

        const takeRead = (path, from) => {
            const index = pendingReads.findIndex(read => read.url.includes(path) && read.url.includes(`from=${from}`));
            assert.notEqual(index, -1, `missing ${path} read for ${from}`);
            return pendingReads.splice(index, 1)[0];
        };
        takeRead('/api/staff/schedule?', '2026-07-16').respond({
            success: true,
            data: [{ staff_id: 22, date: '2026-07-16', status: 'working' }],
            displayGroups: [{ key: 'reception', label: 'Reception', order: 1 }]
        });
        takeRead('/api/staff/attendance?', '2026-07-16').respond({
            success: true,
            data: [{ staff_id: 22, date: '2026-07-16', status: 'checked_in' }],
            summary: { checked_in: 1 }
        });
        takeRead('/api/staff/schedule/hours?', '2026-07-16').respond({
            success: true,
            data: { 22: { totalHours: 96 } }
        });
        assert.equal(await requestB, true);

        let snapshot = JSON.parse(api.snapshot());
        assert.equal(snapshot.rangeStart, '2026-07-16');
        assert.equal(snapshot.rangeEnd, '2026-07-31');
        assert.deepEqual(Object.keys(snapshot.schedule), ['22_2026-07-16']);
        assert.deepEqual(Object.keys(snapshot.attendance), ['22_2026-07-16']);
        assert.deepEqual(snapshot.hoursData, { 22: { totalHours: 96 } });
        assert.deepEqual(snapshot.scheduleLoadedRange, { from: '2026-07-16', to: '2026-07-31' });
        assert.equal(snapshot.rangeLoadState, 'ready');

        takeRead('/api/staff/schedule?', '2026-07-01').respond({
            success: true,
            data: [{ staff_id: 11, date: '2026-07-01', status: 'vacation' }],
            displayGroups: [{ key: 'animators', label: 'Animators', order: 0 }]
        });
        takeRead('/api/staff/attendance?', '2026-07-01').respond({
            success: true,
            data: [{ staff_id: 11, date: '2026-07-01', status: 'absent' }],
            summary: { absent: 1 }
        });
        takeRead('/api/staff/schedule/hours?', '2026-07-01').respond({
            success: true,
            data: { 11: { totalHours: 40 } }
        });
        assert.equal(await requestA, false, 'late A is stale after B commits');

        snapshot = JSON.parse(api.snapshot());
        assert.equal(snapshot.rangeStart, '2026-07-16');
        assert.equal(snapshot.rangeEnd, '2026-07-31');
        assert.deepEqual(Object.keys(snapshot.schedule), ['22_2026-07-16']);
        assert.deepEqual(Object.keys(snapshot.attendance), ['22_2026-07-16']);
        assert.deepEqual(snapshot.attendanceSummary, { checked_in: 1 });
        assert.deepEqual(snapshot.hoursData, { 22: { totalHours: 96 } });
        assert.deepEqual(snapshot.displayGroups.map(group => group.key), ['reception']);
        assert.equal(elements.scheduleDateFrom.value, '2026-07-16');
        assert.equal(elements.scheduleDateTo.value, '2026-07-31');
        assert.equal(elements.exportExcelBtn.disabled, false);
        assert.equal(elements.printBtn.disabled, false);
    });

    it('keeps the confirmed range on failure and exposes loading, error, and retry-ready states', async () => {
        const { api, elements, pendingReads } = loadStaffScheduleRangeBehaviorApi();
        const confirmedSchedule = {
            '7_2026-06-01': { staff_id: 7, date: '2026-06-01', status: 'working' }
        };
        const confirmedAttendance = {
            '7_2026-06-01': { staff_id: 7, date: '2026-06-01', status: 'checked_in' }
        };
        api.reset({
            from: '2026-06-01',
            to: '2026-06-15',
            schedule: confirmedSchedule,
            scheduleRawEntries: Object.values(confirmedSchedule),
            attendance: confirmedAttendance,
            attendanceSummary: { checked_in: 1 },
            displayGroups: [{ key: 'admin', label: 'Admin', order: 0 }]
        });

        const takeRead = (path, from) => {
            const index = pendingReads.findIndex(read => read.url.includes(path) && read.url.includes(`from=${from}`));
            assert.notEqual(index, -1, `missing ${path} read for ${from}`);
            return pendingReads.splice(index, 1)[0];
        };

        const failedNavigation = api.goToScheduleRange('2026-07-01', '2026-07-15', 'first-half');
        assert.equal(elements.scheduleDataRegion.dataset.scheduleState, 'loading');
        assert.equal(elements.scheduleDataRegion.getAttribute('aria-busy'), 'true');
        assert.equal(elements.scheduleWrapper.hasAttribute('inert'), true);
        assert.equal(elements.scheduleWrapper.getAttribute('aria-disabled'), 'true');
        assert.equal(elements.exportExcelBtn.disabled, true);
        assert.equal(elements.printBtn.disabled, true);

        takeRead('/api/staff/schedule?', '2026-07-01').respond({ success: false, error: 'fixture failure' }, 500);
        takeRead('/api/staff/attendance?', '2026-07-01').respond({ success: true, data: [], summary: null });
        assert.equal(await failedNavigation, false);

        let snapshot = JSON.parse(api.snapshot());
        assert.equal(snapshot.rangeLoadState, 'error');
        assert.equal(snapshot.rangeStart, '2026-06-01');
        assert.equal(snapshot.rangeEnd, '2026-06-15');
        assert.deepEqual(snapshot.scheduleLoadedRange, { from: '2026-06-01', to: '2026-06-15' });
        assert.deepEqual(snapshot.schedule, confirmedSchedule);
        assert.deepEqual(snapshot.scheduleRawEntries, Object.values(confirmedSchedule));
        assert.deepEqual(snapshot.attendance, confirmedAttendance);
        assert.deepEqual(snapshot.attendanceSummary, { checked_in: 1 });
        assert.deepEqual(snapshot.displayGroups.map(group => group.key), ['admin']);
        assert.deepEqual(snapshot.rangeRetry, { from: '2026-07-01', to: '2026-07-15', mode: 'first-half' });
        assert.equal(elements.scheduleDateFrom.value, '2026-06-01');
        assert.equal(elements.scheduleDateTo.value, '2026-06-15');
        assert.equal(elements.scheduleDataRegion.dataset.scheduleState, 'error');
        assert.equal(elements.scheduleDataRegion.getAttribute('aria-busy'), 'false');
        assert.equal(elements.scheduleRangeState.hidden, false);
        assert.equal(elements.scheduleRangeState.getAttribute('role'), 'alert');
        assert.equal(elements.scheduleRangeRetryBtn.hidden, false);
        assert.equal(elements.exportExcelBtn.disabled, true);
        assert.equal(elements.printBtn.disabled, true);

        const retry = api.retryScheduleRangeLoad();
        assert.equal(elements.scheduleDataRegion.dataset.scheduleState, 'loading');
        takeRead('/api/staff/schedule?', '2026-07-01').respond({
            success: true,
            data: [{ staff_id: 11, date: '2026-07-01', status: 'working' }],
            displayGroups: [{ key: 'animators', label: 'Animators', order: 0 }]
        });
        takeRead('/api/staff/attendance?', '2026-07-01').respond({
            success: true,
            data: [{ staff_id: 11, date: '2026-07-01', status: 'planned' }],
            summary: { planned: 1 }
        });
        assert.equal(await retry, true);

        snapshot = JSON.parse(api.snapshot());
        assert.equal(snapshot.rangeLoadState, 'ready');
        assert.equal(snapshot.rangeStart, '2026-07-01');
        assert.equal(snapshot.rangeEnd, '2026-07-15');
        assert.equal(snapshot.rangeRetry, null);
        assert.deepEqual(Object.keys(snapshot.schedule), ['11_2026-07-01']);
        assert.deepEqual(Object.keys(snapshot.attendance), ['11_2026-07-01']);
        assert.equal(elements.scheduleDataRegion.dataset.scheduleState, 'ready');
        assert.equal(elements.scheduleDataRegion.getAttribute('aria-busy'), 'false');
        assert.equal(elements.scheduleWrapper.hasAttribute('inert'), false);
        assert.equal(elements.scheduleRangeState.hidden, true);
        assert.equal(elements.exportExcelBtn.disabled, false);
        assert.equal(elements.printBtn.disabled, false);
    });

    it('logs schedule write history into existing HR audit log', () => {
        assert.match(staffRoute, /router\.get\('\/schedule\/history\/:staffId\/:date'/);
        assert.match(staffScheduleMutations, /INSERT INTO hr_audit_log \(action, staff_id, performed_by, details, ip_address\)/);
        assert.match(staffRoute, /staff_schedule_update/);
        assert.match(staffRoute, /staff_schedule_bulk_update/);
        assert.match(staffRoute, /staff_schedule_copy_week/);
        assert.match(staffRoute, /staff_schedule_replacement_set/);
        assert.match(staffScheduleMutations, /changes\.dayPlan = \{ from: beforePlan, to: afterPlan \}/);
    });

    it('does not treat empty schedule cells as working in UI summaries and export', () => {
        assert.doesNotMatch(staffPage, /entry \? entry\.status : 'working'/);
        assert.match(staffPage, /entry \? normalizeScheduleStatus\(entry\.status\) : 'unset'/);
    });

    it('keeps sensitive attendance and payroll staff endpoints role-gated', () => {
        assert.match(staffRoute, /const STAFF_ATTENDANCE_READ_ROLES = \['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'accountant'\]/);
        assert.match(staffRoute, /const STAFF_PAYROLL_READ_ROLES = \['creator', 'director', 'vice_director', 'senior_manager', 'hr', 'accountant'\]/);
        assert.match(routeBlock('/attendance'), /router\.get\('\/attendance', requireRole\(\.\.\.STAFF_ATTENDANCE_READ_ROLES\)/);
        assert.match(routeBlock('/payroll'), /router\.get\('\/payroll', requireRole\(\.\.\.STAFF_PAYROLL_READ_ROLES\)/);
    });

    it('uses HR-card light staff rows and hides freelance placeholders from active schedule by default', () => {
        const staffListRoute = routeBlock('/');
        assert.doesNotMatch(staffListRoute, /SELECT staff\.\*/);
        assert.match(staffListRoute, /COALESCE\(NULLIF\(staff\.display_name, ''\), staff\.name\) AS display_name/);
        assert.match(staffListRoute, /staff\.position AS role/);
        assert.match(staffListRoute, /COALESCE\(staff\.secondary_professions, '([^']*)'\::jsonb\) AS secondary_professions/);
        assert.match(staffListRoute, /AS professions/);
        assert.match(staffListRoute, /staff\.photo_url/);
        assert.match(staffListRoute, /include_freelance/);
        assert.match(staffListRoute, /activeScheduleStaffWhere\('staff', 'CURRENT_DATE', \{ includeFreelance: shouldIncludeFreelance \}\)/);
        assert.match(staffOperationalFilters, /COALESCE\(\$\{safeAlias\}\.is_freelance, false\) = false/);
        assert.match(staffOperationalFilters, /COALESCE\(\$\{safeAlias\}\.hr_pool_status, 'core'\) = 'core'/);
        assert.match(staffListRoute, /'hr_staff_card_light' AS card_source/);
        assert.doesNotMatch(staffListRoute, /\bstaff\.(phone|emergency_contact|emergency_phone|birth_date|address|hourly_rate|rate_unit|notes|telegram_id|telegram_username|termination_reason|termination_recorded_by)\b/);
        assert.match(staffPage, /function renderStaffCardAvatar/);
        assert.match(staffPage, /function staffCardTrainingReadiness/);
        assert.match(staffPage, /function renderStaffCardReadinessBadge/);
        assert.match(staffPage, /function renderStaffCardBadges/);
        assert.match(staffPage, /renderStaffCardReadinessBadge\(staff\)/);
        assert.match(staffPage, /staff\.is_freelance[\s\S]*staff-card-badge neutral freelance/);
        assert.match(staffPage, /String\(emp\.display_name \|\| emp\.name \|\| ''\)/);
        assert.match(staffPage, /class="emp-name"><span class="emp-name-text" title="\$\{escapeHtml\(employeeName\)\}">/);
        assert.match(staffPage, /class="emp-position" title="\$\{escapeHtml\(roleSummary\)\}">/);
        assert.match(staffPage, /class="emp-readiness"/);
        assert.match(staffPage, /href="\/hr\?employee=\$\{encodeURIComponent\(staffId\)\}"/);
        assert.match(staffPage, /data-hr-profile="\$\{emp\.id\}"/);
        assert.match(staffPage, /cell\.addEventListener\('keydown'/);
        assert.match(staffCss, /\.schedule-table \.emp-info/);
        assert.match(staffCss, /\.schedule-table \.emp-name-text/);
        assert.match(staffCss, /text-overflow:\s*ellipsis/);
        assert.match(staffCss, /\.schedule-table \.emp-position/);
        assert.match(staffCss, /\.schedule-table \.hr-crosslink/);
        assert.match(staffCss, /\.staff-card-badge\.freelance/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-table \.hr-crosslink/);
    });

    it('adds passive schedule health scoring, filters, and issue badges without blocking editing', () => {
        const renderSchedulePrimaryBlock = staffPage.slice(
            staffPage.indexOf('function renderSchedule()'),
            staffPage.indexOf('// Group staff by department')
        );
        const scheduleViewModeBlock = staffPage.slice(
            staffPage.indexOf('async function setScheduleViewMode'),
            staffPage.indexOf('function bindScheduleViewSwitchControls')
        );
        const healthBadgeBlock = staffPage.slice(
            staffPage.indexOf('function renderScheduleHealthBadges'),
            staffPage.indexOf('function renderScheduleHealthIssueList')
        );
        const renderEmpRowBlock = staffPage.slice(
            staffPage.indexOf('function renderEmpRow'),
            staffPage.indexOf('function scheduleCellFromEvent')
        );
        const buildHealthBlock = namedFunctionBlock(staffPage, 'buildScheduleHealth');
        const readinessBadgeBlock = namedFunctionBlock(staffPage, 'renderStaffCardReadinessBadge');
        const shiftProfessionBlock = namedFunctionBlock(staffPage, 'scheduleHealthShiftProfessionKey');
        const shiftDepartmentBlock = namedFunctionBlock(staffPage, 'scheduleHealthShiftDepartment');
        const summaryIndex = staffScheduleShell.indexOf('id="scheduleSummary"');
        const tableIndex = staffScheduleShell.indexOf('id="scheduleWrapper"');
        const healthPanelIndex = staffScheduleShell.indexOf('id="scheduleHealthPanel"');

        assert.match(staffPage, /healthFilter:\s*'all'/);
        assert.match(staffPage, /scheduleRawEntries:\s*\[\]/);
        assert.match(staffPage, /const SCHEDULE_HEALTH_FILTERS = \['all', 'critical', 'warning', 'ok'\]/);
        assert.match(staffPage, /const SCHEDULE_HEALTH_DEPARTMENT_MIN_WORKING/);
        assert.match(staffPage, /function buildScheduleHealth/);
        assert.match(staffPage, /function scheduleHealthScore/);
        assert.match(staffPage, /function renderScheduleHealthPanel/);
        assert.match(staffPage, /function renderScheduleHealthBadges/);
        assert.match(healthBadgeBlock, /const counts = scheduleHealthCounts\(sorted\)/);
        assert.match(healthBadgeBlock, /const severity = scheduleHealthSeverity\(sorted\)/);
        assert.match(healthBadgeBlock, /schedule-health-badge schedule-health-badge-compact is-\$\{severity\}/);
        assert.match(healthBadgeBlock, /data-health-detail="\$\{escapeHtml\(detail\)\}"/);
        assert.match(healthBadgeBlock, /schedule-health-badge-count/);
        assert.doesNotMatch(healthBadgeBlock, /visible\.map\(issue/);
        assert.doesNotMatch(healthBadgeBlock, /schedule-health-badge-more/);
        assert.match(staffPage, /function scheduleHealthFilteredStaff/);
        [
            'missing_account',
            'missing_face_descriptor',
            'low_readiness',
            'partial_readiness',
            'staff_inactive',
            'staff_blacklisted_or_offboarded',
            'freelance_without_explicit_mode',
            'duplicate_shift',
            'overlapping_shift',
            'shift_without_role',
            'profession_mismatch',
            'long_segment',
            'long_total_day',
            'overlapping_segments',
            'booking_outside_availability',
            'planned_off_conflict',
            'department_understaffed',
            'no_responsible_manager'
        ].forEach(code => assert.match(staffPage, new RegExp(code)));
        assert.doesNotMatch(staffPage, /code:s*'missing_readiness'/);
        assert.match(readinessBadgeBlock, /!readiness\.hasData \|\| !readiness\.total/);
        assert.match(readinessBadgeBlock, /staff-card-badge neutral/);
        assert.match(readinessBadgeBlock, /data-staff-readiness-state="unknown"/);
        assert.match(readinessBadgeBlock, /Немає даних/);
        assert.match(buildHealthBlock, /readiness\.hasData && readiness\.total > 0 && readiness\.percent < 45/);
        assert.match(shiftProfessionBlock, /entry\.profession_key \|\| entry\.professionKey/);
        assert.match(shiftProfessionBlock, /staff\.role_type \|\| staff\.roleType/);
        assert.match(shiftDepartmentBlock, /scheduleProfessionDisplayGroupKey\(scheduleHealthShiftProfessionKey\(staff, entry\)\)/);
        assert.match(buildHealthBlock, /const workingCountByDepartmentDate = new Map\(\)/);
        assert.match(buildHealthBlock, /workingCountByDepartmentDate\.set\(countKey/);
        assert.match(buildHealthBlock, /workingCountByDepartmentDate\.get\(`\$\{department\}:\$\{date\}`\) \|\| 0/);
        assert.doesNotMatch(buildHealthBlock, /entries\.filter\(entry => scheduleHealthIsWorkStatus\(entry\.status\)\)\.length/);
        assert.match(staffPage, /scheduleRawEntries\.push\(normalizedEntry\)/);
        assert.match(staffPage, /const visibleSnapshot = scheduleFinalVisibleStaffSnapshot\(StaffState\.staff, dates\)/);
        assert.match(staffPage, /const health = visibleSnapshot\.health/);
        assert.match(staffPage, /const filtered = visibleSnapshot\.visible/);
        assert.match(staffPage, /tbody\.classList\.toggle\('show-hours', Boolean\(StaffState\.showHours\)\)/);
        assert.doesNotMatch(scheduleViewModeBlock, /classList\.add\('show-hours'\)/);
        assert.match(staffPage, /function scheduleCellAriaLabel/);
        assert.match(staffPage, /role="button" tabindex="0" aria-label="\$\{escapeHtml\(cellAriaLabel\)\}"/);
        assert.match(staffPage, /function bindScheduleCellActivation/);
        assert.match(staffPage, /event\.key !== 'Enter' && event\.key !== ' '/);
        assert.match(staffPage, /event\.preventDefault\(\)/);
        assert.match(staffPage, /openScheduleCell\(cell\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /renderScheduleHealthPanel\(health\)/);
        assert.match(staffPage, /renderSummary\(filtered, dates\)/);
        assert.match(staffPage, /renderEmpRow\(emp, dates, today, health, \{ subGroup: sg, department: dept \}\)/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}[\s\S]*\$\{cellHealthClass\}"/);
        assert.doesNotMatch(renderEmpRowBlock, /attendanceClass|attendanceIndicator|renderScheduleAttendanceIndicator\(emp\.id|has-attendance-/);
        assert.match(staffPage, /bindScheduleHealthDetailButtons\(tbody\)/);
        assert.match(staffPage, /event\.stopPropagation\(\)/);
        assert.ok(summaryIndex > -1 && tableIndex > summaryIndex && healthPanelIndex > tableIndex);
        assert.match(staffScheduleShell, /id="scheduleHealthPanel"/);
        assert.match(staffScheduleShell, /id="scheduleHealthPanel"[^>]*hidden/);
        assert.match(staffCss, /body\[data-page-group="hr"\] \.schedule-secondary-diagnostics > \[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;[\s\S]*margin:\s*0\s*!important;[\s\S]*padding:\s*0\s*!important;[\s\S]*box-shadow:\s*none\s*!important;[\s\S]*\}/);
        assert.match(staffCss, /\.schedule-health-panel/);
        assert.match(staffCss, /\.schedule-health-score/);
        assert.match(staffCss, /\.schedule-health-filter/);
        assert.match(staffCss, /\.schedule-health-badge/);
        assert.match(staffCss, /\.schedule-health-badges\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*\}/);
        assert.match(staffCss, /\.schedule-health-badge-compact\s*\{[\s\S]*border-radius:\s*999px;[\s\S]*white-space:\s*nowrap;[\s\S]*\}/);
        assert.match(staffCss, /\.schedule-health-badge-count/);
        assert.match(staffCss, /\.schedule-health-badge\.is-critical\s*\{[\s\S]*background:\s*#DC2626;[\s\S]*color:\s*#FFFFFF;/);
        assert.doesNotMatch(staffCss, /\.sch-cell\.has-health-critical\s*\{/);
        assert.doesNotMatch(staffCss, /tr\.has-health-critical\s+td:first-child/);
        assert.match(staffCss, /td\.schedule-day-cell\.status-working/);
        assert.match(staffCss, /tr\.is-schedule-focus td\s*\{[\s\S]*box-shadow:\s*inset 0 -2px 0 #2563EB;/);
        assert.match(staffPage, /const focusAttributes = focusClass \? ' aria-current="true"' : '';/);
        assert.match(staffCss, /\.sch-cell:focus-visible/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-health-panel/);
    });

    it('keeps hidden section matches discoverable without reordering visible segments', () => {
        const api = loadStaffScheduleBehaviorApi();
        api.setState({
            professions: [
                { key: 'reception', title: 'Reception' },
                { key: 'manager', title: 'Manager' },
                { key: 'barista', title: 'Barista' },
                { key: 'animator', title: 'Animator' }
            ]
        });
        const entry = {
            planned_minutes: 600,
            profession_key: 'reception',
            segments: [
                { professionKey: 'reception', shiftStart: '09:00', shiftEnd: '12:00', additionalProfessionKeys: ['manager'] },
                { professionKey: 'barista', shiftStart: '12:00', shiftEnd: '15:00' },
                { professionKey: 'animator', shiftStart: '17:00', shiftEnd: '20:00' }
            ]
        };

        const html = api.renderScheduleCellSegments(entry, 'reception', 'animator', false);
        assert.ok(html.indexOf('data-schedule-compact-time="09–12"') < html.indexOf('data-schedule-compact-time="12–15"'));
        assert.doesNotMatch(html, /sch-segment-lines has-section-match/);
        assert.match(html, /sch-segment-more is-section-role[^>]*title="[^"]*17–20 · Animator/);

        const ariaLabel = api.scheduleCellAriaLabel(
            { name: 'QA Staff', role_type: 'reception' },
            '2026-07-14',
            entry,
            'working',
            '09:00',
            '20:00'
        );
        assert.match(ariaLabel, /Reception, додатково Manager/);
        assert.match(ariaLabel, /17:00-20:00, Animator/);
    });

    it('defensively sorts unsorted segment payloads without mutating their IDs or source order', () => {
        const api = loadStaffScheduleBehaviorApi();
        const source = [
            { id: 303, professionKey: 'manager', shiftStart: '15:00', shiftEnd: '20:00', clientKey: 'late' },
            { id: 301, professionKey: 'reception', shiftStart: '09:00', shiftEnd: '13:00', clientKey: 'early' },
            { id: 302, professionKey: 'barista', shiftStart: '13:00', shiftEnd: '15:00', clientKey: 'middle' }
        ];

        const sorted = api.scheduleEntrySegmentsForUi({ segments: source });
        assert.deepEqual(
            JSON.parse(JSON.stringify(sorted.map(segment => ({
                id: segment.id,
                clientKey: segment.clientKey,
                shiftStart: segment.shiftStart,
                shiftEnd: segment.shiftEnd
            })))),
            [
                { id: 301, clientKey: 'early', shiftStart: '09:00', shiftEnd: '13:00' },
                { id: 302, clientKey: 'middle', shiftStart: '13:00', shiftEnd: '15:00' },
                { id: 303, clientKey: 'late', shiftStart: '15:00', shiftEnd: '20:00' }
            ]
        );
        assert.deepEqual(source.map(segment => segment.id), [303, 301, 302], 'source payload order remains untouched');

        const overnight = api.scheduleEntrySegmentsForUi({
            segments: [{ id: 401, professionKey: 'animator', shiftStart: '22:00', shiftEnd: '02:00' }]
        });
        assert.equal(overnight[0].id, 401, 'a single overnight segment remains valid and stable');
    });

    it('keeps critical health semantics explicit without restoring cell or row outlines', () => {
        const api = loadStaffScheduleBehaviorApi();
        const html = api.renderScheduleHealthBadges([
            { severity: 'critical', title: 'Profession mismatch', detail: 'Manual review required' }
        ]);

        assert.match(html, /schedule-health-badge[^>]*is-critical/);
        assert.match(html, /aria-label="Schedule health critical, 1 issue:/);
        assert.match(html, /Profession mismatch/);
    });

    it('attributes each working shift to exactly one profession department and keeps readiness truthful', () => {
        const api = loadStaffScheduleBehaviorApi();
        const sharedStaff = {
            id: 901,
            name: 'Shared Animator',
            display_name: 'Shared Animator',
            department: 'animators',
            display_group: 'animators',
            role_type: 'animator',
            secondary_professions: ['trampoline_instructor'],
            is_active: true,
            is_freelance: false,
            hr_pool_status: 'core',
            has_account: true,
            has_face_descriptor: true
        };
        api.setState({
            activeDept: 'all',
            staff: [sharedStaff],
            professions: [
                { key: 'animator', title: 'Аніматор', department: 'animators' },
                { key: 'trampoline_instructor', title: 'Інструктор батутів', department: 'trampoline' }
            ],
            schedule: {
                '901_2026-07-11': { staff_id: 901, date: '2026-07-11', status: 'working', profession_key: 'animator' },
                '901_2026-07-12': { staff_id: 901, date: '2026-07-12', status: 'working', profession_key: 'trampoline_instructor' }
            },
            scheduleRawEntries: []
        });

        const health = api.buildScheduleHealth(
            [new Date('2026-07-11T00:00:00'), new Date('2026-07-12T00:00:00')],
            [sharedStaff],
            { department: 'all' }
        );
        const understaffed = health.issues.filter(issue => issue.code === 'department_understaffed');
        assert.equal(
            understaffed.filter(issue => issue.date === '2026-07-11').map(issue => issue.department).join(','),
            'trampoline',
            'animator shift covers animators only'
        );
        assert.equal(
            understaffed.filter(issue => issue.date === '2026-07-12').map(issue => issue.department).join(','),
            'animators',
            'trampoline shift covers trampoline only'
        );
        assert.equal(health.issues.some(issue => issue.code === 'missing_readiness'), false);

        const explicitLow = {
            ...sharedStaff,
            id: 902,
            role_type: 'waiter',
            department: 'cafe',
            display_group: 'cafe',
            secondary_professions: ['cook'],
            training_readiness: { total: 5, completed: 1, percent: 20 }
        };
        api.setState({ staff: [explicitLow], schedule: {}, scheduleRawEntries: [] });
        const lowHealth = api.buildScheduleHealth([], [explicitLow], { department: 'all' });
        assert.equal(lowHealth.issues.filter(issue => issue.code === 'low_readiness').length, 1);
    });

    it('resolves one primary-first subgroup independently from subgroup configuration order', () => {
        const api = loadStaffScheduleBehaviorApi();
        api.setState({
            activeDept: 'all',
            professions: [
                { key: 'manager', title: 'Менеджер', department: 'reception' },
                { key: 'reception', title: 'Рецепція', department: 'reception' },
                { key: 'waiter', title: 'Офіціант', department: 'cafe' },
                { key: 'cook', title: 'Кухар', department: 'cafe' },
                { key: 'animator', title: 'Аніматор', department: 'animators' },
                { key: 'trampoline_instructor', title: 'Інструктор батутів', department: 'trampoline' }
            ]
        });
        const manager = { id: 911, role_type: 'manager', secondary_professions: ['reception'], department: 'reception' };
        const waiter = { id: 912, role_type: 'waiter', secondary_professions: ['cook'], department: 'cafe' };
        const animator = { id: 913, role_type: 'animator', secondary_professions: ['trampoline_instructor'], department: 'animators' };
        const receptionGroups = [
            { key: 'reception', label: 'Рецепція' },
            { key: 'manager,senior_manager', label: 'Менеджери' }
        ];
        const cafeGroups = [
            { key: 'cook', label: 'Кухня' },
            { key: 'waiter', label: 'Офіціанти' }
        ];
        const animatorGroups = [
            { key: 'trampoline_instructor', label: 'Батутисти' },
            { key: 'animator', label: 'Аніматори' }
        ];

        assert.equal(api.resolveScheduleSubGroup(manager, 'reception', { activeDepartment: 'all', subGroups: receptionGroups })?.label, 'Менеджери');
        assert.equal(api.resolveScheduleSubGroup(manager, 'reception', { activeDepartment: 'all', subGroups: [...receptionGroups].reverse() })?.label, 'Менеджери');
        assert.equal(api.resolveScheduleSubGroup(manager, 'reception', { activeDepartment: 'reception', subGroups: receptionGroups })?.label, 'Менеджери');
        assert.equal(api.resolveScheduleSubGroup(waiter, 'cafe', { activeDepartment: 'all', subGroups: cafeGroups })?.label, 'Офіціанти');
        assert.equal(api.resolveScheduleSubGroup(animator, 'animators', { activeDepartment: 'all', subGroups: animatorGroups })?.label, 'Аніматори');
        assert.equal(api.resolveScheduleSubGroup(animator, 'trampoline', { activeDepartment: 'trampoline', subGroups: animatorGroups })?.label, 'Батутисти');
    });

    it('assigns duplicate primary/secondary staff to one primary-first subgroup', () => {
        const api = loadStaffScheduleBehaviorApi();
        api.setState({
            activeDept: 'all',
            professions: [
                { key: 'manager', title: 'Manager', department: 'reception' },
                { key: 'reception', title: 'Reception', department: 'reception' }
            ]
        });
        const staff = {
            id: 911,
            role_type: 'manager',
            secondary_professions: ['reception', 'manager', 'reception'],
            department: 'reception'
        };
        const subGroups = [
            { key: 'reception', label: 'Reception' },
            { key: 'manager,senior_manager', label: 'Managers' }
        ];

        const partition = api.partitionScheduleStaffBySubGroup(
            'reception',
            [staff, { ...staff, id: '911' }],
            [...subGroups].reverse(),
            { activeDepartment: 'all' }
        );
        const assigned = partition.groups.flatMap(group => group.staff.map(item => Number(item.id)));
        assert.equal(assigned.join(','), '911', 'one numeric staff ID is owned by one subgroup');
        assert.equal(partition.groups[0]?.subGroup?.label, 'Managers');
        assert.equal(partition.ungrouped.length, 0);
        assert.equal(
            api.resolveScheduleSubGroup(staff, 'reception', { activeDepartment: 'reception', subGroups })?.label,
            'Managers',
            'primary role wins over a relevant secondary role in the active department'
        );
    });

    it('adds passive staffing demand forecast from bookings without auto-scheduling', () => {
        const renderSchedulePrimaryBlock = staffPage.slice(
            staffPage.indexOf('function renderSchedule()'),
            staffPage.indexOf('// Group staff by department')
        );
        const weekNavigationBlock = staffPage.slice(
            staffPage.indexOf('async function goToWeek'),
            staffPage.indexOf('function prevWeek')
        );
        const initPrimaryLoadBlock = staffPage.slice(
            staffPage.indexOf('async function initStaffSchedulePage'),
            staffPage.indexOf('// Event listeners')
        );

        assert.match(staffPage, /staffingForecast:\s*null/);
        assert.match(staffPage, /staffingForecastBookings:\s*\{\}/);
        assert.match(staffPage, /staffingForecastAvailable:\s*false/);
        assert.match(staffPage, /const STAFFING_FORECAST_DEPARTMENTS = \['animators', 'trampoline', 'reception', 'managers', 'tech', 'cafe', 'cleaning'\]/);
        ['emptyDay', 'animators', 'trampoline', 'reception', 'managers', 'tech', 'cafe', 'cleaning']
            .forEach(rule => assert.match(staffPage, new RegExp(rule)));
        assert.match(staffPage, /function staffingForecastExpectedGuests/);
        assert.match(staffPage, /function staffingForecastDayRecommendation/);
        assert.match(staffPage, /function staffingForecastScheduledCounts/);
        assert.match(staffPage, /function buildStaffingDemandForecast/);
        assert.match(staffPage, /function renderStaffingForecastPanel/);
        assert.match(staffPage, /function fetchStaffingForecastBookings/);
        assert.match(staffPage, /\/api\/bookings\/\$\{encodeURIComponent\(date\)\}/);
        assert.match(staffPage, /source:\s*'bookings_timeline_heuristics_v1'/);
        assert.match(staffPage, /recommended\.animators/);
        assert.match(staffPage, /recommended\.trampoline/);
        assert.match(staffPage, /recommended\.reception = 1/);
        assert.match(staffPage, /recommended\.managers = 1/);
        assert.match(staffPage, /recommended\.tech = 1/);
        assert.match(staffPage, /recommended\.cafe = cafeGuests/);
        assert.match(staffPage, /recommended\.cleaning = 1/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /const forecast = buildStaffingDemandForecast\(dates, baseFiltered\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /StaffState\.staffingForecast = forecast/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /renderStaffingForecastPanel\(forecast\)/);
        assert.doesNotMatch(weekNavigationBlock, /await fetchStaffingForecastBookings\(from, to\)/);
        assert.doesNotMatch(initPrimaryLoadBlock, /await fetchStaffingForecastBookings\(from, to\)/);
        const forecastFetchBlock = staffPage.match(/async function fetchStaffingForecastBookings[\s\S]*?async function postAttendanceAction/)?.[0] || '';
        assert.doesNotMatch(forecastFetchBlock, /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/);
        assert.doesNotMatch(forecastFetchBlock, /\/api\/staff\/schedule/);
        assert.match(staffScheduleShell, /id="scheduleForecastPanel"/);
        assert.match(staffScheduleShell, /id="scheduleForecastPanel"[^>]*hidden/);
        assert.match(staffCss, /\.schedule-forecast-panel/);
        assert.match(staffCss, /\.forecast-day-card/);
        assert.match(staffCss, /\.forecast-gap-chip\.is-missing/);
        assert.match(staffCss, /\.forecast-rules/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-forecast-panel/);
    });

    it('adds read-only manager accountability without fake unavailable metrics or new protected surfaces', () => {
        const renderSchedulePrimaryBlock = staffPage.slice(
            staffPage.indexOf('function renderSchedule()'),
            staffPage.indexOf('// Group staff by department')
        );

        assert.match(staffPage, /managerAccountability:\s*null/);
        assert.match(staffPage, /accountabilityDeptFilter:\s*'all'/);
        assert.match(staffPage, /accountabilityManagerFilter:\s*'all'/);
        assert.match(staffPage, /const MANAGER_ACCOUNTABILITY_ROLES = new Set\(\['manager', 'senior_manager', 'admin', 'vice_director', 'art_director'\]\)/);
        assert.match(staffPage, /const MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS = \{/);
        [
            'late_reports_source_missing',
            'payroll_reconciliation_source_missing',
            'shift_approval_source_missing',
            'historical_accountability_snapshot_missing',
            'manager_action_log_source_missing'
        ].forEach(source => assert.match(staffPage, new RegExp(source)));
        assert.match(staffPage, /function buildManagerAccountability/);
        assert.match(staffPage, /function managerAccountabilityAttendanceCounts/);
        assert.match(staffPage, /function managerAccountabilityLowReadiness/);
        assert.match(staffPage, /readiness\.hasData && readiness\.total > 0 && readiness\.percent < 45/);
        assert.match(staffPage, /function renderManagerAccountabilityPanel/);
        assert.match(staffPage, /Explicit manager→department mapping is missing/);
        assert.match(staffPage, /not counted as zero/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.lateReports, 'late reports'\)/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.payrollDiscrepancies, 'payroll'\)/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.unapprovedShifts, 'unapproved'\)/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.lowReadiness, 'low readiness'\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /const accountability = buildManagerAccountability\(dates, baseFiltered, health\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /StaffState\.managerAccountability = accountability/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /renderManagerAccountabilityPanel\(accountability\)/);
        assert.match(staffPage, /data-accountability-filter="department"/);
        assert.match(staffPage, /data-accountability-filter="manager"/);
        assert.match(staffPage, /data-accountability-dept/);
        assert.match(staffPage, /href="\/reports\.html"/);
        assert.match(staffPage, /href="\/hr\.html"/);
        assert.doesNotMatch(staffPage, /\/api\/manager-accountability|\/api\/accountability/);
        assert.doesNotMatch(staffPage, /CREATE TABLE|ALTER TABLE|INSERT INTO manager|UPDATE manager/);
        assert.match(staffScheduleShell, /id="managerAccountabilityPanel"/);
        assert.match(staffScheduleShell, /id="managerAccountabilityPanel"[^>]*hidden/);
        assert.match(staffCss, /\.manager-accountability-panel/);
        assert.match(staffCss, /\.accountability-table/);
        assert.match(staffCss, /\.accountability-metric\.is-unavailable/);
        assert.match(staffCss, /\.accountability-manager-row/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.manager-accountability-panel/);
    });

    it('links schedule plans to payroll-ready attendance without adding a new data model', () => {
        const renderEmpRowBlock = staffPage.slice(
            staffPage.indexOf('function renderEmpRow'),
            staffPage.indexOf('function scheduleCellFromEvent')
        );
        const attendanceRoute = routeBlock('/attendance');
        assert.match(attendanceRoute, /hr_time_records tr/);
        assert.match(attendanceRoute, /FULL OUTER JOIN staff_checkins sc/);
        assert.match(attendanceRoute, /tr\.clock_in/);
        assert.match(attendanceRoute, /tr\.clock_out/);
        assert.match(attendanceRoute, /tr\.planned_start/);
        assert.match(attendanceRoute, /tr\.planned_end/);
        assert.match(attendanceRoute, /tr\.late_minutes/);
        assert.match(attendanceRoute, /tr\.early_leave_minutes/);
        assert.match(attendanceRoute, /tr\.total_worked_minutes/);
        assert.match(attendanceRoute, /attendance_source/);
        assert.doesNotMatch(attendanceRoute, /CREATE TABLE|ALTER TABLE|INSERT INTO hr_time_records|UPDATE hr_time_records/);

        assert.match(staffPage, /attendance:\s*\{\}/);
        assert.match(staffPage, /async function fetchScheduleAttendance/);
        assert.match(staffPage, /\/api\/staff\/attendance\?from=\$\{encodeURIComponent\(from\)\}&to=\$\{encodeURIComponent\(to\)\}/);
        assert.match(staffPage, /function scheduleAttendanceStatus/);
        ['planned', 'checked_in', 'late', 'absent', 'left_early', 'completed', 'manual_review', 'excused']
            .forEach(status => assert.match(staffPage, new RegExp(status)));
        assert.match(staffPage, /function renderScheduleAttendanceIndicator/);
        assert.match(staffPage, /function renderScheduleAttendanceSummary/);
        assert.doesNotMatch(renderEmpRowBlock, /renderScheduleAttendanceIndicator|attendanceIndicator|attendanceClass|has-attendance-/);
        assert.match(staffPage, /postAttendanceAction\(action, staffId\)/);
        assert.match(staffPage, /\/api\/hr\/clock-in/);
        assert.match(staffPage, /\/api\/hr\/clock-out/);
        assert.match(staffPage, /\/api\/hr\/mark-absent/);
        assert.match(staffPage, /data-attendance-action/);
        assert.match(staffPage, /event\.stopPropagation\(\)/);
        assert.match(staffPage, /renderScheduleAttendanceSummary\(dates, filtered\)/);
        assert.match(staffScheduleShell, /id="scheduleAttendanceSummary"/);
        assert.match(staffCss, /\.schedule-attendance-summary/);
        assert.match(staffCss, /\.sch-attendance\.is-late/);
        assert.match(staffCss, /\.sch-attendance\.is-absent/);
        assert.match(staffCss, /\.attendance-action-btn/);
        assert.match(staffCss, /\.sch-cell\.has-attendance-late/);
    });

    it('groups reception, managers, and security into schedule display departments without changing stored departments', () => {
        assert.match(staffPage, /const SCHEDULE_DEPARTMENT_ORDER = \['animators', 'trampoline', 'reception', 'admin', 'cafe', 'tech', 'cleaning'\]/);
        assert.match(staffPage, /const SCHEDULE_RECEPTION_ROLE_KEYS = new Set\(\['reception', 'manager', 'senior_manager'\]\)/);
        const canonicalGroupBlock = namedFunctionBlock(staffPage, 'scheduleCanonicalDisplayGroupKey');
        assert.match(canonicalGroupBlock, /const backendGroup = normalizeScheduleDisplayGroupKey\(staff\.display_group \|\| staff\.displayGroup\)/);
        assert.match(canonicalGroupBlock, /if \(backendGroup\) return backendGroup/);
        assert.match(staffPage, /if \(SCHEDULE_RECEPTION_ROLE_KEYS\.has\(roleKey\)\) return 'reception'/);
        assert.match(staffPage, /if \(department === 'security'\) return 'tech'/);
        assert.match(staffPage, /reception:\s*'Рецепшен'/);
        assert.match(staffPage, /tech:\s*'Технічний відділ'/);
        assert.match(staffPage, /reception:\s*\[\s*\{\s*key:\s*'reception',\s*label:\s*'Рецепція'/);
        assert.match(staffPage, /key:\s*'manager,senior_manager',\s*label:\s*'Менеджери'/);
        assert.match(staffPage, /tech:\s*\[\s*\{\s*departments:\s*'tech',\s*label:\s*'Технічний відділ'/);
        assert.match(staffPage, /departments:\s*'security',\s*key:\s*'security',\s*label:\s*'Охорона'/);
        assert.match(staffPage, /key:\s*'pizzaiolo',\s*label:\s*'Піцайоло'/);
        assert.match(staffPage, /key:\s*'wardrobe',\s*label:\s*'Гардероб'/);
        assert.match(staffPage, /value:\s*'reception',\s*label:\s*'Рецепція'/);
        assert.match(staffPage, /value:\s*'pizzaiolo',\s*label:\s*'Піцайоло'/);
        assert.match(staffPage, /value:\s*'wardrobe',\s*label:\s*'Гардероб'/);
        assert.doesNotMatch(staffPage, /const SCHEDULE_DEPARTMENT_ORDER = \[[^\]]*'security'/);
        assert.doesNotMatch(staffPage, /(?:s|emp|staff)\.department === StaffState\.activeDept/);
    });

    it('centralizes operational staff display groups in the backend contract', () => {
        assert.deepEqual(staffDisplayGroups.listStaffDisplayGroups().map(group => group.key), [
            'animators', 'trampoline', 'reception', 'admin', 'cafe', 'tech', 'cleaning'
        ]);
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'security', role_type: 'maintenance' }), 'tech');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'admin', role_type: 'manager' }), 'reception');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'admin', role_type: 'senior_manager' }), 'reception');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'cleaning', role_type: 'reception' }), 'reception');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup(
            { department: 'security', role_type: 'maintenance' },
            { structureNode: { displayGroup: 'cafe' } }
        ), 'cafe');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup(
            { department: 'security', role_type: 'maintenance' },
            { structureNode: { displayGroup: 'unknown' } }
        ), 'tech');
        assert.equal(staffDisplayGroups.staffStructureDisplayGroupKey({ id: 'managers' }), 'reception');
        assert.equal(staffDisplayGroups.staffStructureDisplayGroupKey({ id: 'technical_staff' }), 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup({ department: 'security' }).display_group_label, 'Технічний відділ');
        assert.doesNotMatch(staffDisplayGroupService, /key:\s*'security'/);
        assert.match(staffRoute, /require\('\.\.\/services\/staffDisplayGroups'\)/);
        assert.match(staffRoute, /router\.get\('\/display-groups'/);
        assert.match(staffRoute, /displayGroups: listStaffDisplayGroups\(\)/);
        assert.match(hrRoute, /decorateStaffWithDisplayGroup\(s, \{ displayGroupContext \}\)/);
        assert.match(hrRoute, /display_group: displayStaff\.display_group/);
        assert.match(hrRoute, /displayGroup: displayStaff\.displayGroup/);
        assert.match(hrRoute, /displayGroups: listStaffDisplayGroups\(\)/);
    });

    it('resolves staff display groups from company structure context before fallback', async () => {
        const context = await staffDisplayGroups.loadStaffDisplayGroupContext({
            async query(sql) {
                if (/FROM settings/i.test(sql)) {
                    return {
                        rows: [{
                            value: {
                                nodes: [
                                    { id: 'ops_node', title: 'Ops', displayGroup: 'cafe' },
                                    { id: 'tech_node', title: 'Tech', displayGroup: 'tech' },
                                    { id: 'blank_node', title: 'No display group' }
                                ]
                            }
                        }]
                    };
                }
                if (/FROM hr_professions/i.test(sql)) {
                    return { rows: [{ key: 'maintenance', structure_node_id: 'tech_node' }] };
                }
                return { rows: [] };
            }
        });
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'maintenance', company_structure_node_id: 'ops_node' },
            { displayGroupContext: context }
        ).display_group, 'cafe');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'admin', role_type: 'manager', company_structure_node_id: 'ops_node' },
            { displayGroupContext: context }
        ).display_group, 'cafe');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'maintenance' },
            { displayGroupContext: context }
        ).display_group, 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'unknown', company_structure_node_id: 'missing_node' },
            { displayGroupContext: context }
        ).display_group, 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'unknown', company_structure_node_id: 'blank_node' },
            { displayGroupContext: context }
        ).display_group, 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'admin', role_type: 'senior_manager', company_structure_node_id: 'blank_node' },
            { displayGroupContext: context }
        ).display_group, 'reception');

        const staffScheduleRoute = routeBlock('/schedule');
        const staffListRoute = routeBlock('/');
        const hrStaffRoute = hrRouteBlock('/staff');
        const hrTodayRoute = hrRouteBlock('/today');
        assert.match(staffScheduleRoute, /s\.role_type, s\.company_structure_node_id/);
        assert.match(staffScheduleRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(staffScheduleRoute, /attachScheduleDayPlans\(result\.rows\)/);
        assert.match(staffScheduleRoute, /decorateStaffRowsWithDisplayGroups\(rowsWithPlans, \{ displayGroupContext \}\)/);
        assert.match(staffListRoute, /staff\.company_structure_node_id/);
        assert.match(staffListRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(staffListRoute, /decorateStaffRowsWithDisplayGroups\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(staffListRoute, /buildStaffDisplayGroupOptions\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(hrStaffRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(hrStaffRoute, /decorateStaffRowsWithDisplayGroups\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(hrTodayRoute, /company_structure_node_id/);
        assert.match(hrTodayRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(hrTodayRoute, /decorateStaffWithDisplayGroup\(s, \{ displayGroupContext \}\)/);
    });

    it('uses shared display groups for HR today filters and searchable raw department metadata', () => {
        assert.match(hrPage, /let todayDisplayGroups = \[\]/);
        assert.match(hrPage, /function normalizeStaffDisplayGroups\(groups = \[\]\)/);
        assert.match(hrPage, /function setStaffDisplayGroupsContract\(groups = \[\], options = \{\}\)/);
        assert.match(hrPage, /function staffDisplayGroupKeyForStaff\(staff = \{\}\)/);
        assert.match(hrPage, /const backendGroup = normalizeStaffDisplayGroupKey\(staff\.display_group \|\| staff\.displayGroup\)/);
        assert.match(hrPage, /function legacyStaffDisplayGroupKeyForStaff\(staff = \{\}\)/);
        assert.match(hrPage, /if \(\['reception', 'manager', 'senior_manager'\]\.includes\(roleKey\)\) return 'reception'/);
        assert.match(hrPage, /if \(departmentKey === 'security'\) return 'tech'/);
        assert.match(hrPage, /function todayDepartmentOptions\(items = \[\], groups = staffDisplayGroupsContract\)/);
        assert.match(hrPage, /const key = staffDisplayGroupKeyForStaff\(item\)/);
        assert.match(hrPage, /if \(department !== 'all' && staffDisplayGroupKeyForStaff\(item\) !== department\) return false/);
        assert.match(hrPage, /setStaffDisplayGroupsContract\(data\.displayGroups \|\| data\.display_groups \|\| staffDisplayGroupsContract\)/);
        assert.match(hrPage, /function companyStructureDisplayGroupOptions\(selectedValue = ''\) \{[\s\S]*activeStaffDisplayGroups\(staffDisplayGroupsContract\)[\s\S]*groups\.map\(group =>/);
        assert.match(hrPage, /displayGroupLabel/);
        assert.match(hrPage, /departmentLabel\(item\.department\)/);
        const fetchScheduleBlock = namedFunctionBlock(staffPage, 'fetchSchedule');
        const goToRangeBlock = namedFunctionBlock(staffPage, 'goToScheduleRange');
        assert.match(fetchScheduleBlock, /displayGroups:\s*normalizeScheduleDisplayGroups\(/);
        assert.doesNotMatch(fetchScheduleBlock, /StaffState\.displayGroups\s*=/);
        assert.match(goToRangeBlock, /StaffState\.displayGroups\s*=/);
    });

    it('uses schedule display groups in filters, fill-week, load view, export, and copy-week safety', () => {
        assert.match(staffPage, /function scheduleStaffVisibleWithoutSearch\(staffList = StaffState\.staff\) \{[\s\S]*uniqueScheduleStaffById\([\s\S]*staffMatchesScheduleDepartment\(staff, StaffState\.activeDept\)[\s\S]*\}/);
        assert.match(staffPage, /function scheduleVisibleStaff\(staffList = StaffState\.staff\) \{[\s\S]*const visible = scheduleStaffVisibleWithoutSearch\(staffList\);[\s\S]*const query = normalizeScheduleSearchText\(StaffState\.searchQuery\);[\s\S]*scheduleStaffSearchHaystack\(staff\)\.includes\(query\)[\s\S]*\}/);
        assert.match(staffPage, /function legacyScheduleDisplayDepartmentKey\(staff = \{\}\)/);
        assert.match(staffPage, /function scheduleDepartmentOptions\(\) \{[\s\S]*const counts = scheduleDepartmentCountMap\(StaffState\.staff\)[\s\S]*scheduleDisplayGroupOrder\(\)/);
        const membershipBlock = namedFunctionBlock(staffPage, 'staffScheduleDepartmentKeys');
        assert.match(membershipBlock, /staffProfessionKeys\(staff\)/);
        assert.match(membershipBlock, /add\(scheduleCanonicalDisplayGroupKey\(staff\)\)/);
        assert.match(staffPage, /function staffMatchesScheduleDepartment\(staff = \{\}, departmentKey = ''\) \{[\s\S]*staffScheduleDepartmentKeys\(staff\)\.includes\(normalized\)/);
        assert.match(staffPage, /function scheduleStaffGroupingDepartmentKeys\(staff = \{\}, options = \{\}\)/);
        assert.match(staffPage, /return staffMatchesScheduleDepartment\(staff, activeDepartment\) \? \[activeDepartment\] : \[\]/);
        assert.match(staffPage, /function scheduleDepartmentRenderOrder\(grouped = \{\}\) \{[\s\S]*scheduleDisplayGroupOrder\(\)\.filter\(key => grouped\[key\]\)/);
        assert.match(staffPage, /if \(StaffState\.activeDept !== 'all' && !options\.some\(option => option\.value === StaffState\.activeDept\)\) \{[\s\S]*StaffState\.activeDept = 'all'/);
        assert.match(staffPage, /function openFillWeekModal\(\) \{[\s\S]*const filtered = scheduleVisibleStaff\(\)[\s\S]*normalizeScheduleStaffId\(emp\.id\)/);
        assert.match(staffPage, /if \(staffValue === 'all'\) \{[\s\S]*targetStaff = scheduleVisibleStaff\(\)[\s\S]*uniqueScheduleStaffById\(scheduleableStaffForUi\(targetStaff\)\)/);
        assert.match(staffPage, /function handleFillWeekSave\(\) \{[\s\S]*const dates = getScheduleDates\(\)[\s\S]*checkedDays\.includes\(d\.getDay\(\)\)/);
        assert.match(staffPage, /const needsConfirmation = dates\.length > STAFF_SCHEDULE_WINDOW_DAYS[\s\S]*entries\.length >= STAFF_SCHEDULE_BULK_CONFIRM_ENTRY_THRESHOLD/);
        assert.match(staffPage, /confirmModal\(confirmLines\.join\('\\n'\), \{ type: 'warning', okText: 'Заповнити' \}\)/);
        assert.match(staffPage, /await goToScheduleRange\(currentRange\.start, currentRange\.end, currentMode\)/);
        assert.match(staffPage, /function renderLoadView\(\) \{[\s\S]*const filtered = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /function scheduleExportVisibleStaff\(\) \{[\s\S]*scheduleFinalVisibleStaffSnapshot\(/);
        assert.match(staffPage, /const visibleSnapshot = scheduleFinalVisibleStaffSnapshot\(StaffState\.staff, dates\)/);
        assert.match(staffPage, /const grouped = groupStaffByScheduleDepartment\(filtered, \{[\s\S]*department: StaffState\.activeDept[\s\S]*\}\)/);
        assert.match(staffPage, /function buildScheduleWorkbookHtml\(options = \{\}\) \{[\s\S]*const exportStaff = uniqueScheduleStaffById\(scheduleExportVisibleStaff\(\)\)[\s\S]*const grouped = groupStaffByScheduleDepartment\(exportStaff, \{[\s\S]*department: StaffState\.activeDept[\s\S]*\}\)/);
        assert.match(staffPage, /function buildScheduleWorkbookHtml\(options = \{\}\) \{[\s\S]*const deptLabel = scheduleDisplayDepartmentLabel\(dept\)/);
        assert.match(staffPage, /const SCHEDULE_COPY_RAW_DEPARTMENT_SAFE = new Set\(\['animators', 'trampoline', 'cafe', 'cleaning'\]\)/);
        assert.match(staffPage, /const SCHEDULE_COPY_EXPLICIT_STAFF_CATEGORIES = new Set\(\['reception', 'tech', 'admin'\]\)/);
        assert.match(staffPage, /function scheduleCopyWeekModeForDepartment/);
        assert.match(staffPage, /function scheduleCopyWeekVisibleStaffIds/);
        assert.match(staffPage, /function scheduleCopyWeekPayload/);
        assert.match(staffPage, /body\.department = department/);
        assert.match(staffPage, /body\.staffIds = scheduleCopyWeekVisibleStaffIds\(\)/);
        assert.match(staffPage, /function canCopyWeekInCurrentRange\(\) \{[\s\S]*scheduleRangeDayCount\(range\.start, range\.end\) === STAFF_SCHEDULE_WINDOW_DAYS/);
        assert.match(staffPage, /if \(!canCopyWeekInCurrentRange\(\)\) \{[\s\S]*Копія тижня недоступна для довільного періоду/);
        assert.match(staffPage, /Довільний visible range не копіюється цією дією/);
        assert.match(staffPage, /copyWeekSchedule\(fromMonday, toMonday, \{ dryRun: true \}\)/);
        assert.match(staffPage, /visible staffIds\[\]/);
    });

    it('renders unique canonical staff in All while selected sections keep qualification membership', () => {
        const normalizeIdBlock = namedFunctionBlock(staffPage, 'normalizeScheduleStaffId');
        const uniqueStaffBlock = namedFunctionBlock(staffPage, 'uniqueScheduleStaffById');
        const canonicalGroupBlock = namedFunctionBlock(staffPage, 'scheduleCanonicalDisplayGroupKey');
        const membershipBlock = namedFunctionBlock(staffPage, 'staffScheduleDepartmentKeys');
        const groupingKeysBlock = namedFunctionBlock(staffPage, 'scheduleStaffGroupingDepartmentKeys');
        const departmentCountBlock = namedFunctionBlock(staffPage, 'scheduleDepartmentCountMap');
        const visibleWithoutSearchBlock = namedFunctionBlock(staffPage, 'scheduleStaffVisibleWithoutSearch');
        const groupStaffBlock = namedFunctionBlock(staffPage, 'groupStaffByScheduleDepartment');
        const finalVisibleBlock = namedFunctionBlock(staffPage, 'scheduleFinalVisibleStaffSnapshot');
        const renderBlock = namedFunctionBlock(staffPage, 'renderSchedule');
        const fillModalBlock = namedFunctionBlock(staffPage, 'openFillWeekModal');
        const fillSaveBlock = namedFunctionBlock(staffPage, 'handleFillWeekSave');
        const copyIdsBlock = namedFunctionBlock(staffPage, 'scheduleCopyWeekVisibleStaffIds');
        const exportVisibleBlock = namedFunctionBlock(staffPage, 'scheduleExportVisibleStaff');
        const workbookBlock = namedFunctionBlock(staffPage, 'buildScheduleWorkbookHtml');
        const displayNameBlock = namedFunctionBlock(staffPage, 'scheduleStaffDisplayName');
        const professionContextBlock = namedFunctionBlock(staffPage, 'scheduleProfessionKeyForDepartment');
        const openCellBlock = namedFunctionBlock(staffPage, 'openScheduleCell');
        const openEditBlock = namedFunctionBlock(staffPage, 'openEditModal');
        const browserFlow = namedFunctionBlock(staffScheduleBrowserSmoke, 'runMembershipGroupingFlow');

        assert.match(normalizeIdBlock, /Number\(/);
        assert.match(normalizeIdBlock, /Number\.isSafeInteger|Number\.isInteger|Number\.isFinite/);
        assert.match(uniqueStaffBlock, /normalizeScheduleStaffId/);
        assert.match(uniqueStaffBlock, /new Set\(\)/);

        assert.match(canonicalGroupBlock, /normalizeScheduleDisplayGroupKey\(staff\.display_group \|\| staff\.displayGroup\)/);
        assert.match(canonicalGroupBlock, /if \(backendGroup\) return backendGroup/);
        assert.match(canonicalGroupBlock, /normalizeScheduleDisplayGroupKey\(legacyScheduleDisplayDepartmentKey\(staff\)\)/);
        assert.match(canonicalGroupBlock, /\|\| 'admin'|return 'admin'/);
        assert.match(membershipBlock, /staffProfessionKeys\(staff\)/);
        assert.match(membershipBlock, /scheduleProfessionDisplayGroupKey/);
        assert.match(membershipBlock, /scheduleCanonicalDisplayGroupKey\(staff\)/);

        assert.match(groupingKeysBlock, /staffMatchesScheduleDepartment\(staff, activeDepartment\) \? \[activeDepartment\] : \[\]/);
        assert.match(groupingKeysBlock, /return \[scheduleCanonicalDisplayGroupKey\(staff\)\]/);
        assert.match(groupingKeysBlock, /options\.grouping === 'membership'/);
        assert.doesNotMatch(renderBlock, /grouping: 'membership'/);
        assert.match(renderBlock, /department: dept/);
        assert.match(professionContextBlock, /scheduleSubGroupProfessionCandidates\(staff, normalizedDepartment\)/);
        assert.match(openCellBlock, /professionKey: cell\.dataset\.scheduleProfession/);
        assert.match(openEditBlock, /entry\?\.profession_key \|\| sectionProfessionKey \|\| emp\.role_type/);

        [departmentCountBlock, visibleWithoutSearchBlock, groupStaffBlock].forEach(block => {
            assert.match(block, /uniqueScheduleStaffById\(/);
        });
        assert.match(finalVisibleBlock, /scheduleVisibleStaff\(/);
        assert.match(finalVisibleBlock, /scheduleHealthFilteredStaff\(/);
        assert.ok((finalVisibleBlock.match(/uniqueScheduleStaffById\(/g) || []).length >= 2);
        assert.match(renderBlock, /scheduleFinalVisibleStaffSnapshot\(/);
        assert.match(exportVisibleBlock, /scheduleFinalVisibleStaffSnapshot\(/);
        assert.match(fillModalBlock, /scheduleVisibleStaff\(\)/);
        assert.match(fillModalBlock, /normalizeScheduleStaffId\(emp\.id\)/);
        assert.match(fillSaveBlock, /uniqueScheduleStaffById\(/);
        assert.match(copyIdsBlock, /uniqueScheduleStaffById\(/);
        assert.match(copyIdsBlock, /normalizeScheduleStaffId/);

        assert.match(displayNameBlock, /staff\.display_name \|\| staff\.displayName \|\| staff\.name/);
        assert.match(workbookBlock, /data-schedule-export-staff-id=/);
        assert.match(workbookBlock, /data-schedule-export-department=/);
        assert.doesNotMatch(workbookBlock, /grouping: 'membership'/);
        assert.match(workbookBlock, /scheduleStaffDisplayName\(emp\)/);

        assert.match(staffScheduleBrowserSmoke, /const STAFF_API_ROWS\s*=/);
        assert.match(staffScheduleBrowserSmoke, /role_type:\s*'senior_manager'/);
        assert.match(staffScheduleBrowserSmoke, /secondary_professions:\s*\['reception',\s*'reception',\s*'animator'\]/);
        assert.match(staffScheduleBrowserSmoke, /secondary_professions:\s*\['manager',\s*'barista'\]/);
        assert.match(staffScheduleBrowserSmoke, /secondary_professions:\s*\['trampoline_instructor'\]/);
        assert.match(staffScheduleBrowserSmoke, /role_type:\s*'legacy_shift_role'/);
        assert.match(staffScheduleBrowserSmoke, /secondary_professions:\s*\['legacy_auxiliary'\]/);
        assert.match(staffScheduleBrowserSmoke, /\{\s*\.\.\.STAFF_ROWS\[0\],\s*id:\s*'101'\s*\}/);
        assert.match(staffScheduleBrowserSmoke, /function scheduleStaffIdsFromDom/);
        assert.match(staffScheduleBrowserSmoke, /function scheduleExportStaffIdsFromHtml/);
        assert.match(staffScheduleBrowserSmoke, /function assertUniqueScheduleStaffIds/);
        assert.match(staffScheduleBrowserSmoke, /function assertScheduleExportParity/);
        assert.match(staffScheduleBrowserSmoke, /async function runMembershipGroupingFlow/);
        assert.match(staffScheduleBrowserSmoke, /runMembershipGroupingFlow\(/);
        assert.match(browserFlow, /Батутисти/);
        assert.match(browserFlow, /reception/);
        assert.match(browserFlow, /animators/);
        assert.match(browserFlow, /StaffSchedulePage\.refresh/);
        assert.match(browserFlow, /scheduleBodies/);
        assert.match(browserFlow, /queueScheduleSaveResponseScenario/);
        assert.match(browserFlow, /page\.mouse\.click/);
        assert.doesNotMatch(browserFlow, /receptionSession|receptionPage/);
        assert.match(liveStaffScheduleSmoke, /assertWorkbookStaffPlacementParity/);
        assert.match(liveStaffScheduleSmoke, /serviceWorkers:\s*'block'/);
        assert.match(staffScheduleBrowserSmoke, /function captureStableScheduleScreenshot/);
        assert.match(liveStaffScheduleSmoke, /function captureStableScheduleScreenshot/);
        assert.match(staffScheduleBrowserSmoke, /animations:\s*'disabled'/);
        assert.match(liveStaffScheduleSmoke, /caret:\s*'hide'/);
        assert.match(liveStaffScheduleSmoke, /captureDepartmentScheduleSurfaces/);
        assert.doesNotMatch(staffScheduleBrowserSmoke, /fullPage:\s*true/);
        assert.doesNotMatch(liveStaffScheduleSmoke, /fullPage:\s*true/);
        assert.match(liveStaffScheduleSmoke, /staffIdsAreUnique\(allState\.ids\)/);
        assert.match(liveStaffScheduleSmoke, /const sharedStaffIds = sharedSectionStates\.animators\.ids/);
        assert.match(liveStaffScheduleSmoke, /for \(const sharedStaffId of sharedStaffIds\)/);
        assert.doesNotMatch(liveStaffScheduleSmoke, /qualification filters expose a shared animator\/reception staff member/);
    });

    it('keeps All unique, section membership complete, and table/export placement parity exact', () => {
        const api = loadStaffScheduleBehaviorApi();
        const common = {
            is_active: true,
            is_freelance: false,
            hr_pool_status: 'core',
            has_account: true,
            has_face_descriptor: true
        };
        const staff = [
            {
                ...common,
                id: 101,
                name: 'Синіпол Віталіна',
                display_name: 'Віталіна Синіпол',
                department: 'reception',
                display_group: 'reception',
                role_type: 'senior_manager',
                secondary_professions: ['reception', 'reception', 'animator']
            },
            {
                ...common,
                id: '101',
                name: 'Duplicate API Row',
                department: 'reception',
                display_group: 'reception',
                role_type: 'reception',
                secondary_professions: []
            },
            {
                ...common,
                id: 102,
                name: 'Cafe Trampoline',
                department: 'cafe',
                display_group: 'cafe',
                role_type: 'barista',
                secondary_professions: ['trampoline_instructor']
            },
            {
                ...common,
                id: 103,
                name: 'Manager Cook',
                department: 'reception',
                display_group: 'reception',
                role_type: 'manager',
                secondary_professions: ['reception', 'cook']
            },
            {
                ...common,
                id: 104,
                name: 'Legacy Admin',
                department: 'admin',
                display_group: 'admin',
                role_type: 'admin',
                secondary_professions: ['unknown_legacy_profession']
            },
            {
                ...common,
                id: 105,
                name: 'Waiter Cook',
                department: 'cafe',
                display_group: 'cafe',
                role_type: 'waiter',
                secondary_professions: ['cook', 'waiter', 'cook']
            }
        ];
        api.setState({
            activeDept: 'all',
            searchQuery: '',
            healthFilter: 'all',
            staff,
            schedule: {},
            scheduleRawEntries: [],
            rangeStart: new Date('2026-07-01T00:00:00'),
            rangeEnd: new Date('2026-07-15T00:00:00'),
            weekStart: new Date('2026-07-01T00:00:00'),
            professions: [
                { key: 'senior_manager', title: 'Senior manager', department: 'reception' },
                { key: 'animator', title: 'Animator', department: 'animators' },
                { key: 'reception', title: 'Reception', department: 'reception' },
                { key: 'manager', title: 'Manager', department: 'reception' },
                { key: 'barista', title: 'Barista', department: 'cafe' },
                { key: 'cook', title: 'Cook', department: 'cafe' },
                { key: 'waiter', title: 'Waiter', department: 'cafe' },
                { key: 'trampoline_instructor', title: 'Trampoline', department: 'trampoline' },
                { key: 'admin', title: 'Admin', department: 'admin' }
            ],
            displayGroups: [
                { key: 'animators', label: 'Animators', order: 0 },
                { key: 'trampoline', label: 'Trampoline', order: 1 },
                { key: 'reception', label: 'Reception', order: 2 },
                { key: 'admin', label: 'Admin', order: 3 },
                { key: 'cafe', label: 'Cafe', order: 4 }
            ]
        });

        const counts = api.scheduleDepartmentCounts();
        assert.deepEqual(
            JSON.parse(JSON.stringify(counts)),
            { animators: 1, reception: 2, cafe: 3, trampoline: 1, admin: 1 },
            'chips count unique staff IDs by all department memberships'
        );

        const allVisibleIds = Array.from(api.visibleStaffIds());
        assert.equal(allVisibleIds.join(','), '101,102,103,104,105', 'All count is the unique staff ID set');
        assert.equal(allVisibleIds.length, 5, 'All totals count Vitalina once even though she belongs to two sections');
        const allGrouped = JSON.parse(JSON.stringify(api.groupedStaffIds(staff, { grouping: 'membership' })));
        assert.deepEqual(allGrouped, {
            animators: [101],
            reception: [101, 103],
            cafe: [102, 103, 105],
            trampoline: [102],
            admin: [104]
        });
        assert.ok(
            Object.values(allGrouped).reduce((total, ids) => total + ids.length, 0) > allVisibleIds.length,
            'membership placements can exceed the unique people total'
        );
        Object.entries(allGrouped).forEach(([department, ids]) => {
            assert.equal(ids.length, new Set(ids).size, `${department} renders every staff ID at most once`);
        });
        const canonicalGrouped = JSON.parse(JSON.stringify(api.groupedStaffIds(staff)));
        assert.deepEqual(canonicalGrouped, {
            reception: [101, 103],
            cafe: [102, 105],
            admin: [104]
        });
        assert.equal(
            Object.values(canonicalGrouped).flat().length,
            allVisibleIds.length,
            'All renders each physical staff member exactly once'
        );
        assert.equal(api.scheduleProfessionKeyForDepartment(staff[0], 'animators'), 'animator');
        assert.equal(api.scheduleProfessionKeyForDepartment(staff[0], 'reception'), 'senior_manager');

        const exportedIds = html => Array.from(
            html.matchAll(/data-schedule-export-staff-id="(\d+)"/g),
            match => Number(match[1])
        );
        const exportedPlacements = html => Array.from(
            html.matchAll(/data-schedule-export-staff-id="(\d+)" data-schedule-export-department="([^"]+)"/g),
            match => `${match[2]}:${Number(match[1])}`
        ).sort();
        const workbookIds = exportedIds(api.buildScheduleWorkbookHtml());
        const printIds = exportedIds(api.buildScheduleWorkbookHtml({ print: true }));
        const expectedPlacements = Object.entries(canonicalGrouped)
            .flatMap(([department, ids]) => ids.map(id => `${department}:${id}`))
            .sort();
        assert.deepEqual(exportedPlacements(api.buildScheduleWorkbookHtml()), expectedPlacements);
        assert.deepEqual(exportedPlacements(api.buildScheduleWorkbookHtml({ print: true })), expectedPlacements);
        assert.equal(new Set(workbookIds).size, allVisibleIds.length, 'workbook still contains the unique visible staff set');
        assert.equal(new Set(printIds).size, allVisibleIds.length, 'print still contains the unique visible staff set');

        api.setState({ activeDept: 'reception', searchQuery: 'віталіна' });
        const receptionVisibleIds = Array.from(api.visibleStaffIds());
        const receptionGrouped = JSON.parse(JSON.stringify(api.groupedStaffIds(staff, { department: 'reception' })));
        assert.equal(receptionVisibleIds.join(','), '101', 'secondary reception membership survives active filter and search');
        assert.deepEqual(receptionGrouped, { reception: [101, 103] });
        assert.equal(exportedIds(api.buildScheduleWorkbookHtml()).join(','), '101');
        assert.equal(exportedIds(api.buildScheduleWorkbookHtml({ print: true })).join(','), '101');
    });

    it('keeps one persisted schedule row per staff member and date', () => {
        const putScheduleRoute = routePutBlock('/schedule');
        const bulkScheduleRoute = routePostBlock('/schedule/bulk');
        const mirrorBlock = namedFunctionBlock(staffScheduleMutations, 'upsertScheduleMirrorFromPlan');

        assert.match(mirrorBlock, /ON CONFLICT \(staff_id, date\)/);
        assert.match(mirrorBlock, /DO UPDATE SET shift_start = EXCLUDED\.shift_start/);
        assert.match(mirrorBlock, /profession_key = EXCLUDED\.profession_key/);
        assert.match(mirrorBlock, /RETURNING \*/);
        assert.match(putScheduleRoute, /mutateStaffScheduleEntry\(client/);
        assert.match(bulkScheduleRoute, /mutateStaffScheduleEntry\(client/);
        assert.match(staffScheduleBrowserSmoke, /assertSingleScheduleEntryPerStaffDate\(SCHEDULE_FIXTURE_ENTRIES/);
    });

    it('supports full copy-week for virtual categories through explicit staffIds and dry-run preview', () => {
        const copyWeekRoute = routePostBlock('/schedule/copy-week');
        assert.match(copyWeekRoute, /const \{ fromMonday, toMonday \} = req\.body/);
        assert.match(copyWeekRoute, /const displayGroup = String\(req\.body\.displayGroup \|\| req\.body\.display_group/);
        assert.match(copyWeekRoute, /const dryRun = req\.body\.dryRun === true \|\| req\.body\.dry_run === true/);
        assert.match(copyWeekRoute, /const staffIds = normalizeCopyWeekStaffIds\(req\.body\.staffIds \|\| req\.body\.staff_ids\)/);
        assert.match(staffRoute, /const STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST = new Set\(\['animators', 'trampoline', 'cafe', 'cleaning'\]\)/);
        assert.match(copyWeekRoute, /staffIds\.length && department/);
        assert.match(copyWeekRoute, /!STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST\.has\(department\)/);
        assert.match(copyWeekRoute, /virtual\/display group/);
        assert.match(copyWeekRoute, /ss\.staff_id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
        assert.match(copyWeekRoute, /dryRun/);
        assert.match(copyWeekRoute, /conflicts/);
        assert.match(copyWeekRoute, /copyMode/);
        assert.match(copyWeekRoute, /displayGroup/);
        assert.match(copyWeekRoute, /staffCount: sourceStaffIds\.length/);
        assert.match(copyWeekRoute, /staff_schedule_copy_week/);
        assert.match(copyWeekRoute, /staffIds: copyMode === 'explicit_staff_ids' \? sourceStaffIds : undefined/);
    });

    it('keeps canonical and legacy trampoline roles in the same schedule subgroup', () => {
        const resolverBlock = namedFunctionBlock(staffPage, 'resolveScheduleSubGroup');
        const partitionBlock = namedFunctionBlock(staffPage, 'partitionScheduleStaffBySubGroup');
        const renderEmpRowBlock = namedFunctionBlock(staffPage, 'renderEmpRow');
        const renderBlock = namedFunctionBlock(staffPage, 'renderSchedule');
        const workbookBlock = namedFunctionBlock(staffPage, 'buildScheduleWorkbookHtml');

        assert.match(staffPage, /key:\s*'trampoline_instructor,senior_instructor,instructor',\s*label:\s*'Батутисти'/);
        assert.match(staffPage, /trampoline:\s*\[\s*\{\s*key:\s*'trampoline_instructor,senior_instructor,instructor'/);
        assert.match(staffPage, /function departmentSubGroupDepartmentKeys/);
        assert.match(staffPage, /function resolveScheduleSubGroup/);
        assert.match(staffPage, /function partitionScheduleStaffBySubGroup/);
        assert.match(staffPage, /function scheduleSubGroupProfessionCandidates/);
        assert.match(staffPage, /function compareScheduleSubGroupCandidates/);
        assert.match(staffPage, /function shouldSkipScheduleSubGroup/);
        assert.match(resolverBlock, /scheduleSubGroupProfessionCandidates\(staff, activeDepartment\)/);
        assert.match(resolverBlock, /\.sort\(compareScheduleSubGroupCandidates\)/);
        assert.doesNotMatch(resolverBlock, /\.find\(/);
        assert.match(partitionBlock, /uniqueScheduleStaffById\(deptStaff \|\| \[\]\)/);
        assert.match(partitionBlock, /ownershipByStaffId\.set\(staffId, subGroup\)/);
        assert.match(renderBlock, /partitionScheduleStaffBySubGroup\(dept, deptStaff, subGroups/);
        assert.match(workbookBlock, /partitionScheduleStaffBySubGroup\(dept, deptStaff, subGroups/);
        assert.match(renderBlock, /const renderedStaffIds = new Set\(\)/);
        assert.match(workbookBlock, /const renderedStaffIds = new Set\(\)/);
        assert.match(renderEmpRowBlock, /data-schedule-subgroup-label/);
        assert.match(workbookBlock, /data-schedule-subgroup-label/);
        assert.match(staffPage, /placeholder:\s*'host, trampoline_instructor'/);
        assert.doesNotMatch(staffPage, /placeholder:\s*'host, instructor'/);
    });

    it('renders schedule department and subgroup icons as CRM SVG icons instead of emoji', () => {
        const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
        const departmentIconsBlock = staffPage.match(/const DEPT_ICONS = \{[\s\S]*?\n\};/)?.[0] || '';
        const subGroupsBlock = staffPage.match(/const DEPT_SUB_GROUPS = \{[\s\S]*?\n\};/)?.[0] || '';

        assert.match(staffPage, /const SCHEDULE_CRM_ICON_SVG = \{/);
        assert.match(staffPage, /function renderScheduleCrmIcon/);
        assert.match(departmentIconsBlock, /animators:\s*'drama'/);
        assert.match(departmentIconsBlock, /trampoline:\s*'activity'/);
        assert.match(departmentIconsBlock, /cafe:\s*'coffee'/);
        assert.match(subGroupsBlock, /label:\s*'Аніматори',\s*icon:\s*'drama'/);
        assert.match(subGroupsBlock, /label:\s*'Батутисти',\s*icon:\s*'activity'/);
        assert.match(staffPage, /renderScheduleCrmIcon\(DEPT_ICONS\[dept\], 'dept-icon schedule-crm-icon'\)/);
        assert.match(staffPage, /renderScheduleCrmIcon\(sg\.icon, 'sub-group-icon schedule-crm-icon'\)/);
        assert.doesNotMatch(departmentIconsBlock, emojiPattern);
        assert.doesNotMatch(subGroupsBlock, emojiPattern);
        assert.match(staffCss, /\.schedule-crm-icon\s*\{/);
        assert.match(staffCss, /\.schedule-crm-icon svg\s*\{/);
        assert.match(staffCss, /\.dept-row\[data-dept="animators"\] \.dept-icon/);
    });

    it('keeps active subgroup ownership relevant and suppresses only duplicate labels', () => {
        const candidatesBlock = namedFunctionBlock(staffPage, 'scheduleSubGroupProfessionCandidates');
        const skipBlock = namedFunctionBlock(staffPage, 'shouldSkipScheduleSubGroup');
        const resolverBlock = namedFunctionBlock(staffPage, 'resolveScheduleSubGroup');

        assert.match(candidatesBlock, /scheduleProfessionDisplayGroupKey\(primary\) === normalizedDepartment/);
        assert.match(candidatesBlock, /scheduleProfessionDisplayGroupKey\(professionKey\) === normalizedDepartment/);
        assert.match(candidatesBlock, /return \[primary, \.\.\.secondary\]\.filter\(Boolean\)/);
        assert.match(skipBlock, /parentLabel && subGroupLabel && parentLabel === subGroupLabel/);
        assert.doesNotMatch(skipBlock, /parentKey && subGroupKey && parentKey === subGroupKey/);
        assert.match(resolverBlock, /requestedDepartment !== 'all'/);
        assert.match(staffPage, /\.filter\(group => !shouldSkipScheduleSubGroup\(dept, group\.subGroup\)\)/);
        assert.doesNotMatch(staffPage, /function staffMatchesDepartmentSubGroup/);
    });

    it('keeps staff import and account linking on canonical role aliases', () => {
        const importRoleMap = staffRoute.match(/const EXCEL_TO_CRM_ROLE = \{[\s\S]*?\n\};/)?.[0] || '';
        assert.match(importRoleMap, /'Батутисти':\s*\{\s*dept:\s*'trampoline',\s*role:\s*'trampoline_instructor'\s*\}/);
        assert.match(importRoleMap, /'Хозяюшки залу':\s*\{\s*dept:\s*'cleaning',\s*role:\s*'cleaner'\s*\}/);
        assert.doesNotMatch(importRoleMap, /role:\s*'instructor'/);
        assert.doesNotMatch(importRoleMap, /role:\s*'cleaning'/);

        const accountRoleMapper = staffRoute.match(/function staffRoleToAccountRole\(roleType\) \{[\s\S]*?\n\}/)?.[0] || '';
        assert.match(accountRoleMapper, /trampoline_instructor:\s*'animator'/);
        assert.match(accountRoleMapper, /senior_instructor:\s*'manager'/);
        assert.match(accountRoleMapper, /cleaner:\s*'cleaning'/);
        assert.match(accountRoleMapper, /pizzaiolo:\s*'cook'/);
        assert.doesNotMatch(accountRoleMapper, /trampoline_instructor:\s*'instructor'/);
        assert.match(accountRoleMapper, /'instructor'/);
        assert.match(accountRoleMapper, /'cleaning'/);
    });

    it('renders explicit cell history UI and fetches it from the staff API', () => {
        assert.match(staffScheduleShell, /id="schHistoryList"/);
        assert.match(staffScheduleShell, /Історія клітинки/);
        assert.match(staffPage, /function renderScheduleHistoryList/);
        assert.match(staffPage, /fetchScheduleHistory/);
        assert.match(staffPage, /\/api\/staff\/schedule\/history\/\$\{encodeURIComponent\(staffId\)\}/);
    });
    it('commits cell history only for the latest matching modal identity', () => {
        const fetchHistoryBlock = namedFunctionBlock(staffPage, 'fetchScheduleHistory');
        const editingMatchBlock = namedFunctionBlock(staffPage, 'scheduleEditingCellMatches');
        const loadHistoryBlock = namedFunctionBlock(staffPage, 'loadScheduleCellHistory');
        const loadPreferencesBlock = namedFunctionBlock(staffPage, 'loadScheduleShiftPreferences');
        const closeBlock = namedFunctionBlock(staffPage, 'closeEditModal');

        assert.match(staffPage, /scheduleHistoryLoadSeq:\s*0/);
        assert.match(staffPage, /let scheduleCellHistoryAbortController = null/);
        assert.match(fetchHistoryBlock, /signal:\s*options\.signal/);
        assert.match(fetchHistoryBlock, /!res\.ok \|\| !data\?\.success/);
        assert.match(fetchHistoryBlock, /data:\s*Array\.isArray\(data\.data\) \? data\.data : \[\]/);
        assert.match(fetchHistoryBlock, /isScheduleAbortError\(err\)/);
        assert.doesNotMatch(fetchHistoryBlock, /StaffState\.scheduleHistory/);
        assert.doesNotMatch(fetchHistoryBlock, /renderScheduleHistoryList/);

        assert.match(editingMatchBlock, /Number\(editing\.staffId\) === Number\(staffId\)/);
        assert.match(editingMatchBlock, /String\(editing\.date \|\| ''\) === String\(date \|\| ''\)/);
        assert.match(editingMatchBlock, /editing\.rangeKey === rangeKey/);
        assert.match(loadHistoryBlock, /const seq = \+\+StaffState\.scheduleHistoryLoadSeq/);
        assert.match(loadHistoryBlock, /scheduleCellHistoryAbortController\.abort\(\)/);
        assert.match(loadHistoryBlock, /new AbortController\(\)/);
        assert.match(loadHistoryBlock, /scheduleEditingCellMatches\(numericStaffId, normalizedDate, requestedRangeKey\)/);
        assert.match(loadHistoryBlock, /StaffState\.scheduleHistory\[`\$\{numericStaffId\}_\$\{normalizedDate\}`\] = result\.data/);
        assert.ok(
            loadHistoryBlock.indexOf('seq !== StaffState.scheduleHistoryLoadSeq')
                < loadHistoryBlock.indexOf('StaffState.scheduleHistory[`${numericStaffId}_${normalizedDate}`] = result.data'),
            'history freshness guard must run before the cache and DOM commit'
        );
        assert.match(loadHistoryBlock, /scheduleCellHistoryAbortController === controller/);

        assert.match(loadPreferencesBlock, /requestedDate/);
        assert.match(loadPreferencesBlock, /requestedRangeKey/);
        assert.match(loadPreferencesBlock, /seq !== StaffState\.shiftPreferencesLoadSeq/);
        assert.match(loadPreferencesBlock, /scheduleEditingCellMatches\(numericStaffId, requestedDate, requestedRangeKey\)/);

        assert.match(closeBlock, /StaffState\.scheduleHistoryLoadSeq \+= 1/);
        assert.match(closeBlock, /StaffState\.shiftPreferencesLoadSeq \+= 1/);
        assert.match(closeBlock, /scheduleCellHistoryAbortController\.abort\(\)/);
        assert.match(closeBlock, /StaffState\.editingCell = null/);
        assert.match(closeBlock, /historyPanel\.setAttribute\('aria-busy', 'false'\)/);
        assert.match(closeBlock, /historyPanel\.innerHTML = ''/);
    });

    it('ignores delayed history A after modal B has committed', async () => {
        const { api, elements, pendingFetches } = loadStaffScheduleHistoryBehaviorApi();
        api.resetHistory();
        api.setEditingCell({ staffId: 101, date: '2026-07-06', rangeKey: '2026-07-01:2026-07-15' });
        const requestA = api.loadScheduleCellHistory(101, '2026-07-06');
        assert.equal(pendingFetches.length, 1);
        assert.equal(elements.schHistoryList.getAttribute('aria-busy'), 'true');

        api.setEditingCell({ staffId: 102, date: '2026-07-07', rangeKey: '2026-07-01:2026-07-15' });
        const requestB = api.loadScheduleCellHistory(102, '2026-07-07');
        assert.equal(pendingFetches.length, 2);
        assert.equal(pendingFetches[0].options.signal.aborted, true, 'opening B aborts the older A request');

        pendingFetches[1].respond({
            success: true,
            data: [{ action: 'edit', performed_by: 'HISTORY_B', details: { source: 'HISTORY_B' } }]
        });
        await requestB;
        assert.match(elements.schHistoryList.innerHTML, /HISTORY_B/);
        const afterB = JSON.parse(api.snapshot());
        assert.equal(afterB.scheduleHistory['102_2026-07-07'][0].performed_by, 'HISTORY_B');

        pendingFetches[0].respond({
            success: true,
            data: [{ action: 'edit', performed_by: 'HISTORY_A', details: { source: 'HISTORY_A' } }]
        });
        const staleResult = await requestA;
        assert.equal(staleResult.stale, true);
        assert.match(elements.schHistoryList.innerHTML, /HISTORY_B/);
        assert.doesNotMatch(elements.schHistoryList.innerHTML, /HISTORY_A/);
        const finalState = JSON.parse(api.snapshot());
        assert.equal(finalState.scheduleHistory['101_2026-07-06'], undefined, 'stale A never mutates history cache');
    });

    it('invalidates pending cell history only after the modal actually closes', async () => {
        const { api, elements, pendingFetches } = loadStaffScheduleHistoryBehaviorApi();
        api.resetHistory();
        api.setEditingCell({ staffId: 101, date: '2026-07-06', rangeKey: '2026-07-01:2026-07-15' });
        const pendingHistory = api.loadScheduleCellHistory(101, '2026-07-06');
        assert.equal(pendingFetches.length, 1);

        await api.closeEditModal(true);
        const closedState = JSON.parse(api.snapshot());
        assert.equal(closedState.editingCell, null);
        assert.ok(closedState.scheduleHistoryLoadSeq >= 2);
        assert.ok(closedState.shiftPreferencesLoadSeq >= 1);
        assert.equal(pendingFetches[0].options.signal.aborted, true);
        assert.equal(elements.schModalOverlay.classList.contains('visible'), false);
        assert.equal(elements.schModalOverlay.classList.contains('hidden'), true);
        assert.equal(elements.schHistoryList.getAttribute('aria-busy'), 'false');
        assert.equal(elements.schHistoryList.innerHTML, '');

        pendingFetches[0].respond({
            success: true,
            data: [{ action: 'edit', performed_by: 'CLOSED_HISTORY', details: { source: 'CLOSED_HISTORY' } }]
        });
        const staleResult = await pendingHistory;
        assert.equal(staleResult.stale, true);
        assert.equal(elements.schHistoryList.innerHTML, '');
        assert.deepEqual(JSON.parse(api.snapshot()).scheduleHistory, {});
    });

    it('keeps the newest same-staff shift preferences in cache after a late response', async () => {
        const { api, elements, pendingFetches } = loadStaffScheduleHistoryBehaviorApi();
        api.resetHistory();
        api.setEditingCell({ staffId: 101, date: '2026-07-06', rangeKey: '2026-07-01:2026-07-15' });
        const requestA = api.loadScheduleShiftPreferences(101);
        assert.equal(pendingFetches.length, 1);

        api.setEditingCell({ staffId: 101, date: '2026-07-07', rangeKey: '2026-07-01:2026-07-15' });
        const requestB = api.loadScheduleShiftPreferences(101);
        assert.equal(pendingFetches.length, 2);
        const preferenceB = {
            profession_key: 'manager',
            day_type: 'weekday',
            start_time: '12:00:00',
            end_time: '20:00:00',
            is_active: true
        };
        pendingFetches[1].respond({ success: true, data: [preferenceB] });
        await requestB;
        assert.equal(JSON.parse(api.snapshot()).shiftPreferences['101'][0].start_time, '12:00:00');
        assert.match(elements.schShiftPreferencePanel.innerHTML, /12:00-20:00/);

        const preferenceA = {
            profession_key: 'manager',
            day_type: 'weekday',
            start_time: '08:00:00',
            end_time: '16:00:00',
            is_active: true
        };
        pendingFetches[0].respond({ success: true, data: [preferenceA] });
        await requestA;
        const finalState = JSON.parse(api.snapshot());
        assert.equal(finalState.shiftPreferences['101'][0].start_time, '12:00:00');
        assert.match(elements.schShiftPreferencePanel.innerHTML, /12:00-20:00/);
        assert.doesNotMatch(elements.schShiftPreferencePanel.innerHTML, /08:00-16:00/);
    });

    it('binds schedule mutations and close requests to one current modal session', async () => {
        const sessionCurrentBlock = namedFunctionBlock(staffPage, 'scheduleModalSessionIsCurrent');
        const mutationControlsBlock = namedFunctionBlock(staffPage, 'setScheduleModalMutationControlsDisabled');
        const beginMutationBlock = namedFunctionBlock(staffPage, 'beginScheduleModalMutation');
        const finishMutationBlock = namedFunctionBlock(staffPage, 'finishScheduleModalMutation');
        const openBlock = namedFunctionBlock(staffPage, 'openEditModal');
        const closeBlock = namedFunctionBlock(staffPage, 'closeEditModal');
        const actionBlocks = [
            namedFunctionBlock(staffPage, 'handleSave'),
            namedFunctionBlock(staffPage, 'handleReplaceSchedule'),
            namedFunctionBlock(staffPage, 'handleClearReplacement')
        ];

        assert.match(staffPage, /scheduleModalSessionSeq:\s*0/);
        assert.match(sessionCurrentBlock, /StaffState\.editingCell === session/);
        assert.match(openBlock, /if \(_staffScheduleClosePromise \|\| StaffState\.editingCell\?\.mutationPending\) return/);
        assert.match(openBlock, /sessionId:\s*\+\+StaffState\.scheduleModalSessionSeq/);
        assert.match(openBlock, /mutationPending:\s*false/);
        ['schSaveBtn', 'schReplaceBtn', 'schClearReplacementBtn'].forEach(id => {
            assert.match(mutationControlsBlock, new RegExp(id));
        });
        assert.match(mutationControlsBlock, /button\.disabled = disabled/);
        assert.match(beginMutationBlock, /!scheduleModalSessionIsCurrent\(session\) \|\| session\.mutationPending/);
        assert.match(beginMutationBlock, /session\.mutationPending = true/);
        assert.match(beginMutationBlock, /setScheduleModalMutationControlsDisabled\(true\)/);
        assert.match(finishMutationBlock, /if \(!session\) return/);
        assert.match(finishMutationBlock, /session\.mutationPending = false/);
        assert.match(finishMutationBlock, /!scheduleModalSessionIsCurrent\(session\) && StaffState\.editingCell/);
        assert.match(finishMutationBlock, /setScheduleModalMutationControlsDisabled\(false\)/);
        assert.match(closeBlock, /expectedSession = null/);
        assert.match(closeBlock, /expectedSession && !scheduleModalSessionIsCurrent\(expectedSession\)/);
        assert.match(closeBlock, /closingSession\?\.mutationPending/);
        assert.match(closeBlock, /closingSession && !scheduleModalSessionIsCurrent\(closingSession\)/);

        for (const block of actionBlocks) {
            assert.match(block, /const editingSession = StaffState\.editingCell/);
            assert.match(block, /beginScheduleModalMutation\(editingSession\)/);
            assert.match(block, /scheduleModalSessionIsCurrent\(editingSession\)/);
            assert.match(block, /closeEditModal\(true, editingSession\)/);
            assert.match(block, /finally\s*\{[\s\S]*finishScheduleModalMutation\(editingSession\)/);
        }

        const { api, elements } = loadStaffScheduleHistoryBehaviorApi();
        const sessionA = { staffId: 101, date: '2026-07-06', rangeKey: 'range', sessionId: 1, mutationPending: false };
        const sessionB = { staffId: 102, date: '2026-07-07', rangeKey: 'range', sessionId: 2, mutationPending: false };
        api.setEditingCell(sessionA);
        assert.equal(api.beginScheduleModalMutation(sessionA), true);
        assert.equal(api.beginScheduleModalMutation(sessionA), false, 'same modal mutation is single-flight');
        assert.equal(elements.schSaveBtn.disabled, true);
        assert.equal(elements.schReplaceBtn.disabled, true);
        assert.equal(elements.schClearReplacementBtn.disabled, true);
        assert.equal(elements.schModalOverlay.getAttribute('aria-busy'), 'true');
        api.finishScheduleModalMutation(sessionA);
        assert.equal(elements.schSaveBtn.disabled, false);
        assert.equal(elements.schModalOverlay.getAttribute('aria-busy'), 'false');

        api.setEditingCell(sessionA);
        assert.equal(api.beginScheduleModalMutation(sessionA), true);
        assert.equal(elements.schSaveBtn.disabled, true);
        await api.closeEditModal(true, sessionA);
        assert.equal(JSON.parse(api.snapshot()).editingCell, null, 'successful close clears the finished modal session');
        api.finishScheduleModalMutation(sessionA);
        assert.equal(sessionA.mutationPending, false, 'closed session is no longer mutation-pending');
        assert.equal(elements.schSaveBtn.disabled, false, 'finished closed session re-enables the next modal save button');
        assert.equal(elements.schModalOverlay.getAttribute('aria-busy'), 'false');

        api.setEditingCell(sessionA);
        assert.equal(api.beginScheduleModalMutation(sessionA), true);
        elements.schModalOverlay.classList.add('visible');
        api.setEditingCell(sessionB);
        api.finishScheduleModalMutation(sessionA);
        assert.equal(sessionA.mutationPending, false, 'stale session completes internally');
        assert.equal(elements.schSaveBtn.disabled, true, 'stale session cannot re-enable controls for the active modal');
        assert.equal(await api.closeEditModal(true, sessionA), false, 'stale A cannot close current B');
        assert.equal(JSON.parse(api.snapshot()).editingCell.sessionId, 2);
        assert.equal(elements.schModalOverlay.classList.contains('visible'), true);
    });

    it('keeps one focus trap when the same modal is opened twice', () => {
        const openModalBlock = namedFunctionBlock(uiPage, 'openModal');
        const closeModalBlock = namedFunctionBlock(uiPage, 'closeModal');
        assert.match(openModalBlock, /existingState\.modal !== modalEl/);
        assert.match(openModalBlock, /removeEventListener\('keydown', existingState\.handler\)/);
        assert.match(openModalBlock, /_focusTrapStack\.splice\(index, 1\)/);
        assert.match(openModalBlock, /trapState\.handler/);
        assert.match(closeModalBlock, /for \(let index = _focusTrapStack\.length - 1; index >= 0; index -= 1\)/);
        assert.match(closeModalBlock, /_focusTrapStack\[index\]\.modal === modalEl/);

        const api = loadModalLifecycleBehaviorApi();
        const modal = createFakeModalElement();
        const triggerA = { isConnected: true, focus() {} };
        const triggerB = { isConnected: true, focus() {} };
        const options = {
            show: element => {
                element.classList.remove('hidden');
                element.classList.add('visible');
            },
            hide: element => {
                element.classList.remove('visible');
                element.classList.add('hidden');
            }
        };
        api.openModal(modal, triggerA, options);
        api.openModal(modal, triggerB, options);
        assert.equal(api.stackDepth(), 1);
        assert.equal(api.matchingStackDepth(modal), 1);
        assert.equal(modal.listenerCount('keydown'), 1);
        api.closeModal(modal, { force: true });
        assert.equal(api.stackDepth(), 0);
        assert.equal(modal.listenerCount('keydown'), 0);
        assert.equal(modal.classList.contains('visible'), false);
        assert.equal(modal.classList.contains('hidden'), true);
    });

    it('keeps the schedule shift modal viewport-safe and dark-theme readable', () => {
        const modalStart = staffScheduleShell.indexOf('id="schModalOverlay"');
        const fillStart = staffScheduleShell.indexOf('id="fillWeekOverlay"');
        const scheduleModal = staffScheduleShell.slice(modalStart, fillStart);
        const modalCssBlock = staffCss.slice(
            staffCss.indexOf('/* Edit modal */'),
            staffCss.indexOf('/* Dark mode overrides */')
        );
        const darkModalCssBlock = staffCss.slice(
            staffCss.indexOf('body.dark-mode #schModalOverlay .sch-modal--schedule select,'),
            staffCss.indexOf('/* Extracted from staff.html presentation-only inline attrs. */')
        );

        assert.ok(modalStart > -1 && fillStart > modalStart, 'schedule modal shell is present before fill modal');
        assert.ok(modalCssBlock.length > 0, 'schedule modal layout CSS block is present');
        assert.ok(darkModalCssBlock.length > 0, 'schedule modal dark-theme CSS block is present');
        assert.match(scheduleModal, /class="sch-modal sch-modal--schedule"/);
        assert.match(scheduleModal, /class="sch-modal-scroll"/);
        assert.match(scheduleModal, /id="schShiftPreferencePanel"/);
        assert.match(scheduleModal, /class="modal-actions sch-primary-actions"/);
        assert.ok(scheduleModal.indexOf('class="sch-modal-scroll"') < scheduleModal.indexOf('class="modal-actions sch-primary-actions"'));

        assert.match(modalCssBlock, /\.sch-modal-overlay\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain;[\s\S]*\}/);
        assert.match(modalCssBlock, /\.sch-modal\s*\{[\s\S]*max-height:\s*calc\(100dvh - 32px\);[\s\S]*overflow-y:\s*auto;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-modal--schedule\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-modal-scroll\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-primary-actions\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*border-top:\s*1px solid rgba\(148, 163, 184, 0\.22\);[\s\S]*background:\s*inherit;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-primary-actions > button\s*\{[\s\S]*min-height:\s*44px;[\s\S]*\}/);
        assert.match(modalCssBlock, /\.sch-shift-preferences\s*\{/);
        assert.match(modalCssBlock, /\.sch-shift-preference-options\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*\}/);
        assert.match(modalCssBlock, /\.sch-shift-preference-option\.is-recommended/);
        assert.match(staffCss, /#schModalOverlay \.sch-history-list\s*\{[\s\S]*max-height:\s*min\(190px, 28dvh\);[\s\S]*\}/);

        assert.match(darkModalCssBlock, /body\.dark-mode #schModalOverlay \.sch-modal--schedule select/);
        assert.match(darkModalCssBlock, /\[data-theme="dark"\] #schModalOverlay \.sch-modal--schedule input/);
        assert.match(darkModalCssBlock, /color-scheme:\s*dark;/);
        assert.match(darkModalCssBlock, /background-color:\s*#0B1220;/);
        assert.match(darkModalCssBlock, /color:\s*#F8FAFC;/);
        assert.match(darkModalCssBlock, /background-position:\s*[\s\S]*calc\(100% - 25px\) 50%,[\s\S]*calc\(100% - 17px\) 50%;/);
        assert.match(darkModalCssBlock, /background-size:\s*8px 8px,\s*8px 8px;/);
        assert.match(darkModalCssBlock, /background-repeat:\s*no-repeat;/);
        assert.match(darkModalCssBlock, /padding-right:\s*52px;/);
        assert.match(darkModalCssBlock, /input\[type="time"\][\s\S]*background-image:\s*url\("data:image\/svg\+xml/);
        assert.match(darkModalCssBlock, /input\[type="time"\][\s\S]*background-position:\s*calc\(100% - 18px\) 50%;/);
        assert.match(darkModalCssBlock, /input\[type="time"\][\s\S]*background-size:\s*20px 20px;/);
        assert.match(darkModalCssBlock, /select option,\s*[\s\S]*select optgroup/);
        assert.match(darkModalCssBlock, /select option:checked/);
        assert.match(darkModalCssBlock, /select:disabled/);
        assert.match(darkModalCssBlock, /input:disabled/);
        assert.match(darkModalCssBlock, /input::placeholder/);
        assert.match(darkModalCssBlock, /input\[type="time"\]::-webkit-calendar-picker-indicator/);
        assert.match(darkModalCssBlock, /input\[type="time"\]::-webkit-calendar-picker-indicator,[\s\S]*opacity:\s*0;/);
        assert.match(darkModalCssBlock, /body\.dark-mode #schModalOverlay \.sch-shift-preferences/);
        assert.match(darkModalCssBlock, /body\.dark-mode #schModalOverlay \.sch-shift-preference-option\.is-recommended/);
        assert.doesNotMatch(darkModalCssBlock, /!important/);
    });

    it('uses the canonical modal lifecycle and does not double-handle schedule Escape', () => {
        const openBlock = namedFunctionBlock(staffPage, 'openEditModal');
        const closeBlock = namedFunctionBlock(staffPage, 'closeEditModal');
        const initBlock = namedFunctionBlock(staffPage, 'initStaffSchedulePage');
        const escapeListener = initBlock.match(
            /document\.addEventListener\('keydown', \(e\) => \{[\s\S]*?\n        \}\);/
        )?.[0] || '';

        assert.match(openBlock, /openModal\(overlay, trigger, \{/);
        assert.match(openBlock, /onRequestClose:\s*\(\) => closeEditModal\(false\)/);
        assert.match(openBlock, /restoreFocus:\s*\(\) => scheduleCellFocusTarget\(staffId, date, trigger, sectionDepartment\)/);
        assert.ok(
            openBlock.indexOf('openModal(overlay, trigger') < openBlock.indexOf('loadScheduleCellHistory(staffId, date)'),
            'the modal is registered and shown before its async panels start loading'
        );
        assert.match(closeBlock, /closeModal\(overlay, \{ force: true \}\)/);
        assert.match(closeBlock, /if \(_staffScheduleClosePromise\) return _staffScheduleClosePromise/);
        assert.ok(escapeListener, 'staff schedule retains the legacy Escape listener for its non-canonical overlays');
        assert.doesNotMatch(escapeListener, /closeEditModal|schModalOverlay/);
        assert.match(escapeListener, /fillWeekOverlay/);
    });

    it('keeps schedule semantics zoom-safe and stacks date controls at 340px', () => {
        const viewportTag = staffHtml.match(/<meta\s+name="viewport"[^>]*>/i)?.[0] || '';
        const renderBlock = namedFunctionBlock(staffPage, 'renderSchedule');
        const loadViewBlock = namedFunctionBlock(staffPage, 'renderLoadView');
        const workbookBlock = namedFunctionBlock(staffPage, 'buildScheduleWorkbookHtml');
        const narrowStart = staffCss.indexOf('@media (max-width: 340px)');
        const narrowEnd = staffCss.indexOf('/* Print styles */', narrowStart);
        const narrowBlock = narrowStart >= 0 && narrowEnd > narrowStart
            ? staffCss.slice(narrowStart, narrowEnd)
            : '';

        assert.match(viewportTag, /width=device-width/);
        assert.match(viewportTag, /initial-scale=1(?:\.0)?/);
        assert.doesNotMatch(viewportTag, /maximum-scale|minimum-scale|user-scalable/i);

        assert.match(staffScheduleShell, /id="prevWeekBtn"[^>]*aria-label=/);
        assert.match(staffScheduleShell, /id="nextWeekBtn"[^>]*aria-label=/);
        assert.match(staffScheduleShell, /<label class="staff-schedule-date-field">[\s\S]*?id="scheduleDateFrom"[\s\S]*?<\/label>/);
        assert.match(staffScheduleShell, /<label class="staff-schedule-date-field">[\s\S]*?id="scheduleDateTo"[\s\S]*?<\/label>/);
        assert.match(staffScheduleShell, /id="scheduleStaffSearch"[^>]*aria-label=/);
        assert.match(staffScheduleShell, /id="schModalOverlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="schModalTitle"/);
        assert.match(staffScheduleShell, /class="sch-history-panel"[^>]*role="region"[^>]*aria-labelledby="schHistoryTitle"/);
        assert.match(staffScheduleShell, /id="schHistoryList"[^>]*aria-live="polite"[^>]*aria-busy="false"/);
        assert.equal(
            (staffScheduleShell.match(/<caption class="staff-schedule-table-caption">/g) || []).length,
            2,
            'both schedule tables expose a caption'
        );
        assert.match(staffCss, /\.staff-schedule-table-caption\s*\{[\s\S]*position:\s*absolute;[\s\S]*clip-path:\s*inset\(50%\);/);

        assert.match(renderBlock, /<tr><th scope="col">/);
        assert.match(renderBlock, /<th scope="col" class=/);
        assert.match(loadViewBlock, /<tr><th scope="col">/);
        assert.match(loadViewBlock, /<th scope="col" class=/);
        assert.match(workbookBlock, /<th scope="col" class="date-col">/);
        ['Відділ', 'Підгрупа', 'Співробітник', 'Посада'].forEach(label => {
            assert.match(workbookBlock, new RegExp(`<th scope="col">${label}<\\/th>`));
        });

        assert.ok(narrowBlock, 'missing <=340px staff schedule override');
        assert.match(narrowBlock, /staff-schedule-range-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
        assert.match(narrowBlock, /staff-schedule-range-apply,[\s\S]*staff-schedule-range-presets\s*\{[\s\S]*grid-column:\s*1/);
    });

    it('loads staff shift preferences into the active segment and saves the normalized day plan', () => {
        assert.match(staffPage, /shiftPreferences:\s*\{\}/);
        assert.match(staffPage, /function fetchScheduleShiftPreferences/);
        assert.match(staffPage, /function renderScheduleShiftPreferencePanel/);
        assert.match(staffPage, /function applyScheduleShiftPreference/);
        assert.match(staffPage, /weekday:\s*'ПН-ПТ'/);
        assert.match(staffPage, /weekend:\s*'СБ-НД'/);
        assert.match(staffPage, /function setScheduleShiftPreferenceActiveDay/);
        assert.match(staffPage, /setScheduleShiftPreferenceActiveDay\(normalized\.dayType\)/);
        assert.match(staffPage, /button\.classList\.toggle\('is-recommended', isActive\)/);
        assert.match(staffPage, /button\.setAttribute\('aria-pressed', isActive \? 'true' : 'false'\)/);
        assert.match(staffPage, /aria-pressed="\$\{row\.dayType === activeDayType \? 'true' : 'false'\}"/);
        assert.match(staffPage, /\/api\/staff\/\$\{encodeURIComponent\(numericStaffId\)\}\/shift-preferences/);
        assert.match(staffPage, /renderScheduleShiftPreferencePanel\(preferences, \{ autoApply: 'force' \}\)/);
        assert.match(staffPage, /loadScheduleShiftPreferences\(staffId, \{/);
        assert.match(staffPage, /autoApply: \(!entry\?\.shift_start && !entry\?\.shift_end\) \? 'missing-only' : false/);
        assert.match(staffPage, /getActiveScheduleSegmentCard\(\)\?\.querySelector\('\[data-segment-field="profession"\]'\)/);
        assert.match(staffPage, /saveScheduleEntry\(staffId, date, shiftStart, shiftEnd, status, note, professionKey, \{/);
        assert.match(staffPage, /segments:\s*validation\.segments\.map/);
    });

    it('keeps shift load classes as metadata without painting schedule cells', () => {
        assert.match(staffPage, /const STAFF_FULL_SHIFT_MINUTES = 8 \* 60/);
        assert.match(staffPage, /const STAFF_WEEKEND_FULL_SHIFT_MINUTES = 10 \* 60/);
        assert.match(staffPage, /function scheduleShiftLoadFullShiftMinutes/);
        assert.match(staffPage, /scheduleShiftLoadDate\(entry\.date \|\| entry\.shift_date \|\| entry\.schedule_date\)/);
        assert.match(staffPage, /function scheduleShiftLoadMeta/);
        assert.match(staffPage, /scheduleShiftLoadFullShiftMinutes\(entry\)/);
        assert.match(staffPage, /bucket = 'half'/);
        assert.match(staffPage, /bucket = 'three-quarter'/);
        assert.match(staffPage, /bucket = 'long'/);
        assert.match(staffPage, /className: `shift-load-\$\{bucket\}`/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}/);
        assert.match(staffPage, /data-shift-load="\$\{loadMeta\.bucket \|\| ''\}"/);
        assert.match(staffPage, /scheduleShiftLoadMeta\(\{ \.\.\.entry, date, shift_start: shiftStart, shift_end: shiftEnd \}\)/);
        assert.match(staffPage, /scheduleShiftLoadMeta\(\{ \.\.\.entry, status, date \}\)/);
        assert.match(staffPage, /scheduleShiftLoadMeta\(\{ \.\.\.entry, status, date: ds, shift_start: shiftStart, shift_end: shiftEnd \}\)/);
        assert.doesNotMatch(staffPage, /class="sch-load-badge"/);
        assert.match(staffCss, /\.sch-cell \.sch-load-badge/);
        assert.match(staffCss, /display: none !important/);
        assert.match(staffCss, /\.sch-cell\[class\*="shift-load-"\]\s*\{/);
        assert.match(staffCss, /\.sch-cell\[class\*="shift-load-"\]::after\s*\{[\s\S]*content:\s*none;[\s\S]*display:\s*none;/);
        assert.doesNotMatch(staffCss, /--sch-load-(?:accent|border|bg|bg-soft|marker)/);
        assert.doesNotMatch(staffCss, /inset 0 -5px 0 var\(--sch-load-accent\)/);
        assert.doesNotMatch(staffCss, /\.sch-cell\.shift-load-(?:quarter|half|three-quarter|long|extra-long)[^{]*\{[\s\S]*background:/);
        assert.doesNotMatch(staffCss, /\.sch-cell\.shift-load-(?:quarter|half|three-quarter|long|extra-long) \.sch-time/);
        assert.doesNotMatch(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-/);
        assert.doesNotMatch(staffCss, /\[data-theme="dark"\] body\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-/);
    });
});
