/**
 * Explicit disposable-fixture HR integration suite.
 *
 * Not part of tests/*.test.js or CI. Run only against an isolated environment:
 *   RUN_HR_DISPOSABLE_INTEGRATION=true
 *   HR_DISPOSABLE_STAFF_ID=<fixture id>
 *   HR_DISPOSABLE_REPLACEMENT_STAFF_ID=<second fixture id>
 *   node --test tests/integration/hr-disposable.integration.test.js
 */
'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('../helpers');

const enabled = process.env.RUN_HR_DISPOSABLE_INTEGRATION === 'true';
const fixtureStaffId = Number.parseInt(String(process.env.HR_DISPOSABLE_STAFF_ID || ''), 10);
const replacementStaffId = Number.parseInt(String(process.env.HR_DISPOSABLE_REPLACEMENT_STAFF_ID || ''), 10);
const createdShiftIds = [];
const sourceWeek = '2099-01-12';
const targetWeek = '2099-01-19';
const bulkDate = '2099-01-26';
let legacyShiftId = null;
let segmentedShiftId = null;

const segmentedPlan = {
    primaryProfessionKey: 'reception',
    segments: [
        {
            professionKey: 'reception',
            shiftStart: '09:00',
            shiftEnd: '13:00',
            breakMinutes: 0,
            note: 'Disposable reception block',
            additionalProfessionKeys: ['manager']
        },
        {
            professionKey: 'manager',
            shiftStart: '13:00',
            shiftEnd: '20:00',
            breakMinutes: 30,
            note: 'Disposable manager block',
            additionalProfessionKeys: []
        }
    ]
};

function requireFixture() {
    assert.equal(enabled, true, 'set RUN_HR_DISPOSABLE_INTEGRATION=true');
    assert.ok(Number.isInteger(fixtureStaffId) && fixtureStaffId > 0, 'set HR_DISPOSABLE_STAFF_ID');
    assert.ok(Number.isInteger(replacementStaffId) && replacementStaffId > 0, 'set HR_DISPOSABLE_REPLACEMENT_STAFF_ID');
    assert.notEqual(replacementStaffId, fixtureStaffId, 'replacement fixture must be a different staff row');
}

function trackShift(value) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0 && !createdShiftIds.includes(id)) createdShiftIds.push(id);
    return id;
}

async function readShifts(from, to, staffId = null) {
    const suffix = staffId ? `&staff_id=${staffId}` : '';
    const response = await authRequest('GET', `/api/hr/shifts?from=${from}&to=${to}${suffix}`);
    assert.equal(response.status, 200);
    assert.equal(response.data?.success, true);
    return Array.isArray(response.data?.data) ? response.data.data : [];
}

function assertSegmentedPlan(shift, expectedStaffId = null) {
    assert.ok(shift, 'segmented shift is present');
    if (expectedStaffId !== null) assert.equal(Number(shift.staff_id), Number(expectedStaffId));
    assert.equal(shift.primaryProfessionKey, 'reception');
    assert.equal(shift.plannedMinutes, 630);
    assert.equal(shift.segments?.length, 2);
    assert.deepEqual(shift.segments.map(segment => [
        segment.professionKey,
        segment.shiftStart,
        segment.shiftEnd,
        segment.breakMinutes,
        segment.additionalProfessionKeys
    ]), [
        ['reception', '09:00', '13:00', 0, ['manager']],
        ['manager', '13:00', '20:00', 30, []]
    ]);
}

describe('HR disposable fixture integration', { skip: !enabled }, () => {
    after(async () => {
        const failures = [];
        for (const shiftId of [...new Set(createdShiftIds.splice(0))].reverse()) {
            try {
                const response = await authRequest('DELETE', `/api/hr/shifts/${shiftId}`);
                if (response.status !== 200 || response.data?.success !== true) failures.push(`shift #${shiftId}: HTTP ${response.status}`);
            } catch (error) {
                failures.push(`shift #${shiftId}: ${error.message || error}`);
            }
        }
        assert.deepEqual(failures, [], `fixture cleanup failures: ${failures.join('; ')}`);
    });

    it('reads the explicitly named disposable staff fixture', async () => {
        requireFixture();
        for (const staffId of [fixtureStaffId, replacementStaffId]) {
            const response = await authRequest('GET', `/api/hr/staff/${staffId}`);
            assert.equal(response.status, 200);
            assert.equal(response.data?.success, true);
            assert.equal(Number(response.data?.data?.id), staffId);
            assert.match([response.data?.data?.name, response.data?.data?.display_name].filter(Boolean).join(' '), /QA|Test|Smoke|Disposable/i);
        }
    });

    it('keeps the legacy single-shift payload as one equivalent segment', async () => {
        requireFixture();
        const response = await authRequest('POST', '/api/hr/shifts', {
            staff_id: fixtureStaffId,
            shift_date: sourceWeek,
            planned_start: '09:00',
            planned_end: '10:00',
            shift_type: 'full',
            break_minutes: 0,
            profession_key: 'reception',
            notes: 'Disposable HR integration fixture'
        });
        assert.ok([200, 201].includes(response.status), `unexpected create status ${response.status}`);
        assert.equal(response.data?.success, true);
        legacyShiftId = trackShift(response.data?.data?.id);
        assert.ok(Number.isInteger(legacyShiftId) && legacyShiftId > 0, 'created shift id is returned for cleanup');
        assert.equal(response.data?.data?.segments?.length, 1);
        assert.equal(response.data?.data?.segments?.[0]?.professionKey, 'reception');
        assert.equal(response.data?.data?.plannedMinutes, 60);
    });

    it('persists multiple segments, breaks and concurrent roles after refresh', async () => {
        requireFixture();
        const response = await authRequest('POST', '/api/hr/shifts', {
            staff_id: fixtureStaffId,
            shift_date: '2099-01-13',
            shift_type: 'regular',
            ...segmentedPlan
        });
        assert.ok([200, 201].includes(response.status), `unexpected create status ${response.status}`);
        assert.equal(response.data?.success, true);
        segmentedShiftId = trackShift(response.data?.data?.id);
        assertSegmentedPlan(response.data?.data, fixtureStaffId);

        const refreshed = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        assertSegmentedPlan(refreshed.find(shift => Number(shift.id) === segmentedShiftId), fixtureStaffId);
    });

    it('rolls back an overlapping full replacement without changing the saved plan', async () => {
        requireFixture();
        const response = await authRequest('PUT', `/api/hr/shifts/${segmentedShiftId}`, {
            primaryProfessionKey: 'reception',
            segments: [
                { professionKey: 'reception', shiftStart: '09:00', shiftEnd: '15:00', breakMinutes: 0 },
                { professionKey: 'manager', shiftStart: '14:00', shiftEnd: '20:00', breakMinutes: 0 }
            ]
        });
        assert.ok([400, 409].includes(response.status), `overlap must be rejected, got ${response.status}`);
        assert.equal(response.data?.success, false);

        const refreshed = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        assertSegmentedPlan(refreshed.find(shift => Number(shift.id) === segmentedShiftId), fixtureStaffId);
    });

    it('moves the complete segmented plan to a qualified replacement worker', async () => {
        requireFixture();
        const response = await authRequest('POST', `/api/hr/shifts/${segmentedShiftId}/replace`, {
            replacement_staff_id: replacementStaffId,
            reason: 'Disposable replacement integration'
        });
        assert.equal(response.status, 200);
        assert.equal(response.data?.success, true);
        assertSegmentedPlan(response.data?.data, replacementStaffId);

        const originalRows = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        assert.equal(originalRows.length, 0);
        const replacementWeekRows = await readShifts(sourceWeek, '2099-01-18', replacementStaffId);
        assert.equal(replacementWeekRows.length, 1, 'replacement must not create a mirrored shift on the previous date');
        const replacementRows = replacementWeekRows.filter(shift => String(shift.shift_date).slice(0, 10) === '2099-01-13');
        assertSegmentedPlan(replacementRows.find(shift => Number(shift.id) === segmentedShiftId), replacementStaffId);
    });

    it('copies legacy and segmented shifts with fresh child ids', async () => {
        requireFixture();
        const response = await authRequest('POST', '/api/hr/shifts/copy-week', {
            source_week: sourceWeek,
            target_week: targetWeek
        });
        assert.equal(response.status, 200);
        assert.equal(response.data?.success, true);
        assert.equal(response.data?.count, 2);

        const copied = await readShifts(targetWeek, '2099-01-25');
        copied.forEach(shift => trackShift(shift.id));
        const source = await readShifts(sourceWeek, '2099-01-18');
        assert.equal(copied.length, 2, 'copy-week must not create previous-day mirror rows');
        const copiedLegacy = copied.find(shift => Number(shift.staff_id) === fixtureStaffId
            && String(shift.shift_date).slice(0, 10) === '2099-01-19');
        const copiedSegmented = copied.find(shift => Number(shift.staff_id) === replacementStaffId
            && String(shift.shift_date).slice(0, 10) === '2099-01-20');
        const sourceLegacy = source.find(shift => Number(shift.staff_id) === fixtureStaffId
            && String(shift.shift_date).slice(0, 10) === '2099-01-12');
        const sourceSegmented = source.find(shift => Number(shift.staff_id) === replacementStaffId
            && String(shift.shift_date).slice(0, 10) === '2099-01-13');
        assert.equal(copiedLegacy?.segments?.length, 1);
        assert.notEqual(Number(copiedLegacy?.segments?.[0]?.id), Number(sourceLegacy?.segments?.[0]?.id));
        assertSegmentedPlan(copiedSegmented, replacementStaffId);
        assert.notDeepEqual(
            copiedSegmented.segments.map(segment => Number(segment.id)),
            sourceSegmented.segments.map(segment => Number(segment.id))
        );
    });

    it('bulk-applies the same full segment template atomically', async () => {
        requireFixture();
        const response = await authRequest('POST', '/api/hr/shifts/bulk', {
            staff_ids: [fixtureStaffId, replacementStaffId],
            dates: [bulkDate],
            shift_type: 'regular',
            ...segmentedPlan
        });
        assert.equal(response.status, 200);
        assert.equal(response.data?.success, true);
        assert.equal(response.data?.count, 2);

        const rows = await readShifts(bulkDate, bulkDate);
        rows.forEach(shift => trackShift(shift.id));
        assert.equal(rows.length, 2);
        rows.forEach(shift => assertSegmentedPlan(shift, shift.staff_id));
    });
});
