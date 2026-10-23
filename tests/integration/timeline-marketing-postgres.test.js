'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFixture } = require('../helpers/timeline-marketing-fixture');
const { checkServerConflicts } = require('../../services/booking');

test('timeline marketing: real PostgreSQL routes with authenticated fixture principals', {
    skip: !process.env.TIMELINE_MARKETING_TEST_DATABASE_URL, timeout: 120000
}, async t => {
    const fixture = await createFixture();
    const { pool, request } = fixture;
    try {
        await t.test('birthday slots follow Afisha events, retain manual time and reject stale updates', async () => {
            const created = await request('POST', '/api/afisha', {
                date: '2026-10-22', time: '14:00', title: 'Іменинники', type: 'birthday', duration: 90
            });
            assert.equal(created.status, 200, JSON.stringify(created.body));
            const birthdayId = created.body.item.id;
            const byDate = () => request('GET', '/api/afisha/2026-10-22');
            let birthday = (await byDate()).body.find(item => item.id === birthdayId);
            assert.deepEqual(birthday.birthday_slots.map(slot => slot.time), ['14:00', '18:00']);
            const event = await request('POST', '/api/afisha/timeline', {
                date: '2026-10-22', time: '14:00', duration: 90, title: 'Сцена', type: 'event',
                description: '', promotionId: null, lineIds: []
            });
            assert.equal(event.status, 201, JSON.stringify(event.body));
            birthday = (await byDate()).body.find(item => item.id === birthdayId);
            assert.equal(birthday.birthday_slots[0].time, '15:30');
            const manual = await request('PATCH', `/api/afisha/${birthdayId}/birthday-slots/first`, {
                mode: 'manual', time: '15:45', expectedMode: 'auto', expectedTime: '15:30'
            });
            assert.equal(manual.status, 200, JSON.stringify(manual.body));
            assert.deepEqual(manual.body.slots.map(slot => [slot.time, slot.mode]),
                [['15:45', 'manual'], ['18:00', 'auto']]);
            const stale = await request('PATCH', `/api/afisha/${birthdayId}/birthday-slots/first`, {
                mode: 'manual', time: '16:00', expectedMode: 'auto', expectedTime: '15:30'
            });
            assert.equal(stale.status, 409);
            assert.equal((await pool.query('SELECT mode, time FROM afisha_birthday_slots WHERE afisha_id=$1 AND slot_key=$2',
                [birthdayId, 'first'])).rows[0].time, '15:45');
            const occupied = await request('POST', '/api/afisha/timeline', {
                date: '2026-10-22', time: '15:45', duration: 15, title: 'Новий захід', type: 'event',
                description: '', promotionId: null, lineIds: []
            });
            assert.equal(occupied.status, 201);
            birthday = (await byDate()).body.find(item => item.id === birthdayId);
            assert.equal(birthday.birthday_slots[0].time, '15:45');
            assert.equal(birthday.birthday_slots[0].conflict, true);
            const reset = await request('PATCH', `/api/afisha/${birthdayId}/birthday-slots/first`, {
                mode: 'auto', expectedMode: 'manual', expectedTime: '15:45'
            });
            assert.equal(reset.status, 200, JSON.stringify(reset.body));
            assert.equal(reset.body.slots[0].mode, 'auto');
            assert.equal(reset.body.slots[0].time, '15:30');
        });
        await t.test('two ordinary recurring-style Іменинники records show independent auto and manual times', async () => {
            const greeting = async time => request('POST', '/api/afisha/timeline', {
                date: '2026-10-23', time, duration: 15, title: 'Іменинники', type: 'greeting',
                description: '', promotionId: null, lineIds: []
            });
            const first = await greeting('14:00');
            const second = await greeting('18:00');
            assert.equal(first.status, 201, JSON.stringify(first.body));
            assert.equal(second.status, 201, JSON.stringify(second.body));
            const blocker = await request('POST', '/api/afisha/timeline', {
                date: '2026-10-23', time: '14:00', duration: 90, title: 'Шоу', type: 'event',
                description: '', promotionId: null, lineIds: []
            });
            assert.equal(blocker.status, 201, JSON.stringify(blocker.body));
            const read = async () => (await request('GET', '/api/afisha/2026-10-23')).body;
            let listed = await read();
            assert.deepEqual([first.body.item.id, second.body.item.id].map(id =>
                listed.find(row => row.id === id).birthday_slots[0].time), ['15:30', '18:00']);
            const manual = await request('PATCH', `/api/afisha/${first.body.item.id}/birthday-slots/single`, {
                mode: 'manual', time: '13:30', expectedMode: 'auto', expectedTime: '15:30'
            });
            assert.equal(manual.status, 200, JSON.stringify(manual.body));
            listed = await read();
            assert.equal(listed.find(row => row.id === first.body.item.id).birthday_slots[0].mode, 'manual');
            assert.equal(listed.find(row => row.id === second.body.item.id).birthday_slots[0].mode, 'auto');
        });
        const input = { date: '2026-10-20', time: '14:00', expectedDate: '2026-10-19', expectedTime: '14:00' };
        await t.test('one concurrent schedule update wins and retains unrelated fields', async () => {
            const results = await Promise.all([request('PATCH', '/api/afisha/1/schedule', input), request('PATCH', '/api/afisha/1/schedule', { ...input, date: '2026-10-21' })]);
            assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
            const item = (await pool.query('SELECT * FROM afisha WHERE id=1')).rows[0];
            assert.equal(item.line_id, null);
            assert.equal(item.original_time, '14:00');
            assert.equal(item.duration, 60);
            assert.equal(item.description, 'Відкрита подія');
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM history WHERE action='afisha_move'")).rows[0].n, 1);
        });
        await t.test('regular cross-day, viewers, foreign contexts and aggregate writes are rejected', async () => {
            assert.equal((await request('PATCH', '/api/afisha/2/schedule', { ...input, expectedTime: '14:05', time: '14:05' })).status, 400);
            for (const [query, headers] of [['', { 'x-fixture-role': 'animator' }], ['?businessContext=dar', {}], ['?businessScope=all', {}]]) {
                assert.equal((await request('PATCH', '/api/afisha/3/schedule' + query, { ...input, expectedTime: '14:10', time: '14:10' }, headers)).status, 403);
            }
        });
        let id;
        const values = { title: 'Осінні канікули', description: '−20%', color_key: 'amber', starts_on: '2026-10-19', ends_on: '2026-10-25' };
        await t.test('create, read overlap boundaries and retain date-only strings', async () => {
            const created = await request('POST', '/api/timeline/promotions', values);
            assert.equal(created.status, 201, JSON.stringify(created.body));
            id = created.body.item.id;
            assert.equal(created.body.item.starts_on, values.starts_on);
            assert.equal(created.body.item.version, 1);
            for (const day of ['2026-10-19', '2026-10-25']) {
                const result = await request('GET', `/api/timeline/promotions?from=${day}&to=${day}`);
                assert.equal(result.body.promotions.length, 1);
            }
            assert.equal((await request('GET', '/api/timeline/promotions?from=2026-10-26&to=2026-10-26')).body.promotions.length, 0);
        });
        let linkedAfishaId;
        await t.test('quick create and assignments keep one event with up to two valid animator lines', async () => {
            const base = { title: 'Афішний захід', date: '2026-10-19', time: '15:00', duration: 60,
                type: 'event', description: '', promotionId: id, lineIds: ['1', '2'] };
            assert.equal((await request('POST', '/api/afisha/timeline', { ...base, date: '2026-10-26' })).status, 400);
            assert.equal((await request('POST', '/api/afisha/timeline', { ...base, lineIds: ['1', '1'] })).status, 400);
            assert.equal((await request('POST', '/api/afisha/timeline', { ...base, lineIds: ['missing'] })).status, 400);
            const created = await request('POST', '/api/afisha/timeline', base);
            assert.equal(created.status, 201, JSON.stringify(created.body));
            linkedAfishaId = created.body.item.id;
            assert.equal(created.body.item.line_id, '1');
            assert.equal(created.body.item.second_line_id, '2');
            assert.equal(created.body.item.promotion_id, id);
            const unlinked = await request('POST', '/api/afisha/timeline', { ...base, time: '16:00', promotionId: null, lineIds: [] });
            assert.equal(unlinked.status, 201);
            assert.equal(unlinked.body.item.line_id, null);
            const assigned = await request('PATCH', `/api/afisha/${unlinked.body.item.id}/timeline`, {
                expectedLineIds: [], lineIds: ['1', '2'], expectedPromotionId: null, promotionId: null
            });
            assert.equal(assigned.status, 200);
            const moved = await request('PATCH', `/api/afisha/${unlinked.body.item.id}/schedule`, {
                date: '2026-10-20', time: '16:00', expectedDate: '2026-10-19', expectedTime: '16:00'
            });
            assert.equal(moved.status, 200);
            assert.equal(moved.body.item.line_id, null);
            assert.equal(moved.body.item.second_line_id, null);
            const expected = { expectedLineIds: ['1', '2'], expectedPromotionId: id, promotionId: id };
            const results = await Promise.all([
                request('PATCH', `/api/afisha/${linkedAfishaId}/timeline`, { ...expected, lineIds: ['1'] }),
                request('PATCH', `/api/afisha/${linkedAfishaId}/timeline`, { ...expected, lineIds: ['2'] })
            ]);
            assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
            const current = (await pool.query('SELECT * FROM afisha WHERE id=$1', [linkedAfishaId])).rows[0];
            assert.equal(current.second_line_id, null);
            assert.equal((await request('PATCH', `/api/afisha/${linkedAfishaId}/schedule`, {
                date: '2026-10-26', time: '15:00', expectedDate: '2026-10-19', expectedTime: '15:00'
            })).status, 400);
            assert.equal((await request('PUT', `/api/afisha/${linkedAfishaId}`, {
                date: '2026-10-26', time: '15:00', title: 'Афішний захід', duration: 60, type: 'event', description: ''
            })).status, 400);
            assert.equal((await pool.query('SELECT date FROM afisha WHERE id=$1', [linkedAfishaId])).rows[0].date, '2026-10-19');
            const reassigned = await request('PATCH', `/api/afisha/${unlinked.body.item.id}/timeline`, {
                expectedLineIds: [], lineIds: ['1', '2'], expectedPromotionId: null, promotionId: null
            });
            assert.equal(reassigned.status, 200);
            const legacyMoved = await request('PUT', `/api/afisha/${unlinked.body.item.id}`, {
                date: '2026-10-21', time: '15:00', title: 'Афішний захід', duration: 60, type: 'event', description: ''
            });
            assert.equal(legacyMoved.status, 200);
            const legacyRow = (await pool.query('SELECT date, line_id, second_line_id FROM afisha WHERE id=$1', [unlinked.body.item.id])).rows[0];
            assert.deepEqual(legacyRow, { date: '2026-10-21', line_id: null, second_line_id: null });
        });
        await t.test('manual Afisha assignment rejects occupied booking and Afisha slots', async () => {
            await pool.query(`INSERT INTO bookings (date, time, duration, line_id, status, business_context, label)
                VALUES ('2026-10-20', '17:00', 60, '1', 'confirmed', 'event_genix', 'Зайняте бронювання')`);
            const input = { title: 'Перевірка зайнятості', date: '2026-10-20', time: '17:00',
                duration: 60, type: 'event', description: '', promotionId: null };
            const occupiedBooking = await request('POST', '/api/afisha/timeline', { ...input, lineIds: ['1'] });
            assert.equal(occupiedBooking.status, 409);
            assert.match(occupiedBooking.body.error, /Зайняте бронювання/);
            const first = await request('POST', '/api/afisha/timeline', { ...input, lineIds: ['2'] });
            assert.equal(first.status, 201, JSON.stringify(first.body));
            const occupiedEvent = await request('POST', '/api/afisha/timeline', { ...input, time: '17:30', lineIds: ['2'] });
            assert.equal(occupiedEvent.status, 409);
            assert.match(occupiedEvent.body.error, /Перевірка зайнятості/);
            const adjacent = await request('POST', '/api/afisha/timeline', { ...input, time: '18:00', lineIds: ['2'] });
            assert.equal(adjacent.status, 201, JSON.stringify(adjacent.body));
            assert.equal((await request('PATCH', `/api/afisha/${first.body.item.id}/time`, { time: '18:00' })).status, 409);
            assert.equal((await request('PUT', `/api/afisha/${first.body.item.id}`, {
                date: input.date, time: '18:00', title: input.title, duration: 60, type: 'event', description: ''
            })).status, 409);
        });
        await t.test('booking checks respect both Afisha lines and ignore unassigned events', async () => {
            const created = await request('POST', '/api/afisha/timeline', { title: 'Сцена',
                date: '2026-10-20', time: '10:00', duration: 60, type: 'event', description: '',
                promotionId: null, lineIds: ['1', '2'] });
            assert.equal(created.status, 201, JSON.stringify(created.body));
            for (const lineId of ['1', '2']) {
                const conflict = await checkServerConflicts(pool, '2026-10-20', lineId, '10:30', 30);
                assert.equal(conflict.overlap, true);
                assert.match(conflict.conflictWith.label, /Афіша: Сцена/);
            }
            const unassigned = await request('POST', '/api/afisha/timeline', { title: 'Без призначення',
                date: '2026-10-20', time: '11:00', duration: 60, type: 'event', description: '',
                promotionId: null, lineIds: [] });
            assert.equal(unassigned.status, 201, JSON.stringify(unassigned.body));
            const available = await checkServerConflicts(pool, '2026-10-20', '1', '11:30', 30);
            assert.equal(Boolean(available.conflictWith?.label?.startsWith('Афіша:')), false);
        });
        await t.test('legacy line movement preserves the other animator and event reads resolve both names', async () => {
            await pool.query(`INSERT INTO lines_by_date (date, line_id, name, business_context)
                VALUES ('2026-10-20', '3', 'Аніматор 3', 'event_genix')`);
            const created = await request('POST', '/api/afisha/timeline', { title: 'Три лінії',
                date: '2026-10-20', time: '19:00', duration: 60, type: 'event', description: '',
                promotionId: null, lineIds: ['1', '2'] });
            assert.equal(created.status, 201, JSON.stringify(created.body));
            const moved = await request('PATCH', `/api/afisha/${created.body.item.id}/line`, { line_id: 3 });
            assert.equal(moved.status, 200, JSON.stringify(moved.body));
            assert.deepEqual(moved.body.lineIds, ['3', '2']);
            const listed = (await request('GET', '/api/afisha/2026-10-20')).body.find(item => item.id === created.body.item.id);
            assert.equal(listed.line_name, 'Аніматор 3');
            assert.equal(listed.second_line_name, 'Аніматор 2');
        });
        await t.test('automatic distribution leaves events unassigned when every animator is busy', async () => {
            await pool.query(`INSERT INTO bookings (date, time, duration, line_id, status, business_context)
                VALUES ('2026-10-21', '12:00', 480, '1', 'confirmed', 'event_genix'),
                       ('2026-10-21', '12:00', 480, '2', 'confirmed', 'event_genix')`);
            const created = await request('POST', '/api/afisha/timeline', { title: 'Без вільного аніматора',
                date: '2026-10-21', time: '14:00', duration: 60, type: 'event', description: '',
                promotionId: null, lineIds: [] });
            assert.equal(created.status, 201);
            const result = await request('POST', '/api/afisha/distribute/2026-10-21');
            assert.equal(result.status, 200);
            assert.ok(result.body.unassigned >= 1);
            const row = (await pool.query('SELECT line_id, second_line_id FROM afisha WHERE id=$1', [created.body.item.id])).rows[0];
            assert.equal(row.line_id, null);
            assert.equal(row.second_line_id, null);
        });
        await t.test('read and mutation isolation, existing capabilities and aggregate read-only scope', async () => {
            assert.equal((await request('GET', '/api/timeline/promotions?from=2026-10-19&to=2026-10-25&businessContext=dar')).body.promotions.length, 0);
            assert.equal((await request('PATCH', `/api/timeline/promotions/${id}?businessContext=dar`, { title: 'Other', version: 1 })).status, 404);
            assert.equal((await request('POST', '/api/timeline/promotions', values, { 'x-fixture-role': 'animator' })).status, 403);
            assert.equal((await request('POST', '/api/timeline/promotions?businessScope=all', values)).status, 403);
            assert.equal((await request('GET', '/api/timeline/promotions?from=2026-10-19&to=2026-10-25', null, { Authorization: '' })).status, 401);
        });
        await t.test('optimistic versions prevent concurrent overwrite and archive preserves the row', async () => {
            const results = await Promise.all([request('PATCH', `/api/timeline/promotions/${id}`, { title: 'First', version: 1 }), request('PATCH', `/api/timeline/promotions/${id}`, { title: 'Second', version: 1 })]);
            assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
            const archived = await request('PATCH', `/api/timeline/promotions/${id}`, { is_active: false, version: 2 });
            assert.equal(archived.status, 200);
            assert.equal(archived.body.item.version, 3);
            assert.equal((await request('GET', '/api/timeline/promotions?from=2026-10-19&to=2026-10-25')).body.promotions.length, 0);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM timeline_promotions WHERE id=$1', [id])).rows[0].n, 1);
            assert.equal((await pool.query('SELECT promotion_id FROM afisha WHERE id=$1', [linkedAfishaId])).rows[0].promotion_id, id);
            const visibleEvent = (await request('GET', '/api/afisha/2026-10-19')).body.find(item => item.id === linkedAfishaId);
            assert.ok(['First', 'Second'].includes(visibleEvent.promotion_title));
            assert.equal(visibleEvent.promotion_active, false);
            const current = (await pool.query('SELECT * FROM afisha WHERE id=$1', [linkedAfishaId])).rows[0];
            const kept = await request('PATCH', `/api/afisha/${linkedAfishaId}/timeline`, {
                expectedLineIds: [current.line_id], lineIds: [], expectedPromotionId: id, promotionId: id
            });
            assert.equal(kept.status, 200, JSON.stringify(kept.body));
        });
        await t.test('database rejects inverted dates; failed history insertion rolls back a move', async () => {
            await assert.rejects(pool.query("INSERT INTO timeline_promotions (business_context,title,starts_on,ends_on,created_by) VALUES ('event_genix','Bad','2026-10-25','2026-10-19','fixture')"), { code: '23514' });
            await pool.query("ALTER TABLE history ADD CONSTRAINT reject_test_move CHECK (action <> 'afisha_move') NOT VALID");
            assert.equal((await request('PATCH', '/api/afisha/3/schedule', { ...input, expectedTime: '14:10', time: '14:10' })).status, 500);
            assert.equal((await pool.query('SELECT date FROM afisha WHERE id=3')).rows[0].date, '2026-10-19');
        });
        await t.test('auto-distribution preserves two manual animator assignments', async () => {
            const manual = await request('PATCH', `/api/afisha/${linkedAfishaId}/timeline`, {
                expectedLineIds: [], lineIds: ['1', '2'], expectedPromotionId: id, promotionId: id
            });
            assert.equal(manual.status, 200, JSON.stringify(manual.body));
            const distributed = await request('POST', '/api/afisha/distribute/2026-10-19');
            assert.equal(distributed.status, 200, JSON.stringify(distributed.body));
            const row = (await pool.query('SELECT line_id, second_line_id, time FROM afisha WHERE id=$1', [linkedAfishaId])).rows[0];
            assert.deepEqual(row, { line_id: '1', second_line_id: '2', time: '15:00' });
            assert.ok(!distributed.body.distribution.some(item => item.eventId === linkedAfishaId));
        });
        await t.test('approved greeting conversion checks identity, records exact IDs and is idempotent', async () => {
            const sql = require('node:fs').readFileSync(require('node:path').join(__dirname,
                '../../db/migrations/386_park_birthday_greeting_type.sql'), 'utf8');
            await assert.rejects(pool.query(sql), /approved inventory/);
            const emptyClient = await pool.connect();
            try {
                await emptyClient.query('BEGIN');
                await emptyClient.query('DELETE FROM afisha');
                await emptyClient.query(sql);
                assert.equal((await emptyClient.query("SELECT count(*)::int AS n FROM history WHERE action='afisha_greeting_type_386'")).rows[0].n, 0);
            } finally {
                await emptyClient.query('ROLLBACK');
                emptyClient.release();
            }
            await pool.query(`INSERT INTO afisha_templates (id, title, time, duration, type, recurrence_pattern, is_active)
                VALUES (6, 'Іменинники', '14:00', 15, 'event', 'daily', true),
                       (7, 'Іменинники', '18:00', 15, 'event', 'daily', true)`);
            await pool.query(`INSERT INTO afisha (date, time, original_time, title, duration, type, template_id)
                VALUES ('2026-10-22', '14:00', '14:00', 'Іменинники', 15, 'event', 6),
                       ('2027-01-18', '14:00', '14:00', 'Іменинники', 15, 'event', 6),
                       ('2027-01-18', '18:00', '18:00', 'Іменинники', 15, 'event', 7)`);
            await pool.query("UPDATE afisha_templates SET duration = 30 WHERE id = 6");
            await assert.rejects(pool.query(sql), /approved inventory/);
            await pool.query("UPDATE afisha_templates SET duration = 15 WHERE id = 6");
            await pool.query(sql);
            assert.deepEqual((await pool.query('SELECT id, type FROM afisha_templates WHERE id IN (6,7) ORDER BY id')).rows,
                [{ id: 6, type: 'greeting' }, { id: 7, type: 'greeting' }]);
            assert.deepEqual((await pool.query('SELECT date, type FROM afisha WHERE template_id = 6 ORDER BY date')).rows,
                [{ date: '2026-10-22', type: 'event' }, { date: '2027-01-18', type: 'greeting' }]);
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM history WHERE action='afisha_greeting_type_386'")).rows[0].n, 4);
            await pool.query(sql);
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM history WHERE action='afisha_greeting_type_386'")).rows[0].n, 4);
        });
    } finally { await fixture.close(); }
});
