'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const { getToken, request } = require('../helpers');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { TASK_ACTION_TYPES } = require('../../services/taskActionConstants');

test('Dashboard and Tasks execute matching focus and preparation scopes against disposable PostgreSQL', {
    skip: process.env.RUN_DASHBOARD_POSTGRES_INTEGRATION !== 'true', timeout: 90000
}, async () => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    assert.equal(process.env.PGHOST, '127.0.0.1');
    assert.match(process.env.PGDATABASE, /disposable_test/);
    assert.ok(!process.env.DATABASE_URL, 'fixture uses only explicit local PG connection settings');
    const pool = new Pool({ max: 2 });
    const prefix = 'dashpg_' + crypto.randomBytes(5).toString('hex');
    const taskIds = [];
    const userIds = [];
    const bookingIds = [];
    let token;
    try {
        const creatorToken = await getToken();
        const createUser = async label => {
            const username = prefix + '_' + label;
            const password = crypto.randomBytes(24).toString('base64url');
            const created = await request('POST', '/api/users', {
                username, password, name: username, role: 'creator',
                businessContexts: ['event_genix', 'dar'], defaultBusinessContext: 'event_genix',
                actionAllowlist: [], actionDenylist: []
            }, creatorToken);
            assert.equal(created.status, 200, 'disposable actor creation must succeed');
            const id = Number(created.data?.user?.id);
            assert.ok(id > 0);
            userIds.push(id);
            const login = await request('POST', '/api/auth/login', { username, password });
            assert.equal(login.status, 200, 'disposable actor login must succeed');
            return { id, username, token: login.data.token };
        };
        const own = await createUser('own');
        const other = await createUser('other');
        token = own.token;
        const dates = (await pool.query(`SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date::text AS today,
            ((NOW() AT TIME ZONE 'Europe/Kyiv')::date - 1)::text AS yesterday,
            ((NOW() AT TIME ZONE 'Europe/Kyiv')::date + 1)::text AS tomorrow`)).rows[0];
        const task = async (label, patch = {}) => {
            const row = (await pool.query(`INSERT INTO tasks
                (title, status, priority, date, deadline, owner_user_id, assigned_to, created_by, created_by_user_id,
                 visibility, task_mode, business_context, focus_rank, source_type, source_id, snoozed_until, scheduled_start_at)
                VALUES ($1, $2, 'normal', $3, $4, $5, $6, $7, $8, $9, 'work', $10, $11, $12, $13, $14, $15)
                RETURNING id`, [prefix + ' ' + label, patch.status || 'todo', patch.date ?? null, patch.deadline ?? null,
                patch.ownerId === null ? null : (patch.ownerId ?? own.id), patch.assignedTo ?? own.username,
                own.username, own.id, patch.visibility || 'team', patch.context || 'event_genix', patch.rank || 0,
                patch.sourceType || 'manual', patch.sourceId || null, patch.snoozedUntil || null, patch.scheduledStart || null])).rows[0];
            taskIds.push(row.id);
            if (patch.accepted) await pool.query(`INSERT INTO task_action_history
                (task_id, action_type, actor_user_id, actor_name_snapshot, source_surface)
                VALUES ($1, $4, $2, $3, 'dashboard-postgres-test')`, [row.id, own.id, own.username, TASK_ACTION_TYPES.ACKNOWLEDGED]);
            return row.id;
        };
        const booking = async (label, status = 'confirmed', context = 'event_genix') => {
            const id = prefix + '_' + label;
            const roomId = prefix + '_room';
            await pool.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name)
                VALUES ($1, $2, 'cabinet', 'Disposable Dashboard room') ON CONFLICT DO NOTHING`, [context, roomId]);
            await pool.query(`INSERT INTO bookings (id, date, time, line_id, status, business_context, created_by, program_name, room, room_resource_id)
                VALUES ($1, $2, '12:00', 'fixture-line', $3, $4, $5, 'Disposable Dashboard event', 'Disposable Dashboard room', $6)`,
            [id, dates.tomorrow, status, context, own.username, roomId]);
            bookingIds.push(id);
            return id;
        };
        const selected = await task('selected private', { visibility: 'me_only', rank: 1 });
        const ordinary = await task('rank zero recommendation');
        const overdue = await task('own overdue', { date: dates.yesterday });
        const legacyOwn = await task('legacy own overdue', { ownerId: null, date: dates.yesterday });
        const hidden = await task('other private', { ownerId: other.id, visibility: 'me_only', rank: 1, date: dates.yesterday });
        const typedOther = await task('typed owner overrides legacy name', { ownerId: other.id, assignedTo: own.username, rank: 1 });
        const snoozed = await task('snoozed', { rank: 1, date: dates.yesterday, snoozedUntil: dates.tomorrow + 'T12:00:00Z' });
        const future = await task('future scheduled', { deadline: dates.yesterday + 'T12:00:00Z', scheduledStart: dates.tomorrow + 'T12:00:00Z' });
        const dar = await task('other business selected', { rank: 1, context: 'dar' });
        const get = async (path, context = 'event_genix') => {
            const response = await request('GET', path + (path.includes('?') ? '&' : '?') + 'businessContext=' + context, null, token);
            assert.equal(response.status, 200, 'actual HTTP query failed: ' + path);
            assert.equal(response.data?.success, true, 'actual API must return success: ' + path);
            return response.data;
        };
        let focus = (await get('/api/dashboard/widgets/my_focus')).data;
        assert.equal(focus.selectedCount, 1);
        assert.equal(focus.recommendedCount, 3);
        assert.equal(focus.actionableCount, 4);
        assert.equal(focus.overdueCount, 2);
        assert.deepEqual(focus.selectedTasks.map(row => row.id), [selected]);
        assert.equal(focus.recommendedTasks.find(row => row.id === ordinary)?.isSelectedFocus, false);
        for (const excluded of [hidden, typedOther, snoozed, future, dar]) assert.ok(!focus.tasks.some(row => row.id === excluded));
        const darFocus = (await get('/api/dashboard/widgets/my_focus', 'dar')).data;
        assert.deepEqual(darFocus.selectedTasks.map(row => row.id), [dar]);
        const personalList = await get('/api/tasks?pagination=1&view=board&dashboardFilter=my-overdue&include_duplicates=1');
        assert.equal(personalList.pagination.total, focus.overdueCount);
        assert.deepEqual(personalList.tasks.map(row => row.id).sort((a, b) => a - b), [overdue, legacyOwn].sort((a, b) => a - b));
        const activeBooking = await booking('active');
        const cancelledBooking = await booking('cancelled', 'cancelled');
        const otherBooking = await booking('dar', 'confirmed', 'dar');
        const prep = await task('accepted booking preparation', { sourceType: 'booking', sourceId: activeBooking, date: dates.yesterday, accepted: true });
        await task('cancelled booking preparation', { sourceType: 'booking', sourceId: cancelledBooking, date: dates.yesterday, accepted: true });
        await task('cross business booking preparation', { sourceType: 'booking', sourceId: otherBooking, date: dates.yesterday, accepted: true });
        await task('unaccepted booking machine task', { sourceType: 'booking', sourceId: activeBooking, date: dates.yesterday });
        const risks = (await get('/api/dashboard/widgets/event_risk_summary')).data;
        const prepCard = risks.cards.find(card => card.key === 'booking_linked_overdue_prep');
        assert.equal(prepCard?.count, 1);
        const prepList = await get('/api/tasks?pagination=1&view=board&source_type=booking&overdue=1&include_duplicates=1');
        assert.equal(prepList.pagination.total, prepCard.count);
        assert.deepEqual(prepList.tasks.map(row => row.id), [prep]);
        const complete = await request('PATCH', `/api/tasks/${selected}/status?businessContext=event_genix`, { status: 'done' }, token);
        assert.equal(complete.status, 200, 'canonical completion of disposable task succeeds');
        focus = (await get('/api/dashboard/widgets/my_focus')).data;
        assert.equal(focus.selectedCount, 0);
        assert.ok(!focus.tasks.some(row => row.id === selected));
        assert.equal((await pool.query('SELECT status FROM tasks WHERE id=$1', [selected])).rows[0].status, 'done');
    } finally {
        // Exact fixture IDs only; the canonical runner also resets this newly created disposable database.
        if (taskIds.length) await pool.query('DELETE FROM tasks WHERE id = ANY($1::int[])', [taskIds]).catch(() => {});
        if (bookingIds.length) await pool.query('DELETE FROM bookings WHERE id = ANY($1::text[])', [bookingIds]).catch(() => {});
        await pool.query('DELETE FROM timeline_resources WHERE resource_id = $1', [prefix + '_room']).catch(() => {});
        if (userIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]).catch(() => {});
        await pool.end();
    }
});
