'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { loadHrShiftDayPlan, saveHrShiftDayPlan } = require('../../services/hrShiftSegments');
const { mutateStaffScheduleBatch } = require('../../services/staffScheduleMutations');
const { cleanupFutureStaffOperationalSchedule, previewStaffOperationalScheduleCleanup } = require('../../services/staffLifecycle');
const { loadScope: loadSubstitutionScope } = require('../../services/staffSubstitutionSources');
const {
    allocateAttendanceToSegments, buildAttendanceCompensationPlanSnapshot,
    finalizeAttendanceCompensationSnapshot, hydrateAttendanceRecords
} = require('../../services/hrAttendance');
const { calculateProfessionPay, loadPayrollAttendanceMetrics } = require('../../services/payroll');
const {
    agreeFreelanceSegmentTerms, confirmFreelanceAttendance, insertFreelanceRateVersion,
    listFreelanceSettlement, listFreelanceWorkDay, prepareFreelanceReassignment, writeFreelanceMovement
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
            `INSERT INTO staff (name, department, position, role_type, is_active, hourly_rate)
             VALUES ('Freelance Shift QA', 'QA', 'QA', $1, true, 120) RETURNING id`,
            [profession]
        );
        const selector = { staffId: staff.id, shiftDate: date };
        const separateDate = '2026-11-12';
        const separate = await saveHrShiftDayPlan(client, {
            staffId: staff.id, shiftDate: separateDate,
            payload: {
                primaryProfessionKey: profession,
                segments: [{ professionKey: profession, shiftStart: '09:00', shiftEnd: '12:00', workMode: 'freelance' }]
            }
        });
        const separateSegmentId = separate.plan.segments[0].id;
        const substitution = await loadSubstitutionScope(client, 'event_genix', {}, {
            sourceType: 'hr_shift', sourceId: separate.shift.id, slotKey: 'primary', workDate: separateDate,
            originalStaffId: staff.id, staffId: staff.id + 1, professionKey: profession, breakMinutes: separate.plan.breakMinutes,
            startsAt: '2026-11-12T07:00:00.000Z', endsAt: '2026-11-12T10:00:00.000Z',
            payMode: 'replace_base', originalTreatment: 'transfer_unworked_scope'
        });
        assert.deepEqual(substitution.blockers.map(item => item.code), ['SUBSTITUTION_FREELANCE_SHIFT_UNSUPPORTED']);
        const { rows: [separateFact] } = await client.query(
            `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status, business_context)
             VALUES ($1, $2, $3, $4, 'present', 'event_genix') RETURNING id`,
            [staff.id, separateDate, '2026-11-12T09:00:00+02:00', '2026-11-12T12:00:00+02:00']
        );
        await assert.rejects(confirmFreelanceAttendance(client, {
            staffId: staff.id, date: separateDate, attendanceId: separateFact.id,
            allocations: [{ segmentId: separateSegmentId, minutes: 180 }]
        }, 'qa'), { code: 'FREELANCE_TERMS_REQUIRED' });
        assert.equal((await listFreelanceSettlement(client, separateDate))
            .some(row => row.segment_id === separateSegmentId), false);
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
        assert.deepEqual((await loadHrShiftDayPlan(client, { ...selector, shiftDate: separateDate }))
            .plan.segments.map(segment => segment.workMode), ['freelance']);
        const freelanceId = loaded.plan.segments[1].id;
        const { rows: [agreedDefault] } = await client.query(
            'SELECT source_version_id, rate FROM hr_freelance_segment_terms WHERE segment_id = $1',
            [freelanceId]
        );
        assert.notEqual(defaultVersion.id, personalVersion.id);
        assert.deepEqual(agreedDefault, { source_version_id: personalVersion.id, rate: '170.13' });
        const imported = await mutateStaffScheduleBatch(client, [{
            staffId: staff.id, date, status: 'working', shiftStart: '10:00', shiftEnd: '18:00',
            professionKey: profession
        }], { actor: 'qa', skipRosterReconcile: true });
        assert.equal(imported.ok, false);
        assert.equal(imported.code, 'HR_SHIFT_FREELANCE_EXPLICIT_PLAN_REQUIRED');
        const importedOffDay = await mutateStaffScheduleBatch(client, [{
            staffId: staff.id, date, status: 'dayoff'
        }], { actor: 'qa', skipRosterReconcile: true });
        assert.equal(importedOffDay.ok, false);
        assert.equal(importedOffDay.code, 'HR_SHIFT_FREELANCE_EXPLICIT_PLAN_REQUIRED');
        assert.deepEqual((await loadHrShiftDayPlan(client, selector)).plan.segments.map(block => block.workMode),
            ['regular', 'freelance']);
        await assert.rejects(prepareFreelanceReassignment(client, loaded, staff.id + 1, date), {
            code: 'FREELANCE_REASSIGNMENT_REQUIRES_NEW_AGREEMENT'
        });

        const clockIn = '2026-11-11T09:00:00+02:00';
        const clockOut = '2026-11-11T20:00:00+02:00';
        const snapshot = await buildAttendanceCompensationPlanSnapshot(client, {
            staffId: staff.id, recordDate: date, plan: loaded.plan
        });
        const finalized = finalizeAttendanceCompensationSnapshot(snapshot, allocateAttendanceToSegments({
            recordDate: date, clockIn, clockOut, segments: loaded.plan.segments, primaryProfessionKey: profession
        }));
        const { rows: [fact] } = await client.query(
            `INSERT INTO hr_time_records (
                 staff_id, record_date, clock_in, clock_out, status, business_context, compensation_snapshot
             ) VALUES ($1, $2, $3, $4, 'present', 'event_genix', $5::jsonb) RETURNING *`,
            [staff.id, date, clockIn, clockOut, JSON.stringify(finalized)]
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
        const hourly = calculateProfessionPay({ id: staff.id, role_type: profession }, {
            schemeType: 'hourly', config: {}
        }, confirmedMetrics);
        assert.equal(hourly.baseAmount, 480);
        assert.deepEqual(hourly.blockingIssues, []);
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

test('concurrent payments use the same balance and write a single finance movement', {
    skip: process.env.RUN_FREELANCE_SHIFT_INTEGRATION !== 'true'
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    const stamp = randomUUID();
    const date = '2026-11-10';
    const transaction = async run => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL statement_timeout = '10s'");
            const result = await run(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    };
    try {
        // The test target is disposable. Confirmed accounting records are append-only.
        const payment = await transaction(async client => {
            const profession = `qa_${stamp.slice(0, 8)}`;
            await client.query(
                "INSERT INTO hr_professions (key, title, department) VALUES ($1, 'Freelance race QA', 'QA')",
                [profession]
            );
            const { rows: [staff] } = await client.query(
                `INSERT INTO staff (name, department, position, role_type, is_active)
                 VALUES ($1, 'QA', 'QA', $2, true) RETURNING id`, [`Freelance race ${stamp}`, profession]
            );
            await insertFreelanceRateVersion(client, { professionKey: profession, rateUnit: 'fixed',
                rate: '450', effectiveFrom: date }, 'qa');
            const saved = await saveHrShiftDayPlan(client, { staffId: staff.id, shiftDate: date, payload: {
                primaryProfessionKey: profession,
                segments: [{ professionKey: profession, shiftStart: '09:00', shiftEnd: '12:00', workMode: 'freelance' }]
            } });
            const segmentId = saved.plan.segments[0].id;
            const { rows: [fact] } = await client.query(
                `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status, business_context)
                 VALUES ($1, $2, $3, $4, 'present', 'event_genix') RETURNING id`,
                [staff.id, date, '2026-11-10T09:00:00+02:00', '2026-11-10T12:00:00+02:00']
            );
            await confirmFreelanceAttendance(client, { staffId: staff.id, date, attendanceId: fact.id,
                allocations: [{ segmentId, minutes: 180 }] }, 'qa');
            const { rows: [expense] } = await client.query(
                "INSERT INTO finance_categories (name, type, business_context) VALUES ($1, 'expense', 'event_genix') RETURNING id",
                [`Freelance race ${stamp}`]
            );
            const { rows: [account] } = await client.query(
                "INSERT INTO finance_accounts (name, business_context) VALUES ($1, 'event_genix') RETURNING id",
                [`Freelance race ${stamp}`]
            );
            return { segmentId, paymentDate: date, categoryId: expense.id, accountId: account.id,
                amount: 450, paymentMethod: 'cash', reason: 'Synthetic concurrent payment' };
        });
        const pay = idempotencyKey => transaction(client => writeFreelanceMovement(client, {
            ...payment, idempotencyKey
        }, 'qa'));
        const race = await Promise.allSettled([pay(`${stamp}-1`), pay(`${stamp}-2`)]);
        assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
        assert.equal(race.find(item => item.status === 'rejected').reason.code, 'FREELANCE_PAYMENT_EXCEEDS_BALANCE');
        const winner = race.find(item => item.status === 'fulfilled').value.movement;
        assert.equal((await pay(winner.idempotency_key)).idempotent, true);
        const { rows } = await db.query(
            `SELECT finance.amount FROM hr_freelance_payment_movements movement
             JOIN finance_transactions finance ON finance.id = movement.finance_transaction_id
             WHERE movement.segment_id = $1`, [payment.segmentId]
        );
        assert.deepEqual(rows, [{ amount: 450 }]);
    } finally {
        await db.end();
    }
});

test('monthly terms permit an extra block but reject replacing planned regular work', {
    skip: process.env.RUN_FREELANCE_SHIFT_INTEGRATION !== 'true'
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');
        const profession = `qa_month_${process.pid}`;
        const date = '2026-11-09';
        await client.query(
            "INSERT INTO hr_professions (key, title, department) VALUES ($1, 'Monthly QA', 'QA')", [profession]
        );
        const { rows: [staff] } = await client.query(
            `INSERT INTO staff (name, department, position, role_type, rate_unit, hourly_rate, is_active)
             VALUES ('Synthetic Monthly QA', 'QA', 'QA', $1, 'month', 18000, true) RETURNING id`, [profession]
        );
        const selector = { staffId: staff.id, shiftDate: date };
        const regular = { professionKey: profession, shiftStart: '09:00', shiftEnd: '13:00', workMode: 'regular' };
        const freelance = { professionKey: profession, shiftStart: '15:00', shiftEnd: '17:00', workMode: 'freelance' };
        const save = segments => saveHrShiftDayPlan(client, {
            ...selector, payload: { primaryProfessionKey: profession, segments }
        });
        const original = await save([regular]);
        const saved = await save([{ ...regular, id: original.plan.segments[0].id }, freelance]);
        assert.deepEqual(saved.plan.segments.map(block => block.workMode), ['regular', 'freelance']);
        await client.query('SAVEPOINT replace_monthly_work');
        await assert.rejects(save([{
            ...regular, id: saved.plan.segments[0].id, workMode: 'freelance'
        }, { ...freelance, id: saved.plan.segments[1].id }]), {
            code: 'FREELANCE_MONTHLY_REPLACEMENT_UNSUPPORTED'
        });
        await client.query('ROLLBACK TO SAVEPOINT replace_monthly_work');
        assert.deepEqual((await loadHrShiftDayPlan(client, selector)).plan.segments.map(block => block.workMode),
            ['regular', 'freelance']);
        assert.equal((await client.query('SELECT hourly_rate FROM staff WHERE id = $1', [staff.id])).rows[0].hourly_rate,
            '18000.00');
    } finally {
        if (client) await client.query('ROLLBACK').finally(() => client.release());
        await db.end();
    }
});

test('overnight fact deducts tracked breaks once and protects the confirmed allocation', {
    skip: process.env.RUN_FREELANCE_SHIFT_INTEGRATION !== 'true'
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true, 'Freelance tests use local PostgreSQL');
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    const client = await db.connect();
    const { recordAttendanceBreak } = require('../../services/hrAttendanceBreaks');
    try {
        await client.query('BEGIN');
        const date = '2026-11-10';
        const profession = 'freelance_night_qa';
        await client.query('INSERT INTO hr_professions (key, title, department) VALUES ($1, $2, $3)',
            [profession, 'Freelance night QA', 'QA']);
        const { rows: [staff] } = await client.query(
            `INSERT INTO staff (name, department, position, role_type, is_active, hourly_rate)
             VALUES ('Freelance night QA', 'QA', 'QA', $1, true, 120) RETURNING id`, [profession]
        );
        await insertFreelanceRateVersion(client, {
            professionKey: profession, staffId: staff.id, rateUnit: 'hour', rate: '120', effectiveFrom: date
        }, 'qa');
        const selector = { staffId: staff.id, shiftDate: date };
        const { plan } = await saveHrShiftDayPlan(client, {
            ...selector, payload: { primaryProfessionKey: profession, segments: [
                { professionKey: profession, shiftStart: '22:00', shiftEnd: '00:00', startDayOffset: 0, endDayOffset: 1, breakMinutes: 20 },
                { professionKey: profession, shiftStart: '00:00', shiftEnd: '02:00', startDayOffset: 1, endDayOffset: 1, breakMinutes: 20, workMode: 'freelance' }
            ] }
        });
        const [regular, freelance] = plan.segments;
        const { rows: [fact] } = await client.query(
            `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status, business_context,
                     total_worked_minutes, break_intervals)
             VALUES ($1, $2, $3, $4, 'present', 'event_genix', 240, $5::jsonb)
             RETURNING id, updated_at::text AS version`,
            [staff.id, date, '2026-11-10T22:00:00+02:00', '2026-11-11T02:10:00+02:00',
                JSON.stringify([{ startedAt: '2026-11-10T23:45:00+02:00', endedAt: null }])]
        );
        const input = {
            staffId: staff.id, date, attendanceId: fact.id,
            allocations: [{ segmentId: regular.id, minutes: 105 }, { segmentId: freelance.id, minutes: 115 }]
        };
        assert.equal((await listFreelanceWorkDay(client, date, staff.id))[0].attendanceState, 'review');
        await assert.rejects(confirmFreelanceAttendance(client, input, 'qa'), { code: 'FREELANCE_ATTENDANCE_NOT_CLOSED' });
        await assert.rejects(saveHrShiftDayPlan(client, {
            ...selector, payload: { primaryProfessionKey: profession, segments: [
                regular, { ...freelance, shiftEnd: '02:30' }
            ] }
        }), { code: 'FREELANCE_PLAN_IN_USE' });
        await assert.rejects(saveHrShiftDayPlan(client, {
            ...selector, payload: { status: 'dayoff', segments: [] }
        }), { code: 'FREELANCE_PLAN_IN_USE' });
        const breakReview = {
            recordId: fact.id, staffId: staff.id, recordDate: date, businessContext: 'event_genix',
            action: 'confirm', version: fact.version, endedAt: '2026-11-11T00:15:00+02:00',
            reason: 'Synthetic HR reconciliation', performedBy: 'qa'
        };
        const corrected = await recordAttendanceBreak(client, breakReview);
        const { rows: [updatedFact] } = await client.query(
            'SELECT total_worked_minutes FROM hr_time_records WHERE id = $1', [fact.id]
        );
        assert.equal(updatedFact.total_worked_minutes, 220);
        const [ready] = await listFreelanceWorkDay(client, date, staff.id);
        assert.equal(ready.attendanceState, 'ready');
        assert.equal(ready.actualMinutes, 220);
        assert.equal(ready.unassignedMinutes, 10);
        assert.deepEqual(ready.segments.map(segment => segment.observedMinutes), [105, 105]);
        assert.deepEqual(ready.segments[1].actualIntervals, [{ start: 1455, end: 1560 }]);
        assert.equal(ready.segments[1].plannedMinutes, 100);
        await assert.rejects(confirmFreelanceAttendance(client, { ...input, recordVersion: 'stale' }, 'qa'),
            { code: 'FREELANCE_ATTENDANCE_STALE' });
        await assert.rejects(confirmFreelanceAttendance(client, input, 'qa'), { code: 'FREELANCE_INVALID_TEXT' });
        await assert.rejects(confirmFreelanceAttendance(client, {
            ...input, allocations: [{ segmentId: regular.id, minutes: 70 }, { segmentId: freelance.id, minutes: 150 }],
            allocationReason: 'Trying to move observed time'
        }, 'qa'), { code: 'FREELANCE_INVALID_ALLOCATION' });
        const result = await confirmFreelanceAttendance(client, {
            ...input, recordVersion: corrected.record_version, allocationReason: 'Synthetic work after the plan'
        }, 'qa');
        assert.deepEqual(result.blocks.map(segment => segment.minutes), [105, 115]);
        await assert.rejects(recordAttendanceBreak(client, { ...breakReview, version: corrected.record_version }),
            { code: 'FREELANCE_ATTENDANCE_LOCKED' });
        const [confirmed] = await listFreelanceWorkDay(client, date, staff.id);
        assert.equal(confirmed.attendanceState, 'confirmed');
        assert.equal(confirmed.actualMinutes, 220);
        assert.equal(confirmed.segments[1].confirmedMinutes, 115);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await db.end();
    }
});

test('staff offboarding preserves both schedule projections for agreed freelance and attendance', {
    skip: process.env.RUN_FREELANCE_SHIFT_INTEGRATION !== 'true'
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true, 'Freelance tests use local PostgreSQL');
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    let client;
    try {
        client = await db.connect();
        await client.query('BEGIN');
        const profession = 'freelance_offboarding_qa';
        await client.query(
            'INSERT INTO hr_professions (key, title, department) VALUES ($1, $2, $3)',
            [profession, 'Freelance offboarding QA', 'QA']
        );
        const { rows: [staff] } = await client.query(
            `INSERT INTO staff (name, department, position, role_type, is_active)
             VALUES ('Freelance Offboarding QA', 'QA', 'QA', $1, true) RETURNING id`,
            [profession]
        );
        const attendanceDate = '2026-11-27';
        const unpricedDate = '2026-11-28';
        const agreedDate = '2026-11-29';
        const ordinaryDate = '2026-11-30';
        await insertFreelanceRateVersion(client, {
            professionKey: profession, rateUnit: 'hour', rate: '120', effectiveFrom: agreedDate
        }, 'qa');
        for (const [date, workMode] of [
            [attendanceDate, 'regular'], [unpricedDate, 'freelance'],
            [agreedDate, 'freelance'], [ordinaryDate, 'regular']
        ]) {
            await saveHrShiftDayPlan(client, {
                staffId: staff.id, shiftDate: date,
                payload: {
                    primaryProfessionKey: profession,
                    segments: [{ professionKey: profession, shiftStart: '12:00', shiftEnd: '16:00', workMode }]
                }
            });
            await client.query(
                `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, profession_key)
                 VALUES ($1, $2, '12:00', '16:00', 'working', $3)`,
                [staff.id, date, profession]
            );
        }
        await client.query(
            `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status, business_context)
             VALUES ($1, $2, $3, $4, 'present', 'event_genix')`,
            [staff.id, attendanceDate, '2026-11-27T12:10:00+02:00', '2026-11-27T16:00:00+02:00']
        );
        const readTerms = async () => (await client.query(
            `SELECT terms.id, hs.shift_date::text AS date
             FROM hr_freelance_segment_terms terms
             JOIN hr_shift_segments segment ON segment.id = terms.segment_id
             JOIN hr_shifts hs ON hs.id = segment.hr_shift_id
             WHERE hs.staff_id = $1
             ORDER BY terms.id`,
            [staff.id]
        )).rows;
        const terms = await readTerms();
        assert.deepEqual(terms.map(row => row.date), [agreedDate]);

        if (previewStaffOperationalScheduleCleanup) {
            assert.deepEqual(await previewStaffOperationalScheduleCleanup(client, staff.id, attendanceDate), {
                hr_shifts: 2, staff_schedule: 2,
                preserved_hr_shifts: 2, preserved_staff_schedule: 2, from_date: attendanceDate
            });
        }
        const cleanup = await cleanupFutureStaffOperationalSchedule(client, staff.id, attendanceDate);
        assert.equal(cleanup.hr_shifts, 2);
        assert.equal(cleanup.staff_schedule, 2);
        assert.deepEqual(cleanup.dates, [unpricedDate, ordinaryDate]);

        const projections = await client.query(
            `SELECT shift_date::text AS date, 'hr' AS source FROM hr_shifts WHERE staff_id = $1
             UNION ALL
             SELECT date, 'schedule' AS source FROM staff_schedule WHERE staff_id = $1
             ORDER BY date, source`,
            [staff.id]
        );
        assert.deepEqual(projections.rows, [
            { date: attendanceDate, source: 'hr' }, { date: attendanceDate, source: 'schedule' },
            { date: agreedDate, source: 'hr' }, { date: agreedDate, source: 'schedule' }
        ]);
        assert.deepEqual(await readTerms(), terms);
        const repeated = await cleanupFutureStaffOperationalSchedule(client, staff.id, attendanceDate);
        assert.equal(repeated.hr_shifts, 0);
        assert.equal(repeated.staff_schedule, 0);
    } finally {
        if (client) await client.query('ROLLBACK').finally(() => client.release());
        await db.end();
    }
});
