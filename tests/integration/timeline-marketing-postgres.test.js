'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFixture } = require('../helpers/timeline-marketing-fixture');

test('timeline marketing: real PostgreSQL routes with authenticated fixture principals', {
    skip: !process.env.TIMELINE_MARKETING_TEST_DATABASE_URL, timeout: 120000
}, async t => {
    const fixture = await createFixture();
    const { pool, request } = fixture;
    try {
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
            const unlinked = await request('POST', '/api/afisha/timeline', { ...base, promotionId: null, lineIds: [] });
            assert.equal(unlinked.status, 201);
            assert.equal(unlinked.body.item.line_id, null);
            const assigned = await request('PATCH', `/api/afisha/${unlinked.body.item.id}/timeline`, {
                expectedLineIds: [], lineIds: ['1', '2'], expectedPromotionId: null, promotionId: null
            });
            assert.equal(assigned.status, 200);
            const moved = await request('PATCH', `/api/afisha/${unlinked.body.item.id}/schedule`, {
                date: '2026-10-20', time: '15:00', expectedDate: '2026-10-19', expectedTime: '15:00'
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
    } finally { await fixture.close(); }
});
