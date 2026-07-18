'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('../helpers');
const { pool } = require('../../db');
const {
    LIVE_MULTI_SEGMENT_QA_CONFIRMATION,
    LIVE_MULTI_SEGMENT_QA_FINANCIAL_PROOF_VERSION
} = require('../../services/liveMultiSegmentQa');

const enabled = process.env.RUN_LIVE_MULTI_SEGMENT_QA_INTEGRATION === 'true';
const runId = `isolated_${process.pid}_${Date.now()}`;
const date = '2099-06-01';
const primaryProfession = 'wardrobe';
const additionalProfession = 'cleaner';
let staffId = 0;
let cleanupConfirmed = false;

async function cleanupFixture() {
    if (!staffId || cleanupConfirmed) return;
    const response = await authRequest('DELETE', `/api/hr/qa/multi-segment/${runId}`, {
        staffId,
        confirmation: LIVE_MULTI_SEGMENT_QA_CONFIRMATION
    });
    assert.equal(response.status, 200, `QA helper cleanup returned ${response.status}`);
    assert.equal(response.data?.data?.after?.confirmedClean, true);
    cleanupConfirmed = true;
}

after(async () => {
    if (!enabled) return;
    await cleanupFixture();
});

test('isolated live QA helper preserves 540 physical minutes and 510 paid simultaneous minutes', { skip: !enabled }, async () => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');

    const created = await authRequest('POST', '/api/staff', {
        name: `Disposable QA Multi Segment ${runId}`,
        department: 'qa',
        position: 'Disposable QA integration',
        role_type: primaryProfession,
        secondaryProfessions: [additionalProfession]
    });
    staffId = Number(created.data?.data?.id);
    assert.equal(created.status, 200);
    assert.ok(Number.isInteger(staffId) && staffId > 0);

    const profile = await authRequest('PUT', `/api/hr/staff/${staffId}`, {
        role_type: primaryProfession,
        secondary_professions: [additionalProfession],
        hourly_rate: 100,
        rate_unit: 'hour',
        profession_rates: [
            { profession_key: primaryProfession, hourly_rate: 100 },
            { profession_key: additionalProfession, hourly_rate: 200 }
        ],
        notes: `live_multi_segment_qa:${runId}`
    });
    assert.equal(profile.status, 200);

    const assignments = await authRequest('PUT', `/api/hr/staff/${staffId}/role-assignments`, {
        primary_role: primaryProfession,
        assignments: [
            {
                profession_key: primaryProfession,
                is_primary: true,
                status: 'active',
                admission_status: 'approved',
                internship_status: 'none',
                hourly_rate: 100,
                notes: `live_multi_segment_qa:${runId}`
            },
            {
                profession_key: additionalProfession,
                is_primary: false,
                status: 'active',
                admission_status: 'approved',
                internship_status: 'none',
                hourly_rate: 200,
                notes: `live_multi_segment_qa:${runId}`
            }
        ]
    });
    assert.equal(assignments.status, 200);
    assert.deepEqual(
        (assignments.data?.data || [])
            .map(row => [row.profession_key, row.status, row.admission_status])
            .sort((left, right) => left[0].localeCompare(right[0])),
        [
            [additionalProfession, 'active', 'approved'],
            [primaryProfession, 'active', 'approved']
        ].sort((left, right) => left[0].localeCompare(right[0]))
    );

    const compatibilitySegments = () => [
        {
            professionKey: primaryProfession,
            shiftStart: '11:00',
            shiftEnd: '11:30',
            breakMinutes: 0,
            additionalProfessionKeys: [],
            additionalRoles: []
        },
        {
            professionKey: primaryProfession,
            shiftStart: '11:30',
            shiftEnd: '20:00',
            breakMinutes: 0,
            additionalProfessionKeys: [additionalProfession],
            paidAdditionalProfessionKeys: [additionalProfession]
        }
    ];
    const schedule = await authRequest('PUT', '/api/staff/schedule', {
        staffId,
        date,
        status: 'working',
        note: `live_multi_segment_qa:${runId}`,
        professionKey: primaryProfession,
        primaryProfessionKey: primaryProfession,
        shiftStart: '11:00',
        shiftEnd: '20:00',
        segments: compatibilitySegments()
    });
    assert.equal(schedule.status, 200);
    assert.equal(schedule.data?.data?.planned_minutes, 540);

    const reloaded = await authRequest('GET', `/api/staff/schedule?from=${date}&to=${date}`);
    assert.equal(reloaded.status, 200);
    const savedDay = (reloaded.data?.data || []).find(row => Number(row.staff_id) === staffId);
    assert.ok(savedDay);
    assert.equal(Number(savedDay.planned_minutes), 540);
    assert.deepEqual(
        (savedDay.segments || []).map(segment => [
            segment.professionKey,
            segment.shiftStart,
            segment.shiftEnd
        ]),
        [
            [primaryProfession, '11:00', '11:30'],
            [primaryProfession, '11:30', '20:00']
        ]
    );
    assert.deepEqual(
        savedDay.segments[1].additionalRoles.map(role => [
            role.professionKey,
            role.compensationMode,
            Number(role.payMultiplier)
        ]),
        [[additionalProfession, 'paid_hourly', 1]]
    );
    assert.deepEqual(savedDay.segments[0].paidAdditionalProfessionKeys, []);
    assert.deepEqual(savedDay.segments[1].paidAdditionalProfessionKeys, [additionalProfession]);

    const bulk = await authRequest('POST', '/api/staff/schedule/bulk', {
        entries: [{
            staffId,
            date,
            status: 'working',
            note: `live_multi_segment_qa:${runId}`,
            primaryProfessionKey: primaryProfession,
            segments: compatibilitySegments()
        }]
    });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.data?.success, true);
    assert.equal(Number(bulk.data?.count), 1);

    const afterBulk = await authRequest('GET', `/api/staff/schedule?from=${date}&to=${date}`);
    const bulkDay = (afterBulk.data?.data || []).find(row => Number(row.staff_id) === staffId);
    assert.equal(afterBulk.status, 200);
    assert.deepEqual(bulkDay?.segments?.[1]?.paidAdditionalProfessionKeys, [additionalProfession]);
    assert.equal(bulkDay?.segments?.[1]?.additionalRoles?.[0]?.compensationMode, 'paid_hourly');

    const copiedDate = '2099-06-08';
    const copied = await authRequest('POST', '/api/staff/schedule/copy-week', {
        fromMonday: date,
        toMonday: copiedDate,
        staffIds: [staffId]
    });
    assert.equal(copied.status, 200);
    assert.equal(copied.data?.success, true);
    assert.equal(Number(copied.data?.count), 1);

    const copiedReload = await authRequest('GET', `/api/staff/schedule?from=${copiedDate}&to=${copiedDate}`);
    const copiedDay = (copiedReload.data?.data || []).find(row => Number(row.staff_id) === staffId);
    assert.equal(copiedReload.status, 200);
    assert.deepEqual(copiedDay?.segments?.[1]?.paidAdditionalProfessionKeys, [additionalProfession]);
    assert.equal(copiedDay?.segments?.[1]?.additionalRoles?.[0]?.compensationMode, 'paid_hourly');

    const attendance = await authRequest('POST', '/api/hr/qa/multi-segment/attendance', {
        runId,
        staffId,
        date,
        clockInTime: '11:00',
        clockOutTime: '20:00',
        confirmation: LIVE_MULTI_SEGMENT_QA_CONFIRMATION
    });
    assert.equal(attendance.status, 201);
    assert.equal(attendance.data?.data?.allocation_source, 'clock_interval');
    assert.equal(attendance.data?.data?.planned_minutes, 540);
    assert.equal(attendance.data?.data?.actual_minutes, 540);
    assert.deepEqual(attendance.data?.data?.segment_allocations?.map(row => [row.professionKey, row.actualMinutes]), [
        [primaryProfession, 30],
        [primaryProfession, 510]
    ]);

    const attendanceRead = await authRequest('GET', `/api/staff/attendance?from=${date}&to=${date}`);
    assert.equal(attendanceRead.status, 200);
    const attendanceRow = (attendanceRead.data?.data || []).find(row => Number(row.staff_id) === staffId);
    assert.ok(attendanceRow);
    assert.equal(Number(attendanceRow.actual_minutes), 540);
    const paidAllocation = (
        attendanceRow.compensation_snapshot?.compensationAllocations
        || attendanceRow.compensation_allocations
        || []
    ).find(row => (
        (row.allocationType || row.allocation_type) === 'simultaneous_additional'
        && (row.professionKey || row.profession_key) === additionalProfession
    ));
    assert.ok(paidAllocation);
    assert.equal(Number(paidAllocation.actualMinutes ?? paidAllocation.actual_minutes), 510);
    assert.equal(paidAllocation.policyVersion ?? paidAllocation.policy_version, 'simultaneous-profession-pay-v1');

    const preview = await authRequest('GET', `/api/payroll/preview?staffId=${staffId}&month=${date.slice(0, 7)}`);
    assert.equal(preview.status, 200);
    assert.equal(Number(preview.data?.preview?.physicalMinutes), 540);
    assert.equal(Number(preview.data?.preview?.payrollTransparency?.physicalHours), 9);
    assert.equal(Number(preview.data?.preview?.payrollTransparency?.additionalRoleHours), 8.5);
    assert.equal(
        Number(preview.data?.preview?.additionalProfessionAllocations?.[0]?.minutes),
        510
    );

    const before = await authRequest('GET', `/api/hr/qa/multi-segment/${runId}?staffId=${staffId}`);
    assert.equal(before.status, 200);
    assert.equal(before.data?.data?.counts?.shifts, 2);
    assert.equal(before.data?.data?.counts?.schedule, 2);
    assert.equal(before.data?.data?.counts?.attendance, 1);
    assert.equal(before.data?.data?.financialProofVersion, LIVE_MULTI_SEGMENT_QA_FINANCIAL_PROOF_VERSION);
    assert.equal(before.data?.data?.verificationComplete, true);
    assert.equal(before.data?.data?.financiallyClean, true);

    const finance = await pool.query(
        `INSERT INTO finance_transactions (type, amount, description, date, payment_method, staff_id, created_by)
         VALUES ('expense', 1, 'isolated synthetic live QA financial guard', $1, 'salary', $2, 'isolated_test')
         RETURNING id`,
        [date, staffId]
    );
    const financeId = Number(finance.rows[0].id);
    await pool.query(
        `INSERT INTO payroll_reports
            (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount, status, breakdown_json, finance_transaction_id, created_by, updated_by)
         VALUES ($1, $2, 1, 0, 0, 1, 'draft', '{}'::jsonb, $3, 'isolated_test', 'isolated_test')`,
        [date.slice(0, 7), staffId, financeId]
    );
    await pool.query(
        `INSERT INTO payroll_entries (staff_id, period_month, line_type, label, amount, created_by)
         VALUES ($1, $2, 'base', 'isolated synthetic live QA financial guard', 1, 'isolated_test')`,
        [staffId, date.slice(0, 7)]
    );
    const blockedCleanup = await authRequest('DELETE', `/api/hr/qa/multi-segment/${runId}`, {
        staffId,
        confirmation: LIVE_MULTI_SEGMENT_QA_CONFIRMATION
    });
    assert.equal(blockedCleanup.status, 409);
    assert.equal(blockedCleanup.data?.code, 'LIVE_QA_FINANCIAL_SIDE_EFFECTS_DETECTED');
    assert.equal(Number(blockedCleanup.data?.data?.financialCounts?.payrollReports), 1);
    assert.equal(Number(blockedCleanup.data?.data?.financialCounts?.payrollEntries), 1);
    assert.equal(Number(blockedCleanup.data?.data?.financialCounts?.financeTransactions), 1);

    const afterBlocked = await authRequest('GET', `/api/hr/qa/multi-segment/${runId}?staffId=${staffId}`);
    assert.equal(afterBlocked.status, 200);
    assert.equal(afterBlocked.data?.data?.archived, false);
    assert.equal(afterBlocked.data?.data?.counts?.shifts, 2);
    assert.equal(afterBlocked.data?.data?.counts?.schedule, 2);
    assert.equal(afterBlocked.data?.data?.counts?.attendance, 1);

    await pool.query('DELETE FROM payroll_entries WHERE staff_id = $1 AND period_month = $2', [staffId, date.slice(0, 7)]);
    await pool.query('DELETE FROM payroll_reports WHERE staff_id = $1 AND period_month = $2', [staffId, date.slice(0, 7)]);
    await pool.query('DELETE FROM finance_transactions WHERE id = $1 AND staff_id = $2', [financeId, staffId]);

    await cleanupFixture();
    const afterStatus = await authRequest('GET', `/api/hr/qa/multi-segment/${runId}?staffId=${staffId}`);
    assert.equal(afterStatus.status, 200);
    assert.equal(afterStatus.data?.data?.confirmedClean, true);
    assert.deepEqual(afterStatus.data?.data?.counts, {
        shifts: 0,
        schedule: 0,
        attendance: 0,
        checkins: 0,
        shiftPreferences: 0,
        timelineLines: 0
    });
    assert.equal(afterStatus.data?.data?.financialProofVersion, LIVE_MULTI_SEGMENT_QA_FINANCIAL_PROOF_VERSION);
    assert.equal(afterStatus.data?.data?.verificationComplete, true);
    assert.equal(afterStatus.data?.data?.fixtureRowsClean, true);
    assert.equal(afterStatus.data?.data?.financiallyClean, true);
    assert.equal(afterStatus.data?.data?.configurationClean, true);
    assert.equal(Number(afterStatus.data?.data?.financialCounts?.payrollReports), 0);
    assert.equal(Number(afterStatus.data?.data?.financialCounts?.payrollEntries), 0);
    assert.equal(Number(afterStatus.data?.data?.financialCounts?.salaryAdjustments), 0);
    assert.equal(Number(afterStatus.data?.data?.financialCounts?.financeTransactions), 0);
    assert.equal(Number(afterStatus.data?.data?.configurationCounts?.activePayrollSchemes), 0);
});
