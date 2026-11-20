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
let pool, jwt, owner, peer, business, voiceCreator, secondCo;
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
    const draft = await bot('/tasks/preview', {
        title: 'Disposable Telegram full-stack task', ownerUserId: peer.id, businessContext: 'event_genix',
        date: '2099-11-05', deadline: '2099-11-05T12:00:00.000Z', sourceUpdateId: String(nextUpdate++)
    });
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
    assert.equal(event.kind, 'assignment');
    assert.equal(event.task.creatorName, owner.name || owner.username);
    assert.equal(event.task.assignerName, owner.name || owner.username);
    assert.equal(event.task.deadline, '2099-11-05T12:00:00.000Z');
    assert.equal(event.telegramId, peerTelegram);
    assert.equal(event.bindingVersion, '2');
    assert.deepEqual((await notifications('/claim', { leaseId })).data.event, event);
    // Represent the canonical CRM calendar slot while the lease can still be retried.
    await pool.query(`UPDATE tasks SET schedule_status='scheduled',
        scheduled_start_at=$2, scheduled_end_at=$3 WHERE id=$1`,
    [task.id, '2099-11-05T09:15:00.000Z', '2099-11-05T10:15:00.000Z']);
    assert.equal((await notifications('/claim', { leaseId })).data.event.task.deadline, '2099-11-05T10:15:00.000Z');
    assert.equal((await notifications('/claim', { leaseId: randomUUID() })).data.event, null);
    const accepted = { leaseId, status: 'sent', messageId: 123456 };
    for (let i = 0; i < 2; i++) {
        assert.equal((await notifications(`/${event.id}/result`, accepted)).data.status, 'sent');
    }
    const delivery = (await pool.query('SELECT status, telegram_message_id FROM telegram_crm_delivery_outbox WHERE id=$1', [event.id])).rows[0];
    assert.deepEqual(delivery, { status: 'sent', telegram_message_id: '123456' });
    const diagnostic = await bot(`/tasks?notificationTaskId=${task.id}&businessContext=event_genix`, undefined, peerTelegram);
    assert.equal(diagnostic.status, 200, JSON.stringify(diagnostic.data));
    assert.deepEqual(diagnostic.data, { success: true, taskId: task.id, status: 'sent' });
    assert.equal((await bot(`/tasks?notificationTaskId=${task.id}`, undefined, '917000000000')).status, 403);
    const mine = await bot('/tasks?businessContext=event_genix');
    assert.equal(mine.status,200,JSON.stringify(mine.data));
    assert.deepEqual(mine.data.tasks.find(row=>row.id===task.id).viewerRoles,['author']);
    const peers = await bot('/tasks?businessContext=event_genix',undefined,peerTelegram);
    assert.equal(peers.status,200,JSON.stringify(peers.data));
    assert.deepEqual(peers.data.tasks.find(row=>row.id===task.id).viewerRoles,['executor']);
    const recovered = await bot(`/operations/${id}`);
    assert.equal(recovered.data.receipt.task.id,task.id);
    const completion = await bot('/tasks/preview', { taskId: task.id, action: 'complete',
        businessContext: 'event_genix', sourceUpdateId: String(nextUpdate++) }, peerTelegram);
    assert.equal(completion.status, 201, JSON.stringify(completion.data));
    const done = await bot(`/operations/${completion.data.operationId}/confirm`, { confirmed: true }, peerTelegram);
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const inbox = await request('GET', '/api/tasks/control-completions?businessContext=event_genix', undefined, jwt);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.data.alerts.filter(alert => alert.eventKey.startsWith(`${task.id}:`)).length, 1);
    const oldWorker = await notifications('/claim', { leaseId: randomUUID() });
    assert.equal(oldWorker.data.event, null, 'old workers must not claim completion events');
    const completedLease = randomUUID();
    const completionNotice = (await notifications('/claim', {
        leaseId: completedLease, completionEvents: true
    })).data.event;
    assert.equal(completionNotice.kind, 'completion');
    assert.equal(completionNotice.taskId, task.id);
    assert.equal(completionNotice.telegramId, telegram);
    assert.equal(completionNotice.task.executorName, peer.name);
    assert.deepEqual((await notifications('/claim', {
        leaseId: completedLease, completionEvents: true
    })).data.event, completionNotice);
    assert.equal((await notifications(`/${completionNotice.id}/result`, {
        leaseId: completedLease, status: 'sent', messageId: 123457
    })).data.status, 'sent');
    // A reopened task must not generate a stale completion, and rolled-back
    // writes must not leave an event behind.
    await pool.query("UPDATE tasks SET status='todo', completed_at=NULL WHERE id=$1", [task.id]);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("UPDATE tasks SET status='done', completed_at=NOW() AT TIME ZONE 'UTC' WHERE id=$1", [task.id]);
        await client.query('ROLLBACK');
    } finally { client.release(); }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM telegram_crm_delivery_outbox WHERE task_id=$1 AND event_kind='completion'", [task.id])).rows[0].n, 1);
    await pool.query("UPDATE tasks SET status='done', completed_at=NOW() AT TIME ZONE 'UTC' WHERE id=$1", [task.id]);
    await pool.query("UPDATE tasks SET status='todo', completed_at=NULL WHERE id=$1", [task.id]);
    assert.equal((await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.processed, true);
    assert.equal((await pool.query("SELECT reason FROM telegram_crm_delivery_outbox WHERE task_id=$1 AND event_kind='completion' ORDER BY id DESC LIMIT 1", [task.id])).rows[0].reason, 'completion_inactive');
});

check('reassignment identifies the actor rather than the original task author', async () => {
    const payload = { title: 'Disposable reassignment actor', businessContext: 'event_genix' };
    const created = await request('POST', '/api/tasks', { ...payload, ownerUserId: owner.id }, jwt);
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const taskId = created.data.task.id;
    // Model an existing task whose author is a different confirmed person.
    await pool.query('UPDATE tasks SET created_by_user_id=$2, created_by=$3 WHERE id=$1', [taskId, peer.id, peer.username]);
    const direct = await request('PUT', `/api/tasks/${taskId}`, { ...payload, ownerUserId: peer.id }, jwt);
    assert.equal(direct.status, 200, JSON.stringify(direct.data));
    const directEvent = (await notifications('/claim', { leaseId: randomUUID() })).data.event;
    assert.equal(directEvent.taskId, taskId);
    assert.equal(directEvent.task.creatorName, peer.name);
    assert.equal(directEvent.task.assignerName, owner.name || owner.username);
    assert.equal((await notifications(`/${directEvent.id}/result`, {
        leaseId: directEvent.leaseId, status: 'sent', messageId: 123458
    })).data.status, 'sent');
    const canonical = await request('POST', `/api/tasks/${taskId}/reassign`, { ownerUserId: owner.id }, jwt);
    assert.equal(canonical.status, 200, JSON.stringify(canonical.data));
    const canonicalEvent = (await notifications('/claim', { leaseId: randomUUID() })).data.event;
    assert.equal(canonicalEvent.taskId, taskId);
    assert.equal(canonicalEvent.task.assignerName, owner.name || owner.username);
    assert.equal((await notifications(`/${canonicalEvent.id}/result`, {
        leaseId: canonicalEvent.leaseId, status: 'sent', messageId: 123459
    })).data.status, 'sent');
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
        participants.push({ user, telegram:sender, token:session.data.token, password });
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
        const disconnected = await request('POST', '/api/auth/telegram-crm/disconnect',
            { password: outsider.password }, outsider.token);
        assert.equal(disconnected.status, 200, JSON.stringify(disconnected.data));
        assert.equal((await bot('/me', undefined, outsider.telegram)).status, 403);
        assert.equal((await notifications('/recipients')).data.recipients.some(person => person.userId === outsider.user.id), false);
        const revoked = await bot('/owners?businessContext=event_genix',undefined,participants[0].telegram);
        assert.equal(revoked.data.owners.some(person=>person.id===outsider.user.id),true);
        const assignToPeer = title => bot('/tasks/preview', {
            title, ownerUserId: outsider.user.id, businessContext: 'event_genix', sourceUpdateId: String(nextUpdate++)
        }, participants[0].telegram);
        const confirmPeer = draft => bot(`/operations/${draft.data.operationId}/confirm`,
            { confirmed: true }, participants[0].telegram);
        const withoutTelegram = await assignToPeer('Disposable assignment without Telegram');
        assert.equal(withoutTelegram.status, 201, JSON.stringify(withoutTelegram.data));
        const assigned = await confirmPeer(withoutTelegram);
        assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
        const unlinkedTask = assigned.data.receipt.task.id;
        assert.equal(assigned.data.receipt.task.ownerUserId, outsider.user.id);
        assert.equal((await request('GET', `/api/tasks/${unlinkedTask}?businessContext=event_genix`,
            undefined, outsider.token)).status, 200);
        assert.equal((await bot(`/tasks?notificationTaskId=${unlinkedTask}&businessContext=event_genix`,
            undefined, participants[0].telegram)).data.status, 'binding_unavailable');
        const expectNoHistoricalEvent = async () => {
            const { rowCount } = await pool.query('SELECT 1 FROM telegram_crm_delivery_outbox WHERE task_id=$1', [unlinkedTask]);
            assert.equal(rowCount, 0);
        };
        await expectNoHistoricalEvent();

        const pending = await assignToPeer('Disposable draft before pilot access removal');
        assert.equal(pending.status, 201, JSON.stringify(pending.data));
        await pool.query('UPDATE telegram_crm_bindings SET pilot_enabled=false WHERE user_id=$1', [outsider.user.id]);
        assert.equal((await confirmPeer(pending)).data.code, 'TELEGRAM_OWNER_OUTSIDE_PILOT');
        const excluded = await bot('/owners?businessContext=event_genix', undefined, participants[0].telegram);
        assert.equal(excluded.data.owners.some(person => person.id === outsider.user.id), false);
        const stale = await bot('/tasks/preview',{
            title:'Disposable excluded pilot peer',ownerUserId:outsider.user.id,businessContext:'event_genix',sourceUpdateId:String(nextUpdate++)
        },participants[0].telegram);
        assert.equal(stale.data.code, 'TELEGRAM_OWNER_OUTSIDE_PILOT');
        await pool.query('UPDATE telegram_crm_bindings SET pilot_enabled=true WHERE user_id=$1', [outsider.user.id]);

        const newTelegram = String(randomInt(960000000000, 970000000000));
        const relink = await request('POST', '/api/auth/telegram-crm/link',
            { password: outsider.password }, outsider.token);
        assert.equal(relink.status, 201, JSON.stringify(relink.data));
        const token = new URL(relink.data.url).searchParams.get('start').slice(4);
        assert.equal((await bot('/link/claim', { token }, newTelegram)).status, 200);
        assert.equal((await request('POST', '/api/auth/telegram-crm/link/confirm', relink.data, outsider.token)).status, 200);
        await expectNoHistoricalEvent();
        const next = await assignToPeer('Disposable assignment after Telegram confirmation');
        assert.equal(next.status, 201, JSON.stringify(next.data));
        const afterRelink = await confirmPeer(next);
        assert.equal(afterRelink.status, 200, JSON.stringify(afterRelink.data));
        const event = (await notifications('/claim', { leaseId: randomUUID() })).data.event;
        assert.equal(event.taskId, afterRelink.data.receipt.task.id);
        assert.equal(event.telegramId, newTelegram);
        assert.equal((await notifications(`/${event.id}/result`, {
            leaseId: event.leaseId, status: 'sent', messageId: 100000 + nextUpdate
        })).data.status, 'sent');
    } finally {
        await pool.query('UPDATE business_memberships SET action_allowlist=$3::text[] WHERE business_id=$1 AND user_id=$2',
            [business.id,peer.id,original]);
    }
    voiceCreator = participants[1];
    secondCo = participants[3];
});

check('co-assignees receive assignments and the author sees the person who completed the task', async () => {
    const created = await request('POST', '/api/tasks', {
        title: 'Disposable co-assignee notification', businessContext: 'event_genix', ownerUserId: peer.id
    }, jwt);
    assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
    const taskId = created.data.task.id;
    const added = await request('PUT', `/api/tasks/${taskId}/co-assignees`, {
        userIds: [voiceCreator.user.id, secondCo.user.id], businessContext: 'event_genix'
    }, jwt);
    assert.equal(added.status, 200, JSON.stringify(added.data));
    // The 419 API reads this relation without an event-kind predicate.
    const legacyRows = await pool.query(`SELECT id, owner_user_id FROM telegram_crm_assignment_outbox
        WHERE task_id=$1 ORDER BY id FOR UPDATE SKIP LOCKED`, [taskId]);
    assert.deepEqual(legacyRows.rows.map(row => row.owner_user_id), [peer.id]);
    assert.equal((await request('PUT', `/api/tasks/${taskId}/co-assignees`, {
        userIds: [voiceCreator.user.id, secondCo.user.id], businessContext: 'event_genix'
    }, jwt)).status, 200);
    const notificationStatus = async sender => (await bot(
        `/tasks?notificationTaskId=${taskId}&businessContext=event_genix`, undefined, sender
    )).data.status;
    assert.equal(await notificationStatus(voiceCreator.telegram), 'pending');
    const destinations = [];
    for (let index = 0; index < 3; index++) {
        const event = (await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.event;
        assert.equal(event.taskId, taskId);
        assert.equal(event.kind, 'assignment');
        destinations.push(event.telegramId);
        assert.equal(event.task.assignerName, owner.name || owner.username);
        assert.equal((await notifications(`/${event.id}/result`, {
            leaseId: event.leaseId,
            ...(event.telegramId === secondCo.telegram
                ? { status: 'blocked', reason: 'bot_blocked' }
                : { status: 'sent', messageId: 500000 + nextUpdate++ })
        })).data.status, event.telegramId === secondCo.telegram ? 'blocked' : 'sent');
    }
    assert.deepEqual(destinations.sort(), [peerTelegram, voiceCreator.telegram, secondCo.telegram].sort());
    assert.equal(await notificationStatus(peerTelegram), 'sent');
    assert.equal(await notificationStatus(voiceCreator.telegram), 'sent');
    assert.equal(await notificationStatus(secondCo.telegram), 'blocked');
    assert.equal((await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.event, null);

    const command = { taskId, businessContext: 'event_genix' };
    const previewAction = (action, sender, fields = {}) => bot('/tasks/preview', {
        ...command, action, ...fields, sourceUpdateId: String(nextUpdate++)
    }, sender);
    assert.equal((await previewAction('reschedule', voiceCreator.telegram, { date: '2099-12-14' })).status, 403);
    assert.equal((await previewAction('reassign', voiceCreator.telegram, { ownerUserId: secondCo.user.id })).status, 403);
    assert.equal((await previewAction('complete', voiceCreator.telegram, { businessContext: 'dar' })).status, 403);
    assert.equal((await request('PUT', `/api/tasks/${taskId}`, { title: 'Forbidden fixture edit' }, voiceCreator.token)).status, 403);

    const staged = await previewAction('complete', voiceCreator.telegram);
    assert.equal(staged.status, 201, JSON.stringify(staged.data));
    assert.ok(staged.data.task.viewerRoles.includes('executor'));
    const confirms = await Promise.all(Array.from({ length: 2 }, () => bot(
        `/operations/${staged.data.operationId}/confirm`, { confirmed: true }, voiceCreator.telegram
    )));
    assert.deepEqual(confirms.map(reply => reply.status), [200, 200]);
    for (const reply of confirms) assert.deepEqual(reply.data.receipt, { changeAction: 'complete', taskId });
    assert.deepEqual(confirms.map(reply => reply.data.replay).sort(), [false, true]);
    assert.equal((await previewAction('complete', voiceCreator.telegram)).status, 409);
    const completed = await pool.query(`SELECT actor_user_id, source_surface FROM task_action_history
        WHERE task_id=$1 AND action_type='task_completed'`, [taskId]);
    assert.deepEqual(completed.rows, [{ actor_user_id: voiceCreator.user.id, source_surface: 'hermes' }]);
    const durable = await pool.query(`SELECT owner_user_id, status FROM tasks WHERE id=$1`, [taskId]);
    assert.deepEqual(durable.rows, [{ owner_user_id: peer.id, status: 'done' }]);
    assert.equal((await pool.query(`SELECT id FROM telegram_crm_assignment_outbox
        WHERE task_id=$1 AND status IN ('pending', 'retry')`, [taskId])).rowCount, 0);
    assert.equal((await pool.query(`SELECT id FROM telegram_crm_delivery_outbox
        WHERE task_id=$1 AND event_kind='completion'`, [taskId])).rowCount, 1);
    const report = (await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.event;
    assert.equal(report.kind, 'completion');
    assert.equal(report.taskId, taskId);
    assert.equal(report.telegramId, telegram);
    assert.equal(report.task.executorName, voiceCreator.user.name);
    assert.equal((await notifications(`/${report.id}/result`, {
        leaseId: report.leaseId, status: 'sent', messageId: 500000 + nextUpdate++
    })).data.status, 'sent');

    const another = await request('POST', '/api/tasks', {
        title: 'Disposable revoked co-assignee', businessContext: 'event_genix', ownerUserId: owner.id
    }, jwt);
    assert.ok([200, 201].includes(another.status), JSON.stringify(another.data));
    const anotherId = another.data.task.id;
    const primary = (await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.event;
    assert.equal(primary.taskId, anotherId);
    assert.equal((await notifications(`/${primary.id}/result`, {
        leaseId: primary.leaseId, status: 'sent', messageId: 500000 + nextUpdate++
    })).data.status, 'sent');
    assert.equal((await request('PUT', `/api/tasks/${anotherId}/co-assignees`, {
        userIds: [voiceCreator.user.id], businessContext: 'event_genix'
    }, jwt)).status, 200);
    const revocable = await previewAction('complete', voiceCreator.telegram, { taskId: anotherId });
    assert.equal(revocable.status, 201, JSON.stringify(revocable.data));
    assert.equal((await request('PUT', `/api/tasks/${anotherId}/co-assignees`, {
        userIds: [], businessContext: 'event_genix'
    }, jwt)).status, 200);
    assert.ok([403, 404].includes((await bot(`/operations/${revocable.data.operationId}/confirm`,
        { confirmed: true }, voiceCreator.telegram)).status));
    const revoked = await pool.query(`SELECT status, reason FROM telegram_crm_delivery_outbox
        WHERE task_id=$1 AND owner_user_id=$2 AND assignment_role='co'`, [anotherId, voiceCreator.user.id]);
    assert.deepEqual(revoked.rows, [{ status: 'cancelled', reason: 'assignment_changed' }]);
    assert.equal((await request('PUT', `/api/tasks/${anotherId}/co-assignees`, {
        userIds: [voiceCreator.user.id], businessContext: 'event_genix'
    }, jwt)).status, 200);
    const readded = (await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.event;
    assert.equal(readded.taskId, anotherId);
    assert.equal(readded.telegramId, voiceCreator.telegram);
    assert.equal((await notifications(`/${readded.id}/result`, {
        leaseId: readded.leaseId, status: 'sent', messageId: 500000 + nextUpdate++
    })).data.status, 'sent');
});

check('CRM task writes persist a distinct assignment on A to B to A, retry and cancel stale work', async () => {
    const payload = { title: 'Disposable CRM notification fixture', businessContext: 'event_genix' };
    const create = await request('POST', '/api/tasks', { ...payload, ownerUserId: peer.id }, jwt);
    assert.ok([200, 201].includes(create.status), JSON.stringify(create.data));
    const taskId = create.data.task.id;
    const events = async () => (await pool.query(
        'SELECT id, owner_user_id, status, attempts, reason FROM telegram_crm_delivery_outbox WHERE task_id=$1 ORDER BY id',
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
    await pool.query('UPDATE telegram_crm_delivery_outbox SET available_at=NOW() WHERE id=$1', [event.id]);
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
    const result = (await pool.query("SELECT status, reason FROM telegram_crm_delivery_outbox WHERE task_id=$1 AND event_kind='assignment'",
        [another.data.task.id])).rows[0];
    assert.deepEqual(result, { status: 'cancelled', reason: 'assignment_inactive' });

    // Finish this fixture's completion before starting the companion consumer's queue.
    const report = (await notifications('/claim', { leaseId: randomUUID(), completionEvents: true })).data.event;
    assert.equal(report.taskId, another.data.task.id);
    assert.equal(report.kind, 'completion');
    assert.equal((await notifications(`/${report.id}/result`, {
        leaseId: report.leaseId, status: 'sent', messageId: 500000 + nextUpdate++
    })).data.status, 'sent');
});

test('newly confirmed recipient receives CRM and bot voice assignments without another inbound message', {
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
    peerTelegram = newTelegram;
    const task = await request('POST', '/api/tasks', {
        title, date: '2099-11-05', deadline: '2099-11-05T08:00:00.000Z',
        ownerUserId: peer.id, businessContext: 'event_genix'
    }, jwt);
    assert.ok([200, 201].includes(task.status), JSON.stringify(task.data));
    const id = task.data.task.id;
    const { stdout } = await promisify(execFile)(process.env.NOTIFICATION_E2E_PYTHON, [
        join(__dirname, '../fixtures/telegram-crm-notification-probe.py'), BASE_URL, String(peer.id), newTelegram,
        String(id), voiceCreator.telegram
    ]);
    const { voiceTaskId, voiceMessageId, ...outcome } = JSON.parse(stdout.trim());
    assert.ok(Number.isSafeInteger(voiceTaskId) && voiceTaskId > 0 && voiceTaskId !== id);
    assert.ok(Number.isSafeInteger(voiceMessageId) && voiceMessageId > 0);
    assert.deepEqual(outcome, {
        sent: 1, messageId: 50001, restarted: true,
        deliveryCommandConfirmed: process.env.NOTIFICATION_E2E_EXPECT_DELIVERY_COMMAND !== '0',
        morningWithTasks: true, emptyMorningSilent: true
    });
    const { rows } = await pool.query(`SELECT task_id, status, reason, telegram_message_id
        FROM telegram_crm_delivery_outbox WHERE task_id=ANY($1::int[]) ORDER BY id`,
    [[invalidated.data.task.id, id, voiceTaskId]]);
    assert.deepEqual(rows, [
        { task_id: invalidated.data.task.id, status: 'cancelled', reason: 'binding_unavailable', telegram_message_id: null },
        { task_id: id, status: 'sent', reason: null, telegram_message_id: '50001' },
        { task_id: voiceTaskId, status: 'sent', reason: null, telegram_message_id: String(voiceMessageId) }
    ]);
    const voiceTasks = await pool.query(`SELECT id, source_module, owner_user_id, created_by_user_id
        FROM tasks WHERE title=$1`, ['Disposable voice assignment lifecycle']);
    assert.deepEqual(voiceTasks.rows, [{
        id: voiceTaskId, source_module: 'telegram_crm', owner_user_id: peer.id, created_by_user_id: voiceCreator.user.id
    }]);
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

check('undated My Day is additive and scoped to active visible executor and author tasks', async () => {
    const add = async (assignee, author, date, status, visibility, snoozedUntil = null) =>
        (await pool.query(`INSERT INTO tasks(title,owner_user_id,created_by_user_id,business_context,
            date,status,visibility,snoozed_until,suppress_initial_telegram_assignment)
            VALUES('Disposable undated My Day', $1,$2,'event_genix',$3,$4,$5,$6,true) RETURNING id`,
        [assignee, author, date, status, visibility, snoozedUntil])).rows[0].id;
    const execute = await add(peer.id, peer.id, null, 'todo', 'team');
    const control = await add(owner.id, peer.id, null, 'todo', 'team');
    const dated = await add(peer.id, peer.id, '2099-11-05', 'todo', 'team');
    const done = await add(peer.id, peer.id, null, 'done', 'team');
    const hidden = await add(owner.id, owner.id, null, 'todo', 'me_only');
    const snoozed = await add(peer.id, peer.id, null, 'todo', 'team', '2099-11-05T12:00:00Z');
    assert.equal((await bot('/me', undefined, peerTelegram)).data.taskViews.undated, true);
    const view = await bot('/tasks?businessContext=event_genix&view=undated&limit=20', undefined, peerTelegram);
    assert.equal(view.status, 200, JSON.stringify(view.data));
    const tasks = new Map(view.data.tasks.map(task => [task.id, task]));
    assert.deepEqual(tasks.get(execute).viewerRoles, ['executor', 'author']);
    assert.deepEqual(tasks.get(control).viewerRoles, ['author']);
    for (const id of [dated, done, hidden, snoozed]) assert.equal(tasks.has(id), false);
    assert.equal((await bot(`/tasks?notificationTaskId=${hidden}&businessContext=event_genix`, undefined, peerTelegram)).status, 404);
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
    const priority = await pool.query(`UPDATE telegram_crm_delivery_outbox
        SET available_at='epoch' WHERE task_id=$1 AND status='pending'`, [taskId]);
    assert.equal(priority.rowCount, 1);
    assert.equal((await request('POST','/api/auth/telegram-crm/disconnect',{password:process.env.TEST_PASS},jwt)).status,200);
    assert.equal((await notifications('/recipients')).data.recipients.some(row => row.userId === owner.id), false);
    const next = await notifications('/claim', { leaseId: randomUUID() });
    assert.deepEqual(next.data, { success: true, event: null, processed: true });
    const event = (await pool.query('SELECT status, reason FROM telegram_crm_delivery_outbox WHERE task_id=$1', [taskId])).rows[0];
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
