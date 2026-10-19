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
        });
        await t.test('database rejects inverted dates; failed history insertion rolls back a move', async () => {
            await assert.rejects(pool.query("INSERT INTO timeline_promotions (business_context,title,starts_on,ends_on,created_by) VALUES ('event_genix','Bad','2026-10-25','2026-10-19','fixture')"), { code: '23514' });
            await pool.query("ALTER TABLE history ADD CONSTRAINT reject_test_move CHECK (action <> 'afisha_move') NOT VALID");
            assert.equal((await request('PATCH', '/api/afisha/3/schedule', { ...input, expectedTime: '14:10', time: '14:10' })).status, 500);
            assert.equal((await pool.query('SELECT date FROM afisha WHERE id=3')).rows[0].date, '2026-10-19');
        });
    } finally { await fixture.close(); }
});
