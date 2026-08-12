'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, it } = require('node:test');
const { Pool } = require('pg');
const { getToken, request } = require('../helpers');
const { buildMyDayContribution } = require('../../services/myDayContribution');
const { applyMyDayStarterKit } = require('../../services/myDayStarterKit');

const enabled = process.env.RUN_MY_DAY_POSTGRES_INTEGRATION === 'true';
let pool = null;
let suffix = '';
let creatorToken = '';
let openAiMock = null;

function createPool() {
    const databaseUrl = String(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '');
    return new Pool(databaseUrl
        ? {
            connectionString: databaseUrl,
            ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
        }
        : {});
}

async function query(sql, params = []) {
    return pool.query(sql, params);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function jsonResponse(payload, status = 200) {
    return { status, payload };
}

async function readRequestJson(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
}

function createOpenAIMockServer(port) {
    const queue = [];
    const calls = [];
    const server = http.createServer(async (req, res) => {
        try {
            if (req.method !== 'POST' || req.url !== '/v1/responses') {
                res.writeHead(404, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'not_found' }));
                return;
            }
            const body = await readRequestJson(req);
            calls.push(body);
            const handler = queue.shift() || (() => jsonResponse({
                output_text: JSON.stringify({ impactIds: [], confidence: 0.1, reason: 'no clear match' })
            }));
            const result = await handler(body);
            res.writeHead(result.status || 200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(result.payload || {}));
        } catch (error) {
            if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
    return {
        calls,
        enqueue(handler) {
            queue.push(handler);
        },
        start() {
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, '127.0.0.1', resolve);
            });
        },
        close() {
            return new Promise(resolve => server.close(resolve));
        }
    };
}

async function createUser(label, role = 'instructor') {
    const safeLabel = String(label || 'user').replace(/[^a-z0-9._-]/gi, '_').slice(0, 16);
    const username = `md_${safeLabel}_${crypto.randomBytes(4).toString('hex')}`;
    const password = `Safe-${crypto.randomBytes(16).toString('base64url')}`;
    const response = await request('POST', '/api/users', {
        username,
        password,
        name: `My Day PG ${label} ${suffix}`,
        role,
        actionAllowlist: [],
        actionDenylist: [],
        businessContexts: ['event_genix'],
        defaultBusinessContext: 'event_genix'
    }, creatorToken);
    assert.equal(response.status, 200, `create user ${label}: ${JSON.stringify(response.data)}`);
    const login = await request('POST', '/api/auth/login', { username, password });
    assert.equal(login.status, 200, `login user ${label}: ${JSON.stringify(login.data)}`);
    assert.ok(login.data?.token, 'created My Day test user must be login-ready');
    return {
        id: Number(response.data?.user?.id),
        username,
        password,
        role,
        token: login.data.token
    };
}

async function createTask(user, title, options = {}) {
    const businessContext = options.businessContext || 'event_genix';
    const result = await query(
        `INSERT INTO tasks (title, description, status, priority, deadline, owner_user_id, business_context, created_by, visibility)
         VALUES ($1, $2, COALESCE($3, 'todo'), COALESCE($4, 'normal'), $5, $6, $7, $8, COALESCE($9, 'me_only'))
         RETURNING id`,
        [
            `${title} ${suffix}`,
            options.description || '',
            options.status || 'todo',
            options.priority || 'normal',
            options.deadline || null,
            user.id,
            businessContext,
            user.username,
            options.visibility || 'me_only'
        ]
    );
    return Number(result.rows[0].id);
}

async function createImpact(userId, name, options = {}) {
    const result = await query(
        `INSERT INTO my_day_impacts (user_id, name, color, icon, is_active)
         VALUES ($1, $2, COALESCE($3, '#0EA5E9'), COALESCE($4, '•'), COALESCE($5, true))
         RETURNING id`,
        [userId, `${name} ${suffix}`, options.color || '#0EA5E9', options.icon || '•', options.isActive !== false]
    );
    return Number(result.rows[0].id);
}

async function createLegacyDirection(userId, name = 'Legacy direction') {
    const result = await query(
        `INSERT INTO my_day_directions (user_id, name, color, icon, is_active)
         VALUES ($1, $2, '#6366F1', 'D', true)
         RETURNING id`,
        [userId, `${name} ${suffix}`]
    );
    return Number(result.rows[0].id);
}

async function setTaskMetadata(userId, taskId, patch = {}) {
    await query(
        `INSERT INTO my_day_task_metadata (user_id, task_id, direction_id, tags)
         VALUES ($1, $2, $3, COALESCE($4::text[], '{}'::text[]))
         ON CONFLICT (user_id, task_id)
         DO UPDATE SET direction_id = COALESCE(EXCLUDED.direction_id, my_day_task_metadata.direction_id),
                       tags = COALESCE(EXCLUDED.tags, my_day_task_metadata.tags),
                       updated_at = NOW()`,
        [userId, taskId, patch.directionId || null, patch.tags || []]
    );
}

async function setTaskImpacts(userId, taskId, impactIds) {
    await query('DELETE FROM my_day_task_impacts WHERE user_id = $1 AND task_id = $2', [userId, taskId]);
    if (impactIds.length) {
        await query(
            `INSERT INTO my_day_task_impacts (user_id, task_id, impact_id)
             SELECT $1, $2, unnest($3::bigint[])`,
            [userId, taskId, impactIds]
        );
    }
}

async function readImpactIds(userId, taskId) {
    const result = await query(
        `SELECT impact_id::int AS id
         FROM my_day_task_impacts
         WHERE user_id = $1 AND task_id = $2
         ORDER BY impact_id`,
        [userId, taskId]
    );
    return result.rows.map(row => row.id);
}

async function readMetadata(userId, taskId) {
    const result = await query(
        `SELECT direction_id::int AS direction_id, tags
         FROM my_day_task_metadata
         WHERE user_id = $1 AND task_id = $2`,
        [userId, taskId]
    );
    return result.rows[0] || null;
}

async function putClassification(token, taskId, body) {
    return request('PUT', `/api/my-day/tasks/${taskId}/classification`, body, token);
}

async function postAuto(token, taskId) {
    return request('POST', `/api/my-day/tasks/${taskId}/classification/auto`, {}, token);
}

async function postUndo(token, taskId, undoToken) {
    return request('POST', `/api/my-day/tasks/${taskId}/classification/undo`, { undoToken }, token);
}

async function getTimer(token) {
    return request('GET', '/api/my-day/timer', undefined, token);
}

async function postTimerStop(token) {
    return request('POST', '/api/my-day/timer/stop', {}, token);
}

async function postAiDraftPreview(token, body) {
    return request('POST', '/api/tasks/ai-draft/preview', body, token);
}

async function postAiDraftCommit(token, body) {
    return request('POST', '/api/tasks/ai-draft/commit', body, token);
}

async function postAiDraftBundleCommit(token, body) {
    return request('POST', '/api/tasks/ai-draft/bundle/commit', body, token);
}

async function getAiDraftBundle(token, bundleId) {
    return request('GET', `/api/tasks/ai-draft/bundles/${encodeURIComponent(bundleId)}`, undefined, token);
}

function openAiOutput(impactIds, confidence = 0.9, reason = 'matched') {
    return jsonResponse({
        output_text: JSON.stringify({ impactIds, confidence, reason })
    });
}

function openAiDraftOutput(proposal) {
    return jsonResponse({
        output_text: JSON.stringify(proposal),
        usage: { input_tokens: 80, output_tokens: 120, total_tokens: 200 }
    });
}

function validDraftProposal(impactIds, overrides = {}) {
    return {
        decision: 'checklist',
        mode: 'checklist',
        title: `AI draft commit task ${suffix}`,
        description: 'AI prepared checklist draft.',
        impactIds,
        subtasks: [
            { title: 'Review CRM draft' },
            { title: 'Check Hermes notification' },
            { title: 'Verify AI composer create' }
        ],
        confidence: {
            overall: 0.91,
            title: 0.9,
            description: 0.88,
            impacts: 0.92,
            subtasks: 0.86,
            mode: 0.84
        },
        bundleTitle: null,
        tasks: [],
        reason: 'Clear AI draft commit fixture.',
        ...overrides
    };
}

function validBundleProposal(impactIds, overrides = {}) {
    const [firstImpact, secondImpact, thirdImpact] = impactIds;
    return {
        decision: 'task_bundle',
        mode: null,
        title: null,
        description: null,
        impactIds: [],
        subtasks: [],
        bundleTitle: `AI bundle commit plan ${suffix}`,
        tasks: [
            {
                title: `AI bundle CRM audit ${suffix}`,
                description: 'Audit CRM flow without creating dependencies.',
                impactIds: [firstImpact],
                priority: 'high',
                scheduleDate: '2099-02-01',
                ownerSuggestion: { userId: null, name: null, reason: 'Review-only owner suggestion.' },
                confidence: {
                    overall: 0.91,
                    title: 0.9,
                    description: 0.88,
                    impacts: 0.9,
                    subtasks: 0.8,
                    mode: 0.84
                }
            },
            {
                title: `AI bundle Hermes worker ${suffix}`,
                description: 'Prepare Hermes worker safely.',
                impactIds: [secondImpact],
                priority: 'normal',
                scheduleDate: null,
                ownerSuggestion: { userId: null, name: null, reason: 'Review-only owner suggestion.' },
                confidence: {
                    overall: 0.89,
                    title: 0.9,
                    description: 0.86,
                    impacts: 0.88,
                    subtasks: 0.8,
                    mode: 0.82
                }
            },
            {
                title: `AI bundle automation QA ${suffix}`,
                description: 'Verify automation and AI outcome.',
                impactIds: [thirdImpact],
                priority: 'normal',
                scheduleDate: null,
                ownerSuggestion: { userId: null, name: null, reason: 'Review-only owner suggestion.' },
                confidence: {
                    overall: 0.9,
                    title: 0.9,
                    description: 0.87,
                    impacts: 0.89,
                    subtasks: 0.8,
                    mode: 0.83
                }
            }
        ],
        confidence: {
            overall: 0.9,
            title: 0.88,
            description: 0.85,
            impacts: 0.9,
            subtasks: 0.8,
            mode: 0.8
        },
        reason: 'Clear multi-task bundle.',
        ...overrides
    };
}

describe('My Day disposable PostgreSQL backend contracts', { skip: !enabled }, () => {
    before(async () => {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true', 'My Day PostgreSQL tests require isolated disposable target');
        assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true', 'My Day PostgreSQL tests require verified disposable database');
        assert.equal(String(process.env.OPENAI_API_BASE_URL || '').startsWith('http://127.0.0.1:'), true, 'My Day tests must use local OpenAI mock');
        assert.equal(process.env.OPENAI_API_KEY, 'isolated-my-day-openai-mock-key', 'My Day tests must not use a real OpenAI key');
        pool = createPool();
        suffix = `${process.pid}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        creatorToken = await getToken();
        openAiMock = createOpenAIMockServer(Number(process.env.MY_DAY_OPENAI_MOCK_PORT));
        await openAiMock.start();
    });

    after(async () => {
        await openAiMock?.close().catch(() => {});
        if (pool && suffix) {
            await query(`DELETE FROM my_day_time_entries WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE $1)`, [`%${suffix}%`]).catch(() => {});
            await query(`DELETE FROM my_day_task_impacts WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE $1)`, [`%${suffix}%`]).catch(() => {});
            await query(`DELETE FROM my_day_task_metadata WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE $1)`, [`%${suffix}%`]).catch(() => {});
            await query('DELETE FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE $1) OR depends_on_task_id IN (SELECT id FROM tasks WHERE title LIKE $1)', [`%${suffix}%`]).catch(() => {});
            await query('DELETE FROM tasks WHERE title LIKE $1', [`%${suffix}%`]).catch(() => {});
            await query('DELETE FROM my_day_impacts WHERE name LIKE $1', [`%${suffix}%`]).catch(() => {});
            await query('DELETE FROM my_day_directions WHERE name LIKE $1', [`%${suffix}%`]).catch(() => {});
            await query('DELETE FROM users WHERE username LIKE $1', [`my_day_pg_%_${suffix}`]).catch(() => {});
        }
        await pool?.end();
    });

    it('keeps migration 320 additive with tags column and tag_values constraint intact', async () => {
        const column = await query(
            `SELECT data_type, udt_name, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'my_day_task_metadata'
               AND column_name = 'tags'`
        );
        assert.equal(column.rows.length, 1);
        assert.equal(column.rows[0].data_type, 'ARRAY');
        assert.equal(column.rows[0].udt_name, '_text');
        assert.equal(column.rows[0].is_nullable, 'NO');
        assert.match(String(column.rows[0].column_default), /'\{\}'::text\[\]/);

        const constraint = await query(
            `SELECT pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
             WHERE conname = 'chk_my_day_task_metadata_tags'
               AND conrelid = 'my_day_task_metadata'::regclass`
        );
        assert.equal(constraint.rows.length, 1);
        assert.match(constraint.rows[0].definition, /my_day_valid_task_tags\(tags\)/);

        const migration = await query(
            `SELECT COUNT(*)::int AS count
             FROM schema_migrations
             WHERE version = '320_my_day_task_metadata_tags'`
        );
        assert.equal(migration.rows[0].count, 1);
    });

    it('counts task minutes once globally while overlapping impact facets show full minutes', async () => {
        const user = await createUser('contribution');
        const taskId = await createTask(user, 'contribution task');
        const impacts = [];
        for (const name of ['Work Park', 'Work CRM', 'Work Hermes']) {
            impacts.push(await createImpact(user.id, name));
        }
        await setTaskImpacts(user.id, taskId, impacts);
        await query(
            `INSERT INTO my_day_time_entries (user_id, task_id, started_at, ended_at, source)
             VALUES ($1, $2, '2026-08-01 09:00:00+03'::timestamptz, '2026-08-01 10:00:00+03'::timestamptz, 'manual')`,
            [user.id, taskId]
        );

        const result = await buildMyDayContribution({
            queryable: pool,
            user,
            businessScope: { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] },
            query: { from: '2026-08-01', to: '2026-08-01' }
        });

        assert.equal(result.totals.taskMinutes, 60);
        assert.equal(result.days[0].taskMinutes, 60);
        assert.equal(result.impacts.length, 3);
        assert.deepEqual(result.impacts.map(row => row.taskMinutes).sort((a, b) => a - b), [60, 60, 60]);
    });

    it('sanitizes global active timer after business access is revoked while preserving own stop', async () => {
        const owner = await createUser('timer_revoke', 'director');
        await query(
            `UPDATE users
             SET business_contexts = ARRAY['event_genix', 'dar']::text[],
                 default_business_context = 'event_genix'
             WHERE id = $1`,
            [owner.id]
        );
        const refreshedLogin = await request('POST', '/api/auth/login', { username: owner.username, password: owner.password });
        assert.equal(refreshedLogin.status, 200, JSON.stringify(refreshedLogin.data));
        const token = refreshedLogin.data.token;
        const taskId = await createTask(owner, 'timer secret dar task', { businessContext: 'dar' });
        await query(
            `INSERT INTO my_day_time_entries (user_id, task_id, started_at, source)
             VALUES ($1, $2, NOW() - INTERVAL '9 minutes', 'timer')`,
            [owner.id, taskId]
        );

        const visible = await getTimer(token);
        assert.equal(visible.status, 200, JSON.stringify(visible.data));
        assert.equal(visible.data?.timer?.taskId, taskId);
        assert.equal(visible.data?.timer?.task?.title, `timer secret dar task ${suffix}`);
        assert.equal(visible.data?.timer?.businessContext, 'dar');
        assert.equal(Object.hasOwn(visible.data?.timer || {}, 'userId'), false);

        await query(
            `UPDATE users
             SET business_contexts = ARRAY['event_genix']::text[],
                 default_business_context = 'event_genix'
             WHERE id = $1`,
            [owner.id]
        );

        const hidden = await getTimer(token);
        assert.equal(hidden.status, 200, JSON.stringify(hidden.data));
        assert.deepEqual(Object.keys(hidden.data?.timer || {}).sort(), ['durationSeconds', 'isActive', 'startedAt', 'task', 'taskUnavailable', 'warning']);
        assert.equal(hidden.data.timer.taskUnavailable, true);
        assert.equal(hidden.data.timer.task, null);
        assert.equal(JSON.stringify(hidden.data).includes(`timer secret dar task ${suffix}`), false);
        assert.equal(Object.hasOwn(hidden.data.timer, 'taskId'), false);
        assert.equal(Object.hasOwn(hidden.data.timer, 'businessContext'), false);
        assert.equal(JSON.stringify(hidden.data).includes('"businessContext"'), false);
        assert.equal(JSON.stringify(hidden.data).includes('userId'), false);

        const stopped = await postTimerStop(token);
        assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
        assert.equal(stopped.data?.timer?.taskUnavailable, true);
        assert.equal(stopped.data?.timer?.task, null);
        assert.equal(JSON.stringify(stopped.data).includes(`timer secret dar task ${suffix}`), false);
        assert.equal(Object.hasOwn(stopped.data.timer, 'taskId'), false);
        assert.equal(Object.hasOwn(stopped.data.timer, 'businessContext'), false);
        assert.equal(JSON.stringify(stopped.data).includes('"businessContext"'), false);

        const active = await query(
            `SELECT COUNT(*)::int AS count
             FROM my_day_time_entries
             WHERE user_id = $1 AND ended_at IS NULL`,
            [owner.id]
        );
        assert.equal(active.rows[0].count, 0);

        const other = await createUser('timer_other', 'director');
        await query(
            `UPDATE users
             SET business_contexts = ARRAY['event_genix', 'dar']::text[],
                 default_business_context = 'event_genix'
             WHERE id = $1`,
            [other.id]
        );
        const otherLogin = await request('POST', '/api/auth/login', { username: other.username, password: other.password });
        assert.equal(otherLogin.status, 200, JSON.stringify(otherLogin.data));
        const otherTimer = await getTimer(otherLogin.data.token);
        assert.equal(otherTimer.status, 200, JSON.stringify(otherTimer.data));
        assert.equal(otherTimer.data?.timer, null);
    });

    it('normalizes the 24-impact catalog and merges health aliases without losing task or habit links', async () => {
        const owner = await createUser('starter_alias');
        const legacy = await query(
            `INSERT INTO my_day_impacts (user_id, name, color, icon, sort_order, is_active)
             VALUES ($1, 'Команда і делегування', '#123456', '🤝', 777, true)
             RETURNING id`,
            [owner.id]
        );
        const asciiHealth = await query(
            `INSERT INTO my_day_impacts (user_id, name, color, icon, sort_order, is_active)
             VALUES ($1, 'Здоров''я', '#111111', 'H1', 40, true)
             RETURNING id`,
            [owner.id]
        );
        const canonicalHealth = await query(
            `INSERT INTO my_day_impacts (user_id, name, color, icon, sort_order, is_active)
             VALUES ($1, 'Здоровʼя', '#222222', 'H2', 50, true)
             RETURNING id`,
            [owner.id]
        );
        const asciiTaskId = await createTask(owner, 'starter ASCII health task');
        const canonicalTaskId = await createTask(owner, 'starter canonical health task');
        await setTaskImpacts(owner.id, asciiTaskId, [Number(asciiHealth.rows[0].id)]);
        await setTaskImpacts(owner.id, canonicalTaskId, [Number(canonicalHealth.rows[0].id)]);
        const habit = await query(
            `INSERT INTO my_day_habits (user_id, name, metric, target_value, cadence)
             VALUES ($1, $2, 'boolean', 1, 'daily')
             RETURNING id`,
            [owner.id, `starter health habit ${suffix}`]
        );
        await query(
            `INSERT INTO my_day_habit_impacts (habit_id, user_id, impact_id)
             VALUES ($1, $2, $3)`,
            [habit.rows[0].id, owner.id, asciiHealth.rows[0].id]
        );
        const client = await pool.connect();
        let first;
        try {
            await client.query('BEGIN');
            first = await applyMyDayStarterKit(client, owner.id);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        assert.deepEqual(first.created, { impacts: 22, habits: 5 });
        assert.deepEqual(first.skipped, { impacts: 2, habits: 0 });
        const catalog = await query(
            `SELECT id, name, color, icon, sort_order, is_active
             FROM my_day_impacts
             WHERE user_id = $1
             ORDER BY sort_order, id`,
            [owner.id]
        );
        assert.equal(catalog.rows.length, 25);
        assert.equal(catalog.rows.filter(row => row.is_active).length, 24);
        ['Продукт / розробка', 'Маркетинг / залучення', 'Стратегія / пріоритети', 'Фінанси / облік', 'Близькі / стосунки']
            .forEach(name => assert.ok(catalog.rows.some(row => row.name === name), `missing starter impact: ${name}`));
        assert.equal(catalog.rows.some(row => row.name === 'Команда і делегування'), false);
        const normalized = catalog.rows.find(row => Number(row.id) === Number(legacy.rows[0].id));
        assert.equal(normalized.name, 'Команда / делегування');
        assert.equal(normalized.color, '#06B6D4');
        assert.equal(normalized.icon, '👥');
        assert.equal(Number(normalized.sort_order), 170);
        assert.equal(normalized.is_active, true);

        const healthRows = catalog.rows.filter(row => row.name === 'Здоровʼя' || /merged #/.test(row.name));
        assert.equal(healthRows.length, 2);
        const healthTarget = healthRows.find(row => row.name === 'Здоровʼя');
        const healthDuplicate = healthRows.find(row => /merged #/.test(row.name));
        assert.equal(Number(healthTarget.id), Number(asciiHealth.rows[0].id));
        assert.equal(healthTarget.icon, '❤️');
        assert.equal(Number(healthTarget.sort_order), 310);
        assert.equal(healthTarget.is_active, true);
        assert.equal(healthDuplicate.is_active, false);
        const taskLinks = await query(
            `SELECT task_id::int, impact_id::int
             FROM my_day_task_impacts
             WHERE user_id = $1 AND task_id = ANY($2::int[])
             ORDER BY task_id`,
            [owner.id, [asciiTaskId, canonicalTaskId]]
        );
        assert.deepEqual(taskLinks.rows, [
            { task_id: asciiTaskId, impact_id: Number(healthTarget.id) },
            { task_id: canonicalTaskId, impact_id: Number(healthTarget.id) }
        ]);
        const habitLinks = await query(
            `SELECT impact_id::int
             FROM my_day_habit_impacts
             WHERE habit_id = $1`,
            [habit.rows[0].id]
        );
        assert.deepEqual(habitLinks.rows, [{ impact_id: Number(healthTarget.id) }]);

        const secondClient = await pool.connect();
        let second;
        try {
            await secondClient.query('BEGIN');
            second = await applyMyDayStarterKit(secondClient, owner.id);
            await secondClient.query('COMMIT');
        } catch (error) {
            await secondClient.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            secondClient.release();
        }
        assert.deepEqual(second.created, { impacts: 0, habits: 0 });
        assert.deepEqual(second.skipped, { impacts: 24, habits: 5 });
    });

    it('enforces auth, ownership, writable business scope, impacts-only writes, legacy direction, and tags preservation', async () => {
        const owner = await createUser('owner_contract');
        const outsider = await createUser('outsider_contract');
        const taskId = await createTask(owner, 'manual classification contract');
        const ownerImpact = await createImpact(owner.id, 'Manual CRM');
        const outsiderImpact = await createImpact(outsider.id, 'Foreign impact');
        const directionId = await createLegacyDirection(owner.id);
        await setTaskMetadata(owner.id, taskId, { directionId, tags: ['legacy-tag'] });

        const noToken = await request('PUT', `/api/my-day/tasks/${taskId}/classification`, { impactIds: [ownerImpact] });
        assert.equal(noToken.status, 401);

        const readOnlyScope = await request('PUT', `/api/my-day/tasks/${taskId}/classification?businessScope=all`, { impactIds: [ownerImpact] }, owner.token);
        assert.equal(readOnlyScope.status, 403);
        assert.match(readOnlyScope.data?.code || '', /business_scope/);

        const outsiderWrite = await putClassification(outsider.token, taskId, { impactIds: [outsiderImpact] });
        assert.equal(outsiderWrite.status, 404);
        assert.deepEqual(await readImpactIds(owner.id, taskId), []);

        const deprecatedTags = await putClassification(owner.token, taskId, { impactIds: [ownerImpact], tags: ['new-tag'] });
        assert.equal(deprecatedTags.status, 409);
        assert.equal(deprecatedTags.data?.code, 'MY_DAY_TAGS_DEPRECATED');
        assert.deepEqual(await readImpactIds(owner.id, taskId), []);

        const ok = await putClassification(owner.token, taskId, { impactIds: [ownerImpact], tags: [] });
        assert.equal(ok.status, 200, JSON.stringify(ok.data));
        assert.deepEqual(ok.data?.classification?.impacts?.map(impact => Number(impact.id)), [ownerImpact]);
        assert.equal(Object.hasOwn(ok.data?.classification || {}, 'tags'), false);

        const metadata = await readMetadata(owner.id, taskId);
        assert.equal(metadata.direction_id, directionId);
        assert.deepEqual(metadata.tags, ['legacy-tag']);
        assert.deepEqual(await readImpactIds(owner.id, taskId), [ownerImpact]);
    });

    it('rejects AI race writes when manual impacts change during the provider call', async () => {
        const owner = await createUser('race_owner');
        const taskId = await createTask(owner, 'race classification');
        const manualImpact = await createImpact(owner.id, 'Manual race impact');
        const aiImpact = await createImpact(owner.id, 'AI race impact');
        const received = deferred();
        const release = deferred();
        openAiMock.enqueue(async body => {
            received.resolve(body);
            await release.promise;
            return openAiOutput([aiImpact], 0.92, 'AI after race');
        });

        const autoPromise = postAuto(owner.token, taskId);
        const body = await received.promise;
        assert.equal(body.model, 'gpt-5.6-luna');
        assert.equal(body.store, false);
        assert.deepEqual(body.reasoning, { effort: 'low' });

        const manual = await putClassification(owner.token, taskId, { impactIds: [manualImpact] });
        assert.equal(manual.status, 200, JSON.stringify(manual.data));
        release.resolve();

        const auto = await autoPromise;
        assert.equal(auto.status, 409, JSON.stringify(auto.data));
        assert.equal(auto.data?.code, 'MY_DAY_CLASSIFICATION_CHANGED_DURING_AI_CLASSIFICATION');
        assert.deepEqual(await readImpactIds(owner.id, taskId), [manualImpact]);
    });

    it('uses server undo tokens conditionally and can restore an archived legacy impact from the signed snapshot', async () => {
        const owner = await createUser('undo_owner');
        const archivedTaskId = await createTask(owner, 'undo archived restore');
        const archivedImpact = await createImpact(owner.id, 'Archived previous impact', { isActive: false });
        const activeImpact = await createImpact(owner.id, 'Active AI impact');
        await setTaskMetadata(owner.id, archivedTaskId, {});
        await setTaskImpacts(owner.id, archivedTaskId, [archivedImpact]);
        openAiMock.enqueue(() => openAiOutput([activeImpact], 0.94, 'active impact'));

        const applied = await postAuto(owner.token, archivedTaskId);
        assert.equal(applied.status, 200, JSON.stringify(applied.data));
        assert.ok(applied.data?.undoToken);
        assert.deepEqual(await readImpactIds(owner.id, archivedTaskId), [activeImpact]);

        const restored = await postUndo(owner.token, archivedTaskId, applied.data.undoToken);
        assert.equal(restored.status, 200, JSON.stringify(restored.data));
        assert.deepEqual(restored.data?.classification?.impacts?.map(impact => Number(impact.id)), [archivedImpact]);
        assert.equal(restored.data?.classification?.impacts?.[0]?.isActive, false);
        assert.deepEqual(await readImpactIds(owner.id, archivedTaskId), [archivedImpact]);

        const conflictTaskId = await createTask(owner, 'undo conflict');
        const beforeImpact = await createImpact(owner.id, 'Undo before');
        const aiImpact = await createImpact(owner.id, 'Undo AI');
        const newerImpact = await createImpact(owner.id, 'Undo newer manual');
        await setTaskImpacts(owner.id, conflictTaskId, [beforeImpact]);
        openAiMock.enqueue(() => openAiOutput([aiImpact], 0.93, 'ai update'));
        const conflictApplied = await postAuto(owner.token, conflictTaskId);
        assert.equal(conflictApplied.status, 200, JSON.stringify(conflictApplied.data));
        const newerManual = await putClassification(owner.token, conflictTaskId, { impactIds: [newerImpact] });
        assert.equal(newerManual.status, 200, JSON.stringify(newerManual.data));
        const undoConflict = await postUndo(owner.token, conflictTaskId, conflictApplied.data.undoToken);
        assert.equal(undoConflict.status, 409, JSON.stringify(undoConflict.data));
        assert.equal(undoConflict.data?.code, 'MY_DAY_CLASSIFICATION_UNDO_CONFLICT');
        assert.deepEqual(await readImpactIds(owner.id, conflictTaskId), [newerImpact]);
    });

    it('does not partially write on provider timeout, invalid output, empty output, or low confidence', async () => {
        const owner = await createUser('provider_edges');
        const existingImpact = await createImpact(owner.id, 'Existing edge impact');
        const aiImpact = await createImpact(owner.id, 'AI edge impact');

        const cases = [
            {
                title: 'timeout',
                expectedStatus: 504,
                expectedCode: 'MY_DAY_AI_TIMEOUT',
                handler: async () => {
                    await new Promise(resolve => setTimeout(resolve, 900));
                    return openAiOutput([aiImpact], 0.9, 'late');
                }
            },
            {
                title: 'invalid structured output',
                expectedStatus: 422,
                expectedCode: 'MY_DAY_AI_INVALID_RESPONSE',
                handler: () => jsonResponse({ output_text: JSON.stringify({ confidence: 0.9, reason: 'missing ids' }) })
            },
            {
                title: 'empty structured output',
                expectedStatus: 422,
                expectedCode: 'MY_DAY_AI_NO_MATCH',
                handler: () => openAiOutput([], 0.2, 'no match')
            },
            {
                title: 'low confidence',
                expectedStatus: 422,
                expectedCode: 'MY_DAY_AI_LOW_CONFIDENCE',
                handler: () => openAiOutput([aiImpact], 0.2, 'weak')
            }
        ];

        for (const entry of cases) {
            const taskId = await createTask(owner, `provider edge ${entry.title}`);
            await setTaskImpacts(owner.id, taskId, [existingImpact]);
            openAiMock.enqueue(entry.handler);
            const response = await postAuto(owner.token, taskId);
            assert.equal(response.status, entry.expectedStatus, `${entry.title}: ${JSON.stringify(response.data)}`);
            assert.equal(response.data?.code, entry.expectedCode);
            assert.deepEqual(await readImpactIds(owner.id, taskId), [existingImpact], `${entry.title} keeps previous impacts`);
        }
    });

    it('applies per-user AI rate limiting before repeated provider calls can keep mutating', async () => {
        const owner = await createUser('rate_owner');
        const taskId = await createTask(owner, 'rate limited auto');
        const statuses = [];
        for (let index = 0; index < 11; index += 1) {
            const response = await postAuto(owner.token, taskId);
            statuses.push(response.status);
        }
        assert.equal(statuses.at(-1), 429, `expected last call to be rate limited: ${statuses.join(',')}`);
    });

    it('persists task AI preview rate limits in PostgreSQL across requests', async () => {
        const owner = await createUser('draft_rate_owner');
        const impactId = await createImpact(owner.id, 'Draft Rate CRM');
        const proposal = validDraftProposal([impactId]);
        const callsBefore = openAiMock.calls.length;
        for (let index = 0; index < 12; index += 1) {
            openAiMock.enqueue(() => openAiDraftOutput(proposal));
        }
        const statuses = [];
        for (let index = 0; index < 13; index += 1) {
            const response = await postAiDraftPreview(owner.token, {
                currentDraft: {
                    title: `Durable limiter preview ${index} ${suffix}`,
                    description: 'No production task write.',
                    impactIds: []
                }
            });
            statuses.push(response.status);
        }
        assert.deepEqual(statuses.slice(0, 12), Array(12).fill(200));
        assert.equal(statuses[12], 429, `expected durable rate limit: ${statuses.join(',')}`);
        assert.equal(openAiMock.calls.length - callsBefore, 12);
        const bucket = await query(
            `SELECT request_count::int AS request_count, reset_at > window_started_at AS valid_window
             FROM task_ai_rate_limit_buckets
             WHERE user_id = $1 AND business_context = 'event_genix' AND action = 'preview'`,
            [owner.id]
        );
        assert.equal(bucket.rows.length, 1);
        assert.equal(bucket.rows[0].request_count, 12);
        assert.equal(bucket.rows[0].valid_window, true);
    });

    it('commits AI draft task, subtasks, impacts, and audit history atomically with idempotent replay', async () => {
        const taskAiDraftPreview = require('../../services/taskAiDraftPreview');
        const owner = await createUser('ai_draft_commit');
        const crmImpact = await createImpact(owner.id, 'AI Draft CRM');
        const hermesImpact = await createImpact(owner.id, 'AI Draft Hermes');
        const aiImpact = await createImpact(owner.id, 'AI Draft Automation');
        const impactIds = [crmImpact, hermesImpact, aiImpact];
        const proposal = validDraftProposal(impactIds);
        openAiMock.enqueue(body => {
            assert.equal(body.model, 'gpt-5.6-luna');
            assert.equal(body.store, false);
            assert.deepEqual(body.reasoning, { effort: 'low' });
            return openAiDraftOutput(proposal);
        });

        const preview = await postAiDraftPreview(owner.token, {
            currentDraft: {
                title: `crm hermes ai composer ${suffix}`,
                description: 'Need a safe checklist',
                mode: 'simple',
                impactIds: []
            }
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        assert.equal(preview.data?.success, true);
        assert.ok(preview.data?.proposalToken);
        assert.deepEqual(preview.data?.proposal?.impactIds, impactIds);

        const commitBody = {
            proposalToken: preview.data.proposalToken,
            proposalHash: preview.data.proposalHash,
            draftFingerprint: preview.data.draftFingerprint,
            proposal: preview.data.proposal,
            acceptedFieldMask: ['title', 'description', 'mode', 'impactIds', 'subtasks'],
            finalDraft: {
                title: proposal.title,
                description: proposal.description,
                mode: proposal.mode,
                taskMode: 'work',
                impactIds,
                subtasks: proposal.subtasks
            },
            idempotencyKey: `ai-draft-commit-${suffix}`
        };
        const committed = await postAiDraftCommit(owner.token, commitBody);
        assert.equal(committed.status, 200, JSON.stringify(committed.data));
        assert.equal(committed.data?.success, true);
        assert.equal(committed.data?.replayed, false);
        const taskId = Number(committed.data?.task?.id);
        assert.ok(taskId > 0);
        assert.equal(committed.data?.subtasks?.length, 3);
        assert.deepEqual(committed.data?.classification?.impacts?.map(impact => Number(impact.id)), impactIds);
        assert.deepEqual(await readImpactIds(owner.id, taskId), impactIds);

        const history = await query(
            `SELECT action_type, meta_json, new_value_json
             FROM task_action_history
             WHERE task_id = $1 AND action_type = 'task_ai_draft_committed'
             ORDER BY id DESC
             LIMIT 1`,
            [taskId]
        );
        assert.equal(history.rows.length, 1);
        assert.equal(history.rows[0].meta_json.provider, 'openai');
        assert.equal(history.rows[0].meta_json.model, 'gpt-5.6-luna');
        assert.equal(history.rows[0].meta_json.rawPromptStored, false);
        assert.equal(history.rows[0].meta_json.rawProviderResponseStored, false);
        assert.equal(JSON.stringify(history.rows[0]).includes(proposal.title), false);

        const replay = await postAiDraftCommit(owner.token, commitBody);
        assert.equal(replay.status, 200, JSON.stringify(replay.data));
        assert.equal(replay.data?.replayed, true);
        assert.equal(Number(replay.data?.task?.id), taskId);

        const archivedImpact = await createImpact(owner.id, 'AI Draft Archived', { isActive: false });
        const rollbackDraft = { title: `rollback ${suffix}`, description: '' };
        const rollbackProposal = validDraftProposal([crmImpact], { title: `AI rollback task ${suffix}` });
        const rollbackToken = taskAiDraftPreview.createProposalToken({
            userId: owner.id,
            businessScope: { businessContext: 'event_genix' },
            fingerprint: taskAiDraftPreview.draftFingerprint(rollbackDraft),
            proposal: rollbackProposal,
            catalogVersion: taskAiDraftPreview.activeImpactCatalogVersion([
                { id: crmImpact, name: 'AI Draft CRM', isActive: true },
                { id: hermesImpact, name: 'AI Draft Hermes', isActive: true },
                { id: aiImpact, name: 'AI Draft Automation', isActive: true }
            ]),
            secret: process.env.JWT_SECRET
        });
        const failed = await postAiDraftCommit(owner.token, {
            proposalToken: rollbackToken,
            proposalHash: taskAiDraftPreview.proposalHash(rollbackProposal),
            draftFingerprint: taskAiDraftPreview.draftFingerprint(rollbackDraft),
            proposal: rollbackProposal,
            acceptedFieldMask: ['title', 'impactIds'],
            finalDraft: {
                title: rollbackProposal.title,
                mode: 'simple',
                impactIds: [archivedImpact],
                subtasks: []
            },
            idempotencyKey: `ai-draft-rollback-${suffix}`
        });
        assert.notEqual(failed.status, 200, JSON.stringify(failed.data));
        const leaked = await query('SELECT COUNT(*)::int AS count FROM tasks WHERE title = $1', [rollbackProposal.title]);
        assert.equal(leaked.rows[0].count, 0);
    });

    it('commits AI draft bundle atomically with idempotent replay and no dependencies or outbox rows', async () => {
        const owner = await createUser('ai_bundle_commit');
        const crmImpact = await createImpact(owner.id, 'Bundle CRM');
        const hermesImpact = await createImpact(owner.id, 'Bundle Hermes');
        const aiImpact = await createImpact(owner.id, 'Bundle Automation');
        const impactIds = [crmImpact, hermesImpact, aiImpact];
        const proposal = validBundleProposal(impactIds);
        openAiMock.enqueue(body => {
            assert.equal(body.model, 'gpt-5.6-luna');
            assert.equal(body.store, false);
            return openAiDraftOutput(proposal);
        });

        const outboxBefore = await query('SELECT COUNT(*)::int AS count FROM notification_outbox');
        const preview = await postAiDraftPreview(owner.token, {
            currentDraft: {
                title: `bundle crm hermes automation ${suffix}`,
                description: 'Create several real tasks',
                mode: 'simple',
                impactIds: []
            }
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        assert.equal(preview.data?.proposal?.decision, 'task_bundle');

        const commitBody = {
            proposalToken: preview.data.proposalToken,
            proposalHash: preview.data.proposalHash,
            draftFingerprint: preview.data.draftFingerprint,
            proposal: preview.data.proposal,
            bundleTitle: preview.data.proposal.bundleTitle,
            tasks: preview.data.proposal.tasks,
            acceptedTaskMask: [0, 1, 2],
            rejectedTaskMask: [],
            idempotencyKey: `ai-bundle-commit-${suffix}`
        };
        const committed = await postAiDraftBundleCommit(owner.token, commitBody);
        assert.equal(committed.status, 200, JSON.stringify(committed.data));
        assert.equal(committed.data?.success, true);
        assert.equal(committed.data?.replayed, false);
        assert.equal(committed.data?.tasks?.length, 3);
        const taskIds = committed.data.tasks.map(task => Number(task.id));
        assert.equal(new Set(taskIds).size, 3);
        const bundleId = committed.data?.bundle?.id;
        assert.ok(bundleId);

        const canonicalBundle = await query(
            `SELECT id, status, created_by_user_id, business_context, idempotency_key, task_count,
                    proposal_hash, draft_fingerprint, request_hash,
                    accepted_task_mask, rejected_task_mask
             FROM task_bundles
             WHERE id = $1`,
            [bundleId]
        );
        assert.equal(canonicalBundle.rows.length, 1);
        assert.equal(canonicalBundle.rows[0].status, 'committed');
        assert.equal(Number(canonicalBundle.rows[0].created_by_user_id), owner.id);
        assert.equal(canonicalBundle.rows[0].business_context, 'event_genix');
        assert.equal(canonicalBundle.rows[0].idempotency_key, commitBody.idempotencyKey);
        assert.equal(Number(canonicalBundle.rows[0].task_count), 3);
        assert.deepEqual(canonicalBundle.rows[0].accepted_task_mask, [0, 1, 2]);
        assert.deepEqual(canonicalBundle.rows[0].rejected_task_mask, []);
        assert.ok(canonicalBundle.rows[0].proposal_hash);
        assert.ok(canonicalBundle.rows[0].draft_fingerprint);
        assert.ok(canonicalBundle.rows[0].request_hash);

        const memberships = await query(
            `SELECT task_id::int AS task_id, task_index::int AS task_index
             FROM task_bundle_tasks
             WHERE bundle_id = $1
             ORDER BY task_index`,
            [bundleId]
        );
        assert.deepEqual(memberships.rows.map(row => row.task_id), taskIds);
        assert.deepEqual(memberships.rows.map(row => row.task_index), [0, 1, 2]);

        const bundleRead = await getAiDraftBundle(owner.token, bundleId);
        assert.equal(bundleRead.status, 200, JSON.stringify(bundleRead.data));
        assert.equal(bundleRead.data?.bundle?.id, bundleId);
        assert.deepEqual(bundleRead.data?.bundle?.taskIds?.map(Number), taskIds);
        const outsider = await createUser('ai_bundle_read_outsider');
        const hiddenBundle = await getAiDraftBundle(outsider.token, bundleId);
        assert.equal(hiddenBundle.status, 404, JSON.stringify(hiddenBundle.data));

        for (let index = 0; index < taskIds.length; index += 1) {
            assert.deepEqual(await readImpactIds(owner.id, taskIds[index]), proposal.tasks[index].impactIds);
        }
        const rows = await query(
            `SELECT id, source_type, dependency_ids, control_meta
             FROM tasks
             WHERE id = ANY($1::int[])
             ORDER BY id`,
            [taskIds]
        );
        assert.equal(rows.rows.length, 3);
        rows.rows.forEach(row => {
            assert.equal(row.source_type, 'ai_draft_bundle');
            assert.deepEqual(row.dependency_ids || [], []);
            assert.ok(row.control_meta?.aiDraftBundle?.bundleId);
            assert.equal(JSON.stringify(row.control_meta).includes(proposal.bundleTitle), false);
        });

        const history = await query(
            `SELECT action_type, meta_json, new_value_json
             FROM task_action_history
             WHERE action_type = 'task_ai_draft_bundle_committed'
               AND meta_json->>'idempotencyKey' = $1
             ORDER BY id DESC
             LIMIT 1`,
            [commitBody.idempotencyKey]
        );
        assert.equal(history.rows.length, 1);
        assert.deepEqual(history.rows[0].meta_json.taskIds.map(Number), taskIds);
        assert.equal(history.rows[0].meta_json.rawPromptStored, false);
        assert.equal(history.rows[0].meta_json.rawProviderResponseStored, false);
        assert.equal(JSON.stringify(history.rows[0]).includes(proposal.tasks[0].title), false);

        const replay = await postAiDraftBundleCommit(owner.token, commitBody);
        assert.equal(replay.status, 200, JSON.stringify(replay.data));
        assert.equal(replay.data?.replayed, true);
        assert.deepEqual(replay.data?.bundle?.taskIds?.map(Number), taskIds);
        const canonicalCount = await query(
            'SELECT COUNT(*)::int AS count FROM task_bundles WHERE id = $1',
            [bundleId]
        );
        assert.equal(canonicalCount.rows[0].count, 1);

        const duplicateCheck = await query(
            `SELECT COUNT(*)::int AS count
             FROM tasks
             WHERE source_type = 'ai_draft_bundle'
               AND source_id = $1`,
            [rows.rows[0].control_meta.aiDraftBundle.bundleId.slice(0, 50)]
        );
        assert.equal(duplicateCheck.rows[0].count, 3);
        const outboxAfter = await query('SELECT COUNT(*)::int AS count FROM notification_outbox');
        assert.equal(outboxAfter.rows[0].count, outboxBefore.rows[0].count);
    });

    it('serializes concurrent AI bundle double-click commits into one bundle', async () => {
        const owner = await createUser('ai_bundle_double');
        const crmImpact = await createImpact(owner.id, 'Double CRM');
        const hermesImpact = await createImpact(owner.id, 'Double Hermes');
        const aiImpact = await createImpact(owner.id, 'Double Automation');
        const proposal = validBundleProposal([crmImpact, hermesImpact, aiImpact], {
            bundleTitle: `AI bundle double click ${suffix}`
        });
        openAiMock.enqueue(() => openAiDraftOutput(proposal));
        const preview = await postAiDraftPreview(owner.token, {
            currentDraft: {
                title: `double click bundle ${suffix}`,
                description: 'Two rapid commits should create one bundle',
                mode: 'simple',
                impactIds: []
            }
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        const commitBody = {
            proposalToken: preview.data.proposalToken,
            proposalHash: preview.data.proposalHash,
            draftFingerprint: preview.data.draftFingerprint,
            proposal: preview.data.proposal,
            bundleTitle: preview.data.proposal.bundleTitle,
            tasks: preview.data.proposal.tasks,
            acceptedTaskMask: [0, 1, 2],
            rejectedTaskMask: [],
            idempotencyKey: `ai-bundle-double-${suffix}`
        };

        const [first, second] = await Promise.all([
            postAiDraftBundleCommit(owner.token, commitBody),
            postAiDraftBundleCommit(owner.token, commitBody)
        ]);
        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.deepEqual([first.data.replayed, second.data.replayed].sort(), [false, true]);
        const createdTaskIds = (first.data.replayed ? second : first).data.bundle.taskIds.map(Number);
        const count = await query(
            `SELECT COUNT(*)::int AS count
             FROM tasks
             WHERE id = ANY($1::int[])`,
            [createdTaskIds]
        );
        assert.equal(count.rows[0].count, 3);
        const historyCount = await query(
            `SELECT COUNT(*)::int AS count
             FROM task_action_history
             WHERE action_type = 'task_ai_draft_bundle_committed'
               AND meta_json->>'idempotencyKey' = $1`,
            [commitBody.idempotencyKey]
        );
        assert.equal(historyCount.rows[0].count, 1);
        const bundleCount = await query(
            'SELECT COUNT(*)::int AS count FROM task_bundles WHERE idempotency_key = $1',
            [commitBody.idempotencyKey]
        );
        assert.equal(bundleCount.rows[0].count, 1);
    });

    it('rolls back AI bundle when a middle task duplicates inside the transaction', async () => {
        const owner = await createUser('ai_bundle_dup');
        const crmImpact = await createImpact(owner.id, 'Duplicate CRM');
        const hermesImpact = await createImpact(owner.id, 'Duplicate Hermes');
        const aiImpact = await createImpact(owner.id, 'Duplicate Automation');
        const duplicateTitle = `AI bundle duplicate middle ${suffix}`;
        const proposal = validBundleProposal([crmImpact, hermesImpact, aiImpact], {
            bundleTitle: `AI duplicate rollback ${suffix}`,
            tasks: validBundleProposal([crmImpact, hermesImpact, aiImpact]).tasks.map((task, index) => ({
                ...task,
                title: index < 2 ? duplicateTitle : task.title,
                scheduleDate: index < 2 ? '2099-03-01' : task.scheduleDate,
                impactIds: [crmImpact]
            }))
        });
        openAiMock.enqueue(() => openAiDraftOutput(proposal));
        const preview = await postAiDraftPreview(owner.token, {
            currentDraft: { title: duplicateTitle, description: 'must rollback middle duplicate', mode: 'simple', impactIds: [] }
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        const response = await postAiDraftBundleCommit(owner.token, {
            proposalToken: preview.data.proposalToken,
            proposalHash: preview.data.proposalHash,
            draftFingerprint: preview.data.draftFingerprint,
            proposal: preview.data.proposal,
            bundleTitle: preview.data.proposal.bundleTitle,
            tasks: preview.data.proposal.tasks,
            acceptedTaskMask: [0, 1, 2],
            rejectedTaskMask: [],
            idempotencyKey: `ai-bundle-dup-${suffix}`
        });
        assert.equal(response.status, 409, JSON.stringify(response.data));
        const leaked = await query('SELECT COUNT(*)::int AS count FROM tasks WHERE title = $1', [duplicateTitle]);
        assert.equal(leaked.rows[0].count, 0);
        const history = await query(
            `SELECT COUNT(*)::int AS count
             FROM task_action_history
             WHERE meta_json->>'idempotencyKey' = $1`,
            [`ai-bundle-dup-${suffix}`]
        );
        assert.equal(history.rows[0].count, 0);
        const bundleRows = await query(
            'SELECT COUNT(*)::int AS count FROM task_bundles WHERE idempotency_key = $1',
            [`ai-bundle-dup-${suffix}`]
        );
        assert.equal(bundleRows.rows[0].count, 0);
    });

    it('rolls back AI bundle when PostgreSQL impact insert fails and does not enqueue notifications', async () => {
        const owner = await createUser('ai_bundle_impact_fail');
        const crmImpact = await createImpact(owner.id, 'Fail CRM');
        const hermesImpact = await createImpact(owner.id, 'Fail Hermes');
        const aiImpact = await createImpact(owner.id, 'Fail Automation');
        const baseTasks = validBundleProposal([crmImpact, hermesImpact, aiImpact]).tasks;
        const proposal = validBundleProposal([crmImpact, hermesImpact, aiImpact], {
            bundleTitle: `AI impact rollback ${suffix}`,
            tasks: baseTasks.map((task, index) => ({
                ...task,
                title: `AI impact rollback task ${index + 1} ${suffix}`
            }))
        });
        openAiMock.enqueue(() => openAiDraftOutput(proposal));
        const preview = await postAiDraftPreview(owner.token, {
            currentDraft: { title: `impact fail bundle ${suffix}`, description: 'trigger should rollback', mode: 'simple', impactIds: [] }
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        const outboxBefore = await query('SELECT COUNT(*)::int AS count FROM notification_outbox');
        await query(`
            CREATE OR REPLACE FUNCTION my_day_bundle_fail_impact_insert()
            RETURNS trigger AS $$
            BEGIN
                IF NEW.impact_id = ${aiImpact} THEN
                    RAISE EXCEPTION 'forced bundle impact failure';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            DROP TRIGGER IF EXISTS trg_my_day_bundle_fail_impact_insert ON my_day_task_impacts;
            CREATE TRIGGER trg_my_day_bundle_fail_impact_insert
            BEFORE INSERT ON my_day_task_impacts
            FOR EACH ROW
            EXECUTE FUNCTION my_day_bundle_fail_impact_insert();
        `);
        try {
            const response = await postAiDraftBundleCommit(owner.token, {
                proposalToken: preview.data.proposalToken,
                proposalHash: preview.data.proposalHash,
                draftFingerprint: preview.data.draftFingerprint,
                proposal: preview.data.proposal,
                bundleTitle: preview.data.proposal.bundleTitle,
                tasks: preview.data.proposal.tasks,
                acceptedTaskMask: [0, 1, 2],
                rejectedTaskMask: [],
                idempotencyKey: `ai-bundle-impact-fail-${suffix}`
            });
            assert.equal(response.status, 500, JSON.stringify(response.data));
        } finally {
            await query('DROP TRIGGER IF EXISTS trg_my_day_bundle_fail_impact_insert ON my_day_task_impacts');
            await query('DROP FUNCTION IF EXISTS my_day_bundle_fail_impact_insert()');
        }
        const leaked = await query(
            `SELECT COUNT(*)::int AS count
             FROM tasks
             WHERE source_type = 'ai_draft_bundle'
               AND title = ANY($1::text[])`,
            [proposal.tasks.map(task => task.title)]
        );
        assert.equal(leaked.rows[0].count, 0);
        const bundleRows = await query(
            'SELECT COUNT(*)::int AS count FROM task_bundles WHERE idempotency_key = $1',
            [`ai-bundle-impact-fail-${suffix}`]
        );
        assert.equal(bundleRows.rows[0].count, 0);
        const outboxAfter = await query('SELECT COUNT(*)::int AS count FROM notification_outbox');
        assert.equal(outboxAfter.rows[0].count, outboxBefore.rows[0].count);
    });
});
