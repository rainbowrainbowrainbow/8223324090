const test = require('node:test');
const assert = require('node:assert/strict');

const scheduling = require('../services/taskScheduling');
const { TASK_ACTION_TYPES } = require('../services/taskActionHistory');

test('task scheduling policy exposes four fixed global slots and default duration', () => {
    const policy = scheduling.getSchedulePolicy();
    assert.equal(policy.defaultDurationMinutes, 30);
    assert.deepEqual(policy.slots.map(slot => slot.key), ['morning', 'midday', 'afternoon', 'evening']);
    assert.equal(policy.decisions.fullSlotBehavior, 'proposal_requires_confirmation');
});

test('normalizes slot schedule requests with default and custom duration', () => {
    const defaulted = scheduling.normalizeScheduleRequest({
        schedule: { date: '2026-05-21', slot: 'morning' }
    });
    assert.equal(defaulted.date, '2026-05-21');
    assert.equal(defaulted.slot, 'morning');
    assert.equal(defaulted.durationMinutes, 30);

    const custom = scheduling.normalizeScheduleRequest({
        schedule: { date: '2026-05-21', slot: 'evening', durationMinutes: 75 }
    });
    assert.equal(custom.slot, 'evening');
    assert.equal(custom.durationMinutes, 75);
});

test('builds Kyiv slot windows with ordered start and end instants', () => {
    const window = scheduling.scheduleWindowForSlot('2026-05-21', 'morning');
    assert.ok(window.start instanceof Date);
    assert.ok(window.end instanceof Date);
    assert.ok(window.end.getTime() > window.start.getTime());
});

test('canonical schedule metadata marks date-only tasks before exact-time tasks', () => {
    const dateOnly = scheduling.scheduleSortMeta({ date: '2026-05-21', created_at: '2026-05-20T10:00:00Z' }, new Date('2026-05-20T10:00:00Z'));
    const timed = scheduling.scheduleSortMeta({ scheduled_start_at: '2026-05-21T09:00:00Z', created_at: '2026-05-20T10:00:00Z' }, new Date('2026-05-20T10:00:00Z'));
    assert.equal(dateOnly.hasExactTime, false);
    assert.equal(timed.hasExactTime, true);
    assert.equal(dateOnly.order[0], 0);
    assert.equal(timed.order[0], 1);
});

test('schedule history action taxonomy includes durable scheduling events', () => {
    assert.equal(TASK_ACTION_TYPES.SCHEDULED, 'task_scheduled');
    assert.equal(TASK_ACTION_TYPES.SCHEDULE_MOVED, 'task_schedule_moved');
    assert.equal(TASK_ACTION_TYPES.SCHEDULE_PROPOSAL_CREATED, 'task_schedule_proposal_created');
    assert.equal(TASK_ACTION_TYPES.SLOT_MISSED, 'task_slot_missed');
    assert.equal(TASK_ACTION_TYPES.DISCIPLINE_PENALTY_APPLIED, 'task_discipline_penalty_applied');
});
