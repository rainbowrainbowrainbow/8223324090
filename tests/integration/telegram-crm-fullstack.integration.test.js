'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { BASE_URL, getToken, request } = require('../helpers');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { applyPilot, PILOT } = require('../../scripts/telegram-crm-pilot');
const enabled = process.env.RUN_TELEGRAM_CRM_FULLSTACK === 'true';
const check = (name, fn) => test(name, { skip: !enabled }, fn);
let pool, jwt, owner, peer, business;
const telegram = '900000000001';
const peerTelegram = '900000000002';
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

check('real JWT -> one-time Telegram claim -> same authenticated account confirmation', async () => {
    assert.equal((await bot('/me')).status,403);
    const started = await request('POST', '/api/auth/telegram-crm/link', { password: process.env.TEST_PASS }, jwt);
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
    // A fixture peer is verified only inside this disposable database.
    await pool.query("UPDATE telegram_crm_bindings SET telegram_user_id=$2,verified_at=NOW()-INTERVAL '1 minute',version=2 WHERE user_id=$1",[peer.id,peerTelegram]);
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
    const mine = await bot('/tasks?businessContext=event_genix');
    assert.equal(mine.status,200,JSON.stringify(mine.data));
    assert.deepEqual(mine.data.tasks.find(row=>row.id===task.id).viewerRoles,['author']);
    const peers = await bot('/tasks?businessContext=event_genix',undefined,peerTelegram);
    assert.equal(peers.status,200,JSON.stringify(peers.data));
    assert.deepEqual(peers.data.tasks.find(row=>row.id===task.id).viewerRoles,['executor']);
    const recovered = await bot(`/operations/${id}`);
    assert.equal(recovered.data.receipt.task.id,task.id);
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
    assert.equal((await request('POST','/api/auth/telegram-crm/disconnect',{password:process.env.TEST_PASS},jwt)).status,200);
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

test('actual profile browser loads optional identity controls without business-page failures', {skip:!enabled || !process.env.CRM_PILOT_BROWSER_MODULE}, async()=>{
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
        await context.route('https://www.clarity.ms/**',route=>route.fulfill({status:204,body:''}));
        await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:204,body:''}));
        await context.route('https://fonts.gstatic.com/**',route=>route.fulfill({status:204,body:''}));
        const page=await context.newPage();
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(BASE_URL+'/profile?tab=settings');
        await page.getByRole('button',{name:'Підключити Telegram',exact:true}).waitFor();
        await page.getByRole('button',{name:'Підключити Telegram',exact:true}).click();
        await page.getByLabel('Поточний пароль CRM (обов’язково)').fill(process.env.TEST_PASS);
        await page.getByRole('button',{name:'Отримати посилання'}).click();
        await page.getByRole('link',{name:'Відкрити Telegram'}).waitFor();
        // Do not capture the one-time link or proof in evidence.
        await page.goto(BASE_URL+'/profile?tab=settings');
        await page.getByRole('button',{name:'Підключити Telegram',exact:true}).waitFor();
        await page.screenshot({path:require('node:path').resolve(__dirname,'../../../telegram-profile-actual-mobile.png'),fullPage:true});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        assert.deepEqual(errors,[]);
    } finally {await browser.close();}
});
