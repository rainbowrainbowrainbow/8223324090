'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    FONT_PRESET,
    buildHrAttendanceDocumentSnapshot,
    buildHrAttendanceDocumentSnapshotFromRows,
    normalizeDocumentRequest
} = require('../services/hrAttendanceDocuments');
const {
    DAILY_LAYOUT,
    MONTH_LAYOUT,
    buildHrAttendanceDocumentPdfBuffer,
    hrAttendanceDocumentPdfFilename,
    paginateHrAttendanceDocument
} = require('../services/hrAttendanceDocumentsPdf');
const { isPublicApiRequest } = require('../middleware/apiAuthBoundary');
const {
    REFERENCE_COUNTS,
    referenceRequest: request,
    referenceSnapshot
} = require('./fixtures/hrAttendanceDocumentsV27');

function pdfPageCount(buffer) {
    return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

function fontPresetAt(boundary) {
    return Object.fromEntries(Object.entries(FONT_PRESET).map(([key, contract]) => [key, contract[boundary]]));
}

function mm(points) {
    return points * 25.4 / 72;
}

test('request contract accepts settings only and rejects employee or attendance payloads', () => {
    const normalized = normalizeDocumentRequest(request('arrival_inout', {
        categoryIds: ['waiter', 'waiter', 'trampoline'],
        locationShift: '  Основна   зміна  '
    }));
    assert.deepEqual(normalized.categoryIds, ['waiter', 'trampoline']);
    assert.equal(normalized.locationShift, 'Основна зміна');
    assert.equal(normalized.texts.title, 'Лист приходу / уходу працівників');
    assert.equal(Object.isFrozen(normalized), true);
    assert.throws(
        () => normalizeDocumentRequest({ ...request('arrival_inout'), employees: [{ name: 'Injected' }] }),
        /заборонені або невідомі поля/
    );
    assert.throws(
        () => normalizeDocumentRequest({ ...request('arrival_inout'), clockIn: '09:00' }),
        /заборонені або невідомі поля/
    );
});

test('anonymized 41-person snapshot is immutable, deduplicated and preserves v27 category counts', () => {
    const snapshot = referenceSnapshot('arrival_inout');
    assert.equal(snapshot.employeeCount, 41);
    assert.equal(snapshot.categoryCount, 18);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.categories[0].employees), true);
    assert.deepEqual(
        Object.fromEntries(snapshot.categories.map(item => [item.id, item.count])),
        REFERENCE_COUNTS
    );
});

test('one physical person assigned to two selected professions is printed once', () => {
    const settings = normalizeDocumentRequest(request('arrival_inout', {
        categoryIds: ['animator', 'waiter']
    }));
    const staffRows = [
        {
            id: 1,
            name: 'Працівник Один',
            role_type: 'waiter',
            secondary_professions: [],
            position: 'Офіціант',
            unique_person_key: 'person-one',
            user_id: 77
        },
        {
            id: 2,
            name: 'Працівник Один дубль',
            role_type: 'animator',
            secondary_professions: [],
            position: 'Аніматор',
            unique_person_key: 'person-one.mgr',
            user_id: 77
        }
    ];
    const snapshot = buildHrAttendanceDocumentSnapshotFromRows(settings, { staffRows, assignmentRows: [] }, {
        now: new Date('2026-07-16T12:00:00.000Z')
    });
    assert.equal(snapshot.employeeCount, 1);
    assert.equal(snapshot.categories.length, 1);
    assert.equal(snapshot.categories[0].id, 'waiter', 'legacy primary profession owns the single printed row');
    assert.deepEqual(snapshot.categories[0].employees[0].staffIds, [1, 2]);
});

test('roster selection excludes inactive, freelance, non-core and terminated staff while preserving secondary and assigned professions', () => {
    const settings = normalizeDocumentRequest(request('arrival_inout', {
        categoryIds: ['waiter', 'animator', 'cook']
    }));
    const base = {
        display_name: null,
        secondary_professions: [],
        position: '',
        excel_department: '',
        is_active: true,
        hr_pool_status: 'core',
        is_freelance: false,
        termination_date: null,
        user_id: null
    };
    const staffRows = [
        { ...base, id: 1, name: 'Eligible waiter', role_type: 'waiter', unique_person_key: 'eligible-waiter' },
        { ...base, id: 2, name: 'Inactive waiter', role_type: 'waiter', unique_person_key: 'inactive', is_active: false },
        { ...base, id: 3, name: 'Freelance waiter', role_type: 'waiter', unique_person_key: 'freelance', is_freelance: true },
        { ...base, id: 4, name: 'Terminated today', role_type: 'waiter', unique_person_key: 'terminated-today', termination_date: '2026-07-16' },
        { ...base, id: 5, name: 'Terminates tomorrow', role_type: 'waiter', unique_person_key: 'terminates-tomorrow', termination_date: '2026-07-17' },
        { ...base, id: 6, name: 'Reserve waiter', role_type: 'waiter', unique_person_key: 'reserve', hr_pool_status: 'reserve' },
        { ...base, id: 7, name: 'Secondary waiter', role_type: 'cook', secondary_professions: ['waiter'], unique_person_key: 'secondary-waiter' },
        { ...base, id: 8, name: 'Assigned waiter', role_type: 'animator', unique_person_key: 'assigned-waiter' }
    ];
    const assignmentRows = [
        { staff_id: 8, profession_key: 'cook', is_primary: false, status: 'active', admission_status: 'approved' },
        { staff_id: 8, profession_key: 'waiter', is_primary: true, status: 'active', admission_status: 'approved' }
    ];
    const snapshot = buildHrAttendanceDocumentSnapshotFromRows(settings, { staffRows, assignmentRows });
    assert.equal(snapshot.employeeCount, 4);
    assert.deepEqual(
        Object.fromEntries(snapshot.categories.map(category => [category.id, category.employees.map(employee => employee.staffIds[0])])),
        { cook: [7], waiter: [8, 1, 5] }
    );
    assert.equal(snapshot.categories.flatMap(category => category.employees).filter(employee => employee.staffIds[0] === 8).length, 1);
});

test('actual-time mode prefers canonical attendance, formats Kyiv time and keeps missing values blank', () => {
    const settings = normalizeDocumentRequest(request('arrival_inout', {
        categoryIds: ['waiter'],
        dailyMode: 'actual_times'
    }));
    const staffRows = [{
        id: 11,
        name: 'Працівник Час',
        role_type: 'waiter',
        secondary_professions: [],
        position: 'Офіціант',
        unique_person_key: 'time-person',
        user_id: null
    }];
    const snapshot = buildHrAttendanceDocumentSnapshotFromRows(settings, {
        staffRows,
        assignmentRows: [],
        attendanceRows: [{ staff_id: 11, clock_in: '2026-07-16T06:05:00.000Z', clock_out: null }],
        legacyAttendanceRows: [{ staff_id: 11, check_in: '2026-07-16T07:00:00.000Z', check_out: '2026-07-16T16:00:00.000Z' }]
    }, { now: new Date('2026-07-16T12:00:00.000Z') });
    const attendance = snapshot.categories[0].employees[0].attendance;
    assert.deepEqual(attendance, { clockIn: '09:05', clockOut: null, source: 'hr_time_records' });
});

test('database snapshot loader enforces canonical eligibility and server-owned attendance queries', async () => {
    const queries = [];
    const db = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (sql.includes('FROM staff\n')) {
                return { rows: [{
                    id: 51,
                    name: 'Працівник Сервер',
                    display_name: null,
                    role_type: 'waiter',
                    secondary_professions: [],
                    position: 'Офіціант',
                    excel_department: 'Офіціант',
                    unique_person_key: 'server-person',
                    user_id: null
                }] };
            }
            if (sql.includes('FROM staff_role_assignments')) return { rows: [] };
            if (sql.includes('FROM hr_time_records')) {
                return { rows: [{ staff_id: 51, clock_in: '2026-07-16T06:15:00.000Z', clock_out: null }] };
            }
            if (sql.includes('FROM staff_checkins')) return { rows: [] };
            throw new Error(`Unexpected query: ${sql}`);
        }
    };
    const snapshot = await buildHrAttendanceDocumentSnapshot(db, request('arrival_inout', {
        categoryIds: ['waiter'],
        dailyMode: 'actual_times'
    }), { now: new Date('2026-07-16T12:00:00.000Z') });
    assert.equal(snapshot.categories[0].employees[0].attendance.clockIn, '09:15');
    assert.equal(queries.length, 4);
    assert.match(queries[0].sql, /staff\.is_active = true/);
    assert.match(queries[0].sql, /hr_pool_status, 'core'/);
    assert.match(queries[0].sql, /is_freelance/);
    assert.match(queries[1].sql, /status = 'active'/);
    assert.match(queries[1].sql, /admission_status = 'approved'/);
    assert.match(queries[3].sql, /AT TIME ZONE 'Europe\/Kyiv'/);
});

test('scheduled roster filters inclusion but never supplies actual time', () => {
    const settings = normalizeDocumentRequest(request('arrival_inout', {
        categoryIds: ['waiter'],
        rosterMode: 'scheduled_on_date',
        dailyMode: 'manual_blank'
    }));
    const staffRows = [11, 12].map(id => ({
        id,
        name: `Працівник ${id}`,
        role_type: 'waiter',
        secondary_professions: [],
        position: 'Офіціант',
        unique_person_key: `scheduled-${id}`,
        user_id: null
    }));
    const snapshot = buildHrAttendanceDocumentSnapshotFromRows(settings, {
        staffRows,
        assignmentRows: [],
        shiftRows: [{ staff_id: 12, planned_start: '09:00', planned_end: '18:00' }]
    }, { now: new Date('2026-07-16T12:00:00.000Z') });
    assert.equal(snapshot.employeeCount, 1);
    assert.equal(snapshot.categories[0].employees[0].staffIds[0], 12);
    assert.deepEqual(snapshot.categories[0].employees[0].attendance, {
        clockIn: null,
        clockOut: null,
        source: null
    });
});

test('conflicting canonical attendance across duplicate records blocks actual-time generation', () => {
    const settings = normalizeDocumentRequest(request('arrival_inout', {
        categoryIds: ['waiter'],
        dailyMode: 'actual_times'
    }));
    const staffRows = [21, 22].map(id => ({
        id,
        name: 'Працівник Конфлікт',
        role_type: 'waiter',
        secondary_professions: [],
        position: 'Офіціант',
        unique_person_key: id === 21 ? 'conflict' : 'conflict.mgr',
        user_id: null
    }));
    assert.throws(
        () => buildHrAttendanceDocumentSnapshotFromRows(settings, {
            staffRows,
            assignmentRows: [],
            attendanceRows: [
                { staff_id: 21, clock_in: '2026-07-16T06:00:00.000Z', clock_out: null },
                { staff_id: 22, clock_in: '2026-07-16T07:00:00.000Z', clock_out: null }
            ]
        }),
        error => error.code === 'HR_ATTENDANCE_DOCUMENT_ATTENDANCE_CONFLICT'
    );
});

test('v27 pagination produces two portrait and three landscape pages', () => {
    const dailyPages = paginateHrAttendanceDocument(referenceSnapshot('arrival_inout'));
    const monthPages = paginateHrAttendanceDocument(referenceSnapshot('month_grid'));
    assert.equal(dailyPages.length, 2);
    assert.equal(monthPages.length, 3);
    assert.equal(dailyPages[0].segments.at(-1).category.id, 'tech_director');
    assert.equal(dailyPages[1].segments[0].category.id, 'hr');
    assert.deepEqual(monthPages.map(page => page.lane), [1, 2, 3]);
});

test('layout model preserves A4 orientation, v27 geometry and page capacity', () => {
    assert.equal(DAILY_LAYOUT.pageLayout, 'portrait');
    assert.equal(MONTH_LAYOUT.pageLayout, 'landscape');
    assert.ok(Math.abs(mm(DAILY_LAYOUT.margin) - 4.7) < 0.001);
    assert.ok(Math.abs(mm(DAILY_LAYOUT.topMargin) - 3) < 0.001);
    assert.ok(Math.abs(mm(DAILY_LAYOUT.headerHeight) - 7.4) < 0.001);
    assert.ok(Math.abs(mm(DAILY_LAYOUT.employeeHeight) - 10.9) < 0.001);
    assert.ok(Math.abs(mm(DAILY_LAYOUT.timeBoxWidth) - 11.3) < 0.001);
    assert.ok(Math.abs(mm(MONTH_LAYOUT.nameWidth) - 59.8) < 0.001);
    assert.ok(Math.abs(mm(MONTH_LAYOUT.employeeHeight) - 7.3) < 0.001);
    assert.ok(Math.abs(mm(MONTH_LAYOUT.markSquare) - 4.7) < 0.001);
    const monthDayWidthMm = (297 - (2 * 4.7) - 59.8) / 31;
    assert.ok(Math.abs(monthDayWidthMm - 7.35) <= 0.01);

    const dailyCapacity = 841.89 - DAILY_LAYOUT.footerSafe
        - DAILY_LAYOUT.topMargin - DAILY_LAYOUT.headerHeight - DAILY_LAYOUT.headerGap
        - DAILY_LAYOUT.metaHeight - DAILY_LAYOUT.bodyGap;
    const monthlyCapacity = 595.28 - MONTH_LAYOUT.footerSafe
        - MONTH_LAYOUT.topMargin - MONTH_LAYOUT.headerHeight - MONTH_LAYOUT.headerGap
        - MONTH_LAYOUT.metaHeight - (2 * MONTH_LAYOUT.blockGap) - MONTH_LAYOUT.legendHeight
        - MONTH_LAYOUT.tableHeaderHeight;
    paginateHrAttendanceDocument(referenceSnapshot('arrival_inout'))
        .forEach(page => assert.ok(page.usedHeight <= dailyCapacity + 0.01));
    paginateHrAttendanceDocument(referenceSnapshot('month_grid'))
        .forEach(page => assert.ok(page.usedHeight <= monthlyCapacity + 0.01));
});

test('large category is split deterministically with continuation header', () => {
    const snapshot = referenceSnapshot('arrival_inout', { categoryIds: ['waiter'] });
    const category = { ...snapshot.categories[0] };
    category.employees = Array.from({ length: 30 }, (_, index) => ({
        ...snapshot.categories[0].employees[index % snapshot.categories[0].employees.length],
        name: `Працівник Великої Категорії ${index + 1}`
    }));
    category.count = category.employees.length;
    const pages = paginateHrAttendanceDocument({ ...snapshot, categories: [category] });
    assert.equal(pages.length, 2);
    assert.equal(pages[0].segments[0].continued, false);
    assert.equal(pages[1].segments[0].continued, true);
    assert.equal(pages.flatMap(page => page.segments[0].employees).length, 30);
});

test('PDFKit renderer creates real v27 PDFs with expected page counts and filenames', async () => {
    const daily = referenceSnapshot('arrival_inout');
    const monthly = referenceSnapshot('month_grid');
    const [dailyBuffer, monthlyBuffer] = await Promise.all([
        buildHrAttendanceDocumentPdfBuffer(daily),
        buildHrAttendanceDocumentPdfBuffer(monthly)
    ]);
    assert.equal(dailyBuffer.subarray(0, 4).toString('ascii'), '%PDF');
    assert.equal(monthlyBuffer.subarray(0, 4).toString('ascii'), '%PDF');
    assert.equal(pdfPageCount(dailyBuffer), 2);
    assert.equal(pdfPageCount(monthlyBuffer), 3);
    assert.equal(hrAttendanceDocumentPdfFilename(daily), 'arrival_inout_2026-07-16.pdf');
    assert.equal(hrAttendanceDocumentPdfFilename(monthly), 'month_grid_2026-07.pdf');
    const deterministicRepeat = await buildHrAttendanceDocumentPdfBuffer(daily);
    assert.deepEqual(deterministicRepeat, dailyBuffer, 'same immutable snapshot must produce byte-identical PDF');
});

test('minimum and maximum allowed font presets render without clipping or page-count drift', async () => {
    for (const boundary of ['min', 'max']) {
        const [daily, monthly] = await Promise.all([
            buildHrAttendanceDocumentPdfBuffer(referenceSnapshot('arrival_inout', { fontPreset: fontPresetAt(boundary) })),
            buildHrAttendanceDocumentPdfBuffer(referenceSnapshot('month_grid', { fontPreset: fontPresetAt(boundary) }))
        ]);
        assert.equal(pdfPageCount(daily), 2, `${boundary} daily font preset page count`);
        assert.equal(pdfPageCount(monthly), 3, `${boundary} monthly font preset page count`);
        assert.match(daily.toString('latin1'), /\/MediaBox\s*\[0 0 595\.28 841\.89\]/);
        assert.match(monthly.toString('latin1'), /\/MediaBox\s*\[0 0 841\.89 595\.28\]/);
    }
});

test('short-month snapshot keeps 31-column geometry metadata and long names fail preflight', async () => {
    const february = referenceSnapshot('month_grid', { month: '2026-02' });
    assert.equal(february.daysInMonth, 28);

    const settings = normalizeDocumentRequest(request('month_grid', {
        month: '2026-02',
        categoryIds: ['waiter']
    }));
    const longNameSnapshot = buildHrAttendanceDocumentSnapshotFromRows(settings, {
        staffRows: [{
            id: 91,
            name: 'Ш'.repeat(200),
            role_type: 'waiter',
            secondary_professions: [],
            position: 'Офіціант',
            unique_person_key: 'long-name',
            user_id: null
        }],
        assignmentRows: []
    }, { now: new Date('2026-07-16T12:00:00.000Z') });
    await assert.rejects(
        buildHrAttendanceDocumentPdfBuffer(longNameSnapshot),
        error => error.code === 'HR_ATTENDANCE_DOCUMENT_TEXT_OVERFLOW'
    );
});

test('HR route keeps the endpoint under existing view-role middleware and private no-store headers', () => {
    assert.equal(isPublicApiRequest({ method: 'POST', path: '/hr/attendance-documents/pdf' }), false);
    const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hr.js'), 'utf8');
    const middlewareIndex = routeSource.indexOf('router.use(requireRole(...HR_VIEW_ROLES))');
    const endpointIndex = routeSource.indexOf("router.post('/attendance-documents/pdf'");
    assert.ok(middlewareIndex >= 0 && endpointIndex > middlewareIndex);
    const endpointBlock = routeSource.slice(endpointIndex, endpointIndex + 2200);
    assert.match(endpointBlock, /buildHrAttendanceDocumentSnapshot\(pool, req\.body \|\| \{\}\)/);
    assert.match(endpointBlock, /'Cache-Control': 'no-store, private, max-age=0'/);
    assert.match(endpointBlock, /'X-Content-Type-Options': 'nosniff'/);
    assert.doesNotMatch(endpointBlock, /log\.(?:info|debug).*snapshot/);
});

test('HR Pulse browser smoke covers private preview, keyboard and mobile print flow', () => {
    const smokeSource = fs.readFileSync(path.join(__dirname, 'browser', 'hr-pulse-browser-smoke.js'), 'utf8');
    assert.match(smokeSource, /async function assertHrPrintDocuments\(page\)/);
    assert.match(smokeSource, /\/api\/hr\/attendance-documents\/pdf/);
    assert.match(smokeSource, /payload\.dailyMode, 'manual_blank'/);
    assert.match(smokeSource, /Object\.hasOwn\(payload, 'employees'\), false/);
    assert.match(smokeSource, /page\.keyboard\.press\('Escape'\)/);
    assert.match(smokeSource, /mobile print dialog fits viewport/);
});
