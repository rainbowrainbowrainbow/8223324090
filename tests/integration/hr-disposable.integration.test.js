/**
 * Explicit disposable-fixture HR integration suite.
 *
 * Not part of tests/*.test.js or CI. Run only against an isolated environment:
 *   RUN_HR_DISPOSABLE_INTEGRATION=true
 *   node --test tests/integration/hr-disposable.integration.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('../helpers');

const enabled = process.env.RUN_HR_DISPOSABLE_INTEGRATION === 'true';
let fixtureStaffId = null;
let replacementStaffId = null;
const createdShiftIds = [];
const createdStaffIds = [];
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
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true', 'HR disposable integration requires the isolated local test runner');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true', 'HR disposable integration requires verified disposable database setup');
    assert.ok(Number.isInteger(fixtureStaffId) && fixtureStaffId > 0, 'primary disposable staff fixture was created');
    assert.ok(Number.isInteger(replacementStaffId) && replacementStaffId > 0, 'replacement disposable staff fixture was created');
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
    before(async () => {
        const suffix = `${process.pid}-${Date.now()}`;
        for (const label of ['Primary', 'Replacement']) {
            const response = await authRequest('POST', '/api/staff', {
                name: `Disposable QA ${label} ${suffix}`,
                department: 'admin',
                position: 'Disposable integration fixture',
                role_type: 'reception',
                secondaryProfessions: ['manager']
            });
            const staffId = Number(response.data?.data?.id);
            if (Number.isInteger(staffId) && staffId > 0) createdStaffIds.push(staffId);
            assert.equal(response.status, 200, `create ${label.toLowerCase()} fixture staff`);
            assert.equal(response.data?.success, true);
            assert.ok(Number.isInteger(staffId) && staffId > 0);
            if (label === 'Primary') fixtureStaffId = staffId;
            else replacementStaffId = staffId;
        }
        requireFixture();
    });

    after(async () => {
        const failures = [];

        for (const staffId of createdStaffIds) {
            try {
                const rows = await readShifts(sourceWeek, bulkDate, staffId);
                rows.forEach(shift => trackShift(shift.id));
            } catch (error) {
                failures.push(`discover shifts for staff #${staffId}: ${error.message || error}`);
            }
        }

        for (const shiftId of [...new Set(createdShiftIds.splice(0))].reverse()) {
            try {
                const response = await authRequest('DELETE', `/api/hr/shifts/${shiftId}`);
                if (response.status !== 200 || response.data?.success !== true) failures.push(`shift #${shiftId}: HTTP ${response.status}`);
            } catch (error) {
                failures.push(`shift #${shiftId}: ${error.message || error}`);
            }
        }

        for (const staffId of [...createdStaffIds].reverse()) {
            try {
                const response = await authRequest('DELETE', `/api/staff/${staffId}`);
                if (response.status !== 200 || response.data?.success !== true) failures.push(`staff #${staffId}: HTTP ${response.status}`);
            } catch (error) {
                failures.push(`staff #${staffId}: ${error.message || error}`);
            }
        }
        assert.deepEqual(failures, [], `fixture cleanup failures: ${failures.join('; ')}`);
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
        legacyShiftId = trackShift(response.data?.data?.id);
        assert.ok([200, 201].includes(response.status), `unexpected create status ${response.status}`);
        assert.equal(response.data?.success, true);
        assert.ok(Number.isInteger(legacyShiftId) && legacyShiftId > 0, 'created shift id is returned for cleanup');
        assert.equal(response.data?.data?.segments?.length, 1);
        assert.equal(response.data?.data?.segments?.[0]?.professionKey, 'reception');
        assert.equal(response.data?.data?.plannedMinutes, 60);

        const legacyUpdate = await authRequest('PUT', `/api/hr/shifts/${legacyShiftId}`, {
            planned_start: '09:00',
            planned_end: '10:30',
            shift_type: 'full',
            break_minutes: 0,
            profession_key: 'reception',
            notes: 'Disposable legacy update remains compatible'
        });
        assert.equal(legacyUpdate.status, 200);
        assert.equal(legacyUpdate.data?.success, true);
        assert.equal(legacyUpdate.data?.data?.segments?.length, 1);
        assert.equal(legacyUpdate.data?.data?.plannedMinutes, 90);
    });

    it('persists multiple segments, breaks and concurrent roles after refresh', async () => {
        requireFixture();
        const response = await authRequest('POST', '/api/hr/shifts', {
            staff_id: fixtureStaffId,
            shift_date: '2099-01-13',
            shift_type: 'regular',
            ...segmentedPlan
        });
        segmentedShiftId = trackShift(response.data?.data?.id);
        assert.ok([200, 201].includes(response.status), `unexpected create status ${response.status}`);
        assert.equal(response.data?.success, true);
        assertSegmentedPlan(response.data?.data, fixtureStaffId);

        const refreshed = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        assertSegmentedPlan(refreshed.find(shift => Number(shift.id) === segmentedShiftId), fixtureStaffId);
    });

    it('rejects a legacy payload before it can flatten a multi-segment plan', async () => {
        requireFixture();
        const beforeRows = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        const before = beforeRows.find(shift => Number(shift.id) === segmentedShiftId);
        const beforeSegmentIds = before.segments.map(segment => Number(segment.id));

        const response = await authRequest('PUT', `/api/hr/shifts/${segmentedShiftId}`, {
            planned_start: '09:00',
            planned_end: '20:00',
            break_minutes: 0,
            profession_key: 'reception',
            notes: 'Legacy client must not flatten this plan'
        });
        assert.equal(response.status, 409);
        assert.equal(response.data?.success, false);
        assert.equal(response.data?.code, 'HR_SHIFT_SEGMENTS_REQUIRED');

        const afterRows = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        const after = afterRows.find(shift => Number(shift.id) === segmentedShiftId);
        assert.deepEqual(after.segments.map(segment => Number(segment.id)), beforeSegmentIds);
        assertSegmentedPlan(after, fixtureStaffId);
    });

    it('rolls back an overlapping full replacement without changing the saved plan', async () => {
        requireFixture();
        const currentRows = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        const current = currentRows.find(shift => Number(shift.id) === segmentedShiftId);
        const response = await authRequest('PUT', `/api/hr/shifts/${segmentedShiftId}`, {
            expectedUpdatedAt: current?.planUpdatedAt,
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

    it('rejects the second manager save when both clients read the same plan version', async () => {
        requireFixture();
        const [firstRead, secondRead] = await Promise.all([
            readShifts('2099-01-13', '2099-01-13', fixtureStaffId),
            readShifts('2099-01-13', '2099-01-13', fixtureStaffId)
        ]);
        const firstSnapshot = firstRead.find(shift => Number(shift.id) === segmentedShiftId);
        const secondSnapshot = secondRead.find(shift => Number(shift.id) === segmentedShiftId);
        assert.ok(firstSnapshot?.planUpdatedAt);
        assert.equal(secondSnapshot?.planUpdatedAt, firstSnapshot.planUpdatedAt);

        const firstSave = await authRequest('PUT', `/api/hr/shifts/${segmentedShiftId}`, {
            expectedUpdatedAt: firstSnapshot.planUpdatedAt,
            primaryProfessionKey: firstSnapshot.primaryProfessionKey,
            segments: firstSnapshot.segments.map((item, index) => ({
                ...item,
                note: index === 1 ? 'Saved by first disposable client' : item.note
            }))
        });
        assert.equal(firstSave.status, 200);
        assert.equal(firstSave.data?.success, true);
        assert.notEqual(firstSave.data?.data?.planUpdatedAt, firstSnapshot.planUpdatedAt);

        const staleSave = await authRequest('PUT', `/api/hr/shifts/${segmentedShiftId}`, {
            expectedUpdatedAt: secondSnapshot.planUpdatedAt,
            primaryProfessionKey: secondSnapshot.primaryProfessionKey,
            segments: secondSnapshot.segments.map((item, index) => ({
                ...item,
                note: index === 1 ? 'Must not overwrite first client' : item.note
            }))
        });
        assert.equal(staleSave.status, 409);
        assert.equal(staleSave.data?.success, false);
        assert.equal(staleSave.data?.code, 'HR_SHIFT_PLAN_STALE');

        const refreshed = await readShifts('2099-01-13', '2099-01-13', fixtureStaffId);
        const saved = refreshed.find(shift => Number(shift.id) === segmentedShiftId);
        assert.equal(saved?.segments?.[1]?.note, 'Saved by first disposable client');
        assert.deepEqual(
            saved?.segments?.map(segment => Number(segment.id)),
            firstSnapshot.segments.map(segment => Number(segment.id)),
            'updating only the second segment must preserve existing segment ids'
        );
        assertSegmentedPlan(saved, fixtureStaffId);
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
        const source = [
            ...await readShifts(sourceWeek, '2099-01-18', fixtureStaffId),
            ...await readShifts(sourceWeek, '2099-01-18', replacementStaffId)
        ];
        const response = await authRequest('POST', '/api/hr/shifts/copy-week', {
            source_week: sourceWeek,
            target_week: targetWeek
        });
        const copied = response.status === 200 && response.data?.success === true
            ? [
                ...await readShifts(targetWeek, '2099-01-25', fixtureStaffId),
                ...await readShifts(targetWeek, '2099-01-25', replacementStaffId)
            ]
            : [];
        copied.forEach(shift => trackShift(shift.id));
        assert.equal(response.status, 200);
        assert.equal(response.data?.success, true);
        assert.equal(copied.length, source.length, 'fixture source and target row counts must match');
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
        const rows = response.status === 200 && response.data?.success === true
            ? [
                ...await readShifts(bulkDate, bulkDate, fixtureStaffId),
                ...await readShifts(bulkDate, bulkDate, replacementStaffId)
            ]
            : [];
        rows.forEach(shift => trackShift(shift.id));
        assert.equal(response.status, 200);
        assert.equal(response.data?.success, true);
        assert.equal(response.data?.count, 2);
        assert.equal(rows.length, 2);
        rows.forEach(shift => assertSegmentedPlan(shift, shift.staff_id));
    });
});
