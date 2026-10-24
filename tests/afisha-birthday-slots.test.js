'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectBirthdaySlots, birthdaySlotsForEvents } = require('../services/afishaBirthdaySlots');

const date = '2026-10-26';
const birthday = (id = 1) => ({ id, date, time: '12:00', title: 'Іменинники', type: 'birthday' });
const event = (id, time, duration) => ({ id, date, time, duration, title: `Захід ${id}`, type: 'event' });
const slots = (events, saved = [], bookings = []) => projectBirthdaySlots(events, saved, bookings)[0].birthday_slots;

test('legacy birthday record has two independent 15-minute auto slots', () => {
    const result = slots([birthday()]);
    assert.deepEqual(result.map(item => [item.key, item.time, item.duration, item.mode]), [
        ['first', '14:00', 15, 'auto'], ['second', '18:00', 15, 'auto']
    ]);
});

test('event occupying 14:00 through 15:30 moves the first greeting to the nearest earlier slot', () => {
    const result = slots([birthday(), event(2, '14:00', 90)]);
    assert.equal(result[0].time, '13:45');
    assert.match(result[0].reason, /Захід 2/);
    assert.equal(result[1].time, '18:00');
});

test('when no later slot is free, auto greeting moves before an event', () => {
    const result = slots([birthday(), event(2, '18:00', 105)]);
    assert.equal(result[1].time, '17:45');
});

test('auto greeting chooses the nearest free slot on either side', () => {
    const result = slots([birthday(), event(2, '18:00', 45), event(3, '17:50', 10)]);
    assert.equal(result[1].time, '17:35');
    assert.equal(result[1].conflict, false);
});

test('a manual slot stays fixed and reports a later conflict', () => {
    const result = slots([birthday(), event(2, '14:20', 30)], [
        { afisha_id: 1, slot_key: 'first', time: '14:20', mode: 'manual', updated_by: 'owner' }
    ]);
    assert.equal(result[0].time, '14:20');
    assert.equal(result[0].mode, 'manual');
    assert.equal(result[0].conflict, true);
    assert.match(result[0].reason, /Конфлікт/);
    assert.equal(result[1].mode, 'auto');
});

test('only an assigned animator booking affects a greeting', () => {
    const greeting = { ...birthday(), line_id: 'animator-1' };
    const booking = { date, line_id: 'animator-2', time: '14:00', duration: 30 };
    assert.equal(slots([greeting], [], [booking])[0].time, '14:00');
    assert.equal(slots([greeting], [], [{ ...booking, line_id: 'animator-1' }])[0].time, '13:45');
});

test('an unassigned auto greeting moves around an animator booking', () => {
    const greeting = { id: 6, date, time: '14:00', original_time: '14:00', title: 'Іменинники',
        duration: 15, type: 'greeting' };
    const booking = { date, line_id: 'animator-1', time: '14:00', duration: 60 };
    const [slot] = slots([greeting], [], [booking]);
    assert.equal(slot.time, '13:45');
    assert.equal(slot.mode, 'auto');
    assert.match(slot.reason, /Бронювання/);
    const [manual] = slots([greeting], [
        { afisha_id: 6, slot_key: 'single', time: '14:00', mode: 'manual', updated_by: 'owner' }
    ], [booking]);
    assert.equal(manual.time, '14:00');
    assert.equal(manual.mode, 'manual');
    assert.equal(manual.conflict, true);
});

test('unassigned greeting loads animator bookings when projecting database events', async () => {
    const greeting = { id: 6, date, time: '14:00', original_time: '14:00', title: 'Іменинники',
        duration: 15, type: 'greeting' };
    const queries = [];
    const queryable = { query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: sql.includes('FROM bookings')
            ? [{ date, line_id: 'animator-1', time: '14:00', duration: 60 }]
            : [] };
    } };
    const projected = await birthdaySlotsForEvents(queryable, [greeting]);
    assert.equal(queries.length, 2);
    assert.equal(queries[1].params[1], null);
    assert.equal(projected[0].birthday_slots[0].time, '13:45');
});

test('multiple birthdays do not occupy the same fifteen minutes', () => {
    const projected = projectBirthdaySlots([birthday(1), birthday(2)]);
    assert.equal(projected[0].birthday_slots[0].time, '14:00');
    assert.equal(projected[1].birthday_slots[0].time, '14:15');
    assert.equal(projected[1].birthday_slots[1].time, '18:15');
});

test('fully occupied window keeps a visible conflict instead of hiding the greeting', () => {
    const result = slots([birthday(), event(2, '12:30', 195)]);
    assert.equal(result[0].time, '14:00');
    assert.equal(result[0].conflict, true);
    assert.equal(result[0].conflict_kind, 'no_available_slot');
    assert.match(result[0].reason, /Немає вільних/);
});

test('the two production-style recurring event rows move independently around an event', () => {
    const first = { id: 6, date, time: '14:00', original_time: '14:00', title: 'Іменинники',
        duration: 15, type: 'greeting', template_id: 6 };
    const second = { ...first, id: 7, time: '18:00', original_time: '18:00', template_id: 7 };
    const projected = projectBirthdaySlots([first, second, event(9, '14:00', 90)]);
    assert.equal(projected[0].birthday_slots[0].time, '13:45');
    assert.equal(projected[0].birthday_slots[0].mode, 'auto');
    assert.equal(projected[1].birthday_slots[0].time, '18:00');
    assert.equal(projected[1].birthday_slots[0].mode, 'auto');
});

test('moving one recurring greeting manually keeps its sibling automatic', () => {
    const first = { id: 6, date, time: '14:00', original_time: '14:00', title: 'Іменинники',
        duration: 15, type: 'greeting', template_id: 6 };
    const second = { ...first, id: 7, time: '18:00', original_time: '18:00', template_id: 7 };
    const projected = projectBirthdaySlots([first, second, event(9, '14:00', 90)], [
        { afisha_id: 6, slot_key: 'single', time: '13:30', mode: 'manual', updated_by: 'owner' }
    ]);
    assert.equal(projected[0].birthday_slots[0].time, '13:30');
    assert.equal(projected[0].birthday_slots[0].mode, 'manual');
    assert.equal(projected[1].birthday_slots[0].mode, 'auto');
});

test('a previously moved recurring greeting is treated as manual', () => {
    const result = projectBirthdaySlots([{ id: 6, date, time: '14:30', original_time: '14:00',
        title: 'Іменинники', duration: 15, type: 'greeting', template_id: 6 }]);
    assert.equal(result[0].birthday_slots[0].time, '14:30');
    assert.equal(result[0].birthday_slots[0].mode, 'manual');
});

test('greeting identity survives renaming while a regular event called Іменинники remains ordinary', () => {
    const greeting = { id: 6, date, time: '14:00', original_time: '14:00', title: 'Свято для дітей',
        duration: 15, type: 'greeting' };
    const ordinary = { id: 7, date, time: '18:00', title: 'Іменинники', duration: 15, type: 'event' };
    const projected = projectBirthdaySlots([greeting, ordinary, event(9, '14:00', 30)]);
    assert.equal(projected[0].birthday_slots[0].time, '13:45');
    assert.equal(projected[1].birthday_slots, undefined);
});
