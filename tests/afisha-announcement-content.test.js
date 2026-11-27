'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadAnnouncementItems, formatAnnouncement } = require('../services/afishaAnnouncementContent');

test('monthly preview projects recurring events without writes and preserves moved occurrences', async () => {
    const pool = { async query(sql, args) {
        assert.match(sql, /^SELECT /);
        if (sql.includes('FROM afisha WHERE')) {
            return { rows: [
                { id: 1, date: '2026-03-28', time: '14:30', template_id: 7, title: 'Rescheduled', type: 'regular' },
                { id: 2, date: '2026-03-29', time: '14:00', title: 'Private', type: 'birthday' },
                { id: 3, date: '2026-03-29', time: '14:00', title: 'Private greeting', type: 'greeting' }
            ] };
        }
        if (sql.includes('FROM afisha_templates')) {
            return { rows: [
                { id: 7, time: '10:00', title: 'Recurring', type: 'regular', recurrence_pattern: 'weekends',
                    date_from: '2026-03-28', date_to: '2026-03-29' }
            ] };
        }
        assert.match(sql, /FROM timeline_promotions/);
        assert.deepEqual(args, ['event_genix', '2026-03-01', '2026-03-31']);
        return { rows: [] };
    } };
    const items = await loadAnnouncementItems(pool, 'event_genix', '2026-03-01', '2026-03-31');
    assert.deepEqual(items.afisha.map(row => [row.date, row.time, row.title]), [
        ['2026-03-28', '14:30', 'Rescheduled'], ['2026-03-29', '10:00', 'Recurring']
    ]);
});

test('promotion start selection respects business scope and keeps ongoing promotions out of the day digest', async () => {
    const pool = { async query(sql, args) {
        assert.match(sql, /FROM timeline_promotions/);
        assert.deepEqual(args, ['lounge', '2026-11-27', '2026-11-27']);
        return { rows: [
            { id: 1, starts_on: '2026-11-26', ends_on: '2026-11-28' },
            { id: 2, starts_on: '2026-11-27', ends_on: '2026-11-30' }
        ] };
    } };
    assert.deepEqual(await loadAnnouncementItems(pool, 'lounge', '2026-11-27', '2026-11-27', { startsOnly: true }),
        { afisha: [], promotions: [{ id: 2, starts_on: '2026-11-27', ends_on: '2026-11-30' }] });
});

test('formatting nests a linked event once and keeps every part under the Telegram limit', () => {
    const description = '🎪'.repeat(2700);
    const parts = formatAnnouncement('Monthly', {
        afisha: [{ promotion_id: 6, title: 'Linked event', date: '2026-11-27', time: '13:00', description }],
        promotions: [{ id: '6', title: 'Promotion', starts_on: '2026-11-27', ends_on: '2026-11-29' }]
    });
    assert.equal(parts.length, 2);
    assert.equal(parts.join('').match(/Linked event/g).length, 1);
    assert.equal(parts.join('').match(/🎪/gu).length, 2700);
    assert.ok(parts.every(part => part.length <= 3500));
    assert.deepEqual(formatAnnouncement('Empty', { afisha: [], promotions: [] }), []);
});
