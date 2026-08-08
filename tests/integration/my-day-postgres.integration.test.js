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
    const result = await query(
        `INSERT INTO tasks (title, description, status, priority, deadline, owner_user_id, business_context, created_by, visibility)
         VALUES ($1, $2, COALESCE($3, 'todo'), COALESCE($4, 'normal'), $5, $6, 'event_genix', $7, COALESCE($8, 'me_only'))
         RETURNING id`,
        [
            `${title} ${suffix}`,
            options.description || '',
            options.status || 'todo',
            options.priority || 'normal',
            options.deadline || null,
            user.id,
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

function openAiOutput(impactIds, confidence = 0.9, reason = 'matched') {
    return jsonResponse({
        output_text: JSON.stringify({ impactIds, confidence, reason })
    });
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

    it('adds the expanded canonical impacts and safely normalizes the exact legacy team name', async () => {
        const owner = await createUser('starter_alias');
        const legacy = await query(
            `INSERT INTO my_day_impacts (user_id, name, color, icon, sort_order, is_active)
             VALUES ($1, 'Команда і делегування', '#123456', '🤝', 777, false)
             RETURNING id`,
            [owner.id]
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

        assert.deepEqual(first.created, { impacts: 18, habits: 5 });
        assert.deepEqual(first.skipped, { impacts: 1, habits: 0 });
        const catalog = await query(
            `SELECT id, name, color, icon, sort_order, is_active
             FROM my_day_impacts
             WHERE user_id = $1
             ORDER BY sort_order, id`,
            [owner.id]
        );
        assert.equal(catalog.rows.length, 19);
        ['Операційка / процеси', 'Автоматизація / AI', 'Контент / медіа', 'Аналітика / рішення', 'Команда / делегування']
            .forEach(name => assert.ok(catalog.rows.some(row => row.name === name), `missing starter impact: ${name}`));
        assert.equal(catalog.rows.some(row => row.name === 'Команда і делегування'), false);
        const normalized = catalog.rows.find(row => Number(row.id) === Number(legacy.rows[0].id));
        assert.equal(normalized.name, 'Команда / делегування');
        assert.equal(normalized.color, '#123456');
        assert.equal(normalized.icon, '🤝');
        assert.equal(Number(normalized.sort_order), 777);
        assert.equal(normalized.is_active, false);

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
        assert.deepEqual(second.skipped, { impacts: 19, habits: 5 });
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
});
