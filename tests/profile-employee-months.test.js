'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadProfileEmployee } = require('../services/profileEmployee');
const { employeeMonthRange, loadEmployeeSalary, loadEmployeeResults } = require('../services/profileEmployeeMonths');

function request(context = 'event_genix') {
    return {
        headers: {},
        query: { business_context: context, staffId: 99, userId: 88 },
        user: {
            id: 7,
            businessMembershipAccess: { membershipEnabled: false },
            businessContexts: ['event_genix', 'dar'],
            defaultBusinessContext: 'event_genix'
        }
    };
}

test('the employee lookup uses only the authenticated account and rejects absent or ambiguous links', async () => {
    let rows = [{ id: 3 }];
    let calls = 0;
    const db = { async query(sql, params) {
        calls++;
        assert.match(sql, /JOIN staff s ON s.id = ep.staff_id/);
        assert.match(sql, /ep.user_id = \$1 AND ep.is_active = true/);
        assert.deepEqual(params, [7]);
        return { rows };
    } };
    assert.deepEqual((await loadProfileEmployee(db, request())).rows, [{ id: 3 }]);
    rows = [{ id: 3 }, { id: 4 }];
    assert.deepEqual((await loadProfileEmployee(db, request())).rows, []);
    rows = [];
    assert.deepEqual((await loadProfileEmployee(db, request())).rows, []);
    assert.deepEqual((await loadProfileEmployee(db, request('dar'))).rows, []);
    assert.equal(calls, 3);
});

test('salary reads a locked historical snapshot and verifies partial payment without recalculating', async () => {
    const range = employeeMonthRange('2024-02');
    assert.deepEqual(range, { month: '2024-02', from: '2024-02-01', to: '2024-03-01', previousFrom: '2024-01-01' });
    assert.equal(employeeMonthRange('2024-13'), null);
    const db = { async query(sql, params) {
        if (sql.includes('AS conflict')) {
            assert.deepEqual(params, [3, range.from, range.to, 'event_genix']);
            return { rows: [{ conflict: false }] };
        }
        if (sql.includes('FROM payroll_period_locks')) return { rows: [{ is_locked: true }] };
        if (sql.includes('FROM hr_time_records')) return { rows: [{ date: '2024-02-08', lateMinutes: 12 }] };
        if (sql.includes('FROM salary_adjustments')) return { rows: [
            { type: 'penalty', amount: '100', status: 'applied', ruleCode: 'DP-03', violationDate: '2024-02-08' },
            { type: 'penalty', amount: '300', status: 'pending_review', ruleCode: 'DP-04', violationDate: '2024-02-08' }
        ] };
        if (sql.includes('FROM payroll_reports WHERE')) {
            assert.deepEqual(params, [3, range.month]);
            return { rows: [{
                status: 'approved', gross_amount: '2100', deductions_amount: '100', net_amount: '2000',
                breakdown_json: { professionRateSummary: [{ profession_key: 'host', rate: 200, actual_minutes: 600 }],
                    metrics: { daysWorked: 3 }, transparency: { physicalHours: 10, baseRoleHours: 10, additionalRoleHours: 2 } }
            }] };
        }
        if (sql.includes('WITH report_installments')) {
            assert.deepEqual(params, [range.month, 3]);
            return { rows: ['advance', 'final'].map((kind, i) => ({
                report_id: 19, installment_id: i + 1, kind, business_context: 'event_genix',
                settlement_model: 'installments', report_net_amount: 2000,
                locked_amount: 1000, workflow_status: 'approved',
                payment_total: i ? 0 : 500,
                movements: i ? [] : [{ id: 1, movementType: 'payment', amount: 500,
                    actualPaymentDate: '2024-02-15', actorUsername: 'internal', financeTransactionId: 41 }]
            })) };
        }
        assert.fail('Unexpected query or historical recalculation: ' + sql);
    } };
    const salary = await loadEmployeeSalary(db, 3, range);
    assert.equal(salary.gross, 2100);
    assert.equal(salary.deductions, 100);
    assert.equal(salary.paid, 500);
    assert.equal(salary.balance, 1500);
    assert.equal(salary.detail.rates[0].rate, 200);
    assert.equal(salary.detail.additionalRoleHours, 2);
    assert.equal(salary.late[0].minutes, 12);
    assert.deepEqual(salary.late[0].adjustments, [{ amount: 100, status: 'applied' }]);
    assert.deepEqual(salary.installments[0].movements[0], { kind: 'payment', date: '2024-02-15', amount: 500 });
});

test('unverified payroll ownership prevents even a snapshot read', async () => {
    let calls = 0;
    const db = { async query(sql) {
        calls++;
        assert.match(sql, /business_context IS DISTINCT FROM/);
        return { rows: [{ conflict: true }] };
    } };
    assert.deepEqual(await loadEmployeeSalary(db, 3, employeeMonthRange('2024-02')),
        { state: 'unavailable', month: '2024-02' });
    assert.equal(calls, 1);
});

test('results compare Kyiv calendar months using linked staff and typed task ownership', async () => {
    const results = await loadEmployeeResults({ async query(sql, params) {
        const current = params[1] === '2024-01-01';
        if (sql.includes('FROM tasks')) {
            assert.deepEqual(params, current
                ? [7, '2024-01-01', '2024-02-01', 'event_genix']
                : [7, '2023-12-01', '2024-01-01', 'event_genix']);
            assert.match(sql, /owner_user_id = \$1/);
            assert.match(sql, /Europe\/Kyiv/);
            return { rows: [{ completed: current ? 5 : 2, overdue: 1 }] };
        }
        assert.equal(params[0], 3);
        if (sql.includes('FROM hr_time_records')) return { rows: current ? [
            { actual: '2024-01-02T08:00:00Z', planned: '10:00', lateMinutes: 0 },
            { actual: '2024-01-03T08:05:00Z', planned: '10:00', lateMinutes: 5 },
            { actual: '2024-01-04T08:05:00Z', planned: null },
            { status: 'absent' }
        ] : [] };
        if (sql.includes('FROM hr_staff_profession_checklist_progress')) return { rows: [{ completed: 0 }] };
        return { rows: [] };
    } }, { id: 3 }, 7, { activeContext: 'event_genix' }, employeeMonthRange('2024-01'));
    assert.deepEqual(results.current.attendance, {
        daysRecorded: 4, present: 3, absent: 1, measuredArrivals: 2, onTime: 1, late: 1, lateMinutes: 5
    });
    assert.equal(results.previous.tasks.completed, 2);
});
