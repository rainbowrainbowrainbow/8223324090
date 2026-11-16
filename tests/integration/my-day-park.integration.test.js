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

        const { rows: [assigned, farFuture, own, otherBusiness] } = await pool.query(`
            INSERT INTO tasks (title, date, status, visibility, task_mode, owner_user_id, created_by_user_id, business_context)
            VALUES ('Assigned to colleague', ($3::date - 1)::text, 'todo', 'team', 'work', $2, $1, 'event_genix'),
                   ('Assigned after this month', ($3::date + 90)::text, 'todo', 'team', 'work', $2, $1, 'event_genix'),
                   ('Assigned to self', ($3::date - 1)::text, 'todo', 'team', 'work', $1, $1, 'event_genix'),
                   ('Assigned in another business', ($3::date - 1)::text, 'todo', 'team', 'work', $2, $1, 'dar')
            RETURNING id, date, version`, [owner, peer.id, today]);
        const control = await request('GET', '/api/tasks/my-cabinet?bucket=control&limit=1', undefined, token);
        assert.equal(control.status, 200);
        assert.equal(control.data.meta.bucketPage.total, 2);
        assert.deepEqual(control.data.tasks.map(task => task.id), [assigned.id]);
        const nextControl = await request('GET', '/api/tasks/my-cabinet?bucket=control&offset=1&limit=1', undefined, token);
        assert.deepEqual(nextControl.data.tasks.map(task => task.id), [farFuture.id]);
        assert.ok(![own.id, otherBusiness.id].includes(nextControl.data.tasks[0].id));
        const ownBoard = await request('GET', '/api/tasks/my-cabinet?planningView=my-day', undefined, token);
        assert.equal(ownBoard.data.stats.controlCount, 2);
        const boardPage = await request('GET', '/api/tasks/my-cabinet?bucket=overdue&planningView=my-day', undefined, token);
        for (const tasks of [ownBoard.data.planning.overdue, boardPage.data.tasks]) {
            assert.ok(tasks.some(task => task.id === own.id));
            assert.ok(!tasks.some(task => task.id === assigned.id));
        }

        const reschedulePath = `/api/tasks/${own.id}/reschedule`;
        const moveBody = { deadline: `${today}T18:00:00`, sourceSurface: 'profile_my_cabinet_overdue_to_today_button' };
        const move = await request('POST', reschedulePath, moveBody, token);
        assert.equal(move.status, 200);
        const undoPath = `${reschedulePath}/undo`;
        const undoBody = { eventId: move.data.historyEvent.id };
        assert.equal((await request('POST', undoPath, undoBody, token)).status, 200);
        assert.equal((await request('POST', undoPath, undoBody, token)).status, 200);
        const { rows: [restored] } = await pool.query('SELECT date, deadline, postponement_count, priority FROM tasks WHERE id = $1', [own.id]);
        assert.equal(restored.date, own.date);
        assert.equal(restored.deadline, null);
        assert.equal(restored.postponement_count, 0);
        const secondMove = await request('POST', reschedulePath, moveBody, token);
        assert.equal(secondMove.status, 200);
        await pool.query('UPDATE tasks SET version = version + 1 WHERE id = $1', [own.id]);
        assert.equal((await request('POST', undoPath, { eventId: secondMove.data.historyEvent.id }, token)).status, 409);

        await pool.query(`
            INSERT INTO tasks (title, status, task_mode, visibility, owner_user_id, business_context, completed_at)
            VALUES ('Result work fixture', 'done', 'work', 'team', $1, 'event_genix', '2023-02-08 12:00:00'),
                   ('Result private fixture', 'done', 'private', 'private', $1, 'event_genix', '2023-02-08 12:00:00'),
                   ('Result personal fixture', 'done', 'personal', 'me_only', $1, 'event_genix', '2023-02-08 12:00:00')
        `, [owner]);
        const performance = await loadEmployeeResults(pool, { id: 0 }, owner, { activeContext: 'event_genix' },
            employeeMonthRange('2023-02'), { now: new Date('2023-03-01T08:00:00Z') });
        assert.equal(performance.current.tasks.completed, 1);

        const daily = await pool.query(`
            INSERT INTO tasks (title, date, status, task_mode, visibility, owner_user_id, business_context, completed_at)
            VALUES ('Daily work', '2023-02-27', 'done', 'work', 'team', $1, 'event_genix', '2023-03-01 22:05:00'),
                   ('Daily personal', NULL, 'done', 'personal', 'me_only', $1, 'event_genix', '2023-03-01 21:45:00'),
                   ('Daily private', NULL, 'done', 'private', 'private', $1, 'event_genix', '2023-03-02 10:00:00'),
                   ('Daily done by someone else', NULL, 'done', 'work', 'team', $1, 'event_genix', '2023-03-02 10:00:00'),
                   ('Daily foreign business', NULL, 'done', 'work', 'team', $1, 'dar', '2023-03-02 10:00:00'),
                   ('Daily peer private', NULL, 'done', 'private', 'private', $2, 'event_genix', '2023-03-02 10:00:00'),
                   ('Daily overdue and open', '2023-02-27', 'todo', 'work', 'team', $1, 'event_genix', NULL)
            RETURNING id, title
        `, [owner, peer.id]);
        const idFor = name => daily.rows.find(row => row.title === name).id;
        await pool.query(`INSERT INTO task_action_history (task_id, action_type, actor_user_id, created_at)
            VALUES ($1, 'task_completed', $2, '2023-03-01T22:05:00Z'),
                   ($1, 'task_completed', $2, '2023-03-01T22:05:00Z'),
                   ($3, 'task_completed', $4, '2023-03-02T10:00:00Z')`,
        [idFor('Daily work'), owner, idFor('Daily done by someone else'), peer.id]);
        const dailyResults = (await loadEmployeeResults(pool, { id: 0 }, owner, { activeContext: 'event_genix' },
            employeeMonthRange('2023-03'), { now: new Date('2023-03-02T12:00:00Z') })).dailyTasks;
        assert.equal(dailyResults.days.length, 7);
        assert.deepEqual(dailyResults.days.slice(-3), [
            { date: '2023-02-28', work: 0, personal: 0 },
            { date: '2023-03-01', work: 0, personal: 1 },
            { date: '2023-03-02', work: 1, personal: 1 }
        ]);
        assert.equal(dailyResults.overdue, 1);

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
