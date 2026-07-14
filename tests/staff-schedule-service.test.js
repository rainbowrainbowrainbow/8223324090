'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    normalizeScheduleDate,
    scheduleDateSequence,
    validateScheduleBulkEntries,
    validateScheduleMutationTimes
} = require('../services/staffScheduleMutations');
const {
    loadStaffScheduleabilityCards,
    validateStaffScheduleabilityCardForDate,
    validateStaffScheduleableForDate
} = require('../services/staffOperationalFilters');

function serviceSource(file) {
    return fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
}

test('canonical schedule dates preserve PostgreSQL calendar days in Europe/Kyiv', () => {
    const servicePath = require.resolve('../services/staffScheduleMutations');
    const output = execFileSync(process.execPath, ['-e', `
        const { normalizeScheduleDate } = require(${JSON.stringify(servicePath)});
        const summer = new Date(2026, 6, 14);
        const winter = new Date(2026, 0, 15);
        process.stdout.write(JSON.stringify({
            summerIso: summer.toISOString().slice(0, 10),
            summerDate: normalizeScheduleDate(summer),
            winterIso: winter.toISOString().slice(0, 10),
            winterDate: normalizeScheduleDate(winter)
        }));
    `], {
        encoding: 'utf8',
        env: { ...process.env, TZ: 'Europe/Kyiv' }
    });
    const dates = JSON.parse(output);
    assert.equal(dates.summerIso, '2026-07-13');
    assert.equal(dates.summerDate, '2026-07-14');
    assert.equal(dates.winterIso, '2026-01-14');
    assert.equal(dates.winterDate, '2026-01-15');
});

test('calendar date helpers validate real dates and cross month and year boundaries without UTC conversion', () => {
    assert.equal(normalizeScheduleDate('2026-02-29'), null);
    assert.equal(normalizeScheduleDate('2028-02-29'), '2028-02-29');
    assert.equal(normalizeScheduleDate('2026-04-31'), null);
    assert.deepEqual(scheduleDateSequence('2026-07-30', 7), [
        '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
        '2026-08-03', '2026-08-04', '2026-08-05'
    ]);
    assert.deepEqual(scheduleDateSequence('2026-12-28', 7), [
        '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
        '2027-01-01', '2027-01-02', '2027-01-03'
    ]);
});

test('bulk prevalidation rejects malformed and duplicate entries before mutation', () => {
    const valid = validateScheduleBulkEntries([
        { staffId: '7', date: '2026-07-14', status: 'working' },
        { staff_id: 7, date: '2026-07-15', status: 'day_off' }
    ]);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.entries.map(entry => ({ staffId: entry.staffId, date: entry.date, status: entry.status })), [
        { staffId: 7, date: '2026-07-14', status: 'working' },
        { staffId: 7, date: '2026-07-15', status: 'dayoff' }
    ]);

    assert.equal(validateScheduleBulkEntries([{ date: '2026-07-14' }]).code, 'SCHEDULE_BULK_STAFF_ID_INVALID');
    assert.equal(validateScheduleBulkEntries([{ staffId: 7, date: '2026-02-30' }]).code, 'SCHEDULE_BULK_DATE_INVALID');
    assert.equal(validateScheduleBulkEntries([{ staffId: 7, date: '2026-07-14', status: 'unknown' }]).code, 'SCHEDULE_BULK_STATUS_INVALID');
    assert.equal(validateScheduleBulkEntries([
        { staffId: 7, date: '2026-07-14', status: 'working' },
        { staffId: 7, date: '2026-07-14', status: 'dayoff' }
    ]).code, 'SCHEDULE_BULK_DUPLICATE_STAFF_DATE');
});

test('Staff bulk and copy-week routes use canonical prevalidation and text calendar dates', () => {
    const source = serviceSource('routes/staff.js');
    const bulkStart = source.indexOf("router.post('/schedule/bulk'");
    const copyStart = source.indexOf("router.post('/schedule/copy-week'");
    const nextRoute = source.indexOf("router.get('/schedule/hours'", copyStart);
    const bulkRoute = source.slice(bulkStart, copyStart);
    const copyRoute = source.slice(copyStart, nextRoute);

    assert.ok(bulkStart >= 0 && copyStart > bulkStart && nextRoute > copyStart);
    assert.match(bulkRoute, /validateScheduleBulkEntries\(entries\)/);
    assert.doesNotMatch(bulkRoute, /if \(!e\.staffId \|\| !e\.date\) continue/);
    assert.match(copyRoute, /SELECT ss\.\*, ss\.date::text AS date FROM staff_schedule/);
    assert.match(copyRoute, /scheduleDateSequence\(normalizedFromMonday, STAFF_COPY_WEEK_DATE_COUNT\)/);
    assert.match(copyRoute, /scheduleDateSequence\(normalizedToMonday, STAFF_COPY_WEEK_DATE_COUNT\)/);
    assert.doesNotMatch(copyRoute, /toISOString\(\)/);
    assert.doesNotMatch(copyRoute, /row\.date\?\.toISOString/);
});

test('shared schedule service validates supported time contracts without owning transactions', () => {
    assert.equal(validateScheduleMutationTimes({ startTime: '09:00', endTime: '18:00' }, 'working').ok, true);
    assert.equal(validateScheduleMutationTimes({ startTime: '22:00', endTime: '02:00' }, 'working').ok, true);
    assert.equal(validateScheduleMutationTimes({ startTime: '25:00', endTime: '18:00' }, 'working').ok, false);
    assert.equal(validateScheduleMutationTimes({ startTime: '10:00', endTime: '10:00' }, 'working').ok, false);

    const source = serviceSource('services/staffScheduleMutations.js');
    const batchStart = source.indexOf('async function mutateStaffScheduleBatch');
    const batchEnd = source.indexOf('function rosterMutationDates', batchStart);
    const batchSource = source.slice(batchStart, batchEnd);
    assert.ok(batchStart >= 0 && batchEnd > batchStart);
    assert.doesNotMatch(batchSource, /['"](?:BEGIN|COMMIT|ROLLBACK)['"]/);
    assert.match(batchSource, /mutateStaffScheduleEntry/);
    assert.match(batchSource, /reconcileAnimatorRosterDates/);
});

test('scheduleability service returns explicit inactive and blacklisted failures', async () => {
    for (const fixture of [
        {
            row: {
                id: 7,
                name: 'Inactive Contract Staff',
                is_active: false,
                hr_pool_status: 'core',
                is_freelance: false,
                termination_date: null,
                is_scheduleable: false
            },
            code: 'STAFF_INACTIVE'
        },
        {
            row: {
                id: 8,
                name: 'Blacklisted Contract Staff',
                is_active: true,
                hr_pool_status: 'blacklisted',
                is_freelance: false,
                termination_date: null,
                is_scheduleable: false
            },
            code: 'STAFF_BLACKLISTED'
        }
    ]) {
        const db = { query: async () => ({ rows: [fixture.row] }) };
        const result = await validateStaffScheduleableForDate(db, fixture.row.id, '2026-07-15');
        assert.equal(result.ok, false);
        assert.equal(result.code, fixture.code);
    }
});

test('bulk scheduleability cards load selected staff once and validate many dates in memory', async () => {
    let queries = 0;
    const db = {
        async query(sql, params) {
            queries += 1;
            assert.match(String(sql), /WHERE s\.id = ANY\(\$1::int\[\]\)/);
            assert.deepEqual(params, [[7, 8]]);
            return {
                rows: [
                    { id: 7, name: 'One', is_active: true, hr_pool_status: 'core', is_freelance: false, termination_date: null },
                    { id: 8, name: 'Two', is_active: true, hr_pool_status: 'core', is_freelance: false, termination_date: '2026-07-16' }
                ]
            };
        }
    };
    const cards = await loadStaffScheduleabilityCards(db, [8, 7, 8]);
    assert.equal(queries, 1);
    assert.equal(validateStaffScheduleabilityCardForDate(cards.get(7), '2026-07-14').ok, true);
    assert.equal(validateStaffScheduleabilityCardForDate(cards.get(8), '2026-07-15').ok, true);
    assert.equal(validateStaffScheduleabilityCardForDate(cards.get(8), '2026-07-16').code, 'STAFF_TERMINATED');
});

test('bulk and copy routes batch staff cards and day plans outside per-entry loops', () => {
    const staffRoute = serviceSource('routes/staff.js');
    const hrRoute = serviceSource('routes/hr.js');
    for (const source of [staffRoute, hrRoute]) {
        assert.match(source, /loadStaffScheduleabilityCards/);
        assert.match(source, /loadHrShiftDayPlansForStaffDates/);
    }
    assert.match(staffRoute, /STAFF_SCHEDULE_BULK_MAX_ENTRIES = 500/);
    assert.match(staffRoute, /STAFF_SCHEDULE_BULK_MAX_DATES = 31/);
    assert.match(hrRoute, /HR_SHIFT_BULK_MAX_ENTRIES = 500/);
    assert.match(hrRoute, /HR_SHIFT_COPY_WEEK_MAX_STAFF = 500/);
});

test('CRM single, bulk, and Hermes apply share the same mutation implementation', () => {
    const staffRoute = serviceSource('routes/staff.js');
    const hermesImport = serviceSource('services/hermesScheduleImport.js');
    const hermesRoute = serviceSource('routes/hermes-schedule.js');

    assert.match(staffRoute, /mutateStaffScheduleEntry/);
    assert.match(hermesImport, /mutateStaffScheduleBatch/);
    assert.doesNotMatch(hermesImport, /fetch\s*\(/);
    assert.doesNotMatch(hermesRoute, /fetch\s*\(/);
    assert.doesNotMatch(hermesRoute, /routes\/telegram/);
});

test('Hermes schedule notifications and roster broadcasts remain post-commit batched effects', () => {
    const route = serviceSource('routes/hermes-schedule.js');
    const applyRouteStart = route.indexOf("'/staff-schedule/apply'");
    const applyRoute = route.slice(applyRouteStart);

    assert.ok(applyRouteStart >= 0);
    assert.match(applyRoute, /context\.afterCommit\.push/);
    assert.match(applyRoute, /notifyScheduleBatch\(db, applied\.changes/);
    assert.match(applyRoute, /broadcastRosterDates\(/);
    assert.doesNotMatch(applyRoute, /for\s*\([^)]*applied\.changes[^)]*\)[\s\S]{0,200}sendTelegramMessage/);
});
