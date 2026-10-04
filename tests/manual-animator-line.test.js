'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appendManualAnimatorLine, nextManualAnimatorName } = require('../services/manualAnimatorLine');

function fakePool(initialRows = [], options = {}) {
    const rows = initialRows.map(row => ({ ...row }));
    let pendingLock = Promise.resolve();
    let failCommitAfterApply = Boolean(options.failCommitAfterApply);
    return {
        rows,
        async connect() {
            let unlock = null;
            return {
                async query(sql, values = []) {
                    if (sql === 'BEGIN') return { rows: [] };
                    if (sql.includes('pg_advisory_xact_lock')) {
                        const prior = pendingLock;
                        pendingLock = new Promise(resolve => { unlock = resolve; });
                        await prior;
                        return { rows: [] };
                    }
                    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
                        unlock?.();
                        if (sql === 'COMMIT' && failCommitAfterApply) {
                            failCommitAfterApply = false;
                            throw new Error('COMMIT response lost');
                        }
                        return { rows: [] };
                    }
                    if (sql.startsWith('SELECT line_id, name, color FROM lines_by_date')) {
                        return { rows: rows.filter(row => row.business_context === values[0]
                            && row.date === values[1] && row.line_id === values[2]) };
                    }
                    if (sql.includes('INSERT INTO lines_by_date')) {
                        rows.push({ business_context: values[0], date: values[1], line_id: values[2],
                            name: values[3], color: values[4], from_sheet: false });
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected query: ${sql}`);
                },
                release() {}
            };
        }
    };
}

const date = '2026-10-02';
const key1 = '11111111-1111-4111-8111-111111111111';
const key2 = '22222222-2222-4222-8222-222222222222';
const key3 = '33333333-3333-4333-8333-333333333333';
function currentDateLines(pool) {
    return async () => pool.rows.filter(row => row.business_context === 'event_genix' && row.date === date)
        .map(row => ({ id: row.line_id, name: row.name }));
}

test('manual animator names fill a free slot without changing existing lines', () => {
    assert.equal(nextManualAnimatorName([{ name: 'Аніматор 1' }, { name: 'Аніматор 3' }]).name, 'Аніматор 2');
});

test('concurrent additions append distinct lines, replay is idempotent, and reload sees persistent rows', async () => {
    const pool = fakePool([
        { business_context: 'event_genix', date, line_id: 'existing', name: 'Аніматор 1', color: '#123456', from_sheet: false },
        { business_context: 'dar', date, line_id: 'dar-existing', name: 'Аніматор 2', color: '#abcdef', from_sheet: false }
    ]);
    const options = { getLines: currentDateLines(pool) };
    const [first, second] = await Promise.all([
        appendManualAnimatorLine(pool, date, key1, options),
        appendManualAnimatorLine(pool, date, key2, options)
    ]);
    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.deepEqual([first.line.name, second.line.name].sort(), ['Аніматор 2', 'Аніматор 3']);
    const repeat = await appendManualAnimatorLine(pool, date, key1, options);
    assert.equal(repeat.created, false);
    assert.deepEqual(repeat.line, first.line);
    const later = await appendManualAnimatorLine(pool, date, key3, options);
    assert.equal(later.line.name, 'Аніматор 4');
    assert.equal(pool.rows.length, 5);
    assert.deepEqual(pool.rows.find(row => row.line_id === 'existing'), {
        business_context: 'event_genix', date, line_id: 'existing',
        name: 'Аніматор 1', color: '#123456', from_sheet: false
    });
    assert.equal(pool.rows.find(row => row.line_id === 'dar-existing').name, 'Аніматор 2');
    assert.deepEqual((await currentDateLines(pool)()).map(line => line.name).sort(),
        ['Аніматор 1', 'Аніматор 2', 'Аніматор 3', 'Аніматор 4']);
});

test('same request ID in concurrent requests creates only one row', async () => {
    const pool = fakePool();
    const options = { getLines: currentDateLines(pool) };
    const outcomes = await Promise.all([
        appendManualAnimatorLine(pool, date, key1, options),
        appendManualAnimatorLine(pool, date, key1, options)
    ]);
    assert.deepEqual(outcomes.map(outcome => outcome.created).sort(), [false, true]);
    assert.equal(pool.rows.length, 1);
});

test('retry after an ambiguous COMMIT response returns the already committed line', async () => {
    const pool = fakePool([], { failCommitAfterApply: true });
    const options = { getLines: currentDateLines(pool) };
    await assert.rejects(appendManualAnimatorLine(pool, date, key1, options), /COMMIT response lost/);
    assert.equal(pool.rows.length, 1);
    const replay = await appendManualAnimatorLine(pool, date, key1, options);
    assert.equal(replay.created, false);
    assert.equal(replay.line.id, pool.rows[0].line_id);
    assert.equal(pool.rows.length, 1);
});

test('invalid request ID fails before obtaining a database client', async () => {
    const pool = { connect() { throw new Error('must not connect'); } };
    await assert.rejects(appendManualAnimatorLine(pool, date, 'bad-id'), error => error.statusCode === 400);
});

test('manual line route keeps role, booking capability, context and room-view guards', async () => {
    const router = require('../routes/lines');
    const handler = router.stack.find(layer => layer.route?.path === '/:date/manual').route.stack[0].handle;
    async function statusFor(user, { context = 'event_genix', view = 'animators', requestDate = date } = {}) {
        const req = { user, params: { date: requestDate }, body: {},
            query: { businessContext: context, timelineView: view }, headers: {} };
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.body = payload; return this; }
        };
        await handler(req, res);
        return res.statusCode;
    }
    assert.equal(await statusFor({ role: 'manager' }, { requestDate: 'invalid' }), 400);
    assert.equal(await statusFor({ role: 'manager' }, { context: 'dar' }), 403);
    assert.equal(await statusFor({ role: 'manager' }, { view: 'rooms' }), 409);
    assert.equal(await statusFor({ role: 'animator' }), 403);
    assert.equal(await statusFor({ role: 'manager', action_denylist: ['create_booking'] }), 403);
});
