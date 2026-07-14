'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('../helpers');
const { LIVE_MULTI_SEGMENT_QA_CONFIRMATION } = require('../../services/liveMultiSegmentQa');

const enabled = process.env.RUN_LIVE_MULTI_SEGMENT_QA_INTEGRATION === 'true';
const runId = `isolated_${process.pid}_${Date.now()}`;
const date = '2099-06-01';
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

test('isolated live QA helper creates allocated attendance and transactionally cleans the fixture', { skip: !enabled }, async () => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');

    const created = await authRequest('POST', '/api/staff', {
        name: `Disposable QA Multi Segment ${runId}`,
        department: 'qa',
        position: 'Disposable QA integration',
        role_type: 'reception',
        secondaryProfessions: ['manager', 'animator']
    });
    staffId = Number(created.data?.data?.id);
    assert.equal(created.status, 200);
    assert.ok(Number.isInteger(staffId) && staffId > 0);

    const profile = await authRequest('PUT', `/api/hr/staff/${staffId}`, {
        role_type: 'reception',
        secondary_professions: ['manager', 'animator'],
        notes: `live_multi_segment_qa:${runId}`
    });
    assert.equal(profile.status, 200);

    const schedule = await authRequest('PUT', '/api/staff/schedule', {
        staffId,
        date,
        status: 'working',
        note: `live_multi_segment_qa:${runId}`,
        professionKey: 'reception',
        primaryProfessionKey: 'reception',
        segments: [
            {
                professionKey: 'reception',
                shiftStart: '09:00',
                shiftEnd: '13:00',
                breakMinutes: 0,
                additionalProfessionKeys: ['animator']
            },
            {
                professionKey: 'manager',
                shiftStart: '15:00',
                shiftEnd: '20:00',
                breakMinutes: 30,
                additionalProfessionKeys: ['animator']
            }
        ]
    });
    assert.equal(schedule.status, 200);
    assert.equal(schedule.data?.data?.planned_minutes, 510);

    const attendance = await authRequest('POST', '/api/hr/qa/multi-segment/attendance', {
        runId,
        staffId,
        date,
        clockInTime: '09:00',
        clockOutTime: '20:00',
        confirmation: LIVE_MULTI_SEGMENT_QA_CONFIRMATION
    });
    assert.equal(attendance.status, 201);
    assert.equal(attendance.data?.data?.allocation_source, 'clock_interval');
    assert.equal(attendance.data?.data?.planned_minutes, 510);
    assert.equal(attendance.data?.data?.actual_minutes, 510);
    assert.deepEqual(attendance.data?.data?.segment_allocations?.map(row => [row.professionKey, row.actualMinutes]), [
        ['reception', 240],
        ['manager', 270]
    ]);

    const before = await authRequest('GET', `/api/hr/qa/multi-segment/${runId}?staffId=${staffId}`);
    assert.equal(before.status, 200);
    assert.equal(before.data?.data?.counts?.shifts, 1);
    assert.equal(before.data?.data?.counts?.schedule, 1);
    assert.equal(before.data?.data?.counts?.attendance, 1);

    await cleanupFixture();
    const afterStatus = await authRequest('GET', `/api/hr/qa/multi-segment/${runId}?staffId=${staffId}`);
    assert.equal(afterStatus.status, 200);
    assert.equal(afterStatus.data?.data?.confirmedClean, true);
    assert.deepEqual(afterStatus.data?.data?.counts, {
        shifts: 0,
        schedule: 0,
        attendance: 0,
        checkins: 0,
        timelineLines: 0
    });
});
