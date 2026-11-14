'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { createTelegramCrmIdentity, transaction } = require('../../services/telegramCrmIdentity');
const { buildTaskPersonalQuery, taskViewerRoles } = require('../../services/taskPersonalScope');
const { createTelegramCrmTasks } = require('../../services/telegramCrmTasks');

// This suite never accepts a production URL. Run only against a disposable local cluster.
const enabled = process.env.TELEGRAM_CRM_TEST_PG === '1';
const port = Number(process.env.TELEGRAM_CRM_TEST_PORT || 55439);
const schema = `tg_crm_test_${crypto.randomBytes(8).toString('hex')}`;
let admin, pool, identity;
const password = 'Test-only-secret-2026';
const actor = id => ({ id });
const testDb = (name, fn) => test(name, { skip: !enabled }, fn);

before(async () => {
    if (!enabled) return;
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
    const config = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres', ssl: false, connectionTimeoutMillis: 3000 };
    admin = new Pool(config);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...config, options: `-c search_path=${schema}`, max: 8 });
    await pool.query(`CREATE TABLE users(id INTEGER PRIMARY KEY,password_hash TEXT,is_active BOOLEAN DEFAULT TRUE,session_revoked_at TIMESTAMPTZ,
            username TEXT, name TEXT, role TEXT DEFAULT 'creator');
        CREATE TABLE tasks(id SERIAL PRIMARY KEY,owner_user_id INTEGER,created_by_user_id INTEGER,created_by TEXT,
            assigned_to TEXT,owner TEXT,visibility TEXT DEFAULT 'team',business_context TEXT DEFAULT 'event_genix',status TEXT DEFAULT 'todo',
            title TEXT,description TEXT,date TEXT,deadline TIMESTAMPTZ,scheduled_start_at TIMESTAMPTZ,snoozed_until TIMESTAMPTZ,remind_at TIMESTAMPTZ);
        SELECT setval('tasks_id_seq',2000);
        CREATE TABLE task_observers(task_id INTEGER,user_id INTEGER,PRIMARY KEY(task_id,user_id))`);
    const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/410_telegram_crm_identity.sql'), 'utf8');
    await pool.query(migration);
    await pool.query(migration); // Migration is safe on a previously initialized schema.
    const passwordHash = await bcrypt.hash(password, 4);
    await pool.query('INSERT INTO users(id,password_hash) SELECT n,$1 FROM generate_series(1,30) n', [passwordHash]);
    await pool.query("UPDATE users SET username='fixture'||id,name='Fixture '||id");
    await pool.query('INSERT INTO telegram_crm_bindings(user_id,pilot_enabled,proposed_telegram_id) SELECT id,true,1000+id FROM users');
    await pool.query("INSERT INTO telegram_crm_settings(singleton,mode,bot_username) VALUES(true,'write','FixtureCrmBot')");
    identity = createTelegramCrmIdentity({ pool });
});

after(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});

async function start(id) { return identity.begin(actor(id), password); }
function token(request) { return new URL(request.url).searchParams.get('start').slice(4); }
async function claim(request, senderId) { return identity.claim({ token: token(request), senderId, username: 'test_user', privateChat: true }); }
async function connect(id, senderId) {
    const request = await start(id);
    await claim(request, senderId);
    await identity.confirm(actor(id), request);
    return request;
}

testDb('only CRM + Telegram + original browser proof establishes a verified identity', async () => {
    const before = await identity.status(actor(1));
    assert.equal(before.status, 'preassigned');
    await assert.rejects(identity.resolve('1001'), { code: 'TELEGRAM_NOT_LINKED' });
    await assert.rejects(identity.begin(actor(1), 'wrong'), { code: 'TELEGRAM_REAUTH_REQUIRED' });
    const request = await start(1);
    assert.ok(new URL(request.url).searchParams.get('start').length <= 64);
    await assert.rejects(identity.confirm(actor(1), request), { code: 'TELEGRAM_LINK_NOT_CLAIMED' });
    await claim(request, '5001');
    await assert.rejects(identity.resolve('5001'), { code: 'TELEGRAM_NOT_LINKED' });
    await assert.rejects(identity.pending(actor(2), request.requestId, request.browserProof), { code: 'TELEGRAM_LINK_NOT_FOUND' });
    await assert.rejects(identity.confirm(actor(2), request), { code: 'TELEGRAM_LINK_NOT_FOUND' });
    await assert.rejects(identity.confirm(actor(1), { ...request, browserProof: 'x'.repeat(43) }), { code: 'TELEGRAM_LINK_NOT_FOUND' });
    const pending = await identity.pending(actor(1), request.requestId, request.browserProof);
    assert.equal(pending.telegramId, '5001');
    const confirmed = await identity.confirm(actor(1), request);
    assert.equal(confirmed.status, 'connected');
    assert.equal((await identity.resolve('5001')).user.id, 1);
    await assert.rejects(identity.confirm(actor(1), request), { code: 'TELEGRAM_LINK_EXPIRED' });
    const stored = (await pool.query('SELECT * FROM telegram_crm_link_requests WHERE id=$1', [request.requestId])).rows[0];
    assert.equal(JSON.stringify(stored).includes(request.browserProof), false);
    assert.equal(JSON.stringify(stored).includes(token(request)), false);
});

testDb('a new request cancels the old one; expiry and group chat cannot claim', async () => {
    const first = await start(3);
    const second = await start(3);
    await assert.rejects(claim(first, '5003'), { code: 'TELEGRAM_LINK_EXPIRED' });
    await assert.rejects(identity.claim({ token: token(second), senderId: '5003', privateChat: false }), { code: 'TELEGRAM_PRIVATE_REQUIRED' });
    await pool.query("UPDATE telegram_crm_link_requests SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [second.requestId]);
    await assert.rejects(claim(second, '5003'), { code: 'TELEGRAM_LINK_EXPIRED' });
});

testDb('simultaneous claims consume a link only once', async () => {
    const request = await start(4);
    const results = await Promise.allSettled([claim(request, '5004'), claim(request, '5005')]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.find(item => item.status === 'rejected').reason.code, 'TELEGRAM_LINK_CLAIMED');
});

testDb('concurrent CRM confirmations cannot link the same Telegram to two accounts', async () => {
    const [one, two] = await Promise.all([start(5), start(6)]);
    await Promise.all([claim(one, '5006'), claim(two, '5006')]);
    const results = await Promise.allSettled([identity.confirm(actor(5), one), identity.confirm(actor(6), two)]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.find(item => item.status === 'rejected').reason.code, 'TELEGRAM_ALREADY_LINKED');
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM telegram_crm_bindings WHERE telegram_user_id=5006")).rows[0].count, 1);
});

testDb('replacement preserves old access until confirmation and then revokes old commands', async () => {
    await connect(7, '5007');
    const old = await identity.resolve('5007');
    const replacement = await start(7);
    assert.equal((await identity.resolve('5007')).user.id, 7);
    await claim(replacement, '6007');
    await identity.confirm(actor(7), replacement);
    await assert.rejects(identity.resolve('5007'), { code: 'TELEGRAM_NOT_LINKED' });
    await assert.rejects(identity.resolve('6007', pool, { expectedVersion: old.binding.version }), { code: 'TELEGRAM_LINK_REVOKED' });
    assert.equal((await identity.resolve('6007')).user.id, 7);
});

testDb('disconnect cancels pending links and drafts, including while integration is disabled', async () => {
    await connect(8, '5008');
    const binding = (await identity.resolve('5008')).binding;
    const pending = await start(8);
    await pool.query(`INSERT INTO telegram_crm_task_operations(id,user_id,binding_version,source_update_id,business_context,payload,expires_at)
        VALUES ($1,8,$2,'u1','event_genix','{}',NOW()+INTERVAL '1 hour')`, [crypto.randomUUID(), binding.version]);
    await pool.query("UPDATE telegram_crm_settings SET mode='off'");
    try {
        await assert.rejects(identity.configuration(), { code: 'TELEGRAM_CRM_DISABLED' });
        await identity.disconnect(actor(8), password);
    } finally { await pool.query("UPDATE telegram_crm_settings SET mode='write'"); }
    await assert.rejects(identity.resolve('5008'), { code: 'TELEGRAM_NOT_LINKED' });
    await assert.rejects(claim(pending, '6008'), { code: 'TELEGRAM_LINK_EXPIRED' });
    assert.equal((await pool.query('SELECT state FROM telegram_crm_task_operations WHERE user_id=8')).rows[0].state, 'cancelled');
});

testDb('inactive accounts and pilot removal invalidate previously verified access', async () => {
    await connect(9, '5009');
    await pool.query('UPDATE users SET is_active=false WHERE id=9');
    await assert.rejects(identity.resolve('5009'), { code: 'TELEGRAM_LINK_REVOKED' });
    await connect(10, '5010');
    await pool.query('UPDATE telegram_crm_bindings SET pilot_enabled=false WHERE user_id=10');
    await assert.rejects(identity.resolve('5010'), { code: 'TELEGRAM_LINK_REVOKED' });
});

testDb('a task holding the identity lock serializes with disconnect, then later commands fail', async () => {
    await connect(11, '5011');
    let entered, unblock;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { unblock = resolve; });
    const operation = transaction(pool, async client => {
        const resolved = await identity.resolve('5011', client, { lock: true });
        entered();
        await gate;
        return resolved.binding.version;
    });
    await ready;
    const disconnect = identity.disconnect(actor(11), password);
    unblock();
    await operation;
    await disconnect;
    await assert.rejects(transaction(pool, client => identity.resolve('5011', client, { lock: true })), { code: 'TELEGRAM_NOT_LINKED' });
});

testDb('credential changes during reauthentication fail closed', async () => {
    const racing = createTelegramCrmIdentity({ pool, comparePassword: async () => {
        await pool.query("UPDATE users SET password_hash='replaced' WHERE id=12");
        return true;
    } });
    await assert.rejects(racing.begin(actor(12), password), { code: 'TELEGRAM_REAUTH_REQUIRED' });
});

testDb('personal task scope includes all three roles once, preserves privacy/business, and honors typed identities', async () => {
    await pool.query(`INSERT INTO tasks(id,owner_user_id,created_by_user_id,created_by,assigned_to,visibility,business_context) VALUES
        (100,1,2,NULL,NULL,'team','event_genix'),
        (101,2,1,NULL,NULL,'team','event_genix'),
        (102,2,2,NULL,NULL,'team','event_genix'),
        (103,1,1,NULL,NULL,'team','event_genix'),
        (104,2,2,NULL,NULL,'team','event_genix'),
        (105,2,1,NULL,NULL,'private','event_genix'),
        (106,1,1,NULL,NULL,'team','crm'),
        (107,2,2,NULL,'fixture1','team','event_genix'),
        (108,NULL,2,NULL,'fixture1','team','event_genix'),
        (109,2,NULL,'hermes',NULL,'team','event_genix'),
        (110,2,NULL,'fixture1',NULL,'team','event_genix'),
        (111,2,2,'fixture1',NULL,'team','event_genix');
        INSERT INTO task_observers(task_id,user_id) VALUES(102,1),(103,1)`);
    const user = { id: 1, username: 'fixture1', name: 'Fixture One', role: 'creator' };
    const params = [];
    const scope = buildTaskPersonalQuery(user, params, 't');
    params.push('event_genix');
    const rows = (await pool.query(`SELECT t.*,${scope.roles} AS viewer_roles FROM tasks t
        WHERE ${scope.match} AND t.business_context=$${params.length} ORDER BY t.id`, params)).rows;
    assert.deepEqual(rows.map(row => row.id), [100,101,102,103,108,110]);
    assert.deepEqual(taskViewerRoles(user, rows.find(row => row.id === 103)), ['executor','author','participant']);
    assert.deepEqual(taskViewerRoles(user, rows.find(row => row.id === 102)), ['participant']);
    assert.deepEqual(taskViewerRoles(user, rows.find(row => row.id === 101)), ['author']);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
});

testDb('disconnect remains available after pilot access has been withdrawn', async () => {
    await identity.disconnect(actor(10), password);
    assert.equal((await identity.status(actor(10))).status, 'disconnected');
});

function taskService(extra = {}) {
    return createTelegramCrmTasks({ pool, identity,
        actorContext: async (user, _client, business = 'event_genix') => {
            if (business !== 'event_genix') throw Object.assign(new Error('forbidden business'), { statusCode: 403, code: 'BUSINESS_FORBIDDEN' });
            return { actor: user, scope: { activeContext: business, selectedContexts: [business], canWrite: true } };
        },
        assignableOwner: async (id, { pool: client }) => {
            const row = (await client.query('SELECT id,name AS label FROM users WHERE id=$1 AND is_active=true', [id])).rows[0];
            if (!row) throw Object.assign(new Error('inactive owner'), { statusCode: 403, code: 'OWNER_FORBIDDEN' });
            return row;
        },
        createTask: async (data, { pool: client }) => (await client.query(`INSERT INTO tasks
            (owner_user_id,created_by_user_id,created_by,assigned_to,owner,business_context,title,description,date,deadline)
            VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [data.owner_user_id,data.created_by_user_id,data.created_by,data.assigned_to,data.businessContext,data.title,data.description,data.date,data.deadline])).rows[0],
        ...extra
    });
}

testDb('task previews and concurrent confirmations produce one task and preserve the human author', async () => {
    await connect(14, '5014'); await connect(15, '5015');
    const tasks = taskService();
    const input = { title: 'Explicit fixture', ownerUserId: 15, businessContext: 'event_genix', sourceUpdateId: '1401' };
    const first = await tasks.preview('5014', input);
    const repeated = await tasks.preview('5014', input);
    assert.equal(first.operationId, repeated.operationId);
    assert.equal(first.draft.deadline, null);
    assert.equal(first.draft.date, null);
    await assert.rejects(tasks.preview('5014', { ...input, title: 'changed' }), { code: 'TELEGRAM_OPERATION_CONFLICT' });
    await assert.rejects(tasks.commit('5015', first.operationId, true), { code: 'TELEGRAM_OPERATION_NOT_FOUND' });
    await assert.rejects(tasks.commit('5014', first.operationId, false), { code: 'TELEGRAM_CONFIRMATION_REQUIRED' });
    const results = await Promise.all([tasks.commit('5014', first.operationId, true), tasks.commit('5014', first.operationId, true)]);
    assert.equal(results[0].receipt.task.id, results[1].receipt.task.id);
    assert.equal(results.filter(result => result.replay).length, 1);
    const task = (await pool.query('SELECT * FROM tasks WHERE id=$1', [results[0].receipt.task.id])).rows[0];
    assert.equal(task.created_by_user_id, 14); assert.equal(task.owner_user_id, 15);
    assert.equal(task.created_by, 'fixture14');
    // A lost HTTP response is recovered by the original operation ID, never another create.
    const recovered = await tasks.operation('5014', first.operationId);
    assert.equal(recovered.receipt.task.id, task.id);
    await assert.rejects(tasks.operation('5015', first.operationId), { code: 'TELEGRAM_OPERATION_NOT_FOUND' });
    await pool.query("UPDATE telegram_crm_task_operations SET expires_at=NOW()-INTERVAL '1 day' WHERE id=$1", [first.operationId]);
    assert.equal((await tasks.commit('5014', first.operationId, true)).replay, true);
    assert.equal((await tasks.list('5014')).tasks.some(row => row.id === task.id && row.viewerRoles.includes('author')), true);
    assert.equal((await tasks.list('5015')).tasks.some(row => row.id === task.id && row.viewerRoles.includes('executor')), true);
});

testDb('task rights, expiry, cancellation and binding revocation are rechecked at confirmation', async () => {
    await connect(16, '5016');
    const tasks = taskService();
    const make = suffix => tasks.preview('5016', { title: `fixture ${suffix}`, ownerUserId: 16, businessContext: 'event_genix', sourceUpdateId: `160${suffix}` });
    const denied = await make(1);
    await pool.query("UPDATE users SET role='animator' WHERE id=16");
    await assert.rejects(tasks.commit('5016', denied.operationId, true), { code: 'TASK_CREATE_FORBIDDEN' });
    await pool.query("UPDATE users SET role='creator' WHERE id=16");
    const expired = await make(2);
    await pool.query("UPDATE telegram_crm_task_operations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.operationId]);
    await assert.rejects(tasks.commit('5016', expired.operationId, true), { code: 'TELEGRAM_DRAFT_EXPIRED' });
    const cancelled = await make(3); await tasks.cancel('5016', cancelled.operationId);
    await assert.rejects(tasks.commit('5016', cancelled.operationId, true), { code: 'TELEGRAM_DRAFT_EXPIRED' });
    const revoked = await make(4); await identity.disconnect(actor(16), password);
    await connect(16, '6016');
    await assert.rejects(tasks.commit('6016', revoked.operationId, true), { code: 'TELEGRAM_OPERATION_NOT_FOUND' });
});

testDb('failed task/receipt transaction rolls back and can retry the same operation', async () => {
    await connect(17, '5017');
    const input = { title: 'rollback fixture', ownerUserId: 17, businessContext: 'event_genix', sourceUpdateId: '1701' };
    const draft = await taskService().preview('5017', input);
    const failing = taskService({ createTask: async (_payload, { pool: client }) => {
        await client.query("INSERT INTO tasks(title) VALUES('must roll back')");
        throw new Error('simulated database failure');
    } });
    await assert.rejects(failing.commit('5017', draft.operationId, true), /simulated/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM tasks WHERE title='must roll back'")).rows[0].n, 0);
    assert.equal((await taskService().operation('5017', draft.operationId)).state, 'draft');
    const success = await taskService().commit('5017', draft.operationId, true);
    assert.equal(success.state, 'committed');
});

testDb('read-only pilot, foreign business, non-pilot recipients and invalid filters fail closed', async () => {
    await connect(18, '5018');
    const tasks = taskService();
    const input = { title: 'scope fixture', ownerUserId: 18, businessContext: 'event_genix', sourceUpdateId: '1801' };
    await assert.rejects(tasks.preview('5018', { ...input, businessContext: 'crm' }), { code: 'BUSINESS_FORBIDDEN' });
    await assert.rejects(tasks.preview('5018', { ...input, ownerUserId: 999 }), { code: 'TELEGRAM_OWNER_OUTSIDE_PILOT' });
    await assert.rejects(tasks.list('5018', { dateFrom: '2026-02-30' }), { code: 'TELEGRAM_TASK_DATE_INVALID' });
    await assert.rejects(tasks.list('5018', { limit: 1000 }), { code: 'TELEGRAM_TASK_PAGE_INVALID' });
    await pool.query("UPDATE telegram_crm_settings SET mode='read'");
    try {
        await assert.rejects(tasks.preview('5018', input), { code: 'TELEGRAM_CRM_READ_ONLY' });
        assert.ok(Array.isArray((await tasks.list('5018')).tasks));
    } finally { await pool.query("UPDATE telegram_crm_settings SET mode='write'"); }
});
