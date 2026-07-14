'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    classifyHrShiftReconciliationRows,
    reconcileHrShiftsFromStaffSchedule,
    validateReconciliationRange
} = require('../services/hrShiftReconciliation');

const repoRoot = path.resolve(__dirname, '..');

function scheduleRow(overrides = {}) {
    return {
        schedule_id: 11,
        staff_id: 7,
        shift_date: '2026-07-14',
        shift_start: '09:00:00',
        shift_end: '18:00:00',
        status: 'working',
        notes: null,
        profession_key: 'reception',
        role_type: 'reception',
        secondary_professions: ['manager'],
        is_active: true,
        hr_pool_status: 'core',
        is_freelance: false,
        termination_date: null,
        ...overrides
    };
}

test('reconciliation classifies valid candidates and reports unsafe legacy rows', () => {
    const result = classifyHrShiftReconciliationRows([
        scheduleRow(),
        scheduleRow({ schedule_id: 12, shift_start: '09:00', shift_end: '09:00' }),
        scheduleRow({ schedule_id: 13, profession_key: 'animator' }),
        scheduleRow({ schedule_id: 14, profession_key: null, role_type: null }),
        scheduleRow({ schedule_id: 15, is_active: false })
    ]);

    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0], {
        scheduleId: 11,
        staffId: 7,
        shiftDate: '2026-07-14',
        shiftStart: '09:00',
        shiftEnd: '18:00',
        shiftType: 'regular',
        professionKey: 'reception',
        notes: null
    });
    assert.deepEqual(result.errors.map(error => error.code), [
        'SCHEDULE_TIME_INVALID',
        'SCHEDULE_PROFESSION_NOT_ON_STAFF_CARD',
        'SCHEDULE_PROFESSION_MISSING',
        'STAFF_INACTIVE'
    ]);
});

test('reconciliation dry-run reports counts without any write or transaction query', async () => {
    const queries = [];
    const db = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            return { rows: [scheduleRow(), scheduleRow({ schedule_id: 12, shift_start: null })] };
        }
    };

    const result = await reconcileHrShiftsFromStaffSchedule(db, {
        from: '2026-07-14',
        to: '2026-07-20'
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.candidateCount, 1);
    assert.equal(result.errorCount, 1);
    assert.equal(result.createdCount, 0);
    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /^\s*SELECT/i);
    assert.doesNotMatch(queries[0].sql, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i);
});

test('reconciliation requires explicit valid ranges and an apply confirmation in the operator script', () => {
    assert.deepEqual(validateReconciliationRange('2026-07-01', '2026-07-31'), {
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31'
    });
    assert.throws(
        () => validateReconciliationRange('2026-02-30', '2026-03-01'),
        error => error.code === 'HR_SHIFT_RECONCILIATION_RANGE_INVALID'
    );

    const script = fs.readFileSync(path.join(repoRoot, 'scripts', 'reconcile-hr-shifts.js'), 'utf8');
    assert.match(script, /I_CONFIRM_HR_SHIFT_RECONCILIATION/);
    assert.match(script, /dryRun: !apply/);
    assert.match(script, /if \(apply && confirmation !== APPLY_CONFIRMATION\)/);
});
