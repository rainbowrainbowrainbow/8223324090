'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isoDate, kyivClock, lessonPhase } = require('../services/educationAttendance');

test('attendance dates reject rollover and malformed calendar values', () => {
    assert.equal(isoDate('2026-02-28', 'date'), '2026-02-28');
    assert.throws(() => isoDate('2026-02-29', 'date'), /invalid date/);
    assert.throws(() => isoDate('2026-13-01', 'date'), /invalid date/);
});

test('Kyiv day boundaries follow daylight-saving time', () => {
    assert.deepEqual(kyivClock(new Date('2026-03-29T20:30:00Z')),
        { date: '2026-03-29', minutes: 23 * 60 + 30 });
    assert.deepEqual(kyivClock(new Date('2026-03-29T21:30:00Z')),
        { date: '2026-03-30', minutes: 30 });
    assert.deepEqual(kyivClock(new Date('2026-10-25T21:30:00Z')),
        { date: '2026-10-25', minutes: 23 * 60 + 30 });
    assert.deepEqual(kyivClock(new Date('2026-10-25T22:30:00Z')),
        { date: '2026-10-26', minutes: 30 });
});

test('report phases exclude future and cancelled lessons', () => {
    const clock = { date: '2026-10-26', minutes: 10 * 60 };
    assert.equal(lessonPhase({ date: '2026-10-26', time: '09:30', duration: 30 }, clock), 'held');
    assert.equal(lessonPhase({ date: '2026-10-26', time: '09:45', duration: 30 }, clock), 'scheduled');
    assert.equal(lessonPhase({ date: '2026-10-27', time: '09:00', duration: 30 }, clock), 'scheduled');
    assert.equal(lessonPhase({ date: '2026-10-25', time: '09:00', duration: 30, status: 'cancelled' }, clock), 'cancelled');
});
