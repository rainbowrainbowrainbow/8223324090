'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchedule } = require('../services/afishaSchedule');
const { validatePromotion } = require('../services/timelinePromotions');
const { createTimelineAfisha, updateTimelineAfisha, normalizeLineIds } = require('../services/afishaTimeline');
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
