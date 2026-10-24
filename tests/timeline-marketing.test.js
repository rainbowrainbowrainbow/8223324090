'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchedule } = require('../services/afishaSchedule');
const { validatePromotion } = require('../services/timelinePromotions');
const { createTimelineAfisha, updateTimelineAfisha, normalizeLineIds } = require('../services/afishaTimeline');
const { assertAfishaLinesFree } = require('../services/afishaConflicts');
const { checkServerConflicts } = require('../services/booking');
const { addDays, daysBetween, weekOf, esc } = require('../js/timeline-marketing');

const event = { date: '2026-10-24', time: '14:00', original_time: '14:00', type: 'event', duration: 60, line_id: 12 };
const move = overrides => ({ date: event.date, time: event.time, expectedDate: event.date, expectedTime: event.time, ...overrides });
const promotion = overrides => ({ title: 'Осінні канікули', description: '−20%', color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-25', is_active: true, ...overrides });

test('one-off dates move without altering duration or the original time anchor', () => {
    assert.doesNotThrow(() => validateSchedule(event, move({ date: '2026-10-25' })));
    assert.equal(event.original_time, '14:00');
    assert.equal(event.duration, 60);
});
test('both expected fields participate in optimistic conflict checks', () => {
    for (const input of [move({ expectedDate: '2026-10-23' }), move({ expectedTime: '13:00' })]) {
        assert.throws(() => validateSchedule(event, input), { statusCode: 409 });
    }
});
test('manual, regular, template and birthday movements retain their domain limits', () => {
    assert.doesNotThrow(() => validateSchedule(event, move({ time: '16:00' })));
    assert.throws(() => validateSchedule(event, move({ time: '16:05' })), { statusCode: 400 });
    assert.doesNotThrow(() => validateSchedule({ ...event, template_id: 1 }, move({ time: '15:30' })));
    assert.throws(() => validateSchedule({ ...event, template_id: 1 }, move({ time: '15:35' })), { statusCode: 400 });
    for (const extra of [{ template_id: 1 }, { type: 'regular' }, { type: 'birthday' }]) {
        assert.throws(() => validateSchedule({ ...event, ...extra }, move({ date: '2026-10-25' })), { statusCode: 400 });
    }
    assert.throws(() => validateSchedule({ ...event, type: 'unknown' }, move()), { statusCode: 400 });
});
test('invalid dates, times, and unsnapped new times are rejected', () => {
    for (const extra of [{ date: '2026-02-30' }, { time: '25:00' }, { time: '14:03' }, { expectedTime: '' }]) {
        assert.throws(() => validateSchedule(event, move(extra)), { statusCode: 400 });
    }
    assert.doesNotThrow(() => validateSchedule({ ...event, time: '14:03' }, move({ date: '2026-10-25', time: '14:03', expectedTime: '14:03' })));
});
test('date-only arithmetic crosses month, year, leap day and Kyiv DST safely', () => {
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.deepEqual(weekOf('2026-10-25'), { start: '2026-10-19', end: '2026-10-25' });
    assert.deepEqual(weekOf('2026-10-19'), { start: '2026-10-19', end: '2026-10-25' });
});
test('promotion fields reject inverted dates, arbitrary colors and oversized content', () => {
    assert.equal(validatePromotion(promotion({ title: ' Тиждень ' })).title, 'Тиждень');
    assert.doesNotThrow(() => validatePromotion(promotion({ ends_on: '2026-10-19' })));
    for (const extra of [{ title: '' }, { title: 'x'.repeat(181) }, { description: 'x'.repeat(4001) },
        { ends_on: '2026-10-18' }, { starts_on: '2026-02-30' }, { color_key: 'url(x)' }, { is_active: 'false' }]) {
        assert.throws(() => validatePromotion(promotion(extra)), { statusCode: 400 });
    }
});
test('annotation text is escaped for HTML and attribute contexts', () => {
    assert.equal(esc('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});

test('timeline Afisha rejects duplicate animator assignments', () => {
    assert.deepEqual(normalizeLineIds([' 1 ', '2']), ['1', '2']);
    assert.throws(() => normalizeLineIds(['1', '1']), { statusCode: 400 });
    assert.throws(() => normalizeLineIds(['1', '2', '3']), { statusCode: 400 });
});

test('timeline Afisha create validates targets and writes event plus history in one transaction', async () => {
    const queries = [];
    const client = { release() {}, async query(sql, params = []) {
        queries.push(sql);
        if (sql.includes('FROM lines_by_date')) return { rows: params[1].map(line_id => ({ line_id })) };
        if (sql.includes('FROM timeline_promotions')) return { rows: [{ id: 7, is_active: true,
            starts_on: '2026-10-19', ends_on: '2026-10-25' }] };
        if (sql.includes('INSERT INTO afisha')) return { rows: [{ id: 9, line_id: '1', second_line_id: '2', promotion_id: 7 }] };
        return { rows: [] };
    } };
    const pool = { connect: async () => client };
    const item = await createTimelineAfisha(pool, { title: 'Подія', date: '2026-10-19', time: '14:00',
        lineIds: ['1', '2'], promotionId: 7 }, 'fixture');
    assert.equal(item.id, 9);
    assert.equal(queries[0], 'BEGIN');
    assert.ok(queries.some(sql => sql.includes('INSERT INTO history')));
    assert.equal(queries.at(-1), 'COMMIT');
});

test('timeline Afisha update rejects stale assignment sets before writing', async () => {
    const queries = [];
    const client = { release() {}, async query(sql) {
        queries.push(sql);
        if (sql.startsWith('SELECT * FROM afisha')) return { rows: [{ id: 9, date: '2026-10-19', type: 'event',
            line_id: '1', second_line_id: null, promotion_id: null }] };
        return { rows: [] };
    } };
    await assert.rejects(updateTimelineAfisha({ connect: async () => client }, 9, {
        expectedLineIds: [], lineIds: ['2'], expectedPromotionId: null, promotionId: null
    }, 'fixture'), { statusCode: 409 });
    assert.ok(queries.includes('ROLLBACK'));
    assert.equal(queries.some(sql => sql.startsWith('UPDATE afisha')), false);
});

test('animator conflict checks cover bookings and either Afisha assignment with adjacent slots allowed', async () => {
    const rows = {
        bookings: [{ line_id: '1', time: '14:00', duration: 60, title: 'Бронювання' }],
        afisha: [{ id: 8, line_id: '2', second_line_id: '3', time: '16:00', duration: 45, title: 'Концерт' }]
    };
    const queries = [];
    const client = { async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes('FROM bookings')) return { rows: rows.bookings };
        if (sql.includes('FROM afisha')) return { rows: rows.afisha };
        return { rows: [] };
    } };
    const base = { date: '2026-10-19', duration: 60 };
    await assert.rejects(assertAfishaLinesFree(client, { ...base, time: '14:30', lineIds: ['1'] }),
        { statusCode: 409, code: 'AFISHA_LINE_CONFLICT' });
    assert.match(queries[0].sql, /pg_advisory_xact_lock/);
    assert.equal(queries[0].params[1], 'line:event_genix:2026-10-19:1');
    assert.match(queries[1].sql, /FROM lines_by_date/);
    await assert.rejects(assertAfishaLinesFree(client, { ...base, time: '16:15', lineIds: ['3'] }),
        { statusCode: 409, code: 'AFISHA_LINE_CONFLICT' });
    await assert.doesNotReject(assertAfishaLinesFree(client, { ...base, time: '15:00', lineIds: ['1'] }));
});

test('new event may take an auto greeting slot but not a manually fixed greeting slot', async () => {
    const greeting = { id: 15, date: '2026-10-19', time: '14:00', original_time: '14:00',
        duration: 15, title: 'Іменинники', type: 'greeting', line_id: '1', second_line_id: null };
    let saved = [];
    const client = { async query(sql) {
        if (sql.includes('FROM afisha_birthday_slots')) return { rows: saved };
        if (sql.includes('FROM afisha')) return { rows: [greeting] };
        return { rows: [] };
    } };
    const input = { date: '2026-10-19', time: '14:00', duration: 15, lineIds: ['1'] };
    await assert.doesNotReject(assertAfishaLinesFree(client, input));
    saved = [{ afisha_id: 15, slot_key: 'single', time: '14:00', mode: 'manual' }];
    await assert.rejects(assertAfishaLinesFree(client, input), { statusCode: 409, code: 'AFISHA_LINE_CONFLICT' });
});

test('Park booking conflicts include both assigned Afisha animators but not unassigned events', async () => {
    const calls = [];
    const client = { async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM afisha')) return { rows: [{ id: 8, date: '2026-10-19', time: '14:00',
            duration: 60, title: 'Вистава', type: 'event', line_id: '1', second_line_id: '2' }] };
        return { rows: [] };
    } };
    for (const lineId of ['1', '2']) {
        const result = await checkServerConflicts(client, '2026-10-19', lineId, '14:30', 30);
        assert.equal(result.overlap, true);
        assert.equal(result.conflictWith.label, 'Афіша: Вистава');
        assert.deepEqual(calls.find(call => call.sql.includes('FROM afisha')).params, ['2026-10-19']);
        calls.length = 0;
    }
    const adjacent = await checkServerConflicts(client, '2026-10-19', '1', '15:00', 30);
    assert.equal(adjacent.overlap, false);
    calls.length = 0;
    const otherBusiness = await checkServerConflicts(client, '2026-10-19', '1', '14:30', 30, null, 'dar');
    assert.equal(otherBusiness.overlap, false);
    assert.equal(calls.some(call => call.sql.includes('FROM afisha')), false);

    const unassigned = { async query(sql) {
        if (sql.includes('FROM afisha')) return { rows: [] };
        return { rows: [] };
    } };
    assert.equal((await checkServerConflicts(unassigned, '2026-10-19', '1', '14:30', 30)).overlap, false);
});

test('Park booking conflict uses the effective birthday slots instead of the legacy event time', async () => {
    const events = [{ id: 10, date: '2026-10-19', time: '12:00', duration: 15,
        title: 'Іменинники', type: 'birthday', line_id: '1', second_line_id: null }];
    const client = { async query(sql) {
        if (sql.includes('FROM afisha_birthday_slots')) return { rows: [{ afisha_id: 10,
            slot_key: 'first', time: '14:20', mode: 'manual' }] };
        if (sql.includes('FROM afisha')) return { rows: events };
        return { rows: [] };
    } };
    assert.equal((await checkServerConflicts(client, '2026-10-19', '1', '12:00', 15)).overlap, false);
    assert.equal((await checkServerConflicts(client, '2026-10-19', '1', '14:20', 15)).overlap, true);
    assert.equal((await checkServerConflicts(client, '2026-10-19', '1', '18:00', 15)).overlap, false);
});

test('Park booking can shift an already moved automatic greeting again', async () => {
    const events = [
        { id: 10, date: '2026-10-19', time: '14:00', original_time: '14:00', duration: 15,
            title: 'Іменинники', type: 'greeting', line_id: '1', second_line_id: null },
        { id: 11, date: '2026-10-19', time: '14:00', duration: 90,
            title: 'Шоу', type: 'event', line_id: null, second_line_id: null }
    ];
    const client = { async query(sql) {
        if (sql.includes('FROM afisha')) return { rows: events };
        return { rows: [] };
    } };
    assert.equal((await checkServerConflicts(client, '2026-10-19', '1', '14:00', 15)).overlap, false);
    const occupied = await checkServerConflicts(client, '2026-10-19', '1', '13:45', 15);
    assert.equal(occupied.overlap, false);
});

test('a new booking moves an assigned automatic greeting on either animator line', async () => {
    const greeting = { id: 20, date: '2026-10-19', time: '14:00', original_time: '14:00',
        duration: 15, title: 'Іменинники', type: 'greeting', line_id: '1', second_line_id: '2' };
    const client = { async query(sql) {
        if (sql.includes('FROM afisha')) return { rows: [greeting] };
        return { rows: [] };
    } };
    for (const line of ['1', '2']) {
        const result = await checkServerConflicts(client, '2026-10-19', line, '14:00', 30);
        assert.equal(result.overlap, false, `auto greeting should move for line ${line}`);
    }
});

test('moving an existing booking excludes its old position and projects its new position', async () => {
    const greeting = { id: 22, date: '2026-10-19', time: '14:00', original_time: '14:00',
        duration: 15, title: 'Іменинники', type: 'greeting', line_id: '1', second_line_id: null };
    const bookingQueries = [];
    const client = { async query(sql, params) {
        if (sql.includes('FROM afisha')) return { rows: [greeting] };
        if (sql.includes('FROM bookings')) { bookingQueries.push(params); return { rows: [] }; }
        return { rows: [] };
    } };
    const result = await checkServerConflicts(client, '2026-10-19', '1', '14:00', 30, 'move-1');
    assert.equal(result.overlap, false);
    assert.equal(bookingQueries.length, 2);
    assert.equal(bookingQueries[0][3], 'move-1');
    assert.deepEqual(bookingQueries[1][2], ['move-1']);
});

test('a booking still conflicts with a manual greeting or an auto greeting with no free slot', async () => {
    const greeting = { id: 21, date: '2026-10-19', time: '14:00', original_time: '14:00',
        duration: 15, title: 'Іменинники', type: 'greeting', line_id: '1', second_line_id: null };
    let saved = [{ afisha_id: 21, slot_key: 'single', time: '14:00', mode: 'manual' }];
    let bookings = [];
    const client = { async query(sql) {
        if (sql.includes('FROM afisha_birthday_slots')) return { rows: saved };
        if (sql.includes('FROM afisha')) return { rows: [greeting] };
        if (sql.includes('FROM bookings')) return { rows: bookings };
        return { rows: [] };
    } };
    assert.equal((await checkServerConflicts(client, '2026-10-19', '1', '14:00', 15)).overlap, true);
    saved = [];
    bookings = [
        { id: 'before', date: greeting.date, line_id: '1', time: '12:30', duration: 90 },
        { id: 'after', date: greeting.date, line_id: '1', time: '14:15', duration: 90 }
    ];
    const unavailable = await checkServerConflicts(client, '2026-10-19', '1', '14:00', 15);
    assert.equal(unavailable.overlap, true);
    assert.match(unavailable.conflictWith.label, /немає вільних 15 хвилин/);
});
