'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    validateScheduleMutationTimes
} = require('../services/staffScheduleMutations');
const {
    validateStaffScheduleableForDate
} = require('../services/staffOperationalFilters');

function serviceSource(file) {
    return fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
}

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
