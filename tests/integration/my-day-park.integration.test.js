'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Pool } = require('pg');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadEmployeeResults, employeeMonthRange } = require('../../services/profileEmployeeMonths');
const { request, getToken } = require('../helpers');
const { ROLE_PERMISSIONS } = require('../../config/roles');
const { listControlCompletions } = require('../../services/taskControlCompletionInbox');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { inventory } = require('../../scripts/my-day-legacy-task-inventory');
const { cancelledBookingAutoArchivePredicateSql } = require('../../services/taskLifecycle');
const { buildMachineTaskControlMetaPatch, MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING } = require('../../services/taskAutomationPolicy');

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
        async function testActor(label, business = 'event_genix', role = 'director') {
            const username = `park_${label}_${randomBytes(4).toString('hex')}`;
            const password = `Local-${randomBytes(12).toString('hex')}-Aa9`;
            const created = await request('POST', '/api/users', {
                username, password, name: `Local park ${label}`, role,
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

        const complete = await request('POST', `/api/tasks/${assigned.id}/complete`, {}, peer.token);
        assert.equal(complete.status, 200);
        const activeControl = await request('GET', '/api/tasks/my-cabinet?bucket=control', undefined, token);
        assert.deepEqual(activeControl.data.tasks.map(task => task.id), [farFuture.id]);

        await pool.query(`UPDATE tasks SET status = 'done', completed_at = NOW() AT TIME ZONE 'UTC' - INTERVAL '1 day'
            WHERE id = ANY($1::int[])`, [[own.id, otherBusiness.id]]);
        const archived = await pool.query(`INSERT INTO tasks
            (title, status, visibility, task_mode, owner_user_id, created_by_user_id, business_context, completed_at)
            VALUES ('Archived delegated fixture', 'archived', 'team', 'work', $2, $1, 'event_genix', NOW() AT TIME ZONE 'UTC'),
                   ('Private delegated fixture', 'done', 'me_only', 'work', $2, $1, 'event_genix', NOW() AT TIME ZONE 'UTC'),
                   ('Older completed fixture', 'done', 'team', 'work', $2, $1, 'event_genix', '2023-01-01 00:00:00')
            RETURNING id`, [owner, peer.id]);
        const older = archived.rows[2].id;
        // Simulate a completed task that predates installation of the inbox trigger.
        await pool.query('DELETE FROM task_control_completion_inbox WHERE task_id = $1', [older]);
        for (const [offset, expectedId] of [[0, assigned.id], [1, older]]) {
            const completed = await request('GET', `/api/tasks/my-cabinet?bucket=controlCompleted&offset=${offset}&limit=1`, undefined, token);
            assert.equal(completed.status, 200);
            assert.equal(completed.data.meta.bucketPage.total, 2);
            assert.deepEqual(completed.data.tasks.map(task => task.id), [expectedId]);
            assert.ok(completed.data.tasks[0].completedAt);
        }

        const authorAlerts = await request('GET', '/api/dashboard/alerts', undefined, token);
        assert.equal(authorAlerts.status, 200);
        const info = authorAlerts.data.alerts.filter(alert => alert.type === 'control_completion');
        assert.equal(info.length, 2);
        assert.equal(authorAlerts.data.controlCompletions.unread, 2);
        assert.equal(info[0].level, 'info');
        assert.equal(info[0].action, undefined);
        assert.equal(info[0].link, `/tasks?view=my&open=${assigned.id}&businessContext=event_genix`);
        for (const role of Object.keys(ROLE_PERMISSIONS).filter(role => role !== 'guest')) {
            const actor = { id: owner, username: profile.data.user.username, role };
            const inbox = await listControlCompletions(pool, actor, 'event_genix');
            assert.equal(inbox.unread, 2, `Missing completions for ${role}`);
        }
        for (const actor of [{ id: owner, role: 'guest' }, { id: owner, is_active: false }]) {
            assert.equal((await listControlCompletions(pool, actor, 'event_genix')).unread, 0);
        }
        for (const actor of [peer, observer, foreign]) {
            const alerts = await request('GET', '/api/dashboard/alerts', undefined, actor.token);
            assert.equal(alerts.status, 200);
            assert.ok(!alerts.data.alerts.some(alert => alert.type === 'control_completion'));
        }

        // Reverse the author/executor pair and cover legacy author/owner names.
        const peerProfile = await request('GET', '/api/auth/profile', undefined, peer.token);
        const legacy = await pool.query(`INSERT INTO tasks
            (title, status, visibility, task_mode, assigned_to, created_by, business_context, completed_at)
            VALUES ('Legacy delegated completion', 'done', 'team', 'work', $1, $2, 'event_genix', NOW() AT TIME ZONE 'UTC')
            RETURNING id`, [profile.data.user.username, peerProfile.data.user.username]);
        const peerCompleted = await request('GET', '/api/tasks/my-cabinet?bucket=controlCompleted', undefined, peer.token);
        assert.deepEqual(peerCompleted.data.tasks.map(task => task.id), [legacy.rows[0].id]);
        const reverseAlerts = await request('GET', '/api/dashboard/alerts', undefined, peer.token);
        assert.equal(reverseAlerts.data.alerts.filter(alert => alert.type === 'control_completion').length, 1);

        // Reopening returns the task to active while retaining the prior completion event.
        const reopen = await request('PATCH', `/api/tasks/${assigned.id}/status`, { status: 'todo' }, peer.token);
        assert.equal(reopen.status, 200);
        const reopenedAlerts = await request('GET', '/api/dashboard/alerts', undefined, token);
        assert.ok(reopenedAlerts.data.alerts.some(alert => alert.id === info[0].id));
        const allowedInbox = '/api/tasks/control-completions';
        const deniedRead = await request('POST', `${allowedInbox}/read`, { eventKey: info[0].eventKey }, observer.token);
        assert.equal(deniedRead.status, 200);
        assert.equal((await request('GET', allowedInbox, undefined, token)).data.unread, 2);
        for (let retry = 0; retry < 2; retry++) {
            assert.equal((await request('POST', `${allowedInbox}/read`, { eventKey: info[0].eventKey }, token)).status, 200);
        }
        assert.equal((await request('GET', allowedInbox, undefined, token)).data.unread, 1);
        const concurrent = await Promise.all([1, 2].map(() => request('POST', `/api/tasks/${assigned.id}/complete`, {}, peer.token)));
        assert.deepEqual(concurrent.map(res => res.status).sort(), [200, 409]);
        const recompletedAlerts = await request('GET', '/api/dashboard/alerts', undefined, token);
        const renewed = recompletedAlerts.data.alerts.find(alert => alert.type === 'control_completion');
        assert.ok(renewed);
        assert.equal(recompletedAlerts.data.alerts.filter(alert => alert.type === 'control_completion').length, 3);
        assert.notEqual(renewed.id, info[0].id);
        assert.equal((await request('POST', `/api/tasks/${assigned.id}/complete`, {}, peer.token)).status, 409);

        for (const role of ['manager', 'instructor', 'animator']) {
            const roleActor = await testActor(role, 'event_genix', role);
            const { rows: [roleTask] } = await pool.query(`INSERT INTO tasks
                (title, status, visibility, task_mode, owner_user_id, created_by_user_id, business_context, completed_at)
                VALUES ($1, 'done', 'team', 'work', $2, $3, 'event_genix', NOW() AT TIME ZONE 'UTC') RETURNING id`,
                [`Delegated completion by ${role}`, peer.id, roleActor.id]);
            const card = await request('GET', `/api/tasks/${roleTask.id}`, undefined, roleActor.token);
            assert.equal(card.status, 200);
            assert.equal(card.data.drawer.actions.edit, false);
            assert.equal(card.data.drawer.actions.reschedule, false);
            const forbidden = await request('POST', `/api/tasks/${roleTask.id}/complete`, {}, roleActor.token);
            assert.ok([403, 404].includes(forbidden.status));
            const visible = await request('GET', '/api/tasks/my-cabinet?bucket=controlCompleted', undefined, roleActor.token);
            assert.equal(visible.status, 200);
            assert.deepEqual(visible.data.tasks.map(task => task.id), [roleTask.id]);
            const roleAlerts = await request('GET', '/api/dashboard/alerts', undefined, roleActor.token);
            assert.equal(roleAlerts.status, 200);
            assert.equal(roleAlerts.data.alerts.filter(alert => alert.type === 'control_completion').length, 1);
        }

        await pool.query(`INSERT INTO tasks (title, status, visibility, task_mode, owner_user_id,
            created_by_user_id, business_context, completed_at)
            SELECT 'Paged completion ' || n, 'done', 'team', 'work', $1, $2, 'event_genix',
                '2020-01-01'::timestamp + n * INTERVAL '1 day' FROM generate_series(1, 30) n`, [peer.id, observer.id]);
        const first = await request('GET', allowedInbox, undefined, observer.token);
        assert.equal(first.data.unread, 30);
        assert.equal(first.data.alerts.length, 25);
        const second = await request('GET', `${allowedInbox}?cursor=${encodeURIComponent(first.data.nextCursor)}`, undefined, observer.token);
        assert.equal(second.data.alerts.length, 5);
        assert.equal(second.data.nextCursor, null);
        assert.equal(new Set([...first.data.alerts, ...second.data.alerts].map(alert => alert.id)).size, 30);
        assert.equal((await request('POST', `${allowedInbox}/read`, { all: true }, observer.token)).status, 200);
        assert.equal((await request('GET', allowedInbox, undefined, observer.token)).data.unread, 0);

        const { rows: [historical] } = await pool.query(`WITH fixtures AS (
            INSERT INTO tasks (title, status, visibility, task_mode, owner_user_id, created_by_user_id,
                               business_context, completed_at)
            VALUES ('Historical reopened task', 'todo', 'team', 'work', $1, $2, 'event_genix', NULL),
                   ('Historical closed task', 'done', 'team', 'work', $1, $2, 'event_genix', '2023-02-01'),
                   ('Historical self completion', 'done', 'team', 'work', $1, $2, 'event_genix', '2023-02-01'),
                   ('Historical private task', 'todo', 'private', 'work', $1, $2, 'event_genix', NULL)
            RETURNING id, title
        ) SELECT jsonb_object_agg(title, id) AS tasks FROM fixtures`, [peer.id, observer.id]);
        const reopenedId = historical.tasks['Historical reopened task'];
        const closedId = historical.tasks['Historical closed task'];
        const selfId = historical.tasks['Historical self completion'];
        const privateId = historical.tasks['Historical private task'];
        await pool.query('DELETE FROM task_control_completion_inbox WHERE task_id = ANY($1::int[])', [[closedId, selfId]]);
        await pool.query(`INSERT INTO task_action_history (task_id, action_type, new_value_json, created_at)
            SELECT task_id, 'task_completed', jsonb_build_object('status', 'done', 'ownerUserId', owner_id), happened_at
            FROM (VALUES ($1::int, $5::int, '2023-01-01 00:00:00+00'::timestamptz),
                         ($1, $5, '2023-02-01 00:00:00+00'), ($2::int, $5, '2023-02-01 00:00:00+00'),
                         ($3::int, $6::int, '2023-02-01 00:00:00+00'), ($4::int, $5, '2023-02-01 00:00:00+00'))
                         AS events(task_id, owner_id, happened_at)`,
        [reopenedId, closedId, selfId, privateId, peer.id, observer.id]);
        const beforeRead = await request('GET', allowedInbox, undefined, observer.token);
        assert.equal(beforeRead.status, 200);
        assert.equal(beforeRead.data.unread, 3);
        assert.deepEqual(beforeRead.data.alerts.filter(alert => !alert.read)
            .map(alert => Number(alert.eventKey.split(':')[0])).sort((a, b) => a - b), [reopenedId, reopenedId, closedId]);
        const historicalAlert = beforeRead.data.alerts.find(alert => alert.eventKey.startsWith(`${reopenedId}:`));
        assert.ok(historicalAlert);
        assert.equal((await request('POST', `${allowedInbox}/read`, { eventKey: historicalAlert.eventKey }, observer.token)).status, 200);
        const afterRead = await request('GET', allowedInbox, undefined, observer.token);
        assert.equal(afterRead.data.unread, 2);
        assert.deepEqual(afterRead.data.alerts.filter(alert => alert.id === historicalAlert.id), [{ ...historicalAlert, read: true }]);

        // Keep the existing reschedule fixture open for the rest of the scenario.
        await pool.query("UPDATE tasks SET status = 'todo', completed_at = NULL WHERE id = $1", [own.id]);

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

test('legacy flags cannot require a report; historical rows and references remain intact', {
    skip: process.env.RUN_MY_DAY_PARK_INTEGRATION !== 'true'
}, async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const token = await getToken();
    const created = await request('POST', '/api/tasks', {
        title: 'Legacy report fixture ' + randomBytes(4).toString('hex'), reportRequired: true,
        controlMeta: { reportRequired: true, requires_report: true }
    }, token);
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const { id } = created.data.task;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    const legacyFlag = async () => (await pool.query('SELECT control_meta FROM tasks WHERE id = $1', [id])).rows[0].control_meta;
    try {
        assert.equal((await legacyFlag()).reportRequired, undefined);
        assert.equal((await legacyFlag()).requires_report, undefined);
        await pool.query(`UPDATE tasks SET task_kind = 'checklist',
            control_meta = control_meta || '{"reportRequired":true}'::jsonb WHERE id = $1`, [id]);
        await pool.query("INSERT INTO task_subtasks (task_id, title, is_done) VALUES ($1, 'Unfinished historical step', false)", [id]);
        const edited = await request('PUT', `/api/tasks/${id}`, {
            title: 'Edited legacy report fixture ' + id, requires_report: true,
            controlMeta: { reportRequired: false, requiresReport: true }
        }, token);
        assert.equal(edited.status, 200, JSON.stringify(edited.data));
        assert.equal((await legacyFlag()).reportRequired, true);
        assert.equal((await legacyFlag()).requiresReport, undefined);
        const { rows: [typeOnly, linkedSystem] } = await pool.query(`
            INSERT INTO tasks (title, status, business_context, task_kind, source_type, source_id)
            VALUES ('Type-only legacy fixture', 'todo', 'event_genix', 'checklist', 'manual', NULL),
                   ('Linked system fixture', 'todo', 'event_genix', 'action', 'automation', 'QA-rule')
            RETURNING id`);
        await pool.query('UPDATE tasks SET duplicate_of_task_id = $1 WHERE id = $2', [id, linkedSystem.id]);
        const completed = await request('POST', `/api/tasks/${id}/complete`, { controlMeta: { reportRequired: true } }, token);
        assert.equal(completed.status, 200, JSON.stringify(completed.data));
        assert.equal(completed.data.task.status, 'done');
        const compatibility = await request('GET', `/api/tasks/${id}/subtasks`, undefined, token);
        assert.equal(compatibility.status, 410);
        assert.equal((await pool.query('SELECT is_done FROM task_subtasks WHERE task_id = $1', [id])).rows[0].is_done, false);
        const report = await inventory(pool);
        const record = taskId => report.tasks.find(task => task.id === Number(taskId));
        assert.equal(report.readOnly, true);
        assert.deepEqual(record(id).cohorts, ['hasSubtasks']);
        assert.ok(record(id).references.some(ref => ref.table === 'task_subtasks' && ref.action === 'cascade'));
        assert.ok(record(id).references.some(ref => ref.table === 'tasks' && ref.column === 'duplicate_of_task_id' && ref.action === 'set_null'));
        assert.equal(record(typeOnly.id).disposition, 'review-type-only');
        assert.deepEqual(record(linkedSystem.id).cohorts, ['linkedSystem']);
        assert.equal(record(linkedSystem.id).disposition, 'protect');
        const directory = path.join(__dirname, '../../output/qa');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'legacy-task-inventory-isolated.json'), JSON.stringify(report, null, 2) + '\n');
    } finally {
        await pool.end();
    }
});

test('automatic archive eligibility preserves historical checklist work', {
    skip: process.env.RUN_MY_DAY_PARK_INTEGRATION !== 'true'
}, async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    try {
        const marker = buildMachineTaskControlMetaPatch('booking', {
            lifecycleAutoArchivePolicy: MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING
        });
        const { rows: [unprotected, historical] } = await pool.query(`
            INSERT INTO tasks (title, date, type, status, created_by, source_type, source_id, control_meta)
            VALUES ('Machine cleanup fixture', '2024-01-01', 'auto', 'todo', 'rule_engine', 'booking', 'qa-booking', $1),
                   ('Machine history fixture', '2024-01-01', 'auto', 'todo', 'rule_engine', 'booking', 'qa-booking', $1)
            RETURNING id
        `, [marker]);
        await pool.query("INSERT INTO task_subtasks (task_id, title, is_done) VALUES ($1, 'Historical work', false)", [historical.id]);
        const { rows } = await pool.query(`
            SELECT t.id, ${cancelledBookingAutoArchivePredicateSql('t', 'b', '$1')} AS eligible
            FROM tasks t CROSS JOIN (SELECT 'qa-booking' AS id, 'cancelled' AS status) b
            WHERE t.id = ANY($2::int[]) ORDER BY t.id
        `, ['2024-01-15', [unprotected.id, historical.id]]);
        assert.deepEqual(rows, [{ id: unprotected.id, eligible: true }, { id: historical.id, eligible: false }]);
    } finally {
        await pool.end();
    }
});
