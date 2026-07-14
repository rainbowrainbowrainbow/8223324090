'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function loadServiceWithMocks(state) {
    const servicePath = require.resolve('../services/staffScheduleMutations');
    const dependencyMocks = new Map([
        [require.resolve('../services/booking'), {
            reconcileScheduledAnimatorLines: async date => {
                state.calls.push(`reconcile:${date}`);
                return { date, reconciled: true };
            }
        }],
        [require.resolve('../services/hrShiftSegments'), {
            loadHrShiftDayPlan: async () => {
                state.calls.push('load-plan');
                return { plan: null };
            },
            saveHrShiftDayPlan: async (client, input, options) => {
                state.calls.push('save-plan');
                state.saved = { input, options };
                return {
                    shift: { id: 501 },
                    plan: {
                        status: input.status,
                        primaryProfessionKey: 'animator',
                        plannedStart: '22:00',
                        plannedEnd: '02:00',
                        segments: [{
                            professionKey: 'animator',
                            shiftStart: '22:00',
                            shiftEnd: '02:00',
                            breakMinutes: 0,
                            additionalProfessionKeys: []
                        }]
                    }
                };
            },
            isHrShiftPlanError: () => false,
            hrShiftPlanErrorPayload: error => ({ code: error.code, error: error.message })
        }],
        [require.resolve('../services/staffOperationalFilters'), {
            validateStaffScheduleableForDate: async (client, staffId, date, options) => {
                state.calls.push('validate-staff');
                state.validation = { staffId, date, options };
                return { ok: true };
            }
        }]
    ]);
    const originals = new Map();
    for (const [dependencyPath, exports] of dependencyMocks) {
        originals.set(dependencyPath, require.cache[dependencyPath]);
        require.cache[dependencyPath] = {
            id: dependencyPath,
            filename: dependencyPath,
            loaded: true,
            exports
        };
    }
    delete require.cache[servicePath];
    const service = require(servicePath);
    delete require.cache[servicePath];
    for (const [dependencyPath, original] of originals) {
        if (original) require.cache[dependencyPath] = original;
        else delete require.cache[dependencyPath];
    }
    return service;
}

test('time validation rejects malformed and zero-length shifts but preserves overnight shifts', () => {
    const state = { calls: [] };
    const { validateScheduleMutationTimes } = loadServiceWithMocks(state);

    assert.equal(validateScheduleMutationTimes({ shiftStart: '22:00', shiftEnd: '02:00' }, 'working').ok, true);
    assert.equal(validateScheduleMutationTimes({ shiftStart: '9:05', shiftEnd: '18:30:00' }, 'working').ok, true);
    assert.equal(
        validateScheduleMutationTimes({ shiftStart: '25:00', shiftEnd: '18:00' }, 'working').code,
        'HR_SHIFT_SEGMENT_INVALID_TIME'
    );
    assert.equal(
        validateScheduleMutationTimes({ shiftStart: '10:00', shiftEnd: '10:00' }, 'working').code,
        'HR_SHIFT_SEGMENT_ZERO_LENGTH'
    );
    assert.equal(validateScheduleMutationTimes({ shiftStart: 'bad' }, 'dayoff').ok, true);
});

test('canonical mutation performs validation, HR sync, mirror upsert and audit without owning a transaction', async () => {
    const state = { calls: [] };
    const { mutateStaffScheduleEntry } = loadServiceWithMocks(state);
    const queries = [];
    const client = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (/FROM staff_schedule[\s\S]*FOR UPDATE/.test(sql)) {
                state.calls.push('lock-current-schedule');
                return { rows: [{ id: 40, staff_id: 7, date: '2026-07-15', status: 'dayoff' }] };
            }
            if (/INSERT INTO staff_schedule/.test(sql)) {
                state.calls.push('upsert-mirror');
                return { rows: [{ id: 40, staff_id: 7, date: '2026-07-15', status: 'working' }] };
            }
            if (/FROM staff_schedule ss/.test(sql)) {
                state.calls.push('load-enriched');
                return { rows: [{ id: 40, staff_id: 7, date: '2026-07-15', status: 'working' }] };
            }
            if (/INSERT INTO hr_audit_log/.test(sql)) {
                state.calls.push('audit');
                return { rows: [] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const result = await mutateStaffScheduleEntry(client, {
        staffId: 7,
        date: '2026-07-15',
        status: 'working',
        shiftStart: '22:00',
        shiftEnd: '02:00'
    }, {
        actor: { username: 'qa-user', userId: 11, ipAddress: '127.0.0.1' },
        source: 'staff.schedule.test',
        sourceMetadata: { requestId: 'test-1' },
        auditAction: 'staff_schedule_update'
    });

    assert.equal(result.ok, true);
    assert.deepEqual(state.calls, [
        'validate-staff',
        'load-plan',
        'save-plan',
        'lock-current-schedule',
        'upsert-mirror',
        'load-enriched',
        'audit'
    ]);
    assert.equal(state.saved.options.actor, 'qa-user');
    assert.equal(queries.some(query => /\b(?:BEGIN|COMMIT|ROLLBACK)\b/.test(query.sql)), false);
    const auditQuery = queries.find(query => /INSERT INTO hr_audit_log/.test(query.sql));
    assert.equal(auditQuery.params[2], 'qa-user');
    assert.equal(auditQuery.params[4], '127.0.0.1');
    assert.equal(JSON.parse(auditQuery.params[3]).source, 'staff.schedule.test');
    assert.equal(JSON.parse(auditQuery.params[3]).requestId, 'test-1');
});

test('batch mutation locks staff deterministically and reconciles each unique date once', async () => {
    const state = { calls: [] };
    const { mutateStaffScheduleBatch } = loadServiceWithMocks(state);
    const queries = [];
    let nextScheduleId = 100;
    const client = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (/SELECT id FROM staff[\s\S]*FOR UPDATE/.test(sql)) return { rows: [] };
            if (/FROM staff_schedule[\s\S]*FOR UPDATE/.test(sql)) return { rows: [] };
            if (/INSERT INTO staff_schedule/.test(sql)) {
                nextScheduleId += 1;
                return {
                    rows: [{
                        id: nextScheduleId,
                        staff_id: params[0],
                        date: params[1],
                        status: params[4],
                        shift_start: params[2],
                        shift_end: params[3]
                    }]
                };
            }
            if (/INSERT INTO hr_audit_log/.test(sql)) return { rows: [] };
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const result = await mutateStaffScheduleBatch(client, [
        { rowId: 'row-c', staffId: 9, date: '2026-07-16', status: 'working', startTime: '10:00', endTime: '18:00' },
        { rowId: 'row-b', staffId: 7, date: '2026-07-16', status: 'working', startTime: '11:00', endTime: '19:00' },
        { rowId: 'row-a', staffId: 7, date: '2026-07-15', status: 'working', startTime: '12:00', endTime: '20:00' }
    ], {
        actor: { username: 'hermes.schedule', userId: 42 },
        source: 'hermes.schedule_ocr',
        auditAction: 'staff_schedule_hermes_apply',
        sourceMetadata: { previewId: 'hsi_test' },
        sourceMetadataForEntry: entry => ({ rowId: entry.rowId })
    });

    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
    assert.deepEqual(result.staffIds, [7, 9]);
    assert.deepEqual(result.dates, ['2026-07-15', '2026-07-16']);
    assert.deepEqual(result.changes.map(change => change.rowId), ['row-a', 'row-b', 'row-c']);
    assert.deepEqual(
        state.calls.filter(call => call.startsWith('reconcile:')),
        ['reconcile:2026-07-15', 'reconcile:2026-07-16']
    );
    const staffLock = queries.find(query => /SELECT id FROM staff[\s\S]*FOR UPDATE/.test(query.sql));
    assert.deepEqual(staffLock.params, [[7, 9]]);
    assert.equal(queries.some(query => /\b(?:BEGIN|COMMIT|ROLLBACK)\b/.test(query.sql)), false);
    const auditDetails = queries
        .filter(query => /INSERT INTO hr_audit_log/.test(query.sql))
        .map(query => JSON.parse(query.params[3]));
    assert.deepEqual(auditDetails.map(details => details.rowId), ['row-a', 'row-b', 'row-c']);
    assert.ok(auditDetails.every(details => details.source === 'hermes.schedule_ocr'));
    assert.ok(auditDetails.every(details => details.previewId === 'hsi_test'));
});
