'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { loadHrShiftDayPlan, saveHrShiftDayPlan } = require('../../services/hrShiftSegments');
const { hydrateAttendanceRecords } = require('../../services/hrAttendance');
const { calculateProfessionPay, loadPayrollAttendanceMetrics } = require('../../services/payroll');
const {
    agreeFreelanceSegmentTerms, confirmFreelanceAttendance, insertFreelanceRateVersion,
    listFreelanceSettlement, listFreelanceWorkDay, writeFreelanceMovement
} = require('../../services/hrFreelanceWork');

test('mixed shift mode survives PostgreSQL reload and cannot enter payroll before confirmation', {
    skip: process.env.RUN_FREELANCE_SHIFT_INTEGRATION !== 'true'
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true, 'Freelance tests use local PostgreSQL');
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');
        const profession = `freelance_qa_${process.pid}`;
        const date = '2026-11-11';
        await client.query(
            'INSERT INTO hr_professions (key, title, department) VALUES ($1, $2, $3)',
            [profession, 'Freelance shift QA', 'QA']
        );
        const { rows: [staff] } = await client.query(
            `INSERT INTO staff (name, department, position, role_type, is_active)
             VALUES ('Freelance Shift QA', 'QA', 'QA', $1, true) RETURNING id`,
            [profession]
        );
        const selector = { staffId: staff.id, shiftDate: date };
        const defaultVersion = await insertFreelanceRateVersion(client, {
            professionKey: profession, rateUnit: 'hour', rate: '155.15', effectiveFrom: date
        }, 'qa');
        const personalVersion = await insertFreelanceRateVersion(client, {
            professionKey: profession, staffId: staff.id, rateUnit: 'hour', rate: '170.13', effectiveFrom: date
        }, 'qa');
        const saved = await saveHrShiftDayPlan(client, {
            ...selector,
            payload: {
                primaryProfessionKey: profession,
                segments: [
                    { professionKey: profession, shiftStart: '09:00', shiftEnd: '13:00', workMode: 'regular' },
                    { professionKey: profession, shiftStart: '15:00', shiftEnd: '20:00', workMode: 'freelance' }
                ]
            }
        });
        const loaded = await loadHrShiftDayPlan(client, selector);
        assert.deepEqual(loaded.plan.segments.map(({ id, workMode }) => [id, workMode]),
            saved.plan.segments.map(({ id, workMode }) => [id, workMode]));
        assert.deepEqual(loaded.plan.segments.map(segment => segment.workMode), ['regular', 'freelance']);
        const freelanceId = loaded.plan.segments[1].id;
        const { rows: [agreedDefault] } = await client.query(
            'SELECT source_version_id, rate FROM hr_freelance_segment_terms WHERE segment_id = $1',
            [freelanceId]
        );
        assert.notEqual(defaultVersion.id, personalVersion.id);
        assert.deepEqual(agreedDefault, { source_version_id: personalVersion.id, rate: '170.13' });

        const { rows: [fact] } = await client.query(
            `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status, business_context)
             VALUES ($1, $2, $3, $4, 'present', 'event_genix') RETURNING *`,
            [staff.id, date, '2026-11-11T09:00:00+02:00', '2026-11-11T20:00:00+02:00']
        );
        const [attendance] = await hydrateAttendanceRecords(client, [fact]);
        assert.deepEqual(attendance.segmentAllocations.map(segment => [
            segment.workMode || 'regular', segment.actualMinutes
        ]), [['regular', 240], ['freelance', 300]]);
        const [workDay] = await listFreelanceWorkDay(client, date, staff.id);
        assert.equal(workDay.actualMinutes, 540);
        assert.equal(workDay.segments[1].estimatedAmount, 851);
        assert.deepEqual(workDay.suggestedAllocations.map(item => item.minutes), [240, 300]);
        const metrics = (await loadPayrollAttendanceMetrics({
            from: date, to: date, staffIds: [staff.id]
        }, client)).get(staff.id);
        assert.ok(metrics.payrollBlockingIssues.some(
            issue => issue.code === 'PAYROLL_FREELANCE_TIME_REQUIRES_CONFIRMATION'
        ));
        assert.equal(metrics.totalMinutes, 0);

        await insertFreelanceRateVersion(client, {
            professionKey: profession, staffId: staff.id, rateUnit: 'fixed', rate: '999', effectiveFrom: date
        }, 'qa');
        const agreed = await agreeFreelanceSegmentTerms(client, {
            staffId: staff.id, segmentId: freelanceId, date,
            rateUnit: 'hour', rate: '174.13', reason: 'Agreed after schedule was saved'
        }, 'qa');
        const input = {
            staffId: staff.id, date, attendanceId: fact.id,
            allocations: [
                { segmentId: loaded.plan.segments[0].id, minutes: 240 },
                { segmentId: freelanceId, minutes: 300 }
            ]
        };
        await assert.rejects(confirmFreelanceAttendance(client, {
            ...input, allocations: [{ ...input.allocations[0], minutes: 300 }, input.allocations[1]]
        }, 'qa'), { code: 'FREELANCE_ALLOCATION_TOTAL_MISMATCH' });
        const confirmation = await confirmFreelanceAttendance(client, input, 'qa');
        assert.equal(confirmation.blocks[1].termsId, agreed.id);
        assert.equal(confirmation.blocks[1].amount, 871);
        await assert.rejects(confirmFreelanceAttendance(client, input, 'qa'), {
            code: 'FREELANCE_ATTENDANCE_ALREADY_CONFIRMED'
        });
        const confirmedMetrics = (await loadPayrollAttendanceMetrics({
            from: date, to: date, staffIds: [staff.id]
        }, client)).get(staff.id);
        assert.equal(confirmedMetrics.totalMinutes, 240);
        assert.equal(confirmedMetrics.physicalMinutes, 540);
        assert.equal(confirmedMetrics.professionAllocations[0].minutes, 240);
        assert.equal(confirmedMetrics.payrollBlockingIssues.some(
            issue => issue.code === 'PAYROLL_FREELANCE_TIME_REQUIRES_CONFIRMATION'
        ), false);
        const daily = calculateProfessionPay({ id: staff.id, role_type: profession }, {
            schemeType: 'per_shift', config: { rate: 500 }
        }, confirmedMetrics);
        assert.equal(daily.baseAmount, 0);
        assert.ok(daily.blockingIssues.some(issue => issue.code === 'PAYROLL_FREELANCE_DAILY_RATE_REVIEW'));

        await client.query('SAVEPOINT edit_confirmed_block');
        await assert.rejects(client.query(
            "UPDATE hr_shift_segments SET work_mode = 'regular' WHERE id = $1", [freelanceId]
        ), { constraint: 'hr_freelance_confirmed_segment_immutable' });
        await client.query('ROLLBACK TO SAVEPOINT edit_confirmed_block');

        const { rows: [expense, income] } = await client.query(
            `INSERT INTO finance_categories (name, type, business_context)
             VALUES ($1, 'expense', 'event_genix'), ($2, 'income', 'event_genix') RETURNING id`,
            [`Freelance expense QA ${process.pid}`, `Freelance reversal QA ${process.pid}`]
        );
        const { rows: [account] } = await client.query(
            `INSERT INTO finance_accounts (name, business_context) VALUES ($1, 'event_genix') RETURNING id`,
            [`Freelance account QA ${process.pid}`]
        );
        const payment = {
            segmentId: freelanceId, paymentDate: date, categoryId: expense.id, accountId: account.id,
            amount: 400, paymentMethod: 'cash', reason: 'Synthetic paid amount',
            idempotencyKey: `freelance-test-${process.pid}`
        };
        const first = await writeFreelanceMovement(client, payment, 'qa');
        assert.equal(first.idempotent, false);
        const replay = await writeFreelanceMovement(client, payment, 'qa');
        assert.equal(replay.movement.id, first.movement.id);
        assert.equal(replay.idempotent, true);
        await assert.rejects(writeFreelanceMovement(client, { ...payment, amount: 401 }, 'qa'), {
            code: 'FREELANCE_PAYMENT_KEY_CONFLICT'
        });
        await assert.rejects(writeFreelanceMovement(client, {
            ...payment, amount: 472, idempotencyKey: payment.idempotencyKey + '-over'
        }, 'qa'), { code: 'FREELANCE_PAYMENT_EXCEEDS_BALANCE' });
        const findSettlement = async day => (await listFreelanceSettlement(client, day))
            .find(row => row.segment_id === freelanceId);
        let settlement = await findSettlement('2026-11-12');
        assert.deepEqual([settlement.status, settlement.paid, settlement.outstanding], ['partially_paid', 400, 471]);
        await writeFreelanceMovement(client, {
            ...payment, amount: 471, idempotencyKey: payment.idempotencyKey + '-rest'
        }, 'qa');
        settlement = await findSettlement(date);
        assert.deepEqual([settlement.status, settlement.paid, settlement.outstanding], ['paid', 871, 0]);
        assert.equal(await findSettlement('2026-11-12'), undefined);
        await writeFreelanceMovement(client, {
            ...payment, categoryId: income.id, reversalOf: first.movement.id,
            reason: 'Synthetic reversal', idempotencyKey: payment.idempotencyKey + '-reverse'
        }, 'qa', true);
        settlement = await findSettlement('2026-11-12');
        assert.deepEqual([settlement.status, settlement.paid, settlement.outstanding], ['partially_paid', 471, 400]);
        const { rows: [finance] } = await client.query(
            'SELECT source, type, amount, date::text, recognition_date::text FROM finance_transactions WHERE id = $1',
            [first.movement.finance_transaction_id]
        );
        assert.deepEqual(finance, {
            source: 'hr_freelance', type: 'expense', amount: 400, date, recognition_date: date
        });
        await client.query('SAVEPOINT edit_freelance_payment');
        await assert.rejects(client.query(
            'UPDATE finance_transactions SET amount = 500 WHERE id = $1', [first.movement.finance_transaction_id]
        ), { constraint: 'hr_freelance_finance_immutable' });
        await client.query('ROLLBACK TO SAVEPOINT edit_freelance_payment');

        await client.query('SAVEPOINT delete_confirmed_block');
        await assert.rejects(client.query('DELETE FROM hr_shift_segments WHERE id = $1', [freelanceId]), {
            code: '23503'
        });
        await client.query('ROLLBACK TO SAVEPOINT delete_confirmed_block');
    } finally {
        if (client) {
            await client.query('ROLLBACK').finally(() => client.release());
        }
        await db.end();
    }
});
