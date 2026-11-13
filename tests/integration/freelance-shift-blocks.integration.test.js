'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { loadHrShiftDayPlan, saveHrShiftDayPlan } = require('../../services/hrShiftSegments');
const { hydrateAttendanceRecords } = require('../../services/hrAttendance');
const { loadPayrollAttendanceMetrics } = require('../../services/payroll');

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

        const { rows: [fact] } = await client.query(
            `INSERT INTO hr_time_records (staff_id, record_date, clock_in, clock_out, status)
             VALUES ($1, $2, $3, $4, 'present') RETURNING *`,
            [staff.id, date, '2026-11-11T09:00:00+02:00', '2026-11-11T20:00:00+02:00']
        );
        const [attendance] = await hydrateAttendanceRecords(client, [fact]);
        assert.deepEqual(attendance.segmentAllocations.map(segment => [
            segment.workMode || 'regular', segment.actualMinutes
        ]), [['regular', 240], ['freelance', 300]]);
        const metrics = (await loadPayrollAttendanceMetrics({
            from: date, to: date, staffIds: [staff.id]
        }, client)).get(staff.id);
        assert.ok(metrics.payrollBlockingIssues.some(
            issue => issue.code === 'PAYROLL_FREELANCE_TIME_REQUIRES_CONFIRMATION'
        ));
        assert.equal(metrics.totalMinutes, 0);
    } finally {
        if (client) {
            await client.query('ROLLBACK').finally(() => client.release());
        }
        await db.end();
    }
});
