'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { automaticAnnouncementSlots } = require('../services/afishaAnnouncementSchedule');

const enabledAt = '2026-01-01T00:00:00Z';
const recipient = {
    active: true, afishaMode: 'monthly', monthlyTime: '09:00', monthlyEnabledAt: enabledAt,
    eventsToday: true, promotionsToday: true, dailyTime: '08:00', dailyEnabledAt: enabledAt
};
const slots = (rule, instant) => automaticAnnouncementSlots(rule, new Date(instant));

test('first of the month uses Kyiv time and covers the full calendar month', () => {
    const before = slots(recipient, '2026-07-01T05:59:59Z');
    assert.deepEqual(before.due.map(slot => slot.key), ['daily:2026-07-01']);
    assert.equal(before.upcoming[0].key, 'monthly:2026-07-01');

    const after = slots(recipient, '2026-07-01T06:00:00Z');
    const monthly = after.due.find(slot => slot.kind === 'monthly');
    assert.equal(monthly.from, '2026-07-01');
    assert.equal(monthly.to, '2026-07-31');
    assert.equal(monthly.expiresAt, Date.parse('2026-07-01T21:00:00Z'));
});

test('activation after the send time, disabled targets and expired days produce no backfill', () => {
    const activatedLate = { ...recipient, monthlyEnabledAt: '2026-07-01T06:01:00Z', dailyEnabledAt: '2026-07-01T06:01:00Z' };
    assert.deepEqual(slots(activatedLate, '2026-07-01T06:02:00Z').due, []);
    assert.deepEqual(slots(recipient, '2026-07-01T21:00:00Z').due, []);
    assert.deepEqual(slots({ ...recipient, active: false }, '2026-07-01T06:02:00Z'), { due: [], upcoming: [] });
});

test('fall-back repeats the wall clock with one stable slot while spring-forward shifts it ahead', () => {
    const rule = { ...recipient, afishaMode: 'off', dailyTime: '03:30' };
    const atFirstOccurrence = slots(rule, '2026-10-25T00:30:00Z').due[0];
    const atSecondOccurrence = slots(rule, '2026-10-25T01:30:00Z').due[0];
    assert.equal(atFirstOccurrence.scheduledAt, Date.parse('2026-10-25T00:30:00Z'));
    assert.deepEqual(atSecondOccurrence, atFirstOccurrence);
    assert.deepEqual(slots({ ...rule, dailyEnabledAt: '2026-10-25T01:05:00Z' }, '2026-10-25T01:30:00Z').due, []);

    assert.deepEqual(slots(rule, '2026-03-29T01:29:59Z').due, []);
    assert.equal(slots(rule, '2026-03-29T01:30:00Z').due[0].scheduledAt, Date.parse('2026-03-29T01:30:00Z'));
});
