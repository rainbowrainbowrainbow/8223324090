'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    cancelAttendanceClockOut,
    HR_TODAY_MANUAL_DEPARTURE_SQL,
    recordAttendanceClockIn,
    recordAttendanceClockOut,
    recordAttendanceStatus
} = require('../../services/hrAttendance');

const enabled = process.env.RUN_HR_ATTENDANCE_COMPENSATION_INTEGRATION === 'true';
const FIXTURE_DATE = '2026-07-22';

test('undoing a manual departure restores the same shift and allows a fresh close', { skip: !enabled }, async () => {
    const testDb = requireIsolatedDatabase();
    const pool = new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 1
    });
    const client = await pool.connect();
    try {
        const { rows: [{ id: staffId }] } = await client.query(
            `INSERT INTO staff (name, department, position, role_type, is_active, hourly_rate)
             VALUES ('Fictional Undo Departure', 'admin', 'Disposable fixture', 'wardrobe', true, 100)
             RETURNING id`
        );
        const input = { staffId, recordDate: FIXTURE_DATE, businessContext: 'event_genix',
            performedBy: 'isolated_test', source: 'hr_today', method: 'manual' };
        const breaks = [{ startedAt: '2026-07-22T10:00:00.000Z', endedAt: '2026-07-22T10:15:00.000Z' }];
        await client.query('BEGIN');
        const { record: arrived } = await recordAttendanceClockIn(client, { ...input, now: '2026-07-22T08:00:00Z' });
        await client.query('UPDATE hr_time_records SET break_intervals = $2::jsonb WHERE id = $1',
            [arrived.id, JSON.stringify(breaks)]);
        await client.query('COMMIT');
        const target = { ...input, recordId: arrived.id };
        const readEligibility = async () => (await client.query(
            `SELECT EXISTS (${HR_TODAY_MANUAL_DEPARTURE_SQL}) AS eligible FROM hr_time_records tr WHERE tr.id = $1`,
            [arrived.id]
        )).rows[0].eligible;
        const close = async (expectedVersion, now) => {
            await client.query('BEGIN');
            const result = await recordAttendanceClockOut(client, { ...target, expectedVersion, now });
            await client.query('COMMIT');
            return result.record;
        };
        const closed = await close(arrived.record_version, '2026-07-22T15:00:00Z');
        assert.equal(await readEligibility(), true);
        assert.ok(closed.total_worked_minutes > 0);
        assert.equal(closed.compensation_snapshot.finalizedAt, '2026-07-22T15:00:00.000Z');
        const undo = { ...target, version: closed.record_version };
        await client.query('BEGIN');
        await client.query(
            "INSERT INTO staff_checkins (staff_id, date, check_out) VALUES ($1, $2, '2026-07-22T15:00:00Z')",
            [staffId, FIXTURE_DATE]
        );
        assert.equal(await readEligibility(), false);
        await assert.rejects(cancelAttendanceClockOut(client, undo), { code: 'ATTENDANCE_DEPARTURE_NOT_CANCELLABLE' });
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        await client.query(
            "INSERT INTO payroll_reports (staff_id, period_month, status) VALUES ($1, $2, 'approved')",
            [staffId, FIXTURE_DATE.slice(0, 7)]
        );
        await assert.rejects(cancelAttendanceClockOut(client, undo), { code: 'ATTENDANCE_DEPARTURE_ALREADY_ACCOUNTED' });
        await client.query('ROLLBACK');

        await client.query('BEGIN');
        await assert.rejects(cancelAttendanceClockOut(client, { ...undo, version: 'stale' }),
            { code: 'ATTENDANCE_DEPARTURE_NOT_CANCELLABLE' });
        await assert.rejects(cancelAttendanceClockOut(client, { ...undo, businessContext: 'dar' }),
            { code: 'ATTENDANCE_DEPARTURE_NOT_CANCELLABLE' });
        const reopened = await cancelAttendanceClockOut(client, undo);
        await client.query('COMMIT');
        assert.equal(reopened.id, arrived.id);
        assert.deepEqual(reopened.clock_in, arrived.clock_in);
        assert.deepEqual(reopened.break_intervals, breaks);
        assert.equal(reopened.clock_out, null);
        assert.equal(reopened.total_worked_minutes, 0);
        assert.equal(reopened.early_leave_minutes, 0);
        assert.equal(reopened.overtime_minutes, 0);
        assert.deepEqual(reopened.compensation_snapshot, arrived.compensation_snapshot);
        assert.equal(await readEligibility(), false);
        await client.query('BEGIN');
        await assert.rejects(recordAttendanceClockOut(client, {
            ...target, expectedVersion: arrived.record_version, now: '2026-07-22T15:00:00Z'
        }), { code: 'ATTENDANCE_DEPARTURE_STALE' });
        await client.query('ROLLBACK');

        const closedAgain = await close(reopened.record_version, '2026-07-22T17:00:00Z');
        assert.ok(closedAgain.total_worked_minutes > closed.total_worked_minutes);
        await client.query('BEGIN');
        await assert.rejects(cancelAttendanceClockOut(client, undo),
            { code: 'ATTENDANCE_DEPARTURE_NOT_CANCELLABLE' });
        // Simulate a departure written by the earlier app, before the audit kept the prior snapshot.
        await client.query(
            `UPDATE hr_audit_log SET details = details - 'before_close'
             WHERE staff_id = $1 AND action = 'clock_out' AND created_at::text = $2`,
            [staffId, closedAgain.record_version]
        );
        const legacyReopened = await cancelAttendanceClockOut(client, { ...target, version: closedAgain.record_version });
        assert.deepEqual(legacyReopened.compensation_snapshot, arrived.compensation_snapshot);
        const { rows: audit } = await client.query(
            "SELECT details->>'clock_out' AS clock_out FROM hr_audit_log WHERE staff_id = $1 AND action = 'clock_out_cancelled' ORDER BY id",
            [staffId]
        );
        assert.deepEqual(audit.map(row => row.clock_out), ['2026-07-22T15:00:00.000Z', '2026-07-22T17:00:00.000Z']);
        await client.query('COMMIT');
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        await pool.end();
    }
});

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_HR_ATTENDANCE_COMPENSATION_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

describe('attendance compensation snapshot on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let client;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = new Pool({
            connectionString: testDb.url.toString(),
            ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
            max: 1,
            connectionTimeoutMillis: 10_000
        });
        client = await pool.connect();
        await client.query('BEGIN');
    });

    after(async () => {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
        }
        await pool?.end();
    });

    test('clock-in freezes the paid role and clock-out keeps physical and compensation minutes independent', async () => {
        const suffix = `${process.pid}-${Date.now()}`;
        const staffResult = await client.query(
            `INSERT INTO staff (name, department, position, role_type, is_active, hourly_rate)
             VALUES ($1, 'admin', 'Disposable compensation fixture', 'wardrobe', true, 100)
             RETURNING id`,
            [`Fictional Attendance Compensation ${suffix}`]
        );
        const staffId = Number(staffResult.rows[0].id);

        await client.query(
            `UPDATE hr_compensation_policies
             SET effective_from = $1::date,
                 status = 'active',
                 activated_by = 'isolated_test',
                 activated_at = NOW(),
                 updated_at = NOW()
             WHERE policy_version = 'simultaneous-profession-pay-v1'`,
            [FIXTURE_DATE]
        );
        await client.query(
            `INSERT INTO staff_profession_rates (staff_id, profession_key, hourly_rate)
             VALUES ($1, 'hallkeeper', 180)`,
            [staffId]
        );

        const shiftResult = await client.query(
            `INSERT INTO hr_shifts (
                staff_id, shift_date, planned_start, planned_end,
                break_minutes, shift_type, profession_key, created_by
             )
             VALUES ($1, $2::date, '11:00', '20:00', 0, 'regular', 'wardrobe', 'isolated_test')
             RETURNING id`,
            [staffId, FIXTURE_DATE]
        );
        const shiftId = Number(shiftResult.rows[0].id);
        const segmentResult = await client.query(
            `INSERT INTO hr_shift_segments (
                hr_shift_id, profession_key, planned_start, planned_end,
                break_minutes, sort_order, created_by, updated_by
             )
             VALUES
                ($1, 'wardrobe', '11:00', '11:30', 0, 0, 'isolated_test', 'isolated_test'),
                ($1, 'wardrobe', '11:30', '20:00', 0, 1, 'isolated_test', 'isolated_test')
             RETURNING id, sort_order`,
            [shiftId]
        );
        const paidSegmentId = Number(
            segmentResult.rows.find(row => Number(row.sort_order) === 1).id
        );
        await client.query(
            `INSERT INTO hr_shift_segment_roles (
                segment_id, profession_key, compensation_mode, pay_multiplier, policy_version
             )
             VALUES (
                $1, 'hallkeeper', 'paid_hourly', 1.0, 'simultaneous-profession-pay-v1'
             )`,
            [paidSegmentId]
        );

        await client.query(`INSERT INTO staff_role_assignments
            (staff_id, profession_key, is_primary, status, admission_status, internship_status, created_by, updated_by)
            VALUES ($1, 'hallkeeper', false, 'active', 'approved', 'none', 'isolated_test', 'isolated_test')`, [staffId]);
        const clockInResult = await recordAttendanceClockIn(client, {
            staffId,
            recordDate: FIXTURE_DATE,
            now: '2026-07-22T08:00:00.000Z',
            performedBy: 'isolated_test'
        });
        assert.equal(clockInResult.record.compensation_snapshot.state, 'planned');
        assert.equal(
            clockInResult.record.compensation_snapshot.compensationAllocations
                .find(allocation => allocation.allocationType === 'simultaneous_additional').rate,
            180
        );

        await client.query(
            `UPDATE hr_shift_segments
             SET planned_start = '12:00', planned_end = '19:00', updated_at = NOW()
             WHERE id = $1`,
            [paidSegmentId]
        );

        const clockOutResult = await recordAttendanceClockOut(client, {
            staffId,
            recordDate: FIXTURE_DATE,
            now: '2026-07-22T17:00:00.000Z',
            settlementMode: 'actual_time',
            performedBy: 'isolated_test'
        });
        const snapshot = clockOutResult.record.compensation_snapshot;
        assert.equal(clockOutResult.record.total_worked_minutes, 540);
        assert.equal(snapshot.totals.physicalMinutes, 540);
        assert.equal(snapshot.totals.physicalAllocationMinutes, 540);
        assert.equal(snapshot.totals.baseMinutes, 540);
        assert.equal(snapshot.totals.simultaneousAdditionalMinutes, 510);
        assert.equal(snapshot.totals.compensationMinutes, 1050);

        await client.query(
            `UPDATE hr_shift_segments
             SET planned_start = '13:00', planned_end = '18:00', updated_at = NOW()
             WHERE id = $1`,
            [paidSegmentId]
        );
        const repeatedClockOut = await recordAttendanceClockOut(client, {
            staffId,
            recordDate: FIXTURE_DATE,
            now: '2026-07-22T18:00:00.000Z',
            performedBy: 'isolated_test'
        });
        assert.equal(repeatedClockOut.alreadyClockedOut, true);
        assert.deepEqual(
            repeatedClockOut.record.compensation_snapshot,
            snapshot,
            'closed attendance must not be recalculated from the edited schedule'
        );
    });

    test('terminal base-only attendance is finalized atomically and cannot overwrite worked time', async () => {
        const suffix = `${process.pid}-${Date.now()}`;
        const staffResult = await client.query(
            `INSERT INTO staff (name, department, position, role_type, is_active, hourly_rate)
             VALUES ($1, 'admin', 'Disposable status fixture', 'wardrobe', true, 100)
             RETURNING id`,
            [`Fictional Attendance Status ${suffix}`]
        );
        const staffId = Number(staffResult.rows[0].id);
        const statusDate = '2026-07-23';
        await client.query(
            `INSERT INTO hr_shifts (
                staff_id, shift_date, planned_start, planned_end,
                break_minutes, shift_type, profession_key, created_by
             )
             VALUES ($1, $2::date, '11:00', '20:00', 0, 'regular', 'wardrobe', 'isolated_test')`,
            [staffId, statusDate]
        );

        const statusResult = await recordAttendanceStatus(client, {
            staffId,
            recordDate: statusDate,
            status: 'no_show',
            notes: 'isolated scheduler verification',
            now: '2026-07-23T12:00:00.000Z',
            source: 'isolated_no_show',
            performedBy: 'isolated_test'
        });
        assert.equal(statusResult.record.status, 'no_show');
        assert.equal(statusResult.compensationSnapshot.state, 'final');
        assert.equal(statusResult.compensationSnapshot.totals.physicalMinutes, 0);
        assert.equal(statusResult.compensationSnapshot.totals.baseMinutes, 0);
        assert.equal(statusResult.compensationSnapshot.totals.simultaneousAdditionalMinutes, 0);

        const persisted = await client.query(
            `SELECT compensation_snapshot
             FROM hr_time_records
             WHERE staff_id = $1 AND record_date = $2::date`,
            [staffId, statusDate]
        );
        assert.equal(persisted.rows[0].compensation_snapshot.state, 'final');
        assert.equal(persisted.rows[0].compensation_snapshot.legacyBaseOnly, false);

        await client.query(
            `UPDATE hr_time_records
             SET clock_in = '2026-07-23T08:00:00.000Z',
                 clock_out = '2026-07-23T17:00:00.000Z',
                 total_worked_minutes = 540
             WHERE staff_id = $1 AND record_date = $2::date`,
            [staffId, statusDate]
        );
        await assert.rejects(
            recordAttendanceStatus(client, {
                staffId,
                recordDate: statusDate,
                status: 'vacation'
            }),
            error => error.code === 'ATTENDANCE_STATUS_CONFLICT' && error.statusCode === 409
        );
    });
});
