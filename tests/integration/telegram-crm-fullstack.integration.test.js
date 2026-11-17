'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID, randomInt } = require('node:crypto');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { before, after, test } = require('node:test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { BASE_URL, getToken, request } = require('../helpers');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { applyPilot, PILOT } = require('../../scripts/telegram-crm-pilot');
const enabled = process.env.RUN_TELEGRAM_CRM_FULLSTACK === 'true';
const check = (name, fn) => test(name, { skip: !enabled }, fn);
let pool, jwt, owner, peer, business;
const telegram = String(randomInt(900000000000, 910000000000));
let peerTelegram = String(randomInt(920000000000, 930000000000));
let nextUpdate = 100;

async function bot(path, body, sender = telegram, extraHeaders = {}) {
    const response = await fetch(BASE_URL + '/api/telegram-crm/bot' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer isolated-telegram-crm-fixture-only',
            'Content-Type': 'application/json', 'x-telegram-user-id': sender,
            'x-telegram-chat-id': sender, 'x-telegram-chat-type': 'private', ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
}

before(async () => {
    if (!enabled) return;
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    pool = new Pool({ connectionString: target.url.toString(), ssl: false });
    jwt = await getToken();
    owner = (await pool.query('SELECT * FROM users WHERE username=$1', [process.env.TEST_USER])).rows[0];
    peer = (await pool.query(`INSERT INTO users(username,name,role,password_hash,business_contexts,default_business_context)
        VALUES ('telegram.fixture.peer','Fixture Peer','animator',$1,ARRAY['event_genix'],'event_genix') RETURNING *`,
    [await bcrypt.hash('fixture-only-peer-password',4)])).rows[0];
    const org = (await pool.query("INSERT INTO organizations(slug,name) VALUES ('telegram-fixture','Disposable Telegram CRM') RETURNING id")).rows[0];
    business = (await pool.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode,modules)
        VALUES ($1,'event_genix','Fixture Business','Fixture','membership','["tasks"]')
        ON CONFLICT(context_key) DO UPDATE SET access_mode='membership',modules='["tasks"]' RETURNING *`, [org.id])).rows[0];
    for (const user of [owner, peer]) {
        await pool.query(`INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')
            ON CONFLICT(organization_id,user_id) DO UPDATE SET is_active=true`, [business.organization_id,user.id]);
        await pool.query(`INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default)
            VALUES($1,$2,$3,$4,true) ON CONFLICT(business_id,user_id) DO UPDATE SET is_active=true,role=excluded.role`,
        [business.id,business.organization_id,user.id,user.role]);
    }
    await pool.query("INSERT INTO telegram_crm_settings(singleton,mode,bot_username) VALUES(true,'write','FixtureCrmBot')");
    await pool.query('INSERT INTO telegram_crm_bindings(user_id,pilot_enabled,proposed_telegram_id) VALUES($1,true,$2),($3,true,$4)', [owner.id,telegram,peer.id,peerTelegram]);
});
after(async () => { await pool?.end(); });

async function preview(title = 'Disposable Telegram full-stack task') {
    return bot('/tasks/preview', { title, ownerUserId: peer.id, businessContext: 'event_genix', sourceUpdateId: String(nextUpdate++) });
}

const notifications = (path, body, headers = {}) => bot('/notifications' + path, body, telegram, {
    'x-telegram-user-id': '', 'x-telegram-chat-id': '', 'x-telegram-chat-type': '', ...headers
});

check('real JWT -> one-time Telegram claim -> same authenticated account confirmation', async () => {
    assert.equal((await bot('/me')).status,403);
    const started = await request('POST', '/api/auth/telegram-crm/link', {}, jwt);
    assert.equal(started.status,201,JSON.stringify(started.data));
    const token = new URL(started.data.url).searchParams.get('start').slice(4);
    assert.equal((await bot('/link/claim', { token, senderId: peerTelegram })).status,200);
    assert.equal((await bot('/me')).status,403);
    const confirmed = await request('POST','/api/auth/telegram-crm/link/confirm',started.data,jwt);
    assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
    const actual = await bot('/me');
    assert.equal(actual.status,200,JSON.stringify(actual.data));
    assert.equal(actual.data.user.id,owner.id);
    assert.equal(actual.data.canCreateTasks,true);
    const peerLogin = await request('POST', '/api/auth/login', {
        username: peer.username, password: 'fixture-only-peer-password'
    });
    assert.equal(peerLogin.status, 200);
    const peerLink = await request('POST', '/api/auth/telegram-crm/link', {}, peerLogin.data.token);
    assert.equal(peerLink.status, 201);
    const peerStart = new URL(peerLink.data.url).searchParams.get('start').slice(4);
    assert.equal((await bot('/link/claim', { token: peerStart }, peerTelegram)).status, 200);
    assert.equal((await request('POST', '/api/auth/telegram-crm/link/confirm', peerLink.data, peerLogin.data.token)).status, 200);
    // No incoming peer /me, /start, or other message after browser confirmation.
    assert.equal((await notifications('/recipients', undefined, { Authorization: '' })).status, 401);
    const roster = (await notifications('/recipients')).data.recipients;
    assert.deepEqual(roster.find(row => row.userId === peer.id), {
        userId: peer.id, telegramId: peerTelegram, bindingVersion: '2'
    });
    assert.ok((await notifications('/health')).data.missing.some(row => row.userId === peer.id));
    assert.equal((await notifications('/heartbeat', { recipients: roster })).status, 200);
    assert.deepEqual((await notifications('/health')).data.missing, []);
});

check('canonical task writer, actual membership checks and concurrent confirms share one receipt', async () => {
    const owners = await bot('/owners?businessContext=event_genix');
    assert.equal(owners.status,200,JSON.stringify(owners.data));
    assert.ok(owners.data.owners.some(row=>row.id===peer.id));
    const draft = await preview();
    assert.equal(draft.status,201,JSON.stringify(draft.data));
    const id = draft.data.operationId;
    const results = await Promise.all([bot(`/operations/${id}/confirm`,{confirmed:true}),bot(`/operations/${id}/confirm`,{confirmed:true})]);
    for (const result of results) assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(results[0].data.receipt.task.id,results[1].data.receipt.task.id);
    const task = (await pool.query('SELECT * FROM tasks WHERE id=$1',[results[0].data.receipt.task.id])).rows[0];
    assert.equal(task.owner_user_id,peer.id);
    assert.equal(task.created_by_user_id,owner.id);
    assert.equal(task.created_by,owner.username);
    assert.equal(task.business_context,'event_genix');
    assert.equal(task.source_module,'telegram_crm');
    assert.equal(task.control_meta.operationId,id);
    assert.equal((await pool.query('SELECT 1 FROM notification_outbox WHERE task_id=$1', [task.id])).rowCount, 0);
    const leaseId = randomUUID();
    const claimed = await notifications('/claim', { leaseId });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
    const { event } = claimed.data;
    assert.equal(event.taskId, task.id);
    assert.equal(event.task.id, task.id);
    assert.equal(event.task.title, task.title);
    assert.equal(event.task.description, task.description || null);
    assert.equal(event.telegramId, peerTelegram);
    assert.equal(event.bindingVersion, '2');
    assert.deepEqual((await notifications('/claim', { leaseId })).data.event, event);
    assert.equal((await notifications('/claim', { leaseId: randomUUID() })).data.event, null);
    const accepted = { leaseId, status: 'sent', messageId: 123456 };
    for (let i = 0; i < 2; i++) {
        assert.equal((await notifications(`/${event.id}/result`, accepted)).data.status, 'sent');
    }
    const delivery = (await pool.query('SELECT status, telegram_message_id FROM telegram_crm_assignment_outbox WHERE id=$1', [event.id])).rows[0];
    assert.deepEqual(delivery, { status: 'sent', telegram_message_id: '123456' });
    const mine = await bot('/tasks?businessContext=event_genix');
    assert.equal(mine.status,200,JSON.stringify(mine.data));
    assert.deepEqual(mine.data.tasks.find(row=>row.id===task.id).viewerRoles,['author']);
    const peers = await bot('/tasks?businessContext=event_genix',undefined,peerTelegram);
    assert.equal(peers.status,200,JSON.stringify(peers.data));
    assert.deepEqual(peers.data.tasks.find(row=>row.id===task.id).viewerRoles,['executor']);
    const recovered = await bot(`/operations/${id}`);
    assert.equal(recovered.data.receipt.task.id,task.id);
});

check('four confirmed participants can create for every peer with current business and identity checks', async () => {
    const participants = [];
    for (let index = 0; index < 4; index++) {
        const username = 'tg.fixture.' + randomUUID();
        const password = 'isolated-assignment-fixture-password';
        const user = (await pool.query(`INSERT INTO users(username,name,role,password_hash,business_contexts,default_business_context)
            VALUES($1,'Assignment Fixture','animator',$2,ARRAY['event_genix'],'event_genix') RETURNING *`,
        [username, await bcrypt.hash(password, 4)])).rows[0];
        await pool.query(`INSERT INTO organization_memberships(organization_id,user_id,role)
            VALUES($1,$2,'member')`, [business.organization_id, user.id]);
        await pool.query(`INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default,action_allowlist)
            VALUES($1,$2,$3,'animator',true,ARRAY['tasks.create'])`, [business.id,business.organization_id,user.id]);
        const sender = String(randomInt(950000000000, 960000000000));
        await pool.query('INSERT INTO telegram_crm_bindings(user_id,pilot_enabled,proposed_telegram_id) VALUES($1,true,$2)', [user.id,sender]);
        const session = await request('POST','/api/auth/login',{ username,password });
        assert.equal(session.status,200);
        const link = await request('POST','/api/auth/telegram-crm/link',{},session.data.token);
        assert.equal(link.status,201);
        const start = new URL(link.data.url).searchParams.get('start').slice(4);
        assert.equal((await bot('/link/claim',{token:start},sender)).status,200);
        assert.equal((await request('POST','/api/auth/telegram-crm/link/confirm',link.data,session.data.token)).status,200);
        participants.push({ user, telegram:sender });
    }
    const original = (await pool.query('SELECT action_allowlist FROM business_memberships WHERE business_id=$1 AND user_id=$2',
        [business.id,peer.id])).rows[0].action_allowlist;
    await pool.query("UPDATE business_memberships SET action_allowlist=ARRAY['tasks.create'] WHERE business_id=$1 AND user_id=$2",
        [business.id,peer.id]);
    try {
        const expected = [...participants.map(person => person.user.id), owner.id, peer.id].sort((a,b) => a-b);
        for (const sender of participants) {
            const me = await bot('/me',undefined,sender.telegram);
            assert.equal(me.data.canCreateTasks,true);
            const list = await bot('/owners?businessContext=event_genix',undefined,sender.telegram);
            assert.equal(list.status,200,JSON.stringify(list.data));
            assert.deepEqual(list.data.owners.map(person=>person.id).sort((a,b)=>a-b),expected);
            for (const recipient of participants.filter(person=>person.user.id!==sender.user.id)) {
                const draft = await bot('/tasks/preview',{
                    title: 'Disposable peer assignment ' + randomUUID(), ownerUserId:recipient.user.id,
                    businessContext:'event_genix',sourceUpdateId:String(nextUpdate++)
                },sender.telegram);
                assert.equal(draft.status,201,JSON.stringify(draft.data));
                const committed = await bot(`/operations/${draft.data.operationId}/confirm`,{confirmed:true},sender.telegram);
                assert.equal(committed.status,200,JSON.stringify(committed.data));
                assert.equal(committed.data.receipt.task.ownerUserId,recipient.user.id);
                const claimed = (await notifications('/claim',{leaseId:randomUUID()})).data.event;
                assert.ok(claimed);
                assert.equal(claimed.taskId,committed.data.receipt.task.id);
                assert.equal(claimed.telegramId,recipient.telegram);
                assert.equal((await notifications(`/${claimed.id}/result`,{
                    leaseId:claimed.leaseId,status:'sent',messageId:100000+nextUpdate
                })).data.status,'sent');
            }
        }
        const { defaultActorContext } = require('../../services/telegramCrmTasks');
        const { listTaskOwnerCandidates } = require('../../services/taskExecution');
        const { actor,scope } = await defaultActorContext(peer,pool,'event_genix');
        assert.deepEqual((await listTaskOwnerCandidates({pool,actor,businessScope:scope})).map(person=>person.id),[peer.id]);
        const outsider = participants[2];
        await pool.query('UPDATE business_memberships SET is_active=false WHERE business_id=$1 AND user_id=$2',[business.id,outsider.user.id]);
        const list = await bot('/owners?businessContext=event_genix',undefined,participants[0].telegram);
        assert.equal(list.data.owners.some(person=>person.id===outsider.user.id),false);
        const forbidden = await bot('/tasks/preview',{
            title:'Disposable unavailable peer',ownerUserId:outsider.user.id,businessContext:'event_genix',sourceUpdateId:String(nextUpdate++)
        },participants[0].telegram);
        assert.equal(forbidden.status,400,JSON.stringify(forbidden.data));
        await pool.query('UPDATE business_memberships SET is_active=true WHERE business_id=$1 AND user_id=$2',[business.id,outsider.user.id]);
        await pool.query('UPDATE telegram_crm_bindings SET verified_at=NULL,telegram_user_id=NULL,version=version+1 WHERE user_id=$1',[outsider.user.id]);
        const revoked = await bot('/owners?businessContext=event_genix',undefined,participants[0].telegram);
        assert.equal(revoked.data.owners.some(person=>person.id===outsider.user.id),false);
        const stale = await bot('/tasks/preview',{
            title:'Disposable revoked peer',ownerUserId:outsider.user.id,businessContext:'event_genix',sourceUpdateId:String(nextUpdate++)
        },participants[0].telegram);
        assert.equal(stale.status,400,JSON.stringify(stale.data));
    } finally {
        await pool.query('UPDATE business_memberships SET action_allowlist=$3::text[] WHERE business_id=$1 AND user_id=$2',
            [business.id,peer.id,original]);
    }
});

check('CRM task writes persist a distinct assignment on A to B to A, retry and cancel stale work', async () => {
    const payload = { title: 'Disposable CRM notification fixture', businessContext: 'event_genix' };
    const create = await request('POST', '/api/tasks', { ...payload, ownerUserId: peer.id }, jwt);
    assert.ok([200, 201].includes(create.status), JSON.stringify(create.data));
    const taskId = create.data.task.id;
    const events = async () => (await pool.query(
        'SELECT id, owner_user_id, status, attempts, reason FROM telegram_crm_assignment_outbox WHERE task_id=$1 ORDER BY id',
        [taskId]
    )).rows;
    assert.deepEqual((await events()).map(row => row.owner_user_id), [peer.id]);
    for (const ownerUserId of [owner.id, peer.id]) {
        const update = await request('PUT', `/api/tasks/${taskId}`, { ...payload, ownerUserId }, jwt);
        assert.equal(update.status, 200, JSON.stringify(update.data));
    }
    assert.deepEqual((await events()).map(row => [row.owner_user_id, row.status]), [
        [peer.id, 'cancelled'], [owner.id, 'cancelled'], [peer.id, 'pending']
    ]);
    const start = async () => {
        const claimed = await notifications('/claim', { leaseId: randomUUID() });
        assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
        return claimed.data;
    };
    const { event } = await start();
    assert.equal(event.taskId, taskId);
    assert.equal(event.telegramId, peerTelegram);
    assert.equal((await notifications(`/${event.id}/result`, {
        status: 'retry', reason: 'rate_limited', retryAfterSeconds: 1, leaseId: event.leaseId
    })).data.status, 'retry');
    assert.equal((await start()).event, null);
    await pool.query('UPDATE telegram_crm_assignment_outbox SET available_at=NOW() WHERE id=$1', [event.id]);
    const { event: retry } = await start();
    assert.equal(retry.id, event.id);
    assert.notEqual(retry.leaseId, event.leaseId);
    assert.equal((await notifications(`/${retry.id}/result`, {
        status: 'uncertain', reason: 'telegram_result_unknown', leaseId: retry.leaseId
    })).data.status, 'uncertain');
    assert.equal((await start()).event, null);
    assert.deepEqual((await events()).at(-1), {
        id: retry.id, owner_user_id: peer.id, status: 'uncertain', attempts: 2, reason: 'telegram_result_unknown'
    });
    const another = await request('POST', '/api/tasks', { ...payload, title: payload.title + ' completed', ownerUserId: peer.id }, jwt);
    assert.ok([200, 201].includes(another.status), JSON.stringify(another.data));
    const completed = await request('PUT', `/api/tasks/${another.data.task.id}`, { ...payload, ownerUserId: peer.id, status: 'done' }, jwt);
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    assert.equal((await start()).processed, true);
    const result = (await pool.query('SELECT status, reason FROM telegram_crm_assignment_outbox WHERE task_id=$1',
        [another.data.task.id])).rows[0];
    assert.deepEqual(result, { status: 'cancelled', reason: 'assignment_inactive' });
});

test('confirmed arbitrary recipient receives a CRM assignment through the actual Python worker, with restart after CRM acknowledgement loss', {
    skip: !enabled || !process.env.NOTIFICATION_E2E_PYTHON
}, async () => {
    const newTelegram = String(randomInt(940000000000, 950000000000));
    const title = 'Disposable notification lifecycle';
    const login = await request('POST', '/api/auth/login', {
        username: peer.username, password: 'fixture-only-peer-password'
    });
    assert.equal(login.status, 200);
    const token = login.data.token;
    const invalidated = await request('POST', '/api/tasks',
        { title: title + ' old binding', ownerUserId: peer.id, businessContext: 'event_genix' }, jwt);
    assert.ok([200, 201].includes(invalidated.status), JSON.stringify(invalidated.data));
    const replace = await request('POST', '/api/auth/telegram-crm/link', { password: 'fixture-only-peer-password' }, token);
    assert.equal(replace.status, 201);
    const start = new URL(replace.data.url).searchParams.get('start').slice(4);
    assert.equal((await bot('/link/claim', { token: start }, newTelegram)).status, 200);
    assert.equal((await request('POST', '/api/auth/telegram-crm/link/confirm', replace.data, token)).status, 200);
    const task = await request('POST', '/api/tasks', {
        title, date: '2099-11-05', ownerUserId: peer.id, businessContext: 'event_genix'
    }, jwt);
    assert.ok([200, 201].includes(task.status), JSON.stringify(task.data));
    const id = task.data.task.id;
    const { stdout } = await promisify(execFile)(process.env.NOTIFICATION_E2E_PYTHON, [
        join(__dirname, '../fixtures/telegram-crm-notification-probe.py'), BASE_URL, String(peer.id), newTelegram, String(id)
    ]);
    assert.deepEqual(JSON.parse(stdout.trim()), {
        sent: 1, messageId: 50001, restarted: true, morningWithTasks: true, emptyMorningSilent: true
    });
    const { rows } = await pool.query(`SELECT task_id, status, reason, telegram_message_id
        FROM telegram_crm_assignment_outbox WHERE task_id=ANY($1::int[]) ORDER BY id`,
    [[invalidated.data.task.id, id]]);
    assert.deepEqual(rows, [
        { task_id: invalidated.data.task.id, status: 'cancelled', reason: 'binding_unavailable', telegram_message_id: null },
        { task_id: id, status: 'sent', reason: null, telegram_message_id: '50001' }
    ]);
    peerTelegram = newTelegram;
});

check('Telegram personal creation stays self-only and team tasks remain team-visible', async () => {
    const draft = (taskMode, ownerUserId) => bot('/tasks/preview', {
        title: 'Disposable visibility fixture ' + taskMode, ownerUserId, taskMode,
        businessContext: 'event_genix', sourceUpdateId: String(nextUpdate++)
    });
    const rejected = await draft('personal', peer.id);
    assert.equal(rejected.data.code, 'TELEGRAM_PERSONAL_TASK_SELF_ONLY');
    // The pilot animator has own-task scope. A director is a stronger privacy
    // check: working tasks are visible, but the personal task must stay hidden.
    const username = 'telegram.fixture.director';
    const password = 'fixture-only-director-password';
    const viewer = (await pool.query(`INSERT INTO users(username,name,role,password_hash,business_contexts,default_business_context)
        VALUES ($1,'Fixture Director','director',$2,ARRAY['event_genix'],'event_genix') RETURNING id`,
    [username, await bcrypt.hash(password, 4)])).rows[0];
    await pool.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",
        [business.organization_id, viewer.id]);
    await pool.query("INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default) VALUES($1,$2,$3,'director',true)",
        [business.id, business.organization_id, viewer.id]);
    const peerSession = await request('POST', '/api/auth/login', {
        username, password
    });
    assert.equal(peerSession.status, 200, JSON.stringify(peerSession.data));
    for (const [taskMode, visibility] of [['personal', 'me_only'], ['work', 'team']]) {
        const preview = await draft(taskMode, owner.id);
        assert.equal(preview.status, 201, JSON.stringify(preview.data));
        assert.equal(preview.data.draft.taskMode, taskMode);
        const result = await bot(`/operations/${preview.data.operationId}/confirm`, {confirmed:true});
        assert.equal(result.status, 200, JSON.stringify(result.data));
        const id = result.data.receipt.task.id;
        const { rows: [stored] } = await pool.query('SELECT visibility, task_mode FROM tasks WHERE id=$1',[id]);
        assert.deepEqual(stored, { visibility, task_mode: taskMode });
        const ownerView = await request('GET', `/api/tasks/${id}?businessContext=event_genix`, undefined, jwt);
        assert.equal(ownerView.status, 200);
        const peerView = await request('GET', `/api/tasks/${id}?businessContext=event_genix`, undefined, peerSession.data.token);
        assert.equal(peerView.status, taskMode === 'work' ? 200 : 404, JSON.stringify(peerView.data));
    }
});

check('date-focused bot list matches My Day dates, snoozing and paginated personal scope', async () => {
    const today = (await pool.query("SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date::text AS day")).rows[0].day;
    const ids = [];
    for (let index = 0; index < 7; index++) {
        const row = (await pool.query(`INSERT INTO tasks(title,owner_user_id,created_by_user_id,created_by,business_context,date,status,visibility)
            VALUES($1,$2,$2,$3,'event_genix',$4,'todo','team') RETURNING id`,
        ['Disposable day task '+index,owner.id,owner.username,today])).rows[0];
        ids.push(row.id);
    }
    // Scheduling overrides stale legacy dates; future snoozes are not actionable.
    await pool.query("UPDATE tasks SET date='2026-03-27',scheduled_start_at=($2::date+TIME '12:00') AT TIME ZONE 'Europe/Kyiv' WHERE id=$1",[ids[0],today]);
    await pool.query("UPDATE tasks SET snoozed_until=NOW()+INTERVAL '1 hour' WHERE id=$1",[ids[6]]);
    const path = `/tasks?businessContext=event_genix&view=day&dateFrom=${today}&dateTo=${today}&limit=5`;
    const first = await bot(path);
    assert.equal(first.status,200,JSON.stringify(first.data));
    assert.equal(first.data.pagination.hasMore,true);
    const second = await bot(path+'&offset='+first.data.pagination.nextOffset);
    const listed = [...first.data.tasks,...second.data.tasks];
    assert.equal(new Set(listed.map(t=>t.id)).size,listed.length);
    assert.deepEqual(listed.map(t=>t.id).sort((a,b)=>a-b),ids.slice(0,6).sort((a,b)=>a-b));
    assert.ok(listed.every(t=>t.workDate===today));
    const cabinet = await request('GET','/api/tasks/my-cabinet?businessContext=event_genix',undefined,jwt);
    assert.equal(cabinet.status,200,JSON.stringify(cabinet.data));
    assert.deepEqual(cabinet.data.planning.today.map(t=>t.id).sort((a,b)=>a-b),listed.map(t=>t.id).sort((a,b)=>a-b));
    assert.equal((await bot(path,undefined,peerTelegram)).data.tasks.length,0);
});

check('Telegram changes use canonical task history and reject stale, foreign or repeated writes', async () => {
    const createdDraft = await preview('Disposable Telegram change task');
    const created = await bot(`/operations/${createdDraft.data.operationId}/confirm`, { confirmed: true });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const taskId = created.data.receipt.task.id;
    const change = async (action, extra = {}, sender = telegram) => bot('/tasks/preview', {
        taskId, action, businessContext: 'event_genix', sourceUpdateId: String(nextUpdate++), ...extra
    }, sender);
    const confirm = operationId => bot(`/operations/${operationId}/confirm`, { confirmed: true });

    const stale = await change('reschedule', { date: '2027-02-10' });
    assert.equal(stale.status, 201, JSON.stringify(stale.data));
    await pool.query('UPDATE tasks SET version=COALESCE(version,1)+1 WHERE id=$1', [taskId]);
    assert.equal((await confirm(stale.data.operationId)).data.code, 'TASK_STALE_WRITE');

    const move = await change('reschedule', { date: '2027-02-11' });
    assert.equal(move.status, 201, JSON.stringify(move.data));
    const moved = await Promise.all([confirm(move.data.operationId), confirm(move.data.operationId)]);
    for (const result of moved) {
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(result.data.receipt.changeAction, 'reschedule');
    }
    assert.equal(moved.filter(result => result.data.replay).length, 1);
    assert.equal((await pool.query('SELECT date::text AS date FROM tasks WHERE id=$1', [taskId])).rows[0].date, '2027-02-11');

    await pool.query("UPDATE business_memberships SET action_denylist=ARRAY['tasks.create'] WHERE business_id=$1 AND user_id=$2",
        [business.id,owner.id]);
    try {
        const handoff = await change('reassign', { ownerUserId: owner.id });
        assert.equal(handoff.status, 201, JSON.stringify(handoff.data));
        const confirmed = await confirm(handoff.data.operationId);
        assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    } finally {
        await pool.query("UPDATE business_memberships SET action_denylist='{}' WHERE business_id=$1 AND user_id=$2",
            [business.id,owner.id]);
    }
    assert.equal((await pool.query('SELECT owner_user_id FROM tasks WHERE id=$1', [taskId])).rows[0].owner_user_id, owner.id);
    assert.equal((await change('complete', {}, peerTelegram)).status, 404);

    const done = await change('complete');
    assert.equal(done.status, 201, JSON.stringify(done.data));
    assert.equal((await confirm(done.data.operationId)).data.receipt.changeAction, 'complete');
    assert.equal((await pool.query('SELECT status FROM tasks WHERE id=$1', [taskId])).rows[0].status, 'done');
});

check('normal CRM deletion retains its committed receipt and never recreates the task', async () => {
    const draft = await preview('Disposable deleted Telegram task');
    assert.equal(draft.status,201,JSON.stringify(draft.data));
    const id = draft.data.operationId;
    const created = await bot(`/operations/${id}/confirm`,{confirmed:true});
    assert.equal(created.status,200,JSON.stringify(created.data));
    const taskId = created.data.receipt.task.id;
    const deleted = await request('DELETE',`/api/tasks/${taskId}?businessContext=event_genix`,undefined,jwt);
    assert.equal(deleted.status,200,JSON.stringify(deleted.data));
    const stored = (await pool.query('SELECT state,task_id,receipt FROM telegram_crm_task_operations WHERE id=$1',[id])).rows[0];
    assert.equal(stored.state,'committed');
    assert.equal(stored.task_id,null);
    assert.equal(stored.receipt.task.id,taskId);
    assert.equal((await bot(`/operations/${id}/confirm`,{confirmed:true})).status,403);
    assert.equal((await bot(`/operations/${id}`)).status,403);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM tasks WHERE id=$1',[taskId])).rows[0].count,0);
});

check('current membership revocation and human role changes deny writes, including prepared drafts', async () => {
    const peerAttempt = await bot('/tasks/preview',{title:'Denied peer write',ownerUserId:owner.id,businessContext:'event_genix',sourceUpdateId:String(nextUpdate++)},peerTelegram);
    assert.equal(peerAttempt.status,403,JSON.stringify(peerAttempt.data));
    const draft = await preview('Disposable revoked membership task');
    assert.equal(draft.status,201,JSON.stringify(draft.data));
    await pool.query("UPDATE business_memberships SET role='animator' WHERE business_id=$1 AND user_id=$2",[business.id,owner.id]);
    assert.equal((await bot(`/operations/${draft.data.operationId}/confirm`,{confirmed:true})).status,403);
    await pool.query("UPDATE business_memberships SET role='creator',is_active=false WHERE business_id=$1 AND user_id=$2",[business.id,owner.id]);
    assert.equal((await bot('/tasks?businessContext=event_genix')).status,403);
    await pool.query('UPDATE business_memberships SET is_active=true WHERE business_id=$1 AND user_id=$2',[business.id,owner.id]);
});

check('trusted update time prevents delayed requests from crossing a new identity binding', async () => {
    const stale = await bot('/tasks', undefined, telegram, {'x-telegram-event-at':'1700000000'});
    assert.equal(stale.status,403);
    const draft = await preview('Disposable stale generation task');
    assert.equal(draft.status,201,JSON.stringify(draft.data));
    const created = await request('POST', '/api/tasks', {
        title: 'Disposable assigned task before disconnect', ownerUserId: owner.id, businessContext: 'event_genix'
    }, jwt);
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const taskId = created.data.task.id;
    const priority = await pool.query(`UPDATE telegram_crm_assignment_outbox
        SET available_at='epoch' WHERE task_id=$1 AND status='pending'`, [taskId]);
    assert.equal(priority.rowCount, 1);
    assert.equal((await request('POST','/api/auth/telegram-crm/disconnect',{password:process.env.TEST_PASS},jwt)).status,200);
    assert.equal((await notifications('/recipients')).data.recipients.some(row => row.userId === owner.id), false);
    const next = await notifications('/claim', { leaseId: randomUUID() });
    assert.deepEqual(next.data, { success: true, event: null, processed: true });
    const event = (await pool.query('SELECT status, reason FROM telegram_crm_assignment_outbox WHERE task_id=$1', [taskId])).rows[0];
    assert.deepEqual(event, { status: 'cancelled', reason: 'binding_unavailable' });
    assert.equal((await bot(`/operations/${draft.data.operationId}/confirm`,{confirmed:true})).status,403);
    assert.equal((await bot('/tasks')).status,403);
});

check('bounded pilot seeding is repeatable, unverified and preserves notification destinations', async () => {
    const client=await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM telegram_crm_settings');
        for(const person of PILOT) {
            await client.query(`INSERT INTO users(id,username,name,role,password_hash,telegram_chat_id,is_active)
                VALUES($1,$2,$3,'animator','fixture','999999999',true) ON CONFLICT(id) DO UPDATE
                SET username=excluded.username,name=excluded.name,is_active=true,telegram_chat_id=excluded.telegram_chat_id`,[person.id,person.username,person.name]);
            await client.query(`INSERT INTO telegram_crm_bindings(user_id) VALUES($1) ON CONFLICT(user_id)
                DO UPDATE SET proposed_telegram_id=NULL,telegram_user_id=NULL,verified_at=NULL`,[person.id]);
        }
        for(let attempt=0;attempt<2;attempt++) {
            const result=await applyPilot(client,{action:'seed',botUsername:'FixtureCrmBot'});
            assert.equal(result.configuration.mode,'off');
            assert.equal(result.bindings.length,3);
            assert.ok(result.bindings.every(row=>row.pilot_enabled && !row.verified_at && !row.telegram_user_id));
        }
        await assert.rejects(applyPilot(client,{action:'write'}),/Read-only rollout/);
        await applyPilot(client,{action:'read'});
        assert.equal((await applyPilot(client,{action:'write'})).configuration.mode,'write');
        assert.equal((await applyPilot(client,{action:'off'})).configuration.mode,'off');
        const notifications=await client.query('SELECT telegram_chat_id FROM users WHERE id=ANY($1::int[])',[PILOT.map(row=>row.id)]);
        assert.ok(notifications.rows.every(row=>String(row.telegram_chat_id)==='999999999'));
    } finally {await client.query('ROLLBACK');client.release();}
});

test('actual profile browser reconnects Telegram with password and explicit account confirmation', {skip:!enabled || !process.env.CRM_PILOT_BROWSER_MODULE}, async()=>{
    const { chromium }=require(process.env.CRM_PILOT_BROWSER_MODULE);
    const session=await request('POST','/api/auth/login',{username:process.env.TEST_USER,password:process.env.TEST_PASS});
    assert.equal(session.status,200);
    const browser=await chromium.launch({headless:true});
    try {
        const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
        await context.addInitScript(session=>{
            localStorage.setItem('pzp_token',session.token);
            localStorage.setItem('pzp_access_token',session.token);
            localStorage.setItem('pzp_current_user',JSON.stringify(session.user));
            localStorage.setItem('pzp_refresh_token',session.refreshToken);
            localStorage.setItem('pzp_crm_business_context','event_genix');
            localStorage.setItem('pzp_dark_mode','false');
        },session.data);
        await context.route('https://**/*',route=>route.abort());
        const page=await context.newPage();
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(BASE_URL+'/profile?tab=settings');
        await page.getByRole('button',{name:'Підключити Telegram',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Оновити стан',exact:true}).count(),0);
        await page.getByRole('button',{name:'Підключити Telegram',exact:true}).click();
        const password=page.getByLabel('Поточний пароль CRM (обов’язково)');
        assert.ok(await password.evaluate(input=>document.activeElement===input));
        await password.fill(process.env.TEST_PASS);
        await page.getByRole('button',{name:'Отримати посилання'}).click();
        const openTelegram=page.getByRole('link',{name:'Відкрити Telegram'});
        await openTelegram.waitFor();
        const link=new URL(await openTelegram.getAttribute('href'));
        assert.equal(link.origin,'https://t.me');
        const senderId='900000000003';
        const claim=await bot('/link/claim',{token:link.searchParams.get('start').slice(4)},senderId);
        assert.equal(claim.status,200);
        assert.equal((await bot('/me',undefined,senderId)).status,403);
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        const confirm=page.getByRole('button',{name:'Це мій Telegram — підключити',exact:true});
        await confirm.waitFor();
        await confirm.click();
        const openTasks=page.getByRole('link',{name:'Мої задачі в Telegram',exact:true});
        await openTasks.waitFor();
        const binding=await request('GET','/api/auth/telegram-crm',undefined,session.data.token);
        assert.equal(binding.status,200);
        assert.equal(binding.data.status,'connected');
        assert.equal(String(binding.data.telegramId),senderId);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.deepEqual(errors,[]);
    } finally {await browser.close();}
});

check('owner directory paginates more than 200 authorized confirmed participants', async () => {
    await pool.query(`UPDATE business_memberships SET action_allowlist=ARRAY['tasks.create']
        WHERE user_id=$1 AND business_id=$2`, [peer.id, business.id]);
    const fixture = await pool.query(`INSERT INTO users(username,name,role,password_hash,business_contexts,default_business_context)
        SELECT 'telegram.directory.'||n, 'Directory Fixture '||n, 'animator', 'fixture-disabled-login',
               ARRAY['event_genix'], 'event_genix' FROM generate_series(1,350) n RETURNING id`);
    const ids = fixture.rows.map(row => row.id);
    await pool.query(`INSERT INTO organization_memberships(organization_id,user_id,role)
        SELECT $1, id, 'member' FROM unnest($2::int[]) id`, [business.organization_id, ids]);
    await pool.query(`INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default)
        SELECT $1,$2,id,'animator',true FROM unnest($3::int[]) id`, [business.id,business.organization_id,ids]);
    await pool.query(`INSERT INTO telegram_crm_bindings(user_id,pilot_enabled,telegram_user_id,verified_at,version)
        SELECT id,true,950000000000::bigint+id,NOW(),2 FROM unnest($1::int[]) id`, [ids]);
    const found = [];
    let cursor = '0', pages = 0;
    do {
        const result = await bot('/owners?businessContext=event_genix&cursor='+cursor,undefined,peerTelegram);
        assert.equal(result.status,200,JSON.stringify(result.data));
        assert.ok(result.data.owners.length <= 200);
        found.push(...result.data.owners.map(row => row.id));
        cursor = result.data.pagination.nextCursor;
        pages++;
        assert.ok(pages <= 3);
    } while (cursor);
    assert.equal(pages,2);
    assert.equal(new Set(found).size,found.length);
    assert.ok(ids.every(id => found.includes(id)));
    for (const cursor of ['-1','abc','2147483648']) {
        assert.equal((await bot('/owners?businessContext=event_genix&cursor='+cursor,undefined,peerTelegram)).status,400);
    }
});
