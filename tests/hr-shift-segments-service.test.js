'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    HR_SHIFT_BREAK_POLICY,
    HR_SHIFT_OVERNIGHT_POLICY,
    HR_SHIFT_PLAN_MESSAGES,
    MAX_HR_SHIFT_SEGMENTS_PER_DAY,
    durationAcrossMidnight,
    hydrateHrShiftDayPlans,
    loadHrShiftDayPlan,
    loadHrShiftDayPlansForStaffDates,
    normalizeHrShiftDayPlan,
    normalizeShiftTime,
    replaceHrShiftSegments,
    saveHrShiftDayPlan,
    timeToMinutes
} = require('../services/hrShiftSegments');
const { resolveStaffProfessionAssignments } = require('../services/professions');

const STAFF_PROFESSIONS = ['reception', 'manager', 'animator'];

function normalize(payload, options = {}) {
    return normalizeHrShiftDayPlan(payload, {
        status: 'working',
        allowedProfessionKeys: STAFF_PROFESSIONS,
        ...options
    });
}

function segment(professionKey, shiftStart, shiftEnd, extra = {}) {
    return { professionKey, shiftStart, shiftEnd, breakMinutes: 0, ...extra };
}

function createExistingMultiSegmentClient(shiftType = 'regular', segmentRows = null) {
    const calls = [];
    let currentShiftType = shiftType;
    let currentNotes = 'Original note';
    let nextSegmentId = 200;
    let version = 1;
    const planUpdatedAt = () => `2026-07-13T10:00:00.${String(version).padStart(6, '0')}Z`;
    const bumpVersion = () => { version += 1; };
    const parent = () => ({
        id: 42,
        staff_id: 17,
        shift_date: '2026-07-13',
        profession_key: 'reception',
        planned_start: '09:00',
        planned_end: '20:00',
        break_minutes: 0,
        shift_type: currentShiftType,
        notes: currentNotes,
        original_staff_id: null,
        updated_at: new Date('2026-07-13T10:00:00.000Z'),
        plan_updated_at_token: planUpdatedAt()
    });
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (/^SELECT .* FROM hr_shifts WHERE id = \$1(?: FOR UPDATE)?$/.test(text)) {
                return { rows: [parent()] };
            }
            if (/FROM hr_shift_segments hss/.test(text)) {
                return {
                    rows: segmentRows || [
                        {
                            id: 71,
                            hr_shift_id: 42,
                            profession_key: 'reception',
                            planned_start: '09:00',
                            planned_end: '13:00',
                            break_minutes: 0,
                            notes: null,
                            sort_order: 0,
                            additional_profession_keys: []
                        },
                        {
                            id: 72,
                            hr_shift_id: 42,
                            profession_key: 'manager',
                            planned_start: '15:00',
                            planned_end: '20:00',
                            break_minutes: 0,
                            notes: null,
                            sort_order: 1,
                            additional_profession_keys: []
                        }
                    ]
                };
            }
            if (/FROM staff/.test(text)) {
                return {
                    rows: [{
                        id: 17,
                        name: 'Test Staff',
                        role_type: 'reception',
                        secondary_professions: ['manager'],
                        is_active: true
                    }]
                };
            }
            if (/^UPDATE hr_shifts SET shift_type/.test(text)) {
                currentShiftType = params[0];
                currentNotes = params[1];
                bumpVersion();
                return { rows: [parent()] };
            }
            if (/^UPDATE hr_shifts SET planned_start/.test(text)) {
                bumpVersion();
                return {
                    rows: [{
                        ...parent(),
                        planned_start: params[0],
                        planned_end: params[1],
                        break_minutes: params[2],
                        profession_key: params[3]
                    }]
                };
            }
            if (/^DELETE FROM hr_shift_segments/.test(text)) return { rows: [] };
            if (/^UPDATE hr_shift_segments SET/.test(text)) return { rows: [] };
            if (/^DELETE FROM hr_shift_segment_roles/.test(text)) return { rows: [] };
            if (/^INSERT INTO hr_shift_segments/.test(text)) {
                nextSegmentId += 1;
                return { rows: [{ id: nextSegmentId }] };
            }
            if (/^INSERT INTO hr_shift_segment_roles/.test(text)) return { rows: [] };
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
    return { client, calls, planUpdatedAt };
}

test('normalizes PostgreSQL times and calculates duration across midnight', () => {
    assert.equal(normalizeShiftTime('9:05'), '09:05');
    assert.equal(normalizeShiftTime('09:05:00'), '09:05');
    assert.equal(normalizeShiftTime('09:05:30'), null);
    assert.equal(normalizeShiftTime('09:05:00.999'), null);
    assert.equal(timeToMinutes('23:15'), 1395);
    assert.equal(durationAcrossMidnight('22:00', '02:00'), 240);
    assert.equal(durationAcrossMidnight('09:00', '09:00'), 1440);
});

test('accepts sequential segments and calculates deterministic paid minutes', () => {
    const plan = normalize({
        primaryProfessionKey: 'reception',
        segments: [
            segment('manager', '13:00', '20:00'),
            segment('reception', '09:00', '13:00')
        ]
    });

    assert.deepEqual(plan.segments.map(item => item.professionKey), ['reception', 'manager']);
    assert.deepEqual(plan.segments.map(item => item.sortOrder), [0, 1]);
    assert.equal(plan.plannedStart, '09:00');
    assert.equal(plan.plannedEnd, '20:00');
    assert.equal(plan.plannedMinutes, 660);
    assert.equal(plan.gapMinutes, 0);
});

test('allows unpaid gaps without adding them to planned minutes', () => {
    const plan = normalize({
        primaryProfessionKey: 'reception',
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '15:00', '20:00')
        ]
    });

    assert.equal(plan.spanMinutes, 660);
    assert.equal(plan.gapMinutes, 120);
    assert.equal(plan.plannedMinutes, 540);
});

test('rejects overlapping paid segments but permits adjacent boundaries', () => {
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [
                segment('reception', '09:00', '15:00'),
                segment('manager', '14:00', '20:00')
            ]
        }),
        error => error.code === 'HR_SHIFT_PLAN_SEGMENTS_OVERLAP'
    );

    assert.doesNotThrow(() => normalize({
        primaryProfessionKey: 'reception',
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '13:00', '20:00')
        ]
    }));
});

test('supports an overnight segment and subtracts its break once', () => {
    const plan = normalize({
        primaryProfessionKey: 'manager',
        segments: [segment('manager', '22:00', '02:00', { breakMinutes: 30 })]
    });

    assert.equal(plan.segments[0].durationMinutes, 240);
    assert.equal(plan.segments[0].plannedMinutes, 210);
    assert.equal(plan.plannedStart, '22:00');
    assert.equal(plan.plannedEnd, '02:00');
    assert.equal(plan.plannedMinutes, 210);
});

test('does not infer a separate post-midnight segment without a day offset', () => {
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'manager',
            segments: [
                segment('manager', '22:00', '02:00'),
                segment('reception', '02:00', '03:00')
            ]
        }),
        error => error.code === 'HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT'
            && error.message === HR_SHIFT_PLAN_MESSAGES.HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT
            && error.details.policy === HR_SHIFT_OVERNIGHT_POLICY
    );
});

test('rejects every multi-segment day containing an overnight block until day offsets exist', () => {
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [
                segment('reception', '10:00', '14:00'),
                segment('manager', '22:00', '02:00')
            ]
        }),
        error => error.code === 'HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT'
            && error.details.segmentCount === 2
    );
});

test('additional simultaneous roles do not add hours and cannot duplicate the main role', () => {
    const plan = normalize({
        primaryProfessionKey: 'reception',
        segments: [segment('reception', '09:00', '13:00', {
            additionalProfessionKeys: ['manager']
        })]
    });

    assert.equal(plan.plannedMinutes, 240);
    assert.deepEqual(plan.professionKeys, ['reception', 'manager']);

    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '13:00', {
                additionalProfessionKeys: ['reception']
            })]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_DUPLICATE_ROLE'
    );
});

test('rejects lossy profession keys and malformed additional-role payloads', () => {
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [segment('reception!', '09:00', '13:00')]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_PROFESSION_REQUIRED'
    );
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '13:00', {
                additionalProfessionKeys: '[manager'
            })]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_INVALID_ADDITIONAL_PROFESSIONS'
    );
});

test('allows the same profession in separate non-overlapping segments', () => {
    const plan = normalize({
        primaryProfessionKey: 'reception',
        segments: [
            segment('reception', '09:00', '12:00'),
            segment('reception', '17:00', '20:00')
        ]
    });

    assert.equal(plan.plannedMinutes, 360);
    assert.equal(plan.gapMinutes, 300);
    assert.deepEqual(plan.professionKeys, ['reception']);
});

test('requires every role on the employee HR card', () => {
    assert.throws(
        () => normalizeHrShiftDayPlan({
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '13:00', {
                additionalProfessionKeys: ['manager']
            })]
        }, {
            status: 'working',
            allowedProfessionKeys: ['reception']
        }),
        error => error.code === 'HR_SHIFT_PLAN_PROFESSION_NOT_ON_STAFF_CARD'
            && error.details.invalidProfessionKeys.includes('manager')
    );

    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [null]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_INVALID_SHAPE'
    );
});

test('requires the day primary profession to be a main segment profession', () => {
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'manager',
            segments: [segment('reception', '09:00', '13:00', {
                additionalProfessionKeys: ['manager']
            })]
        }),
        error => error.code === 'HR_SHIFT_PLAN_PRIMARY_PROFESSION_NOT_IN_SEGMENTS'
    );

    assert.throws(
        () => normalizeHrShiftDayPlan({
            segments: [segment('reception', '09:00', '13:00')]
        }, {
            status: 'working',
            defaultProfessionKey: 'reception',
            allowedProfessionKeys: STAFF_PROFESSIONS
        }),
        error => error.code === 'HR_SHIFT_PLAN_PRIMARY_PROFESSION_REQUIRED'
    );
});

test('rejects a break equal to or longer than the segment and a zero-length segment', () => {
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '10:00', { breakMinutes: 60 })]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION'
            && error.message === HR_SHIFT_PLAN_MESSAGES.HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION
            && error.details.policy === HR_SHIFT_BREAK_POLICY
    );
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '10:00', { breakMinutes: 61 })]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION'
    );
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '09:00')]
        }),
        error => error.code === 'HR_SHIFT_SEGMENT_ZERO_LENGTH'
    );
});

test('enforces the documented maximum of 12 segments', () => {
    const twelve = Array.from({ length: MAX_HR_SHIFT_SEGMENTS_PER_DAY }, (_, index) => {
        const start = index * 2;
        return segment('reception', `${String(start).padStart(2, '0')}:00`, `${String(start + 1).padStart(2, '0')}:00`);
    });
    assert.equal(normalize({ primaryProfessionKey: 'reception', segments: twelve }).segments.length, 12);
    assert.throws(
        () => normalize({
            primaryProfessionKey: 'reception',
            segments: [...twelve, segment('reception', '00:15', '00:30')]
        }),
        error => error.code === 'HR_SHIFT_PLAN_TOO_MANY_SEGMENTS'
    );
});

test('normalizes legacy single-shift payload into one segment', () => {
    const plan = normalizeHrShiftDayPlan({
        professionKey: 'reception',
        shiftStart: '09:00',
        shiftEnd: '18:00',
        breakMinutes: 30
    }, {
        status: 'working',
        allowedProfessionKeys: STAFF_PROFESSIONS
    });

    assert.equal(plan.source, 'legacy');
    assert.equal(plan.segments.length, 1);
    assert.equal(plan.primaryProfessionKey, 'reception');
    assert.equal(plan.plannedMinutes, 510);
});

test('requires empty segments for non-working statuses', () => {
    const dayoff = normalizeHrShiftDayPlan({ status: 'dayoff', segments: [] });
    assert.deepEqual(dayoff.segments, []);
    assert.equal(dayoff.plannedMinutes, 0);

    assert.throws(
        () => normalizeHrShiftDayPlan({
            status: 'vacation',
            segments: [segment('reception', '09:00', '13:00')]
        }),
        error => error.code === 'HR_SHIFT_PLAN_NON_WORKING_HAS_SEGMENTS'
    );
});

test('batch profession resolver validates all roles with one staff query', async () => {
    let queries = 0;
    const db = {
        async query(sql, params) {
            queries += 1;
            assert.match(String(sql), /FROM staff/);
            assert.deepEqual(params, [17]);
            return {
                rows: [{
                    id: 17,
                    name: 'Test Staff',
                    role_type: 'reception',
                    secondary_professions: ['manager'],
                    is_active: true
                }]
            };
        }
    };

    const valid = await resolveStaffProfessionAssignments(db, 17, ['reception', 'manager']);
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.professionKeys, ['reception', 'manager']);
    assert.equal(queries, 1);

    const invalid = await resolveStaffProfessionAssignments(db, 17, ['reception', 'animator']);
    assert.equal(invalid.ok, false);
    assert.deepEqual(invalid.invalidProfessionKeys, ['animator']);
    assert.equal(queries, 2);

    const malformed = await resolveStaffProfessionAssignments(db, 17, ['!!!']);
    assert.equal(malformed.ok, false);
    assert.deepEqual(malformed.malformedProfessionKeys, ['!!!']);
    assert.equal(queries, 3);

    const lossy = await resolveStaffProfessionAssignments(db, 17, ['reception!']);
    assert.equal(lossy.ok, false);
    assert.deepEqual(lossy.malformedProfessionKeys, ['reception!']);
    assert.equal(queries, 4);
});

test('batch hydration restores stable segment order and additional roles', async () => {
    let queries = 0;
    const db = {
        async query(sql, params) {
            queries += 1;
            assert.match(String(sql), /to_jsonb\(hs\) AS shift_row/);
            assert.match(String(sql), /hs\.id = ANY\(\$1::bigint\[\]\)/);
            assert.match(String(sql), /ORDER BY hs\.id, hss\.sort_order, hss\.id/);
            assert.deepEqual(params, [[42]]);
            const shiftRow = {
                id: 42,
                staff_id: 17,
                shift_date: '2026-07-13',
                profession_key: 'reception',
                planned_start: '09:00',
                planned_end: '20:00',
                break_minutes: 0,
                shift_type: 'regular'
            };
            return {
                rows: [
                    {
                        shift_row: shiftRow,
                        segment_id: 71,
                        profession_key: 'reception',
                        planned_start: '09:00',
                        planned_end: '13:00',
                        break_minutes: 0,
                        notes: 'Morning',
                        sort_order: 0,
                        additional_profession_keys: ['manager']
                    },
                    {
                        shift_row: shiftRow,
                        segment_id: 72,
                        profession_key: 'manager',
                        planned_start: '15:00',
                        planned_end: '20:00',
                        break_minutes: 0,
                        notes: null,
                        sort_order: 1,
                        additional_profession_keys: []
                    }
                ]
            };
        }
    };
    const hydrated = await hydrateHrShiftDayPlans(db, [{
        id: 42,
        staff_id: 17,
        shift_date: '2026-07-13',
        profession_key: 'reception',
        planned_start: '09:00',
        planned_end: '20:00',
        break_minutes: 0,
        shift_type: 'regular'
    }]);

    assert.equal(queries, 1);
    assert.deepEqual(hydrated[0].plan.segments.map(item => item.id), [71, 72]);
    assert.deepEqual(hydrated[0].plan.segments[0].additionalProfessionKeys, ['manager']);
    assert.equal(hydrated[0].plan.plannedMinutes, 540);
    assert.equal(hydrated[0].plan.gapMinutes, 120);
});

test('locking hydration acquires the parent lock before reading child segments', async () => {
    const queries = [];
    const db = {
        async query(sql, params) {
            queries.push(String(sql));
            if (queries.length === 1) {
                assert.match(String(sql), /SELECT [^]* FROM hr_shifts WHERE id = \$1 FOR UPDATE/);
                assert.deepEqual(params, [42]);
                return {
                    rows: [{
                        id: 42,
                        staff_id: 17,
                        shift_date: '2026-07-13',
                        profession_key: 'reception',
                        planned_start: '09:00',
                        planned_end: '20:00',
                        break_minutes: 0,
                        shift_type: 'regular'
                    }]
                };
            }
            assert.match(String(sql), /FROM hr_shift_segments hss/);
            assert.doesNotMatch(String(sql), /JOIN hr_shifts/);
            assert.deepEqual(params, [42]);
            return {
                rows: [{
                    id: 71,
                    hr_shift_id: 42,
                    profession_key: 'reception',
                    planned_start: '09:00',
                    planned_end: '20:00',
                    break_minutes: 0,
                    notes: null,
                    sort_order: 0,
                    additional_profession_keys: ['manager']
                }]
            };
        }
    };

    const loaded = await loadHrShiftDayPlan(db, { hrShiftId: 42 }, { forUpdate: true });

    assert.equal(queries.length, 2);
    assert.equal(loaded.plan.plannedMinutes, 660);
    assert.deepEqual(loaded.plan.segments[0].additionalProfessionKeys, ['manager']);
});

test('update by hrShiftId cannot validate against a different staff card', async () => {
    const client = {
        async query(sql, params) {
            const text = String(sql);
            if (/FROM staff/.test(text)) {
                assert.deepEqual(params, [17]);
                return {
                    rows: [{
                        id: 17,
                        name: 'Test Staff',
                        role_type: 'reception',
                        secondary_professions: [],
                        is_active: true
                    }]
                };
            }
            assert.match(text, /SELECT [^]* FROM hr_shifts WHERE id = \$1/);
            assert.deepEqual(params, [42]);
            return { rows: [{
                id: 42,
                staff_id: 17,
                shift_date: '2026-07-13',
                profession_key: 'reception',
                planned_start: '09:00',
                planned_end: '18:00',
                break_minutes: 0,
                shift_type: 'regular'
            }] };
        }
    };

    await assert.rejects(
        saveHrShiftDayPlan(client, {
            hrShiftId: 42,
            staffId: 99,
            payload: {
                primaryProfessionKey: 'reception',
                segments: [segment('reception', '09:00', '18:00')]
            }
        }),
        error => error.code === 'HR_SHIFT_PLAN_SELECTOR_MISMATCH'
    );
});

test('every legacy mutation rejects an existing multi-segment plan before parent writes', async () => {
    const legacyPayloads = [
        { notes: 'Updated note' },
        { shift_type: 'remote' },
        { status: 'working' },
        { status: 'dayoff' },
        { primaryProfessionKey: 'manager' },
        {
            professionKey: 'reception',
            shiftStart: '09:00',
            shiftEnd: '20:00',
            breakMinutes: 0,
            notes: 'Legacy UI note'
        },
        {
            professionKey: 'reception',
            shiftStart: '10:00',
            shiftEnd: '20:00',
            breakMinutes: 0
        }
    ];
    const rejectedStates = [];
    for (const payload of legacyPayloads) {
        const state = createExistingMultiSegmentClient('regular');
        rejectedStates.push(state);
        await assert.rejects(
            saveHrShiftDayPlan(state.client, {
                hrShiftId: 42,
                payload
            }, { actor: 'unit-test' }),
            error => error.code === 'HR_SHIFT_SEGMENTS_REQUIRED'
                && error.statusCode === 409
                && error.details.hrShiftId === 42
        );
        assert.equal(
            state.calls.some(call => /^UPDATE hr_shifts SET/.test(call.text)),
            false,
            'legacy rejection must happen before any parent write'
        );
    }

    const richSingleSegment = createExistingMultiSegmentClient('regular', [{
        id: 81,
        hr_shift_id: 42,
        profession_key: 'reception',
        planned_start: '09:00',
        planned_end: '20:00',
        break_minutes: 0,
        notes: 'Keep segment note',
        sort_order: 0,
        additional_profession_keys: ['manager']
    }]);
    const richSingleSaved = await saveHrShiftDayPlan(richSingleSegment.client, {
        hrShiftId: 42,
        payload: {
            professionKey: 'reception',
            shiftStart: '09:00',
            shiftEnd: '20:00',
            breakMinutes: 0,
            notes: 'Day note from legacy UI'
        }
    }, { actor: 'unit-test' });
    assert.equal(richSingleSaved.plan.segments[0].note, 'Keep segment note');
    assert.deepEqual(richSingleSaved.plan.segments[0].additionalProfessionKeys, ['manager']);

    const plainSingleProfessionUpdate = createExistingMultiSegmentClient('regular', [{
        id: 91,
        hr_shift_id: 42,
        profession_key: 'reception',
        planned_start: '09:00',
        planned_end: '20:00',
        break_minutes: 0,
        notes: null,
        sort_order: 0,
        additional_profession_keys: []
    }]);
    const professionSaved = await saveHrShiftDayPlan(plainSingleProfessionUpdate.client, {
        hrShiftId: 42,
        payload: { profession_key: 'manager' }
    }, { actor: 'unit-test' });
    assert.equal(professionSaved.plan.primaryProfessionKey, 'manager');
    assert.equal(professionSaved.plan.segments[0].professionKey, 'manager');

    const lockOrder = rejectedStates[0].calls.map(call => call.text);
    const observedParentIndex = lockOrder.findIndex(text => /^SELECT .* FROM hr_shifts WHERE id = \$1$/.test(text));
    const staffLockIndex = lockOrder.findIndex(text => /FROM staff/.test(text) && /FOR SHARE/.test(text));
    const parentLockIndex = lockOrder.findIndex(text => /^SELECT .* FROM hr_shifts WHERE id = \$1 FOR UPDATE$/.test(text));
    assert.ok(observedParentIndex >= 0 && observedParentIndex < staffLockIndex);
    assert.ok(staffLockIndex < parentLockIndex);
});

test('staff/date plan loader hydrates many source days with one query', async () => {
    let queries = 0;
    const db = {
        async query(sql, params) {
            queries += 1;
            assert.match(String(sql), /UNNEST\(\$1::int\[\], \$2::date\[\]\)/);
            assert.deepEqual(params, [[17, 17], ['2026-07-13', '2026-07-14']]);
            return {
                rows: [{
                    shift_row: {
                        id: 42,
                        staff_id: 17,
                        shift_date: '2026-07-13',
                        profession_key: 'reception',
                        planned_start: '09:00',
                        planned_end: '13:00',
                        break_minutes: 0,
                        shift_type: 'regular'
                    },
                    segment_id: 71,
                    profession_key: 'reception',
                    planned_start: '09:00',
                    planned_end: '13:00',
                    break_minutes: 0,
                    notes: null,
                    sort_order: 0,
                    additional_profession_keys: []
                }]
            };
        }
    };

    const plans = await loadHrShiftDayPlansForStaffDates(db, [
        { staffId: 17, date: '2026-07-14' },
        { staffId: 17, date: '2026-07-13' },
        { staffId: 17, date: '2026-07-13' }
    ]);
    assert.equal(queries, 1);
    assert.equal(plans.get('17:2026-07-13')?.plan?.segments?.[0]?.id, 71);
});

test('two managers reading one plan version cannot silently overwrite each other', async () => {
    const state = createExistingMultiSegmentClient('regular');
    const firstClientVersion = state.planUpdatedAt();
    const secondClientVersion = firstClientVersion;

    const firstSave = await saveHrShiftDayPlan(state.client, {
        hrShiftId: 42,
        expectedUpdatedAt: firstClientVersion,
        payload: {
            primaryProfessionKey: 'reception',
            segments: [
                segment('reception', '09:00', '13:00'),
                segment('manager', '13:00', '19:00')
            ]
        }
    }, { actor: 'manager-one', requireExpectedUpdatedAt: true });
    assert.notEqual(firstSave.shift.plan_updated_at_token, firstClientVersion);
    const replacementsAfterFirstSave = state.calls.filter(call => /^DELETE FROM hr_shift_segments/.test(call.text)).length;

    await assert.rejects(
        saveHrShiftDayPlan(state.client, {
            hrShiftId: 42,
            expectedUpdatedAt: secondClientVersion,
            payload: {
                primaryProfessionKey: 'reception',
                segments: [
                    segment('reception', '10:00', '14:00'),
                    segment('manager', '14:00', '20:00')
                ]
            }
        }, { actor: 'manager-two', requireExpectedUpdatedAt: true }),
        error => error.code === 'HR_SHIFT_PLAN_STALE'
            && error.statusCode === 409
            && error.details.expectedUpdatedAt === secondClientVersion
            && error.details.currentUpdatedAt === firstSave.shift.plan_updated_at_token
    );

    const replacementsAfterStaleSave = state.calls.filter(call => /^DELETE FROM hr_shift_segments/.test(call.text)).length;
    assert.equal(replacementsAfterStaleSave, replacementsAfterFirstSave, 'stale save must fail before child replacement');
});

test('version-aware segment updates require a token and legacy multi-segment updates are rejected', async () => {
    const state = createExistingMultiSegmentClient('regular');
    await assert.rejects(
        saveHrShiftDayPlan(state.client, {
            hrShiftId: 42,
            payload: {
                primaryProfessionKey: 'reception',
                segments: [segment('reception', '09:00', '20:00')]
            }
        }, { requireExpectedUpdatedAt: true }),
        error => error.code === 'HR_SHIFT_PLAN_VERSION_REQUIRED' && error.statusCode === 409
    );
    assert.equal(state.calls.some(call => /^DELETE FROM hr_shift_segments/.test(call.text)), false);

    const legacyState = createExistingMultiSegmentClient('regular');
    await assert.rejects(
        saveHrShiftDayPlan(legacyState.client, {
            hrShiftId: 42,
            payload: { notes: 'Legacy metadata update' }
        }, { requireExpectedUpdatedAt: true }),
        error => error.code === 'HR_SHIFT_SEGMENTS_REQUIRED' && error.statusCode === 409
    );

    const freshLockedBatchState = createExistingMultiSegmentClient('regular');
    const batchSaved = await saveHrShiftDayPlan(freshLockedBatchState.client, {
        hrShiftId: 42,
        expectedUpdatedAt: 'stale-browser-token-that-bulk-must-ignore',
        payload: {
            primaryProfessionKey: 'reception',
            segments: [segment('reception', '09:00', '20:00')]
        }
    }, { ignoreExpectedUpdatedAt: true });
    assert.equal(batchSaved.plan.segments.length, 1);
});

test('direct full replacement still validates roles against the locked shift owner', async () => {
    const calls = [];
    const client = {
        async query(sql, params) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push(text);
            if (/^SELECT id, staff_id FROM hr_shifts WHERE id = \$1$/.test(text)) {
                assert.deepEqual(params, [42]);
                return { rows: [{ id: 42, staff_id: 17 }] };
            }
            if (/SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE/.test(text)) {
                assert.deepEqual(params, [42]);
                return { rows: [{ id: 42, staff_id: 17 }] };
            }
            if (/FROM staff/.test(text)) {
                assert.deepEqual(params, [17]);
                return {
                    rows: [{
                        id: 17,
                        name: 'Test Staff',
                        role_type: 'reception',
                        secondary_professions: [],
                        is_active: true
                    }]
                };
            }
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
    const plan = normalizeHrShiftDayPlan({
        primaryProfessionKey: 'animator',
        segments: [segment('animator', '09:00', '13:00')]
    }, { status: 'working' });

    await assert.rejects(
        replaceHrShiftSegments(client, 42, plan, { allowedProfessionKeys: ['animator'] }),
        error => error.code === 'HR_SHIFT_PLAN_PROFESSION_NOT_ON_STAFF_CARD'
            && error.details.invalidProfessionKeys.includes('animator')
    );
    assert.equal(calls.some(text => /^UPDATE hr_shifts/.test(text)), false);
    assert.equal(calls.some(text => /^DELETE FROM hr_shift_segments/.test(text)), false);
});

test('new-plan persistence locks parent, updates envelope, then inserts children and roles', async () => {
    const calls = [];
    let nextSegmentId = 100;
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (/^SELECT id, staff_id FROM hr_shifts WHERE id = \$1$/.test(text)) {
                return { rows: [{ id: 42, staff_id: 17 }] };
            }
            if (/^SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE$/.test(text)) {
                return { rows: [{ id: 42, staff_id: 17 }] };
            }
            if (/FROM staff/.test(text)) {
                return {
                    rows: [{
                        id: 17,
                        name: 'Test Staff',
                        role_type: 'reception',
                        secondary_professions: ['manager'],
                        is_active: true
                    }]
                };
            }
            if (/^UPDATE hr_shifts SET/.test(text)) {
                return { rows: [{ id: 42, planned_start: params[0], planned_end: params[1], break_minutes: params[2], profession_key: params[3] }] };
            }
            if (/FROM hr_shift_segments hss/.test(text)) return { rows: [] };
            if (/^DELETE FROM hr_shift_segments/.test(text)) return { rows: [] };
            if (/^INSERT INTO hr_shift_segments/.test(text)) {
                nextSegmentId += 1;
                return { rows: [{ id: nextSegmentId }] };
            }
            if (/^INSERT INTO hr_shift_segment_roles/.test(text)) return { rows: [] };
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
    const plan = normalize({
        primaryProfessionKey: 'reception',
        segments: [
            segment('reception', '09:00', '13:00', { additionalProfessionKeys: ['manager'] }),
            segment('manager', '15:00', '20:00')
        ]
    });

    const saved = await replaceHrShiftSegments(client, 42, plan, { actor: 'unit-test' });
    assert.equal(saved.shift.planned_start, '09:00');
    assert.equal(saved.shift.planned_end, '20:00');
    assert.equal(saved.plan.segments.length, 2);

    const observedIndex = calls.findIndex(call => /^SELECT id, staff_id FROM hr_shifts/.test(call.text));
    const staffLockIndex = calls.findIndex(call => /FROM staff/.test(call.text) && /FOR SHARE/.test(call.text));
    const lockIndex = calls.findIndex(call => /^SELECT \* FROM hr_shifts/.test(call.text));
    const childLoadIndex = calls.findIndex(call => /FROM hr_shift_segments hss/.test(call.text));
    const segmentInsertIndex = calls.findIndex(call => /^INSERT INTO hr_shift_segments/.test(call.text));
    const roleInsertIndex = calls.findIndex(call => /^INSERT INTO hr_shift_segment_roles/.test(call.text));
    assert.ok(observedIndex >= 0 && observedIndex < staffLockIndex);
    assert.ok(staffLockIndex < lockIndex);
    assert.ok(lockIndex < childLoadIndex);
    assert.ok(childLoadIndex < segmentInsertIndex);
    assert.ok(segmentInsertIndex < roleInsertIndex);
});

test('diff persistence keeps an unchanged segment id and rejects a foreign segment id', async () => {
    const state = createExistingMultiSegmentClient('regular');
    const saved = await saveHrShiftDayPlan(state.client, {
        hrShiftId: 42,
        payload: {
            primaryProfessionKey: 'reception',
            segments: [
                segment('reception', '09:00', '13:00', { id: 71 }),
                segment('manager', '16:00', '20:00', { id: 72 })
            ]
        }
    }, { actor: 'unit-test' });

    assert.deepEqual(saved.plan.segments.map(item => Number(item.id)), [71, 72]);
    const childUpdates = state.calls.filter(call => /^UPDATE hr_shift_segments SET/.test(call.text));
    assert.equal(childUpdates.length, 1);
    assert.equal(Number(childUpdates[0].params[7]), 72);
    assert.equal(state.calls.some(call => /^INSERT INTO hr_shift_segments/.test(call.text)), false);
    assert.equal(state.calls.some(call => /^DELETE FROM hr_shift_segments/.test(call.text)), false);

    const foreign = createExistingMultiSegmentClient('regular');
    await assert.rejects(
        saveHrShiftDayPlan(foreign.client, {
            hrShiftId: 42,
            payload: {
                primaryProfessionKey: 'reception',
                segments: [segment('reception', '09:00', '13:00', { id: 999 })]
            }
        }, { actor: 'unit-test' }),
        error => error.code === 'HR_SHIFT_SEGMENT_ID_NOT_ON_PARENT' && error.statusCode === 409
    );
    assert.equal(foreign.calls.some(call => /^INSERT INTO hr_shift_segments/.test(call.text)), false);
});
