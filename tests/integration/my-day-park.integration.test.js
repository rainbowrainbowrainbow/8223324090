'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');
const { loadEmployeeResults, employeeMonthRange } = require('../../services/profileEmployeeMonths');
const { request, getToken } = require('../helpers');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

test('park edition paginates all periods and disables legacy module writes', {
    skip: process.env.RUN_MY_DAY_PARK_INTEGRATION !== 'true'
}, async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const token = await getToken();
    assert.ok(token);
    const profile = await request('GET', '/api/auth/profile', undefined, token);
    const owner = profile.data.user.id;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    try {
        const current = await request('GET', '/api/tasks/my-cabinet', undefined, token);
        const today = current.data.meta.calendar.today;

        const seeded = await pool.query(`
            INSERT INTO tasks (title, date, status, workflow_state, visibility, task_mode, owner_user_id, business_context, created_by)
            SELECT 'Park pagination fixture ' || seq,
                   CASE WHEN seq <= 205 THEN NULL
                        WHEN seq <= 410 THEN ($2::date + 90)::text
                        ELSE $2::text END,
                   'todo', CASE WHEN seq % 2 = 0 THEN 'waiting' ELSE 'inbox' END,
                   CASE WHEN seq % 2 = 0 THEN 'private' ELSE 'team' END,
                   CASE WHEN seq % 2 = 0 THEN 'private' ELSE 'work' END,
                   $1, 'event_genix', $3
            FROM generate_series(1, 615) AS seq RETURNING id, date, visibility
        `, [owner, today, profile.data.user.username]);
        const expected = {
            noDate: seeded.rows.filter(r => !r.date),
            future: seeded.rows.filter(r => r.date && r.date !== today),
            today: seeded.rows.filter(r => r.date === today)
        };
        const initial = await request('GET', '/api/tasks/my-cabinet?planningRowLimit=35', undefined, token);
        assert.equal(initial.status, 200);
        for (const [bucket, rows] of Object.entries(expected)) {
            const found = new Set(initial.data.planning[bucket].map(task => task.id));
            const bucketMeta = initial.data.meta.planning.buckets[bucket];
            assert.ok(bucketMeta.total >= rows.length);
            let cursor = bucketMeta.nextCursor;
            while (cursor) {
                const page = await request('GET', `/api/tasks/my-cabinet?bucket=${bucket}&offset=${cursor.offset}&limit=70`, undefined, token);
                assert.equal(page.status, 200);
                for (const task of page.data.tasks) {
                    assert.equal(found.has(task.id), false, `${bucket}:${task.id} repeated`);
                    found.add(task.id);
                }
                cursor = page.data.meta.bucketPage.nextCursor;
            }
            assert.equal(found.size, bucketMeta.total);
            for (const row of rows) assert.ok(found.has(row.id), `${bucket}:${row.id} missing`);
        }
        async function testActor(label, business = 'event_genix') {
            const username = `park_${label}_${randomBytes(4).toString('hex')}`;
            const password = `Local-${randomBytes(12).toString('hex')}-Aa9`;
            const created = await request('POST', '/api/users', {
                username, password, name: `Local park ${label}`, role: 'director',
                actionAllowlist: [], actionDenylist: [],
                businessContexts: [business], defaultBusinessContext: business
            }, token);
            assert.equal(created.status, 200);
            const login = await request('POST', '/api/auth/login', { username, password });
            assert.equal(login.status, 200);
            return { id: created.data.user.id, token: login.data.token };
        }

        const legacyPrivate = expected.noDate.find(row => row.visibility === 'private').id;
        const [observer, peer, foreign] = await Promise.all([
            testActor('observer'), testActor('peer'), testActor('foreign', 'dar')
        ]);
        await pool.query('INSERT INTO task_observers (task_id, user_id, access_level) VALUES ($1, $2, $3)',
            [legacyPrivate, observer.id, 'watch']);
        for (const accessToken of [token, observer.token]) {
            assert.equal((await request('GET', `/api/tasks/${legacyPrivate}`, undefined, accessToken)).status, 200);
        }
        for (const accessToken of [peer.token, foreign.token]) {
            const inaccessible = await request('GET', `/api/tasks/${legacyPrivate}`, undefined, accessToken);
            assert.ok([403, 404].includes(inaccessible.status));
        }
        const observerCabinet = await request('GET', '/api/tasks/my-cabinet?bucket=noDate', undefined, observer.token);
        assert.ok(observerCabinet.data.tasks.some(task => task.id === legacyPrivate));
        const peerCabinet = await request('GET', '/api/tasks/my-cabinet?bucket=noDate', undefined, peer.token);
        assert.ok(!peerCabinet.data.tasks.some(task => task.id === legacyPrivate));

        await pool.query(`
            INSERT INTO tasks (title, status, task_mode, visibility, owner_user_id, business_context, completed_at)
            VALUES ('Result work fixture', 'done', 'work', 'team', $1, 'event_genix', '2023-02-08 12:00:00'),
                   ('Result private fixture', 'done', 'private', 'private', $1, 'event_genix', '2023-02-08 12:00:00'),
                   ('Result personal fixture', 'done', 'personal', 'me_only', $1, 'event_genix', '2023-02-08 12:00:00')
        `, [owner]);
        const performance = await loadEmployeeResults(pool, { id: 0 }, owner, { activeContext: 'event_genix' },
            employeeMonthRange('2023-02'), { now: new Date('2023-03-01T08:00:00Z') });
        assert.equal(performance.current.tasks.completed, 1);

        const date = expected.future[0].date;
        const focused = await request('GET', `/api/tasks/my-cabinet?bucket=focusDate&focusDate=${date}&limit=12`, undefined, token);
        assert.equal(focused.status, 200);
        assert.ok(focused.data.meta.bucketPage.total >= 205);
        assert.equal(focused.data.tasks.length, 12);
        const [futureTask] = expected.future;
        const unavailable = [
            ['POST', '/api/achievements/check'],
            ['POST', '/api/wallet/daily-login'],
            ['POST', '/api/quests/check-titles'],
            ['GET', '/api/inventory'],
            ['GET', '/api/gamification/leaderboard'],
            ['GET', '/api/my-day/habits'],
            ['GET', '/api/my-day/contribution'],
            ['POST', `/api/my-day/tasks/${futureTask.id}/classification/auto`],
            ['POST', '/api/my-day/timer/start']
        ];
        for (const [method, url] of unavailable) {
            const result = await request(method, url, method === 'POST' ? { taskId: futureTask.id } : undefined, token);
            assert.equal(result.status, 410, url);
            assert.equal(result.data.code, 'MODULE_UNAVAILABLE', url);
        }
        const empty = await request('GET', '/api/my-day/timer', undefined, token);
        assert.equal(empty.status, 200);
        assert.equal(empty.data.timer, null);
        await pool.query(`INSERT INTO my_day_time_entries (user_id, task_id, started_at, source)
            VALUES ($1, $2, NOW() - INTERVAL '5 minutes', 'timer')`, [owner, futureTask.id]);
        const active = await request('GET', '/api/my-day/timer', undefined, token);
        assert.equal(active.data.timer.taskId, futureTask.id);
        assert.equal((await request('POST', '/api/my-day/timer/stop', {}, token)).status, 200);
        assert.equal((await request('GET', '/api/my-day/timer', undefined, token)).data.timer, null);
    } finally {
        await pool.end();
    }
});
