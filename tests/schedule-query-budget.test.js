'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    hydrateHrShiftDayPlans,
    loadHrShiftDayPlansForStaffDates,
    professionCardFromStaff,
    replaceHrShiftSegments
} = require('../services/hrShiftSegments');
const { loadStaffScheduleabilityCards } = require('../services/staffOperationalFilters');
const {
    loadScheduleEntriesForUpdate,
    lockScheduleStaffRows,
    scheduleDateSequence
} = require('../services/staffScheduleMutations');
const { QueryCountClient } = require('./query-count-client');

const MATRIX_STAFF_COUNT = 100;
const MATRIX_DATE_COUNT = 31;
const MATRIX_SEGMENT_COUNT = 12;

function buildMatrix() {
    const staffIds = Array.from({ length: MATRIX_STAFF_COUNT }, (_, index) => index + 1);
    const sourceDates = scheduleDateSequence('2099-01-01', MATRIX_DATE_COUNT);
    const targetDates = scheduleDateSequence('2099-03-01', MATRIX_DATE_COUNT);
    const sourceEntries = staffIds.flatMap(staffId => sourceDates.map(date => ({ staffId, date })));
    const targetEntries = staffIds.flatMap(staffId => targetDates.map(date => ({ staffId, date })));
    const shiftByKey = new Map();
    const shiftById = new Map();
    let nextShiftId = 1;
    for (const entry of [...sourceEntries, ...targetEntries]) {
        const shift = {
            id: nextShiftId++,
            staff_id: entry.staffId,
            shift_date: entry.date,
            profession_key: 'reception',
            planned_start: '00:00',
            planned_end: '12:00',
            break_minutes: 0,
            shift_type: 'regular',
            created_at: new Date('2099-01-01T00:00:00.000Z'),
            updated_at: new Date('2099-01-01T00:00:00.000Z')
        };
        shiftByKey.set(`${entry.staffId}:${entry.date}`, shift);
        shiftById.set(shift.id, shift);
    }
    return {
        staffIds,
        sourceEntries,
        targetEntries,
        sourceShifts: sourceEntries.map(entry => shiftByKey.get(`${entry.staffId}:${entry.date}`)),
        shiftByKey,
        shiftById
    };
}

function hour(value) {
    return `${String(value).padStart(2, '0')}:00`;
}

function snapshotRows(shifts) {
    const rows = [];
    for (const shift of shifts) {
        for (let index = 0; index < MATRIX_SEGMENT_COUNT; index += 1) {
            const professionKey = index % 2 === 0 ? 'reception' : 'manager';
            rows.push({
                shift_row: shift,
                plan_updated_at_token: '2099-01-01T00:00:00.000000Z',
                segment_id: shift.id * 100 + index + 1,
                profession_key: professionKey,
                planned_start: hour(index),
                planned_end: hour(index + 1),
                break_minutes: 0,
                notes: `segment-${index + 1}`,
                sort_order: index,
                additional_profession_keys: [professionKey === 'reception' ? 'security' : 'animator']
            });
        }
    }
    return rows;
}

function createMatrixClient(matrix) {
    return new QueryCountClient(async ({ text, params }) => {
        if (/FROM staff s/i.test(text) && /secondary_professions/i.test(text)) {
            return {
                rows: params[0].map(id => ({
                    id,
                    name: `Fixture ${id}`,
                    role_type: 'reception',
                    secondary_professions: ['manager', 'security', 'animator'],
                    is_active: true,
                    hr_pool_status: 'core',
                    is_freelance: false,
                    termination_date: null,
                    hourly_rate: null,
                    rate_unit: 'hour'
                }))
            };
        }
        if (/SELECT id FROM staff/i.test(text) && /FOR UPDATE/i.test(text)) {
            return { rows: params[0].map(id => ({ id })) };
        }
        if (/to_jsonb\(hs\) AS shift_row/i.test(text)) {
            let shifts;
            if (params.length === 2) {
                shifts = params[0].map((staffId, index) => (
                    matrix.shiftByKey.get(`${staffId}:${params[1][index]}`)
                )).filter(Boolean);
            } else {
                shifts = (params[0] || []).map(id => matrix.shiftById.get(Number(id))).filter(Boolean);
            }
            return { rows: snapshotRows(shifts) };
        }
        if (/FROM staff_schedule ss/i.test(text) && /UNNEST\(/i.test(text)) {
            return {
                rows: params[0].map((staffId, index) => ({
                    id: index + 1,
                    staff_id: staffId,
                    date: params[1][index],
                    status: 'working',
                    shift_start: '00:00',
                    shift_end: '12:00',
                    profession_key: 'reception'
                }))
            };
        }
        throw new Error(`Unexpected query in batch-read budget fixture: ${text.slice(0, 240)}`);
    });
}

const FLOW_BUDGETS = Object.freeze({
    staffBulk: {
        locking: 1,
        profession_card_load: 1,
        source_plan_load: 0,
        target_plan_load: 1,
        schedule_mirror_load: 1
    },
    staffCopyWeek: {
        locking: 1,
        profession_card_load: 1,
        source_plan_load: 1,
        target_plan_load: 1,
        schedule_mirror_load: 1
    },
    hrBulk: {
        locking: 1,
        profession_card_load: 1,
        source_plan_load: 0,
        target_plan_load: 1,
        schedule_mirror_load: 0
    },
    hrCopyWeek: {
        locking: 1,
        profession_card_load: 1,
        source_plan_load: 1,
        target_plan_load: 1,
        schedule_mirror_load: 0
    }
});

async function measureFlow(flow) {
    const matrix = buildMatrix();
    const client = createMatrixClient(matrix);
    await client.inPhase('locking', () => lockScheduleStaffRows(client, matrix.staffIds));
    const cards = await client.inPhase(
        'profession_card_load',
        () => loadStaffScheduleabilityCards(client, matrix.staffIds)
    );
    assert.equal(cards.size, MATRIX_STAFF_COUNT);

    if (flow === 'staffCopyWeek') {
        const source = await client.inPhase(
            'source_plan_load',
            () => loadHrShiftDayPlansForStaffDates(client, matrix.sourceEntries)
        );
        assert.equal(source.size, MATRIX_STAFF_COUNT * MATRIX_DATE_COUNT);
    } else if (flow === 'hrCopyWeek') {
        const source = await client.inPhase(
            'source_plan_load',
            () => hydrateHrShiftDayPlans(client, matrix.sourceShifts)
        );
        assert.equal(source.length, MATRIX_STAFF_COUNT * MATRIX_DATE_COUNT);
    }

    const targets = await client.inPhase(
        'target_plan_load',
        () => loadHrShiftDayPlansForStaffDates(client, matrix.targetEntries)
    );
    assert.equal(targets.size, MATRIX_STAFF_COUNT * MATRIX_DATE_COUNT);

    if (flow.startsWith('staff')) {
        const mirrors = await client.inPhase(
            'schedule_mirror_load',
            () => loadScheduleEntriesForUpdate(client, matrix.targetEntries)
        );
        assert.equal(mirrors.size, MATRIX_STAFF_COUNT * MATRIX_DATE_COUNT);
    }

    client.assertBudgets({
        phases: FLOW_BUDGETS[flow],
        categories: { profession_card_load: 1 }
    });
    return client;
}

for (const [flow, label] of [
    ['staffBulk', 'Staff bulk'],
    ['staffCopyWeek', 'Staff copy-week'],
    ['hrBulk', 'HR bulk'],
    ['hrCopyWeek', 'HR copy-week']
]) {
    test(`${label} batch reads stay constant for 100 staff, 31 dates and 12 segments`, async () => {
        const client = await measureFlow(flow);
        assert.equal(
            client.calls.filter(call => call.phase === 'profession_card_load').length,
            1,
            'qualification must be one batch query, never one query per segment/date'
        );
    });
}

function twelveSegmentPlan(additionalProfessionKeys) {
    return {
        status: 'working',
        primaryProfessionKey: 'reception',
        segments: Array.from({ length: MATRIX_SEGMENT_COUNT }, (_, index) => ({
            professionKey: index % 2 === 0 ? 'reception' : 'manager',
            shiftStart: hour(index),
            shiftEnd: hour(index + 1),
            breakMinutes: 0,
            note: null,
            additionalProfessionKeys
        }))
    };
}

async function measureNewPlanPersistence(additionalProfessionKeys) {
    let nextSegmentId = 1000;
    const client = new QueryCountClient(async ({ text }) => {
        if (/SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE/i.test(text)) {
            return { rows: [{ id: 42, staff_id: 1, shift_date: '2099-01-01' }] };
        }
        if (/^UPDATE hr_shifts SET planned_start/i.test(text)) {
            return { rows: [{ id: 42, staff_id: 1, shift_date: '2099-01-01' }] };
        }
        if (/FROM hr_shift_segments hss/i.test(text)) return { rows: [] };
        if (/^INSERT INTO hr_shift_segments /i.test(text)) return { rows: [{ id: nextSegmentId++ }] };
        if (/^INSERT INTO hr_shift_segment_roles /i.test(text)) return { rows: [], rowCount: additionalProfessionKeys.length * MATRIX_SEGMENT_COUNT };
        throw new Error(`Unexpected query in persistence budget fixture: ${text.slice(0, 240)}`);
    });
    const professionCard = professionCardFromStaff({
        id: 1,
        name: 'Query budget fixture',
        role_type: 'reception',
        secondary_professions: ['manager', 'security', 'animator', 'cook'],
        is_active: true,
        hr_pool_status: 'core',
        is_freelance: false
    });
    await client.inPhase('persistence', () => replaceHrShiftSegments(
        client,
        42,
        twelveSegmentPlan(additionalProfessionKeys),
        { professionCard, actor: 'query-budget-test' }
    ));
    client.assertBudgets({
        phases: { persistence: 16 },
        categories: { profession_card_load: 0, persistence: 14 }
    });
    return client;
}

test('12-segment persistence batches additional roles and performs no qualification query', async () => {
    const oneRole = await measureNewPlanPersistence(['security']);
    const threeRoles = await measureNewPlanPersistence(['security', 'animator', 'cook']);
    assert.equal(oneRole.calls.length, threeRoles.calls.length, 'additional role count must not add queries');
    assert.equal(threeRoles.calls.filter(call => /INSERT INTO hr_shift_segment_roles/i.test(call.sql)).length, 1);
});

function routeBlock(source, marker) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `route marker not found: ${marker}`);
    const next = source.indexOf('\nrouter.', start + marker.length);
    return source.slice(start, next === -1 ? source.length : next);
}

function count(source, needle) {
    return source.split(needle).length - 1;
}

test('Staff and HR routes keep batch reads outside persistence loops', () => {
    const root = path.resolve(__dirname, '..');
    const staffSource = fs.readFileSync(path.join(root, 'routes', 'staff.js'), 'utf8');
    const hrSource = fs.readFileSync(path.join(root, 'routes', 'hr.js'), 'utf8');
    const blocks = {
        staffBulk: routeBlock(staffSource, "router.post('/schedule/bulk'"),
        staffCopyWeek: routeBlock(staffSource, "router.post('/schedule/copy-week'"),
        hrBulk: routeBlock(hrSource, "router.post('/shifts/bulk'"),
        hrCopyWeek: routeBlock(hrSource, "router.post('/shifts/copy-week'")
    };

    assert.equal(count(blocks.staffBulk, 'loadStaffScheduleabilityCards('), 1);
    assert.equal(count(blocks.staffBulk, 'loadHrShiftDayPlansForStaffDates('), 1);
    assert.equal(count(blocks.staffBulk, 'loadScheduleEntriesForUpdate('), 1);
    assert.equal(count(blocks.staffBulk, 'lockScheduleStaffRows('), 1);

    assert.equal(count(blocks.staffCopyWeek, 'loadStaffScheduleabilityCards('), 1);
    assert.equal(count(blocks.staffCopyWeek, 'loadHrShiftDayPlansForStaffDates('), 2);
    assert.equal(count(blocks.staffCopyWeek, 'loadScheduleEntriesForUpdate('), 1);
    assert.equal(count(blocks.staffCopyWeek, 'lockScheduleStaffRows('), 1);

    assert.equal(count(blocks.hrBulk, 'loadStaffScheduleabilityCards('), 1);
    assert.equal(count(blocks.hrBulk, 'loadHrShiftDayPlansForStaffDates('), 1);
    assert.equal(count(blocks.hrBulk, 'lockScheduleStaffRows('), 1);
    assert.match(blocks.hrBulk, /mirrorHrDayPlanToStaffSchedule\([^]*staffValidation: shiftValidation/);

    assert.equal(count(blocks.hrCopyWeek, 'loadStaffScheduleabilityCards('), 1);
    assert.equal(count(blocks.hrCopyWeek, 'hydrateHrShiftDayPlans('), 1);
    assert.equal(count(blocks.hrCopyWeek, 'loadHrShiftDayPlansForStaffDates('), 1);
    assert.equal(count(blocks.hrCopyWeek, 'lockScheduleStaffRows('), 1);
    assert.match(blocks.hrCopyWeek, /mirrorHrShiftToStaffSchedule\([^]*staffValidation: shiftValidation/);

    for (const [name, block] of Object.entries(blocks)) {
        assert.doesNotMatch(block, /validateStaffScheduleableForDate\(/, `${name} must not query qualification per entry`);
        assert.match(block, /professionCard: professionCardFromStaff\(staffRow\)/, `${name} must reuse the batch staff card`);
    }
});

test('query-budget failures list the excess SQL without parameter values', async () => {
    const client = new QueryCountClient(async () => ({ rows: [] }));
    await client.inPhase('profession_card_load', async () => {
        await client.query('SELECT id FROM staff WHERE id = ANY($1::int[])', [[1]]);
        await client.query('SELECT id FROM staff WHERE id = ANY($1::int[])', [[2]]);
    });
    assert.throws(
        () => client.assertBudgets({ phases: { profession_card_load: 1 } }),
        error => /Query budget failed/.test(error.message)
            && /Excess queries/.test(error.message)
            && /#2/.test(error.message)
            && !/\[2\]/.test(error.message)
    );
});
