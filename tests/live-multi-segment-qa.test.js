'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    LIVE_MULTI_SEGMENT_QA_CONFIRMATION,
    assertLiveQaConfirmation,
    assertLiveQaStaff,
    liveQaMarker,
    normalizeLiveQaRunId,
    normalizeLiveQaTime
} = require('../services/liveMultiSegmentQa');
const {
    normalizedSegments,
    schedulePayload
} = require('../scripts/live-multi-segment-qa');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

test('live multi-segment QA guard accepts only explicit marker-bound disposable staff', () => {
    assert.equal(LIVE_MULTI_SEGMENT_QA_CONFIRMATION, 'I_CONFIRM_LIVE_MULTI_SEGMENT_QA');
    assert.equal(normalizeLiveQaRunId('qa_run-20260714'), 'qa_run-20260714');
    assert.equal(normalizeLiveQaRunId('short'), '');
    assert.equal(normalizeLiveQaRunId('../unsafe-run'), '');
    assert.equal(liveQaMarker('qa_run-20260714'), 'live_multi_segment_qa:qa_run-20260714');
    assert.doesNotThrow(() => assertLiveQaConfirmation(LIVE_MULTI_SEGMENT_QA_CONFIRMATION));
    assert.throws(() => assertLiveQaConfirmation('yes'), error => (
        error.code === 'LIVE_QA_CONFIRMATION_REQUIRED' && error.status === 403
    ));
    assert.equal(
        assertLiveQaStaff({ id: 42, name: 'Disposable QA Multi Segment qa_run-20260714' }, 'qa_run-20260714').id,
        42
    );
    assert.throws(
        () => assertLiveQaStaff({ id: 42, name: 'Real Employee qa_run-20260714' }, 'qa_run-20260714'),
        error => error.code === 'LIVE_QA_STAFF_REFUSED'
    );
    assert.throws(
        () => assertLiveQaStaff({ id: 42, name: 'Disposable QA another_run' }, 'qa_run-20260714'),
        error => error.code === 'LIVE_QA_STAFF_REFUSED'
    );
    assert.equal(normalizeLiveQaTime('09:00'), '09:00');
    assert.equal(normalizeLiveQaTime('24:00'), '');
});

test('live QA API helper is creator/director-only, marker guarded, atomic, and read-verifiable', () => {
    const route = read('routes', 'hr.js');
    assert.match(route, /router\.get\('\/qa\/multi-segment\/capabilities', requireRole\('creator', 'director'\)/);
    assert.match(route, /router\.post\('\/qa\/multi-segment\/attendance', requireRole\('creator', 'director'\)/);
    assert.match(route, /router\.delete\('\/qa\/multi-segment\/:runId', requireRole\('creator', 'director'\)/);
    assert.match(route, /assertLiveQaConfirmation\(liveQaConfirmationFromRequest\(req\)\)/);
    assert.match(route, /loadLiveQaStaff\(client, staffId, runId, \{ forUpdate: true \}\)/);
    assert.match(route, /AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(route, /recordAttendanceClockIn\(client/);
    assert.match(route, /recordAttendanceClockOut\(client/);
    assert.match(route, /compensation_snapshot_state/);
    assert.match(route, /live_multi_segment_qa_attendance_create/);
    assert.match(route, /live_multi_segment_qa_cleanup/);
    assert.match(route, /await reconcileRosterDates\(client, affectedDates\)[\s\S]{0,1500}await client\.query\('COMMIT'\)/);
    assert.match(route, /const after = await loadLiveQaFixtureStatus\(pool, staff\.id, runId\)/);
    assert.match(route, /FROM staff_shift_preferences[\s\S]{0,150}WHERE staff_id = \$1[\s\S]{0,150}ORDER BY profession_key, day_type, id/);
    assert.match(route, /shiftPreferences: shiftPreferenceResult\.rows/);
    const staffGuardIndex = route.indexOf('const staff = await loadLiveQaStaff(client, staffId, runId, { forUpdate: true });');
    const preferenceDeleteIndex = route.indexOf("DELETE FROM staff_shift_preferences WHERE staff_id = $1");
    assert.ok(staffGuardIndex >= 0, 'cleanup keeps the marker-bound disposable staff guard');
    assert.ok(preferenceDeleteIndex > staffGuardIndex, 'preference cleanup happens only after disposable staff guard');
    assert.deepEqual(
        [...route.matchAll(/DELETE FROM staff_shift_preferences[^'`\n]*/g)].map(match => match[0]),
        ['DELETE FROM staff_shift_preferences WHERE staff_id = $1']
    );
    assert.doesNotMatch(route, /DELETE FROM bookings[\s\S]{0,1000}live_multi_segment_qa_cleanup/);
    assert.doesNotMatch(route, /DELETE FROM finance_transactions[\s\S]{0,1000}live_multi_segment_qa_cleanup/);
});

test('live runner covers the guarded simultaneous-pay contract and always uses server cleanup', () => {
    const script = read('scripts', 'live-multi-segment-qa.js');
    assert.match(script, /LIVE_MULTI_SEGMENT_QA_CONFIRM/);
    assert.match(script, /LIVE_MULTI_SEGMENT_QA_URL/);
    assert.match(script, /LIVE_MULTI_SEGMENT_QA_RUN_ID/);
    assert.match(script, /LIVE_MULTI_SEGMENT_QA_USER/);
    assert.match(script, /Disposable QA Multi Segment \$\{RUN_ID\}/);
    assert.match(script, /\/api\/hr\/staff\/\$\{staffId\}\/role-assignments/);
    assert.match(script, /admission_status: 'approved'/);
    assert.match(script, /\/api\/staff\/attendance/);
    assert.match(script, /\/api\/payroll\/preview/);
    assert.match(script, /\/api\/staff\/schedule\/hours/);
    assert.match(script, /finally \{[\s\S]*cleanup\(base, session\.token, staffId\)/);
    assert.match(script, /independent read-only cleanup verification/);
    assert.match(script, /Cleanup report:/);
    assert.doesNotMatch(script, /\/api\/staff\/schedule\/copy-week/);
    assert.doesNotMatch(script, /HR_SHIFT_PLAN_STALE/);
    assert.doesNotMatch(script, /rate_unit: 'day'/);
    assert.doesNotMatch(script, /\/api\/payroll\/(generate|report)/);
    assert.doesNotMatch(script, /\/api\/bookings/);
    assert.doesNotMatch(script, /\/api\/finance/);
});

test('live runner models the screenshot case as nine physical hours plus an 8.5-hour paid role', () => {
    const payload = schedulePayload(42, '2026-11-02');
    assert.deepEqual(
        payload.segments.map(segment => [segment.professionKey, segment.shiftStart, segment.shiftEnd]),
        [
            ['wardrobe', '11:00', '11:30'],
            ['wardrobe', '11:30', '20:00']
        ]
    );
    assert.deepEqual(payload.segments[0].additionalRoles, []);
    assert.deepEqual(
        payload.segments[1].additionalRoles.map(role => [role.professionKey, role.compensationMode]),
        [
            ['cleaner', 'paid_hourly']
        ]
    );
    assert.equal(
        payload.segments.reduce((sum, segment) => {
            const [startHour, startMinute] = segment.shiftStart.split(':').map(Number);
            const [endHour, endMinute] = segment.shiftEnd.split(':').map(Number);
            return sum + ((endHour * 60 + endMinute) - (startHour * 60 + startMinute));
        }, 0),
        540
    );
    assert.deepEqual(
        normalizedSegments({ segments: payload.segments })[1].additionalRoles
            .map(role => [role.professionKey, role.compensationMode, role.payMultiplier]),
        [
            ['cleaner', 'paid_hourly', 1]
        ]
    );
    assert.equal(payload.segments[1].additionalRoles[0].payMultiplier, 1);
});

test('policy, QA documentation, PostgreSQL fixture, and CI share the active v1 contract', () => {
    const policy = read('docs', 'HR_SIMULTANEOUS_PROFESSION_PAY_POLICY.md');
    const qaDoc = read('docs', 'LIVE_MULTI_SEGMENT_QA.md');
    const integration = read('tests', 'integration', 'live-multi-segment-qa.integration.test.js');
    const workflow = read('.github', 'workflows', 'ci.yml');

    assert.match(policy, /Статус \| Активна production policy v1/);
    assert.match(policy, /`effectiveFrom` \| `2026-07-18`/);
    assert.match(policy, /Pre-activation read-only production audit — історичний snapshot/);
    assert.doesNotMatch(policy, /implementation та production activation не авторизовані/);
    assert.doesNotMatch(policy, /Task 1 не встановлює дату production activation/);
    assert.doesNotMatch(policy, /Цей документ сам по собі не авторизує schema migration/);

    assert.match(qaDoc, /active `simultaneous-profession-pay-v1` contract/);
    assert.match(qaDoc, /`11:00-20:00 wardrobe` plus\s+`11:30-20:00 cleaner`/);
    assert.match(qaDoc, /540 non-overlapping physical minutes/);
    assert.match(qaDoc, /510 paid cleaner minutes/);

    assert.match(integration, /shiftStart: '11:00'[\s\S]*shiftEnd: '11:30'/);
    assert.match(integration, /shiftStart: '11:30'[\s\S]*shiftEnd: '20:00'/);
    assert.match(integration, /paidAdditionalProfessionKeys: \[additionalProfession\]/);
    assert.match(integration, /savedDay\.segments\[1\]\.additionalRoles[\s\S]*role\.compensationMode/);
    assert.match(integration, /physicalMinutes\), 540/);
    assert.match(integration, /paidAllocation\.actualMinutes \?\? paidAllocation\.actual_minutes\), 510/);

    assert.match(workflow, /hr-payroll-postgres:/);
    assert.match(workflow, /name: HR and payroll PostgreSQL integration/);
    assert.doesNotMatch(workflow, /name: HR onboarding PostgreSQL integration/);
});
